import { MAX_RETIME_RATE, MIN_RETIME_RATE } from "./rate";

/**
 * 變速曲線(階梯式近似):把一段影片切成等長(以素材時間計)的 N 小段,每段套一個固定速度,
 * 速度依曲線逐段變化。純函式,不依賴 DOM / wasm。
 *
 * 為什麼不是連續曲線:retime 格式只有單一固定倍率,連續曲線要動專案格式,
 * 縮放 / 分割 / 裁切 / 音訊 / 代理檔都得跟著改;階梯式完全沿用既有的 retime。
 */

export const SPEED_RAMP_PROFILES = [
	"accelerate",
	"decelerate",
	"slow-middle",
	"fast-middle",
] as const;
export type SpeedRampProfile = (typeof SPEED_RAMP_PROFILES)[number];

/** 每一段的最短長度(秒),太短預覽會一直重新定位解碼 */
export const MIN_RAMP_PIECE_SECONDS = 0.1;
export const MIN_RAMP_SEGMENTS = 3;
export const MAX_RAMP_SEGMENTS = 24;
/** 強度 1 時最慢 / 最快相差 4 倍(1/4 ~ 4) */
const MAX_LOG_SWING = Math.log(4);

/** 曲線形狀,值域 -1..1(正 = 比平均快,負 = 比平均慢);u 為 0..1 的位置 */
export function profileShape({
	profile,
	u,
}: {
	profile: SpeedRampProfile;
	u: number;
}): number {
	const centered = 2 * u - 1;
	switch (profile) {
		case "accelerate":
			return centered;
		case "decelerate":
			return -centered;
		case "slow-middle":
			return 2 * centered * centered - 1;
		case "fast-middle":
			return 1 - 2 * centered * centered;
	}
}

export interface SpeedRampPiece {
	/** 這一段的絕對倍率(已含原本的倍率) */
	rate: number;
	/** 相對於整段開頭的秒數 */
	startOffsetSeconds: number;
	durationSeconds: number;
}

export type SpeedRampPlan =
	| { ok: true; pieces: SpeedRampPiece[]; minRate: number; maxRate: number }
	| { ok: false; reason: string };

/**
 * @param durationSeconds 原片段在時間軸上的長度
 * @param baseRate 原片段的倍率(整段共用,例如 1)
 * @param strength 0..1,1 = 最慢 / 最快相差 4 倍
 * 總長度不變:各段倍率同乘一個係數 k = mean(1/m)。
 */
export function planSpeedRamp({
	durationSeconds,
	baseRate,
	profile,
	strength,
	segments,
}: {
	durationSeconds: number;
	baseRate: number;
	profile: SpeedRampProfile;
	strength: number;
	segments: number;
}): SpeedRampPlan {
	const count = Math.round(segments);
	if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
		return { ok: false, reason: "片段長度無效" };
	}
	if (count < MIN_RAMP_SEGMENTS || count > MAX_RAMP_SEGMENTS) {
		return {
			ok: false,
			reason: `段數要在 ${MIN_RAMP_SEGMENTS}~${MAX_RAMP_SEGMENTS} 之間`,
		};
	}
	const safeStrength = Math.min(1, Math.max(0, strength));
	const safeBase = Number.isFinite(baseRate) && baseRate > 0 ? baseRate : 1;

	const multipliers = Array.from({ length: count }, (_, index) =>
		Math.exp(
			safeStrength *
				MAX_LOG_SWING *
				profileShape({ profile, u: (index + 0.5) / count }),
		),
	);
	const k = multipliers.reduce((sum, m) => sum + 1 / m, 0) / count;

	const rates = multipliers.map((m) => safeBase * m * k);
	const minRate = Math.min(...rates);
	const maxRate = Math.max(...rates);
	if (minRate < MIN_RETIME_RATE || maxRate > MAX_RETIME_RATE) {
		return {
			ok: false,
			reason: `最快會到 ${maxRate.toFixed(2)}x(上限 ${MAX_RETIME_RATE}x),請降低強度`,
		};
	}

	// 每段的素材長度相同 = durationSeconds * baseRate / count;顯示長度 = 素材長度 / 倍率
	const sourcePerPiece = (durationSeconds * safeBase) / count;
	const durations = rates.map((rate) => sourcePerPiece / rate);
	const shortest = Math.min(...durations);
	if (shortest < MIN_RAMP_PIECE_SECONDS) {
		return {
			ok: false,
			reason: `最短一段只有 ${shortest.toFixed(2)} 秒(下限 ${MIN_RAMP_PIECE_SECONDS} 秒),請減少段數或降低強度`,
		};
	}

	let offset = 0;
	const pieces = rates.map((rate, index) => {
		const piece = {
			rate,
			startOffsetSeconds: offset,
			durationSeconds: durations[index],
		};
		offset += durations[index];
		return piece;
	});
	return { ok: true, pieces, minRate, maxRate };
}
