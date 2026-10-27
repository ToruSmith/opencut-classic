import { describe, expect, test } from "bun:test";
import type { DissolveTracks } from "../cross-dissolve";
import { buildPairKeyframes, planPairTransition } from "../pair-transition";

const tracks = (secondUpper: boolean): DissolveTracks => {
	const a = { id: "A", type: "video", startTime: 0, duration: 100 };
	const b = { id: "B", type: "video", startTime: 80, duration: 100 };
	return secondUpper
		? { overlay: [{ id: "top", elements: [b] }], main: { id: "main", elements: [a] }, audio: [] }
		: { overlay: [{ id: "top", elements: [a] }], main: { id: "main", elements: [b] }, audio: [] };
};
const canvas = { width: 1920, height: 1080 };
const kf = (over: Partial<Parameters<typeof buildPairKeyframes>[0]>) =>
	buildPairKeyframes({
		kind: "push",
		direction: "left",
		item: { side: "in", upper: true },
		params: {},
		durationSeconds: 5,
		overlapSeconds: 1,
		canvas,
		...over,
	});

describe("planPairTransition", () => {
	test("後一段在上層", () => {
		const plan = planPairTransition({ tracks: tracks(true), trackId: "top", elementId: "B" });
		expect(plan.ok).toBe(true);
		if (!plan.ok) return;
		expect(plan.overlap).toBe(20);
		expect(plan.items[0]).toMatchObject({ elementId: "A", side: "out", upper: false });
		expect(plan.items[1]).toMatchObject({ elementId: "B", side: "in", upper: true });
		expect(plan.audio.length).toBe(2);
	});
	test("前一段在上層", () => {
		const plan = planPairTransition({ tracks: tracks(false), trackId: "main", elementId: "B" });
		expect(plan.ok && plan.items[0].upper).toBe(true);
	});
	test("找不到配對", () => {
		expect(planPairTransition({ tracks: tracks(true), trackId: "main", elementId: "nope" }).ok).toBe(false);
	});
});

describe("buildPairKeyframes", () => {
	test("推移向左:進場從右邊進來、出場往左邊離開", () => {
		const inKf = kf({});
		expect(inKf.map((k) => [k.seconds, k.value])).toEqual([[0, 1920], [1, 0]]);
		const outKf = kf({ item: { side: "out", upper: false } });
		expect(outKf.map((k) => [k.seconds, k.value]).sort()).toEqual([[4, 0], [5, -1920]]);
		expect(outKf[0].propertyPath).toBe("transform.positionX");
	});
	test("向下推移用 Y 軸與畫布高度", () => {
		const k = kf({ direction: "down" });
		expect(k[0].propertyPath).toBe("transform.positionY");
		expect(k[0].value).toBe(-1080);
	});
	test("以目前位置為基準", () => {
		const k = kf({ params: { "transform.positionX": 100 } });
		expect(k[k.length - 1].value).toBe(100);
	});
	test("滑動擦除:只有上層移動", () => {
		expect(kf({ kind: "slide", item: { side: "in", upper: false } })).toEqual([]);
		expect(kf({ kind: "slide" }).length).toBe(2);
	});
	test("縮放:前一段放大、後一段由小放大,只有上層淡化", () => {
		const out = kf({ kind: "zoom", item: { side: "out", upper: false } });
		expect(out.some((k) => k.propertyPath === "opacity")).toBe(false);
		expect(Math.max(...out.map((k) => k.value))).toBeCloseTo(1.4);
		const inn = kf({ kind: "zoom" });
		expect(inn.filter((k) => k.propertyPath === "opacity").map((k) => k.value)).toEqual([0, 1]);
		expect(Math.min(...inn.map((k) => k.value))).toBe(0);
	});
	test("重疊比片段長時不超出片段範圍", () => {
		const k = kf({ durationSeconds: 0.5, overlapSeconds: 2, item: { side: "out", upper: true } });
		for (const frame of k) {
			expect(frame.seconds).toBeGreaterThanOrEqual(0);
			expect(frame.seconds).toBeLessThanOrEqual(0.5);
		}
	});
});
