import { describe, expect, test } from "bun:test";
import {
	buildLutTexture,
	isStoredLut,
	LutParseError,
	MAX_STORED_LUT_SIZE,
	parseCubeLut,
	sampleLut,
	storedLutId,
	toStoredLut,
} from "../cube";

/** 產生 .cube 文字;fn 把 0..1 的輸入對應到輸出 */
function makeCube({
	size,
	fn,
	header = "",
}: {
	size: number;
	fn: (r: number, g: number, b: number) => [number, number, number];
	header?: string;
}): string {
	const lines = [`# test`, `TITLE "測試"`, `LUT_3D_SIZE ${size}`, header];
	for (let b = 0; b < size; b++) {
		for (let g = 0; g < size; g++) {
			for (let r = 0; r < size; r++) {
				const out = fn(r / (size - 1), g / (size - 1), b / (size - 1));
				lines.push(out.map((v) => v.toFixed(6)).join(" "));
			}
		}
	}
	return lines.join("\r\n");
}

const identity = (r: number, g: number, b: number): [number, number, number] => [r, g, b];
const invert = (r: number, g: number, b: number): [number, number, number] => [1 - r, 1 - g, 1 - b];

describe("parseCubeLut", () => {
	test("讀取標題、大小與資料(紅色變化最快)", () => {
		const lut = parseCubeLut({ text: makeCube({ size: 2, fn: identity }) });
		expect(lut.title).toBe("測試");
		expect(lut.size).toBe(2);
		expect(lut.data.length).toBe(24);
		// 第二筆:r=1, g=0, b=0
		expect([...lut.data.slice(3, 6)]).toEqual([1, 0, 0]);
	});

	test("拒絕 1D LUT、缺少大小、筆數不符、壞掉的資料", () => {
		expect(() => parseCubeLut({ text: "LUT_1D_SIZE 4\n0 0 0" })).toThrow(LutParseError);
		expect(() => parseCubeLut({ text: "0 0 0\n1 1 1" })).toThrow(LutParseError);
		expect(() => parseCubeLut({ text: "LUT_3D_SIZE 2\n0 0 0" })).toThrow(LutParseError);
		expect(() => parseCubeLut({ text: "LUT_3D_SIZE 2\n0 abc 0" })).toThrow(LutParseError);
		expect(() => parseCubeLut({ text: "LUT_3D_SIZE 1" })).toThrow(LutParseError);
	});

	test("略過不認得的關鍵字,支援 DOMAIN 與 LUT_3D_INPUT_RANGE", () => {
		const withVendor = makeCube({ size: 2, fn: identity, header: "LUT_IN_VIDEO_RANGE\nDOMAIN_MAX 2 2 2" });
		const lut = parseCubeLut({ text: withVendor });
		expect(lut.domainMax).toEqual([2, 2, 2]);
		const ranged = parseCubeLut({
			text: makeCube({ size: 2, fn: identity, header: "LUT_3D_INPUT_RANGE 0 4" }),
		});
		expect(ranged.domainMax).toEqual([4, 4, 4]);
	});
});

describe("sampleLut", () => {
	test("三線性內插:對恆等 LUT 任意點都回傳原值", () => {
		const lut = parseCubeLut({ text: makeCube({ size: 5, fn: identity }) });
		const out = sampleLut({ lut, rgb: [0.3, 0.71, 0.12] });
		expect(out[0]).toBeCloseTo(0.3, 5);
		expect(out[1]).toBeCloseTo(0.71, 5);
		expect(out[2]).toBeCloseTo(0.12, 5);
	});

	test("定義域外的輸入會夾在邊界", () => {
		const lut = parseCubeLut({ text: makeCube({ size: 3, fn: invert }) });
		expect(sampleLut({ lut, rgb: [2, -1, 0.5] })).toEqual([0, 1, 0.5]);
	});
});

describe("toStoredLut / buildLutTexture", () => {
	test("超過 33 會降到 33,資料長度正確,內容大致保留", () => {
		const lut = parseCubeLut({ text: makeCube({ size: 40, fn: invert }) });
		const stored = toStoredLut({ lut, name: "反相" });
		expect(stored.size).toBe(MAX_STORED_LUT_SIZE);
		expect(isStoredLut(stored)).toBe(true);
		const texture = buildLutTexture({ lut: stored });
		// 33 → 6 × 6 格,每格 33×33
		expect(texture.cols).toBe(6);
		expect(texture.rows).toBe(6);
		expect(texture.width).toBe(198);
		expect(texture.height).toBe(198);
		// 原點(r=g=b=0)反相後是白色
		expect([...texture.pixels.slice(0, 4)]).toEqual([255, 255, 255, 255]);
	});

	test("切片排法:藍色第 k 張在第 (k % cols, k / cols) 格", () => {
		const lut = parseCubeLut({ text: makeCube({ size: 5, fn: identity }) });
		const stored = toStoredLut({ lut, name: "id" });
		const texture = buildLutTexture({ lut: stored });
		expect(texture.cols).toBe(3);
		expect(texture.rows).toBe(2);
		// b = 4(最後一張)→ 第 (1, 1) 格;取它的 r=4、g=0
		const x = 1 * 5 + 4;
		const y = 1 * 5 + 0;
		const i = (y * texture.width + x) * 4;
		expect([...texture.pixels.slice(i, i + 4)]).toEqual([255, 0, 255, 255]);
	});

	test("同內容的 LUT 得到同一個 id,不同內容不同 id", () => {
		const a = toStoredLut({ lut: parseCubeLut({ text: makeCube({ size: 3, fn: identity }) }), name: "a" });
		const b = toStoredLut({ lut: parseCubeLut({ text: makeCube({ size: 3, fn: identity }) }), name: "b" });
		const c = toStoredLut({ lut: parseCubeLut({ text: makeCube({ size: 3, fn: invert }) }), name: "c" });
		expect(storedLutId({ lut: a })).toBe(storedLutId({ lut: b }));
		expect(storedLutId({ lut: a })).not.toBe(storedLutId({ lut: c }));
	});

	test("isStoredLut 拒絕格式不對的資料", () => {
		expect(isStoredLut(null)).toBe(false);
		expect(isStoredLut({ name: "x", size: 64, data: "" })).toBe(false);
		expect(isStoredLut({ name: "x", size: 3 })).toBe(false);
	});
});
