import type { PairDirection, PairItem } from "./pair-transition";
import type { WipeKind } from "@/effects/definitions/wipe";

/**
 * 進度式擦除轉場(線性 / 圓形光圈 / 時鐘)的計畫。純函式,有測試。
 *
 * 做法:只對重疊時「在上層」的那一段加一個「擦除」特效,把它的進度做關鍵影格:
 * - 上層是前一段(出場):進度 0 → 100,上層被擦掉、露出下面的後一段。
 * - 上層是後一段(進場):進度 100 → 0,後一段被擦開。進場時反向旗標取反,讓前進方向和出場一致。
 * 特效只在這一段上,轉場前後進度是 0,特效定義會跳過 pass,不會空轉。
 * 不動專案格式:特效與關鍵影格都是既有資料。
 */

export type WipeParamValue = string | number | boolean;

export interface WipePlan {
	/** 擦除特效的靜態參數(進度以外) */
	params: Record<string, WipeParamValue>;
	/** 進度關鍵影格,時間是相對該片段開頭的秒數 */
	keyframes: Array<{ seconds: number; value: number }>;
}

/** 方向 = 擦除前進的方向,和「滑動擦除」的箭頭相同(角度 0 = 往右,順時針) */
export const WIPE_ANGLE_BY_DIRECTION: Record<PairDirection, number> = {
	right: 0,
	down: 90,
	left: 180,
	up: 270,
};

export function planWipeForItem({
	kind,
	direction,
	item,
	softness,
	reverse,
	durationSeconds,
	overlapSeconds,
}: {
	kind: WipeKind;
	direction: PairDirection;
	item: Pick<PairItem, "side" | "upper">;
	/** 0..100 */
	softness: number;
	reverse: boolean;
	durationSeconds: number;
	overlapSeconds: number;
}): WipePlan | null {
	if (!item.upper) return null;
	const seconds = Math.min(overlapSeconds, durationSeconds);
	if (!(seconds > 0)) return null;

	const isIn = item.side === "in";
	const start = isIn ? 0 : Math.max(0, durationSeconds - seconds);
	const end = isIn ? seconds : durationSeconds;

	return {
		params: {
			mode: kind,
			progress: 0,
			softness: Math.min(100, Math.max(0, Math.round(softness))),
			angle: WIPE_ANGLE_BY_DIRECTION[direction],
			reverse: isIn ? !reverse : reverse,
			centerX: 50,
			centerY: 50,
		},
		keyframes: [
			{ seconds: start, value: isIn ? 100 : 0 },
			{ seconds: end, value: isIn ? 0 : 100 },
		],
	};
}
