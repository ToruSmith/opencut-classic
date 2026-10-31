import { describe, expect, test } from "bun:test";
import type {
	AudioElement,
	AudioTrack,
	CompoundElement,
	EffectElement,
	EffectTrack,
	SceneTracks,
	TextElement,
	TextTrack,
	TimelineElement,
	TScene,
	VideoElement,
	VideoTrack,
} from "@/timeline/types";
import { type MediaTime, mediaTime, ZERO_MEDIA_TIME } from "@/wasm";
import {
	buildCompoundFromSelection,
	clipElementToWindow,
	flattenCompoundTracks,
	sceneReachesScene,
	syncCompoundSourceDurations,
	ungroupCompound,
	wouldCreateCompoundCycle,
} from "@/timeline/compound";

const t = (ticks: number): MediaTime => mediaTime({ ticks });

function video(
	id: string,
	start: number,
	duration: number,
	extra: Partial<VideoElement> = {},
): VideoElement {
	return {
		id,
		type: "video",
		name: id,
		mediaId: `media-${id}`,
		startTime: t(start),
		duration: t(duration),
		trimStart: ZERO_MEDIA_TIME,
		trimEnd: ZERO_MEDIA_TIME,
		params: {},
		...extra,
	};
}

function text(id: string, start: number, duration: number): TextElement {
	return {
		id,
		type: "text",
		name: id,
		startTime: t(start),
		duration: t(duration),
		trimStart: ZERO_MEDIA_TIME,
		trimEnd: ZERO_MEDIA_TIME,
		params: {},
	};
}

function audio(id: string, start: number, duration: number): AudioElement {
	return {
		id,
		type: "audio",
		name: id,
		sourceType: "upload",
		mediaId: `media-${id}`,
		startTime: t(start),
		duration: t(duration),
		trimStart: ZERO_MEDIA_TIME,
		trimEnd: ZERO_MEDIA_TIME,
		params: {},
	};
}

function effect(id: string, start: number, duration: number): EffectElement {
	return {
		id,
		type: "effect",
		name: id,
		effectType: "blur",
		startTime: t(start),
		duration: t(duration),
		trimStart: ZERO_MEDIA_TIME,
		trimEnd: ZERO_MEDIA_TIME,
		params: {},
	};
}

function compound(
	id: string,
	sceneId: string,
	start: number,
	duration: number,
	extra: Partial<CompoundElement> = {},
): CompoundElement {
	return {
		id,
		type: "compound",
		name: id,
		sceneId,
		startTime: t(start),
		duration: t(duration),
		trimStart: ZERO_MEDIA_TIME,
		trimEnd: ZERO_MEDIA_TIME,
		sourceDuration: t(duration),
		params: {},
		...extra,
	};
}

function videoTrack(id: string, elements: VideoTrack["elements"]): VideoTrack {
	return { id, name: id, type: "video", elements, muted: false, hidden: false };
}
function textTrack(id: string, elements: TextElement[]): TextTrack {
	return { id, name: id, type: "text", elements, hidden: false };
}
function audioTrack(id: string, elements: AudioElement[]): AudioTrack {
	return { id, name: id, type: "audio", elements, muted: false };
}
function effectTrack(id: string, elements: EffectElement[]): EffectTrack {
	return { id, name: id, type: "effect", elements, hidden: false };
}

function tracksOf(
	overlay: SceneTracks["overlay"],
	main: VideoTrack["elements"],
	audioTracks: AudioTrack[] = [],
): SceneTracks {
	return { overlay, main: videoTrack("main", main), audio: audioTracks };
}

function scene(id: string, tracks: SceneTracks, isMain = false): TScene {
	return {
		id,
		name: id,
		isMain,
		kind: isMain ? undefined : "compound",
		tracks,
		bookmarks: [],
		createdAt: new Date(0),
		updatedAt: new Date(0),
	};
}

function idFactory(prefix = "id") {
	let n = 0;
	return () => `${prefix}-${++n}`;
}

const originalId = (id: string) => id.split("/").pop() as string;

/** Timing of every element, keyed by its original (pre-compound) id. */
function timings(tracks: SceneTracks) {
	const result: Record<string, [number, number, number, number]> = {};
	for (const track of [...tracks.overlay, tracks.main, ...tracks.audio]) {
		for (const element of track.elements as TimelineElement[]) {
			result[originalId(element.id)] = [
				element.startTime,
				element.duration,
				element.trimStart,
				element.trimEnd,
			];
		}
	}
	return result;
}

