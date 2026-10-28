import { describe, expect, test } from "bun:test";
import { mergeRanges, planDucking } from "../ducking";

const base = { baseDb: 0, duckDb: -12, attackSeconds: 0.25, releaseSeconds: 0.5 };

function ok(plan: ReturnType<typeof planDucking>) {
	if (!plan.ok) throw new Error(plan.reason);
	return plan;
}

describe("mergeRanges", () => {
	test("重疊與間隔小於 gap 的合併", () => {
		expect(
			mergeRanges({
				ranges: [
					{ start: 5, end: 7 },
					{ start: 0, end: 2 },
					{ start: 2.5, end: 3 },
					{ start: 6, end: 8 },
				],
				gap: 0.6,
			}),
		).toEqual([
			{ start: 0, end: 3 },
			{ start: 5, end: 8 },
		]);
	});
	test("忽略無效區間", () => {
		expect(mergeRanges({ ranges: [{ start: 3, end: 3 }, { start: NaN, end: 4 }], gap: 1 })).toEqual([]);
	});
});

describe("planDucking", () => {
	test("單一人聲:壓下 → 維持 → 放開", () => {
		const plan = ok(planDucking({ ...base, voiceRanges: [{ start: 10, end: 14 }], musicStart: 0, musicDuration: 30 }));
		expect(plan.keyframes).toEqual([
			{ seconds: 0, value: 0 },
			{ seconds: 9.75, value: 0 },
			{ seconds: 10, value: -12 },
			{ seconds: 14, value: -12 },
			{ seconds: 14.5, value: 0 },
		]);
	});

	test("時間以音樂片段開頭為 0(音樂不是從 0 開始)", () => {
		const plan = ok(planDucking({ ...base, voiceRanges: [{ start: 110, end: 112 }], musicStart: 100, musicDuration: 30 }));
		expect(plan.keyframes.find((k) => k.value === -12)?.seconds).toBe(10);
	});

	test("壓低是相對目前音量,且不低於下限", () => {
		const plan = ok(planDucking({ ...base, baseDb: -6, voiceRanges: [{ start: 5, end: 6 }], musicStart: 0, musicDuration: 20 }));
		expect(Math.min(...plan.keyframes.map((k) => k.value))).toBe(-18);
		const floor = ok(planDucking({ ...base, baseDb: -55, voiceRanges: [{ start: 5, end: 6 }], musicStart: 0, musicDuration: 20 }));
		expect(Math.min(...floor.keyframes.map((k) => k.value))).toBe(-60);
	});

	test("開頭就有人聲:從壓低的音量開始", () => {
		const plan = ok(planDucking({ ...base, voiceRanges: [{ start: -2, end: 3 }], musicStart: 0, musicDuration: 20 }));
		expect(plan.keyframes[0]).toEqual({ seconds: 0, value: -12 });
	});

	test("人聲延伸到結尾之後:最後仍是壓低的音量,不會超出片段", () => {
		const plan = ok(planDucking({ ...base, voiceRanges: [{ start: 15, end: 40 }], musicStart: 0, musicDuration: 20 }));
		const last = plan.keyframes[plan.keyframes.length - 1]!;
		expect(last).toEqual({ seconds: 20, value: -12 });
	});

	test("兩句人聲間隔太短:合併成一段,不會在中間回彈", () => {
		const plan = ok(
			planDucking({
				...base,
				voiceRanges: [{ start: 5, end: 7 }, { start: 7.4, end: 9 }],
				musicStart: 0,
				musicDuration: 20,
			}),
		);
		expect(plan.duckedRanges).toBe(1);
		expect(plan.keyframes.filter((k) => k.value === -12).length).toBe(2);
	});

	test("間隔夠長:各自壓下放開;時間嚴格遞增", () => {
		const plan = ok(
			planDucking({
				...base,
				voiceRanges: [{ start: 3, end: 5 }, { start: 12, end: 14 }, { start: 25, end: 26 }],
				musicStart: 0,
				musicDuration: 40,
			}),
		);
		expect(plan.duckedRanges).toBe(3);
		for (let i = 1; i < plan.keyframes.length; i++) {
			expect(plan.keyframes[i]!.seconds).toBeGreaterThan(plan.keyframes[i - 1]!.seconds);
		}
	});

	test("沒有重疊 / 無效參數時回報錯誤", () => {
		expect(planDucking({ ...base, voiceRanges: [{ start: 50, end: 60 }], musicStart: 0, musicDuration: 20 }).ok).toBe(false);
		expect(planDucking({ ...base, voiceRanges: [], musicStart: 0, musicDuration: 20 }).ok).toBe(false);
		expect(planDucking({ ...base, duckDb: 3, voiceRanges: [{ start: 1, end: 2 }], musicStart: 0, musicDuration: 20 }).ok).toBe(false);
		expect(planDucking({ ...base, voiceRanges: [{ start: 1, end: 2 }], musicStart: 0, musicDuration: 0 }).ok).toBe(false);
	});
});
