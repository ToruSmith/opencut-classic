import EventEmitter from "eventemitter3";

import {
	Output,
	Mp4OutputFormat,
	WebMOutputFormat,
	BufferTarget,
	StreamTarget,
	CanvasSource,
	AudioBufferSource,
	QUALITY_LOW,
	QUALITY_MEDIUM,
	QUALITY_HIGH,
	QUALITY_VERY_HIGH,
} from "mediabunny";
import type { FrameRate } from "opencut-wasm";
import { mediaTimeToSeconds } from "opencut-wasm";
import { TICKS_PER_SECOND } from "@/wasm";
import { frameRateToFloat } from "@/fps/utils";
import type { RootNode } from "./nodes/root-node";
import type { ExportFormat, ExportQuality } from "@/export";
import type { TimelineAudioStream } from "@/media/audio-export";
import { CanvasRenderer } from "./canvas-renderer";

/** 音訊比影片多領先這麼多秒寫入,讓封裝器能順利交錯兩條軌 */
const AUDIO_LOOKAHEAD_SECONDS = 2;

type ExportParams = {
	width: number;
	height: number;
	fps: FrameRate;
	format: ExportFormat;
	quality: ExportQuality;
	shouldIncludeAudio?: boolean;
	audioStream?: TimelineAudioStream;
	writable?: FileSystemWritableFileStream;
};

const qualityMap = {
	low: QUALITY_LOW,
	medium: QUALITY_MEDIUM,
	high: QUALITY_HIGH,
	very_high: QUALITY_VERY_HIGH,
};

export type SceneExporterEvents = {
	progress: [progress: number];
	complete: [buffer: ArrayBuffer];
	error: [error: Error];
	cancelled: [];
};

export class SceneExporter extends EventEmitter<SceneExporterEvents> {
	private renderer: CanvasRenderer;
	private format: ExportFormat;
	private quality: ExportQuality;
	private shouldIncludeAudio: boolean;
	private audioStream?: TimelineAudioStream;
	private writable?: FileSystemWritableFileStream;

	private isCancelled = false;

	constructor({
		width,
		height,
		fps,
		format,
		quality,
		shouldIncludeAudio,
		audioStream,
		writable,
	}: ExportParams) {
		super();
		this.renderer = new CanvasRenderer({
			width,
			height,
			fps,
		});

		this.format = format;
		this.quality = quality;
		this.shouldIncludeAudio = shouldIncludeAudio ?? false;
		this.audioStream = audioStream;
		this.writable = writable;
	}

	cancel(): void {
		this.isCancelled = true;
	}

	async export({
		rootNode,
	}: {
		rootNode: RootNode;
	}): Promise<ArrayBuffer | null> {
		const fps = this.renderer.fps;
		const fpsFloat = frameRateToFloat(fps);
		const ticksPerFrame = Math.round(
			(TICKS_PER_SECOND * fps.denominator) / fps.numerator,
		);
		const frameCount = Math.floor(rootNode.duration / ticksPerFrame);

		const outputFormat =
			this.format === "webm" ? new WebMOutputFormat() : new Mp4OutputFormat();

		const output = new Output({
			format: outputFormat,
			target: this.writable
				? new StreamTarget(
						this.writable as unknown as WritableStream<{
							type: "write";
							data: Uint8Array;
							position: number;
						}>,
						{ chunked: true },
					)
				: new BufferTarget(),
		});

		const videoSource = new CanvasSource(this.renderer.getOutputCanvas(), {
			codec: this.format === "webm" ? "vp9" : "avc",
			bitrate: qualityMap[this.quality],
		});

		output.addVideoTrack(videoSource, { frameRate: fpsFloat });

		const audioStream = this.shouldIncludeAudio ? this.audioStream : undefined;
		let audioSource: AudioBufferSource | null = null;
		if (audioStream) {
			let audioCodec: "aac" | "opus" = this.format === "webm" ? "opus" : "aac";

			if (audioCodec === "aac" && typeof AudioEncoder !== "undefined") {
				const { supported } = await AudioEncoder.isConfigSupported({
					codec: "mp4a.40.2",
					sampleRate: audioStream.sampleRate,
					numberOfChannels: audioStream.numberOfChannels,
					bitrate: 192000,
				});
				if (!supported) audioCodec = "opus";
			}

			audioSource = new AudioBufferSource({
				codec: audioCodec,
				bitrate: qualityMap[this.quality],
			});
			output.addAudioTrack(audioSource);
		}

		await output.start();

		// 音訊一段一段混、一段一段編碼,記憶體用量不隨影片長度增加
		let audioSeconds = 0;
		let audioFinished = !audioStream || !audioSource;
		const pumpAudio = async ({ untilSeconds }: { untilSeconds: number }) => {
			while (!audioFinished && audioSeconds < untilSeconds) {
				if (this.isCancelled) return;
				const chunk = await audioStream?.nextChunk();
				if (!chunk) {
					audioFinished = true;
					audioSource?.close();
					return;
				}
				await audioSource?.add(chunk);
				audioSeconds += chunk.length / chunk.sampleRate;
			}
		};

		try {
			return await this.encodeFrames({
				rootNode,
				output,
				videoSource,
				frameCount,
				ticksPerFrame,
				fpsFloat,
				pumpAudio,
			});
		} finally {
			audioStream?.dispose();
		}
	}

	private async encodeFrames({
		rootNode,
		output,
		videoSource,
		frameCount,
		ticksPerFrame,
		fpsFloat,
		pumpAudio,
	}: {
		rootNode: RootNode;
		output: Output;
		videoSource: CanvasSource;
		frameCount: number;
		ticksPerFrame: number;
		fpsFloat: number;
		pumpAudio: (args: { untilSeconds: number }) => Promise<void>;
	}): Promise<ArrayBuffer | null> {
		for (let i = 0; i < frameCount; i++) {
			if (this.isCancelled) {
				await output.cancel();
				this.emit("cancelled");
				return null;
			}

			const timeTicks = i * ticksPerFrame;
			const timeSeconds = mediaTimeToSeconds({ time: timeTicks });
			await pumpAudio({ untilSeconds: timeSeconds + AUDIO_LOOKAHEAD_SECONDS });
			await this.renderer.render({ node: rootNode, time: timeTicks });
			await videoSource.add(timeSeconds, 1 / fpsFloat);

			this.emit("progress", i / frameCount);
		}

		await pumpAudio({ untilSeconds: Number.POSITIVE_INFINITY });

		if (this.isCancelled) {
			await output.cancel();
			this.emit("cancelled");
			return null;
		}

		videoSource.close();
		await output.finalize();
		this.emit("progress", 1);

		if (this.writable) {
			this.emit("complete", new ArrayBuffer(0));
			return new ArrayBuffer(0);
		}

		const buffer = (output.target as BufferTarget).buffer;
		if (!buffer) {
			this.emit("error", new Error("Failed to export video"));
			return null;
		}

		this.emit("complete", buffer);
		return buffer;
	}
}
