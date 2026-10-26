/**
 * 「上一個 / 下一個剪輯點」:時間軸上所有片段的開頭與結尾(加上 0)。
 *
 * 純函式:只讀數字(MediaTime 就是整數 tick),不碰 wasm,可以直接單元測試。
 * 和 Premiere / DaVinci 的 ↑ ↓ 一樣,隱藏的片段也算剪輯點。
 */

interface TimedElement {
	startTime: number;
	duration: number;
}

interface TrackLike {
	elements: ReadonlyArray<TimedElement>;
}

interface SceneTracksLike {
	overlay: ReadonlyArray<TrackLike>;
	main: TrackLike;
	audio: ReadonlyArray<TrackLike>;
}

export function collectEditPoints({
	tracks,
}: {
	tracks: SceneTracksLike;
}): number[] {
	const points = new Set<number>([0]);
	for (const track of [...tracks.overlay, tracks.main, ...tracks.audio]) {
		for (const element of track.elements) {
			points.add(element.startTime);
			points.add(element.startTime + element.duration);
		}
	}
	return [...points].sort((a, b) => a - b);
}

/**
 * 在一組時間點(不需排序)裡找下一個(或上一個);沒有就回傳 null。
 * 剛好停在某個點上時會跳到「再下一個」,連按才會一路往前。
 */
export function findAdjacentTime({
	points,
	time,
	direction,
}: {
	points: ReadonlyArray<number>;
	time: number;
	direction: "prev" | "next";
}): number | null {
	if (direction === "next") {
		let best: number | null = null;
		for (const point of points) {
			if (point > time && (best === null || point < best)) best = point;
		}
		return best;
	}
	let best: number | null = null;
	for (const point of points) {
		if (point < time && (best === null || point > best)) best = point;
	}
	return best;
}

export function findAdjacentEditPoint({
	tracks,
	time,
	direction,
}: {
	tracks: SceneTracksLike;
	time: number;
	direction: "prev" | "next";
}): number | null {
	return findAdjacentTime({
		points: collectEditPoints({ tracks }),
		time,
		direction,
	});
}

/** 上一個 / 下一個書籤(書籤不一定排序過,所以不假設順序) */
export function findAdjacentBookmark({
	bookmarks,
	time,
	direction,
}: {
	bookmarks: ReadonlyArray<{ time: number }>;
	time: number;
	direction: "prev" | "next";
}): number | null {
	return findAdjacentTime({
		points: bookmarks.map((bookmark) => bookmark.time),
		time,
		direction,
	});
}
