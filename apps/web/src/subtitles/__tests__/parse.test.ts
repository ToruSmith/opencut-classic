import { describe, expect, test } from "bun:test";
import { parseSubtitleFile } from "../parse";

describe("SRT", () => {
	test("標準格式", () => {
		const r = parseSubtitleFile({
			fileName: "a.srt",
			input: "1\n00:00:01,000 --> 00:00:02,500\n你好\n\n2\n00:00:03,000 --> 00:00:04,000\n第二行\n第二句\n",
		});
		expect(r.captions).toEqual([
			{ text: "你好", startTime: 1, duration: 1.5 },
			{ text: "第二行\n第二句", startTime: 3, duration: 1 },
		]);
		expect(r.skippedCueCount).toBe(0);
	});

	test("CRLF、沒有序號、毫秒用句點、毫秒位數不足", () => {
		const r = parseSubtitleFile({
			fileName: "a.SRT",
			input: "00:00:01.5 --> 00:00:02.25\r\nA\r\n\r\n00:00:03,000 --> 00:00:04,000\r\nB",
		});
		expect(r.captions.map((c) => [c.text, c.startTime, c.duration])).toEqual([
			["A", 1.5, 0.75],
			["B", 3, 1],
		]);
	});

	test("開頭有 BOM 時第一則不會被丟掉", () => {
		const r = parseSubtitleFile({
			fileName: "a.srt",
			input: "﻿00:00:01,000 --> 00:00:02,000\nA\n",
		});
		expect(r.captions.length).toBe(1);
	});

	test("開頭有 BOM 且有序號", () => {
		const r = parseSubtitleFile({
			fileName: "a.srt",
			input: "﻿1\n00:00:01,000 --> 00:00:02,000\nA\n",
		});
		expect(r.captions.length).toBe(1);
	});

	test("移除 HTML 標籤與 {\\an8} 這類標記", () => {
		const r = parseSubtitleFile({
			fileName: "a.srt",
			input: "1\n00:00:01,000 --> 00:00:02,000\n<i>斜體</i> <font color=\"red\">紅</font>{\\an8}\n",
		});
		expect(r.captions[0]?.text).toBe("斜體 紅");
	});

	test("壞掉的區塊被略過並計數", () => {
		const r = parseSubtitleFile({
			fileName: "a.srt",
			input: "1\n00:00:05,000 --> 00:00:04,000\n倒退\n\nxx\nyy\n\n2\n00:00:01,000 --> 00:00:02,000\nOK\n",
		});
		expect(r.captions.length).toBe(1);
		expect(r.skippedCueCount).toBe(2);
	});

	test("字幕文字中間有空白行時,後半段不會變成亂碼字幕", () => {
		const r = parseSubtitleFile({
			fileName: "a.srt",
			input: "1\n00:00:01,000 --> 00:00:02,000\nA\n\nB\n\n2\n00:00:03,000 --> 00:00:04,000\nC\n",
		});
		expect(r.captions.map((c) => c.text)).toEqual(["A", "C"]);
	});

	test("不支援的副檔名會丟錯", () => {
		expect(() => parseSubtitleFile({ fileName: "a.vtt", input: "" })).toThrow();
	});
});

const ASS = `[Script Info]
Title: t
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,54,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,2,10,10,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,Hello, world\\Nsecond
Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,{\\i1}斜體{\\i0}正常
Comment: 0,0:00:05.00,0:00:06.00,Default,,0,0,0,,註解不應出現
`;

describe("ASS", () => {
	test("基本對話、逗號在文字內、\\N 換行、覆寫標記被移除、註解被忽略", () => {
		const r = parseSubtitleFile({ fileName: "a.ass", input: ASS });
		expect(r.captions.length).toBe(2);
		expect(r.captions[0]).toMatchObject({
			text: "Hello, world\nsecond",
			startTime: 1,
			duration: 1.5,
		});
		expect(r.captions[1]?.text).toBe("斜體正常");
	});

	test("樣式被套用", () => {
		const r = parseSubtitleFile({ fileName: "a.ass", input: ASS });
		const style = r.captions[0]?.style;
		expect(style?.fontFamily).toBe("Arial");
		expect(style?.fontWeight).toBe("bold");
		expect(style?.fontSizeRatioOfPlayHeight).toBeCloseTo(54 / 1080, 5);
		expect(style?.placement?.verticalAlign).toBe("bottom");
	});

	test("Format 欄位順序不同也能解析", () => {
		const r = parseSubtitleFile({
			fileName: "a.ass",
			input:
				"[Events]\nFormat: Start, End, Text\nDialogue: 0:00:01.00,0:00:02.00,簡化格式\n",
		});
		expect(r.captions[0]).toMatchObject({ text: "簡化格式", startTime: 1 });
	});
});
