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
 * 找下一個(或上一個)剪輯點;沒有就回傳 null。
 * 播放頭剛好停在剪輯點上時會跳到「再下一個」,連按才會一路往前。
 */
export function findAdjacentEditPoint({
	tracks,
	time,
	direction,
}: {
	tracks: SceneTracksLike;
	time: number;
	direction: "prev" | "next";
}): number | null {
	const points = collectEditPoints({ tracks });
	if (direction === "next") {
		return points.find((point) => point > time) ?? null;
	}
	for (let i = points.length - 1; i >= 0; i--) {
		if (points[i] < time) return points[i];
	}
	return null;
}
