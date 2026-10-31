import type { ElementRef, TScene } from "@/timeline";
import {
	buildCompoundFromSelection,
	type CompoundFailureReason,
	ungroupCompound,
} from "@/timeline/compound";
import { generateUUID } from "@/utils/id";
import type { ScenesChange } from "./scenes-snapshot";

export type PlanResult =
	| { ok: true; change: ScenesChange; sceneId: string }
	| { ok: false; reason: CompoundFailureReason };

function nextCompoundName({ scenes }: { scenes: TScene[] }): string {
	const used = new Set(scenes.map((scene) => scene.name));
	let n = scenes.filter((scene) => scene.kind === "compound").length + 1;
	while (used.has(`Compound clip ${n}`)) n++;
	return `Compound clip ${n}`;
}

export function planCreateCompound({
	scenes,
	activeScene,
	elementRefs,
}: {
	scenes: TScene[];
	activeScene: TScene;
	elementRefs: ElementRef[];
}): PlanResult {
	const name = nextCompoundName({ scenes });
	const result = buildCompoundFromSelection({
		tracks: activeScene.tracks,
		elementRefs,
		createId: generateUUID,
		sceneName: name,
		clipName: name,
		now: new Date(),
	});
	if (!result.ok) return result;

	const updatedHost: TScene = {
		...activeScene,
		tracks: result.hostTracks,
		updatedAt: new Date(),
	};
	return {
		ok: true,
		sceneId: result.scene.id,
		change: {
			scenes: [
				...scenes.map((scene) =>
					scene.id === activeScene.id ? updatedHost : scene,
				),
				result.scene,
			],
			selection: [
				{ trackId: result.compoundTrackId, elementId: result.compound.id },
			],
		},
	};
}

export function planUngroupCompound({
	scenes,
	activeScene,
	ref,
}: {
	scenes: TScene[];
	activeScene: TScene;
	ref: ElementRef;
}): PlanResult {
	const result = ungroupCompound({
		tracks: activeScene.tracks,
		ref,
		scenes,
		createId: generateUUID,
	});
	if (!result.ok) return result;

	const updatedHost: TScene = {
		...activeScene,
		tracks: result.tracks,
		updatedAt: new Date(),
	};
	// The compound scene stays: other clips may use it, and undo needs it.
	// Unused compound scenes can be deleted from the scenes panel.
	return {
		ok: true,
		sceneId: activeScene.id,
		change: {
			scenes: scenes.map((scene) =>
				scene.id === activeScene.id ? updatedHost : scene,
			),
			selection: result.elementRefs,
		},
	};
}
