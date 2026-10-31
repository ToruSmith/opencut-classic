import {
	Command,
	createElementSelectionResult,
	type CommandResult,
} from "@/commands/base-command";
import { EditorCore } from "@/core";
import type { ElementRef, TScene } from "@/timeline";

export interface ScenesChange {
	scenes: TScene[];
	selection: ElementRef[];
}

/**
 * Applies a precomputed change to the whole scene list. Compound clip
 * operations change more than one scene at once (the host scene and the
 * compound scene), which `TracksSnapshotCommand` cannot express.
 *
 * The change is planned before the command runs (see `planCreateCompound` /
 * `planUngroupCompound`), so a refused operation never reaches the history,
 * and redo reapplies the exact same result: ids stay stable and later
 * commands in the history still find the elements they refer to.
 */
export class ScenesSnapshotCommand extends Command {
	private before: { scenes: TScene[]; activeSceneId: string } | null = null;

	constructor(
		private readonly change: ScenesChange,
		private readonly activeSceneId: string,
	) {
		super();
	}

	get suppressesRipple(): boolean {
		return true;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.before = {
			scenes: editor.scenes.getScenes(),
			activeSceneId: editor.scenes.getActiveScene().id,
		};
		editor.timeline.discardPreview();
		editor.scenes.setScenes({
			scenes: this.change.scenes,
			activeSceneId: this.activeSceneId,
		});
		return createElementSelectionResult(this.change.selection);
	}

	undo(): void {
		if (!this.before) return;
		const editor = EditorCore.getInstance();
		editor.timeline.discardPreview();
		editor.scenes.setScenes({
			scenes: this.before.scenes,
			activeSceneId: this.before.activeSceneId,
		});
	}
}
