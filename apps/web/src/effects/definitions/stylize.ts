import type { EffectDefinition } from "@/effects/types";

/**
 * 風格化:馬賽克、色差(RGB 分離)、色調分離、底片顆粒。著色器在 rust/crates/effects/src/shaders/。
 * 參考 Kdenlive / MLT 的 pixelize、OBS 與 Kdenlive 的 RGB split、Shotcut 的 Posterize。
 * uniform 名稱必須和 pipeline.rs 的 pack_effect_uniforms 完全一致(多一個、少一個都會報錯)。
 *
 * 像素類參數以 1920 寬為基準,依實際寬度縮放:預覽用畫布大小、匯出用原始解析度,兩者看起來才會一樣。
 */

export const PIXELATE_SHADER = "pixelate";
export const CHROMATIC_ABERRATION_SHADER = "chromatic-aberration";
export const POSTERIZE_SHADER = "posterize";
export const FILM_GRAIN_SHADER = "film-grain";

/** 顆粒每秒換幾次圖樣。固定值讓預覽與匯出(不論幀率)看起來一致,也和底片 24 格的質感接近。 */
const GRAIN_UPDATES_PER_SECOND = 24;

const REFERENCE_WIDTH = 1920;

function num({
	params,
	key,
	fallback,
}: {
	params: Record<string, unknown>;
	key: string;
	fallback: number;
}): number {
	const raw = params[key];
	const value = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
	return Number.isFinite(value) ? value : fallback;
}

function scaleToWidth({ pixels, width }: { pixels: number; width: number }): number {
	const safeWidth = Number.isFinite(width) && width > 0 ? width : REFERENCE_WIDTH;
	return pixels * (safeWidth / REFERENCE_WIDTH);
}

export const pixelateEffectDefinition: EffectDefinition = {
	type: "pixelate",
	name: "馬賽克",
	keywords: ["pixelate", "mosaic", "censor", "馬賽克", "像素化", "打碼", "遮臉"],
	params: [
		{ key: "size", label: "方塊大小", type: "number", default: 24, min: 2, max: 200, step: 1 },
	],
	renderer: {
		passes: [
			{
				shader: PIXELATE_SHADER,
				uniforms: ({ effectParams, width }) => {
					const p = effectParams as Record<string, unknown>;
					return {
						u_block: Math.max(
							1,
							scaleToWidth({ pixels: num({ params: p, key: "size", fallback: 24 }), width }),
						),
					};
				},
			},
		],
	},
};

export const chromaticAberrationEffectDefinition: EffectDefinition = {
	type: "chromatic-aberration",
	name: "色差(RGB 分離)",
	keywords: ["chromatic aberration", "rgb split", "glitch", "色差", "色散", "故障", "分離"],
	params: [
		{ key: "amount", label: "位移", type: "number", default: 6, min: 0, max: 60, step: 0.5 },
		{
			key: "mode",
			label: "方式",
			type: "select",
			default: "radial",
			options: [
				{ value: "radial", label: "由中心向外(鏡頭)" },
				{ value: "linear", label: "固定方向" },
			],
		},
		{
			key: "angle",
			label: "方向角度",
			type: "number",
			default: 0,
			min: -180,
			max: 180,
			step: 1,
			dependencies: [{ param: "mode", equals: "linear" }],
		},
	],
	renderer: {
		skipWhen: ({ effectParams }) => {
			const value = Number((effectParams as Record<string, unknown>).amount ?? 6);
			return Number.isFinite(value) && value <= 0;
		},
		passes: [
			{
				shader: CHROMATIC_ABERRATION_SHADER,
				uniforms: ({ effectParams, width }) => {
					const p = effectParams as Record<string, unknown>;
					return {
						u_amount: scaleToWidth({
							pixels: Math.max(0, num({ params: p, key: "amount", fallback: 6 })),
							width,
						}),
						u_angle: num({ params: p, key: "angle", fallback: 0 }),
						u_radial: p.mode === "linear" ? 0 : 1,
					};
				},
			},
		],
	},
};

export const posterizeEffectDefinition: EffectDefinition = {
	type: "posterize",
	name: "色調分離",
	keywords: ["posterize", "poster", "comic", "色調分離", "色階", "海報", "漫畫"],
	params: [
		{ key: "levels", label: "色階數", type: "number", default: 6, min: 2, max: 32, step: 1 },
	],
	renderer: {
		passes: [
			{
				shader: POSTERIZE_SHADER,
				uniforms: ({ effectParams }) => {
					const p = effectParams as Record<string, unknown>;
					const levels = Math.round(num({ params: p, key: "levels", fallback: 6 }));
					return { u_levels: Math.min(32, Math.max(2, levels)) };
				},
			},
		],
	},
};

export const filmGrainEffectDefinition: EffectDefinition = {
	type: "film-grain",
	name: "底片顆粒",
	keywords: ["film grain", "grain", "noise", "vintage", "底片", "顆粒", "雜訊", "復古"],
	params: [
		{ key: "amount", label: "強度", type: "number", default: 25, min: 0, max: 100, step: 1 },
		{ key: "size", label: "顆粒大小", type: "number", default: 1.5, min: 1, max: 8, step: 0.1 },
		{ key: "shadows", label: "暗部保留", type: "number", default: 50, min: 0, max: 100, step: 1 },
		{ key: "color", label: "彩色顆粒", type: "boolean", default: false },
	],
	renderer: {
		passes: [
			{
				shader: FILM_GRAIN_SHADER,
				uniforms: ({ effectParams, width, time }) => {
					const p = effectParams as Record<string, unknown>;
					const seconds = Number.isFinite(time) ? Math.max(0, time ?? 0) : 0;
					return {
						u_amount: Math.min(1, Math.max(0, num({ params: p, key: "amount", fallback: 25 }) / 100)),
						u_size: Math.max(
							1,
							scaleToWidth({ pixels: num({ params: p, key: "size", fallback: 1.5 }), width }),
						),
						// 種子是整數格數;shader 轉成 u32,保持在 2^24 以內以免 f32 失去精度
						u_seed: Math.floor(seconds * GRAIN_UPDATES_PER_SECOND) % 16_777_216,
						u_color: p.color === true ? 1 : 0,
						u_shadow_protect:
							Math.min(100, Math.max(0, num({ params: p, key: "shadows", fallback: 50 }))) / 100,
					};
				},
			},
		],
	},
};
