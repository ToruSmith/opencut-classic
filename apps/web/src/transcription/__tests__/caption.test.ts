import { describe, expect, test } from "bun:test";
import { buildCaptionChunks } from "../caption";

describe("buildCaptionChunks", () => {
	test("英文:每 3 個字一則,時間按字數平均分配", () => {
		const r = buildCaptionChunks({
			segments: [
				{ text: " Hello there my friend how are you", start: 0, end: 7 },
			],
		});
		expect(r.map((c) => c.text)).toEqual([
			"Hello there my",
			"friend how are",
			"you",
		]);
		expect(r[0]).toMatchObject({ startTime: 0 });
		expect(r[0]?.duration).toBeCloseTo(3);
	});

	test("中文:沒有空格的長句會在標點處與字數上限切開", () => {
		const r = buildCaptionChunks({
			segments: [
				{
					text: "今天天氣很好,我們一起去公園散步吧,然後吃午餐。",
					start: 0,
					end: 12,
				},
			],
		});
		expect(r.length).toBeGreaterThan(1);
		for (const c of r) {
			expect(Array.from(c.text).length).toBeLessThanOrEqual(12);
			expect(c.text).not.toMatch(/[,。]$/);
		}
		expect(r.map((c) => c.text).join("")).toBe(
			"今天天氣很好我們一起去公園散步吧然後吃午餐".replace(/,/g, ""),
		);
	});

	test("中文:沒有標點的超長句平均切開,不留孤兒字", () => {
		const r = buildCaptionChunks({
			segments: [{ text: "一二三四五六七八九十甲乙丙", start: 0, end: 13 }],
		});
		expect(r.map((c) => Array.from(c.text).length)).toEqual([7, 6]);
	});

	test("短的中文句子維持一則", () => {
		const r = buildCaptionChunks({
			segments: [{ text: "你好嗎", start: 1, end: 2 }],
		});
		expect(r).toEqual([{ text: "你好嗎", startTime: 1, duration: 1 }]);
	});

	test("字幕不重疊、空白片段被略過、零長度片段不會產生 NaN", () => {
		const r = buildCaptionChunks({
			segments: [
				{ text: "a b c d e f", start: 0, end: 1 },
				{ text: "   ", start: 1, end: 2 },
				{ text: "x", start: 5, end: 5 },
			],
		});
		for (let i = 1; i < r.length; i++) {
			expect(r[i]!.startTime).toBeGreaterThanOrEqual(
				r[i - 1]!.startTime + r[i - 1]!.duration - 1e-9,
			);
		}
		for (const c of r) expect(Number.isFinite(c.duration)).toBe(true);
		expect(r.at(-1)?.text).toBe("x");
	});
});
