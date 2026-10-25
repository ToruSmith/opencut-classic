/**
 * 匯出用的分段混音核心。
 *
 * 這個檔案刻意不依賴 DOM / Web Audio / 專案其他模組,
 * 只處理 Float32Array,方便單獨測試,也讓「分段結果 = 整段結果」可以被驗證。
 */

/** 一段已解碼的來源音訊。channels[0] 的第 0 個樣本位於 startSec 秒。 */
export interface SourceWindow {
	channels: Float32Array[];
	sampleRate: number;
	startSec: number;
}

export interface MixClip {
	/** 片段在輸出中的起點(樣本) */
	startSample: number;
	/** 片段在輸出中的長度(樣本) */
	renderedLength: number;
	/** 片段時間(秒) → 來源時間(秒) */
	sourceTimeAt: (clipTime: number) => number;
	/** 來源的總長度(秒),超過就不再混入;未知時傳 Infinity */
	sourceEndSec: number;
	/** 固定音量 */
	volume: number;
	/** 有音量關鍵影格時,逐樣本取得音量 */
	gainAt?: (clipTime: number) => number;
}

/**
 * 把一個片段中落在 [segmentStart, segmentStart + segmentLength) 的部分
 * 累加到 output(左右聲道)。取樣方式與舊的整段混音完全相同(線性內插)。
 */
export function mixClipIntoSegment({
	output,
	segmentStart,
	segmentLength,
	sampleRate,
	clip,
	window,
}: {
	output: [Float32Array, Float32Array];
	segmentStart: number;
	segmentLength: number;
	sampleRate: number;
	clip: MixClip;
	window: SourceWindow;
}): void {
	const firstIndex = Math.max(0, segmentStart - clip.startSample);
	const lastIndex = Math.min(
		clip.renderedLength,
		segmentStart + segmentLength - clip.startSample,
	);
	if (lastIndex <= firstIndex) return;

	const channelCount = window.channels.length;
	if (channelCount === 0) return;

	for (let channel = 0; channel < 2; channel++) {
		const outputData = output[channel];
		const sourceData = window.channels[Math.min(channel, channelCount - 1)];
		const sourceLength = sourceData.length;

		for (let i = firstIndex; i < lastIndex; i++) {
			const clipTime = i / sampleRate;
			const sourceTime = clip.sourceTimeAt(clipTime);
			if (sourceTime >= clip.sourceEndSec) break;

			const sourceIndex = (sourceTime - window.startSec) * window.sampleRate;
			if (sourceIndex < 0) continue;
			const lowerIndex = Math.floor(sourceIndex);
			if (lowerIndex >= sourceLength) break;

			const upperIndex = Math.min(sourceLength - 1, lowerIndex + 1);
			const fraction = sourceIndex - lowerIndex;
			const gain = clip.gainAt ? clip.gainAt(clipTime) : clip.volume;
			outputData[clip.startSample + i - segmentStart] +=
				(sourceData[lowerIndex] * (1 - fraction) +
					sourceData[upperIndex] * fraction) *
				gain;
		}
	}
}

/** 片段需要來源的哪一段時間(秒),含內插用的餘量 */
export function getSourceRangeForSegment({
	segmentStart,
	segmentLength,
	sampleRate,
	clip,
}: {
	segmentStart: number;
	segmentLength: number;
	sampleRate: number;
	clip: MixClip;
}): { startSec: number; endSec: number } | null {
	const firstIndex = Math.max(0, segmentStart - clip.startSample);
	const lastIndex = Math.min(
		clip.renderedLength,
		segmentStart + segmentLength - clip.startSample,
	);
	if (lastIndex <= firstIndex) return null;

	const a = clip.sourceTimeAt(firstIndex / sampleRate);
	const b = clip.sourceTimeAt(lastIndex / sampleRate);
	const margin = 0.05;
	return {
		startSec: Math.max(0, Math.min(a, b) - margin),
		endSec: Math.max(a, b) + margin,
	};
}

export const LIMITER_CEILING = 0.98;
const LIMITER_LOOKAHEAD_SECONDS = 0.002;
const LIMITER_RELEASE_SECONDS = 0.12;

