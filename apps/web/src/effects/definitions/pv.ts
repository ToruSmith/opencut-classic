import type { EffectDefinition } from "@/effects/types";

/**
 * PV / MV 常用的畫面效果:網點、雙色調、VHS、集中線、波浪扭曲、漏光、魚眼。
 * 著色器在 rust/crates/effects/src/shaders/;uniform 名稱必須和 pipeline.rs 的 pack_effect_uniforms 完全一致。
 *
 * 全部是單一 pass、只看「當下這一格的這個圖層」(沒有歷史影格、沒有額外貼圖)。
 * 強度為 0(或沒有任何作用)時 `skipWhen` 成立,不送 pass,所以特效留在片段上、用關鍵影格拉高強度也不會平時多花 GPU。
 * 像素類參數以 1920 寬為基準,依實際寬度縮放:預覽用畫布大小、匯出用原始解析度,看起來才會一樣。
 * 會動的效果用 `time`(片段開頭起算的秒數)驅動,預覽與匯出在同一時間點的畫面相同。
 */

export const HALFTONE_SHADER = "halftone";
export const DUOTONE_SHADER = "duotone";
export const VHS_SHADER = "vhs";
export const SPEED_LINES_SHADER = "speed-lines";
export const WAVE_SHADER = "wave";
export const LIGHT_LEAK_SHADER = "light-leak";
export const FISHEYE_SHADER = "fisheye";

const REFERENCE_WIDTH = 1920;

type Params = Record<string, unknown>;

function num({ params, key, fallback }: { params: Params; key: string; fallback: number }): number {
	const raw = params[key];
	const value = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
	return Number.isFinite(value) ? value : fallback;
}

function clamp({ value, min, max }: { value: number; min: number; max: number }): number {
	return Math.min(max, Math.max(min, value));
}

function scaleToWidth({ pixels, width }: { pixels: number; width: number }): number {
	const safeWidth = Number.isFinite(width) && width > 0 ? width : REFERENCE_WIDTH;
	return pixels * (safeWidth / REFERENCE_WIDTH);
}

function safeTime({ time }: { time: number | undefined }): number {
	return Number.isFinite(time) ? Math.max(0, time ?? 0) : 0;
}

function percent({ params, key, fallback }: { params: Params; key: string; fallback: number }): number {
	return clamp({ value: num({ params, key, fallback }), min: 0, max: 100 }) / 100;
}

function seed({ params }: { params: Params }): number {
	return Math.round(clamp({ value: num({ params, key: "seed", fallback: 1 }), min: 0, max: 999 }));
}

// ---- 網點 ----

export function buildHalftoneUniforms({ params, width }: { params: Params; width: number }): Record<string, number> {
	return {
		u_size: Math.max(2, scaleToWidth({ pixels: clamp({ value: num({ params, key: "size", fallback: 14 }), min: 4, max: 80 }), width })),
		u_amount: percent({ params, key: "amount", fallback: 100 }),
		u_angle: clamp({ value: num({ params, key: "angle", fallback: 45 }), min: 0, max: 90 }),
		u_color: params.mode === "color" ? 1 : 0,
	};
}

export const halftoneEffectDefinition: EffectDefinition = {
	type: "halftone",
	name: "網點",
	keywords: ["halftone", "dots", "comic", "print", "網點", "半色調", "漫畫", "印刷", "點陣"],
	params: [
		{ key: "amount", label: "強度", type: "number", default: 100, min: 0, max: 100, step: 1 },
		{ key: "size", label: "點的大小", type: "number", default: 14, min: 4, max: 80, step: 1 },
		{ key: "angle", label: "網格角度", type: "number", default: 45, min: 0, max: 90, step: 1, keyframable: false },
		{
			key: "mode",
			label: "樣式",
			type: "select",
			default: "ink",
			keyframable: false,
			options: [
				{ value: "ink", label: "黑白印刷" },
				{ value: "color", label: "彩色圓點(黑底)" },
			],
		},
	],
	renderer: {
		skipWhen: ({ effectParams }) => percent({ params: effectParams as Params, key: "amount", fallback: 100 }) <= 0,
		passes: [
			{
				shader: HALFTONE_SHADER,
				uniforms: ({ effectParams, width }) => buildHalftoneUniforms({ params: effectParams as Params, width }),
			},
		],
	},
};

// ---- 雙色調 ----

export function buildDuotoneUniforms({ params }: { params: Params }): Record<string, number> {
	return {
		u_amount: percent({ params, key: "amount", fallback: 100 }),
		u_saturation: percent({ params, key: "saturation", fallback: 80 }),
		u_contrast: percent({ params, key: "contrast", fallback: 40 }),
		u_shadow_hue: clamp({ value: num({ params, key: "shadowHue", fallback: 250 }), min: 0, max: 360 }),
		u_highlight_hue: clamp({ value: num({ params, key: "highlightHue", fallback: 35 }), min: 0, max: 360 }),
	};
}

