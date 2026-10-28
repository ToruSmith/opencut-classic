import { describe, expect, test } from "bun:test";
import { FREEZE_MAX_SECONDS, FREEZE_RATE, planFreezeFrame } from "../freeze-frame";

const base = { elementStart: 10, elementDuration: 8, freezeSeconds: 1 };

describe("planFreezeFrame", () => {
	test("播放頭在片段中間:通過,素材只前進 N × 0.01 秒", () => {
		const plan = planFreezeFrame({ ...base, playhead: 14 });
		expect(plan.ok).toBe(true);
		if (plan.ok) expect(plan.sourceSpanSeconds).toBeCloseTo(1 * FREEZE_RATE, 12);
	});

	test("播放頭在片段外或太靠近頭尾:不通過", () => {
		expect(planFreezeFrame({ ...base, playhead: 9 }).ok).toBe(false);
		expect(planFreezeFrame({ ...base, playhead: 10 }).ok).toBe(false);
		expect(planFreezeFrame({ ...base, playhead: 10.05 }).ok).toBe(false);
		expect(planFreezeFrame({ ...base, playhead: 17.95 }).ok).toBe(false);
		expect(planFreezeFrame({ ...base, playhead: 18 }).ok).toBe(false);
		expect(planFreezeFrame({ ...base, playhead: 25 }).ok).toBe(false);
	});

	test("離頭尾剛好 0.1 秒以上可以", () => {
		expect(planFreezeFrame({ ...base, playhead: 10.1 }).ok).toBe(true);
		expect(planFreezeFrame({ ...base, playhead: 17.9 }).ok).toBe(true);
	});

	test("定格長度的上下限", () => {
		expect(planFreezeFrame({ ...base, playhead: 14, freezeSeconds: 0 }).ok).toBe(false);
		expect(planFreezeFrame({ ...base, playhead: 14, freezeSeconds: -1 }).ok).toBe(false);
		expect(planFreezeFrame({ ...base, playhead: 14, freezeSeconds: FREEZE_MAX_SECONDS }).ok).toBe(true);
		expect(planFreezeFrame({ ...base, playhead: 14, freezeSeconds: FREEZE_MAX_SECONDS + 0.1 }).ok).toBe(false);
	});

	test("非數值", () => {
		expect(planFreezeFrame({ ...base, playhead: NaN }).ok).toBe(false);
	});
});
