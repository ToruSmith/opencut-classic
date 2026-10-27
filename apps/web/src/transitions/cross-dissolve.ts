/**
 * 交叉溶解(兩段片段之間的轉場)。
 *
 * 這個編輯器的同一條軌道上片段不會重疊,所以「交叉溶解」用兩條軌道來做:
 * 後一段放在另一條軌道、和前一段重疊,重疊的那一段就是轉場。
 * 這裡只負責算出要做什麼(純函式,有測試),實際套用由呼叫端做:
 *
 * - 畫面:上層的片段做不透明度漸變。後一段在上層 → 後一段淡入;前一段在上層 → 前一段淡出。
 * - 聲音:前一段淡出、後一段淡入(等功率曲線,就是一般的音訊交叉淡化)。
 *
 * 時間單位都是 tick(MediaTime 的整數),由呼叫端換算。
 */

export interface DissolveElement {
	id: string;
	type: string;
	startTime: number;
	duration: number;
}

export interface DissolveTrack {
	id: string;
	elements: ReadonlyArray<DissolveElement>;
}

export interface DissolveTracks {
	overlay: ReadonlyArray<DissolveTrack>;
	main: DissolveTrack;
	audio: ReadonlyArray<DissolveTrack>;
}

export type DissolveAction =
	| {
			kind: "opacity";
			trackId: string;
			elementId: string;
			side: "in" | "out";
			/** 相對片段開頭的 tick */
			duration: number;
	  }
	| {
			kind: "audio";
			trackId: string;
			elementId: string;
			side: "in" | "out";
			duration: number;
	  };

export type DissolvePlan =
	| { ok: true; actions: DissolveAction[]; overlap: number }
	| { ok: false; reason: string };

const VISUAL_TYPES = new Set(["video", "image", "text", "sticker", "graphic"]);
const AUDIO_TYPES = new Set(["video", "audio"]);

export interface Located {
	track: DissolveTrack;
	element: DissolveElement;
	/** 畫面圖層:數字越大越上層;音訊軌是 null(不畫在畫面上) */
	layer: number | null;
}

function locateAll({ tracks }: { tracks: DissolveTracks }): Located[] {
	// 渲染順序:overlay[0] 在最上層,main 在最下層
	const visual = [...tracks.overlay, tracks.main];
	const result: Located[] = [];
	visual.forEach((track, index) => {
		const layer = visual.length - 1 - index;
		for (const element of track.elements) result.push({ track, element, layer });
	});
	for (const track of tracks.audio) {
		for (const element of track.elements) {
			result.push({ track, element, layer: null });
		}
	}
	return result;
}

const end = (element: DissolveElement) => element.startTime + element.duration;

export interface TransitionPair {
	first: Located;
	second: Located;
	overlap: number;
	firstVisual: boolean;
	secondVisual: boolean;
}

export type FindPairResult =
	| ({ ok: true } & TransitionPair)
	| { ok: false; reason: string };

/**
 * 找出和選取片段構成「前一段 / 後一段」的配對:
 * 後一段的開頭落在前一段裡,而且前一段在後一段結束前就結束(不是整段蓋住)。
 * 有多個候選時取重疊最長的一對。
 */
export function findTransitionPair({
	tracks,
	trackId,
	elementId,
}: {
	tracks: DissolveTracks;
	trackId: string;
	elementId: string;
}): FindPairResult {
	const all = locateAll({ tracks });
	const selected = all.find(
		(item) => item.track.id === trackId && item.element.id === elementId,
	);
	if (!selected) return { ok: false, reason: "找不到選取的片段" };

	const others = all.filter((item) => item.track.id !== trackId);
	const pairs: Array<{ first: Located; second: Located; overlap: number }> = [];
	for (const other of others) {
		for (const [first, second] of [
			[other, selected],
			[selected, other],
		] as const) {
			const a = first.element;
			const b = second.element;
			if (a.startTime < b.startTime && b.startTime < end(a) && end(a) <= end(b)) {
				pairs.push({ first, second, overlap: end(a) - b.startTime });
			}
		}
	}
	if (pairs.length === 0) {
		return {
			ok: false,
			reason:
				"找不到可以溶接的片段:請把後一段放在另一條軌道,開頭和前一段的結尾重疊。",
		};
	}
	pairs.sort((x, y) => y.overlap - x.overlap);
	const { first, second, overlap } = pairs[0];
	return {
		ok: true,
		first,
		second,
		overlap,
		firstVisual: first.layer !== null && VISUAL_TYPES.has(first.element.type),
		secondVisual: second.layer !== null && VISUAL_TYPES.has(second.element.type),
	};
}

export function planCrossDissolve({
	tracks,
	trackId,
	elementId,
}: {
	tracks: DissolveTracks;
	trackId: string;
	elementId: string;
}): DissolvePlan {
	const found = findTransitionPair({ tracks, trackId, elementId });
	if (!found.ok) return found;
	const { first, second, overlap, firstVisual, secondVisual } = found;
	const actions: DissolveAction[] = [];

	if (firstVisual && secondVisual) {
		if ((second.layer ?? 0) > (first.layer ?? 0)) {
			actions.push({
				kind: "opacity",
				trackId: second.track.id,
				elementId: second.element.id,
				side: "in",
				duration: overlap,
			});
		} else {
			actions.push({
				kind: "opacity",
				trackId: first.track.id,
				elementId: first.element.id,
				side: "out",
				duration: overlap,
			});
		}
	}

	if (AUDIO_TYPES.has(first.element.type)) {
		actions.push({
			kind: "audio",
			trackId: first.track.id,
			elementId: first.element.id,
			side: "out",
			duration: overlap,
		});
	}
	if (AUDIO_TYPES.has(second.element.type)) {
		actions.push({
			kind: "audio",
			trackId: second.track.id,
			elementId: second.element.id,
			side: "in",
			duration: overlap,
		});
	}

	if (actions.length === 0) {
		return { ok: false, reason: "這兩段片段無法溶接" };
	}
	return { ok: true, actions, overlap };
}
