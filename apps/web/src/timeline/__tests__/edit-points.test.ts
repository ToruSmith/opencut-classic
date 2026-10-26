import { describe, expect, test } from "bun:test";
import {
	collectEditPoints,
	findAdjacentBookmark,
	findAdjacentEditPoint,
} from "../edit-points";

const tracks = {
	overlay: [{ elements: [{ startTime: 150, duration: 100 }] }],
	main: {
		elements: [
			{ startTime: 0, duration: 100 },
			{ startTime: 100, duration: 200 },
		],
	},
	audio: [{ elements: [{ startTime: 50, duration: 50 }] }],
};

describe("collectEditPoints", () => {
	test("包含 0、所有片段頭尾,去重並排序", () => {
		expect(collectEditPoints({ tracks })).toEqual([0, 50, 100, 150, 250, 300]);
	});

	test("空時間軸只有 0", () => {
		expect(
			collectEditPoints({
				tracks: { overlay: [], main: { elements: [] }, audio: [] },
			}),
		).toEqual([0]);
	});
});

describe("findAdjacentEditPoint", () => {
	test("下一個:停在剪輯點上時跳到再下一個", () => {
		expect(findAdjacentEditPoint({ tracks, time: 100, direction: "next" })).toBe(150);
		expect(findAdjacentEditPoint({ tracks, time: 120, direction: "next" })).toBe(150);
	});

	test("上一個:停在剪輯點上時跳到再上一個", () => {
		expect(findAdjacentEditPoint({ tracks, time: 100, direction: "prev" })).toBe(50);
		expect(findAdjacentEditPoint({ tracks, time: 120, direction: "prev" })).toBe(100);
	});

	test("到底了回傳 null", () => {
		expect(findAdjacentEditPoint({ tracks, time: 300, direction: "next" })).toBeNull();
		expect(findAdjacentEditPoint({ tracks, time: 0, direction: "prev" })).toBeNull();
	});
});

describe("findAdjacentBookmark", () => {
	const bookmarks = [{ time: 300 }, { time: 100 }, { time: 200 }];

	test("書籤沒排序也能找到最近的", () => {
		expect(findAdjacentBookmark({ bookmarks, time: 150, direction: "next" })).toBe(200);
		expect(findAdjacentBookmark({ bookmarks, time: 150, direction: "prev" })).toBe(100);
	});

	test("停在書籤上會跳到再下一個;沒有書籤回傳 null", () => {
		expect(findAdjacentBookmark({ bookmarks, time: 200, direction: "next" })).toBe(300);
		expect(findAdjacentBookmark({ bookmarks: [], time: 0, direction: "next" })).toBeNull();
	});
});
