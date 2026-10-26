import { describe, expect, test } from "bun:test";
import {
	cameraShakeEffectDefinition,
	glitchEffectDefinition,
	mirrorEffectDefinition,
	zoomBlurEffectDefinition,
} from "../definitions/motion";

// uniform 名稱要和 rust/crates/effects/src/pipeline.rs 的清單完全一致,
// 多一個、少一個,Rust 端都會回傳錯誤,整個效果就不會顯示。
const EXPECTED_UNIFORMS: Record<string, string[]> = {
	"camera-shake": ["u_amount", "u_fill", "u_rotation", "u_seed", "u_speed", "u_time"],
	"zoom-blur": ["u_center_x", "u_center_y", "u_strength"],
	glitch: ["u_band", "u_intensity", "u_rate", "u_seed", "u_shift", "u_time"],
	mirror: ["u_flip", "u_mode"],
};

const definitions = [
	cameraShakeEffectDefinition,
	zoomBlurEffectDefinition,
	glitchEffectDefinition,
	mirrorEffectDefinition,
];

describe("震動 / 放射模糊 / 故障 / 鏡像", () => {
	for (const definition of definitions) {
		const pass = definition.renderer.passes[0]!;

		test(`${definition.type}:uniform 名稱與 Rust 一致`, () => {
			const u = pass.uniforms({ effectParams: {}, width: 1920, height: 1080, time: 1 });
			expect(Object.keys(u).sort()).toEqual(EXPECTED_UNIFORMS[pass.shader]!);
		});

		test(`${definition.type}:參數缺漏、寬度或時間異常時不會產生 NaN`, () => {
			for (const width of [1920, 0, Number.NaN]) {
				for (const time of [undefined, Number.NaN, -3, 12.5]) {
					const u = pass.uniforms({
						effectParams: { amount: "abc", seed: "x", strength: "?", band: null, mode: 7 },
						width,
						height: 1,
						time,
					});
					for (const v of Object.values(u)) {
						for (const n of Array.isArray(v) ? v : [v]) expect(Number.isFinite(n)).toBe(true);
					}
				}
			}
		});

		test(`${definition.type}:參數都有預設值且在範圍內`, () => {
			for (const param of definition.params) {
				if (param.type !== "number") continue;
				expect(param.default).toBeGreaterThanOrEqual(param.min);
				if (param.max !== undefined) expect(param.default).toBeLessThanOrEqual(param.max);
			}
		});
	}

	test("震動與故障把時間傳給 shader,負的時間當成 0", () => {
		for (const definition of [cameraShakeEffectDefinition, glitchEffectDefinition]) {
			const pass = definition.renderer.passes[0]!;
			const at = (time: number) =>
				pass.uniforms({ effectParams: {}, width: 1920, height: 1080, time }).u_time;
			expect(at(2.5)).toBe(2.5);
			expect(at(-1)).toBe(0);
		}
	});

	test("震動幅度依畫面寬度縮放", () => {
		const pass = cameraShakeEffectDefinition.renderer.passes[0]!;
		const full = pass.uniforms({ effectParams: { amount: 40 }, width: 1920, height: 1080 });
		const half = pass.uniforms({ effectParams: { amount: 40 }, width: 960, height: 540 });
		expect(full.u_amount).toBeCloseTo(40);
		expect(half.u_amount).toBeCloseTo(20);
	});

	test("鏡像模式對應與未知值的退回", () => {
		const pass = mirrorEffectDefinition.renderer.passes[0]!;
		const mode = (value: unknown) =>
			pass.uniforms({ effectParams: { mode: value } as never, width: 1, height: 1 }).u_mode;
		expect(mode("horizontal")).toBe(0);
		expect(mode("vertical")).toBe(1);
		expect(mode("quad")).toBe(2);
		expect(mode("???")).toBe(0);
	});
});
