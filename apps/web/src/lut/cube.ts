/**
 * .cube(Adobe / Resolve 3D LUT)解析與打包。純函式,不依賴 DOM / wasm,有測試。
 *
 * 專案裡存的是「重新取樣到 0..1 定義域、最多 33³、每通道 8 位元」的 RGB,
 * 33³ × 3 位元組約 105 KB(base64 約 140 KB),放在專案 JSON 裡備份與版本紀錄都會一起帶著。
 * 調色常用的 LUT 是 33 或 65;65 降到 33 以三線性內插取樣,肉眼看不出差別。
 */

export const MAX_STORED_LUT_SIZE = 33;
const MIN_LUT_SIZE = 2;
const MAX_PARSED_LUT_SIZE = 256;

export interface ParsedLut {
	title: string | null;
	size: number;
	domainMin: [number, number, number];
	domainMax: [number, number, number];
	/** 長度 size³ × 3,紅色變化最快,其次綠色,最後藍色(.cube 的順序) */
	data: Float32Array;
}

export interface StoredLut {
	name: string;
	size: number;
	/** base64 編碼的 RGB8,順序同 ParsedLut.data */
	data: string;
}

export class LutParseError extends Error {}

export function parseCubeLut({ text }: { text: string }): ParsedLut {
	let title: string | null = null;
	let size = 0;
	let domainMin: [number, number, number] = [0, 0, 0];
	let domainMax: [number, number, number] = [1, 1, 1];
	const values: number[] = [];

	const lines = text.split(/\r?\n/);
	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (line === "" || line.startsWith("#")) continue;

		const [keyword, ...rest] = line.split(/\s+/);
		const upper = keyword.toUpperCase();
		if (upper === "TITLE") {
			title = line.slice(keyword.length).trim().replace(/^"(.*)"$/, "$1") || null;
			continue;
		}
		if (upper === "LUT_1D_SIZE") {
			throw new LutParseError("這是 1D LUT,目前只支援 3D LUT(LUT_3D_SIZE)");
		}
		if (upper === "LUT_3D_SIZE") {
			size = Number.parseInt(rest[0] ?? "", 10);
			if (!Number.isInteger(size) || size < MIN_LUT_SIZE || size > MAX_PARSED_LUT_SIZE) {
				throw new LutParseError(`LUT 大小不合理:${rest[0] ?? "(空白)"}`);
			}
			continue;
		}
		if (upper === "DOMAIN_MIN" || upper === "DOMAIN_MAX") {
			const triple = parseTriple({ parts: rest });
			if (!triple) throw new LutParseError(`${upper} 格式錯誤`);
			if (upper === "DOMAIN_MIN") domainMin = triple;
			else domainMax = triple;
			continue;
		}
		if (upper === "LUT_3D_INPUT_RANGE") {
			// Resolve 的寫法:輸入範圍的最小與最大值,三個通道相同
			const low = Number(rest[0]);
			const high = Number(rest[1]);
			if (!Number.isFinite(low) || !Number.isFinite(high)) {
				throw new LutParseError("LUT_3D_INPUT_RANGE 格式錯誤");
			}
			domainMin = [low, low, low];
			domainMax = [high, high, high];
			continue;
		}
		if (/^[A-Z][A-Z0-9_]*$/.test(upper)) {
			// 其他關鍵字(廠商擴充)略過
			continue;
		}

		const triple = parseTriple({ parts: [keyword, ...rest] });
		if (!triple) throw new LutParseError(`無法讀取這一行:${line.slice(0, 40)}`);
		values.push(triple[0], triple[1], triple[2]);
	}

	if (size === 0) throw new LutParseError("找不到 LUT_3D_SIZE,這可能不是 .cube 檔");
	const expected = size * size * size;
	if (values.length !== expected * 3) {
		throw new LutParseError(
			`資料筆數不符:應有 ${expected} 筆,實際 ${values.length / 3} 筆`,
		);
	}
	for (let axis = 0; axis < 3; axis++) {
		if (!(domainMax[axis] > domainMin[axis])) {
			throw new LutParseError("DOMAIN_MIN 必須小於 DOMAIN_MAX");
		}
	}

	return { title, size, domainMin, domainMax, data: Float32Array.from(values) };
}

function parseTriple({ parts }: { parts: string[] }): [number, number, number] | null {
	if (parts.length < 3) return null;
	const numbers = parts.slice(0, 3).map(Number);
	if (numbers.some((value) => !Number.isFinite(value))) return null;
	return [numbers[0], numbers[1], numbers[2]];
}

