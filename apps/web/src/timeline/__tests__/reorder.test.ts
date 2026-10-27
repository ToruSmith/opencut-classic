import { describe, expect, test } from "bun:test";
import { computeReorder, type ReorderPiece } from "../reorder";

const piece = (id: string, startTime: number, duration: number, trackId = "t"): ReorderPiece => ({
	trackId,
	elementId: id,
	startTime,
	duration,
});
const pieces = [piece("a", 100, 10), piece("b", 110, 20), piece("c", 130, 10), piece("d", 140, 30)];

describe("computeReorder", () => {
	test("反轉:從原本最早的位置起首尾相接", () => {
		const result = computeReorder({ pieces, mode: "reverse" });
		expect(result.map((p) => [p.elementId, p.startTime])).toEqual([
			["d", 100],
			["c", 130],
			["b", 140],
			["a", 160],
		]);
	});

	test("洗牌:每個片段都出現一次、不重疊、總長度不變、可重現", () => {
		const first = computeReorder({ pieces, mode: "shuffle", seed: 42 });
		const second = computeReorder({ pieces, mode: "shuffle", seed: 42 });
		expect(first).toEqual(second);
		expect(first.map((p) => p.elementId).sort()).toEqual(["a", "b", "c", "d"]);
		const durations = new Map(pieces.map((p) => [p.elementId, p.duration]));
		let cursor = 100;
		for (const p of first) {
			expect(p.startTime).toBe(cursor);
			cursor += durations.get(p.elementId) ?? 0;
		}
		expect(cursor).toBe(170);
	});

	test("洗牌結果不會和原順序相同(≥3 片)", () => {
		for (let seed = 0; seed < 50; seed++) {
			const result = computeReorder({ pieces, mode: "shuffle", seed });
			expect(result.map((p) => p.elementId).join("")).not.toBe("abcd");
		}
	});

	test("不同軌道各自處理;單一片段的軌道不動", () => {
		const mixed = [piece("a", 0, 5, "x"), piece("b", 5, 5, "x"), piece("z", 0, 5, "y")];
		const result = computeReorder({ pieces: mixed, mode: "reverse" });
		expect(result.map((p) => p.elementId).sort()).toEqual(["a", "b"]);
	});

	test("少於兩個片段:沒有動作", () => {
		expect(computeReorder({ pieces: [piece("a", 0, 5)], mode: "shuffle" })).toEqual([]);
	});
});

describe("computeReorder pack", () => {
	test("維持順序、補掉空隙", () => {
		const gap = [piece("a", 10, 5), piece("b", 30, 5), piece("c", 50, 5)];
		const result = computeReorder({ pieces: gap, mode: "pack" });
		expect(result.map((p) => [p.elementId, p.startTime])).toEqual([
			["a", 10],
			["b", 15],
			["c", 20],
		]);
	});
});
