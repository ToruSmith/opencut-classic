/**
 * 節拍 / 重音偵測(純函式,有測試)。
 *
 * 流程:音訊(單聲道)→ 每 512 個取樣算一塊「高頻能量」→ 取對數後的上升量(onset strength)
 * →(A) 挑出明顯的峰值當「重音」,或 (B) 用自相關估計速度(BPM),再找出最吻合的節拍格。
 *
 * 能量用「相鄰取樣的差」(一階高通)來算,對鼓點、撥弦這類瞬間起音比較敏感,低頻持續音(貝斯、鋪底)影響小。
 * 可以分段餵入(`OnsetAccumulator.push`),所以不必把整首歌放進記憶體。
 */

export const BEAT_HOP_SIZE = 512;

export class OnsetAccumulator {
	readonly frameRate: number;
	private readonly hop: number;
	private readonly energies: number[] = [];
	private previous = 0;
	private blockSum = 0;
	private blockCount = 0;

	constructor({ sampleRate, hop = BEAT_HOP_SIZE }: { sampleRate: number; hop?: number }) {
		this.hop = hop;
		this.frameRate = sampleRate / hop;
	}

	/** 餵入一段單聲道取樣 */
	push(samples: Float32Array): void {
		for (let i = 0; i < samples.length; i++) {
			const value = samples[i] ?? 0;
			const diff = value - this.previous;
			this.previous = value;
			this.blockSum += diff * diff;
			this.blockCount++;
			if (this.blockCount === this.hop) {
				this.energies.push(this.blockSum / this.hop);
				this.blockSum = 0;
				this.blockCount = 0;
			}
		}
	}

	/** 取得每塊的能量(最後不足一塊的部分丟掉) */
	finish(): Float32Array {
		return Float32Array.from(this.energies);
	}
}

/** 對數能量的正向上升量;靜音以下的雜訊會被壓到同一個底 */
export function onsetStrength({ energies }: { energies: Float32Array }): Float32Array {
	const strength = new Float32Array(energies.length);
	let maxEnergy = 0;
	for (const e of energies) if (e > maxEnergy) maxEnergy = e;
	if (maxEnergy <= 0) return strength;
	const floor = maxEnergy * 1e-5;
	let previous = Math.log(Math.max(energies[0] ?? 0, floor));
	for (let i = 1; i < energies.length; i++) {
		const current = Math.log(Math.max(energies[i], floor));
		strength[i] = Math.max(0, current - previous);
		previous = current;
	}
	return strength;
}

function mean(values: Float32Array): number {
	if (values.length === 0) return 0;
	let sum = 0;
	for (const v of values) sum += v;
	return sum / values.length;
}

/**
 * 挑出重音時間(秒)。
 * sensitivity 0..1:越高抓得越多。minGapSeconds:兩個重音最短間隔,太近的留下較強的。
 */
export function pickOnsets({
	strength,
	frameRate,
	sensitivity = 0.5,
	minGapSeconds = 0.15,
	hop = BEAT_HOP_SIZE,
	sampleRate,
}: {
	strength: Float32Array;
	frameRate: number;
	sensitivity?: number;
	minGapSeconds?: number;
	hop?: number;
	sampleRate: number;
}): number[] {
	const n = strength.length;
	if (n < 3) return [];
	const s = Math.min(1, Math.max(0, sensitivity));
	const multiplier = 3 - 1.8 * s; // 0 → 3.0,1 → 1.2
	const globalMean = mean(strength);
	if (globalMean <= 0) return [];

	const half = Math.max(1, Math.round(0.4 * frameRate));
	// 前綴和,快速取局部平均
	const prefix = new Float64Array(n + 1);
	for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + strength[i];
	const peakRadius = Math.max(1, Math.round(0.035 * frameRate));

	const candidates: Array<{ index: number; value: number }> = [];
	for (let i = 1; i < n - 1; i++) {
		const value = strength[i];
		if (value <= 0) continue;
		const lo = Math.max(0, i - half);
		const hi = Math.min(n, i + half + 1);
		const localMean = (prefix[hi] - prefix[lo]) / (hi - lo);
		if (value <= localMean * multiplier + globalMean * 0.5) continue;
		let isPeak = true;
		for (let j = Math.max(0, i - peakRadius); j <= Math.min(n - 1, i + peakRadius); j++) {
			if (j !== i && (strength[j] > value || (strength[j] === value && j < i))) {
				isPeak = false;
				break;
			}
		}
		if (isPeak) candidates.push({ index: i, value });
	}

	const minGapFrames = minGapSeconds * frameRate;
	const kept: number[] = [];
	for (const candidate of [...candidates].sort((a, b) => b.value - a.value)) {
		if (kept.every((index) => Math.abs(index - candidate.index) >= minGapFrames)) {
			kept.push(candidate.index);
		}
	}
	return kept.sort((a, b) => a - b).map((index) => (index * hop) / sampleRate);
}

export interface TempoEstimate {
	bpm: number;
	/** 第一拍的時間(秒) */
	phaseSeconds: number;
	/** 0..1,越高越有把握 */
	confidence: number;
}

