import { describe, expect, test } from "bun:test";
import { computeNormalizeAdjustment, LoudnessMeter } from "../loudness";

const RATE = 8000;

function sine({ seconds, amplitude }: { seconds: number; amplitude: number }): Float32Array {
	const out = new Float32Array(Math.round(seconds * RATE));
	for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * 440 * i) / RATE);
	return out;
}

function measure(channels: Float32Array[]) {
	const meter = new LoudnessMeter({ sampleRate: RATE });
	meter.push({ channels });
	return meter.finish();
}

describe("LoudnessMeter", () => {
	test("滿幅正弦波:均方 = 0.5 → 約 -3 dB,峰值 0 dB", () => {
		const result = measure([sine({ seconds: 2, amplitude: 1 })]);
		expect(result.loudnessDb).toBeCloseTo(-3.01, 1);
		expect(result.peakDb).toBeCloseTo(0, 1);
	});

	test("振幅減半 = 響度少 6 dB", () => {
		const loud = measure([sine({ seconds: 2, amplitude: 0.8 })]).loudnessDb ?? 0;
		const soft = measure([sine({ seconds: 2, amplitude: 0.4 })]).loudnessDb ?? 0;
		expect(loud - soft).toBeCloseTo(6.02, 1);
	});

	test("中間夾一大段靜音,不會把響度拉低(門檻排除)", () => {
		const tone = sine({ seconds: 2, amplitude: 0.5 });
		const silence = new Float32Array(RATE * 6);
		const joined = new Float32Array(tone.length * 2 + silence.length);
		joined.set(tone, 0);
		joined.set(silence, tone.length);
		joined.set(tone, tone.length + silence.length);
		const withSilence = measure([joined]).loudnessDb ?? 0;
		const without = measure([tone]).loudnessDb ?? 0;
		expect(withSilence).toBeCloseTo(without, 1);
	});

	test("全靜音或太短:量不出來", () => {
		expect(measure([new Float32Array(RATE * 2)]).loudnessDb).toBeNull();
		expect(measure([sine({ seconds: 0.1, amplitude: 0.5 })]).loudnessDb).toBeNull();
	});

	test("立體聲:兩聲道取平均,分段送入結果一致", () => {
		const left = sine({ seconds: 2, amplitude: 0.5 });
		const whole = measure([left, left]);
		const meter = new LoudnessMeter({ sampleRate: RATE });
		const half = left.length >> 1;
		meter.push({ channels: [left.slice(0, half), left.slice(0, half)] });
		meter.push({ channels: [left.slice(half), left.slice(half)] });
		expect(meter.finish().loudnessDb).toBeCloseTo(whole.loudnessDb ?? 0, 4);
	});
});

describe("computeNormalizeAdjustment", () => {
	const range = { minVolumeDb: -60, maxVolumeDb: 20 };

	test("目標 -16、量到 -26 → 加 10 dB", () => {
		const result = computeNormalizeAdjustment({
			result: { loudnessDb: -26, peakDb: -12, usedBlocks: 5, totalBlocks: 5 },
			...range,
		});
		expect(result).toMatchObject({ ok: true, volumeDb: 10, limitedByPeak: false });
	});

	test("比目標大聲 → 降音量", () => {
		const result = computeNormalizeAdjustment({
			result: { loudnessDb: -8, peakDb: -1, usedBlocks: 5, totalBlocks: 5 },
			...range,
		});
		expect(result).toMatchObject({ ok: true, volumeDb: -8 });
	});

	test("調高時受峰值限制,不削波", () => {
		const result = computeNormalizeAdjustment({
			result: { loudnessDb: -30, peakDb: -4, usedBlocks: 5, totalBlocks: 5 },
			...range,
		});
		// 想加 14 dB,但峰值只剩 3 dB 空間(-1 - -4)
		expect(result).toMatchObject({ ok: true, volumeDb: 3, limitedByPeak: true });
	});

	test("超出音量範圍時夾住,並標記", () => {
		const result = computeNormalizeAdjustment({
			result: { loudnessDb: -16, peakDb: -90, usedBlocks: 5, totalBlocks: 5 },
			targetDb: 40,
			minVolumeDb: -60,
			maxVolumeDb: 20,
		});
		expect(result).toMatchObject({ ok: true, volumeDb: 20, clamped: true });
	});

	test("量不出響度:回報原因", () => {
		expect(
			computeNormalizeAdjustment({
				result: { loudnessDb: null, peakDb: -120, usedBlocks: 0, totalBlocks: 0 },
				...range,
			}),
		).toMatchObject({ ok: false });
	});
});
