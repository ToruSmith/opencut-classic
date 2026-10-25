import { describe, expect, test } from "bun:test";
import { cleanSegments } from "../segments";
import { isWindowSilent, planWindows } from "../windows";

const SR = 1000; // 測試用低取樣率,讓陣列小一點

function signal({
	seconds,
	quiet = [],
}: {
	seconds: number;
	quiet?: Array<[number, number]>;
}) {
	const samples = new Float32Array(seconds * SR).fill(0.1);
	for (const [from, to] of quiet) samples.fill(0, from * SR, to * SR);
	return samples;
}

describe("planWindows", () => {
	test("空音訊沒有視窗;短音訊只有一個", () => {
		expect(planWindows({ samples: new Float32Array(0), sampleRate: SR })).toEqual([]);
		expect(planWindows({ samples: signal({ seconds: 12 }), sampleRate: SR })).toEqual([
			{ start: 0, end: 12_000 },
		]);
	});

	test("視窗首尾相接、涵蓋全部樣本、每個都不超過 30 秒", () => {
		const samples = signal({ seconds: 200 });
		const windows = planWindows({ samples, sampleRate: SR });
		expect(windows[0]!.start).toBe(0);
		expect(windows.at(-1)!.end).toBe(samples.length);
		for (let i = 0; i < windows.length; i++) {
			expect(windows[i]!.end - windows[i]!.start).toBeLessThanOrEqual(30 * SR);
			expect(windows[i]!.end).toBeGreaterThan(windows[i]!.start);
			if (i > 0) expect(windows[i]!.start).toBe(windows[i - 1]!.end);
		}
	});

	test("在尾端最安靜的地方下刀,不切在說話中間", () => {
		// 27.0~27.4 秒是停頓,落在 24~30 秒的搜尋範圍內
		const samples = signal({ seconds: 70, quiet: [[27, 27.4]] });
		const first = planWindows({ samples, sampleRate: SR })[0]!;
		expect(first.end / SR).toBeGreaterThan(27);
		expect(first.end / SR).toBeLessThan(27.4);
	});

	test("整段都有聲音時,視窗盡量接近 30 秒", () => {
		const first = planWindows({ samples: signal({ seconds: 100 }), sampleRate: SR })[0]!;
		expect(first.end / SR).toBeGreaterThan(29.5);
	});
});

describe("isWindowSilent", () => {
	test("靜音與正常說話的區別", () => {
		const samples = signal({ seconds: 10, quiet: [[0, 5]] });
		expect(isWindowSilent({ samples, window: { start: 0, end: 5 * SR } })).toBe(true);
		expect(isWindowSilent({ samples, window: { start: 5 * SR, end: 10 * SR } })).toBe(false);
	});
});

describe("cleanSegments", () => {
	const seg = (text: string, i = 0) => ({ text, start: i, end: i + 1 });

	test("移除空白與只有標點的片段,並修剪前後空白", () => {
		const r = cleanSegments({
			segments: [seg(" 你好 "), seg("  "), seg("..."), seg("。"), seg("世界")],
		});
		expect(r.map((s) => s.text)).toEqual(["你好", "世界"]);
	});

	test("同一句連續重複最多保留 2 次", () => {
		const r = cleanSegments({
			segments: [seg("謝謝"), seg("謝謝"), seg("謝謝"), seg("謝謝"), seg("再見")],
		});
		expect(r.map((s) => s.text)).toEqual(["謝謝", "謝謝", "再見"]);
	});

	test("不連續的相同句子不受影響", () => {
		const r = cleanSegments({ segments: [seg("好"), seg("嗯"), seg("好")] });
		expect(r.length).toBe(3);
	});
});
