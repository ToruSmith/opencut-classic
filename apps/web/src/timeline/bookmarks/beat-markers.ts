import type { Bookmark } from "@/timeline";

/** 節拍分析產生的書籤用這個備註 / 顏色標記,重新分析時只換掉它們,不動手動加的書籤 */
export const BEAT_BOOKMARK_NOTE = "節拍";
export const BEAT_BOOKMARK_COLOR = "#ff8a00";

export function isBeatBookmark({ bookmark }: { bookmark: Bookmark }): boolean {
	return bookmark.note === BEAT_BOOKMARK_NOTE;
}

/**
 * 換掉所有節拍書籤:先移除舊的節拍書籤,再加入新的;
 * 已經有手動書籤的那一格不重複加。frameTimes 需已對齊到影格。
 */
export function replaceBeatBookmarks({
	bookmarks,
	frameTimes,
}: {
	bookmarks: Bookmark[];
	frameTimes: number[];
}): Bookmark[] {
	const kept = bookmarks.filter((bookmark) => !isBeatBookmark({ bookmark }));
	const taken = new Set(kept.map((bookmark) => bookmark.time as number));
	const added: Bookmark[] = [];
	for (const time of frameTimes) {
		if (taken.has(time)) continue;
		taken.add(time);
		added.push({ time: time as Bookmark["time"], note: BEAT_BOOKMARK_NOTE, color: BEAT_BOOKMARK_COLOR });
	}
	return [...kept, ...added].sort((a, b) => a.time - b.time);
}

/**
 * 挑出要切的時間點:片段範圍內(不含頭尾)的節拍,每 `every` 拍取一個,從範圍內第一個節拍開始算。
 * 時間單位由呼叫端決定(tick),只要 beats / start / end 一致即可。
 */
export function pickSplitTimes({
	beats,
	start,
	end,
	every,
}: {
	beats: number[];
	start: number;
	end: number;
	every: number;
}): number[] {
	const step = Math.max(1, Math.floor(every));
	const inside = beats.filter((time) => time > start && time < end).sort((a, b) => a - b);
	return inside.filter((_, index) => index % step === 0);
}
