import { describe, expect, test } from "bun:test";
import { parseSubtitleFile } from "../parse";
import { buildCuesFromTaps, splitLyricLines } from "../timed-lines";

const parse = (input: string) => parseSubtitleFile({ fileName: "a.LRC", input });
const view = (input: string) =>
	parse(input).captions.map((c) => [c.text, c.startTime, c.duration]);

describe("LRC", () => {
	test("正常:每句結束 = 下一句開頭,最後一句 4 秒", () => {
		expect(view("[00:01.00]第一句\n[00:03.50]第二句\n[00:05.00]最後")).toEqual([
			["第一句", 1, 2.5],
			["第二句", 3.5, 1.5],
			["最後", 5, 4],
		]);
	});

	test("小數 2 / 3 位、CRLF、BOM、標頭略過", () => {
		const r = parse("﻿[ti:歌名]\r\n[ar:歌手]\r\n[00:01.5]A\r\n[00:02.250]B\r\n");
		expect(r.captions.map((c) => [c.text, c.startTime])).toEqual([
			["A", 1.5],
			["B", 2.25],
		]);
		expect(r.skippedCueCount).toBe(0);
	});

	test("多個時間戳:同一句出現多次", () => {
		expect(view("[00:10.00][00:02.00]副歌\n[00:04.00]間")).toEqual([
			["副歌", 2, 2],
			["間", 4, 6],
			["副歌", 10, 4],
		]);
	});

	test("offset 套用(正值提早)", () => {
		expect(view("[offset:+500]\n[00:02.00]A\n[00:04.00]B")).toEqual([
			["A", 1.5, 2],
			["B", 3.5, 4],
		]);
		expect(view("[00:02.00]A\n[offset:-1000]")[0]).toEqual(["A", 3, 4]);
	});

	test("空文字行 = 上一句結束;單句最長 10 秒", () => {
		expect(view("[00:01.00]A\n[00:02.50]\n[00:20.00]B\n[00:40.00]C")).toEqual([
			["A", 1, 1.5],
			["B", 20, 10],
			["C", 40, 4],
		]);
	});

	test("亂序會依時間排序;同時間的兩行合併(原文 + 翻譯)", () => {
		expect(view("[00:05.00]B\n[00:01.00]A\n[00:01.00]甲")).toEqual([
			["A\n甲", 1, 4],
			["B", 5, 4],
		]);
	});

	test("壞行略過並計數;逐字時間戳被去掉", () => {
		const r = parse("沒有時間戳\n[00:01.00]<00:01.00>你<00:01.50>好\n[00:99.00]秒數錯誤");
		expect(r.captions.map((c) => c.text)).toEqual(["你好"]);
		expect(r.skippedCueCount).toBe(2);
	});

	test("offset 讓開始時間變負:略過並警告", () => {
		const r = parse("[offset:+5000]\n[00:01.00]A\n[00:08.00]B");
		expect(r.captions.map((c) => [c.text, c.startTime])).toEqual([["B", 3]]);
		expect(r.warnings.length).toBe(1);
	});

	test("空檔案", () => {
		expect(parse("").captions).toEqual([]);
	});
});

describe("點拍同步", () => {
	test("splitLyricLines 略過空行與空白", () => {
		expect(splitLyricLines({ input: " a \r\n\r\n b\n" })).toEqual(["a", "b"]);
	});

	test("按鍵時間 = 開始時間,多一次按鍵 = 最後一句結束", () => {
		const r = buildCuesFromTaps({ lines: ["A", "B"], taps: [1, 3, 6] });
		expect(r.map((c) => [c.text, c.startTime, c.duration])).toEqual([
			["A", 1, 2],
			["B", 3, 3],
		]);
	});

	test("沒有結束點時最後一句 4 秒;句數多於按鍵只產生打過的", () => {
		const r = buildCuesFromTaps({ lines: ["A", "B", "C"], taps: [1, 2] });
		expect(r.map((c) => [c.text, c.startTime, c.duration])).toEqual([
			["A", 1, 1],
			["B", 2, 4],
		]);
	});
});
