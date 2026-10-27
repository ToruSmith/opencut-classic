import { describe, expect, test } from "bun:test";
import { formatRangeFileSuffix, resolveExportRange } from "../range";

const TPS = 1000; // 測試用:每秒 1000 tick
const base = { totalTicks: 60 * TPS, ticksPerFrame: 40, ticksPerSecond: TPS }; // 25 fps

describe("範圍匯出換算", () => {
	test("整數秒剛好落在影格上", () => {
		const r = resolveExportRange({ ...base, startSeconds: 10, endSeconds: 20 });
		expect(r).toMatchObject({
			ok: true,
			startFrame: 250,
			frameCount: 250,
			startTicks: 10_000,
			endTicks: 20_000,
		});
	});

	test("起迄對齊到最近的影格,影片格數 × 每格 tick = 音訊長度", () => {
		const r = resolveExportRange({ ...base, startSeconds: 1.013, endSeconds: 2.49 });
		if (!r.ok) throw new Error("expected ok");
		expect(r.startTicks).toBe(r.startFrame * 40);
		expect(r.endTicks - r.startTicks).toBe(r.frameCount * 40);
		expect(r.startTicks % 40).toBe(0);
		expect(r.endTicks % 40).toBe(0);
	});

	test("終點超過時間軸:夾到最後一格", () => {
		const r = resolveExportRange({ ...base, startSeconds: 50, endSeconds: 999 });
		if (!r.ok) throw new Error("expected ok");
		expect(r.endTicks).toBeLessThanOrEqual(60_000);
		expect(r.endTicks).toBe(Math.floor(60_000 / 40) * 40);
	});

	test("整段 0 ~ 總長 = 全部影格", () => {
		const r = resolveExportRange({ ...base, startSeconds: 0, endSeconds: 60 });
		expect(r).toMatchObject({ ok: true, startFrame: 0, frameCount: 1500 });
	});

	test("無效範圍都回傳 ok: false", () => {
		for (const [startSeconds, endSeconds] of [
			[-1, 5],
			[5, 5],
			[6, 5],
			[60, 70],
			[100, 200],
			[Number.NaN, 5],
			[5, Number.POSITIVE_INFINITY],
			[1, 1.01], // 不到一個影格
		] as const) {
			expect(resolveExportRange({ ...base, startSeconds, endSeconds }).ok).toBe(false);
		}
		expect(
			resolveExportRange({ ...base, ticksPerFrame: 0, startSeconds: 0, endSeconds: 5 }).ok,
		).toBe(false);
	});

	test("檔名後綴", () => {
		expect(formatRangeFileSuffix({ startSeconds: 12, endSeconds: 45.9 })).toBe("_00-12_00-45");
		expect(formatRangeFileSuffix({ startSeconds: 61, endSeconds: 3725 })).toBe("_01-01_62-05");
	});
});
