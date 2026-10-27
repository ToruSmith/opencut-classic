import type { ParamValue } from "@/params";

/**
 * 效果組合:把幾個常搭配的特效打包,一次放到時間軸(每個特效各佔一個特效片段,同一個復原步驟)。
 * 純資料,不依賴 DOM / wasm。參數只寫要覆寫的,沒寫的用特效定義的預設值。
 * 有測試:特效類型要存在、參數 key 要存在、數值不能超出範圍。
 */

export interface EffectPresetLayer {
	effectType: string;
	params?: Record<string, ParamValue>;
}

export interface EffectPreset {
	id: string;
	name: string;
	description: string;
	layers: EffectPresetLayer[];
	/** 片段長度(秒);沒寫就用預設長度 */
	durationSeconds?: number;
}

export const EFFECT_PRESETS: EffectPreset[] = [
	{
		id: "impact",
		name: "衝擊",
		description: "震動 + 放射模糊 + 色差,適合節拍重音、轉場瞬間",
		durationSeconds: 0.5,
		layers: [
			{ effectType: "camera-shake", params: { amount: 40, speed: 14, rotation: 2 } },
			{ effectType: "zoom-blur", params: { strength: 45 } },
			{ effectType: "chromatic-aberration", params: { amount: 10 } },
		],
	},
	{
		id: "retro-film",
		name: "復古膠卷",
		description: "褪色底片調色 + 顆粒 + 暗角",
		layers: [
			{ effectType: "lut", params: { lut: "builtin-faded-film", intensity: 100 } },
			{ effectType: "film-grain", params: { amount: 35 } },
			{ effectType: "vignette" },
		],
	},
	{
		id: "cinematic",
		name: "電影感",
		description: "青橙調色 + 暗角 + 細緻顆粒",
		layers: [
			{ effectType: "lut", params: { lut: "builtin-teal-orange", intensity: 85 } },
			{ effectType: "vignette" },
			{ effectType: "film-grain", params: { amount: 15 } },
		],
	},
	{
		id: "cyber-glitch",
		name: "賽博故障",
		description: "賽博夜景調色 + 故障 + 色差",
		layers: [
			{ effectType: "lut", params: { lut: "builtin-cyber-night", intensity: 100 } },
			{ effectType: "glitch", params: { intensity: 60 } },
			{ effectType: "chromatic-aberration", params: { amount: 8 } },
		],
	},
	{
		id: "dreamy-glow",
		name: "夢幻柔光",
		description: "日系清新調色 + 光暈",
		layers: [
			{ effectType: "lut", params: { lut: "builtin-japanese-fresh", intensity: 100 } },
			{ effectType: "glow", params: { intensity: 70, radius: 30 } },
		],
	},
];
