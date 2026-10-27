import { describe, expect, test } from "bun:test";
import { planWipeForItem } from "../wipe-transition";

const base = {
	kind: "linear" as const,
	direction: "right" as const,
	softness: 20,
	reverse: false,
	durationSeconds: 10,
	overlapSeconds: 2,
};

describe("擦除轉場計畫", () => {
	test("上層是前一段(出場):結尾 overlap 秒內進度 0 → 100", () => {
		const plan = planWipeForItem({ ...base, item: { side: "out", upper: true } })!;
		expect(plan.keyframes).toEqual([
			{ seconds: 8, value: 0 },
			{ seconds: 10, value: 100 },
		]);
		expect(plan.params.reverse).toBe(false);
		expect(plan.params.progress).toBe(0);
	});

	test("上層是後一段(進場):開頭 overlap 秒內進度 100 → 0,反向旗標取反", () => {
		const plan = planWipeForItem({ ...base, item: { side: "in", upper: true } })!;
		expect(plan.keyframes).toEqual([
			{ seconds: 0, value: 100 },
			{ seconds: 2, value: 0 },
		]);
		expect(plan.params.reverse).toBe(true);
		expect(
			planWipeForItem({ ...base, reverse: true, item: { side: "in", upper: true } })!.params.reverse,
		).toBe(false);
	});

	test("下層那一段不加特效", () => {
		expect(planWipeForItem({ ...base, item: { side: "in", upper: false } })).toBeNull();
	});

	test("重疊比片段長時夾在片段長度內;重疊為 0 不產生計畫", () => {
		const plan = planWipeForItem({
			...base,
			durationSeconds: 1,
			overlapSeconds: 5,
			item: { side: "out", upper: true },
		})!;
		expect(plan.keyframes).toEqual([
			{ seconds: 0, value: 0 },
			{ seconds: 1, value: 100 },
		]);
		expect(planWipeForItem({ ...base, overlapSeconds: 0, item: { side: "out", upper: true } })).toBeNull();
	});

	test("方向換成角度、柔邊夾在 0..100", () => {
		const angle = (direction: "left" | "right" | "up" | "down") =>
			planWipeForItem({ ...base, direction, item: { side: "out", upper: true } })!.params.angle;
		expect([angle("right"), angle("down"), angle("left"), angle("up")]).toEqual([0, 90, 180, 270]);
		expect(
			planWipeForItem({ ...base, softness: 500, item: { side: "out", upper: true } })!.params.softness,
		).toBe(100);
	});

	test("三種方式都寫進 mode", () => {
		for (const kind of ["linear", "iris", "clock"] as const) {
			expect(planWipeForItem({ ...base, kind, item: { side: "out", upper: true } })!.params.mode).toBe(kind);
		}
	});
});
