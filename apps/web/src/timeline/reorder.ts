/**
 * 重排同一條軌道上的多個片段(AMV 快切:把依節拍切開的小段打散或反轉)。
 * 純函式,有測試。重排後的片段從「原本最早的開始時間」起首尾相接,中間的空隙會被補掉;
 * 片段長度不變,所以整體範圍只會因為原本有空隙而縮短。
 */

export interface ReorderPiece {
	trackId: string;
	elementId: string;
	startTime: number;
	duration: number;
}

export interface ReorderPlacement {
	trackId: string;
	elementId: string;
	startTime: number;
}

export type ReorderMode = "shuffle" | "reverse";

/** 可重現的亂數(mulberry32) */
function createRandom({ seed }: { seed: number }): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function shuffled<T>({ items, seed }: { items: T[]; seed: number }): T[] {
	const random = createRandom({ seed });
	const result = [...items];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[result[i], result[j]] = [result[j], result[i]];
	}
	return result;
}

export function computeReorder({
	pieces,
	mode,
	seed = 1,
}: {
	pieces: ReorderPiece[];
	mode: ReorderMode;
	seed?: number;
}): ReorderPlacement[] {
	const byTrack = new Map<string, ReorderPiece[]>();
	for (const piece of pieces) {
		const list = byTrack.get(piece.trackId) ?? [];
		list.push(piece);
		byTrack.set(piece.trackId, list);
	}

	const placements: ReorderPlacement[] = [];
	for (const [trackId, list] of byTrack) {
		if (list.length < 2) continue;
		const ordered = [...list].sort((a, b) => a.startTime - b.startTime);
		let next: ReorderPiece[];
		if (mode === "reverse") {
			next = [...ordered].reverse();
		} else {
			// 筆數 ≥ 3 時盡量避免洗完和原本一樣
			next = shuffled({ items: ordered, seed });
			for (let attempt = 1; attempt <= 5 && ordered.length >= 3; attempt++) {
				if (next.some((piece, index) => piece !== ordered[index])) break;
				next = shuffled({ items: ordered, seed: seed + attempt * 7919 });
			}
		}
		let cursor = ordered[0].startTime;
		for (const piece of next) {
			placements.push({ trackId, elementId: piece.elementId, startTime: cursor });
			cursor += piece.duration;
		}
	}
	return placements;
}
