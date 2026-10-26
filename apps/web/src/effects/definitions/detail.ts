import type { EffectDefinition } from "@/effects/types";

/**
 * 銳利化、發光、分離色調。著色器在 rust/crates/effects/src/shaders/。
 * uniform 名稱必須和 pipeline.rs 的 pack_effect_uniforms 完全一致(多一個、少一個都會報錯)。
 *
 * 半徑類參數以 1920 寬為基準,依實際寬度縮放:
 * 預覽用畫布大小、匯出用原始解析度,這樣兩者看起來才會一樣。
 */

export const SHARPEN_SHADER = "sharpen";
export const GLOW_SHADER = "glow";
export const SPLIT_TONE_SHADER = "split-tone";

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

export const sharpenEffectDefinition: EffectDefinition = {
	type: "sharpen",
	name: "銳利化",
	keywords: ["sharpen", "detail", "clarity", "銳利", "清晰", "細節"],
	params: [
		{ key: "amount", label: "強度", type: "number", default: 50, min: 0, max: 100, step: 1 },
		{ key: "radius", label: "半徑", type: "number", default: 1, min: 0.5, max: 5, step: 0.1 },
	],
	renderer: {
		passes: [
			{
				shader: SHARPEN_SHADER,
				uniforms: ({ effectParams, width }) => {
					const p = effectParams as Record<string, unknown>;
					return {
						u_amount: (num({ params: p, key: "amount", fallback: 50 }) / 100) * 3,
						u_radius: Math.max(
							0.5,
							scaleToWidth({
								pixels: num({ params: p, key: "radius", fallback: 1 }),
								width,
							}),
						),
					};
				},
			},
		],
	},
};

export const glowEffectDefinition: EffectDefinition = {
	type: "glow",
	name: "發光",
	keywords: ["glow", "bloom", "dreamy", "發光", "柔光", "夢幻"],
	params: [
		{ key: "intensity", label: "強度", type: "number", default: 60, min: 0, max: 100, step: 1 },
		{ key: "radius", label: "範圍", type: "number", default: 20, min: 1, max: 60, step: 1 },
		{ key: "threshold", label: "亮度門檻", type: "number", default: 60, min: 0, max: 99, step: 1 },
	],
	renderer: {
		passes: [
			{
				shader: GLOW_SHADER,
				uniforms: ({ effectParams, width }) => {
					const p = effectParams as Record<string, unknown>;
					return {
						u_intensity: (num({ params: p, key: "intensity", fallback: 60 }) / 100) * 2,
						u_radius: Math.max(
							1,
							scaleToWidth({
								pixels: num({ params: p, key: "radius", fallback: 20 }),
								width,
							}),
						),
						u_threshold: num({ params: p, key: "threshold", fallback: 60 }) / 100,
					};
				},
			},
		],
	},
};

export const splitToneEffectDefinition: EffectDefinition = {
	type: "split-tone",
	name: "分離色調",
	keywords: ["split tone", "teal orange", "color grade", "分離色調", "調色", "青橙"],
	params: [
		{ key: "shadowHue", label: "暗部色相", type: "number", default: 200, min: 0, max: 360, step: 1 },
		{ key: "shadowAmount", label: "暗部強度", type: "number", default: 40, min: 0, max: 100, step: 1 },
		{ key: "highlightHue", label: "亮部色相", type: "number", default: 35, min: 0, max: 360, step: 1 },
		{ key: "highlightAmount", label: "亮部強度", type: "number", default: 40, min: 0, max: 100, step: 1 },
		{ key: "balance", label: "平衡(暗部 ↔ 亮部)", type: "number", default: 0, min: -100, max: 100, step: 1 },
	],
	renderer: {
		passes: [
			{
				shader: SPLIT_TONE_SHADER,
				uniforms: ({ effectParams }) => {
					const p = effectParams as Record<string, unknown>;
					return {
						u_shadow_hue: num({ params: p, key: "shadowHue", fallback: 200 }),
						u_shadow_amount: num({ params: p, key: "shadowAmount", fallback: 40 }) / 100,
						u_highlight_hue: num({ params: p, key: "highlightHue", fallback: 35 }),
						u_highlight_amount:
							num({ params: p, key: "highlightAmount", fallback: 40 }) / 100,
						u_balance: num({ params: p, key: "balance", fallback: 0 }) / 100,
					};
				},
			},
		],
	},
};
