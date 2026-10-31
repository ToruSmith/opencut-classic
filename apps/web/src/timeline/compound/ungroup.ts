import type {
	AudioTrack,
	ElementRef,
	OverlayTrack,
	SceneTracks,
	TimelineElement,
	TimelineTrack,
	TScene,
	VideoTrack,
} from "@/timeline/types";
import { addMediaTime, subMediaTime } from "@/wasm";
import { clipElementToWindow, shiftElement } from "./clip";
import type { CompoundResult } from "./create";
import { isCompoundElement } from "./graph";

/**
 * Replace one compound clip with its contents. Pure: the caller supplies ids.
 *
 * - Only the part of the contents visible through the clip's window comes
 *   back, cut with the same arithmetic as a manual split.
 * - Elements get fresh ids, because the same scene may also be used by other
 *   compound clips.
 * - Stacking order is preserved exactly: the lowest inner visual track goes
 *   into the compound clip's own track (its slot is now free) when it is a
 *   video track, and every other inner visual track becomes a new track
 *   directly above it, in the same order. Inner audio tracks become new audio
 *   tracks.
 * - The referenced scene is left untouched; other compound clips may still
 *   use it, and undo restores the clip.
 */
export function ungroupCompound({
	tracks,
	ref,
	scenes,
	createId,
}: {
	tracks: SceneTracks;
	ref: ElementRef;
	scenes: TScene[];
	createId: () => string;
}): CompoundResult<{ tracks: SceneTracks; elementRefs: ElementRef[] }> {
	const hostTrack = [...tracks.overlay, tracks.main].find(
		(track) => track.id === ref.trackId,
	);
	const compound =
		hostTrack?.type === "video"
			? hostTrack.elements.find((element) => element.id === ref.elementId)
			: undefined;
	if (
		!hostTrack ||
		hostTrack.type !== "video" ||
		!compound ||
		!isCompoundElement(compound)
	) {
		return { ok: false, reason: "compound-not-found" };
	}
	const scene = scenes.find((candidate) => candidate.id === compound.sceneId);
	if (!scene) return { ok: false, reason: "scene-not-found" };

	const windowStart = compound.trimStart;
	const windowEnd = addMediaTime({
		a: compound.trimStart,
		b: compound.duration,
	});
	const offset = subMediaTime({ a: compound.startTime, b: compound.trimStart });
	const elementRefs: ElementRef[] = [];

	const mapTrack = <TTrack extends TimelineTrack>(
		innerTrack: TTrack,
		targetTrackId: string,
	): TimelineElement[] => {
		const elements: TimelineElement[] = [];
		for (const element of innerTrack.elements as TimelineElement[]) {
			const clipped = clipElementToWindow({ element, windowStart, windowEnd });
			if (!clipped) continue;
			let next = shiftElement({ element: clipped, offset });
			next = { ...next, id: createId() };
			if (compound.hidden && next.type !== "audio" && next.type !== "effect") {
				next = { ...next, hidden: true } as TimelineElement;
			}
			elements.push(next);
			elementRefs.push({ trackId: targetTrackId, elementId: next.id });
		}
		return elements;
	};

	// Inner visual tracks, top to bottom, skipping empty ones.
	const innerVisual: Array<OverlayTrack | VideoTrack> = [
		...scene.tracks.overlay,
		scene.tracks.main,
	].filter((track) => track.elements.length > 0);

	const hostWithoutCompound: VideoTrack = {
		...hostTrack,
		elements: hostTrack.elements.filter(
			(element) => element.id !== compound.id,
		),
	};

	let hostElements = hostWithoutCompound.elements;
	const bottom = innerVisual[innerVisual.length - 1];
	const mergeBottomIntoHost =
		bottom !== undefined &&
		bottom.type === "video" &&
		bottom.hidden === hostTrack.hidden &&
		bottom.muted === hostTrack.muted;
	if (mergeBottomIntoHost) {
		hostElements = [
			...hostElements,
			...(mapTrack(bottom, hostTrack.id) as VideoTrack["elements"]),
		];
	}
	const newHost: VideoTrack = {
		...hostWithoutCompound,
		elements: hostElements,
	};

	const tracksToInsert = mergeBottomIntoHost
		? innerVisual.slice(0, -1)
		: innerVisual;
	const newVisualTracks: OverlayTrack[] = [];
	for (const innerTrack of tracksToInsert) {
		const id = createId();
		const elements = mapTrack(innerTrack, id);
		if (elements.length === 0) continue;
		newVisualTracks.push({ ...innerTrack, id, elements } as OverlayTrack);
	}

	const newAudioTracks: AudioTrack[] = [];
	for (const innerTrack of scene.tracks.audio) {
		const id = createId();
		const elements = mapTrack(innerTrack, id);
		if (elements.length === 0) continue;
		newAudioTracks.push({
			...innerTrack,
			id,
			elements: elements as AudioTrack["elements"],
		});
	}

	// Insert new visual tracks directly above the host track, keeping order.
	let overlay: OverlayTrack[];
	let main = tracks.main;
	if (hostTrack.id === tracks.main.id) {
		main = newHost;
		overlay = [...tracks.overlay, ...newVisualTracks];
	} else {
		overlay = [];
		for (const track of tracks.overlay) {
			if (track.id === hostTrack.id) {
				overlay.push(...newVisualTracks, newHost);
			} else {
				overlay.push(track);
			}
		}
	}

	return {
		ok: true,
		tracks: { overlay, main, audio: [...newAudioTracks, ...tracks.audio] },
		elementRefs,
	};
}
