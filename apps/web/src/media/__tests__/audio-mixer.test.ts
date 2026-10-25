import { describe, expect, test } from "bun:test";
import {
	LIMITER_CEILING,
	LookaheadLimiter,
	floatToInterleavedPcm16,
	getSourceRangeForSegment,
	mixClipIntoSegment,
	type MixClip,
	type SourceWindow,
} from "../audio-mixer";

const SAMPLE_RATE = 44100;

function makeSignal({
	length,
	frequency,
	amplitude,
	sampleRate = SAMPLE_RATE,
}: {
	length: number;
	frequency: number;
	amplitude: number;
	sampleRate?: number;
}): Float32Array {
	const data = new Float32Array(length);
	for (let i = 0; i < length; i++) {
		data[i] = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * amplitude;
	}
	return data;
}

/** 舊版整段混音(media/audio.ts 的 mixAudioChannels)的對照實作 */
function referenceMix({
	outputLength,
	clip,
	source,
}: {
	outputLength: number;
	clip: MixClip;
	source: SourceWindow;
}): [Float32Array, Float32Array] {
	const out: [Float32Array, Float32Array] = [
		new Float32Array(outputLength),
		new Float32Array(outputLength),
	];
	for (let channel = 0; channel < 2; channel++) {
		const sourceData =
			source.channels[Math.min(channel, source.channels.length - 1)];
		for (let i = 0; i < clip.renderedLength; i++) {
			const outputIndex = clip.startSample + i;
			if (outputIndex >= outputLength) break;
			const clipTime = i / SAMPLE_RATE;
			const sourceTime = clip.sourceTimeAt(clipTime);
			const sourceIndex = sourceTime * source.sampleRate;
			if (sourceIndex >= sourceData.length) break;
			const lower = Math.floor(sourceIndex);
			const upper = Math.min(sourceData.length - 1, lower + 1);
			const fraction = sourceIndex - lower;
			const gain = clip.gainAt ? clip.gainAt(clipTime) : clip.volume;
			out[channel][outputIndex] +=
				(sourceData[lower] * (1 - fraction) + sourceData[upper] * fraction) *
				gain;
		}
	}
	return out;
}

function mixSegmented({
	outputLength,
	segmentLength,
	clip,
	source,
}: {
	outputLength: number;
	segmentLength: number;
	clip: MixClip;
	source: SourceWindow;
}): [Float32Array, Float32Array] {
	const left = new Float32Array(outputLength);
	const right = new Float32Array(outputLength);
	for (let start = 0; start < outputLength; start += segmentLength) {
		const length = Math.min(segmentLength, outputLength - start);
		const segment: [Float32Array, Float32Array] = [
			new Float32Array(length),
			new Float32Array(length),
		];
		mixClipIntoSegment({
			output: segment,
			segmentStart: start,
			segmentLength: length,
			sampleRate: SAMPLE_RATE,
			clip,
			window: source,
		});
		left.set(segment[0], start);
		right.set(segment[1], start);
	}
	return [left, right];
}

