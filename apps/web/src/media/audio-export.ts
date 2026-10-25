import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from "mediabunny";
import type { SceneTracks } from "@/timeline";
import type { MediaAsset } from "@/media/types";
import { collectAudibleCandidates } from "@/media/audio";
import {
	LookaheadLimiter,
	getSourceRangeForSegment,
	mixClipIntoSegment,
	type MixClip,
	type SourceWindow,
} from "@/media/audio-mixer";
import { mediaSupportsAudio } from "@/media/media-utils";
import {
	getSourceTimeAtClipTime,
	renderRetimedBuffer,
	shouldMaintainPitch,
} from "@/retime";
import {
	hasAnimatedVolume,
	isElementMuted,
	resolveEffectiveAudioGain,
	type AudioCapableElement,
} from "@/timeline/audio-state";
import { TICKS_PER_SECOND } from "@/wasm";

/** 每次混音的長度。越小越省記憶體,越大則解碼切換次數越少。 */
const MIX_SEGMENT_SECONDS = 5;
const EXPORT_SAMPLE_RATE = 44100;
const OUTPUT_CHANNELS = 2;
const RATE_EPSILON = 1e-6;

/**
 * 時間軸混音後的音訊串流。
 * 每次 nextChunk() 只混出一小段(預設 5 秒),讓匯出時記憶體用量
 * 與影片長度無關,只和「同時重疊的片段數」有關。
 */
export interface TimelineAudioStream {
	readonly sampleRate: number;
	readonly numberOfChannels: number;
	/** 已處理的比例,0~1 */
	readonly progress: number;
	/** 取得下一段;結束時回傳 null */
	nextChunk(): Promise<AudioBuffer | null>;
	/** 釋放解碼器與暫存。不論是否讀完都要呼叫。 */
	dispose(): void;
}

interface AudioSourceReader {
	/** 讀取來源中 [startSec, endSec] 的範圍;範圍之外沒有資料時回傳 null */
	read(range: { startSec: number; endSec: number }): Promise<SourceWindow | null>;
	dispose(): void;
}

function createBufferReader(buffer: AudioBuffer): AudioSourceReader {
	const channels: Float32Array[] = [];
	for (let c = 0; c < Math.min(OUTPUT_CHANNELS, buffer.numberOfChannels); c++) {
		channels.push(buffer.getChannelData(c));
	}
	const window: SourceWindow = {
		channels,
		sampleRate: buffer.sampleRate,
		startSec: 0,
	};
	return {
		read: async () => window,
		dispose: () => {},
	};
}

async function decodeWholeFile(file: Blob): Promise<AudioBuffer> {
	const arrayBuffer = await file.arrayBuffer();
	// OfflineAudioContext 只拿來解碼,不佔用即時音訊裝置
	const context = new OfflineAudioContext(
		OUTPUT_CHANNELS,
		1,
		EXPORT_SAMPLE_RATE,
	);
	return context.decodeAudioData(arrayBuffer);
}

/** 用 mediabunny 只解碼需要的範圍,整個檔案不會一次進記憶體 */
async function openMediaReader(file: File): Promise<AudioSourceReader | null> {
	const input = new Input({
		source: new BlobSource(file),
		formats: ALL_FORMATS,
	});

	const audioTrack = await input.getPrimaryAudioTrack();
	if (!audioTrack) {
		input.dispose();
		return null;
	}

	const sink = new AudioBufferSink(audioTrack);
	return {
		async read({ startSec, endSec }) {
			const chunks: Array<{ buffer: AudioBuffer; timestamp: number }> = [];
			for await (const wrapped of sink.buffers(
				Math.max(0, startSec),
				endSec,
			)) {
				chunks.push({ buffer: wrapped.buffer, timestamp: wrapped.timestamp });
			}
			if (chunks.length === 0) return null;

			const sampleRate = chunks[0].buffer.sampleRate;
			const channelCount = Math.min(
				OUTPUT_CHANNELS,
				chunks[0].buffer.numberOfChannels,
			);
			let totalSamples = 0;
			for (const { buffer } of chunks) totalSamples += buffer.length;

			const channels: Float32Array[] = Array.from(
				{ length: channelCount },
				() => new Float32Array(totalSamples),
			);
			let offset = 0;
			for (const { buffer } of chunks) {
				for (let c = 0; c < channelCount; c++) {
					channels[c].set(
						buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1)),
						offset,
					);
				}
				offset += buffer.length;
			}

			return { channels, sampleRate, startSec: chunks[0].timestamp };
		},
		dispose: () => input.dispose(),
	};
}

