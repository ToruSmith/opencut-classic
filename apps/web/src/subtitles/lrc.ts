import { buildCuesFromTimedLines, type TimedLine } from "./timed-lines";
import type { ParseSubtitleResult } from "./types";

/**
 * LRC 歌詞檔:`[mm:ss.xx]歌詞`。
 * - `xx` 可以是 1~3 位;一行可以有多個時間戳(同一句出現多次)。
 * - `[offset:±ms]`:起點 = 時間戳 - offset / 1000(規格:正值讓歌詞提早出現)。
 * - 只有時間戳沒有文字的行 = 上一句在這裡結束。
 * - 逐字時間戳(Enhanced LRC 的 `<mm:ss.xx>`)去掉,只保留整句。
 * - `[ar:]`、`[ti:]` 等標頭資訊略過,不算壞行。
 */

const TIMESTAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/y;
const METADATA_LINE = /^\[[a-zA-Z#]+:[^\]]*\]\s*$/;
const OFFSET_LINE = /^\[offset:\s*([+-]?\d+)\s*\]\s*$/i;
const WORD_TIMESTAMP = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g;

function toSeconds({
	minutes,
	seconds,
	fraction,
}: {
	minutes: string;
	seconds: string;
	fraction: string | undefined;
}): number {
	const fractionSeconds = fraction
		? Number.parseInt(fraction.padEnd(3, "0"), 10) / 1000
		: 0;
	return (
		Number.parseInt(minutes, 10) * 60 +
		Number.parseInt(seconds, 10) +
		fractionSeconds
	);
}

export function parseLrc({ input }: { input: string }): ParseSubtitleResult {
	const normalized = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
	const warnings: string[] = [];
	let skippedCueCount = 0;
	let offsetSeconds = 0;
	const entries: TimedLine[] = [];

	for (const rawLine of normalized.split("\n")) {
		const line = rawLine.trim();
		if (!line) continue;

		const offsetMatch = line.match(OFFSET_LINE);
		if (offsetMatch) {
			offsetSeconds = Number.parseInt(offsetMatch[1], 10) / 1000;
			continue;
		}
		if (METADATA_LINE.test(line)) continue;

		const times: number[] = [];
		let cursor = 0;
		while (cursor < line.length) {
			TIMESTAMP.lastIndex = cursor;
			const match = TIMESTAMP.exec(line);
			if (!match) break;
			const [, minutes, seconds, fraction] = match;
			if (Number.parseInt(seconds, 10) >= 60) {
				// 秒數超過 59:當成壞行,整行略過
				times.length = 0;
				cursor = Number.POSITIVE_INFINITY;
				break;
			}
			times.push(toSeconds({ minutes, seconds, fraction }));
			cursor = TIMESTAMP.lastIndex;
		}

		if (times.length === 0) {
			skippedCueCount += 1;
			continue;
		}

		const text = line.slice(cursor).replace(WORD_TIMESTAMP, "").trim();
		for (const time of times) {
			entries.push({ time, text });
		}
	}

	// offset 在檔案裡可能出現在時間戳行之後,所以最後才套用
	const shifted = entries
		.map((entry) => ({ ...entry, time: entry.time - offsetSeconds }))
		.filter((entry) => entry.time >= 0 || entry.text === "");
	const dropped = entries.length - shifted.length;
	if (dropped > 0) {
		warnings.push(`有 ${dropped} 句因為 offset 讓開始時間變成負的,已略過。`);
	}

	const captions = buildCuesFromTimedLines({ lines: shifted });
	return { captions, skippedCueCount, warnings };
}
