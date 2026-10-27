import {
	findTransitionPair,
	planCrossDissolve,
	type DissolveAction,
	type DissolveTracks,
} from "./cross-dissolve";
import { ramp, type TransitionKeyframe } from "./presets";

/**
 * 兩段片段之間的轉場(推移、滑動擦除、縮放)。
 *
 * 和交叉溶解一樣,後一段放在另一條軌道、開頭與前一段結尾重疊,重疊的部分就是轉場。
 * 這裡全部用關鍵影格(位置、縮放、不透明度)做,不需要新的著色器。純函式,有測試。
 *
 * 遮罩參數目前不能做關鍵影格,所以做不到「用遮罩掃過」的擦除;
 * 「滑動擦除」用上層片段滑進來蓋住(覆蓋)或滑出去露出下面(揭開)達成類似效果。
 */

export type PairKind = "push" | "slide" | "zoom";
/** 畫面內容移動的方向 */
export type PairDirection = "left" | "right" | "up" | "down";

export interface PairItem {
	trackId: string;
	elementId: string;
	side: "in" | "out";
	/** 這一段是不是重疊時在上層(被看到的那一層) */
	upper: boolean;
}

export type PairPlan =
	| {
			ok: true;
			overlap: number;
			items: [PairItem, PairItem];
			/** 聲音的交叉淡化(和交叉溶解相同) */
			audio: DissolveAction[];
	  }
	| { ok: false; reason: string };

export function planPairTransition({
	tracks,
	trackId,
	elementId,
}: {
	tracks: DissolveTracks;
	trackId: string;
	elementId: string;
}): PairPlan {
	const found = findTransitionPair({ tracks, trackId, elementId });
	if (!found.ok) return found;
	if (!found.firstVisual || !found.secondVisual) {
		return { ok: false, reason: "這個轉場需要前後兩段都是影片、圖片等畫面片段" };
	}
	const secondUpper = (found.second.layer ?? 0) > (found.first.layer ?? 0);
	const dissolve = planCrossDissolve({ tracks, trackId, elementId });
	return {
		ok: true,
		overlap: found.overlap,
		items: [
			{
				trackId: found.first.track.id,
				elementId: found.first.element.id,
				side: "out",
				upper: !secondUpper,
			},
			{
				trackId: found.second.track.id,
				elementId: found.second.element.id,
				side: "in",
				upper: secondUpper,
			},
		],
		audio: dissolve.ok ? dissolve.actions.filter((a) => a.kind === "audio") : [],
	};
}

const ZOOM_OUT_SCALE = 1.4;
const ZOOM_IN_SCALE = 0.6;

function num(params: Record<string, unknown>, key: string, fallback: number): number {
	const v = params[key];
	return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** 單一片段在轉場期間的關鍵影格(時間為相對該片段開頭的秒數) */
export function buildPairKeyframes({
	kind,
	direction,
	item,
	params,
	durationSeconds,
	overlapSeconds,
	canvas,
}: {
	kind: PairKind;
	direction: PairDirection;
	item: Pick<PairItem, "side" | "upper">;
	params: Record<string, unknown>;
	durationSeconds: number;
	overlapSeconds: number;
	canvas: { width: number; height: number };
}): TransitionKeyframe[] {
	const seconds = Math.min(overlapSeconds, durationSeconds);
	if (!(seconds > 0)) return [];
	const { side } = item;
	const make = (propertyPath: string, points: Array<{ progress: number; value: number }>) =>
		ramp({ propertyPath, side, durationSeconds, seconds, points }).map((k) => ({
			...k,
			seconds: Math.min(durationSeconds, Math.max(0, k.seconds)),
		}));

	const baseOpacity = num(params, "opacity", 1);

	if (kind === "zoom") {
		const baseX = num(params, "transform.scaleX", 1);
		const baseY = num(params, "transform.scaleY", 1);
		const factor = side === "out" ? ZOOM_OUT_SCALE : ZOOM_IN_SCALE;
		const result = [
			...make("transform.scaleX", [
				{ progress: 0, value: baseX * factor },
				{ progress: 1, value: baseX },
			]),
			...make("transform.scaleY", [
				{ progress: 0, value: baseY * factor },
				{ progress: 1, value: baseY },
			]),
		];
		if (item.upper) {
			result.push(
				...make("opacity", [
					{ progress: 0, value: 0 },
					{ progress: 1, value: baseOpacity },
				]),
			);
		}
		return result;
	}

	// 推移:兩段一起朝同一方向移動;滑動擦除:只有上層那一段移動
	if (kind === "slide" && !item.upper) return [];
	const horizontal = direction === "left" || direction === "right";
	const sign = direction === "left" || direction === "up" ? -1 : 1;
	const size = horizontal ? canvas.width : canvas.height;
	const path = horizontal ? "transform.positionX" : "transform.positionY";
	const base = num(params, path, 0);
	// 進場:從行進方向的反側進來;出場:朝行進方向離開
	const offset = side === "in" ? -sign * size : sign * size;
	return make(path, [
		{ progress: 0, value: base + offset },
		{ progress: 1, value: base },
	]);
}
