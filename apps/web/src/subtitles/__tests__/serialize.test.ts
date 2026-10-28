import { describe, expect, test } from "bun:test";
import { parseLrc } from "../lrc";
import { formatLrc, formatLrcTime, formatSrt, formatSrtTime } from "../serialize";

describe("字幕匯出", () => {
	test("時間格式", () => {
		expect(formatSrtTime({ seconds: 0 })).toBe("00:00:00,000");
		expect(formatSrtTime({ seconds: 3725.4567 })).toBe("01:02:05,457");
		expect(formatLrcTime({ seconds: 65.456 })).toBe("01:05.46");
		expect(formatLrcTime({ seconds: -1 })).toBe("00:00.00");
	});

	test("SRT:依開始時間排序、編號從 1、略過長度 0", () => {
		const srt = formatSrt({
			cues: [
				{ text: "第二句", startTime: 3, duration: 2 },
				{ text: "第一句\n第二行", startTime: 1, duration: 1.5 },
				{ text: "空", startTime: 9, duration: 0 },
			],
		});
		expect(srt).toBe(
			"1\n00:00:01,000 --> 00:00:02,500\n第一句\n第二行\n\n2\n00:00:03,000 --> 00:00:05,000\n第二句\n",
		);
	});

	test("LRC:讀回來的時間與文字一致(有空檔時補結束標記)", () => {
		const cues = [
			{ text: "夜色", startTime: 1, duration: 2 },
			{ text: "漸深", startTime: 3, duration: 1.5 },
			{ text: "回頭", startTime: 6, duration: 2 },
		];
		const lrc = formatLrc({ cues });
		const back = parseLrc({ input: lrc }).captions;
		expect(back.map((c) => c.text)).toEqual(["夜色", "漸深", "回頭"]);
		back.forEach((cue, index) => {
			expect(cue.startTime).toBeCloseTo(cues[index]!.startTime, 2);
			expect(cue.duration).toBeCloseTo(cues[index]!.duration, 2);
		});
	});
});