export const duotoneEffectDefinition: EffectDefinition = {
	type: "duotone",
	name: "雙色調",
	keywords: ["duotone", "gradient map", "two tone", "雙色調", "漸層對應", "海報", "配色"],
	params: [
		{ key: "amount", label: "強度", type: "number", default: 100, min: 0, max: 100, step: 1 },
		{ key: "shadowHue", label: "暗部色相", type: "number", default: 250, min: 0, max: 360, step: 1 },
		{ key: "highlightHue", label: "亮部色相", type: "number", default: 35, min: 0, max: 360, step: 1 },
		{ key: "saturation", label: "飽和度", type: "number", default: 80, min: 0, max: 100, step: 1 },
		{ key: "contrast", label: "對比", type: "number", default: 40, min: 0, max: 100, step: 1 },
	],
	renderer: {
		skipWhen: ({ effectParams }) => percent({ params: effectParams as Params, key: "amount", fallback: 100 }) <= 0,
		passes: [
			{
				shader: DUOTONE_SHADER,
				uniforms: ({ effectParams }) => buildDuotoneUniforms({ params: effectParams as Params }),
			},
		],
	},
};

// ---- VHS ----

export function buildVhsUniforms({
	params,
	width,
	time,
}: {
	params: Params;
	width: number;
	time: number | undefined;
}): Record<string, number> {
	return {
		u_intensity: percent({ params, key: "intensity", fallback: 60 }),
		u_scanlines: percent({ params, key: "scanlines", fallback: 50 }),
		u_jitter: scaleToWidth({ pixels: clamp({ value: num({ params, key: "jitter", fallback: 24 }), min: 0, max: 120 }), width }),
		u_seed: seed({ params }),
		u_time: safeTime({ time }),
	};
}

export const vhsEffectDefinition: EffectDefinition = {
	type: "vhs",
	name: "VHS 錄影帶",
	keywords: ["vhs", "tape", "retro", "analog", "scanlines", "錄影帶", "復古", "掃描線", "類比", "訊號"],
	params: [
		{ key: "intensity", label: "強度(暈色、雜點、追蹤帶)", type: "number", default: 60, min: 0, max: 100, step: 1 },
		{ key: "scanlines", label: "掃描線", type: "number", default: 50, min: 0, max: 100, step: 1 },
		{ key: "jitter", label: "橫向抖動", type: "number", default: 24, min: 0, max: 120, step: 1 },
		{ key: "seed", label: "換一種花樣", type: "number", default: 1, min: 0, max: 999, step: 1, keyframable: false },
	],
	renderer: {
		skipWhen: ({ effectParams }) => {
			const p = effectParams as Params;
			return percent({ params: p, key: "intensity", fallback: 60 }) <= 0 && percent({ params: p, key: "scanlines", fallback: 50 }) <= 0;
		},
		passes: [
			{
				shader: VHS_SHADER,
				uniforms: ({ effectParams, width, time }) =>
					buildVhsUniforms({ params: effectParams as Params, width, time }),
			},
		],
	},
};

// ---- 集中線 ----

export function buildSpeedLinesUniforms({
	params,
	time,
}: {
	params: Params;
	time: number | undefined;
}): Record<string, number> {
	return {
		u_intensity: percent({ params, key: "intensity", fallback: 100 }),
		u_count: Math.round(clamp({ value: num({ params, key: "count", fallback: 90 }), min: 8, max: 240 })),
		u_inner: percent({ params, key: "inner", fallback: 35 }),
		u_dark: params.color === "black" ? 1 : 0,
		u_time: safeTime({ time }),
		u_seed: seed({ params }),
	};
}

export const speedLinesEffectDefinition: EffectDefinition = {
	type: "speed-lines",
	name: "集中線",
	keywords: ["speed lines", "focus lines", "manga", "anime", "impact", "集中線", "速度線", "漫畫", "衝擊"],
	params: [
		{ key: "intensity", label: "強度", type: "number", default: 100, min: 0, max: 100, step: 1 },
		{ key: "count", label: "線的數量", type: "number", default: 90, min: 8, max: 240, step: 1 },
		{ key: "inner", label: "中間留白", type: "number", default: 35, min: 0, max: 95, step: 1 },
		{
			key: "color",
			label: "顏色",
			type: "select",
			default: "white",
			keyframable: false,
			options: [
				{ value: "white", label: "白線" },
				{ value: "black", label: "黑線" },
			],
		},
		{ key: "seed", label: "換一種花樣", type: "number", default: 1, min: 0, max: 999, step: 1, keyframable: false },
	],
	renderer: {
		skipWhen: ({ effectParams }) => percent({ params: effectParams as Params, key: "intensity", fallback: 100 }) <= 0,
		passes: [
			{
				shader: SPEED_LINES_SHADER,
				uniforms: ({ effectParams, time }) => buildSpeedLinesUniforms({ params: effectParams as Params, time }),
			},
		],
	},
};

// ---- 波浪扭曲 ----

