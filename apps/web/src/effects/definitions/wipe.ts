import type { EffectDefinition, EffectPass } from "@/effects/types";

/**
 * 擦除(線性 / 圓形光圈 / 時鐘)。把片段的圖層擦成透明、露出下面的畫面,
 * 「進度」參數可以做關鍵影格,所以不用動專案格式就能做出真正的擦除轉場。
 * 著色器在 rust/crates/effects/src/shaders/wipe.wgsl;uniform 名稱要和 pipeline.rs 完全一致。
 *
 * 進度 0 = 完全沒擦(畫面等於沒套效果),進度 100 = 擦完(全透明)。
 * 擦除是相對整個畫面(效果作用在畫面大小的圖層上),不是片段邊界。
 */

export const WIPE_SHADER = "wipe";

export const WIPE_KINDS = ["linear", "iris", "clock"] as const;
export type WipeKind = (typeof WIPE_KINDS)[number];

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

/** 把效果參數換算成 shader 的 uniform(純函式,有測試) */
export function buildWipeUniforms({
	effectParams,
}: {
	effectParams: Record<string, unknown>;
}): Record<string, number> {
	const index = WIPE_KINDS.indexOf(String(effectParams.mode) as WipeKind);
	const kindIndex = index >= 0 ? index : 0;
	return {
		u_mode: kindIndex + (effectParams.reverse === true ? 3 : 0),
		u_progress: clamp({ value: num({ params: effectParams, key: "progress", fallback: 0 }), min: 0, max: 100 }) / 100,
		u_softness: clamp({ value: num({ params: effectParams, key: "softness", fallback: 20 }), min: 0, max: 100 }) / 100,
		u_angle: clamp({ value: num({ params: effectParams, key: "angle", fallback: 0 }), min: 0, max: 360 }),
		u_center_x: clamp({ value: num({ params: effectParams, key: "centerX", fallback: 50 }), min: 0, max: 100 }) / 100,
		u_center_y: clamp({ value: num({ params: effectParams, key: "centerY", fallback: 50 }), min: 0, max: 100 }) / 100,
	};
}

export const wipeEffectDefinition: EffectDefinition = {
	type: "wipe",
	name: "擦除",
	keywords: ["wipe", "iris", "clock", "reveal", "transition", "擦除", "光圈", "時鐘", "轉場", "揭開"],
	params: [
		{
			key: "mode",
			label: "方式",
			type: "select",
			default: "linear",
			keyframable: false,
			options: [
				{ value: "linear", label: "線性擦除" },
				{ value: "iris", label: "圓形光圈" },
				{ value: "clock", label: "時鐘掃過" },
			],
		},
		{ key: "progress", label: "進度(%)", type: "number", default: 0, min: 0, max: 100, step: 1 },
		{ key: "softness", label: "柔邊", type: "number", default: 20, min: 0, max: 100, step: 1 },
		{
			key: "angle",
			label: "角度(線性方向 / 時鐘起點)",
			type: "number",
			default: 0,
			min: 0,
			max: 360,
			step: 1,
			keyframable: false,
		},
		{ key: "reverse", label: "反向", type: "boolean", default: false, keyframable: false },
		{ key: "centerX", label: "中心 X(光圈 / 時鐘)", type: "number", default: 50, min: 0, max: 100, step: 1, keyframable: false },
		{ key: "centerY", label: "中心 Y(光圈 / 時鐘)", type: "number", default: 50, min: 0, max: 100, step: 1, keyframable: false },
	],
	renderer: {
		passes: [
			{
				shader: WIPE_SHADER,
				uniforms: ({ effectParams }) =>
					buildWipeUniforms({ effectParams: effectParams as Record<string, unknown> }),
			},
		],
		// 進度為 0 = 畫面完全不變,不要白白多跑一個全畫面 pass(轉場以外的時間都是這種狀態)
		buildPasses: ({ effectParams }): EffectPass[] => {
			const uniforms = buildWipeUniforms({ effectParams: effectParams as Record<string, unknown> });
			if (uniforms.u_progress <= 0) return [];
			return [{ shader: WIPE_SHADER, uniforms }];
		},
	},
};
