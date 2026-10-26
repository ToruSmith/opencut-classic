import { describe, expect, test } from "bun:test";
import {
	chromaticAberrationEffectDefinition,
	filmGrainEffectDefinition,
	pixelateEffectDefinition,
	posterizeEffectDefinition,
} from "../definitions/stylize";

// uniform 名稱要和 rust/crates/effects/src/pipeline.rs 的清單完全一致,
// 多一個、少一個,Rust 端都會回傳錯誤,整個效果就不會顯示。
const EXPECTED_UNIFORMS: Record<string, string[]> = {
	pixelate: ["u_block"],
	"chromatic-aberration": ["u_amount", "u_angle", "u_radial"],
	posterize: ["u_levels"],
	"film-grain": ["u_amount", "u_color", "u_seed", "u_shadow_protect", "u_size"],
};

const definitions = [
	pixelateEffectDefinition,
	chromaticAberrationEffectDefinition,
	posterizeEffectDefinition,
	filmGrainEffectDefinition,
];

describe("馬賽克 / 色差 / 色調分離 / 底片顆粒", () => {
	for (const definition of definitions) {
		const pass = definition.renderer.passes[0]!;

		test(`${definition.type}:uniform 名稱與 Rust 一致`, () => {
			const u = pass.uniforms({ effectParams: {}, width: 1920, height: 1080 });
			expect(Object.keys(u).sort()).toEqual(EXPECTED_UNIFORMS[pass.shader]!);
		});

		test(`${definition.type}:參數缺漏或寬度異常時不會產生 NaN`, () => {
			for (const width of [1920, 0, Number.NaN]) {
				const u = pass.uniforms({
					effectParams: { size: "abc", amount: "abc", levels: "abc", angle: "abc" },
					width,
					height: 1,
				});
				for (const v of Object.values(u)) {
					for (const n of Array.isArray(v) ? v : [v]) expect(Number.isFinite(n)).toBe(true);
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

	test("馬賽克方塊依畫面寬度縮放,且至少 1 像素", () => {
		const pass = pixelateEffectDefinition.renderer.passes[0]!;
		const full = pass.uniforms({ effectParams: { size: 40 }, width: 1920, height: 1080 });
		const half = pass.uniforms({ effectParams: { size: 40 }, width: 960, height: 540 });
		const tiny = pass.uniforms({ effectParams: { size: 2 }, width: 320, height: 180 });
		expect(full.u_block).toBeCloseTo(40);
		expect(half.u_block).toBeCloseTo(20);
		expect(tiny.u_block).toBe(1);
	});

	test("色差的方式對應到 u_radial", () => {
		const pass = chromaticAberrationEffectDefinition.renderer.passes[0]!;
		const radial = pass.uniforms({ effectParams: { mode: "radial" }, width: 1920, height: 1080 });
		const linear = pass.uniforms({ effectParams: { mode: "linear" }, width: 1920, height: 1080 });
		expect(radial.u_radial).toBe(1);
		expect(linear.u_radial).toBe(0);
	});

	test("色調分離的色階數會取整並限制在 2..32", () => {
		const pass = posterizeEffectDefinition.renderer.passes[0]!;
		const at = (levels: number) =>
			pass.uniforms({ effectParams: { levels }, width: 1920, height: 1080 }).u_levels;
		expect(at(1)).toBe(2);
		expect(at(4.6)).toBe(5);
		expect(at(99)).toBe(32);
	});

	test("底片顆粒的種子隨時間改變、同一時間固定,沒有時間時為 0", () => {
		const pass = filmGrainEffectDefinition.renderer.passes[0]!;
		const seedAt = (time?: number) =>
			pass.uniforms({ effectParams: {}, width: 1920, height: 1080, time }).u_seed;
		expect(seedAt()).toBe(0);
		expect(seedAt(Number.NaN)).toBe(0);
		expect(seedAt(1)).toBe(24);
		expect(seedAt(1)).toBe(seedAt(1.01));
		expect(seedAt(2)).not.toBe(seedAt(1));
		expect(Number.isInteger(seedAt(12345.678))).toBe(true);
	});
});
