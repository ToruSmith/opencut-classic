import type { EffectDefinition } from "@/effects/types";
import type { ParamDefinition } from "@/params";

export const TONE_SHADER = "tone";

interface ToneValues {
	temperature: number;
	tint: number;
	shadows: number;
	highlights: number;
	exposure: number;
	fade: number;
}

const NEUTRAL: ToneValues = {
	temperature: 0,
	tint: 0,
	shadows: 0,
	highlights: 0,
	exposure: 0,
	fade: 0,
};

function readNumber({
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

/** UI 的 -100..100 / 0..100 轉成 shader 使用的範圍 */
export function toneUniforms({ values }: { values: ToneValues }) {
	return {
		u_temperature: values.temperature / 100,
		u_tint: values.tint / 100,
		u_shadows: values.shadows / 100,
		u_highlights: values.highlights / 100,
		u_exposure: values.exposure / 50,
		u_fade: values.fade / 100,
	};
}

function toneEffect({
	type,
	name,
	keywords,
	params,
	values,
}: {
	type: string;
	name: string;
	keywords: string[];
	params: ParamDefinition[];
	values: (p: Record<string, unknown>) => Partial<ToneValues>;
}): EffectDefinition {
	return {
		type,
		name,
		keywords,
		params,
		renderer: {
			passes: [
				{
					shader: TONE_SHADER,
					uniforms: ({ effectParams }) =>
						toneUniforms({
							values: {
								...NEUTRAL,
								...values(effectParams as Record<string, unknown>),
							},
						}),
				},
			],
		},
	};
}

const slider = ({
	key,
	label,
	min = -100,
	max = 100,
	def = 0,
}: {
	key: string;
	label: string;
	min?: number;
	max?: number;
	def?: number;
}): ParamDefinition => ({ key, label, type: "number", default: def, min, max, step: 1 });

const amount = (def: number): ParamDefinition =>
	slider({ key: "amount", label: "強度", min: 0, max: 100, def });

const amountOf = (p: Record<string, unknown>, def: number) =>
	readNumber({ params: p, key: "amount", fallback: def }) / 100;

export const toneEffectDefinition = toneEffect({
	type: "tone",
	name: "色溫與色調",
	keywords: ["temperature", "tint", "exposure", "shadows", "highlights", "色溫", "色調", "曝光", "陰影", "亮部", "褪色"],
	params: [
		slider({ key: "temperature", label: "色溫(冷 ↔ 暖)" }),
		slider({ key: "tint", label: "色調(洋紅 ↔ 綠)" }),
		slider({ key: "exposure", label: "曝光" }),
		slider({ key: "shadows", label: "陰影" }),
		slider({ key: "highlights", label: "亮部" }),
		slider({ key: "fade", label: "褪色", min: 0, max: 100 }),
	],
	values: (p) => ({
		temperature: readNumber({ params: p, key: "temperature", fallback: 0 }),
		tint: readNumber({ params: p, key: "tint", fallback: 0 }),
		exposure: readNumber({ params: p, key: "exposure", fallback: 0 }),
		shadows: readNumber({ params: p, key: "shadows", fallback: 0 }),
		highlights: readNumber({ params: p, key: "highlights", fallback: 0 }),
		fade: readNumber({ params: p, key: "fade", fallback: 0 }),
	}),
});

export const warmLookEffectDefinition = toneEffect({
	type: "look-warm",
	name: "暖色調",
	keywords: ["warm", "sunset", "golden", "暖色", "夕陽"],
	params: [amount(60)],
	values: (p) => {
		const a = amountOf(p, 60);
		return { temperature: 45 * a, tint: 6 * a, shadows: 10 * a, highlights: -8 * a };
	},
});

export const coolLookEffectDefinition = toneEffect({
	type: "look-cool",
	name: "冷色調",
	keywords: ["cool", "cold", "blue", "冷色", "藍調"],
	params: [amount(60)],
	values: (p) => {
		const a = amountOf(p, 60);
		return { temperature: -45 * a, tint: -4 * a, shadows: 6 * a, highlights: -4 * a };
	},
});

export const filmFadeLookEffectDefinition = toneEffect({
	type: "look-film-fade",
	name: "底片褪色",
	keywords: ["film", "faded", "matte", "retro", "底片", "褪色", "復古"],
	params: [amount(70)],
	values: (p) => {
		const a = amountOf(p, 70);
		return { temperature: 14 * a, tint: -4 * a, shadows: 12 * a, highlights: -12 * a, fade: 60 * a };
	},
});