/**
 * 開啟一個檔案的音訊讀取器。
 * 優先走 mediabunny(分段解碼);音訊檔若失敗,退回瀏覽器的 decodeAudioData。
 */
async function openFileReader({
	file,
	allowWholeFileFallback,
}: {
	file: File;
	allowWholeFileFallback: boolean;
}): Promise<AudioSourceReader | null> {
	try {
		const reader = await openMediaReader(file);
		if (reader) return reader;
		if (!allowWholeFileFallback) return null;
	} catch (error) {
		if (!allowWholeFileFallback) {
			console.warn("Failed to open audio track:", error);
			return null;
		}
	}

	try {
		return createBufferReader(await decodeWholeFile(file));
	} catch (error) {
		console.warn("Failed to decode audio file:", error);
		return null;
	}
}

type ReaderFactory = () => Promise<AudioSourceReader | null>;

interface PlannedClip {
	key: string;
	openReader: ReaderFactory;
	element: AudioCapableElement;
	muted: boolean;
	/** 該片段在時間軸上的範圍(樣本) */
	startSample: number;
	endSample: number;
	/** 從來源讀取時使用 */
	trimStart: number;
	clipDuration: number;
	rate: number;
	/** 不做音高保持時,直接用線性內插混音 */
	mix: MixClip;
	/** 需要音高保持的片段,會先整段轉成一個 clipDuration 長度的緩衝 */
	bakePitch: boolean;
	baked?: { window: SourceWindow; mix: MixClip };
	dead: boolean;
}

function planClips({
	tracks,
	mediaAssets,
	sampleRate,
}: {
	tracks: SceneTracks;
	mediaAssets: MediaAsset[];
	sampleRate: number;
}): PlannedClip[] {
	const candidates = collectAudibleCandidates({ tracks, mediaAssets });
	const mediaMap = new Map(mediaAssets.map((asset) => [asset.id, asset]));
	const clips: PlannedClip[] = [];

	for (const { element, mediaAsset } of candidates) {
		let key: string;
		let openReader: ReaderFactory;

		if (element.type === "audio") {
			if (element.sourceType === "upload") {
				const asset = mediaMap.get(element.mediaId);
				if (!asset) continue;
				key = `asset:${asset.id}`;
				openReader = () =>
					openFileReader({
						file: asset.file,
						allowWholeFileFallback: asset.type === "audio",
					});
			} else if (element.buffer) {
				const buffer = element.buffer;
				key = `buffer:${element.id}`;
				openReader = async () => createBufferReader(buffer);
			} else {
				const { sourceUrl, name } = element;
				key = `url:${sourceUrl}`;
				openReader = async () => {
					try {
						const response = await fetch(sourceUrl);
						if (!response.ok) {
							throw new Error(`Library audio fetch failed: ${response.status}`);
						}
						const blob = await response.blob();
						const file = new File([blob], `${name}.mp3`, {
							type: blob.type || "audio/mpeg",
						});
						return await openFileReader({
							file,
							allowWholeFileFallback: true,
						});
					} catch (error) {
						console.warn("Failed to fetch library audio:", error);
						return null;
					}
				};
			}
		} else if (element.type === "video") {
			if (!mediaAsset || !mediaSupportsAudio({ media: mediaAsset })) continue;
			key = `asset:${mediaAsset.id}`;
			openReader = () =>
				openFileReader({
					file: mediaAsset.file,
					allowWholeFileFallback: false,
				});
		} else {
			continue;
		}

		const startTime = element.startTime / TICKS_PER_SECOND;
		const clipDuration = element.duration / TICKS_PER_SECOND;
		const trimStart = element.trimStart / TICKS_PER_SECOND;
		const retime = element.retime;
		const rate = retime?.rate ?? 1;
		const startSample = Math.floor(startTime * sampleRate);
		const renderedLength = Math.ceil(clipDuration * sampleRate);
		const volume = resolveEffectiveAudioGain({
			element,
			trackMuted: false,
			localTime: 0,
		});
		const animated = hasAnimatedVolume({ element });

		clips.push({
			key,
			openReader,
			element,
			muted: isElementMuted({ element }),
			startSample,
			endSample: startSample + renderedLength,
			trimStart,
			clipDuration,
			rate,
			bakePitch:
				shouldMaintainPitch({ rate, maintainPitch: retime?.maintainPitch }) &&
				Math.abs(rate - 1) > RATE_EPSILON,
			mix: {
				startSample,
				renderedLength,
				sourceTimeAt: (clipTime) =>
					trimStart + getSourceTimeAtClipTime({ clipTime, retime }),
				sourceEndSec: Number.POSITIVE_INFINITY,
				volume,
				gainAt: animated
					? (clipTime) =>
							resolveEffectiveAudioGain({ element, localTime: clipTime })
					: undefined,
			},
			dead: false,
		});
	}

	return clips;
}

