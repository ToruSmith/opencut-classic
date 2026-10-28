import { describe, expect, test } from "bun:test";
import { PULSE_MAX_COUNT, planBeatPulse } from "../beat-pulse";

const base = { clipStart: 0, clipDuration: 20, every: 1, strength: 0.1, decaySeconds: 0.3 };

function ok(plan: ReturnType<typeof planBeatPulse>) {
	if (!plan.ok) throw new Error(plan.reason);
	return plan;
}

describe("planBeatPulse", () => {
	test("每拍:起跳前一格原大小 → 瞬間放大 → 收回", () => {
		const plan = ok(planBeatPulse({ ...base, beats: [2] }));
		expect(plan.pulses).toBe(1);
		const peak = plan.keyframes.find((k) => k.factor === 1.1)!;
		expect(peak.seconds).toBeCloseTo(2, 9);
		const before = plan.keyframes[0]!;
		expect(before.factor).toBe(1);
		expect(before.seconds).toBeCloseTo(2 - 1 / 60, 9);
		expect(plan.keyframes[plan.keyframes.length - 1]).toEqual({ seconds: 2.3, factor: 1 });
	});

	test("時間以片段開頭為 0,範圍外的節拍忽略", () => {
		const plan = ok(planBeatPulse({ ...base, clipStart: 10, beats: [5, 12, 40] }));
		expect(plan.pulses).toBe(1);
		expect(plan.keyframes.find((k) => k.factor === 1.1)!.seconds).toBeCloseTo(2, 9);
	});

	test("時間嚴格遞增,且相鄰脈衝不會互相蓋過", () => {
		const beats = Array.from({ length: 80 }, (_, i) => 0.5 + i * 0.25);
		const plan = ok(planBeatPulse({ ...base, clipDuration: 30, beats }));
		for (let i = 1; i < plan.keyframes.length; i++) {
			expect(plan.keyframes[i]!.seconds).toBeGreaterThan(plan.keyframes[i - 1]!.seconds);
		}
	});

	test("收回時間不超過到下一拍的空間", () => {
		const plan = ok(planBeatPulse({ ...base, decaySeconds: 1, beats: [1, 1.2] }));
		// 第一個脈衝的終點要在第二個脈衝起跳前
		const ends = plan.keyframes.filter((k) => k.factor === 1 && k.seconds > 1);
		expect(ends[0]!.seconds).toBeLessThan(1.2 - 1 / 60);
	});

	test("every=2 只取每隔一拍", () => {
		const plan = ok(planBeatPulse({ ...base, every: 2, beats: [1, 2, 3, 4, 5] }));
		expect(plan.pulses).toBe(3);
	});

	test("太密的節拍被略過", () => {
		const plan = ok(planBeatPulse({ ...base, beats: [1, 1.05, 1.08, 2] }));
		expect(plan.pulses).toBe(2);
	});

	test("在片段開頭的節拍:沒有「起跳前」的關鍵影格", () => {
		const plan = ok(planBeatPulse({ ...base, beats: [0] }));
		expect(plan.keyframes[0]).toEqual({ seconds: 0, factor: 1.1 });
	});

	test("超過上限時只取前面的並回報略過數", () => {
		const beats = Array.from({ length: 400 }, (_, i) => 0.2 + i * 0.4);
		const plan = ok(planBeatPulse({ ...base, clipDuration: 200, beats }));
		expect(plan.pulses).toBe(PULSE_MAX_COUNT);
		expect(plan.skipped).toBe(400 - PULSE_MAX_COUNT);
	});

	test("沒有節拍 / 無效參數回報錯誤", () => {
		expect(planBeatPulse({ ...base, beats: [] }).ok).toBe(false);
		expect(planBeatPulse({ ...base, beats: [1], strength: 0 }).ok).toBe(false);
		expect(planBeatPulse({ ...base, beats: [1], clipDuration: 0 }).ok).toBe(false);
	});
});
