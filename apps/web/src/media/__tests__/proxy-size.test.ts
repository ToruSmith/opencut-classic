import { describe, expect, test } from "bun:test";
import { computeProxySize } from "../proxy";

describe("computeProxySize", () => {
	test("4K 橫式縮到長邊 1280", () => {
		expect(computeProxySize({ width: 3840, height: 2160 })).toEqual({
			width: 1280,
			height: 720,
		});
	});

	test("直式影片以高度為長邊", () => {
		expect(computeProxySize({ width: 2160, height: 3840 })).toEqual({
			width: 720,
			height: 1280,
		});
	});

	test("小影片不放大,奇數尺寸補成偶數", () => {
		expect(computeProxySize({ width: 641, height: 359 })).toEqual({
			width: 642,
			height: 360,
		});
	});

	test("尺寸不合法回傳 null", () => {
		expect(computeProxySize({ width: 0, height: 100 })).toBeNull();
		expect(computeProxySize({ width: Number.NaN, height: 100 })).toBeNull();
	});
});
