import { parseAss } from "./ass";
import { parseLrc } from "./lrc";
import { parseSrt } from "./srt";
import type { ParseSubtitleResult } from "./types";
export type { ParseSubtitleResult, SubtitleCue } from "./types";

export function parseSubtitleFile({
	fileName,
	input,
}: {
	fileName: string;
	input: string;
}): ParseSubtitleResult {
	const extension = getFileExtension({ fileName });

	switch (extension) {
		case "srt":
			return parseSrt({ input });
		case "ass":
			return parseAss({ input });
		case "lrc":
			return parseLrc({ input });
		default:
			throw new Error("Unsupported subtitle format");
	}
}

function getFileExtension({ fileName }: { fileName: string }): string {
	const extension = fileName.split(".").pop();
	return extension?.toLowerCase() ?? "";
}
