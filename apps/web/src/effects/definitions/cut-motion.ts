import type { EffectDefinition } from "@/effects/types";

/**
 * 轉場運動:平移 / 縮放 / 旋轉 + 方向模糊,畫面外鏡像延伸(不露黑邊)。
 * 切點轉場(甩鏡、縮放衝入、旋轉甩入)對這些參數做關鍵影格;著色器在 rust/crates/effects/src/shaders/cut_motion.wgsl。
 *
 * 平移與模糊以「畫面寬 / 高的百分比」儲存,換算成像素時用實際渲染寬高,所以預覽(畫布大小)與匯出(原始解析度)看起來一樣。
 * 所有參數都是中性值時不送 pass(`skipWhen`),轉場以外的時間不多花 GPU。
 */

export const CUT_MOTION_SHADER = "cut-motion";

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

function safeSize({ value }: { value: number }): number {
	return Number.isFinite(value) && value > 0 ? value : 1920;
}

/** 純函式,有測試 */
export function buildCutMotionUniforms({
	effectParams,
	width,
	height,
}: {
	effectParams: Record<string, unknown>;
	width: number;
	height: number;
}): Record<string, number> {
	const w = safeSize({ value: width });
	const h = safeSize({ value: height });
	return {
		u_offset_x: (clamp({ value: num({ params: effectParams, key: "offsetX", fallback: 0 }), min: -200, max: 200 }) / 100) * w,
		u_offset_y: (clamp({ value: num({ params: effectParams, key: "offsetY", fallback: 0 }), min: -200, max: 200 }) / 100) * h,
		u_scale: clamp({ value: num({ params: effectParams, key: "scale", fallback: 100 }), min: 10, max: 400 }) / 100,
		u_rotation: clamp({ value: num({ params: effectParams, key: "rotation", fallback: 0 }), min: -360, max: 360 }),
		u_blur: (clamp({ value: num({ params: effectParams, key: "blur", fallback: 0 }), min: 0, max: 50 }) / 100) * w,
		u_blur_angle: num({ params: effectParams, key: "blurAngle", fallback: 0 }),
	};
}

/** 畫面完全不變(平移 0、縮放 1、旋轉 0、模糊不到半像素) */
export function isCutMotionIdentity({ uniforms }: { uniforms: Record<string, number> }): boolean {
	return (
		Math.abs(uniforms.u_offset_x) < 0.01 &&
		Math.abs(uniforms.u_offset_y) < 0.01 &&
		Math.abs(uniforms.u_scale - 1) < 0.0001 &&
		Math.abs(uniforms.u_rotation) < 0.001 &&
		uniforms.u_blur < 0.5
	);
}

export const cutMotionEffectDefinition: EffectDefinition = {
	type: "cut-motion",
	name: "轉場運動",
	keywords: ["whip", "pan", "motion blur", "directional blur", "甩鏡", "方向模糊", "動態模糊", "轉場", "鏡像延伸"],
	params: [
		{ key: "offsetX", label: "平移 X(畫面寬 %)", type: "number", default: 0, min: -200, max: 200, step: 1 },
		{ key: "offsetY", label: "平移 Y(畫面高 %)", type: "number", default: 0, min: -200, max: 200, step: 1 },
		{ key: "scale", label: "縮放(%)", type: "number", default: 100, min: 10, max: 400, step: 1 },
		{ key: "rotation", label: "旋轉(度)", type: "number", default: 0, min: -360, max: 360, step: 1 },
		{ key: "blur", label: "方向模糊(畫面寬 %)", type: "number", default: 0, min: 0, max: 50, step: 0.5 },
		{ key: "blurAngle", label: "模糊方向(度)", type: "number", default: 0, min: 0, max: 360, step: 1, keyframable: false },
	],
	renderer: {
		passes: [
			{
				shader: CUT_MOTION_SHADER,
				uniforms: ({ effectParams, width, height }) =>
					buildCutMotionUniforms({ effectParams: effectParams as Record<string, unknown>, width, height }),
			},
		],
		buildPasses: ({ effectParams, width, height }) => {
			const uniforms = buildCutMotionUniforms({
				effectParams: effectParams as Record<string, unknown>,
				width,
				height,
			});
			if (isCutMotionIdentity({ uniforms })) return [];
			return [{ shader: CUT_MOTION_SHADER, uniforms }];
		},
	},
};