/**
 * For every pair of visual elements that overlap in time, which one is drawn
 * on top. Track index 0 is the top of the stack.
 */
function stacking(tracks: SceneTracks): Set<string> {
	const visual: Array<{ id: string; index: number; el: TimelineElement }> = [];
	[...tracks.overlay, tracks.main].forEach((track, index) => {
		for (const el of track.elements as TimelineElement[]) {
			visual.push({ id: originalId(el.id), index, el });
		}
	});
	const pairs = new Set<string>();
	for (const a of visual) {
		for (const b of visual) {
			if (a.index >= b.index) continue;
			const overlap =
				a.el.startTime < b.el.startTime + b.el.duration &&
				b.el.startTime < a.el.startTime + a.el.duration;
			if (overlap) pairs.add(`${a.id}>${b.id}`);
		}
	}
	return pairs;
}

function expectSamePicture(before: SceneTracks, after: SceneTracks) {
	expect(timings(after)).toEqual(timings(before));
	expect([...stacking(after)].sort()).toEqual([...stacking(before)].sort());
}

describe("scene graph", () => {
	const a = scene("A", tracksOf([], [compound("ca", "B", 0, 10)]), true);
	const b = scene("B", tracksOf([], [compound("cb", "C", 0, 10)]));
	const c = scene("C", tracksOf([], [video("v", 0, 10)]));

	test("reachability follows compound clips", () => {
		expect(
			sceneReachesScene({
				scenes: [a, b, c],
				fromSceneId: "A",
				targetSceneId: "C",
			}),
		).toBe(true);
		expect(
			sceneReachesScene({
				scenes: [a, b, c],
				fromSceneId: "C",
				targetSceneId: "A",
			}),
		).toBe(false);
	});

	test("detects cycles, including self-reference", () => {
		const scenes = [a, b, c];
		expect(
			wouldCreateCompoundCycle({
				scenes,
				hostSceneId: "C",
				referencedSceneId: "A",
			}),
		).toBe(true);
		expect(
			wouldCreateCompoundCycle({
				scenes,
				hostSceneId: "B",
				referencedSceneId: "B",
			}),
		).toBe(true);
		expect(
			wouldCreateCompoundCycle({
				scenes,
				hostSceneId: "A",
				referencedSceneId: "C",
			}),
		).toBe(false);
	});
});

describe("clipElementToWindow", () => {
	test("leaves an element that fits untouched", () => {
		const el = video("v", 10, 20);
		expect(
			clipElementToWindow({
				element: el,
				windowStart: t(0),
				windowEnd: t(100),
			}),
		).toBe(el);
	});

	test("drops an element outside the window", () => {
		expect(
			clipElementToWindow({
				element: video("v", 0, 10),
				windowStart: t(10),
				windowEnd: t(20),
			}),
		).toBeNull();
	});

	test("cuts both edges like a split", () => {
		const clipped = clipElementToWindow({
			element: video("v", 0, 100, { trimStart: t(5), trimEnd: t(7) }),
			windowStart: t(30),
			windowEnd: t(80),
		});
		expect(clipped?.startTime).toBe(t(30));
		expect(clipped?.duration).toBe(t(50));
		expect(clipped?.trimStart).toBe(t(35));
		expect(clipped?.trimEnd).toBe(t(27));
	});

	test("respects retime when converting the cut into source time", () => {
		const clipped = clipElementToWindow({
			element: video("v", 0, 100, { retime: { rate: 2 } }),
			windowStart: t(10),
			windowEnd: t(100),
		});
		expect(clipped?.trimStart).toBe(t(20));
		expect(clipped?.duration).toBe(t(90));
	});
});

