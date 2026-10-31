import type { CompoundElement, SceneTracks, TScene } from "@/timeline/types";

/**
 * Scene reference graph for compound clips.
 *
 * A compound clip in scene A that points at scene B is an edge A -> B. The
 * graph must stay acyclic: a cycle would make a scene contain itself, which
 * cannot be rendered. Every path that can add an edge (create, paste, insert)
 * checks `wouldCreateCompoundCycle` first; the flattener also guards against
 * cycles so that corrupt data can never hang playback.
 */

export function isCompoundElement(element: {
	type: string;
}): element is CompoundElement {
	return element.type === "compound";
}

export function collectCompoundElements({
	tracks,
}: {
	tracks: SceneTracks;
}): CompoundElement[] {
	const result: CompoundElement[] = [];
	for (const track of [...tracks.overlay, tracks.main]) {
		if (track.type !== "video") continue;
		for (const element of track.elements) {
			if (isCompoundElement(element)) result.push(element);
		}
	}
	return result;
}

export function tracksContainCompound({
	tracks,
}: {
	tracks: SceneTracks;
}): boolean {
	return collectCompoundElements({ tracks }).length > 0;
}

export function getReferencedSceneIds({
	tracks,
}: {
	tracks: SceneTracks;
}): Set<string> {
	return new Set(
		collectCompoundElements({ tracks }).map((element) => element.sceneId),
	);
}

/** True when `targetSceneId` can be reached from `fromSceneId` (inclusive). */
export function sceneReachesScene({
	scenes,
	fromSceneId,
	targetSceneId,
}: {
	scenes: TScene[];
	fromSceneId: string;
	targetSceneId: string;
}): boolean {
	const scenesById = new Map(scenes.map((scene) => [scene.id, scene]));
	const visited = new Set<string>();
	const stack = [fromSceneId];

	while (stack.length > 0) {
		const sceneId = stack.pop() as string;
		if (sceneId === targetSceneId) return true;
		if (visited.has(sceneId)) continue;
		visited.add(sceneId);

		const scene = scenesById.get(sceneId);
		if (!scene) continue;
		for (const referencedId of getReferencedSceneIds({
			tracks: scene.tracks,
		})) {
			if (!visited.has(referencedId)) stack.push(referencedId);
		}
	}

	return false;
}

/**
 * Would placing a compound clip that references `referencedSceneId` inside
 * `hostSceneId` make a scene contain itself?
 */
export function wouldCreateCompoundCycle({
	scenes,
	hostSceneId,
	referencedSceneId,
}: {
	scenes: TScene[];
	hostSceneId: string;
	referencedSceneId: string;
}): boolean {
	return sceneReachesScene({
		scenes,
		fromSceneId: referencedSceneId,
		targetSceneId: hostSceneId,
	});
}

/** Scenes that contain at least one compound clip pointing at `sceneId`. */
export function findScenesReferencingScene({
	scenes,
	sceneId,
}: {
	scenes: TScene[];
	sceneId: string;
}): TScene[] {
	return scenes.filter((scene) =>
		getReferencedSceneIds({ tracks: scene.tracks }).has(sceneId),
	);
}
