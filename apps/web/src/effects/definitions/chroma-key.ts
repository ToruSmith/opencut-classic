import type { EffectDefinition } from "@/effects/types";

export const CHROMA_KEY_SHADER = "chroma-key";

const DEFAULT_KEY_COLOR = "#00ff00";

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

/** 把參數裡的色彩(#rgb / #rrggbb / #rrggbbaa)轉成 shader 使用的 sRGB 0..1;無法解析時退回綠幕綠 */
export function parseKeyColor({ value }: { value: unknown }): [number, number, number] {
	const match =
		typeof value === "string"
			? value.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i)
			: null;
	if (!match) return parseKeyColor({ value: DEFAULT_KEY_COLOR });

	let hex = match[1];
	if (hex.length === 3) {
		hex = hex
			.split("")
			.map((char) => char + char)
			.join("");
	}
	return [
		Number.parseInt(hex.slice(0, 2), 16) / 255,
		Number.parseInt(hex.slice(2, 4), 16) / 255,
		Number.parseInt(hex.slice(4, 6), 16) / 255,
	];
}

export const chromaKeyEffectDefinition: EffectDefinition = {
	type: "chroma-key",
	name: "去背(綠幕)",
	keywords: ["chroma key", "green screen", "greenscreen", "key", "去背", "綠幕", "摳像"],
	params: [
		{ key: "color", label: "去除的顏色", type: "color", default: DEFAULT_KEY_COLOR },
		{ key: "similarity", label: "容許範圍", type: "number", default: 30, min: 0, max: 100, step: 1 },
		{ key: "smoothness", label: "邊緣柔化", type: "number", default: 10, min: 0, max: 100, step: 1 },
		{ key: "spill", label: "去溢色", type: "number", default: 50, min: 0, max: 100, step: 1 },
	],
	renderer: {
		passes: [
			{
				shader: CHROMA_KEY_SHADER,
				uniforms: ({ effectParams }) => {
					const params = effectParams as Record<string, unknown>;
					return {
						u_key: parseKeyColor({ value: params.color }),
						// 色度距離最大約 0.7,把 0..100 的滑桿對應到 0..0.5 的實用範圍
						u_similarity: (readNumber({ params, key: "similarity", fallback: 30 }) / 100) * 0.5,
						u_smoothness: (readNumber({ params, key: "smoothness", fallback: 10 }) / 100) * 0.5,
						u_spill: readNumber({ params, key: "spill", fallback: 50 }) / 100,
					};
				},
			},
		],
	},
};
