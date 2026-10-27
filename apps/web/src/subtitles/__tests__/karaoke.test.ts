import { describe, expect, test } from "bun:test";
import { computeTextSpanFraction, planKaraokeSweep } from "../karaoke";

describe("卡拉 OK 填色", () => {
	test("文字置中:左右邊界對稱,並留邊", () => {
		const span = computeTextSpanFraction({
			rectLeft: -200,
			rectWidth: 400,
			positionX: 0,
			scaleX: 1,
			canvasWidth: 1000,
		});
		expect(span.left).toBeCloseTo(0.3 - 0.01, 6);
		expect(span.right).toBeCloseTo(0.7 + 0.01, 6);
	});

	test("位置偏移與縮放會反映在邊界上", () => {
		const span = computeTextSpanFraction({
			rectLeft: -100,
			rectWidth: 200,
			positionX: 100,
			scaleX: 2,
			canvasWidth: 1000,
			paddingFraction: 0,
		});
		// 中心 500 + 100 = 600;左 = 600 - 200 = 400,右 = 400 + 400 = 800
		expect(span.left).toBeCloseTo(0.4, 6);
		expect(span.right).toBeCloseTo(0.8, 6);
	});

	test("超出畫面會夾在 0..1;無效輸入回到整個畫面", () => {
		const wide = computeTextSpanFraction({
			rectLeft: -900,
			rectWidth: 1800,
			positionX: 0,
			scaleX: 1,
			canvasWidth: 1000,
		});
		expect(wide).toEqual({ left: 0, right: 1 });
		for (const input of [
			{ canvasWidth: 0 },
			{ canvasWidth: Number.NaN },
			{ rectWidth: Number.NaN },
			{ scaleX: 0 },
		]) {
			expect(
				computeTextSpanFraction({
					rectLeft: -100,
					rectWidth: 200,
					positionX: 0,
					scaleX: 1,
					canvasWidth: 1000,
					...input,
				}),
			).toEqual({ left: 0, right: 1 });
		}
	});

	test("擦除計畫:進度 100 → 0,掃過範圍對應文字邊界(%)", () => {
		const plan = planKaraokeSweep({
			span: { left: 0.291, right: 0.709 },
			durationSeconds: 4,
		})!;
		expect(plan.keyframes).toEqual([
			{ seconds: 0, value: 100 },
			{ seconds: 4, value: 0 },
		]);
		expect(plan.params).toMatchObject({
			mode: "linear",
			angle: 0,
			reverse: true,
			softness: 0,
			rangeStart: 29.1,
			rangeEnd: 70.9,
		});
	});

	test("填色比例:只填前面一段;下限 5%、上限 100%", () => {
		const at = (sweepFraction: number) =>
			planKaraokeSweep({ span: { left: 0, right: 1 }, durationSeconds: 10, sweepFraction })!
				.keyframes[1]!.seconds;
		expect(at(0.8)).toBeCloseTo(8, 9);
		expect(at(5)).toBe(10);
		expect(at(0)).toBeCloseTo(0.5, 9);
	});

	test("長度為 0 或無效時不產生計畫", () => {
		expect(planKaraokeSweep({ span: { left: 0, right: 1 }, durationSeconds: 0 })).toBeNull();
		expect(planKaraokeSweep({ span: { left: 0, right: 1 }, durationSeconds: Number.NaN })).toBeNull();
	});
});
