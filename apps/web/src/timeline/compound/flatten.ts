import type {
	AudioTrack,
	CompoundElement,
	OverlayTrack,
	SceneTracks,
	TimelineElement,
	TimelineTrack,
	TScene,
	VideoTrack,
} from "@/timeline/types";
import { subMediaTime, addMediaTime } from "@/wasm";
import { clipElementToWindow, shiftElement } from "./clip";
import { isCompoundElement, tracksContainCompound } from "./graph";

/**
 * Nesting deeper than this renders nothing for the excess levels. It is a
 * backstop: creation already refuses cycles, so real projects stay far below.
 */
export const MAX_COMPOUND_DEPTH = 16;

const ID_SEPARATOR = "/";

/**
 * Expand every compound clip into ordinary elements so that the renderer, the
 * audio mixer and the exporter can keep treating tracks as a single flat
 * level. This is the only place that understands nesting on the playback path.
 *
 * Guarantees:
 * - Identity when there is nothing to expand (same object back), so callers
 *   pay nothing for projects without compound clips.
 * - Inner elements are cut to the compound clip's visible window with the same
 *   arithmetic as a manual split, then moved to outer time.
 * - Expanded content sits at the compound clip's own position in the stack, so
 *   stacking order against the rest of the outer timeline is unchanged.
 * - Host track `hidden` / `muted` and the clip's own `hidden` flag carry over.
 * - Effect layers inside a compound clip are not expanded: they would apply to
 *   outer tracks below the clip and leak out of it.
 * - Missing scenes, cycles and excess depth expand to nothing instead of
 *   throwing or recursing forever.
 * - Expanded ids are `<compoundId>/<innerId>`, unique even when the same scene
 *   is used by several compound clips.
 */
export function flattenCompoundTracks({
	tracks,
	scenes,
	maxDepth = MAX_COMPOUND_DEPTH,
}: {
	tracks: SceneTracks;
	scenes: TScene[];
	maxDepth?: number;
}): SceneTracks {
	if (!tracksContainCompound({ tracks })) return tracks;

	const scenesById = new Map(scenes.map((scene) => [scene.id, scene]));
	return expandTracks({
		tracks,
		scenesById,
		ancestors: new Set(),
		depth: 0,
		maxDepth,
	});
}

/** Convenience for callers that hold a scene: flattens that scene's tracks. */
export function resolvePlaybackTracks({
	scene,
	scenes,
}: {
	scene: TScene;
	scenes: TScene[];
}): SceneTracks {
	return flattenCompoundTracks({
		tracks: scene.tracks,
		scenes,
		maxDepth: MAX_COMPOUND_DEPTH,
	});
}

interface ExpandContext {
	scenesById: Map<string, TScene>;
	ancestors: Set<string>;
	depth: number;
	maxDepth: number;
}

function expandTracks({
	tracks,
	...context
}: ExpandContext & { tracks: SceneTracks }): SceneTracks {
	if (!tracksContainCompound({ tracks })) return tracks;

	const overlay: OverlayTrack[] = [];
	const audio: AudioTrack[] = [];

	for (const track of tracks.overlay) {
		if (track.type !== "video") {
			overlay.push(track);
			continue;
		}
		const expanded = expandHostTrack({ track, ...context });
		overlay.push(...expanded.tracksAbove, expanded.host);
		audio.push(...expanded.audio);
	}

	const expandedMain = expandHostTrack({ track: tracks.main, ...context });
	overlay.push(...expandedMain.tracksAbove);
	audio.push(...expandedMain.audio);

	return {
		overlay,
		main: expandedMain.host,
		audio: [...tracks.audio, ...audio],
	};
}