describe("mixClipIntoSegment", () => {
	const source: SourceWindow = {
		channels: [
			makeSignal({ length: 48000 * 3, frequency: 440, amplitude: 0.5, sampleRate: 48000 }),
			makeSignal({ length: 48000 * 3, frequency: 660, amplitude: 0.4, sampleRate: 48000 }),
		],
		sampleRate: 48000,
		startSec: 0,
	};

	const cases: Array<{ name: string; clip: MixClip; segmentLength: number }> = [
		{
			name: "rate 1, 48k source into 44.1k output, odd segment size",
			segmentLength: 4999,
			clip: {
				startSample: 12345,
				renderedLength: Math.ceil(2.5 * SAMPLE_RATE),
				sourceTimeAt: (t) => 0.25 + t,
				sourceEndSec: 3,
				volume: 0.8,
			},
		},
		{
			name: "rate 1.5 with animated gain",
			segmentLength: 22050,
			clip: {
				startSample: 0,
				renderedLength: Math.ceil(1.9 * SAMPLE_RATE),
				sourceTimeAt: (t) => 0.1 + t * 1.5,
				sourceEndSec: 3,
				volume: 1,
				gainAt: (t) => 1 - t / 4,
			},
		},
		{
			name: "clip longer than source stops at source end",
			segmentLength: 10000,
			clip: {
				startSample: 5000,
				renderedLength: 5 * SAMPLE_RATE,
				sourceTimeAt: (t) => t,
				sourceEndSec: 3,
				volume: 1,
			},
		},
	];

	for (const { name, clip, segmentLength } of cases) {
		test(`segmented output equals whole-buffer output: ${name}`, () => {
			const outputLength = 4 * SAMPLE_RATE;
			const expected = referenceMix({ outputLength, clip, source });
			const actual = mixSegmented({ outputLength, segmentLength, clip, source });
			expect(actual[0]).toEqual(expected[0]);
			expect(actual[1]).toEqual(expected[1]);
		});
	}

	test("mono sources are duplicated to both channels", () => {
		const mono: SourceWindow = {
			channels: [makeSignal({ length: SAMPLE_RATE, frequency: 220, amplitude: 0.5 })],
			sampleRate: SAMPLE_RATE,
			startSec: 0,
		};
		const clip: MixClip = {
			startSample: 0,
			renderedLength: SAMPLE_RATE,
			sourceTimeAt: (t) => t,
			sourceEndSec: 1,
			volume: 1,
		};
		const [left, right] = mixSegmented({
			outputLength: SAMPLE_RATE,
			segmentLength: 8192,
			clip,
			source: mono,
		});
		expect(left).toEqual(right);
		expect(Math.max(...left)).toBeGreaterThan(0.4);
	});

	test("a window that starts later than 0 is addressed by its startSec", () => {
		const full = makeSignal({ length: 4 * SAMPLE_RATE, frequency: 330, amplitude: 0.6 });
		const startSample = 2 * SAMPLE_RATE;
		const partial: SourceWindow = {
			channels: [full.slice(startSample, startSample + SAMPLE_RATE)],
			sampleRate: SAMPLE_RATE,
			startSec: 2,
		};
		const whole: SourceWindow = {
			channels: [full],
			sampleRate: SAMPLE_RATE,
			startSec: 0,
		};
		const clip: MixClip = {
			startSample: 0,
			renderedLength: SAMPLE_RATE / 2,
			sourceTimeAt: (t) => 2.1 + t,
			sourceEndSec: 4,
			volume: 1,
		};
		const a = mixSegmented({
			outputLength: SAMPLE_RATE / 2,
			segmentLength: 4410,
			clip,
			source: partial,
		});
		const b = mixSegmented({
			outputLength: SAMPLE_RATE / 2,
			segmentLength: 4410,
			clip,
			source: whole,
		});
		expect(a[0].length).toBe(b[0].length);
		for (let i = 0; i < a[0].length; i++) {
			expect(a[0][i]).toBeCloseTo(b[0][i], 6);
		}
		expect(Math.max(...a[0])).toBeGreaterThan(0.5);
	});

	test("source range covers every sample the segment reads", () => {
		const clip: MixClip = {
			startSample: 1000,
			renderedLength: 3 * SAMPLE_RATE,
			sourceTimeAt: (t) => 1 + t * 2,
			sourceEndSec: 100,
			volume: 1,
		};
		const range = getSourceRangeForSegment({
			segmentStart: 44100,
			segmentLength: 44100,
			sampleRate: SAMPLE_RATE,
			clip,
		});
		expect(range).not.toBeNull();
		const firstClipTime = (44100 - 1000) / SAMPLE_RATE;
		const lastClipTime = (88200 - 1000) / SAMPLE_RATE;
		expect(range!.startSec).toBeLessThanOrEqual(1 + firstClipTime * 2);
		expect(range!.endSec).toBeGreaterThanOrEqual(1 + lastClipTime * 2);
	});

	test("no source range for a segment the clip does not touch", () => {
		const clip: MixClip = {
			startSample: 100000,
			renderedLength: 1000,
			sourceTimeAt: (t) => t,
			sourceEndSec: 10,
			volume: 1,
		};
		expect(
			getSourceRangeForSegment({
				segmentStart: 0,
				segmentLength: 44100,
				sampleRate: SAMPLE_RATE,
				clip,
			}),
		).toBeNull();
	});
});

