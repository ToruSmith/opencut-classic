import { describe, expect, test } from "bun:test";
import {
	audioFadeGain,
	getAudioFades,
	hasAudioFade,
	splitAudioFadeParams,
} from "../audio-fade";

describe("getAudioFades", () => {
	test("沒設定或不合法的值視為 0", () => {
		expect(getAudioFades({ params: {}, durationSeconds: 10 })).toEqual({
			fadeIn: 0,
			fadeOut: 0,
		});
		expect(
			getAudioFades({
				params: { audioFadeIn: -1, audioFadeOut: Number.NaN },
				durationSeconds: 10,
			}),
		).toEqual({ fadeIn: 0, fadeOut: 0 });
	});

	test("加起來超過片段長度時按比例縮短", () => {
		const fades = getAudioFades({
			params: { audioFadeIn: 3, audioFadeOut: 1 },
			durationSeconds: 2,
		});
		expect(fades.fadeIn).toBeCloseTo(1.5);
		expect(fades.fadeOut).toBeCloseTo(0.5);
	});
});

describe("audioFadeGain", () => {
	const params = { audioFadeIn: 2, audioFadeOut: 1 };

	test("淡入從 0 開始,結束時回到 1", () => {
		expect(audioFadeGain({ params, durationSeconds: 10, localTime: 0 })).toBe(0);
		expect(audioFadeGain({ params, durationSeconds: 10, localTime: 2 })).toBe(1);
		expect(audioFadeGain({ params, durationSeconds: 10, localTime: 5 })).toBe(1);
	});

	test("等功率:中點約 0.707", () => {
		expect(audioFadeGain({ params, durationSeconds: 10, localTime: 1 })).toBeCloseTo(
			Math.SQRT1_2,
		);
	});

	test("淡出在片段結尾歸零", () => {
		expect(audioFadeGain({ params, durationSeconds: 10, localTime: 10 })).toBe(0);
		expect(audioFadeGain({ params, durationSeconds: 10, localTime: 9.5 })).toBeCloseTo(
			Math.SQRT1_2,
		);
	});

	test("沒有淡化時一律是 1", () => {
		expect(audioFadeGain({ params: {}, durationSeconds: 10, localTime: 0 })).toBe(1);
	});
});

describe("hasAudioFade / splitAudioFadeParams", () => {
	test("hasAudioFade", () => {
		expect(hasAudioFade({ params: {} })).toBe(false);
		expect(hasAudioFade({ params: { audioFadeOut: 0.5 } })).toBe(true);
	});

	test("分割:左半留淡入、右半留淡出,其他參數保留", () => {
		const { left, right } = splitAudioFadeParams({
			params: { volume: -3, audioFadeIn: 1, audioFadeOut: 2 },
		});
		expect(left).toEqual({ volume: -3, audioFadeIn: 1 });
		expect(right).toEqual({ volume: -3, audioFadeOut: 2 });
	});
});
