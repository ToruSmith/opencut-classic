import { describe, expect, test } from "bun:test";
import { chromaKeyEffectDefinition, parseKeyColor } from "../definitions/chroma-key";

describe("parseKeyColor", () => {
	test("綠幕綠", () => {
		expect(parseKeyColor({ value: "#00ff00" })).toEqual([0, 1, 0]);
	});
	test("藍幕", () => {
		const [r, g, b] = parseKeyColor({ value: "#0000ff" });
		expect([r, g, b]).toEqual([0, 0, 1]);
		expect(parseKeyColor({ value: "#f80" })[1]).toBeCloseTo(0x88 / 255);
	});
	test("無法解析或不是字串時退回綠幕綠", () => {
		expect(parseKeyColor({ value: "not-a-color" })).toEqual([0, 1, 0]);
		expect(parseKeyColor({ value: undefined })).toEqual([0, 1, 0]);
	});
});

describe("chroma-key uniforms", () => {
	const pass = chromaKeyEffectDefinition.renderer.passes[0]!;
	test("預設參數對應到 shader 的實用範圍,key 是長度 3 的向量", () => {
		const u = pass.uniforms({
			effectParams: { color: "#00ff00", similarity: 30, smoothness: 10, spill: 50 },
			width: 1920,
			height: 1080,
		});
		expect(u.u_key).toEqual([0, 1, 0]);
		expect(u.u_similarity).toBeCloseTo(0.15);
		expect(u.u_smoothness).toBeCloseTo(0.05);
		expect(u.u_spill).toBeCloseTo(0.5);
	});
	test("參數缺漏時使用預設值,不會產生 NaN", () => {
		const u = pass.uniforms({ effectParams: {}, width: 1, height: 1 });
		for (const v of Object.values(u)) {
			for (const n of Array.isArray(v) ? v : [v]) expect(Number.isFinite(n)).toBe(true);
		}
	});
});
