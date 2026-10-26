/**
 * 片段音訊的淡入 / 淡出(秒),存在 `element.params.audioFadeIn` / `audioFadeOut`。
 *
 * 純函式:不碰 wasm,可以直接單元測試。
 * 和音量關鍵影格分開:最後的增益 = 音量(含關鍵影格) × 淡化係數。
 * 曲線用「等功率」(sin),中點約 -3 dB,聽感比直線自然,也是主流剪輯軟體的預設。
 */

export const AUDIO_FADE_IN_KEY = "audioFadeIn";
export const AUDIO_FADE_OUT_KEY = "audioFadeOut";
/** 面板與拖曳把手的上限;實際長度還會被片段長度限制 */
export const AUDIO_FADE_MAX_SECONDS = 10;

function readSeconds({
	params,
	key,
}: {
	params: Record<string, unknown>;
	key: string;
}): number {
	const value = params[key];
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: 0;
}

/**
 * 實際生效的淡入 / 淡出長度。
 * 兩者加起來超過片段長度時,按比例縮短(片段被修短後也不會互相重疊)。
 */
export function getAudioFades({
	params,
	durationSeconds,
}: {
	params: Record<string, unknown>;
	durationSeconds: number;
}): { fadeIn: number; fadeOut: number } {
	const duration = Math.max(0, durationSeconds);
	let fadeIn = readSeconds({ params, key: AUDIO_FADE_IN_KEY });
	let fadeOut = readSeconds({ params, key: AUDIO_FADE_OUT_KEY });
	const total = fadeIn + fadeOut;
	if (total > duration && total > 0) {
		const scale = duration / total;
		fadeIn *= scale;
		fadeOut *= scale;
	}
	return { fadeIn, fadeOut };
}

export function hasAudioFade({
	params,
}: {
	params: Record<string, unknown>;
}): boolean {
	return (
		readSeconds({ params, key: AUDIO_FADE_IN_KEY }) > 0 ||
		readSeconds({ params, key: AUDIO_FADE_OUT_KEY }) > 0
	);
}

function equalPower(progress: number): number {
	const p = Math.min(1, Math.max(0, progress));
	return Math.sin((p * Math.PI) / 2);
}

/** 片段內某個時間點(秒,相對片段開頭)的淡化係數,0..1 */
export function audioFadeGain({
	params,
	durationSeconds,
	localTime,
}: {
	params: Record<string, unknown>;
	durationSeconds: number;
	localTime: number;
}): number {
	const { fadeIn, fadeOut } = getAudioFades({ params, durationSeconds });
	let gain = 1;
	if (fadeIn > 0 && localTime < fadeIn) {
		gain *= equalPower(localTime / fadeIn);
	}
	const remaining = durationSeconds - localTime;
	if (fadeOut > 0 && remaining < fadeOut) {
		gain *= equalPower(remaining / fadeOut);
	}
	return gain;
}

/**
 * 分割片段時:左半保留淡入、右半保留淡出。
 * 不處理的話兩半都會帶著淡入與淡出,分割點會突然出現一段靜音。
 */
export function splitAudioFadeParams<TParams extends Record<string, unknown>>({
	params,
}: {
	params: TParams;
}): { left: TParams; right: TParams } {
	const left = { ...params };
	const right = { ...params };
	delete left[AUDIO_FADE_OUT_KEY];
	delete right[AUDIO_FADE_IN_KEY];
	return { left, right };
}
