import type { SceneTracks } from "@/timeline";
import type { MediaAsset } from "@/media/types";
import {
	analyzeBeats,
	OnsetAccumulator,
	type BeatAnalysis,
	type BeatMode,
} from "@/media/beat-detect";
import { TICKS_PER_SECOND } from "@/wasm";

const ANALYSIS_SAMPLE_RATE = 22050;

/**
 * 分析時間軸混音後的聲音,回傳節拍 / 重音時間(秒,對應時間軸位置)。
 * 沿用匯出用的音訊串流(只解碼需要的範圍、一段一段處理),不會把整首歌放進記憶體。
 * 時間軸上沒有聲音時回傳 null。
 */
export async function analyzeTimelineBeats({
	tracks,
	mediaAssets,
	totalDuration,
	mode,
	sensitivity,
	minGapSeconds,
	onProgress,
	signal,
}: {
	tracks: SceneTracks;
	mediaAssets: MediaAsset[];
	/** ticks */
	totalDuration: number;
	mode: BeatMode;
	sensitivity: number;
	minGapSeconds?: number;
	onProgress?: (progress: number) => void;
	signal?: AbortSignal;
}): Promise<BeatAnalysis | null> {
	// 音訊匯出會用到 mediabunny,維持動態載入
	const { createTimelineAudioStream } = await import("@/media/audio-export");
	const stream = await createTimelineAudioStream({
		tracks,
		mediaAssets,
		duration: totalDuration,
		sampleRate: ANALYSIS_SAMPLE_RATE,
	});
	if (!stream) return null;

	const accumulator = new OnsetAccumulator({ sampleRate: stream.sampleRate });
	try {
		for (let chunk = await stream.nextChunk(); chunk; chunk = await stream.nextChunk()) {
			if (signal?.aborted) throw new DOMException("已取消", "AbortError");
			const channels = chunk.numberOfChannels;
			const mono = new Float32Array(chunk.length);
			for (let c = 0; c < channels; c++) {
				const data = chunk.getChannelData(c);
				for (let i = 0; i < data.length; i++) mono[i] += data[i] / channels;
			}
			accumulator.push(mono);
			onProgress?.(stream.progress);
			// 讓出主執行緒,畫面不會卡住
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
	} finally {
		stream.dispose();
	}

	return analyzeBeats({
		energies: accumulator.finish(),
		sampleRate: stream.sampleRate,
		mode,
		sensitivity,
		minGapSeconds,
		durationSeconds: totalDuration / TICKS_PER_SECOND,
	});
}
