import type { EffectDefinition, EffectPass } from "@/effects/types";
import { getLutTexture, lutTextureId } from "@/lut/store";
import { DEFAULT_LUT_PRESET_ID } from "@/lut/presets";

/**
 * 套用 3D LUT。`lut` 參數是 id:內建風格(`builtin-…`,見 lut/presets.ts)或專案匯入的 .cube(存在 `project.luts`)。
 * 新加的效果預設用第一個內建風格,放上去就看得到效果。
 * 找不到 LUT(還沒選、或資料不在)時不產生任何 pass,畫面維持原樣。
 */

export const LUT_SHADER = "lut";

function readIntensity({ params }: { params: Record<string, unknown> }): number {
	const raw = params.intensity;
	const value = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
	return Number.isFinite(value) ? Math.min(1, Math.max(0, value / 100)) : 1;
}

export function buildLutPasses({
	effectParams,
}: {
	effectParams: Record<string, unknown>;
}): EffectPass[] {
	const id = typeof effectParams.lut === "string" ? effectParams.lut : "";
	if (!id) return [];
	const texture = getLutTexture({ id });
	if (!texture) return [];
	return [
		{
			shader: LUT_SHADER,
			uniforms: {
				u_size: texture.size,
				u_cols: texture.cols,
				u_rows: texture.rows,
				u_intensity: readIntensity({ params: effectParams }),
			},
			textureId: lutTextureId({ id }),
		},
	];
}

export const lutEffectDefinition: EffectDefinition = {
	type: "lut",
	name: "LUT 調色",
	keywords: [
		"lut",
		"cube",
		"color grading",
		"look",
		"teal orange",
		"調色",
		"風格",
		"濾鏡",
		"青橙",
		"電影感",
		"日系",
		"黑白",
		"負片",
	],
	params: [
		{ key: "lut", label: "LUT", type: "text", default: DEFAULT_LUT_PRESET_ID, hidden: true },
		{ key: "intensity", label: "強度", type: "number", default: 100, min: 0, max: 100, step: 1 },
	],
	renderer: {
		// buildPasses 會依實際載入的 LUT 決定大小;這個樣板只描述 uniform 名稱
		passes: [
			{
				shader: LUT_SHADER,
				uniforms: ({ effectParams }) => ({
					u_size: 2,
					u_cols: 2,
					u_rows: 1,
					u_intensity: readIntensity({ params: effectParams as Record<string, unknown> }),
				}),
			},
		],
		buildPasses: ({ effectParams }) =>
			buildLutPasses({ effectParams: effectParams as Record<string, unknown> }),
	},
};
