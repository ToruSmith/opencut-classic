import { describe, expect, test } from "bun:test";
import { pickSplitTimes } from "../beat-markers";

describe("pickSplitTimes", () => {
	const beats = [0, 10, 20, 30, 40, 50];
	test("範圍內每一拍(不含頭尾)", () => {
		expect(pickSplitTimes({ beats, start: 10, end: 50, every: 1 })).toEqual([20, 30, 40]);
	});
	test("每 2 拍從範圍內第一個節拍開始算", () => {
		expect(pickSplitTimes({ beats, start: 5, end: 55, every: 2 })).toEqual([10, 30, 50]);
	});
	test("沒有節拍或 every 不合理", () => {
		expect(pickSplitTimes({ beats: [], start: 0, end: 100, every: 1 })).toEqual([]);
		expect(pickSplitTimes({ beats, start: 0, end: 100, every: 0 })).toEqual([0, 10, 20, 30, 40, 50].filter((t) => t > 0));
	});
});

describe("pickSplitTimes 最短片段", () => {
	const beats = [10, 20, 30, 40, 50, 60, 70, 80, 90];
	test("不會切出比 minGap 短的片段(含頭尾)", () => {
		const times = pickSplitTimes({ beats, start: 0, end: 95, every: 1, minGap: 25 });
		const edges = [0, ...times, 95];
		for (let i = 1; i < edges.length; i++) expect(edges[i] - edges[i - 1]).toBeGreaterThanOrEqual(25);
		expect(times).toEqual([30, 60]);
	});
	test("minGap 為 0 時和以前相同", () => {
		expect(pickSplitTimes({ beats, start: 0, end: 95, every: 4, minGap: 0 })).toEqual([10, 50, 90]);
	});
});
