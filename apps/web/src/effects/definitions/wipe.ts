import type { EffectDefinition, EffectPass } from "@/effects/types";

/**
 * 擦除(線性 / 光圈 / 時鐘 / 百葉窗 / 棋盤 / 菱形 / 噪點溶解 / 方塊崩落 / 對開)。把片段的圖層擦成透明、露出下面的畫面,
 * 「進度」參數可以做關鍵影格,所以不用動專案格式就能做出真正的擦除轉場。
 * 著色器在 rust/crates/effects/src/shaders/wipe.wgsl;uniform 名稱要和 pipeline.rs 完全一致。
 *
 * 進度 0 = 完全沒擦(畫面等於沒套效果),進度 100 = 擦完(全透明)。
 * 擦除是相對整個畫面(效果作用在畫面大小的圖層上),不是片段邊界。
 */

export const WIPE_SHADER = "wipe";

/** 順序 = shader 的模式編號,只能往後加 */
export const WIPE_KINDS = [
	"linear",
	"iris",
	"clock",
	"blinds",
	"checker",
	"diamond",
	"dissolve",
	"blocks",
	"split",
] as const;
export type WipeKind = (typeof WIPE_KINDS)[number];

/** 反向旗標:shader 的模式編號 + 16 */
export const WIPE_REVERSE_FLAG = 16;

/** 用「數量 / 種子」而不是中心點的模式 */
const PATTERN_KINDS: ReadonlySet<WipeKind> = new Set(["blinds", "checker", "dissolve", "blocks"]);
/** 用中心點的模式 */
const CENTERED_KINDS: ReadonlySet<WipeKind> = new Set(["iris", "clock", "diamond"]);

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
	const kind = WIPE_KINDS[kindIndex]!;
	return {
		u_mode: kindIndex + (effectParams.reverse === true ? WIPE_REVERSE_FLAG : 0),
		u_progress: clamp({ value: num({ params: effectParams, key: "progress", fallback: 0 }), min: 0, max: 100 }) / 100,
		u_softness: clamp({ value: num({ params: effectParams, key: "softness", fallback: 20 }), min: 0, max: 100 }) / 100,
		u_angle: clamp({ value: num({ params: effectParams, key: "angle", fallback: 0 }), min: 0, max: 360 }),
		// 同一組 uniform 三種用途:線性 = 掃過範圍的起點 / 終點,光圈 / 時鐘 / 菱形 = 中心 X / Y,
		// 百葉窗 / 棋盤 / 溶解 / 方塊 = 數量 / 種子(對開不用)
		...(PATTERN_KINDS.has(kind)
			? {
					u_center_x: Math.round(clamp({ value: num({ params: effectParams, key: "count", fallback: 8 }), min: 2, max: 40 })),
					u_center_y: clamp({ value: num({ params: effectParams, key: "seed", fallback: 0 }), min: 0, max: 999 }),
				}
			: !CENTERED_KINDS.has(kind)
			? {
					u_center_x: clamp({ value: num({ params: effectParams, key: "rangeStart", fallback: 0 }), min: 0, max: 100 }) / 100,
					u_center_y: clamp({ value: num({ params: effectParams, key: "rangeEnd", fallback: 100 }), min: 0, max: 100 }) / 100,
				}
			: {
					u_center_x: clamp({ value: num({ params: effectParams, key: "centerX", fallback: 50 }), min: 0, max: 100 }) / 100,
					u_center_y: clamp({ value: num({ params: effectParams, key: "centerY", fallback: 50 }), min: 0, max: 100 }) / 100,
				}),
	};
}

export const wipeEffectDefinition: EffectDefinition = {
	type: "wipe",
	name: "擦除",
	keywords: ["wipe", "iris", "clock", "blinds", "checker", "dissolve", "百葉窗", "棋盤", "溶解", "reveal", "transition", "擦除", "光圈", "時鐘", "轉場", "揭開"],
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
				{ value: "blinds", label: "百葉窗" },
				{ value: "checker", label: "棋盤" },
				{ value: "diamond", label: "菱形" },
				{ value: "dissolve", label: "噪點溶解" },
				{ value: "blocks", label: "方塊崩落" },
				{ value: "split", label: "對開" },
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
		{ key: "count", label: "數量(百葉窗 / 棋盤 / 溶解 / 方塊)", type: "number", default: 8, min: 2, max: 40, step: 1, keyframable: false },
		{ key: "seed", label: "種子(溶解 / 方塊)", type: "number", default: 0, min: 0, max: 999, step: 1, keyframable: false },
		{ key: "rangeStart", label: "線性掃過起點(%)", type: "number", default: 0, min: 0, max: 100, step: 1, keyframable: false },
		{ key: "rangeEnd", label: "線性掃過終點(%)", type: "number", default: 100, min: 0, max: 100, step: 1, keyframable: false },
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
