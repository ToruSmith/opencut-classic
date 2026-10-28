import { describe, expect, test } from "bun:test";
import { buildCutMotionUniforms, cutMotionEffectDefinition, isCutMotionIdentity } from "../definitions/cut-motion";
import { colorAdjustEffectDefinition, grayscaleEffectDefinition } from "../definitions/color";
import { glitchEffectDefinition, zoomBlurEffectDefinition, cameraShakeEffectDefinition } from "../definitions/motion";
import { chromaticAberrationEffectDefinition } from "../definitions/stylize";

// 要和 rust/crates/effects/src/pipeline.rs 的清單完全一致
const EXPECTED = ["u_blur", "u_blur_angle", "u_offset_x", "u_offset_y", "u_rotation", "u_scale"];

describe("轉場運動特效", () => {
	test("uniform 名稱與 Rust 一致", () => {
		const pass = cutMotionEffectDefinition.renderer.passes[0]!;
		expect(Object.keys(pass.uniforms({ effectParams: {}, width: 1920, height: 1080 })).sort()).toEqual(EXPECTED);
	});

	test("百分比換成實際像素:預覽與匯出尺寸不同時比例一樣", () => {
		const small = buildCutMotionUniforms({ effectParams: { offsetX: 50, offsetY: -10, blur: 10 }, width: 960, height: 540 });
		const full = buildCutMotionUniforms({ effectParams: { offsetX: 50, offsetY: -10, blur: 10 }, width: 1920, height: 1080 });
		expect(small.u_offset_x).toBe(480);
		expect(full.u_offset_x).toBe(960);
		expect(full.u_offset_y).toBe(-108);
		expect(full.u_blur).toBe(192);
	});

	test("預設值是原圖:不送 pass;有任何變化才送", () => {
		const passes = (effectParams: Record<string, unknown>) =>
			cutMotionEffectDefinition.renderer.buildPasses!({ effectParams: effectParams as never, width: 1920, height: 1080 });
		expect(passes({ offsetX: 0, offsetY: 0, scale: 100, rotation: 0, blur: 0 })).toEqual([]);
		expect(passes({ scale: 101 }).length).toBe(1);
		expect(passes({ blur: 5 }).length).toBe(1);
		expect(isCutMotionIdentity({ uniforms: buildCutMotionUniforms({ effectParams: { scale: "abc" }, width: 0, height: 0 }) })).toBe(true);
	});
});

describe("強度為 0 時不送 pass(skipWhen)", () => {
	test("放射模糊 / 故障 / 色差 / 震動 / 色彩調整", () => {
		const skip = (definition: typeof zoomBlurEffectDefinition, effectParams: Record<string, unknown>) =>
			definition.renderer.skipWhen?.({ effectParams: effectParams as never }) ?? false;
		expect(skip(zoomBlurEffectDefinition, { strength: 0 })).toBe(true);
		expect(skip(zoomBlurEffectDefinition, { strength: 30 })).toBe(false);
		expect(skip(glitchEffectDefinition, { intensity: 0 })).toBe(true);
		expect(skip(glitchEffectDefinition, { intensity: 10 })).toBe(false);
		expect(skip(chromaticAberrationEffectDefinition, { amount: 0 })).toBe(true);
		expect(skip(cameraShakeEffectDefinition, { amount: 0, rotation: 0 })).toBe(true);
		expect(skip(cameraShakeEffectDefinition, { amount: 0, rotation: 2 })).toBe(false);
		expect(skip(colorAdjustEffectDefinition, { brightness: 0, contrast: 100, saturation: 100, hue: 0 })).toBe(true);
		expect(skip(colorAdjustEffectDefinition, { brightness: 40, contrast: 100, saturation: 100, hue: 0 })).toBe(false);
		expect(skip(grayscaleEffectDefinition, { amount: 0 })).toBe(true);
		expect(skip(grayscaleEffectDefinition, { amount: 100 })).toBe(false);
		// 預設值(新加特效時)要照常有效果
		expect(skip(zoomBlurEffectDefinition, {})).toBe(false);
	});
});