describe("flattenCompoundTracks", () => {
	test("returns the same object when there is nothing to expand", () => {
		const tracks = tracksOf([], [video("v", 0, 10)]);
		expect(flattenCompoundTracks({ tracks, scenes: [] })).toBe(tracks);
	});

	test("expands contents into outer time and cuts them to the window", () => {
		const inner = scene(
			"S",
			tracksOf(
				[textTrack("tt", [text("title", 0, 100)])],
				[video("clip", 0, 100)],
				[audioTrack("at", [audio("music", 20, 50)])],
			),
		);
		const outer = tracksOf(
			[],
			[
				video("before", 0, 50),
				compound("c", "S", 50, 40, {
					trimStart: t(30),
					trimEnd: t(30),
					sourceDuration: t(100),
				}),
			],
		);
		const flat = flattenCompoundTracks({ tracks: outer, scenes: [inner] });

		expect(flat.main.elements.map((e) => e.id)).toEqual(["before", "c/clip"]);
		const clip = flat.main.elements[1];
		expect([clip.startTime, clip.duration, clip.trimStart]).toEqual([
			t(50),
			t(40),
			t(30),
		]);

		expect(flat.overlay).toHaveLength(1);
		expect(flat.overlay[0].elements[0].startTime).toBe(t(50));

		const music = flat.audio[0].elements[0];
		// Music runs 20..70 inside; window is 30..70 -> outer 50..90.
		expect([music.startTime, music.duration, music.trimStart]).toEqual([
			t(50),
			t(40),
			t(10),
		]);
	});

	test("expands nested compound clips", () => {
		const leaf = scene("L", tracksOf([], [video("deep", 0, 10)]));
		const mid = scene("M", tracksOf([], [compound("cm", "L", 5, 10)]));
		const outer = tracksOf([], [compound("co", "M", 100, 15)]);
		const flat = flattenCompoundTracks({ tracks: outer, scenes: [leaf, mid] });
		const deep = flat.main.elements[0];
		expect(deep.id).toBe("co/cm/deep");
		expect(deep.startTime).toBe(t(105));
	});

	test("cycles, missing scenes and excess depth render nothing and terminate", () => {
		const a = scene(
			"A",
			tracksOf([], [compound("ab", "B", 0, 10), video("va", 10, 5)]),
		);
		const b = scene("B", tracksOf([], [compound("ba", "A", 0, 10)]));
		const outer = tracksOf(
			[],
			[compound("root", "A", 0, 15), compound("gone", "missing", 20, 5)],
		);
		const flat = flattenCompoundTracks({ tracks: outer, scenes: [a, b] });
		const ids = [...flat.overlay, flat.main].flatMap((track) =>
			track.elements.map((e) => e.id),
		);
		expect(ids).toEqual(["root/va"]);

		const shallow = flattenCompoundTracks({
			tracks: outer,
			scenes: [a, b],
			maxDepth: 0,
		});
		expect(shallow.main.elements).toHaveLength(0);
	});

	test("the same scene used twice gets distinct ids", () => {
		const inner = scene("S", tracksOf([], [video("v", 0, 10)]));
		const outer = tracksOf(
			[],
			[compound("c1", "S", 0, 10), compound("c2", "S", 10, 10)],
		);
		const flat = flattenCompoundTracks({ tracks: outer, scenes: [inner] });
		expect(flat.main.elements.map((e) => e.id)).toEqual(["c1/v", "c2/v"]);
	});

	test("hidden and muted carry over from host track and clip", () => {
		const inner = scene(
			"S",
			tracksOf(
				[textTrack("tt", [text("x", 0, 10)])],
				[video("v", 0, 10)],
				[audioTrack("at", [audio("a", 0, 10)])],
			),
		);
		const host = {
			...videoTrack("host", [compound("c", "S", 0, 10, { hidden: true })]),
			muted: true,
		};
		const flat = flattenCompoundTracks({
			tracks: { overlay: [host], main: videoTrack("main", []), audio: [] },
			scenes: [inner],
		});
		const expanded = flat.overlay.filter((track) => track.id.startsWith("c/"));
		expect(expanded.length).toBe(2);
		expect(expanded.every((track) => "hidden" in track && track.hidden)).toBe(
			true,
		);
		expect(flat.audio.every((track) => track.muted)).toBe(true);
	});

	test("effect layers inside a compound clip do not leak out", () => {
		const inner = scene(
			"S",
			tracksOf(
				[effectTrack("fx", [effect("blur", 0, 10)])],
				[video("v", 0, 10)],
			),
		);
		const flat = flattenCompoundTracks({
			tracks: tracksOf([], [compound("c", "S", 0, 10)]),
			scenes: [inner],
		});
		expect(flat.overlay.some((track) => track.type === "effect")).toBe(false);
	});
});

