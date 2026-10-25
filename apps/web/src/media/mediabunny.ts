import {
	Input,
	ALL_FORMATS,
	BlobSource,
	VideoSampleSink,
	type VideoCodec,
} from "mediabunny";
import { createTimelineAudioStream } from "@/media/audio-export";
import { floatToInterleavedPcm16 } from "@/media/audio-mixer";
import type { SceneTracks } from "@/timeline";
import type { MediaAsset } from "@/media/types";
import { TICKS_PER_SECOND } from "@/wasm";
import { renderThumbnailDataUrl } from "./thumbnail";

export type VideoFileData = {
	duration: number;
	width: number;
	height: number;
	fps: number;
	hasAudio: boolean;
	codec: VideoCodec | null;
	canDecode: boolean;
	thumbnailUrl: string | null;
};

export async function readVideoFile({
	file,
}: {
	file: File;
}): Promise<VideoFileData> {
	const input = new Input({
		source: new BlobSource(file),
		formats: ALL_FORMATS,
	});

	try {
		const duration = await input.computeDuration();
		const videoTrack = await input.getPrimaryVideoTrack();

		if (!videoTrack) {
			throw new Error("No video track found in the file");
		}

		const canDecode = await videoTrack.canDecode();
		const packetStats = await videoTrack.computePacketStats(100);
		const audioTrack = await input.getPrimaryAudioTrack();

		let thumbnailUrl: string | null = null;
		if (canDecode) {
			const sink = new VideoSampleSink(videoTrack);
			const frame = await sink.getSample(1);
			if (frame) {
				try {
					thumbnailUrl = renderThumbnailDataUrl({
						width: videoTrack.displayWidth,
						height: videoTrack.displayHeight,
						draw: ({ context, width, height }) => {
							frame.draw(context, 0, 0, width, height);
						},
					});
				} finally {
					frame.close();
				}
			}
		}

		return {
			duration,
			width: videoTrack.displayWidth,
			height: videoTrack.displayHeight,
			fps: packetStats.averagePacketRate,
			hasAudio: audioTrack !== null,
			codec: videoTrack.codec,
			canDecode,
			thumbnailUrl,
		};
	} finally {
		input.dispose();
	}
}

const SAMPLE_RATE = 44100;
const NUM_CHANNELS = 2;
const EMPTY_TIMELINE_SILENT_DURATION_SECONDS = 0.1;
const MIN_SILENT_DURATION_SECONDS = 0.001;
const WAV_HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;

export const extractTimelineAudio = async ({
	tracks,
	mediaAssets,
	totalDuration,
	onProgress,
}: {
	tracks: SceneTracks;
	mediaAssets: MediaAsset[];
	totalDuration: number;
	onProgress?: (progress: number) => void;
}): Promise<Blob> => {
	if (totalDuration === 0) {
		return createWavBlob({
			parts: [
				new ArrayBuffer(
					Math.ceil(SAMPLE_RATE * EMPTY_TIMELINE_SILENT_DURATION_SECONDS) *
						NUM_CHANNELS *
						BYTES_PER_SAMPLE,
				),
			],
		});
	}

	onProgress?.(10);

	const stream = await createTimelineAudioStream({
		tracks,
		mediaAssets,
		duration: totalDuration,
		sampleRate: SAMPLE_RATE,
	});

	if (!stream) {
		const silentDurationSeconds = Math.max(
			MIN_SILENT_DURATION_SECONDS,
			totalDuration / TICKS_PER_SECOND,
		);
		return createWavBlob({
			parts: [
				new ArrayBuffer(
					Math.ceil(silentDurationSeconds * SAMPLE_RATE) *
						NUM_CHANNELS *
						BYTES_PER_SAMPLE,
				),
			],
		});
	}

	// 一段一段轉成 16-bit PCM 收集起來,不需要先組出整段 32-bit 浮點音訊
	const parts: ArrayBuffer[] = [];
	try {
		for (let chunk = await stream.nextChunk(); chunk; ) {
			parts.push(
				floatToInterleavedPcm16({
					left: chunk.getChannelData(0),
					right: chunk.getChannelData(Math.min(1, chunk.numberOfChannels - 1)),
				}).buffer as ArrayBuffer,
			);
			onProgress?.(10 + stream.progress * 80);
			chunk = await stream.nextChunk();
		}
	} finally {
		stream.dispose();
	}

	onProgress?.(100);
	return createWavBlob({ parts });
};

function createWavBlob({ parts }: { parts: ArrayBuffer[] }): Blob {
	let dataSize = 0;
	for (const part of parts) dataSize += part.byteLength;

	const header = new ArrayBuffer(WAV_HEADER_BYTES);
	const view = new DataView(header);

	// riff header
	writeString({ view, offset: 0, str: "RIFF" });
	view.setUint32(4, 36 + dataSize, true);
	writeString({ view, offset: 8, str: "WAVE" });

	// fmt chunk
	writeString({ view, offset: 12, str: "fmt " });
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, NUM_CHANNELS, true);
	view.setUint32(24, SAMPLE_RATE, true);
	view.setUint32(28, SAMPLE_RATE * NUM_CHANNELS * BYTES_PER_SAMPLE, true);
	view.setUint16(32, NUM_CHANNELS * BYTES_PER_SAMPLE, true);
	view.setUint16(34, BYTES_PER_SAMPLE * 8, true);

	// data chunk
	writeString({ view, offset: 36, str: "data" });
	view.setUint32(40, dataSize, true);

	// Int16Array 以平台位元組序儲存;瀏覽器皆為小端,與 WAV 一致
	return new Blob([header, ...parts], { type: "audio/wav" });
}

function writeString({
	view,
	offset,
	str,
}: {
	view: DataView;
	offset: number;
	str: string;
}): void {
	for (let i = 0; i < str.length; i++) {
		view.setUint8(offset + i, str.charCodeAt(i));
	}
}
