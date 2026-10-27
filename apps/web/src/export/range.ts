/**
 * 範圍匯出的起迄換算(純函式,有測試)。
 * 起迄會對齊到影格邊界:影片從第 startFrame 格開始、共 frameCount 格,
 * 音訊用同樣對齊後的 tick 起迄,所以影片與音訊長度一致、不會差半格。
 */

export type ExportRangeResult =
	| {
			ok: true;
			startFrame: number;
			frameCount: number;
			/** 對齊影格後的起點 / 終點(tick) */
			startTicks: number;
			endTicks: number;
			/** 對齊影格後的起點 / 終點(秒),拿來組檔名 */
			startSeconds: number;
			endSeconds: number;
	  }
	| { ok: false; reason: string };

export function resolveExportRange({
	startSeconds,
	endSeconds,
	totalTicks,
	ticksPerFrame,
	ticksPerSecond,
}: {
	startSeconds: number;
	endSeconds: number;
	totalTicks: number;
	ticksPerFrame: number;
	ticksPerSecond: number;
}): ExportRangeResult {
	if (
		![startSeconds, endSeconds, totalTicks, ticksPerFrame, ticksPerSecond].every(
			Number.isFinite,
		) ||
		ticksPerFrame <= 0 ||
		ticksPerSecond <= 0
	) {
		return { ok: false, reason: "範圍不是有效的數字" };
	}
	if (startSeconds < 0) return { ok: false, reason: "起點不能是負的" };
	if (endSeconds <= startSeconds) return { ok: false, reason: "終點要大於起點" };

	const lastFrame = Math.floor(totalTicks / ticksPerFrame);
	const startFrame = Math.round((startSeconds * ticksPerSecond) / ticksPerFrame);
	const endFrame = Math.min(
		lastFrame,
		Math.round((endSeconds * ticksPerSecond) / ticksPerFrame),
	);
	if (startFrame >= lastFrame) return { ok: false, reason: "起點超過時間軸長度" };
	if (endFrame - startFrame < 1) return { ok: false, reason: "範圍太短,至少要一個影格" };

	const startTicks = startFrame * ticksPerFrame;
	const endTicks = endFrame * ticksPerFrame;
	return {
		ok: true,
		startFrame,
		frameCount: endFrame - startFrame,
		startTicks,
		endTicks,
		startSeconds: startTicks / ticksPerSecond,
		endSeconds: endTicks / ticksPerSecond,
	};
}

function formatClock({ seconds }: { seconds: number }): string {
	const whole = Math.floor(seconds);
	const minutes = Math.floor(whole / 60);
	const rest = whole % 60;
	return `${String(minutes).padStart(2, "0")}-${String(rest).padStart(2, "0")}`;
}

/** 檔名後綴,例如 `_00-12_00-45`(分-秒,無條件捨去到秒) */
export function formatRangeFileSuffix({
	startSeconds,
	endSeconds,
}: {
	startSeconds: number;
	endSeconds: number;
}): string {
	return `_${formatClock({ seconds: startSeconds })}_${formatClock({ seconds: endSeconds })}`;
}
