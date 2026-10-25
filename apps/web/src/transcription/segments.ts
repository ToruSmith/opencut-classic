import type { TranscriptionSegment } from "@/transcription/types";

const ONLY_PUNCTUATION_PATTERN = /^[\s\p{P}\p{S}]*$/u;
const MAX_CONSECUTIVE_REPEATS = 2;

/**
 * 清掉 Whisper 常見的壞輸出:空白或只有標點的片段,
 * 以及同一句話連續重複很多次(解碼陷入迴圈時會發生)。
 */
export function cleanSegments({
	segments,
}: {
	segments: TranscriptionSegment[];
}): TranscriptionSegment[] {
	const result: TranscriptionSegment[] = [];
	let lastText = "";
	let repeats = 0;

	for (const segment of segments) {
		const text = segment.text.trim();
		if (ONLY_PUNCTUATION_PATTERN.test(text)) continue;

		if (text === lastText) {
			repeats += 1;
			if (repeats >= MAX_CONSECUTIVE_REPEATS) continue;
		} else {
			lastText = text;
			repeats = 0;
		}
		result.push({ ...segment, text });
	}

	return result;
}
