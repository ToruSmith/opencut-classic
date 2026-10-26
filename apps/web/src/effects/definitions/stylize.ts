import type { EffectDefinition } from "@/effects/types";

/**
 * 風格化:馬賽克、色差(RGB 分離)、色調分離。著色器在 rust/crates/effects/src/shaders/。
 * 參考 Kdenlive / MLT 的 pixelize、OBS 與 Kdenlive 的 RGB split、Shotcut 的 Posterize。
 * uniform 名稱必須和 pipeline.rs 的 pack_effect_uniforms 完全一致(多一個、少一個都會報錯)。
 *
 * 像素類參數以 1920 寬為基準,依實際寬度縮放:預覽用畫布大小、匯出用原始解析度,兩者看起來才會一樣。
 */

export const PIXELATE_SHADER = "pixelate";
export const CHROMATIC_ABERRATION_SHADER = "chromatic-aberration";
export const POSTERIZE_SHADER = "posterize";

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
