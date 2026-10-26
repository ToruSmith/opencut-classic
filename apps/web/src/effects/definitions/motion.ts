import type { EffectDefinition } from "@/effects/types";

/**
 * 動態 / 短影音常用效果:畫面震動、放射模糊、故障、鏡像。著色器在 rust/crates/effects/src/shaders/。
 * uniform 名稱必須和 pipeline.rs 的 pack_effect_uniforms 完全一致(多一個、少一個都會報錯)。
 *
 * 像素類參數以 1920 寬為基準,依實際寬度縮放:預覽用畫布大小、匯出用原始解析度,兩者看起來才會一樣。
 * 會動的效果用 `time`(片段開頭起算的秒數)驅動,預覽與匯出在同一時間點的畫面相同。
 */

export const CAMERA_SHAKE_SHADER = "camera-shake";
export const ZOOM_BLUR_SHADER = "zoom-blur";
export const GLITCH_SHADER = "glitch";
export const MIRROR_SHADER = "mirror";

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

/** 種子 0..999 的整數;shader 轉成 u32 */
function seedOf({ params }: { params: Record<string, unknown> }): number {
	return Math.round(clamp({ value: num({ params, key: "seed", fallback: 1 }), min: 0, max: 999 }));
}

export const cameraShakeEffectDefinition: EffectDefinition = {
	type: "camera-shake",
	name: "畫面震動",
	keywords: ["shake", "camera shake", "wiggle", "震動", "晃動", "抖動", "手持", "衝擊"],
	params: [
		{ key: "amount", label: "幅度", type: "number", default: 20, min: 0, max: 200, step: 1 },
		{ key: "speed", label: "速度", type: "number", default: 8, min: 0.5, max: 30, step: 0.5 },
		{ key: "rotation", label: "旋轉", type: "number", default: 1, min: 0, max: 15, step: 0.5 },
		{ key: "fill", label: "放大填滿(不露邊)", type: "boolean", default: true },
		{ key: "seed", label: "換一種晃法", type: "number", default: 1, min: 0, max: 999, step: 1 },
	],
	renderer: {
		passes: [
			{
				shader: CAMERA_SHAKE_SHADER,
				uniforms: ({ effectParams, width, time }) => {
					const p = effectParams as Record<string, unknown>;
					return {
						u_amount: scaleToWidth({
							pixels: clamp({ value: num({ params: p, key: "amount", fallback: 20 }), min: 0, max: 200 }),
							width,
						}),
						u_rotation: clamp({ value: num({ params: p, key: "rotation", fallback: 1 }), min: 0, max: 15 }),
						u_fill: p.fill === false ? 0 : 1,
						u_seed: seedOf({ params: p }),
						u_time: safeTime({ time }),
						u_speed: clamp({ value: num({ params: p, key: "speed", fallback: 8 }), min: 0, max: 30 }),
					};
				},
			},
		],
	},
};

export const zoomBlurEffectDefinition: EffectDefinition = {
	type: "zoom-blur",
	name: "放射模糊",
	keywords: ["zoom blur", "radial blur", "放射", "拉近", "衝擊", "速度感", "模糊"],
	params: [
		{ key: "strength", label: "強度", type: "number", default: 30, min: 0, max: 100, step: 1 },
		{ key: "centerX", label: "中心 X", type: "number", default: 50, min: 0, max: 100, step: 1 },
		{ key: "centerY", label: "中心 Y", type: "number", default: 50, min: 0, max: 100, step: 1 },
	],
	renderer: {
		passes: [
			{
				shader: ZOOM_BLUR_SHADER,
				uniforms: ({ effectParams }) => {
					const p = effectParams as Record<string, unknown>;
					return {
						u_strength:
							clamp({ value: num({ params: p, key: "strength", fallback: 30 }), min: 0, max: 100 }) / 100,
						u_center_x:
							clamp({ value: num({ params: p, key: "centerX", fallback: 50 }), min: 0, max: 100 }) / 100,
						u_center_y:
							clamp({ value: num({ params: p, key: "centerY", fallback: 50 }), min: 0, max: 100 }) / 100,
					};
				},
			},
		],
	},
};

export const glitchEffectDefinition: EffectDefinition = {
	type: "glitch",
	name: "故障",
	keywords: ["glitch", "digital", "error", "故障", "錯位", "訊號", "雜訊", "賽博"],
	params: [
		{ key: "intensity", label: "強度", type: "number", default: 50, min: 0, max: 100, step: 1 },
		{ key: "band", label: "條紋粗細", type: "number", default: 12, min: 2, max: 120, step: 1 },
		{ key: "shift", label: "錯位距離", type: "number", default: 80, min: 0, max: 400, step: 1 },
		{ key: "rate", label: "變化速度", type: "number", default: 12, min: 1, max: 30, step: 1 },
		{ key: "seed", label: "換一種花樣", type: "number", default: 1, min: 0, max: 999, step: 1 },
	],
	renderer: {
		passes: [
			{
				shader: GLITCH_SHADER,
				uniforms: ({ effectParams, width, time }) => {
					const p = effectParams as Record<string, unknown>;
					return {
						u_intensity:
							clamp({ value: num({ params: p, key: "intensity", fallback: 50 }), min: 0, max: 100 }) / 100,
						u_band: Math.max(
							1,
							scaleToWidth({
								pixels: clamp({ value: num({ params: p, key: "band", fallback: 12 }), min: 2, max: 120 }),
								width,
							}),
						),
						u_shift: scaleToWidth({
							pixels: clamp({ value: num({ params: p, key: "shift", fallback: 80 }), min: 0, max: 400 }),
							width,
						}),
						u_seed: seedOf({ params: p }),
						u_time: safeTime({ time }),
						u_rate: clamp({ value: num({ params: p, key: "rate", fallback: 12 }), min: 1, max: 30 }),
					};
				},
			},
		],
	},
};

const MIRROR_MODES: Record<string, number> = { horizontal: 0, vertical: 1, quad: 2 };

export const mirrorEffectDefinition: EffectDefinition = {
	type: "mirror",
	name: "鏡像",
	keywords: ["mirror", "symmetry", "kaleidoscope", "鏡像", "對稱", "萬花筒", "倒影"],
	params: [
		{
			key: "mode",
			label: "方式",
			type: "select",
			default: "horizontal",
			options: [
				{ value: "horizontal", label: "左右對稱" },
				{ value: "vertical", label: "上下對稱" },
				{ value: "quad", label: "四格對稱" },
			],
		},
		{ key: "flip", label: "保留另一半", type: "boolean", default: false },
	],
	renderer: {
		passes: [
			{
				shader: MIRROR_SHADER,
				uniforms: ({ effectParams }) => {
					const p = effectParams as Record<string, unknown>;
					return {
						u_mode: MIRROR_MODES[String(p.mode)] ?? 0,
						u_flip: p.flip === true ? 1 : 0,
					};
				},
			},
		],
	},
};
