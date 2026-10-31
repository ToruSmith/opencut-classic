import type {
	AudioTrack,
	CompoundElement,
	ElementRef,
	OverlayTrack,
	SceneTracks,
	TimelineElement,
	TimelineTrack,
	TScene,
	VideoTrack,
} from "@/timeline/types";
import { MAIN_TRACK_NAME } from "@/timeline/placement/main-track";
import { canPlaceTimeSpansOnTrack } from "@/timeline/placement/overlap";
import { buildEmptyTrack } from "@/timeline/placement/track-factory";
import { addMediaTime, subMediaTime, ZERO_MEDIA_TIME } from "@/wasm";
import { shiftElement } from "./clip";

export type CompoundFailureReason =
	| "empty-selection"
	| "element-not-found"
	| "contains-effect"
	| "zero-duration"
	| "interleaved"
	| "compound-not-found"
	| "scene-not-found";

export const COMPOUND_FAILURE_MESSAGES: Record<CompoundFailureReason, string> =
	{
		"empty-selection": "Select at least one clip to create a compound clip.",
		"element-not-found": "Some selected clips no longer exist.",
		"contains-effect":
			"Effect layers can't go inside a compound clip: they would stop affecting the clips below them.",
		"zero-duration": "The selection has no length.",
		interleaved:
			"Unselected clips sit between the selected ones in the stack. Grouping them would change what is drawn on top, so select those clips too or move them first.",
		"compound-not-found": "That compound clip no longer exists.",
		"scene-not-found": "The contents of this compound clip are missing.",
	};

export type CompoundResult<T> =
	| ({ ok: true } & T)
	| { ok: false; reason: CompoundFailureReason };

type OrderedTrack = { track: TimelineTrack; index: number };

function getOrderedTracks(tracks: SceneTracks): TimelineTrack[] {
	return [...tracks.overlay, tracks.main, ...tracks.audio];
}

function isVisualTrack(track: TimelineTrack): boolean {
	return track.type !== "audio";
}

function timesOverlap(a: TimelineElement, b: TimelineElement): boolean {
	const aEnd = addMediaTime({ a: a.startTime, b: a.duration });
	const bEnd = addMediaTime({ a: b.startTime, b: b.duration });
	return a.startTime < bEnd && b.startTime < aEnd;
}

function withElements<TTrack extends TimelineTrack>(
	track: TTrack,
	elements: TimelineElement[],
): TTrack {
	return { ...track, elements } as TTrack;
}

/**
 * Move the selected elements into a new scene and put one compound clip in
 * their place. Pure: the caller supplies ids and commits the result.
 *
 * Refuses (instead of guessing) whenever the result could look or sound
 * different from the original:
 * - effect layers in the selection (they would stop applying to outer clips);
 * - unselected visual clips stacked between selected ones inside the time
 *   window (the compound clip occupies one stack position, so those clips
 *   would end up above or below all of its contents).
 */
