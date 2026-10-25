import type { EffectDefinition } from "@/effects/types";

export const COLOR_GRADE_SHADER = "color-grade";

const NEUTRAL = {
	u_brightness: 0,
	u_contrast: 1,
	u_saturation: 1,
	u_hue: 0,
	u_sepia: 0,
	u_vignette: 0,
};

function num(params: Record<string, unknown>, key: string, fallback: number): number {
	const raw = params[key];
	const value = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
	return Number.isFinite(value) ? value : fallback;
}

function colorEffect({
	type,
	name,
	keywords,
	params,
	uniforms,
}: {
	type: string;
	name: string;
	keywords: string[];
	params: EffectDefinition["params"];
	uniforms: (p: Record<string, unknown>) => Partial<typeof NEUTRAL>;
}): EffectDefinition {
	return {
		type,
		name,
		keywords,
		params,
		renderer: {
			passes: [
				{
					shader: COLOR_GRADE_SHADER,
					uniforms: ({ effectParams }) => ({
						...NEUTRAL,
						...uniforms(effectParams as Record<string, unknown>),
					}),
				},
			],
		},
	};
}

export const colorAdjustEffectDefinition = colorEffect({
	type: "color-adjust",
	name: "色彩調整",
	keywords: ["color", "brightness", "contrast", "saturation", "hue", "亮度", "對比", "飽和", "色相"],
	params: [
		{ key: "brightness", label: "亮度", type: "number", default: 0, min: -100, max: 100, step: 1 },
		{ key: "contrast", label: "對比", type: "number", default: 100, min: 0, max: 200, step: 1 },
		{ key: "saturation", label: "飽和度", type: "number", default: 100, min: 0, max: 200, step: 1 },
		{ key: "hue", label: "色相", type: "number", default: 0, min: -180, max: 180, step: 1 },
	],
	uniforms: (p) => ({
		u_brightness: num(p, "brightness", 0) / 100,
		u_contrast: num(p, "contrast", 100) / 100,
		u_saturation: num(p, "saturation", 100) / 100,
		u_hue: num(p, "hue", 0),
	}),
});

export const grayscaleEffectDefinition = colorEffect({
	type: "grayscale",
	name: "黑白",
	keywords: ["grayscale", "black and white", "mono", "黑白"],
	params: [{ key: "amount", label: "強度", type: "number", default: 100, min: 0, max: 100, step: 1 }],
	uniforms: (p) => ({ u_saturation: 1 - num(p, "amount", 100) / 100 }),
});

export const sepiaEffectDefinition = colorEffect({
	type: "sepia",
	name: "復古褐色",
	keywords: ["sepia", "vintage", "old", "復古"],
	params: [{ key: "amount", label: "強度", type: "number", default: 100, min: 0, max: 100, step: 1 }],
	uniforms: (p) => ({ u_sepia: num(p, "amount", 100) / 100 }),
});

export const vignetteEffectDefinition = colorEffect({
	type: "vignette",
	name: "暗角",
	keywords: ["vignette", "dark corners", "暗角"],
	params: [{ key: "amount", label: "強度", type: "number", default: 60, min: 0, max: 100, step: 1 }],
	uniforms: (p) => ({ u_vignette: num(p, "amount", 60) / 100 }),
});
