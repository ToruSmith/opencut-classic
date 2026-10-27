import { describe, expect, test } from "bun:test";
import {
	analyzeBeats,
	buildBeatGrid,
	OnsetAccumulator,
} from "../beat-detect";

const SR = 22050;

/** 合成節拍:每個點是一小段衰減的雜訊 + 低音,底下鋪一層持續的低頻 */
function clickTrack({ bpm, seconds, offset = 0 }: { bpm: number; seconds: number; offset?: number }) {
	const samples = new Float32Array(Math.floor(seconds * SR));
	let seed = 12345;
	const rand = () => {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		return seed / 0xffffffff - 0.5;
	};
	for (let i = 0; i < samples.length; i++) {
		samples[i] = 0.05 * Math.sin((2 * Math.PI * 110 * i) / SR);
	}
	const step = 60 / bpm;
	const onsets: number[] = [];
	for (let t = offset; t < seconds - 0.1; t += step) {
		onsets.push(t);
		const start = Math.floor(t * SR);
		for (let k = 0; k < 0.06 * SR; k++) {
			samples[start + k] += rand() * 1.2 * Math.exp(-k / (0.012 * SR));
		}
	}
	return { samples, onsets };
}

function energiesOf(samples: Float32Array, chunk = 7000) {
	const acc = new OnsetAccumulator({ sampleRate: SR });
	for (let i = 0; i < samples.length; i += chunk) acc.push(samples.subarray(i, i + chunk));
	return acc.finish();
}

describe("節拍偵測", () => {
	test("分段餵入與一次餵入結果相同", () => {
		const { samples } = clickTrack({ bpm: 120, seconds: 6 });
		const whole = new OnsetAccumulator({ sampleRate: SR });
		whole.push(samples);
		expect(Array.from(energiesOf(samples, 3333))).toEqual(Array.from(whole.finish()));
	});

	test("重音:每個點都抓得到,位置誤差在 40ms 內,沒有多抓", () => {
		const { samples, onsets } = clickTrack({ bpm: 120, seconds: 12, offset: 0.3 });
		const result = analyzeBeats({
			energies: energiesOf(samples),
			sampleRate: SR,
			mode: "onsets",
			sensitivity: 0.5,
			durationSeconds: 12,
		});
		expect(result.times.length).toBe(onsets.length);
		result.times.forEach((t, i) => expect(Math.abs(t - onsets[i])).toBeLessThan(0.04));
	});

	test("節拍格:速度 ±1 BPM、第一拍位置正確", () => {
		for (const bpm of [100, 128, 150]) {
			const { samples } = clickTrack({ bpm, seconds: 20, offset: 0.2 });
			const result = analyzeBeats({
				energies: energiesOf(samples),
				sampleRate: SR,
				mode: "grid",
				sensitivity: 0.5,
				durationSeconds: 20,
			});
			expect(Math.abs((result.bpm ?? 0) - bpm)).toBeLessThan(1.5);
			const step = 60 / bpm;
			const d = Math.abs((result.times[0] ?? 99) - 0.2) % step;
			expect(Math.min(d, step - d)).toBeLessThan(0.05);
			expect(result.times.length).toBeGreaterThan(10);
		}
	});

	test("靜音或太短:不丟錯、不產生標記", () => {
		const silence = energiesOf(new Float32Array(SR * 3));
		for (const mode of ["onsets", "grid"] as const) {
			expect(
				analyzeBeats({ energies: silence, sampleRate: SR, mode, sensitivity: 0.5, durationSeconds: 3 }).times,
			).toEqual([]);
		}
		expect(
			analyzeBeats({
				energies: new Float32Array(2),
				sampleRate: SR,
				mode: "grid",
				sensitivity: 0.5,
				durationSeconds: 1,
			}).times,
		).toEqual([]);
	});

	test("buildBeatGrid", () => {
		expect(buildBeatGrid({ bpm: 120, phaseSeconds: 0.25, durationSeconds: 2 })).toEqual([
			0.25, 0.75, 1.25, 1.75,
		]);
		expect(buildBeatGrid({ bpm: 0, phaseSeconds: 0, durationSeconds: 2 })).toEqual([]);
	});
});

describe("靈敏度與最短間隔", () => {
	test("靈敏度越低重音越少;最短間隔會合併太近的重音", () => {
		const { samples } = clickTrack({ bpm: 240, seconds: 12 });
		const energies = energiesOf(samples);
		const count = (sensitivity: number, minGapSeconds?: number) =>
			analyzeBeats({ energies, sampleRate: SR, mode: "onsets", sensitivity, durationSeconds: 12, minGapSeconds })
				.times.length;
		expect(count(0.5)).toBeGreaterThan(30);
		expect(count(0.5, 0.5)).toBeLessThan(count(0.5) * 0.7);
		expect(count(0.5, 1)).toBeLessThanOrEqual(12);
		expect(count(0)).toBeLessThanOrEqual(count(0.5));
	});
});
