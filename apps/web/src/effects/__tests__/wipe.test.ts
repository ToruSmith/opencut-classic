import { describe, expect, test } from "bun:test";
import { WIPE_KINDS, buildWipeUniforms, wipeEffectDefinition } from "../definitions/wipe";

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

	test("模式編號:依 WIPE_KINDS 的順序,反向 +16;未知模式當線性", () => {
		const mode = (mode: unknown, reverse = false) =>
			buildWipeUniforms({ effectParams: { mode, reverse } }).u_mode;
		expect(mode("linear")).toBe(0);
		expect(mode("iris")).toBe(1);
		expect(mode("clock")).toBe(2);
		expect(mode("blinds")).toBe(3);
		expect(mode("checker")).toBe(4);
		expect(mode("diamond")).toBe(5);
		expect(mode("dissolve")).toBe(6);
		expect(mode("blocks")).toBe(7);
		expect(mode("split")).toBe(8);
		expect(mode("linear", true)).toBe(16);
		expect(mode("clock", true)).toBe(18);
		expect(mode("split", true)).toBe(24);
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

describe("擦除特效:圖樣模式", () => {
	test("百葉窗 / 棋盤 / 溶解 / 方塊把數量與種子放進 u_center_x / u_center_y", () => {
		for (const mode of ["blinds", "checker", "dissolve", "blocks"]) {
			const u = buildWipeUniforms({ effectParams: { mode, count: 12, seed: 5 } });
			expect(u.u_center_x).toBe(12);
			expect(u.u_center_y).toBe(5);
		}
	});

	test("數量夾在 2..40 並取整數,缺漏時預設 8", () => {
		const count = (value: unknown) =>
			buildWipeUniforms({ effectParams: { mode: "blinds", count: value } }).u_center_x;
		expect(count(undefined)).toBe(8);
		expect(count(1)).toBe(2);
		expect(count(99)).toBe(40);
		expect(count(7.6)).toBe(8);
	});

	test("菱形用中心點,對開沿用線性的範圍(shader 不讀)", () => {
		const diamond = buildWipeUniforms({ effectParams: { mode: "diamond", centerX: 30, centerY: 60 } });
		expect(diamond.u_center_x).toBeCloseTo(0.3);
		expect(diamond.u_center_y).toBeCloseTo(0.6);
		const split = buildWipeUniforms({ effectParams: { mode: "split" } });
		expect(split.u_center_x).toBe(0);
		expect(split.u_center_y).toBe(1);
	});

	test("每個模式的 uniform 名稱都和 Rust 一致", () => {
		for (const mode of WIPE_KINDS) {
			const u = buildWipeUniforms({ effectParams: { mode, progress: 50 } });
			expect(Object.keys(u).sort()).toEqual(EXPECTED);
		}
	});

	test("select 選項涵蓋所有模式", () => {
		const modeParam = wipeEffectDefinition.params.find((param) => param.key === "mode");
		const values = (modeParam as { options: Array<{ value: string }> }).options.map((o) => o.value);
		expect(values).toEqual([...WIPE_KINDS]);
	});
});