/**
 * 串流式前視限幅器(look-ahead limiter)。
 *
 * - 輸出峰值保證不超過 ceiling,低於 ceiling 的聲音完全不動。
 * - 有 lookahead 的延遲:輸入 n 個樣本,輸出 n 個樣本,但內容比輸入晚 latency 個樣本。
 *   呼叫端要丟掉最前面 latency 個輸出,並在結尾多送 latency 個靜音把尾巴推出來。
 * - 狀態可跨區段延續,所以可以一段一段送,結果與一次送完相同。
 *
 * 做法:每個樣本需要的增益 g = min(1, ceiling / |x|);
 * 取過去 D+1 個樣本的最小值(滑動最小),套用「瞬間下降、慢速回升」的包絡線,
 * 再對 D+1 個值做平均得到平滑的增益曲線。因為平均的每一項都 ≤ 該樣本所需增益,
 * 所以不會超過天花板,也不會有硬切造成的爆音。
 */
export class LookaheadLimiter {
	readonly latency: number;
	private readonly ceiling: number;
	private readonly releaseCoeff: number;
	private readonly window: number;

	// 輸入延遲線(D+1 個樣本)
	private readonly delayL: Float32Array;
	private readonly delayR: Float32Array;
	// 滑動最小用的單調佇列(存索引與值)
	private readonly dequeIndex: Float64Array;
	private readonly dequeValue: Float64Array;
	private dequeHead = 0;
	private dequeSize = 0;
	// 包絡線後的值,以及它們的滾動總和
	private readonly envelope: Float64Array;
	private envelopeSum: number;
	private lastEnvelope = 1;
	private position = 0;

	constructor({
		sampleRate,
		ceiling = LIMITER_CEILING,
	}: {
		sampleRate: number;
		ceiling?: number;
	}) {
		this.ceiling = ceiling;
		this.latency = Math.max(1, Math.round(LIMITER_LOOKAHEAD_SECONDS * sampleRate));
		this.window = this.latency + 1;
		this.releaseCoeff = 1 - Math.exp(-1 / (LIMITER_RELEASE_SECONDS * sampleRate));
		this.delayL = new Float32Array(this.window);
		this.delayR = new Float32Array(this.window);
		this.dequeIndex = new Float64Array(this.window);
		this.dequeValue = new Float64Array(this.window);
		this.envelope = new Float64Array(this.window).fill(1);
		this.envelopeSum = this.window;
	}

	/** 就地處理;left / right 長度需相同。 */
	process({ left, right }: { left: Float32Array; right: Float32Array }): void {
		const size = this.window;

		for (let n = 0; n < left.length; n++) {
			const inL = left[n];
			const inR = right[n];
			const t = this.position;
			const slot = t % size;

			const peak = Math.max(Math.abs(inL), Math.abs(inR));
			const required = peak > this.ceiling ? this.ceiling / peak : 1;

			// 滑動最小:只保留 [t - D, t] 之內、且遞增的候選
			while (this.dequeSize > 0) {
				const tail = (this.dequeHead + this.dequeSize - 1) % size;
				if (this.dequeValue[tail] >= required) this.dequeSize--;
				else break;
			}
			const insert = (this.dequeHead + this.dequeSize) % size;
			this.dequeIndex[insert] = t;
			this.dequeValue[insert] = required;
			this.dequeSize++;
			while (this.dequeIndex[this.dequeHead] < t - this.latency) {
				this.dequeHead = (this.dequeHead + 1) % size;
				this.dequeSize--;
			}
			const windowMin = this.dequeValue[this.dequeHead];

			// 包絡線:立刻壓下去、慢慢放回來
			const released =
				this.lastEnvelope + (1 - this.lastEnvelope) * this.releaseCoeff;
			const envelope = windowMin < released ? windowMin : released;
			this.lastEnvelope = envelope;

			this.envelopeSum += envelope - this.envelope[slot];
			this.envelope[slot] = envelope;
			const gain = this.envelopeSum / size;

			// 先寫入目前樣本,再取出 D 個樣本之前的輸入(t - D ≡ t + 1 mod D + 1)
			this.delayL[slot] = inL;
			this.delayR[slot] = inR;
			const readSlot = (t + 1) % size;
			left[n] = this.delayL[readSlot] * gain;
			right[n] = this.delayR[readSlot] * gain;

			this.position = t + 1;
		}
	}
}

/** Float32 [-1, 1] → 交錯的 16-bit PCM(小端) */
export function floatToInterleavedPcm16({
	left,
	right,
}: {
	left: Float32Array;
	right: Float32Array;
}): Int16Array {
	const pcm = new Int16Array(left.length * 2);
	for (let i = 0; i < left.length; i++) {
		pcm[i * 2] = floatToInt16(left[i]);
		pcm[i * 2 + 1] = floatToInt16(right[i]);
	}
	return pcm;
}

function floatToInt16(value: number): number {
	const clamped = Math.max(-1, Math.min(1, value));
	return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
}
