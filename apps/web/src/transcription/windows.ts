/**
 * 把長音訊切成不超過 30 秒的視窗,交給 Whisper 一段一段辨識。
 *
 * 自己切而不是交給函式庫的內建分塊,是為了:
 *  - 每辨識完一段就能回報真實進度、也能中途取消;
 *  - 在安靜處下刀,避免把一個字切成兩半;
 *  - 整段幾乎無聲的視窗直接略過(Whisper 在靜音與音樂上容易憑空生出字幕)。
 *
 * 全部是純函式,可直接單元測試。
 */

export interface AudioWindow {
	/** 樣本索引(含) */
	start: number;
	/** 樣本索引(不含) */
	end: number;
}

const FRAME_SECONDS = 0.05;

function frameEnergy({
	samples,
	start,
	end,
}: {
	samples: Float32Array;
	start: number;
	end: number;
}): number {
	let sum = 0;
	for (let i = start; i < end; i++) sum += samples[i] * samples[i];
	return end > start ? sum / (end - start) : 0;
}

export function planWindows({
	samples,
	sampleRate,
	targetSeconds = 30,
	searchSeconds = 6,
}: {
	samples: Float32Array;
	sampleRate: number;
	/** 每個視窗的長度上限 */
	targetSeconds?: number;
	/** 在視窗尾端多長的範圍內找最安靜的地方下刀 */
	searchSeconds?: number;
}): AudioWindow[] {
	const total = samples.length;
	if (total === 0) return [];

	const target = Math.floor(targetSeconds * sampleRate);
	const search = Math.min(Math.floor(searchSeconds * sampleRate), target - 1);
	const frame = Math.max(1, Math.floor(FRAME_SECONDS * sampleRate));
	const windows: AudioWindow[] = [];

	let position = 0;
	while (position < total) {
		if (total - position <= target) {
			windows.push({ start: position, end: total });
			break;
		}

		const searchStart = position + target - search;
		const searchEnd = position + target;
		let bestStart = searchEnd - frame;
		let bestEnergy = Number.POSITIVE_INFINITY;
		for (let f = searchStart; f + frame <= searchEnd; f += frame) {
			const energy = frameEnergy({ samples, start: f, end: f + frame });
			// 能量相同時取較後面的,讓視窗盡量長
			if (energy <= bestEnergy) {
				bestEnergy = energy;
				bestStart = f;
			}
		}

		const cut = bestStart + Math.floor(frame / 2);
		windows.push({ start: position, end: cut });
		position = cut;
	}

	return windows;
}

export function isWindowSilent({
	samples,
	window,
	rmsThreshold = 0.002,
}: {
	samples: Float32Array;
	window: AudioWindow;
	rmsThreshold?: number;
}): boolean {
	const energy = frameEnergy({ samples, start: window.start, end: window.end });
	return Math.sqrt(energy) < rmsThreshold;
}
