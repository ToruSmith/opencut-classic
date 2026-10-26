import type { EffectDefinition, EffectPass } from "@/effects/types";
import { getLutTexture, lutTextureId } from "@/lut/store";

/**
 * 套用 3D LUT(.cube)。LUT 資料存在專案的 `luts`,這裡只記 id(`lut` 參數,由效果面板的選擇器設定)。
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
	keywords: ["lut", "cube", "color grading", "look", "調色", "風格", "濾鏡"],
	params: [
		{ key: "lut", label: "LUT", type: "text", default: "", hidden: true },
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
