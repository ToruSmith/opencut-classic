import { describe, expect, test } from "bun:test";
import {
	KEN_BURNS_KINDS,
	buildKenBurnsKeyframes,
	pickKenBurnsKinds,
} from "../ken-burns";

const canvas = { width: 1920, height: 1080 };

function path(
	keyframes: ReturnType<typeof buildKenBurnsKeyframes>,
	propertyPath: string,
) {
	return keyframes
		.filter((k) => k.propertyPath === propertyPath)
		.sort((a, b) => a.seconds - b.seconds)
		.map((k) => k.value);
}

describe("buildKenBurnsKeyframes", () => {
	test("推近:縮放從目前值放大到 1+zoom 倍,位置不動", () => {
		const keyframes = buildKenBurnsKeyframes({
			params: { "transform.scaleX": 2, "transform.scaleY": 2 },
			durationSeconds: 5,
			kind: "zoom-in",
			zoom: 0.2,
			canvas,
		});
		expect(path(keyframes, "transform.scaleX")).toEqual([2, 2.4]);
		expect(path(keyframes, "transform.scaleY")).toEqual([2, 2.4]);
		expect(path(keyframes, "transform.positionX")).toEqual([]);
		expect(keyframes.every((k) => k.seconds === 0 || k.seconds === 5)).toBe(true);
	});

	test("拉遠:和推近相反,結束回到目前值", () => {
		const keyframes = buildKenBurnsKeyframes({
			params: {},
			durationSeconds: 4,
			kind: "zoom-out",
			zoom: 0.25,
			canvas,
		});
		expect(path(keyframes, "transform.scaleX")).toEqual([1.25, 1]);
	});

	test("向左平移:全程放大,位置由正到負,位移不超過放大多出的邊", () => {
		const keyframes = buildKenBurnsKeyframes({
			params: {},
			durationSeconds: 6,
			kind: "pan-left",
			zoom: 0.1,
			canvas,
		});
		expect(path(keyframes, "transform.scaleX")).toEqual([1.1, 1.1]);
		const [from, to] = path(keyframes, "transform.positionX");
		expect(from).toBeCloseTo(96);
		expect(to).toBeCloseTo(-96);
		// 放大 10% 多出 192px,兩側各 96px
		expect(Math.abs(from!)).toBeLessThanOrEqual((1920 * 0.1) / 2 + 1e-9);
	});

	test("平移以目前位置為中心;上下用畫布高度", () => {
		const keyframes = buildKenBurnsKeyframes({
			params: { "transform.positionY": 50 },
			durationSeconds: 3,
			kind: "pan-down",
			zoom: 0.2,
			canvas,
		});
		const [from, to] = path(keyframes, "transform.positionY");
		expect(from).toBeCloseTo(50 - 108);
		expect(to).toBeCloseTo(50 + 108);
	});

	test("長度或幅度無效時不產生關鍵影格", () => {
		expect(buildKenBurnsKeyframes({ params: {}, durationSeconds: 0, kind: "zoom-in", zoom: 0.1, canvas })).toEqual([]);
		expect(buildKenBurnsKeyframes({ params: {}, durationSeconds: 5, kind: "zoom-in", zoom: 0, canvas })).toEqual([]);
	});

	test("每種動態都有關鍵影格", () => {
		for (const kind of KEN_BURNS_KINDS) {
			expect(
				buildKenBurnsKeyframes({ params: {}, durationSeconds: 5, kind, zoom: 0.1, canvas }).length,
			).toBeGreaterThan(0);
		}
	});
});

describe("pickKenBurnsKinds", () => {
	test("相鄰不重複、同種子可重現", () => {
		const a = pickKenBurnsKinds({ count: 30, seed: 7 });
		const b = pickKenBurnsKinds({ count: 30, seed: 7 });
		expect(a).toEqual(b);
		for (let i = 1; i < a.length; i++) expect(a[i]).not.toBe(a[i - 1]);
	});
	test("數量為 0", () => {
		expect(pickKenBurnsKinds({ count: 0, seed: 1 })).toEqual([]);
	});
});
