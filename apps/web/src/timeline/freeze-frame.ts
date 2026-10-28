/**
 * 凍結影格(定格):在播放頭把影片切開,中間插入一段定格畫面,後面的片段往後推。
 * 純函式,只做驗證與長度計算,不碰 wasm 或編輯器狀態。
 *
 * 做法是不新增素材:定格段是同一支影片的複本,速度設成最慢的 0.01x,
 * 這樣 N 秒只前進 N × 0.01 秒的素材(3 秒 = 0.03 秒,約一格),畫面看起來就是定格。
 * 限制:最長 3 秒;高幀率素材(60fps 以上)在後半段可能多跳一格。
 */

import { MIN_RETIME_RATE } from "@/retime/rate";

export const FREEZE_RATE = MIN_RETIME_RATE;
export const FREEZE_MAX_SECONDS = 3;
/** 播放頭離片段頭尾至少多遠,否則切出來的片段太短 */
export const FREEZE_EDGE_SECONDS = 0.1;

export type FreezePlan =
	| {
			ok: true;
			/** 定格段在素材上前進的秒數 */
			sourceSpanSeconds: number;
	  }
	| { ok: false; reason: string };

export function planFreezeFrame({
	elementStart,
	elementDuration,
	playhead,
	freezeSeconds,
}: {
	elementStart: number;
	elementDuration: number;
	playhead: number;
	freezeSeconds: number;
}): FreezePlan {
	if (!(freezeSeconds > 0) || freezeSeconds > FREEZE_MAX_SECONDS) {
		return {
			ok: false,
			reason: `定格長度要在 0~${FREEZE_MAX_SECONDS} 秒之間`,
		};
	}
	const offset = playhead - elementStart;
	const epsilon = 1e-9;
	if (
		!(offset >= FREEZE_EDGE_SECONDS - epsilon) ||
		!(elementDuration - offset >= FREEZE_EDGE_SECONDS - epsilon)
	) {
		return {
			ok: false,
			reason: `請把播放頭移到這個片段中間(離頭尾至少 ${FREEZE_EDGE_SECONDS} 秒)`,
		};
	}
	return { ok: true, sourceSpanSeconds: freezeSeconds * FREEZE_RATE };
}
