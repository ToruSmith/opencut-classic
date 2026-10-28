/**
 * 節拍脈衝(踩點縮放):每個節拍瞬間把畫面放大一點、再很快收回,AMV / PV 常用的「踩點」感。
 * 純函式,不碰 wasm 或編輯器狀態。只產生「相對基準縮放的倍率」關鍵影格,
 * 實際寫入(乘上片段目前的縮放)由 `BeatPulseCommand` 負責。
 */

/** 關鍵影格之間至少隔 1 格(1/60 秒),起跳那一格才是瞬間放大 */
export const PULSE_ATTACK_SECONDS = 1 / 60;
/** 相鄰兩個脈衝至少相隔多久;更密的節拍直接略過,不然會變成抖動 */
export const PULSE_MIN_GAP_SECONDS = 0.12;
/** 單一片段最多幾個脈衝(每個約 8 個關鍵影格) */
export const PULSE_MAX_COUNT = 150;

export interface PulseKeyframe {
	/** 相對片段開頭的秒數 */
	seconds: number;
	/** 相對基準縮放的倍率(1 = 原本大小) */
	factor: number;
}

export type PulsePlan =
	| { ok: true; keyframes: PulseKeyframe[]; pulses: number; skipped: number }
	| { ok: false; reason: string };

/**
 * @param beats 時間軸上的節拍時間(秒)
 * @param every 每幾拍一次(1 = 每拍)
 * @param strength 放大幅度(0.08 = 放大 8%)
 * @param decaySeconds 收回需要的時間上限(實際不會超過到下一拍的空間)
 */
export function planBeatPulse({
	beats,
	clipStart,
	clipDuration,
	every,
	strength,
	decaySeconds,
}: {
	beats: ReadonlyArray<number>;
	clipStart: number;
	clipDuration: number;
	every: number;
	strength: number;
	decaySeconds: number;
}): PulsePlan {
	if (!(clipDuration > 0)) return { ok: false, reason: "片段長度無效" };
	if (!(strength > 0)) return { ok: false, reason: "幅度要大於 0" };
	const step = Math.max(1, Math.round(every));
	const decay = Math.max(0.05, decaySeconds);

	const inClip = beats
		.map((time) => time - clipStart)
		.filter((time) => time >= 0 && time < clipDuration)
		.sort((a, b) => a - b);
	if (inClip.length === 0) {
		return { ok: false, reason: "選取的片段範圍內沒有節拍標記" };
	}

	// 每 N 拍取一個,再丟掉太密的
	const picked: number[] = [];
	for (let index = 0; index < inClip.length; index += step) {
		const time = inClip[index]!;
		const last = picked[picked.length - 1];
		if (last !== undefined && time - last < PULSE_MIN_GAP_SECONDS) continue;
		picked.push(time);
	}
	const skipped = Math.max(0, picked.length - PULSE_MAX_COUNT);
	const times = picked.slice(0, PULSE_MAX_COUNT);

	const keyframes: PulseKeyframe[] = [];
	times.forEach((time, index) => {
		const nextTime = times[index + 1];
		const room =
			(nextTime ?? clipDuration) - time - PULSE_ATTACK_SECONDS * 1.5;
		const span = Math.min(decay, room);
		if (!(span > 0.02)) return;

		// 起跳前一格維持原大小,下一格瞬間放大
		if (time - PULSE_ATTACK_SECONDS > 0) {
			keyframes.push({ seconds: time - PULSE_ATTACK_SECONDS, factor: 1 });
		}
		keyframes.push({ seconds: time, factor: 1 + strength });
		// 先快後慢地收回(中間點在 25% 時間、還剩 40% 的幅度)
		keyframes.push({ seconds: time + span * 0.25, factor: 1 + strength * 0.4 });
		keyframes.push({ seconds: time + span, factor: 1 });
	});
	if (keyframes.length === 0) {
		return { ok: false, reason: "節拍太密或離片段結尾太近,沒有可做的脈衝" };
	}
	return {
		ok: true,
		keyframes,
		pulses: times.length,
		skipped,
	};
}