describe("buildCompoundFromSelection", () => {
	const create = (tracks: SceneTracks, refs: Array<[string, string]>) =>
		buildCompoundFromSelection({
			tracks,
			elementRefs: refs.map(([trackId, elementId]) => ({ trackId, elementId })),
			createId: idFactory(),
			sceneName: "Compound 1",
			clipName: "Compound 1",
			now: new Date(0),
		});

	test("groups main + overlay clips onto the main track without changing the picture", () => {
		const tracks = tracksOf(
			[
				textTrack("titles", [text("title", 10, 30)]),
				textTrack("other", [text("credit", 200, 10)]),
			],
			[video("a", 0, 10), video("b", 10, 50), video("c", 60, 40)],
			[audioTrack("music", [audio("song", 15, 20)])],
		);
		const result = create(tracks, [
			["main", "b"],
			["titles", "title"],
			["music", "song"],
		]);
		if (!result.ok) throw new Error(result.reason);

		expect(result.compoundTrackId).toBe("main");
		expect(result.compound.startTime).toBe(t(10));
		expect(result.compound.duration).toBe(t(50));
		expect(result.scene.kind).toBe("compound");
		expect(result.scene.tracks.main.elements[0].startTime).toBe(
			ZERO_MEDIA_TIME,
		);

		const flat = flattenCompoundTracks({
			tracks: result.hostTracks,
			scenes: [result.scene],
		});
		expectSamePicture(tracks, flat);
	});

	test("refuses effect layers", () => {
		const tracks = tracksOf(
			[effectTrack("fx", [effect("e", 0, 10)])],
			[video("a", 0, 10)],
		);
		const result = create(tracks, [
			["fx", "e"],
			["main", "a"],
		]);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("contains-effect");
	});

	test("refuses when an unselected clip is sandwiched in the stack", () => {
		const tracks = tracksOf(
			[
				textTrack("top", [text("t1", 0, 10)]),
				textTrack("mid", [text("m", 0, 10)]),
			],
			[video("a", 0, 10)],
		);
		const result = create(tracks, [
			["top", "t1"],
			["main", "a"],
		]);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("interleaved");
	});

	test("allows an unselected clip in a time gap on the same track", () => {
		const tracks = tracksOf(
			[],
			[video("a", 0, 10), video("b", 10, 10), video("c", 20, 10)],
		);
		const result = create(tracks, [
			["main", "a"],
			["main", "c"],
		]);
		if (!result.ok) throw new Error(result.reason);
		const flat = flattenCompoundTracks({
			tracks: result.hostTracks,
			scenes: [result.scene],
		});
		expectSamePicture(tracks, flat);
	});

	test("goes below an unselected clip that was above the selection", () => {
		const tracks = tracksOf(
			[
				textTrack("watermark", [text("w", 0, 100)]),
				textTrack("titles", [text("t1", 5, 5)]),
			],
			[video("a", 0, 10)],
		);
		const result = create(tracks, [
			["titles", "t1"],
			["main", "a"],
		]);
		if (!result.ok) throw new Error(result.reason);
		const flat = flattenCompoundTracks({
			tracks: result.hostTracks,
			scenes: [result.scene],
		});
		expectSamePicture(tracks, flat);
	});

	test("inserts a new track between conflicts when no existing track fits", () => {
		// t2 (unselected) is above a (selected); b (unselected) is below t1
		// (selected). The only valid slot is a new track between titles and main.
		const tracks = tracksOf(
			[textTrack("titles", [text("t2", 2, 3), text("t1", 9, 3)])],
			[video("a", 0, 10), video("b", 10, 10)],
		);
		const result = create(tracks, [
			["titles", "t1"],
			["main", "a"],
		]);
		if (!result.ok) throw new Error(result.reason);
		expect(result.hostTracks.overlay.map((track) => track.id)).toEqual([
			"titles",
			result.compoundTrackId,
		]);
		const flat = flattenCompoundTracks({
			tracks: result.hostTracks,
			scenes: [result.scene],
		});
		expectSamePicture(tracks, flat);
	});

	test("goes above an unselected clip that was below the selection", () => {
		const tracks = tracksOf(
			[
				textTrack("t", [text("t1", 0, 10)]),
				videoTrack("v", [video("x", 0, 10)]),
			],
			[video("bg", 0, 100)],
		);
		const result = create(tracks, [
			["t", "t1"],
			["v", "x"],
		]);
		if (!result.ok) throw new Error(result.reason);
		const flat = flattenCompoundTracks({
			tracks: result.hostTracks,
			scenes: [result.scene],
		});
		expectSamePicture(tracks, flat);
	});
});