function expandHostTrack({
	track,
	...context
}: ExpandContext & { track: VideoTrack }): {
	host: VideoTrack;
	tracksAbove: OverlayTrack[];
	audio: AudioTrack[];
} {
	const compounds = track.elements.filter(isCompoundElement);
	if (compounds.length === 0) {
		return { host: track, tracksAbove: [], audio: [] };
	}

	const hostElements: VideoTrack["elements"] = track.elements.filter(
		(element) => !isCompoundElement(element),
	);
	const tracksAbove: OverlayTrack[] = [];
	const audio: AudioTrack[] = [];

	for (const compound of compounds) {
		const contents = expandCompound({ compound, ...context });
		if (!contents) continue;

		const hidden = track.hidden || compound.hidden === true;
		const muted = track.muted;

		// Inner main track merges into the host track when its flags would not
		// change anything; it occupies the compound clip's slot, which is free.
		const innerMain = contents.main;
		const canMergeMain = !innerMain.hidden && !innerMain.muted && !hidden;
		if (canMergeMain) {
			hostElements.push(...innerMain.elements);
		}

		const visualTracks: OverlayTrack[] = [
			...contents.overlay,
			...(canMergeMain ? [] : [innerMain]),
		];
		for (const innerTrack of visualTracks) {
			if (innerTrack.elements.length === 0) continue;
			tracksAbove.push(
				applyHostFlags({ track: innerTrack, hidden, muted }) as OverlayTrack,
			);
		}

		for (const innerTrack of contents.audio) {
			if (innerTrack.elements.length === 0) continue;
			audio.push(
				applyHostFlags({ track: innerTrack, hidden, muted }) as AudioTrack,
			);
		}
	}

	return {
		host: { ...track, elements: hostElements },
		tracksAbove,
		audio,
	};
}

/**
 * The contents of one compound clip, expanded recursively, cut to the clip's
 * window and moved into the outer timeline's time.
 */
function expandCompound({
	compound,
	scenesById,
	ancestors,
	depth,
	maxDepth,
}: ExpandContext & { compound: CompoundElement }): SceneTracks | null {
	const scene = scenesById.get(compound.sceneId);
	if (!scene) return null;
	if (ancestors.has(scene.id)) return null;
	if (depth >= maxDepth) return null;

	const nextAncestors = new Set(ancestors);
	nextAncestors.add(scene.id);
	const inner = expandTracks({
		tracks: scene.tracks,
		scenesById,
		ancestors: nextAncestors,
		depth: depth + 1,
		maxDepth,
	});

	const windowStart = compound.trimStart;
	const windowEnd = addMediaTime({
		a: compound.trimStart,
		b: compound.duration,
	});
	const offset = subMediaTime({ a: compound.startTime, b: compound.trimStart });

	const mapTrack = <TTrack extends TimelineTrack>(
		innerTrack: TTrack,
	): TTrack => {
		const elements: TimelineElement[] = [];
		for (const element of innerTrack.elements) {
			const clipped = clipElementToWindow({ element, windowStart, windowEnd });
			if (!clipped) continue;
			const shifted = shiftElement({ element: clipped, offset });
			elements.push({
				...shifted,
				id: `${compound.id}${ID_SEPARATOR}${element.id}`,
			});
		}
		return {
			...innerTrack,
			id: `${compound.id}${ID_SEPARATOR}${innerTrack.id}`,
			elements,
		} as TTrack;
	};

	return {
		overlay: inner.overlay
			.filter((innerTrack) => innerTrack.type !== "effect")
			.map(mapTrack),
		main: mapTrack(inner.main),
		audio: inner.audio.map(mapTrack),
	};
}

function applyHostFlags({
	track,
	hidden,
	muted,
}: {
	track: TimelineTrack;
	hidden: boolean;
	muted: boolean;
}): TimelineTrack {
	let next: TimelineTrack = track;
	if (hidden && "hidden" in next) {
		next = { ...next, hidden: true } as TimelineTrack;
	}
	if (muted && "muted" in next) {
		next = { ...next, muted: true } as TimelineTrack;
	}
	return next;
}