export function buildCompoundFromSelection({
	tracks,
	elementRefs,
	createId,
	sceneName,
	clipName,
	now,
}: {
	tracks: SceneTracks;
	elementRefs: ElementRef[];
	createId: () => string;
	sceneName: string;
	clipName: string;
	now: Date;
}): CompoundResult<{
	hostTracks: SceneTracks;
	scene: TScene;
	compound: CompoundElement;
	compoundTrackId: string;
}> {
	if (elementRefs.length === 0) return { ok: false, reason: "empty-selection" };

	const orderedTracks = getOrderedTracks(tracks);
	const selectedByTrack = new Map<string, Set<string>>();
	for (const ref of elementRefs) {
		const ids = selectedByTrack.get(ref.trackId) ?? new Set<string>();
		ids.add(ref.elementId);
		selectedByTrack.set(ref.trackId, ids);
	}

	const selected: Array<OrderedTrack & { elements: TimelineElement[] }> = [];
	let foundCount = 0;
	orderedTracks.forEach((track, index) => {
		const ids = selectedByTrack.get(track.id);
		if (!ids) return;
		const elements = (track.elements as TimelineElement[]).filter((element) =>
			ids.has(element.id),
		);
		foundCount += elements.length;
		if (elements.length > 0) selected.push({ track, index, elements });
	});

	const uniqueRefCount = new Set(
		elementRefs.map((ref) => `${ref.trackId}:${ref.elementId}`),
	).size;
	if (foundCount !== uniqueRefCount) {
		return { ok: false, reason: "element-not-found" };
	}
	if (selected.some(({ track }) => track.type === "effect")) {
		return { ok: false, reason: "contains-effect" };
	}

	const allSelected = selected.flatMap(({ elements }) => elements);
	const windowStart = allSelected.reduce(
		(min, element) => (element.startTime < min ? element.startTime : min),
		allSelected[0].startTime,
	);
	const windowEnd = allSelected.reduce((max, element) => {
		const end = addMediaTime({ a: element.startTime, b: element.duration });
		return end > max ? end : max;
	}, ZERO_MEDIA_TIME);
	if (windowEnd <= windowStart) return { ok: false, reason: "zero-duration" };

	const isSelected = (trackId: string, elementId: string) =>
		selectedByTrack.get(trackId)?.has(elementId) === true;

	// Stacking-order guard. For every unselected visual clip U that overlaps a
	// selected visual clip S in time, U must stay on the same side (above or
	// below) of the compound clip as it was of S. That bounds where the
	// compound clip may go: strictly below every such U that was above, and
	// strictly above every such U that was below.
	const selectedVisual = selected.filter(({ track }) => isVisualTrack(track));
	let lowestConflictAbove = -1;
	let highestConflictBelow = Number.POSITIVE_INFINITY;
	orderedTracks.forEach((track, index) => {
		if (!isVisualTrack(track)) return;
		for (const element of track.elements as TimelineElement[]) {
			if (isSelected(track.id, element.id)) continue;
			for (const { index: selectedIndex, elements } of selectedVisual) {
				if (selectedIndex === index) continue;
				const overlaps = elements.some((selectedElement) =>
					timesOverlap(element, selectedElement),
				);
				if (!overlaps) continue;
				if (index < selectedIndex) {
					lowestConflictAbove = Math.max(lowestConflictAbove, index);
				} else {
					highestConflictBelow = Math.min(highestConflictBelow, index);
				}
			}
		}
	});
	if (lowestConflictAbove >= highestConflictBelow) {
		return { ok: false, reason: "interleaved" };
	}

	// Inner scene, in the compound clip's own time (window start = 0).
	const toInner = (elements: TimelineElement[]) =>
		elements.map((element) =>
			shiftElement({
				element,
				offset: subMediaTime({ a: ZERO_MEDIA_TIME, b: windowStart }),
			}),
		);

	const innerOverlay: OverlayTrack[] = [];
	const innerAudio: AudioTrack[] = [];
	let innerMain: VideoTrack = {
		...buildEmptyTrack({
			id: createId(),
			type: "video",
			name: MAIN_TRACK_NAME,
		}),
		muted: tracks.main.muted,
		hidden: tracks.main.hidden,
	};

	for (const { track, elements } of selected) {
		const innerElements = toInner(elements);
		if (track.id === tracks.main.id) {
			// The main track keeps its "first clip starts at 0" invariant only if
			// the earliest selected main clip is at the window start.
			const earliest = Math.min(...elements.map((e) => e.startTime));
			if (earliest === windowStart) {
				innerMain = withElements(innerMain, innerElements);
			} else {
				innerOverlay.push(
					withElements({ ...tracks.main, id: createId() }, innerElements),
				);
			}
			continue;
		}
		if (track.type === "audio") {
			innerAudio.push(
				withElements({ ...track, id: createId() }, innerElements),
			);
			continue;
		}
		innerOverlay.push(
			withElements(
				{ ...(track as OverlayTrack), id: createId() },
				innerElements,
			),
		);
	}

	const sceneDuration = subMediaTime({ a: windowEnd, b: windowStart });
	const scene: TScene = {
		id: createId(),
		name: sceneName,
		isMain: false,
		kind: "compound",
		tracks: { overlay: innerOverlay, main: innerMain, audio: innerAudio },
		bookmarks: [],
		createdAt: now,
		updatedAt: now,
	};

	const compound: CompoundElement = {
		id: createId(),
		type: "compound",
		name: clipName,
		sceneId: scene.id,
		startTime: windowStart,
		duration: sceneDuration,
		trimStart: ZERO_MEDIA_TIME,
		trimEnd: ZERO_MEDIA_TIME,
		sourceDuration: sceneDuration,
		params: {},
	};

	// Remove the selection from the host.
	const strip = <TTrack extends TimelineTrack>(track: TTrack): TTrack =>
		selectedByTrack.has(track.id)
			? withElements(
					track,
					(track.elements as TimelineElement[]).filter(
						(element) => !isSelected(track.id, element.id),
					),
				)
			: track;
	let hostTracks: SceneTracks = {
		overlay: tracks.overlay.map(strip),
		main: strip(tracks.main),
		audio: tracks.audio.map(strip),
	};

	// Place the compound clip. An existing video track at index t is allowed
	// when lowestConflictAbove < t < highestConflictBelow and the window is free
	// on it; prefer the lowest such track (the main track first). Otherwise a
	// new video track is inserted at overlay position p, which sits between
	// ordered tracks p - 1 and p, allowed when lowestConflictAbove < p <=
	// highestConflictBelow.
	const span = [{ startTime: windowStart, duration: sceneDuration }];
	const hostOrdered = getOrderedTracks(hostTracks);
	const mainIndex = hostTracks.overlay.length;
	let targetIndex = -1;
	for (
		let index = Math.min(mainIndex, highestConflictBelow - 1);
		index > lowestConflictAbove;
		index--
	) {
		const track = hostOrdered[index];
		if (
			track.type === "video" &&
			canPlaceTimeSpansOnTrack({ track, timeSpans: span })
		) {
			targetIndex = index;
			break;
		}
	}

	let compoundTrackId: string;
	if (targetIndex >= 0) {
		const target = hostOrdered[targetIndex] as VideoTrack;
		compoundTrackId = target.id;
		const placed: VideoTrack = {
			...target,
			elements: [...target.elements, compound],
		};
		hostTracks =
			target.id === hostTracks.main.id
				? { ...hostTracks, main: placed }
				: {
						...hostTracks,
						overlay: hostTracks.overlay.map((track) =>
							track.id === target.id ? placed : track,
						),
					};
	} else {
		const topIndex =
			selectedVisual.length > 0
				? Math.min(...selectedVisual.map(({ index }) => index))
				: 0;
		const maxInsert = Math.min(mainIndex, highestConflictBelow);
		const insertAt = Math.min(
			Math.max(topIndex, lowestConflictAbove + 1),
			maxInsert,
		);
		const newTrack: VideoTrack = {
			...buildEmptyTrack({ id: createId(), type: "video" }),
			elements: [compound],
		};
		compoundTrackId = newTrack.id;
		const overlay = [...hostTracks.overlay];
		overlay.splice(insertAt, 0, newTrack);
		hostTracks = { ...hostTracks, overlay };
	}

	return { ok: true, hostTracks, scene, compound, compoundTrackId };
}
