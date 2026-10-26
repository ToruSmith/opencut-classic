import { describe, expect, test } from "bun:test";
import { planCrossDissolve, type DissolveTracks } from "../cross-dissolve";

function scene(): DissolveTracks {
	return {
		overlay: [
			{ id: "top", elements: [{ id: "B", type: "video", startTime: 80, duration: 100 }] },
		],
		main: {
			id: "main",
			elements: [{ id: "A", type: "video", startTime: 0, duration: 100 }],
		},
		audio: [
			{ id: "music", elements: [{ id: "M", type: "audio", startTime: 90, duration: 50 }] },
		],
	};
}

describe("planCrossDissolve", () => {
	test("後一段在上層:後一段淡入、聲音交叉淡化", () => {
		const plan = planCrossDissolve({ tracks: scene(), trackId: "top", elementId: "B" });
		expect(plan.ok).toBe(true);
		if (!plan.ok) return;
		expect(plan.overlap).toBe(20);
		expect(plan.actions).toEqual([
			{ kind: "opacity", trackId: "top", elementId: "B", side: "in", duration: 20 },
			{ kind: "audio", trackId: "main", elementId: "A", side: "out", duration: 20 },
			{ kind: "audio", trackId: "top", elementId: "B", side: "in", duration: 20 },
		]);
	});

	test("選前一段也能找到同一對", () => {
		const plan = planCrossDissolve({ tracks: scene(), trackId: "main", elementId: "A" });
		expect(plan.ok && plan.overlap).toBe(20);
	});

	test("前一段在上層:改成前一段淡出", () => {
		const tracks: DissolveTracks = {
			overlay: [
				{ id: "top", elements: [{ id: "A", type: "image", startTime: 0, duration: 100 }] },
			],
			main: {
				id: "main",
				elements: [{ id: "B", type: "image", startTime: 70, duration: 100 }],
			},
			audio: [],
		};
		const plan = planCrossDissolve({ tracks, trackId: "main", elementId: "B" });
		expect(plan.ok).toBe(true);
		if (!plan.ok) return;
		expect(plan.actions).toEqual([
			{ kind: "opacity", trackId: "top", elementId: "A", side: "out", duration: 30 },
		]);
	});

	test("整段蓋住(前一段比後一段晚結束)不算轉場", () => {
		const tracks: DissolveTracks = {
			overlay: [
				{ id: "top", elements: [{ id: "T", type: "text", startTime: 20, duration: 10 }] },
			],
			main: {
				id: "main",
				elements: [{ id: "A", type: "video", startTime: 0, duration: 100 }],
			},
			audio: [],
		};
		const plan = planCrossDissolve({ tracks, trackId: "top", elementId: "T" });
		expect(plan.ok).toBe(false);
	});

	test("音樂與音樂:只有聲音交叉淡化", () => {
		const tracks: DissolveTracks = {
			overlay: [],
			main: { id: "main", elements: [] },
			audio: [
				{ id: "a1", elements: [{ id: "S1", type: "audio", startTime: 0, duration: 100 }] },
				{ id: "a2", elements: [{ id: "S2", type: "audio", startTime: 60, duration: 100 }] },
			],
		};
		const plan = planCrossDissolve({ tracks, trackId: "a2", elementId: "S2" });
		expect(plan.ok && plan.actions.map((a) => `${a.kind}:${a.elementId}:${a.side}`)).toEqual([
			"audio:S1:out",
			"audio:S2:in",
		]);
	});
});