export function buildWaveUniforms({
	params,
	width,
	time,
}: {
	params: Params;
	width: number;
	time: number | undefined;
}): Record<string, number> {
	return {
		u_amplitude: scaleToWidth({ pixels: clamp({ value: num({ params, key: "amplitude", fallback: 20 }), min: 0, max: 200 }), width }),
		u_wavelength: Math.max(8, scaleToWidth({ pixels: clamp({ value: num({ params, key: "wavelength", fallback: 240 }), min: 20, max: 1600 }), width })),
		u_speed: clamp({ value: num({ params, key: "speed", fallback: 0.6 }), min: -5, max: 5 }),
		u_angle: clamp({ value: num({ params, key: "angle", fallback: 0 }), min: 0, max: 360 }),
		u_time: safeTime({ time }),
	};
}

export const waveEffectDefinition: EffectDefinition = {
	type: "wave",
	name: "波浪扭曲",
	keywords: ["wave", "ripple", "distort", "water", "波浪", "扭曲", "水波", "漣漪"],
	params: [
		{ key: "amplitude", label: "振幅", type: "number", default: 20, min: 0, max: 200, step: 1 },
		{ key: "wavelength", label: "波長", type: "number", default: 240, min: 20, max: 1600, step: 10 },
		{ key: "speed", label: "速度(週期 / 秒,負數反向)", type: "number", default: 0.6, min: -5, max: 5, step: 0.1 },
		{ key: "angle", label: "波的方向", type: "number", default: 0, min: 0, max: 360, step: 1, keyframable: false },
	],
	renderer: {
		skipWhen: ({ effectParams }) => num({ params: effectParams as Params, key: "amplitude", fallback: 20 }) <= 0,
		passes: [
			{
				shader: WAVE_SHADER,
				uniforms: ({ effectParams, width, time }) =>
					buildWaveUniforms({ params: effectParams as Params, width, time }),
			},
		],
	},
};

// ---- 漏光 ----

export function buildLightLeakUniforms({
	params,
	time,
}: {
	params: Params;
	time: number | undefined;
}): Record<string, number> {
	return {
		u_intensity: percent({ params, key: "intensity", fallback: 70 }),
		u_hue: clamp({ value: num({ params, key: "hue", fallback: 20 }), min: 0, max: 360 }),
		u_size: percent({ params, key: "size", fallback: 50 }),
		u_speed: clamp({ value: num({ params, key: "speed", fallback: 1 }), min: 0, max: 5 }),
		u_time: safeTime({ time }),
		u_seed: seed({ params }),
	};
}

export const lightLeakEffectDefinition: EffectDefinition = {
	type: "light-leak",
	name: "漏光",
	keywords: ["light leak", "film", "flare", "glow", "leak", "漏光", "底片", "光斑", "暖光"],
	params: [
		{ key: "intensity", label: "強度", type: "number", default: 70, min: 0, max: 100, step: 1 },
		{ key: "hue", label: "色相(0 紅、30 橘、200 藍)", type: "number", default: 20, min: 0, max: 360, step: 1 },
		{ key: "size", label: "光斑大小", type: "number", default: 50, min: 0, max: 100, step: 1 },
		{ key: "speed", label: "飄移速度", type: "number", default: 1, min: 0, max: 5, step: 0.1 },
		{ key: "seed", label: "換一種位置", type: "number", default: 1, min: 0, max: 999, step: 1, keyframable: false },
	],
	renderer: {
		skipWhen: ({ effectParams }) => percent({ params: effectParams as Params, key: "intensity", fallback: 70 }) <= 0,
		passes: [
			{
				shader: LIGHT_LEAK_SHADER,
				uniforms: ({ effectParams, time }) => buildLightLeakUniforms({ params: effectParams as Params, time }),
			},
		],
	},
};

// ---- 魚眼 ----

export function buildFisheyeUniforms({ params }: { params: Params }): Record<string, number> {
	return {
		u_strength: clamp({ value: num({ params, key: "strength", fallback: 50 }), min: -100, max: 100 }) / 100,
		u_zoom: clamp({ value: num({ params, key: "zoom", fallback: 100 }), min: 100, max: 200 }) / 100,
	};
}

export const fisheyeEffectDefinition: EffectDefinition = {
	type: "fisheye",
	name: "魚眼",
	keywords: ["fisheye", "lens", "barrel", "distortion", "魚眼", "鏡頭", "畸變", "桶狀"],
	params: [
		{ key: "strength", label: "強度(正 = 魚眼,負 = 枕狀)", type: "number", default: 50, min: -100, max: 100, step: 1 },
		{ key: "zoom", label: "放大(%,把邊緣推出畫面)", type: "number", default: 100, min: 100, max: 200, step: 1 },
	],
	renderer: {
		skipWhen: ({ effectParams }) => {
			const uniforms = buildFisheyeUniforms({ params: effectParams as Params });
			return Math.abs(uniforms.u_strength) < 1e-4 && Math.abs(uniforms.u_zoom - 1) < 1e-4;
		},
		passes: [
			{
				shader: FISHEYE_SHADER,
				uniforms: ({ effectParams }) => buildFisheyeUniforms({ params: effectParams as Params }),
			},
		],
	},
};
