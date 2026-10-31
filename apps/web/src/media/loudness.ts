/**
 * 響度量測與音量標準化(純函式,有測試)。
 *
 * 不是完整的 EBU R128:沒有 K 加權,用 400 ms 區塊的均方值(RMS)加上兩道門檻
 * (絕對 -50 dBFS、相對 -10 dB)排除靜音段,再取平均。對「把幾段素材調到差不多大聲」夠用,
 * 數字是 dBFS(滿刻度 = 0),不要和 LUFS 的絕對值直接比。
 */

export const LOUDNESS_BLOCK_SECONDS = 0.4;
export const ABSOLUTE_GATE_DB = -50;
export const RELATIVE_GATE_DB = -10;
export const DEFAULT_TARGET_DB = -16;
/** 調高音量時,峰值最多推到這裡(dBFS),避免削波 */
export const DEFAULT_PEAK_CEILING_DB = -1;

const SILENCE_DB = -120;

function linearPowerToDb({ power }: { power: number }): number {
	return power > 0 ? 10 * Math.log10(power) : SILENCE_DB;
}

export class LoudnessMeter {
	private readonly blockSamples: number;
	private blockSum = 0;
	private blockCount = 0;
	private readonly blocks: number[] = [];
	private peak = 0;

	constructor({ sampleRate }: { sampleRate: number }) {
		this.blockSamples = Math.max(1, Math.round(sampleRate * LOUDNESS_BLOCK_SECONDS));
	}

	/** 送入一段取樣(每個聲道各一個陣列,長度相同) */
	push({ channels }: { channels: Float32Array[] }): void {
		if (channels.length === 0) return;
		const length = channels[0].length;
		for (let i = 0; i < length; i++) {
			let power = 0;
			for (const channel of channels) {
				const value = channel[i];
				power += value * value;
				const abs = Math.abs(value);
				if (abs > this.peak) this.peak = abs;
			}
			this.blockSum += power / channels.length;
			this.blockCount++;
			if (this.blockCount >= this.blockSamples) {
				this.blocks.push(this.blockSum / this.blockCount);
				this.blockSum = 0;
				this.blockCount = 0;
			}
		}
	}

	finish(): LoudnessResult {
		// 不足一個區塊的尾巴:至少有半個區塊才算,否則整段太短時沒有結果
		if (this.blockCount >= this.blockSamples / 2) {
			this.blocks.push(this.blockSum / this.blockCount);
		}
		this.blockSum = 0;
		this.blockCount = 0;

		const peakDb = this.peak > 0 ? 20 * Math.log10(this.peak) : SILENCE_DB;
		const absoluteGate = Math.pow(10, ABSOLUTE_GATE_DB / 10);
		const afterAbsolute = this.blocks.filter((power) => power > absoluteGate);
		if (afterAbsolute.length === 0) {
			return { loudnessDb: null, peakDb, usedBlocks: 0, totalBlocks: this.blocks.length };
		}
		const meanPower = afterAbsolute.reduce((sum, p) => sum + p, 0) / afterAbsolute.length;
		const relativeGate = meanPower * Math.pow(10, RELATIVE_GATE_DB / 10);
		const gated = afterAbsolute.filter((power) => power > relativeGate);
		const finalPower = gated.reduce((sum, p) => sum + p, 0) / gated.length;
		return {
			loudnessDb: linearPowerToDb({ power: finalPower }),
			peakDb,
			usedBlocks: gated.length,
			totalBlocks: this.blocks.length,
		};
	}
}

export interface LoudnessResult {
	/** null = 整段太小聲或太短,量不出來 */
	loudnessDb: number | null;
	peakDb: number;
	usedBlocks: number;
	totalBlocks: number;
}

export type NormalizeAdjustment =
	| { ok: true; volumeDb: number; gainDb: number; limitedByPeak: boolean; clamped: boolean }
	| { ok: false; reason: string };

/**
 * 量測是在「音量 0 dB」的前提下做的(見 loudness-analysis.ts),
 * 所以新的音量 = 目標 - 量到的響度,再依峰值與音量範圍限制。
 */
export function computeNormalizeAdjustment({
	result,
	targetDb = DEFAULT_TARGET_DB,
	peakCeilingDb = DEFAULT_PEAK_CEILING_DB,
	minVolumeDb,
	maxVolumeDb,
}: {
	result: LoudnessResult;
	targetDb?: number;
	peakCeilingDb?: number;
	minVolumeDb: number;
	maxVolumeDb: number;
}): NormalizeAdjustment {
	if (result.loudnessDb === null) {
		return { ok: false, reason: "聲音太小或太短,量不出響度" };
	}
	let gainDb = targetDb - result.loudnessDb;
	let limitedByPeak = false;
	const peakRoom = peakCeilingDb - result.peakDb;
	if (gainDb > peakRoom) {
		gainDb = peakRoom;
		limitedByPeak = true;
	}
	const volumeDb = Math.min(maxVolumeDb, Math.max(minVolumeDb, gainDb));
	return {
		ok: true,
		volumeDb: Math.round(volumeDb * 100) / 100,
		gainDb,
		limitedByPeak,
		clamped: volumeDb !== gainDb,
	};
}
