import { describe, expect, test } from "bun:test";
import { planAutoCut, type AutoCutSource } from "../auto-cut";

const S = 1000; // 測試用的「1 秒」,單位只要一致即可
const beats = Array.from({ length: 40 }, (_, i) => (i + 1) * S); // 每秒一拍,1..40 秒
const videos: AutoCutSource[] = [
	{ id: "a", kind: "video", durationTicks: 30 * S },
	{ id: "b", kind: "video", durationTicks: 20 * S },
	{ id: "c", kind: "video", durationTicks: 12 * S },
];
const base = { beats, start: 0, end: 40 * S, sources: videos, every: 4, minGap: 0, seed: 7 };

describe("自動排片", () => {
	test("同一個種子結果相同,換種子結果不同", () => {
		expect(planAutoCut(base)).toEqual(planAutoCut(base));
		expect(planAutoCut({ ...base, seed: 8 })).not.toEqual(planAutoCut(base));
	});

	test("片段首尾相接、剛好填滿範圍,和節拍切點對齊", () => {
		const { pieces } = planAutoCut(base);
		expect(pieces[0]!.startTime).toBe(0);
		for (let i = 1; i < pieces.length; i++) {
			expect(pieces[i]!.startTime).toBe(pieces[i - 1]!.startTime + pieces[i - 1]!.duration);
		}
		const last = pieces[pieces.length - 1]!;
		expect(last.startTime + last.duration).toBe(40 * S);
		// 每 4 拍一刀,從範圍內第一個節拍算起:切點是第 1、5、9… 拍
		expect(pieces.slice(1).every((p) => (p.startTime - S) % (4 * S) === 0)).toBe(true);
	});

	test("影片的入點與出點不超過素材長度,trim 加起來等於素材長度", () => {
		for (let seed = 1; seed <= 30; seed++) {
			for (const p of planAutoCut({ ...base, seed }).pieces) {
				const source = videos.find((v) => v.id === p.sourceId)!;
				expect(p.trimStart).toBeGreaterThanOrEqual(0);
				expect(p.trimEnd).toBeGreaterThanOrEqual(0);
				expect(p.trimStart + p.duration + p.trimEnd).toBe(source.durationTicks);
				expect(p.sourceDuration).toBe(source.durationTicks);
			}
		}
	});

	test("不會連續抽到同一支(有多支可選時)", () => {
		for (let seed = 1; seed <= 30; seed++) {
			const { pieces } = planAutoCut({ ...base, every: 1, seed });
			for (let i = 1; i < pieces.length; i++) {
				expect(pieces[i]!.sourceId).not.toBe(pieces[i - 1]!.sourceId);
			}
		}
	});

	test("只有一支素材時允許重複", () => {
		const { pieces } = planAutoCut({ ...base, sources: [videos[0]!] });
		expect(pieces.length).toBeGreaterThan(1);
		expect(pieces.every((p) => p.sourceId === "a")).toBe(true);
	});

	test("素材比切段短就不會被抽中", () => {
		// 每 16 拍一刀 → 中間的切段 16 秒,素材 c(12 秒)太短,只可能出現在比 12 秒短的段落
		for (let seed = 1; seed <= 30; seed++) {
			const { pieces, shortfallCount } = planAutoCut({ ...base, every: 16, seed });
			for (const p of pieces.filter((piece) => piece.sourceId === "c")) {
				expect(p.duration).toBeLessThanOrEqual(12 * S);
			}
			expect(shortfallCount).toBe(0);
		}
	});

	test("全部素材都比切段短:用最長的並縮短,回報 shortfall", () => {
		const { pieces, shortfallCount } = planAutoCut({ ...base, end: 100 * S, beats: [], sources: [videos[2]!] });
		expect(pieces.length).toBe(1);
		expect(pieces[0]!.duration).toBe(12 * S);
		expect(shortfallCount).toBe(1);
	});

	test("圖片任何長度都可以,入點 0,沒有 sourceDuration", () => {
		const { pieces } = planAutoCut({
			...base,
			sources: [{ id: "p", kind: "image", durationTicks: 0 }],
			every: 8,
		});
		expect(pieces.length).toBeGreaterThan(1);
		for (const p of pieces) {
			expect(p.kind).toBe("image");
			expect(p.trimStart).toBe(0);
			expect(p.trimEnd).toBe(0);
			expect(p.sourceDuration).toBeUndefined();
		}
	});

	test("切點數量有上限,超過就稀釋並回報", () => {
		const many = Array.from({ length: 400 }, (_, i) => (i + 1) * 100);
		const plan = planAutoCut({ ...base, beats: many, end: 40_001, every: 1, maxCuts: 50 });
		expect(plan.pieces.length).toBeLessThanOrEqual(50);
		expect(plan.thinnedCuts).toBeGreaterThan(0);
		const last = plan.pieces[plan.pieces.length - 1]!;
		expect(last.startTime + last.duration).toBe(40_001);
	});

	test("最短片段:沒有任何一段短於 minGap(頭尾除外的切法同 pickSplitTimes)", () => {
		const { pieces } = planAutoCut({ ...base, every: 1, minGap: 3 * S });
		for (const p of pieces.slice(0, -1)) expect(p.duration).toBeGreaterThanOrEqual(3 * S);
	});

	test("沒有素材或範圍為空時回傳空計畫", () => {
		expect(planAutoCut({ ...base, sources: [] }).pieces).toEqual([]);
		expect(planAutoCut({ ...base, end: 0 }).pieces).toEqual([]);
	});
});
