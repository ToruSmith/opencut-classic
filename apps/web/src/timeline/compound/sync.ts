import type { SceneTracks, TScene, VideoTrack } from "@/timeline/types";
import {
	addMediaTime,
	type MediaTime,
	subMediaTime,
	ZERO_MEDIA_TIME,
} from "@/wasm";
import { isCompoundElement, tracksContainCompound } from "./graph";

function getTracksDuration(tracks: SceneTracks): MediaTime {
	let maxEnd = ZERO_MEDIA_TIME;
	for (const track of [...tracks.overlay, tracks.main, ...tracks.audio]) {
		for (const element of track.elements) {
			const end = addMediaTime({ a: element.startTime, b: element.duration });
			if (end > maxEnd) maxEnd = end;
		}
	}
	return maxEnd;
}

/**
 * After a compound scene is edited its length can change. Bring every
 * compound clip's `sourceDuration` / `trimEnd` back in line so resizing is
 * bounded by the real contents. Never moves or resizes a clip on the outer
 * timeline: if the contents got shorter than what a clip shows, the clip keeps
 * its length and simply shows nothing at the end (`trimEnd` floors at 0).
 *
 * Returns the same array when nothing changed.
 */
export function syncCompoundSourceDurations({
	scenes,
}: {
	scenes: TScene[];
}): TScene[] {
	const durations = new Map(
		scenes.map((scene) => [scene.id, getTracksDuration(scene.tracks)]),
	);
	let changed = false;

	const syncTrack = (track: VideoTrack): VideoTrack => {
		let trackChanged = false;
		const elements = track.elements.map((element) => {
			if (!isCompoundElement(element)) return element;
			const sourceDuration = durations.get(element.sceneId);
			if (sourceDuration === undefined) return element;
			const remaining = subMediaTime({
				a: subMediaTime({ a: sourceDuration, b: element.trimStart }),
				b: element.duration,
			});
			const trimEnd = remaining > 0 ? remaining : ZERO_MEDIA_TIME;
			if (
				element.sourceDuration === sourceDuration &&
				element.trimEnd === trimEnd
			) {
				return element;
			}
			trackChanged = true;
			return { ...element, sourceDuration, trimEnd };
		});
		return trackChanged ? { ...track, elements } : track;
	};

	const next = scenes.map((scene) => {
		if (!tracksContainCompound({ tracks: scene.tracks })) return scene;
		const overlay = scene.tracks.overlay.map((track) =>
			track.type === "video" ? syncTrack(track) : track,
		);
		const main = syncTrack(scene.tracks.main);
		const sceneChanged =
			main !== scene.tracks.main ||
			overlay.some((track, index) => track !== scene.tracks.overlay[index]);
		if (!sceneChanged) return scene;
		changed = true;
		return { ...scene, tracks: { ...scene.tracks, overlay, main } };
	});

	return changed ? next : scenes;
}
