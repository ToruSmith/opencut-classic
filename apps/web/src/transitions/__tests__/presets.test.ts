import { describe, expect, test } from "bun:test";
import {
	buildTransitionKeyframes,
	type TransitionTarget,
} from "../presets";

const canvas = { width: 1920, height: 1080 };

function target(partial: Partial<TransitionTarget> = {}): TransitionTarget {
	return {
		type: "video",
		params: {},
		durationSeconds: 10,
		hasAudio: true,
		...partial,
	};
}

function at(
	keyframes: ReturnType<typeof buildTransitionKeyframes>,
	path: string,
) {
	return keyframes
		.filter((k) => k.propertyPath === path)
		.map((k) => [k.seconds, k.value] as const)
		.sort((a, b) => a[0] - b[0]);
}

describe("fade", () => {
	test("淡入:從 0 到元素「目前」的不透明度與音量,而不是預設值", () => {
		const k = buildTransitionKeyframes({
			target: target({ params: { opacity: 0.5, volume: -6 } }),
			motion: "fade",
			side: "in",
			seconds: 1,
			canvas,
		});
		expect(at(k, "opacity")).toEqual([[0, 0], [1, 0.5]]);
		expect(at(k, "volume")).toEqual([[0, -60], [1, -6]]);
	});

	test("淡出:從目前值降到 0,結尾剛好是片段結束", () => {
		const k = buildTransitionKeyframes({
			target: target({ params: { opacity: 0.8 } }),
			motion: "fade",
			side: "out",
			seconds: 2,
			canvas,
		});
		expect(at(k, "opacity")).toEqual([[8, 0.8], [10, 0]]);
		expect(at(k, "volume")).toEqual([[8, 0], [10, -60]]);
	});

	test("影片原始音訊關閉時不產生音量關鍵影格", () => {
		const k = buildTransitionKeyframes({
			target: target({ hasAudio: false }),
			motion: "fade",
			side: "in",
			seconds: 1,
			canvas,
		});
		expect(at(k, "volume")).toEqual([]);
		expect(at(k, "opacity").length).toBe(2);
	});

	test("純音訊片段只淡音量;文字片段只淡不透明度", () => {
		const audio = buildTransitionKeyframes({
			target: target({ type: "audio" }),
			motion: "fade",
			side: "in",
			seconds: 1,
			canvas,
		});
		expect(audio.every((x) => x.propertyPath === "volume")).toBe(true);
		const text = buildTransitionKeyframes({
			target: target({ type: "text" }),
			motion: "fade",
			side: "in",
			seconds: 1,
			canvas,
		});
		expect(text.every((x) => x.propertyPath === "opacity")).toBe(true);
	});

	test("長度被限制在片段的一半,避免進場與出場重疊", () => {
		const k = buildTransitionKeyframes({
			target: target({ durationSeconds: 1 }),
			motion: "fade",
			side: "in",
			seconds: 2,
			canvas,
		});
		expect(at(k, "opacity")).toEqual([[0, 0], [0.5, 1]]);
	});

	test("片段長度為 0 時不產生任何關鍵影格", () => {
		expect(
			buildTransitionKeyframes({
				target: target({ durationSeconds: 0 }),
				motion: "fade",
				side: "in",
				seconds: 1,
				canvas,
			}),
		).toEqual([]);
	});
});

describe("slide", () => {
	test("從左滑入:起點在畫面左側一個畫布寬,終點是目前位置", () => {
		const k = buildTransitionKeyframes({
			target: target({ params: { "transform.positionX": 100 } }),
			motion: "slide-left",
			side: "in",
			seconds: 0.5,
			canvas,
		});
		expect(at(k, "transform.positionX")).toEqual([[0, 100 - 1920], [0.5, 100]]);
	});

	test("向下滑出:終點在畫面下方", () => {
		const k = buildTransitionKeyframes({
			target: target(),
			motion: "slide-down",
			side: "out",
			seconds: 1,
			canvas,
		});
		expect(at(k, "transform.positionY")).toEqual([[9, 0], [10, 1080]]);
	});

	test("音訊片段不支援滑動", () => {
		expect(
			buildTransitionKeyframes({
				target: target({ type: "audio" }),
				motion: "slide-left",
				side: "in",
				seconds: 1,
				canvas,
			}),
		).toEqual([]);
	});
});

describe("zoom / spin / pop", () => {
	test("縮放進場以目前縮放為基準", () => {
		const k = buildTransitionKeyframes({
			target: target({ params: { "transform.scaleX": 2, "transform.scaleY": 2 } }),
			motion: "zoom",
			side: "in",
			seconds: 1,
			canvas,
		});
		const x = at(k, "transform.scaleX");
		expect(x[0]?.[1]).toBeCloseTo(1.2);
		expect(x[1]).toEqual([1, 2]);
	});

	test("彈出:中間會超過基準值再回來,最後停在基準值", () => {
		const k = buildTransitionKeyframes({
			target: target(),
			motion: "pop",
			side: "in",
			seconds: 1,
			canvas,
		});
		const x = at(k, "transform.scaleX");
		expect(x.length).toBe(3);
		expect(x[0]?.[1]).toBe(0);
		expect(x[1]?.[1]).toBeGreaterThan(1);
		expect(x[2]).toEqual([1, 1]);
	});

	test("彈出的出場是進場的鏡像:最後落在 0", () => {
		const k = buildTransitionKeyframes({
			target: target(),
			motion: "pop",
			side: "out",
			seconds: 1,
			canvas,
		});
		const x = at(k, "transform.scaleX");
		expect(x[0]).toEqual([9, 1]);
		expect(x[2]).toEqual([10, 0]);
	});

	test("旋轉進場從 -90 度轉回基準角度", () => {
		const k = buildTransitionKeyframes({
			target: target({ params: { "transform.rotate": 10 } }),
			motion: "spin",
			side: "in",
			seconds: 1,
			canvas,
		});
		expect(at(k, "transform.rotate")).toEqual([[0, -80], [1, 10]]);
	});
});

import { pickRandomMotions, RANDOM_MOTION_POOL } from "../presets";

describe("pickRandomMotions", () => {
	test("相同種子結果相同、數量正確、都在候選內", () => {
		const a = pickRandomMotions({ count: 30, seed: 7 });
		expect(a).toEqual(pickRandomMotions({ count: 30, seed: 7 }));
		expect(a).toHaveLength(30);
		for (const motion of a) expect(RANDOM_MOTION_POOL).toContain(motion);
	});
	test("相鄰不重複;不同種子結果不同", () => {
		const a = pickRandomMotions({ count: 200, seed: 1 });
		for (let i = 1; i < a.length; i++) expect(a[i]).not.toBe(a[i - 1]);
		expect(pickRandomMotions({ count: 30, seed: 2 })).not.toEqual(pickRandomMotions({ count: 30, seed: 3 }));
	});
	test("數量為 0 或候選只有一個", () => {
		expect(pickRandomMotions({ count: 0, seed: 1 })).toEqual([]);
		expect(pickRandomMotions({ count: 3, seed: 1, pool: ["zoom"] })).toEqual(["zoom", "zoom", "zoom"]);
	});
});