describe("LookaheadLimiter", () => {
	function runLimiter({
		left,
		right,
		chunkSize,
	}: {
		left: Float32Array;
		right: Float32Array;
		chunkSize: number;
	}) {
		const limiter = new LookaheadLimiter({ sampleRate: SAMPLE_RATE });
		const total = left.length;
		const paddedLeft = new Float32Array(total + limiter.latency);
		const paddedRight = new Float32Array(total + limiter.latency);
		paddedLeft.set(left);
		paddedRight.set(right);
		for (let start = 0; start < paddedLeft.length; start += chunkSize) {
			const end = Math.min(paddedLeft.length, start + chunkSize);
			limiter.process({
				left: paddedLeft.subarray(start, end),
				right: paddedRight.subarray(start, end),
			});
		}
		return {
			latency: limiter.latency,
			left: paddedLeft.slice(limiter.latency),
			right: paddedRight.slice(limiter.latency),
		};
	}

	function loudSignal(length: number) {
		const left = makeSignal({ length, frequency: 200, amplitude: 0.5 });
		const right = makeSignal({ length, frequency: 310, amplitude: 0.5 });
		// 中間放一段爆音,另一段維持安靜
		for (let i = 20000; i < 26000; i++) {
			left[i] *= 4;
			right[i] *= 3.2;
		}
		return { left, right };
	}

	test("never exceeds the ceiling", () => {
		const { left, right } = loudSignal(80000);
		const out = runLimiter({ left, right, chunkSize: 80000 });
		const peak = Math.max(
			...out.left.map(Math.abs),
			...out.right.map(Math.abs),
		);
		expect(peak).toBeLessThanOrEqual(LIMITER_CEILING + 1e-6);
	});

	test("chunked processing is identical to one-shot processing", () => {
		const { left, right } = loudSignal(80000);
		const whole = runLimiter({ left, right, chunkSize: 80000 });
		for (const chunkSize of [1, 7, 441, 4096, 22050]) {
			const chunked = runLimiter({ left, right, chunkSize });
			expect(chunked.left).toEqual(whole.left);
			expect(chunked.right).toEqual(whole.right);
		}
	});

	test("leaves a quiet signal untouched, only delayed", () => {
		const left = makeSignal({ length: 30000, frequency: 440, amplitude: 0.7 });
		const right = makeSignal({ length: 30000, frequency: 550, amplitude: 0.6 });
		const out = runLimiter({ left, right, chunkSize: 4096 });
		// 補償延遲之後,輸出應與輸入相同(丟掉最前面 latency 個之後再比對)
		expect(out.left.length).toBe(left.length);
		for (let i = 0; i < left.length - out.latency; i++) {
			expect(out.left[i]).toBeCloseTo(left[i], 6);
			expect(out.right[i]).toBeCloseTo(right[i], 6);
		}
	});

	test("recovers to unity gain after a peak", () => {
		const { left, right } = loudSignal(200000);
		const out = runLimiter({ left, right, chunkSize: 8192 });
		const tail = out.left.length - 1000;
		expect(out.left[tail]).toBeCloseTo(left[tail], 3);
	});
});

describe("floatToInterleavedPcm16", () => {
	test("interleaves and clamps", () => {
		const pcm = floatToInterleavedPcm16({
			left: Float32Array.from([0, 1, -1, 2]),
			right: Float32Array.from([0.5, -0.5, 0, -2]),
		});
		expect(Array.from(pcm.slice(0, 2))).toEqual([0, Math.trunc(0.5 * 0x7fff)]);
		expect(pcm[2]).toBe(0x7fff);
		expect(pcm[4]).toBe(-0x8000);
		expect(pcm[6]).toBe(0x7fff);
		expect(pcm[7]).toBe(-0x8000);
	});
});
