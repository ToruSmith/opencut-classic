import type { CaptionChunk } from "@/transcription/types";

/**
 * 把字幕(開始秒數 + 長度 + 文字)寫成 SRT / LRC 文字檔。純函式,有測試。
 * 用途:在這裡對好時間(節拍、點拍同步)後匯出,交給 kinetic-lyric-console 之類的工具上動態效果,
 * 再把對方輸出的綠幕影片放回時間軸用「去背(綠幕)」疊上。
 */

function sortCues({ cues }: { cues: ReadonlyArray<CaptionChunk> }): CaptionChunk[] {
	return cues
		.filter((cue) => Number.isFinite(cue.startTime) && Number.isFinite(cue.duration) && cue.duration > 0)
		.map((cue) => ({ ...cue, startTime: Math.max(0, cue.startTime) }))
		.sort((a, b) => a.startTime - b.startTime);
}

function pad({ value, length }: { value: number; length: number }): string {
	return String(value).padStart(length, "0");
}

/** 秒 → `HH:MM:SS,mmm` */
export function formatSrtTime({ seconds }: { seconds: number }): string {
	const totalMs = Math.max(0, Math.round(seconds * 1000));
	const ms = totalMs % 1000;
	const totalSeconds = Math.floor(totalMs / 1000);
	const s = totalSeconds % 60;
	const m = Math.floor(totalSeconds / 60) % 60;
	const h = Math.floor(totalSeconds / 3600);
	return `${pad({ value: h, length: 2 })}:${pad({ value: m, length: 2 })}:${pad({ value: s, length: 2 })},${pad({ value: ms, length: 3 })}`;
}

/** 秒 → `mm:ss.xx`(LRC 用百分之一秒) */
export function formatLrcTime({ seconds }: { seconds: number }): string {
	const totalCs = Math.max(0, Math.round(seconds * 100));
	const cs = totalCs % 100;
	const totalSeconds = Math.floor(totalCs / 100);
	return `${pad({ value: Math.floor(totalSeconds / 60), length: 2 })}:${pad({ value: totalSeconds % 60, length: 2 })}.${pad({ value: cs, length: 2 })}`;
}

export function formatSrt({ cues }: { cues: ReadonlyArray<CaptionChunk> }): string {
	return sortCues({ cues })
		.map((cue, index) => {
			const text = cue.text.replace(/\r\n?/g, "\n").trim() || " ";
			return `${index + 1}\n${formatSrtTime({ seconds: cue.startTime })} --> ${formatSrtTime({ seconds: cue.startTime + cue.duration })}\n${text}\n`;
		})
		.join("\n");
}

/**
 * LRC 只有開始時間:每句寫一行;下一句開始前有空檔(> 0.05 秒)時,在句尾補一行只有時間戳的結束標記,
 * 讓讀回來的長度和原本一樣。多行字幕併成一行(以空白分隔),LRC 一行一句。
 */
export function formatLrc({ cues }: { cues: ReadonlyArray<CaptionChunk> }): string {
	const sorted = sortCues({ cues });
	const lines: string[] = [];
	sorted.forEach((cue, index) => {
		const end = cue.startTime + cue.duration;
		lines.push(`[${formatLrcTime({ seconds: cue.startTime })}]${cue.text.replace(/\s*\r?\n\s*/g, " ").trim()}`);
		const next = sorted[index + 1];
		if (!next || next.startTime - end > 0.05) {
			lines.push(`[${formatLrcTime({ seconds: end })}]`);
		}
	});
	return `${lines.join("\n")}\n`;
}
