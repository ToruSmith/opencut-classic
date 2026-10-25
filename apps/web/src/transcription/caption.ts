import type { TranscriptionSegment, CaptionChunk } from "@/transcription/types";
import {
	DEFAULT_CHARS_PER_CAPTION_CJK,
	DEFAULT_WORDS_PER_CAPTION,
	MIN_CAPTION_DURATION_SECONDS,
} from "@/transcription/caption-defaults";

const CJK_PATTERN = /[぀-ヿ㐀-鿿豈-﫿가-힯]/;
const CLAUSE_END_PATTERN = /[，。！？、；：,.!?;:…]/;
const TRAILING_PUNCTUATION_PATTERN = /[，。、；：,.;:]+$/;

interface CaptionPiece {
	text: string;
	/** 用來按比例分配時間的單位數(英文是字數,中日韓是字元數) */
	units: number;
}

/**
 * 中日韓文字沒有空格,不能用「幾個字」切。改成先在標點處斷開,
 * 再把相鄰的短句合併到每則不超過 maxChars 個字元,過長的句子則硬切。
 */
function splitCjkText({
	text,
	maxChars,
}: {
	text: string;
	maxChars: number;
}): CaptionPiece[] {
	const clauses: string[] = [];
	let current = "";
	for (const char of Array.from(text)) {
		current += char;
		if (CLAUSE_END_PATTERN.test(char)) {
			clauses.push(current);
			current = "";
		}
	}
	if (current) clauses.push(current);

	const pieces: string[] = [];
	let buffer = "";
	const flush = () => {
		if (buffer) pieces.push(buffer);
		buffer = "";
	};
	for (const clause of clauses) {
		const clauseChars = Array.from(clause);
		if (clauseChars.length > maxChars) {
			flush();
			// 過長的句子平均切開,避免最後留下一兩個字的孤兒字幕
			const parts = Math.ceil(clauseChars.length / maxChars);
			const size = Math.ceil(clauseChars.length / parts);
			for (let i = 0; i < clauseChars.length; i += size) {
				pieces.push(clauseChars.slice(i, i + size).join(""));
			}
			continue;
		}
		if (Array.from(buffer).length + clauseChars.length > maxChars) flush();
		buffer += clause;
	}
	flush();

	return pieces
		.map((piece) => piece.replace(TRAILING_PUNCTUATION_PATTERN, "").trim())
		.filter((piece) => piece.length > 0)
		.map((piece) => ({ text: piece, units: Array.from(piece).length }));
}

function splitIntoPieces({
	text,
	wordsPerChunk,
	charsPerChunkCjk,
}: {
	text: string;
	wordsPerChunk: number;
	charsPerChunkCjk: number;
}): CaptionPiece[] {
	const words = text.trim().split(/\s+/);
	if (words.length === 0 || (words.length === 1 && words[0] === "")) return [];

	const isUnspacedCjk =
		words.length === 1 &&
		CJK_PATTERN.test(words[0]) &&
		Array.from(words[0]).length > charsPerChunkCjk;
	if (isUnspacedCjk) {
		return splitCjkText({ text: words[0], maxChars: charsPerChunkCjk });
	}

	const pieces: CaptionPiece[] = [];
	for (let i = 0; i < words.length; i += wordsPerChunk) {
		const chunkWords = words.slice(i, i + wordsPerChunk);
		pieces.push({ text: chunkWords.join(" "), units: chunkWords.length });
	}
	return pieces;
}

export function buildCaptionChunks({
	segments,
	wordsPerChunk = DEFAULT_WORDS_PER_CAPTION,
	charsPerChunkCjk = DEFAULT_CHARS_PER_CAPTION_CJK,
	minDuration = MIN_CAPTION_DURATION_SECONDS,
}: {
	segments: TranscriptionSegment[];
	wordsPerChunk?: number;
	charsPerChunkCjk?: number;
	minDuration?: number;
}): CaptionChunk[] {
	const captions: CaptionChunk[] = [];
	let globalEndTime = 0;

	for (const segment of segments) {
		const pieces = splitIntoPieces({
			text: segment.text,
			wordsPerChunk,
			charsPerChunkCjk,
		});
		if (pieces.length === 0) continue;

		const segmentDuration = segment.end - segment.start;
		const totalUnits = pieces.reduce((sum, piece) => sum + piece.units, 0);
		const unitsPerSecond = totalUnits / segmentDuration;

		let chunkStartTime = segment.start;
		for (const piece of pieces) {
			const chunkDuration = Math.max(minDuration, piece.units / unitsPerSecond);
			const adjustedStartTime = Math.max(chunkStartTime, globalEndTime);

			captions.push({
				text: piece.text,
				startTime: adjustedStartTime,
				duration: chunkDuration,
			});

			globalEndTime = adjustedStartTime + chunkDuration;
			chunkStartTime += chunkDuration;
		}
	}

	return captions;
}
