import { describe, expect, test } from "bun:test";
import {
	SPEED_RAMP_PROFILES,
	planSpeedRamp,
	profileShape,
} from "../speed-ramp";

function ok(plan: ReturnType<typeof planSpeedRamp>) {
	if (!plan.ok) throw new Error(plan.reason);
	return plan;
}

describe("planSpeedRamp", () => {
	test("每種曲線的總長度都等於原長度", () => {
		for (const profile of SPEED_RAMP_PROFILES) {
			const plan = ok(
				planSpeedRamp({
					durationSeconds: 10,
					baseRate: 1,
					profile,
					strength: 0.6,
					segments: 12,
				}),
			);
			const total = plan.pieces.reduce((sum, p) => sum + p.durationSeconds, 0);
			expect(total).toBeCloseTo(10, 9);
		}
	});

	test("漸快:倍率遞增;漸慢:遞減", () => {
		const up = ok(
			planSpeedRamp({ durationSeconds: 8, baseRate: 1, profile: "accelerate", strength: 0.5, segments: 8 }),
		);
		for (let i = 1; i < up.pieces.length; i++) {
			expect(up.pieces[i].rate).toBeGreaterThan(up.pieces[i - 1].rate);
		}
		const down = ok(
			planSpeedRamp({ durationSeconds: 8, baseRate: 1, profile: "decelerate", strength: 0.5, segments: 8 }),
		);
		for (let i = 1; i < down.pieces.length; i++) {
			expect(down.pieces[i].rate).toBeLessThan(down.pieces[i - 1].rate);
		}
	});

	test("中間慢:兩端快、中間最慢", () => {
		const plan = ok(
			planSpeedRamp({ durationSeconds: 8, baseRate: 1, profile: "slow-middle", strength: 0.5, segments: 9 }),
		);
		const rates = plan.pieces.map((p) => p.rate);
		expect(Math.min(...rates)).toBe(rates[4]);
		expect(rates[0]).toBeGreaterThan(rates[4]);
		expect(rates[8]).toBeCloseTo(rates[0], 9);
	});

	test("強度 0 = 全程原速", () => {
		const plan = ok(
			planSpeedRamp({ durationSeconds: 6, baseRate: 1.5, profile: "accelerate", strength: 0, segments: 6 }),
		);
		for (const piece of plan.pieces) {
			expect(piece.rate).toBeCloseTo(1.5, 9);
			expect(piece.durationSeconds).toBeCloseTo(1, 9);
		}
	});

	test("每段的素材長度相同(duration × rate 固定)", () => {
		const plan = ok(
			planSpeedRamp({ durationSeconds: 10, baseRate: 2, profile: "fast-middle", strength: 0.7, segments: 10 }),
		);
		for (const piece of plan.pieces) {
			expect(piece.durationSeconds * piece.rate).toBeCloseTo(2, 9);
		}
	});

	test("起始位置連續", () => {
		const plan = ok(
			planSpeedRamp({ durationSeconds: 10, baseRate: 1, profile: "decelerate", strength: 0.8, segments: 8 }),
		);
		let expected = 0;
		for (const piece of plan.pieces) {
			expect(piece.startOffsetSeconds).toBeCloseTo(expected, 9);
			expected += piece.durationSeconds;
		}
	});

	test("倍率超過上限時回報錯誤", () => {
		const plan = planSpeedRamp({ durationSeconds: 10, baseRate: 4, profile: "accelerate", strength: 1, segments: 8 });
		expect(plan.ok).toBe(false);
	});

	test("段太短時回報錯誤", () => {
		const plan = planSpeedRamp({ durationSeconds: 1, baseRate: 1, profile: "accelerate", strength: 0.8, segments: 20 });
		expect(plan.ok).toBe(false);
	});

	test("段數超出範圍時回報錯誤", () => {
		expect(planSpeedRamp({ durationSeconds: 10, baseRate: 1, profile: "accelerate", strength: 0.5, segments: 2 }).ok).toBe(false);
		expect(planSpeedRamp({ durationSeconds: 10, baseRate: 1, profile: "accelerate", strength: 0.5, segments: 99 }).ok).toBe(false);
	});

	test("profileShape 值域在 -1..1", () => {
		for (const profile of SPEED_RAMP_PROFILES) {
			for (let i = 0; i <= 10; i++) {
				const v = profileShape({ profile, u: i / 10 });
				expect(v).toBeGreaterThanOrEqual(-1);
				expect(v).toBeLessThanOrEqual(1);
			}
		}
	});
});