function gridScore({
	strength,
	period,
	phase,
}: {
	strength: Float32Array;
	period: number;
	phase: number;
}): number {
	let score = 0;
	for (let position = phase; position < strength.length - 1; position += period) {
		const i = Math.round(position);
		score += Math.max(strength[i - 1] ?? 0, strength[i] ?? 0, strength[i + 1] ?? 0);
	}
	return score;
}

/** 用自相關估計速度,再微調速度與相位,讓節拍格貼合整首歌 */
export function estimateTempo({
	strength,
	frameRate,
	minBpm = 70,
	maxBpm = 180,
	hop = BEAT_HOP_SIZE,
	sampleRate,
}: {
	strength: Float32Array;
	frameRate: number;
	minBpm?: number;
	maxBpm?: number;
	hop?: number;
	sampleRate: number;
}): TempoEstimate | null {
	const n = strength.length;
	const minLag = Math.max(2, Math.floor((60 / maxBpm) * frameRate));
	const maxLag = Math.ceil((60 / minBpm) * frameRate);
	if (n < maxLag * 3) return null;

	const avg = mean(strength);
	if (avg <= 0) return null;
	const centered = new Float32Array(n);
	for (let i = 0; i < n; i++) centered[i] = strength[i] - avg;

	let zeroLag = 0;
	for (let i = 0; i < n; i++) zeroLag += centered[i] * centered[i];
	if (zeroLag <= 0) return null;

	const ac = new Float64Array(maxLag + 2);
	for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
		let sum = 0;
		for (let i = lag; i < n; i++) sum += centered[i] * centered[i - lag];
		ac[lag] = sum / (n - lag);
	}

	// 輕微偏好 120 BPM 附近,避免抓到半速 / 倍速
	let bestLag = -1;
	let bestValue = -Infinity;
	for (let lag = minLag; lag <= maxLag; lag++) {
		const bpm = (60 * frameRate) / lag;
		const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 1.2) ** 2);
		const value = ac[lag] * prior;
		if (value > bestValue) {
			bestValue = value;
			bestLag = lag;
		}
	}
	if (bestLag < 0 || ac[bestLag] <= 0) return null;

	// 拋物線內插取得小數的 lag
	const left = ac[bestLag - 1];
	const mid = ac[bestLag];
	const right = ac[bestLag + 1];
	const denominator = left - 2 * mid + right;
	const lagFraction = denominator < 0 ? (0.5 * (left - right)) / denominator : 0;
	const basePeriod = bestLag + Math.max(-0.5, Math.min(0.5, lagFraction));

	// 在 ±3% 內微調速度與相位,取節拍格分數最高者
	let best = { period: basePeriod, phase: 0, score: -1 };
	for (let k = -30; k <= 30; k++) {
		const period = basePeriod * (1 + k * 0.001);
		const phaseStep = Math.max(0.5, period / 64);
		for (let phase = 0; phase < period; phase += phaseStep) {
			const score = gridScore({ strength, period, phase });
			if (score > best.score) best = { period, phase, score };
		}
	}

	const bpm = (60 * frameRate) / best.period;
	return {
		bpm,
		phaseSeconds: (best.phase * hop) / sampleRate,
		confidence: Math.max(0, Math.min(1, ac[bestLag] / (zeroLag / n))),
	};
}

/** 依速度與起始相位排出整首歌的節拍時間(秒) */
export function buildBeatGrid({
	bpm,
	phaseSeconds,
	durationSeconds,
}: {
	bpm: number;
	phaseSeconds: number;
	durationSeconds: number;
}): number[] {
	if (!(bpm > 0) || !(durationSeconds > 0)) return [];
	const step = 60 / bpm;
	const beats: number[] = [];
	for (let t = Math.max(0, phaseSeconds); t < durationSeconds; t += step) beats.push(t);
	return beats;
}

export type BeatMode = "onsets" | "grid";

export interface BeatAnalysis {
	/** 標記時間(秒) */
	times: number[];
	/** 節拍格模式才有 */
	bpm?: number;
	confidence?: number;
}

export function analyzeBeats({
	energies,
	sampleRate,
	mode,
	sensitivity,
	durationSeconds,
	hop = BEAT_HOP_SIZE,
}: {
	energies: Float32Array;
	sampleRate: number;
	mode: BeatMode;
	sensitivity: number;
	durationSeconds: number;
	hop?: number;
}): BeatAnalysis {
	const frameRate = sampleRate / hop;
	const strength = onsetStrength({ energies });
	if (mode === "onsets") {
		return { times: pickOnsets({ strength, frameRate, sensitivity, hop, sampleRate }) };
	}
	const tempo = estimateTempo({ strength, frameRate, hop, sampleRate });
	if (!tempo) return { times: [] };
	return {
		times: buildBeatGrid({ bpm: tempo.bpm, phaseSeconds: tempo.phaseSeconds, durationSeconds }),
		bpm: tempo.bpm,
		confidence: tempo.confidence,
	};
}
