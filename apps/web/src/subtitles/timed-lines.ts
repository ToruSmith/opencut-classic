import type { SubtitleCue } from "./types";

/** 最後一句(後面沒有下一句)的長度,秒 */
export const LAST_LINE_SECONDS = 4;
/** 單句最長秒數:避免前奏、間奏的長空白被拉成一句 */
export const MAX_LINE_SECONDS = 10;

export interface TimedLine {
	/** 開始時間,秒 */
	time: number;
	/** 空字串 = 只有時間戳的行,代表上一句在這裡結束 */
	text: string;
}

/**
 * 把「開始時間 + 文字」的清單轉成字幕:
 * 每句結束 = 下一個時間點(含空文字的結束標記);最後一句給固定長度;單句最長有上限。
 * 同一時間點的多行文字(原文 + 翻譯)合併成一則,以換行分隔。
 * 純函式,LRC 匯入與點拍同步共用。
 */
export function buildCuesFromTimedLines({
	lines,
	lastLineSeconds = LAST_LINE_SECONDS,
	maxLineSeconds = MAX_LINE_SECONDS,
}: {
	lines: ReadonlyArray<TimedLine>;
	lastLineSeconds?: number;
	maxLineSeconds?: number;
}): SubtitleCue[] {
	const valid = lines.filter((line) => Number.isFinite(line.time));
	// 穩定排序:同一時間點維持檔案裡的先後順序
	const sorted = valid
		.map((line, index) => ({ line, index }))
		.sort((a, b) => a.line.time - b.line.time || a.index - b.index)
		.map((entry) => entry.line);

	// 同一時間點合併成一個時間槽
	const slots: Array<{ time: number; texts: string[] }> = [];
	for (const line of sorted) {
		const last = slots[slots.length - 1];
		if (last && last.time === line.time) {
			if (line.text) last.texts.push(line.text);
			continue;
		}
		slots.push({ time: line.time, texts: line.text ? [line.text] : [] });
	}

	const cues: SubtitleCue[] = [];
	slots.forEach((slot, index) => {
		if (slot.texts.length === 0) return;
		const next = slots[index + 1];
		const naturalEnd = next ? next.time : slot.time + lastLineSeconds;
		const duration = Math.min(naturalEnd - slot.time, maxLineSeconds);
		if (!(duration > 0)) return;
		cues.push({
			text: slot.texts.join("\n"),
			startTime: slot.time,
			duration,
		});
	});
	return cues;
}

/** 把貼上的歌詞切成句子:去頭尾空白、略過空行 */
export function splitLyricLines({ input }: { input: string }): string[] {
	return input
		.replace(/^﻿/, "")
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

/**
 * 點拍同步:第 i 次按鍵的時間就是第 i 句的開始時間。
 * 如果按鍵次數比句數多一次,多出來的那一次是「最後一句的結束點」。
 * 句數比按鍵多時,只產生已經打過時間的句子。
 */
export function buildCuesFromTaps({
	lines,
	taps,
}: {
	lines: ReadonlyArray<string>;
	taps: ReadonlyArray<number>;
}): SubtitleCue[] {
	const timed: TimedLine[] = [];
	const count = Math.min(lines.length, taps.length);
	for (let i = 0; i < count; i++) {
		timed.push({ time: taps[i], text: lines[i] });
	}
	if (taps.length > lines.length) {
		timed.push({ time: taps[lines.length], text: "" });
	}
	return buildCuesFromTimedLines({ lines: timed });
}
