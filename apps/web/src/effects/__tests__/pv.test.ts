import { describe, expect, test } from "bun:test";
import {
	duotoneEffectDefinition,
	fisheyeEffectDefinition,
	halftoneEffectDefinition,
	lightLeakEffectDefinition,
	speedLinesEffectDefinition,
	vhsEffectDefinition,
	waveEffectDefinition,
} from "../definitions/pv";
import type { EffectDefinition } from "../types";

// 要和 rust/crates/effects/src/pipeline.rs 的清單完全一致(多一個、少一個都會報錯)
const EXPECTED: Array<[EffectDefinition, string[]]> = [
	[halftoneEffectDefinition, ["u_size", "u_amount", "u_angle", "u_color"]],
	[duotoneEffectDefinition, ["u_amount", "u_saturation", "u_contrast", "u_shadow_hue", "u_highlight_hue"]],
	[vhsEffectDefinition, ["u_intensity", "u_scanlines", "u_jitter", "u_seed", "u_time"]],
	[speedLinesEffectDefinition, ["u_intensity", "u_count", "u_inner", "u_dark", "u_time", "u_seed"]],
	[waveEffectDefinition, ["u_amplitude", "u_wavelength", "u_speed", "u_angle", "u_time"]],
	[lightLeakEffectDefinition, ["u_intensity", "u_hue", "u_size", "u_speed", "u_time", "u_seed"]],
	[fisheyeEffectDefinition, ["u_strength", "u_zoom"]],
];

const uniformsOf = (definition: EffectDefinition, effectParams: Record<string, unknown>, width = 1920, time = 1.5) =>
	definition.renderer.passes[0]!.uniforms({ effectParams: effectParams as never, width, height: 1080, time });

const skips = (definition: EffectDefinition, effectParams: Record<string, unknown>) =>
	definition.renderer.skipWhen?.({ effectParams: effectParams as never }) ?? false;

/** 套用預設值後的參數 */
const defaults = (definition: EffectDefinition) =>
	Object.fromEntries(definition.params.map((param) => [param.key, (param as { default: unknown }).default]));

describe("PV 畫面效果:與 Rust 約定", () => {
	test("uniform 名稱與 Rust 完全一致", () => {
		for (const [definition, names] of EXPECTED) {
			expect(Object.keys(uniformsOf(definition, defaults(definition))).sort()).toEqual([...names].sort());
		}
	});

	test("所有 uniform 都是有限數字(參數缺漏 / 亂填也一樣)", () => {
		for (const [definition] of EXPECTED) {
			for (const params of [{}, { amount: "abc", intensity: Number.NaN, strength: Number.POSITIVE_INFINITY }]) {
				for (const value of Object.values(uniformsOf(definition, params, 0, Number.NaN))) {
					expect(Number.isFinite(value)).toBe(true);
				}
			}
		}
	});

	test("新增特效的預設值要有效果(不能一加上去就被略過)", () => {
		for (const [definition] of EXPECTED) {
			expect(skips(definition, defaults(definition))).toBe(false);
			expect(skips(definition, {})).toBe(false);
		}
	});

	test("名稱不重複、參數 key 不重複", () => {
		const types = EXPECTED.map(([definition]) => definition.type);
		expect(new Set(types).size).toBe(types.length);
		for (const [definition] of EXPECTED) {
			const keys = definition.params.map((param) => param.key);
			expect(new Set(keys).size).toBe(keys.length);
		}
	});
});

describe("PV 畫面效果:強度為 0 時略過", () => {
	test("各效果", () => {
		expect(skips(halftoneEffectDefinition, { amount: 0 })).toBe(true);
		expect(skips(duotoneEffectDefinition, { amount: 0 })).toBe(true);
		expect(skips(vhsEffectDefinition, { intensity: 0, scanlines: 0 })).toBe(true);
		expect(skips(vhsEffectDefinition, { intensity: 0, scanlines: 30 })).toBe(false);
		expect(skips(speedLinesEffectDefinition, { intensity: 0 })).toBe(true);
		expect(skips(waveEffectDefinition, { amplitude: 0 })).toBe(true);
		expect(skips(lightLeakEffectDefinition, { intensity: 0 })).toBe(true);
		expect(skips(fisheyeEffectDefinition, { strength: 0, zoom: 100 })).toBe(true);
		expect(skips(fisheyeEffectDefinition, { strength: 0, zoom: 120 })).toBe(false);
		expect(skips(fisheyeEffectDefinition, { strength: -30, zoom: 100 })).toBe(false);
	});
});

describe("PV 畫面效果:換算", () => {
	test("像素類參數依實際寬度縮放(預覽與匯出比例一致)", () => {
		const half = uniformsOf(halftoneEffectDefinition, { size: 20 }, 960);
		const full = uniformsOf(halftoneEffectDefinition, { size: 20 }, 1920);
		expect(half.u_size).toBe(10);
		expect(full.u_size).toBe(20);
		expect(uniformsOf(waveEffectDefinition, { amplitude: 40, wavelength: 400 }, 3840).u_amplitude).toBe(80);
		expect(uniformsOf(vhsEffectDefinition, { jitter: 30 }, 960).u_jitter).toBe(15);
	});

	test("數值夾在範圍內,選項換成旗標", () => {
		expect(uniformsOf(halftoneEffectDefinition, { mode: "color", angle: 200 }).u_color).toBe(1);
		expect(uniformsOf(halftoneEffectDefinition, { mode: "ink", angle: 200 }).u_angle).toBe(90);
		expect(uniformsOf(speedLinesEffectDefinition, { color: "black", count: 5000 }).u_dark).toBe(1);
		expect(uniformsOf(speedLinesEffectDefinition, { count: 5000 }).u_count).toBe(240);
		expect(uniformsOf(fisheyeEffectDefinition, { strength: -500, zoom: 999 }).u_strength).toBe(-1);
		expect(uniformsOf(fisheyeEffectDefinition, { zoom: 999 }).u_zoom).toBe(2);
		expect(uniformsOf(lightLeakEffectDefinition, { speed: -3 }).u_speed).toBe(0);
	});

	test("時間取自片段時間,負數與缺漏當 0", () => {
		expect(uniformsOf(vhsEffectDefinition, {}, 1920, 2.5).u_time).toBe(2.5);
		expect(uniformsOf(vhsEffectDefinition, {}, 1920, -3).u_time).toBe(0);
	});
});
