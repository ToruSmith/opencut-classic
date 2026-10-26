import { describe, expect, test } from "bun:test";
import {
	glowEffectDefinition,
	sharpenEffectDefinition,
	splitToneEffectDefinition,
} from "../definitions/detail";

// uniform 名稱要和 rust/crates/effects/src/pipeline.rs 的清單完全一致,
// 多一個、少一個,Rust 端都會回傳錯誤,整個效果就不會顯示。
const EXPECTED_UNIFORMS: Record<string, string[]> = {
	sharpen: ["u_amount", "u_radius"],
	glow: ["u_intensity", "u_radius", "u_threshold"],
	"split-tone": [
		"u_balance",
		"u_highlight_amount",
		"u_highlight_hue",
		"u_shadow_amount",
		"u_shadow_hue",
	],
};

const definitions = [
	sharpenEffectDefinition,
	glowEffectDefinition,
	splitToneEffectDefinition,
];

describe("銳利化 / 發光 / 分離色調", () => {
	for (const definition of definitions) {
		const pass = definition.renderer.passes[0]!;

		test(`${definition.type}:uniform 名稱與 Rust 一致`, () => {
			const u = pass.uniforms({ effectParams: {}, width: 1920, height: 1080 });
			expect(Object.keys(u).sort()).toEqual(EXPECTED_UNIFORMS[pass.shader]!);
		});

		test(`${definition.type}:參數缺漏或寬度異常時不會產生 NaN`, () => {
			for (const width of [1920, 0, Number.NaN]) {
				const u = pass.uniforms({ effectParams: { amount: "abc" }, width, height: 1 });
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

	test("半徑依畫面寬度縮放(預覽與匯出看起來一致)", () => {
		const pass = glowEffectDefinition.renderer.passes[0]!;
		const full = pass.uniforms({ effectParams: { radius: 20 }, width: 1920, height: 1080 });
		const half = pass.uniforms({ effectParams: { radius: 20 }, width: 960, height: 540 });
		expect(full.u_radius).toBeCloseTo(20);
		expect(half.u_radius).toBeCloseTo(10);
	});
});
