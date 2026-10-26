import { describe, expect, test } from "bun:test";
import { buildLutTexture, isStoredLut } from "../cube";
import { DEFAULT_LUT_PRESET_ID, getBuiltinLut, isBuiltinLutId, LUT_PRESETS } from "../presets";
import { getLutTexture } from "../store";

describe("內建 LUT 風格", () => {
	test("每個風格都能產生合法的 LUT,輸出在 0..1", () => {
		for (const preset of LUT_PRESETS) {
			const lut = getBuiltinLut({ id: preset.id });
			expect(lut).not.toBeNull();
			expect(isStoredLut(lut)).toBe(true);
			for (const rgb of [
				[0, 0, 0],
				[1, 1, 1],
				[0.5, 0.2, 0.9],
			] as Array<[number, number, number]>) {
				for (const value of preset.transform(rgb)) {
					expect(value).toBeGreaterThanOrEqual(0);
					expect(value).toBeLessThanOrEqual(1);
				}
			}
		}
	});

	test("id 不重複,且都以 builtin- 開頭;預設是第一個", () => {
		const ids = LUT_PRESETS.map((preset) => preset.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) expect(isBuiltinLutId({ id })).toBe(true);
		expect(DEFAULT_LUT_PRESET_ID).toBe(ids[0]!);
	});

	test("負片:貼圖原點(黑)變白", () => {
		const lut = getBuiltinLut({ id: "builtin-negative" })!;
		const texture = buildLutTexture({ lut });
		expect([...texture.pixels.slice(0, 3)]).toEqual([255, 255, 255]);
	});

	test("高對比黑白:輸出沒有彩度", () => {
		const preset = LUT_PRESETS.find((p) => p.id === "builtin-bw-contrast")!;
		const [r, g, b] = preset.transform([0.8, 0.3, 0.1]);
		expect(r).toBe(g);
		expect(g).toBe(b);
	});

	test("渲染端可以用 id 取得內建 LUT 的貼圖;未知 id 回傳 null", () => {
		expect(getLutTexture({ id: "builtin-teal-orange" })?.size).toBe(33);
		expect(getBuiltinLut({ id: "builtin-nope" })).toBeNull();
	});
});
