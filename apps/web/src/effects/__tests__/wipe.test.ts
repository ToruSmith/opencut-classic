import { describe, expect, test } from "bun:test";
import { buildWipeUniforms, wipeEffectDefinition } from "../definitions/wipe";

// uniform 名稱要和 rust/crates/effects/src/pipeline.rs 的清單完全一致
const EXPECTED = ["u_angle", "u_center_x", "u_center_y", "u_mode", "u_progress", "u_softness"];

describe("擦除特效", () => {
	test("uniform 名稱與 Rust 一致", () => {
		const pass = wipeEffectDefinition.renderer.passes[0]!;
		const u = pass.uniforms({ effectParams: { progress: 50 }, width: 1920, height: 1080 });
		expect(Object.keys(u).sort()).toEqual(EXPECTED);
	});

	test("進度 0..100 換成 0..1,超出範圍會夾住", () => {
		const at = (progress: unknown) => buildWipeUniforms({ effectParams: { progress } }).u_progress;
		expect(at(0)).toBe(0);
		expect(at(50)).toBe(0.5);
		expect(at(100)).toBe(1);
		expect(at(-20)).toBe(0);
		expect(at(250)).toBe(1);
		expect(at("abc")).toBe(0);
		expect(at(Number.NaN)).toBe(0);
	});

	test("模式編號:線性 0、光圈 1、時鐘 2,反向 +3;未知模式當線性", () => {
		const mode = (mode: unknown, reverse = false) =>
			buildWipeUniforms({ effectParams: { mode, reverse } }).u_mode;
		expect(mode("linear")).toBe(0);
		expect(mode("iris")).toBe(1);
		expect(mode("clock")).toBe(2);
		expect(mode("linear", true)).toBe(3);
		expect(mode("clock", true)).toBe(5);
		expect(mode("???")).toBe(0);
	});

	test("參數缺漏或異常時不會產生 NaN", () => {
		for (const effectParams of [{}, { softness: "x", angle: null, centerX: Number.NaN }, { centerY: 999 }]) {
			for (const v of Object.values(buildWipeUniforms({ effectParams }))) {
				expect(Number.isFinite(v)).toBe(true);
			}
		}
	});

	test("進度 0 時不產生 pass(轉場以外的時間不空轉),大於 0 才有", () => {
		const build = wipeEffectDefinition.renderer.buildPasses!;
		expect(build({ effectParams: { progress: 0 }, width: 1, height: 1 })).toEqual([]);
		expect(build({ effectParams: {}, width: 1, height: 1 })).toEqual([]);
		const passes = build({ effectParams: { progress: 1 }, width: 1, height: 1 });
		expect(passes.length).toBe(1);
		expect(passes[0]!.shader).toBe("wipe");
	});

	test("參數預設值都在範圍內", () => {
		for (const param of wipeEffectDefinition.params) {
			if (param.type !== "number") continue;
			expect(param.default).toBeGreaterThanOrEqual(param.min);
			if (param.max !== undefined) expect(param.default).toBeLessThanOrEqual(param.max);
		}
	});
});

describe("擦除特效:線性範圍", () => {
	test("線性模式把 rangeStart / rangeEnd 放進 u_center_x / u_center_y", () => {
		const u = buildWipeUniforms({
			effectParams: { mode: "linear", rangeStart: 20, rangeEnd: 70, centerX: 10, centerY: 90 },
		});
		expect(u.u_center_x).toBeCloseTo(0.2);
		expect(u.u_center_y).toBeCloseTo(0.7);
	});

	test("線性模式沒給範圍時用 0 / 100(舊的擦除不受影響)", () => {
		const u = buildWipeUniforms({ effectParams: { mode: "linear" } });
		expect(u.u_center_x).toBe(0);
		expect(u.u_center_y).toBe(1);
	});

	test("光圈與時鐘仍用 centerX / centerY", () => {
		const u = buildWipeUniforms({
			effectParams: { mode: "iris", rangeStart: 20, rangeEnd: 70, centerX: 30, centerY: 40 },
		});
		expect(u.u_center_x).toBeCloseTo(0.3);
		expect(u.u_center_y).toBeCloseTo(0.4);
	});
});
