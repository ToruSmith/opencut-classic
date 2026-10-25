import { describe, expect, test } from "bun:test";
import {
	coolLookEffectDefinition,
	toneEffectDefinition,
	toneUniforms,
	warmLookEffectDefinition,
} from "../definitions/tone";

const KNOWN = new Set([
	"u_temperature",
	"u_tint",
	"u_shadows",
	"u_highlights",
	"u_exposure",
	"u_fade",
]);

function uniformsOf(def: typeof toneEffectDefinition, params: Record<string, unknown>) {
	return def.renderer.passes[0]!.uniforms({ effectParams: params as never, width: 1, height: 1 });
}

describe("tone effects", () => {
	test("預設(全部 0)是中性,不改變畫面", () => {
		expect(uniformsOf(toneEffectDefinition, {})).toEqual(
			toneUniforms({
				values: { temperature: 0, tint: 0, shadows: 0, highlights: 0, exposure: 0, fade: 0 },
			}),
		);
		for (const v of Object.values(uniformsOf(toneEffectDefinition, {}))) {
			expect(v).toBe(0);
		}
	});

	test("輸出的 uniform 名稱剛好是 Rust 端認得的六個,且都是有限數字", () => {
		for (const def of [toneEffectDefinition, warmLookEffectDefinition, coolLookEffectDefinition]) {
			const u = uniformsOf(def, {});
			expect(new Set(Object.keys(u))).toEqual(KNOWN);
			for (const v of Object.values(u)) expect(Number.isFinite(v as number)).toBe(true);
		}
	});

	test("暖色偏紅、冷色偏藍,強度 0 時回到中性", () => {
		expect(uniformsOf(warmLookEffectDefinition, { amount: 100 }).u_temperature).toBeGreaterThan(0);
		expect(uniformsOf(coolLookEffectDefinition, { amount: 100 }).u_temperature).toBeLessThan(0);
		for (const v of Object.values(uniformsOf(warmLookEffectDefinition, { amount: 0 }))) {
			expect(v).toBeCloseTo(0);
		}
	});
});