describe("ungroupCompound", () => {
	test("create then ungroup restores timing and stacking", () => {
		const tracks = tracksOf(
			[textTrack("titles", [text("title", 10, 30)])],
			[video("a", 0, 10), video("b", 10, 50)],
			[audioTrack("music", [audio("song", 15, 20)])],
		);
		const created = buildCompoundFromSelection({
			tracks,
			elementRefs: [
				{ trackId: "main", elementId: "b" },
				{ trackId: "titles", elementId: "title" },
				{ trackId: "music", elementId: "song" },
			],
			createId: idFactory("c"),
			sceneName: "S",
			clipName: "S",
			now: new Date(0),
		});
		if (!created.ok) throw new Error(created.reason);

		const ungrouped = ungroupCompound({
			tracks: created.hostTracks,
			ref: { trackId: created.compoundTrackId, elementId: created.compound.id },
			scenes: [created.scene],
			createId: idFactory("u"),
		});
		if (!ungrouped.ok) throw new Error(ungrouped.reason);

		// Ids are fresh, so compare by position in time instead of by id.
		const strip = (tr: SceneTracks) =>
			[...tr.overlay, tr.main, ...tr.audio]
				.flatMap((track) =>
					track.elements.map((e) =>
						[e.type, e.startTime, e.duration, e.trimStart, e.trimEnd].join(":"),
					),
				)
				.sort();
		expect(strip(ungrouped.tracks)).toEqual(strip(tracks));
		expect(ungrouped.elementRefs).toHaveLength(3);
		expect(
			ungrouped.tracks.main.elements.some((e) => e.type === "compound"),
		).toBe(false);
	});

	test("only the visible window comes back", () => {
		const inner = scene("S", tracksOf([], [video("v", 0, 100)]));
		const tracks = tracksOf(
			[],
			[
				compound("c", "S", 0, 20, {
					trimStart: t(40),
					trimEnd: t(40),
					sourceDuration: t(100),
				}),
			],
		);
		const result = ungroupCompound({
			tracks,
			ref: { trackId: "main", elementId: "c" },
			scenes: [inner],
			createId: idFactory(),
		});
		if (!result.ok) throw new Error(result.reason);
		const v = result.tracks.main.elements[0];
		expect([v.startTime, v.duration, v.trimStart, v.trimEnd]).toEqual([
			t(0),
			t(20),
			t(40),
			t(40),
		]);
	});

	test("reports a missing scene instead of deleting the clip", () => {
		const tracks = tracksOf([], [compound("c", "gone", 0, 10)]);
		const result = ungroupCompound({
			tracks,
			ref: { trackId: "main", elementId: "c" },
			scenes: [],
			createId: idFactory(),
		});
		expect(result.ok).toBe(false);
	});
});

describe("syncCompoundSourceDurations", () => {
	test("updates bounds without moving clips and is identity when in sync", () => {
		const inner = scene("S", tracksOf([], [video("v", 0, 60)]));
		const outer = scene(
			"main",
			tracksOf([], [compound("c", "S", 5, 40, { sourceDuration: t(40) })]),
			true,
		);
		const synced = syncCompoundSourceDurations({ scenes: [outer, inner] });
		const clip = synced[0].tracks.main.elements[0] as CompoundElement;
		expect(clip.sourceDuration).toBe(t(60));
		expect(clip.trimEnd).toBe(t(20));
		expect([clip.startTime, clip.duration]).toEqual([t(5), t(40)]);
		expect(syncCompoundSourceDurations({ scenes: synced })).toBe(synced);
	});

	test("shrunk contents floor trimEnd at zero", () => {
		const inner = scene("S", tracksOf([], [video("v", 0, 10)]));
		const outer = scene(
			"main",
			tracksOf([], [compound("c", "S", 0, 40)]),
			true,
		);
		const clip = syncCompoundSourceDurations({ scenes: [outer, inner] })[0]
			.tracks.main.elements[0];
		expect(clip.trimEnd).toBe(ZERO_MEDIA_TIME);
		expect(clip.duration).toBe(t(40));
	});
});
