import type { MediaAsset } from "@/media/types";
import type { AudioElement, SceneTracks, VideoElement } from "@/timeline";
import { LoudnessMeter, type LoudnessResult } from "@/media/loudness";

const MEASURE_SAMPLE_RATE = 24000;

/**
 * 量單一片段的響度。把片段複製成「音量 0 dB、不靜音、沒有淡化與音量關鍵影格」的版本,
 * 放進只有它自己的軌道,沿用匯出的音訊串流(含裁切、變速、單聲道 / 立體聲處理),
 * 所以量到的是這個片段在目前剪法下的原始響度,和它現在設定的音量無關。
 * 沒有可聽的聲音時回傳 null。
 */
export async function measureElementLoudness({
	element,
	mediaAssets,
}: {
	element: AudioElement | VideoElement;
	mediaAssets: MediaAsset[];
}): Promise<LoudnessResult | null> {
	const neutral = {
		...element,
		params: {
			...element.params,
			volume: 0,
			muted: false,
			audioFadeIn: 0,
			audioFadeOut: 0,
		},
		animations: undefined,
	} as typeof element;

	const emptyMain = {
		id: "loudness-main",
		name: "loudness-main",
		type: "video" as const,
		elements: [],
		muted: false,
		hidden: false,
	};
	const tracks: SceneTracks =
		neutral.type === "audio"
			? {
					overlay: [],
					main: emptyMain,
					audio: [
						{
							id: "loudness-audio",
							name: "loudness-audio",
							type: "audio",
							elements: [neutral as AudioElement],
							muted: false,
						},
					],
				}
			: {
					overlay: [],
					main: { ...emptyMain, elements: [neutral as VideoElement] },
					audio: [],
				};

	const { createTimelineAudioStream } = await import("@/media/audio-export");
	const stream = await createTimelineAudioStream({
		tracks,
		mediaAssets,
		startTime: element.startTime,
		duration: element.startTime + element.duration,
		sampleRate: MEASURE_SAMPLE_RATE,
	});
	if (!stream) return null;

	const meter = new LoudnessMeter({ sampleRate: stream.sampleRate });
	try {
		for (let chunk = await stream.nextChunk(); chunk; chunk = await stream.nextChunk()) {
			const channels: Float32Array[] = [];
			for (let c = 0; c < chunk.numberOfChannels; c++) channels.push(chunk.getChannelData(c));
			meter.push({ channels });
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
	} finally {
		stream.dispose();
	}
	return meter.finish();
}
