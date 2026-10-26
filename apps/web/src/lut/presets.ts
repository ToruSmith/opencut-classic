import { toStoredLut, type ParsedLut, type StoredLut } from "./cube";

/**
 * 內建 LUT 風格:用色彩公式即時產生,不存進專案(id 以 `builtin-` 開頭,內容固定)。
 * 讓沒有 .cube 檔的人也能直接用;「負片」一眼就能看出 LUT 有沒有正確套用。
 * 純函式,有測試。
 */

type Rgb = [number, number, number];

export interface LutPreset {
	id: string;
	name: string;
	transform: (rgb: Rgb) => Rgb;
}

export const BUILTIN_LUT_PREFIX = "builtin-";
const PRESET_SIZE = 33;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const luma = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
/** S 曲線:amount 0 = 不變,1 = 完整 smoothstep */
const sCurve = (x: number, amount: number) => mix(x, x * x * (3 - 2 * x), amount);

function saturate({ rgb, amount }: { rgb: Rgb; amount: number }): Rgb {
	const l = luma(rgb);
	return rgb.map((c) => l + (c - l) * amount) as Rgb;
}

/** 依亮度把暗部推向 shadow 色、亮部推向 highlight 色(加法,值是偏移量) */
function splitTint({ rgb, shadow, highlight }: { rgb: Rgb; shadow: Rgb; highlight: Rgb }): Rgb {
	const l = clamp01(luma(rgb));
	const shadowWeight = (1 - l) * (1 - l);
	const highlightWeight = l * l;
	return rgb.map((c, i) => c + shadow[i] * shadowWeight + highlight[i] * highlightWeight) as Rgb;
}

const finish = (rgb: Rgb): Rgb => rgb.map(clamp01) as Rgb;

export const LUT_PRESETS: LutPreset[] = [
	{
		id: `${BUILTIN_LUT_PREFIX}teal-orange`,
		name: "青橙電影感",
		transform: (rgb) => {
			let out = splitTint({ rgb, shadow: [-0.06, 0.03, 0.09], highlight: [0.08, 0.02, -0.07] });
			out = saturate({ rgb: out, amount: 1.12 });
			return finish(out.map((c) => sCurve(clamp01(c), 0.35)) as Rgb);
		},
	},
	{
		id: `${BUILTIN_LUT_PREFIX}faded-film`,
		name: "褪色底片",
		transform: (rgb) => {
			let out = rgb.map((c) => 0.07 + clamp01(c) * 0.86) as Rgb;
			out = saturate({ rgb: out, amount: 0.78 });
			out = splitTint({ rgb: out, shadow: [0.0, 0.02, 0.03], highlight: [0.04, 0.015, -0.03] });
			return finish(out);
		},
	},
	{
		id: `${BUILTIN_LUT_PREFIX}japanese-fresh`,
		name: "日系清新",
		transform: (rgb) => {
			// 提亮、降對比、略降飽和,暗部帶一點青綠
			let out = rgb.map((c) => 1 - (1 - clamp01(c)) ** 1.35) as Rgb;
			out = out.map((c) => mix(c, 0.55, 0.12)) as Rgb;
			out = saturate({ rgb: out, amount: 0.85 });
			out = splitTint({ rgb: out, shadow: [-0.01, 0.03, 0.04], highlight: [0.0, 0.01, 0.01] });
			return finish(out);
		},
	},
	{
		id: `${BUILTIN_LUT_PREFIX}cyber-night`,
		name: "賽博夜景",
		transform: (rgb) => {
			let out = splitTint({ rgb, shadow: [0.03, -0.02, 0.12], highlight: [0.1, -0.02, 0.06] });
			out = saturate({ rgb: out, amount: 1.25 });
			return finish(out.map((c) => sCurve(clamp01(c), 0.3)) as Rgb);
		},
	},
	{
		id: `${BUILTIN_LUT_PREFIX}bw-contrast`,
		name: "高對比黑白",
		transform: (rgb) => {
			const l = sCurve(clamp01(luma(rgb)), 0.75);
			return [l, l, l];
		},
	},
	{
		id: `${BUILTIN_LUT_PREFIX}negative`,
		name: "負片",
		transform: ([r, g, b]) => [1 - r, 1 - g, 1 - b],
	},
];

export const DEFAULT_LUT_PRESET_ID = LUT_PRESETS[0].id;

export function isBuiltinLutId({ id }: { id: string }): boolean {
	return id.startsWith(BUILTIN_LUT_PREFIX);
}

const generated = new Map<string, StoredLut>();

/** 產生內建 LUT(第一次呼叫時計算,之後快取)。找不到時回傳 null。 */
export function getBuiltinLut({ id }: { id: string }): StoredLut | null {
	const cached = generated.get(id);
	if (cached) return cached;
	const preset = LUT_PRESETS.find((candidate) => candidate.id === id);
	if (!preset) return null;

	const n = PRESET_SIZE;
	const data = new Float32Array(n * n * n * 3);
	let offset = 0;
	for (let b = 0; b < n; b++) {
		for (let g = 0; g < n; g++) {
			for (let r = 0; r < n; r++) {
				const out = preset.transform([r / (n - 1), g / (n - 1), b / (n - 1)]);
				data[offset++] = out[0];
				data[offset++] = out[1];
				data[offset++] = out[2];
			}
		}
	}
	const parsed: ParsedLut = {
		title: preset.name,
		size: n,
		domainMin: [0, 0, 0],
		domainMax: [1, 1, 1],
		data,
	};
	const stored = toStoredLut({ lut: parsed, name: preset.name });
	generated.set(id, stored);
	return stored;
}
