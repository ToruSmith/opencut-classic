import { describe, expect, test } from "bun:test";
import { lutEffectDefinition } from "../definitions/lut";
import { parseCubeLut, storedLutId, toStoredLut } from "@/lut/cube";
import { registerLuts } from "@/lut/store";

// uniform 名稱要和 rust/crates/effects/src/pipeline.rs 的 LUT 清單完全一致
const EXPECTED_UNIFORMS = ["u_cols", "u_intensity", "u_rows", "u_size"];

function registerIdentity(): string {
	const lines = ["LUT_3D_SIZE 2"];
	for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) lines.push(`${r} ${g} ${b}`);
	const stored = toStoredLut({ lut: parseCubeLut({ text: lines.join("\n") }), name: "id" });
	const id = storedLutId({ lut: stored });
	registerLuts({ luts: { [id]: stored } });
	return id;
}

describe("LUT 調色", () => {
	const build = (effectParams: Record<string, unknown>) =>
		lutEffectDefinition.renderer.buildPasses!({
			effectParams: effectParams as never,
			width: 1920,
			height: 1080,
		});

	test("還沒選 LUT、或 LUT 不存在時不產生 pass", () => {
		expect(build({ lut: "", intensity: 100 })).toEqual([]);
		expect(build({ lut: "nope", intensity: 100 })).toEqual([]);
	});

	test("有 LUT 時產生一個帶 textureId 的 pass,uniform 名稱與 Rust 一致", () => {
		const id = registerIdentity();
		const passes = build({ lut: id, intensity: 50 });
		expect(passes).toHaveLength(1);
		expect(passes[0]!.shader).toBe("lut");
		expect(passes[0]!.textureId).toBe(`lut:${id}`);
		expect(Object.keys(passes[0]!.uniforms).sort()).toEqual(EXPECTED_UNIFORMS);
		expect(passes[0]!.uniforms.u_size).toBe(2);
		expect(passes[0]!.uniforms.u_intensity).toBeCloseTo(0.5);
	});

	test("樣板的 uniform 名稱也一致,強度異常時不會是 NaN", () => {
		const u = lutEffectDefinition.renderer.passes[0]!.uniforms({
			effectParams: { intensity: "abc" } as never,
			width: 1,
			height: 1,
		});
		expect(Object.keys(u).sort()).toEqual(EXPECTED_UNIFORMS);
		for (const value of Object.values(u)) expect(Number.isFinite(value as number)).toBe(true);
	});

	test("LUT 參數隱藏(由選擇器設定)", () => {
		expect(lutEffectDefinition.params.find((p) => p.key === "lut")?.hidden).toBe(true);
	});
});
