import { describe, expect, test } from "bun:test";
import { computeContentEnd } from "../content-end";

const el = (type: string, startTime: number, duration: number) => ({
	type,
	startTime,
	duration,
});

describe("computeContentEnd", () => {
	test("取所有非特效片段的最晚結尾(跨軌道)", () => {
		expect(
			computeContentEnd({
				tracks: {
					overlay: [{ elements: [el("text", 100, 50)] }],
					main: { elements: [el("video", 0, 100)] },
					audio: [{ elements: [el("audio", 0, 300)] }],
				},
			}),
		).toBe(300);
	});

	test("特效片段不撐長總長", () => {
		expect(
			computeContentEnd({
				tracks: {
					overlay: [{ elements: [el("effect", 0, 5000)] }],
					main: { elements: [el("video", 0, 100)] },
					audio: [],
				},
			}),
		).toBe(100);
	});

	test("只剩特效 = 空時間軸(0)", () => {
		expect(
			computeContentEnd({
				tracks: {
					overlay: [{ elements: [el("effect", 10, 20), el("effect", 500, 100)] }],
					main: { elements: [] },
					audio: [],
				},
			}),
		).toBe(0);
	});

	test("完全沒有片段 = 0", () => {
		expect(
			computeContentEnd({ tracks: { overlay: [], main: { elements: [] }, audio: [] } }),
		).toBe(0);
	});
});