export async function createTimelineAudioStream({
	tracks,
	mediaAssets,
	duration,
	sampleRate = EXPORT_SAMPLE_RATE,
	segmentSeconds = MIX_SEGMENT_SECONDS,
}: {
	tracks: SceneTracks;
	mediaAssets: MediaAsset[];
	/** 時間軸總長度(ticks) */
	duration: number;
	sampleRate?: number;
	segmentSeconds?: number;
}): Promise<TimelineAudioStream | null> {
	const clips = planClips({ tracks, mediaAssets, sampleRate });
	if (clips.length === 0) return null;

	const totalSamples = Math.ceil((duration / TICKS_PER_SECOND) * sampleRate);
	const limiter = new LookaheadLimiter({ sampleRate });
	// 限幅器有固定延遲:多送 latency 個靜音把尾巴推出來,再丟掉最前面 latency 個輸出
	const processedSamples = totalSamples + limiter.latency;
	const segmentSamples = Math.max(1, Math.round(segmentSeconds * sampleRate));
	const retimeContext = new OfflineAudioContext(
		OUTPUT_CHANNELS,
		1,
		sampleRate,
	);

	// 同一個來源的片段共用一個讀取器,最後一個片段用完就釋放
	const readers = new Map<string, Promise<AudioSourceReader | null>>();
	const lastSampleByKey = new Map<string, number>();
	for (const clip of clips) {
		lastSampleByKey.set(
			clip.key,
			Math.max(lastSampleByKey.get(clip.key) ?? 0, clip.endSample),
		);
	}

	const getReader = (clip: PlannedClip) => {
		let pending = readers.get(clip.key);
		if (!pending) {
			pending = clip.openReader().catch((error) => {
				console.warn("Failed to open audio source:", error);
				return null;
			});
			readers.set(clip.key, pending);
		}
		return pending;
	};

	const releaseFinished = async (upToSample: number) => {
		for (const [key, lastSample] of lastSampleByKey) {
			if (lastSample > upToSample) continue;
			const pending = readers.get(key);
			if (pending) {
				readers.delete(key);
				(await pending)?.dispose();
			}
			lastSampleByKey.delete(key);
		}
		for (const clip of clips) {
			if (clip.baked && clip.endSample <= upToSample) clip.baked = undefined;
		}
	};

	/** 音高保持:把這個片段需要的來源範圍轉成一個 clipDuration 長度的緩衝 */
	const bakeClip = async (clip: PlannedClip) => {
		const reader = await getReader(clip);
		if (!reader) return null;

		const sourceSpan = clip.clipDuration * clip.rate;
		const window = await reader.read({
			startSec: clip.trimStart,
			endSec: clip.trimStart + sourceSpan + 0.05,
		});
		if (!window || window.channels.length === 0) return null;

		const skip = Math.max(
			0,
			Math.round((clip.trimStart - window.startSec) * window.sampleRate),
		);
		const length = Math.max(1, window.channels[0].length - skip);
		const sourceBuffer = new AudioBuffer({
			numberOfChannels: window.channels.length,
			length,
			sampleRate: window.sampleRate,
		});
		for (let c = 0; c < window.channels.length; c++) {
			sourceBuffer.getChannelData(c).set(window.channels[c].subarray(skip));
		}

		const rendered = await renderRetimedBuffer({
			audioContext: retimeContext,
			sourceBuffer,
			trimStart: 0,
			clipDuration: clip.clipDuration,
			retime: clip.element.retime,
			maintainPitch: true,
		});

		const channels: Float32Array[] = [];
		for (let c = 0; c < rendered.numberOfChannels; c++) {
			channels.push(rendered.getChannelData(c));
		}
		return {
			window: {
				channels,
				sampleRate: rendered.sampleRate,
				startSec: 0,
			} satisfies SourceWindow,
			mix: {
				...clip.mix,
				sourceTimeAt: (clipTime: number) => clipTime,
			} satisfies MixClip,
		};
	};

	const mixClipSegment = async ({
		clip,
		output,
		segmentStart,
		segmentLength,
	}: {
		clip: PlannedClip;
		output: [Float32Array, Float32Array];
		segmentStart: number;
		segmentLength: number;
	}) => {
		if (clip.dead) return;

		if (clip.bakePitch) {
			if (!clip.baked) {
				const baked = await bakeClip(clip);
				if (!baked) {
					clip.dead = true;
					return;
				}
				clip.baked = baked;
			}
			mixClipIntoSegment({
				output,
				segmentStart,
				segmentLength,
				sampleRate,
				clip: clip.baked.mix,
				window: clip.baked.window,
			});
			return;
		}

		const range = getSourceRangeForSegment({
			segmentStart,
			segmentLength,
			sampleRate,
			clip: clip.mix,
		});
		if (!range) return;

		const reader = await getReader(clip);
		if (!reader) {
			clip.dead = true;
			return;
		}

		let window: SourceWindow | null;
		try {
			window = await reader.read(range);
		} catch (error) {
			console.warn("Failed to decode audio segment:", error);
			clip.dead = true;
			return;
		}
		if (!window) return;

		mixClipIntoSegment({
			output,
			segmentStart,
			segmentLength,
			sampleRate,
			clip: clip.mix,
			window,
		});
	};

	let cursor = 0;
	let samplesToDrop = limiter.latency;
	let disposed = false;

	const stream: TimelineAudioStream = {
		sampleRate,
		numberOfChannels: OUTPUT_CHANNELS,
		get progress() {
			return Math.min(1, cursor / processedSamples);
		},
		async nextChunk() {
			while (!disposed && cursor < processedSamples) {
				const segmentStart = cursor;
				const length = Math.min(segmentSamples, processedSamples - segmentStart);
				const left = new Float32Array(length);
				const right = new Float32Array(length);

				// 只有 totalSamples 之內才有內容,之後是限幅器的收尾靜音
				const mixLength = Math.min(length, totalSamples - segmentStart);
				if (mixLength > 0) {
					for (const clip of clips) {
						if (clip.muted) continue;
						if (clip.startSample >= segmentStart + mixLength) continue;
						if (clip.endSample <= segmentStart) continue;
						await mixClipSegment({
							clip,
							output: [left, right],
							segmentStart,
							segmentLength: mixLength,
						});
					}
				}

				limiter.process({ left, right });
				cursor += length;
				await releaseFinished(cursor);

				const from = Math.min(samplesToDrop, length);
				samplesToDrop -= from;
				if (from >= length) continue;

				const chunk = new AudioBuffer({
					numberOfChannels: OUTPUT_CHANNELS,
					length: length - from,
					sampleRate,
				});
				chunk.getChannelData(0).set(left.subarray(from));
				chunk.getChannelData(1).set(right.subarray(from));
				return chunk;
			}
			return null;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const clip of clips) clip.baked = undefined;
			const pendingReaders = [...readers.values()];
			readers.clear();
			for (const pending of pendingReaders) {
				void pending.then((reader) => reader?.dispose());
			}
		},
	};

	return stream;
}