/** 在 LUT 自己的定義域上做三線性內插。輸入是 0..1 的顏色。 */
export function sampleLut({
	lut,
	rgb,
}: {
	lut: ParsedLut;
	rgb: [number, number, number];
}): [number, number, number] {
	const n = lut.size;
	const position: number[] = [];
	const lower: number[] = [];
	const upper: number[] = [];
	for (let axis = 0; axis < 3; axis++) {
		const normalized =
			(rgb[axis] - lut.domainMin[axis]) / (lut.domainMax[axis] - lut.domainMin[axis]);
		const scaled = Math.min(Math.max(normalized, 0), 1) * (n - 1);
		const low = Math.min(Math.floor(scaled), n - 1);
		lower.push(low);
		upper.push(Math.min(low + 1, n - 1));
		position.push(scaled - low);
	}

	const at = (r: number, g: number, b: number, channel: number) =>
		lut.data[((b * n + g) * n + r) * 3 + channel];

	const result: [number, number, number] = [0, 0, 0];
	for (let channel = 0; channel < 3; channel++) {
		const [tr, tg, tb] = position;
		const c00 = lerp(at(lower[0], lower[1], lower[2], channel), at(upper[0], lower[1], lower[2], channel), tr);
		const c10 = lerp(at(lower[0], upper[1], lower[2], channel), at(upper[0], upper[1], lower[2], channel), tr);
		const c01 = lerp(at(lower[0], lower[1], upper[2], channel), at(upper[0], lower[1], upper[2], channel), tr);
		const c11 = lerp(at(lower[0], upper[1], upper[2], channel), at(upper[0], upper[1], upper[2], channel), tr);
		result[channel] = lerp(lerp(c00, c10, tg), lerp(c01, c11, tg), tb);
	}
	return result;
}

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

/** 重新取樣到 0..1 定義域、邊長不超過 MAX_STORED_LUT_SIZE,轉成 8 位元 RGB。 */
export function toStoredLut({ lut, name }: { lut: ParsedLut; name: string }): StoredLut {
	const size = Math.min(lut.size, MAX_STORED_LUT_SIZE);
	const bytes = new Uint8Array(size * size * size * 3);
	let offset = 0;
	for (let b = 0; b < size; b++) {
		for (let g = 0; g < size; g++) {
			for (let r = 0; r < size; r++) {
				const value = sampleLut({
					lut,
					rgb: [r / (size - 1), g / (size - 1), b / (size - 1)],
				});
				for (let channel = 0; channel < 3; channel++) {
					bytes[offset++] = Math.round(Math.min(Math.max(value[channel], 0), 1) * 255);
				}
			}
		}
	}
	return { name, size, data: bytesToBase64({ bytes }) };
}

/** 內容決定的 id:同一個 LUT 重複匯入不會存兩份 */
export function storedLutId({ lut }: { lut: StoredLut }): string {
	// FNV-1a 32 位元
	let hash = 0x811c9dc5;
	for (let index = 0; index < lut.data.length; index++) {
		hash ^= lut.data.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return `${lut.size}-${hash.toString(16).padStart(8, "0")}`;
}

export interface LutTextureLayout {
	size: number;
	cols: number;
	rows: number;
	width: number;
	height: number;
	/** RGBA8,給 2D canvas 的 ImageData 用 */
	pixels: Uint8ClampedArray<ArrayBuffer>;
}

/**
 * 把 size 張 size×size 的切片(藍色由小到大)排成接近正方形的格子,
 * 33 → 6×6 格、198×198;避免排成一長條超過 WebGL 的貼圖尺寸上限。
 * 排法要和 rust/crates/effects/src/shaders/lut.wgsl 的 lut_uv 一致。
 */
export function buildLutTexture({ lut }: { lut: StoredLut }): LutTextureLayout {
	const size = lut.size;
	const bytes = base64ToBytes({ base64: lut.data });
	if (bytes.length !== size * size * size * 3) {
		throw new LutParseError("LUT 資料長度和大小不符");
	}
	const cols = Math.ceil(Math.sqrt(size));
	const rows = Math.ceil(size / cols);
	const width = cols * size;
	const height = rows * size;
	const pixels = new Uint8ClampedArray(width * height * 4);

	for (let b = 0; b < size; b++) {
		const tileX = (b % cols) * size;
		const tileY = Math.floor(b / cols) * size;
		for (let g = 0; g < size; g++) {
			for (let r = 0; r < size; r++) {
				const source = ((b * size + g) * size + r) * 3;
				const target = ((tileY + g) * width + tileX + r) * 4;
				pixels[target] = bytes[source];
				pixels[target + 1] = bytes[source + 1];
				pixels[target + 2] = bytes[source + 2];
				pixels[target + 3] = 255;
			}
		}
	}
	return { size, cols, rows, width, height, pixels };
}

export function isStoredLut(value: unknown): value is StoredLut {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.name === "string" &&
		typeof candidate.data === "string" &&
		typeof candidate.size === "number" &&
		Number.isInteger(candidate.size) &&
		candidate.size >= MIN_LUT_SIZE &&
		candidate.size <= MAX_STORED_LUT_SIZE
	);
}

function bytesToBase64({ bytes }: { bytes: Uint8Array }): string {
	let binary = "";
	const chunk = 0x8000;
	for (let index = 0; index < bytes.length; index += chunk) {
		binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
	}
	return btoa(binary);
}

function base64ToBytes({ base64 }: { base64: string }): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}
