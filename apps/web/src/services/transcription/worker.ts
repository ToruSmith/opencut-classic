import {
	pipeline,
	type AutomaticSpeechRecognitionPipeline,
	type AutomaticSpeechRecognitionOutput,
} from "@huggingface/transformers";
import type { TranscriptionSegment } from "@/transcription/types";
import {
	DEFAULT_CHUNK_LENGTH_SECONDS,
	DEFAULT_STRIDE_SECONDS,
	DEFAULT_TRANSCRIPTION_SAMPLE_RATE,
} from "@/transcription/audio";
import { cleanSegments } from "@/transcription/segments";
import { isWindowSilent, planWindows } from "@/transcription/windows";

export type WorkerMessage =
	| { type: "init"; modelId: string }
	| { type: "transcribe"; audio: Float32Array; language: string }
	| { type: "cancel" };

export type WorkerResponse =
	| { type: "init-progress"; progress: number }
	| { type: "init-complete" }
	| { type: "init-error"; error: string }
	| { type: "transcribe-progress"; progress: number }
	| {
			type: "transcribe-complete";
			text: string;
			segments: TranscriptionSegment[];
	  }
	| { type: "transcribe-error"; error: string }
	| { type: "cancelled" };

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
/** 每次辨識遞增;取消時也遞增,讓舊的那一輪在下一個視窗前自行結束 */
let currentRun = 0;
let lastReportedProgress = -1;
const fileBytes = new Map<string, { loaded: number; total: number }>();

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
	const message = event.data;

	switch (message.type) {
		case "init":
			await handleInit({ modelId: message.modelId });
			break;
		case "transcribe":
			await handleTranscribe({
				audio: message.audio,
				language: message.language,
			});
			break;
		case "cancel":
			currentRun += 1;
			self.postMessage({ type: "cancelled" } satisfies WorkerResponse);
			break;
	}
};

async function handleInit({ modelId }: { modelId: string }) {
	lastReportedProgress = -1;
	fileBytes.clear();

	try {
		transcriber = (await pipeline("automatic-speech-recognition", modelId, {
			dtype: "q4",
			device: "auto",
			progress_callback: (progressInfo: {
				status?: string;
				file?: string;
				loaded?: number;
				total?: number;
			}) => {
				const file = progressInfo.file;
				if (!file) return;

				const loaded = progressInfo.loaded ?? 0;
				const total = progressInfo.total ?? 0;

				if (progressInfo.status === "progress" && total > 0) {
					fileBytes.set(file, { loaded, total });
				} else if (progressInfo.status === "done") {
					const existing = fileBytes.get(file);
					if (existing) {
						fileBytes.set(file, {
							loaded: existing.total,
							total: existing.total,
						});
					}
				}

				// sum all bytes
				let totalLoaded = 0;
				let totalSize = 0;
				for (const { loaded, total } of fileBytes.values()) {
					totalLoaded += loaded;
					totalSize += total;
				}

				if (totalSize === 0) return;

				const overallProgress = (totalLoaded / totalSize) * 100;
				const roundedProgress = Math.floor(overallProgress);

				if (roundedProgress !== lastReportedProgress) {
					lastReportedProgress = roundedProgress;
					self.postMessage({
						type: "init-progress",
						progress: roundedProgress,
					} satisfies WorkerResponse);
				}
			},
		})) as unknown as AutomaticSpeechRecognitionPipeline;

		self.postMessage({ type: "init-complete" } satisfies WorkerResponse);
	} catch (error) {
		self.postMessage({
			type: "init-error",
			error: error instanceof Error ? error.message : "Failed to load model",
		} satisfies WorkerResponse);
	}
}

async function handleTranscribe({
	audio,
	language,
}: {
	audio: Float32Array;
	language: string;
}) {
	if (!transcriber) {
		self.postMessage({
			type: "transcribe-error",
			error: "Model not initialized",
		} satisfies WorkerResponse);
		return;
	}

	currentRun += 1;
	const run = currentRun;
	const isCancelled = () => run !== currentRun;
	const sampleRate = DEFAULT_TRANSCRIPTION_SAMPLE_RATE;

	try {
		const windows = planWindows({ samples: audio, sampleRate });
		const segments: TranscriptionSegment[] = [];

		for (let index = 0; index < windows.length; index++) {
			if (isCancelled()) return;

			const window = windows[index];
			if (!isWindowSilent({ samples: audio, window })) {
				const offsetSeconds = window.start / sampleRate;
				const windowSeconds = (window.end - window.start) / sampleRate;

				const rawResult = await transcriber(
					audio.subarray(window.start, window.end),
					{
						chunk_length_s: DEFAULT_CHUNK_LENGTH_SECONDS,
						stride_length_s: DEFAULT_STRIDE_SECONDS,
						// transformers.js 沒指定語言時會直接當英文處理,並不會自動偵測
						language: language === "auto" ? undefined : language,
						task: "transcribe",
						return_timestamps: true,
					},
				);
				if (isCancelled()) return;

				const result: AutomaticSpeechRecognitionOutput = Array.isArray(
					rawResult,
				)
					? rawResult[0]
					: rawResult;

				for (const chunk of result.chunks ?? []) {
					if (!chunk.timestamp || chunk.timestamp.length < 1) continue;
					const start = chunk.timestamp[0] ?? 0;
					// 最後一段的結束時間可能是 null:用視窗尾端代替
					const end = chunk.timestamp[1] ?? windowSeconds;
					segments.push({
						text: chunk.text,
						start: offsetSeconds + start,
						end: offsetSeconds + Math.max(end, start),
					});
				}
			}

			self.postMessage({
				type: "transcribe-progress",
				progress: Math.round(((index + 1) / windows.length) * 100),
			} satisfies WorkerResponse);
		}

		const cleaned = cleanSegments({ segments });
		self.postMessage({
			type: "transcribe-complete",
			text: cleaned.map((segment) => segment.text).join(" "),
			segments: cleaned,
		} satisfies WorkerResponse);
	} catch (error) {
		if (isCancelled()) return;
		self.postMessage({
			type: "transcribe-error",
			error: error instanceof Error ? error.message : "Transcription failed",
		} satisfies WorkerResponse);
	}
}
