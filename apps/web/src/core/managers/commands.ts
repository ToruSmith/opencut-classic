import type { EditorCore } from "@/core";
import type { Command, CommandResult } from "@/commands";
import type { EditorSelectionSnapshot } from "@/selection/editor-selection";
import { applyRippleAdjustments, computeRippleAdjustments } from "@/ripple";
import type { SceneTracks } from "@/timeline/types";

interface CommandHistoryEntry {
	command: Command;
	previousSelection: EditorSelectionSnapshot;
	selectionOverride?: EditorSelectionSnapshot;
	/**
	 * Scene that was active when the command ran. Most commands undo by writing
	 * saved tracks into the active scene, so undo/redo must run in that scene
	 * even if the user has since switched (e.g. opened a compound clip).
	 */
	sceneId: string | null;
}

export class CommandManager {
	public isRippleEnabled = false;
	private history: CommandHistoryEntry[] = [];
	private redoStack: CommandHistoryEntry[] = [];
	private reactors: Array<() => void> = [];

	constructor(private editor: EditorCore) {}

	execute({ command }: { command: Command }): Command {
		const beforeTracks =
			this.isRippleEnabled && !command.suppressesRipple
				? (this.editor.scenes.getActiveSceneOrNull()?.tracks ?? null)
				: null;
		const previousSelection = this.getSelectionSnapshot();
		const sceneId = this.getActiveSceneId();
		const result = command.execute();
		this.applyRippleIfEnabled({ beforeTracks });
		const selectionOverride = this.applySelectionOverride(result);
		this.runReactors();
		this.history.push({
			command,
			previousSelection,
			selectionOverride,
			sceneId,
		});
		this.redoStack = [];
		return command;
	}

	push({ command }: { command: Command }): void {
		this.history.push({
			command,
			previousSelection: this.getSelectionSnapshot(),
			sceneId: this.getActiveSceneId(),
		});
		this.redoStack = [];
	}

	registerReactor(reactor: () => void): void {
		this.reactors.push(reactor);
	}

	undo(): void {
		if (this.history.length === 0) return;
		const entry = this.history.pop();
		if (entry && !this.activateEntryScene({ entry })) {
			return;
		}
		entry?.command.undo();
		if (entry) {
			// Only restore selection for commands that explicitly changed it.
			// Commands without selection intent leave selection untouched,
			// preserving any UI-driven selection changes (clicks, box select)
			// that happened between commands. Commands that remove editor-owned
			// selection targets must declare a selection override to clear stale refs.
			if (entry.selectionOverride !== undefined) {
				this.editor.selection.restoreSnapshot({
					snapshot: entry.previousSelection,
				});
			}
			this.redoStack.push(entry);
		}
	}

	redo(): void {
		if (this.redoStack.length === 0) return;
		const entry = this.redoStack.pop();
		if (!entry) {
			return;
		}
		if (!this.activateEntryScene({ entry })) {
			return;
		}

		const beforeTracks =
			this.isRippleEnabled && !entry.command.suppressesRipple
				? (this.editor.scenes.getActiveSceneOrNull()?.tracks ?? null)
				: null;
		const previousSelection = this.getSelectionSnapshot();
		const result = entry.command.redo();
		this.applyRippleIfEnabled({ beforeTracks });
		const selectionOverride = this.applySelectionOverride(result);
		this.runReactors();

		this.history.push({
			command: entry.command,
			previousSelection,
			selectionOverride,
			sceneId: entry.sceneId,
		});
	}

	private getActiveSceneId(): string | null {
		return this.editor.scenes.getActiveSceneOrNull()?.id ?? null;
	}

	/**
	 * Switch to the scene a history entry belongs to. Returns false (and drops
	 * the entry) when that scene no longer exists, because undoing it would
	 * write its saved tracks into the wrong scene.
	 */
	private activateEntryScene({
		entry,
	}: {
		entry: CommandHistoryEntry;
	}): boolean {
		if (!entry.sceneId || entry.sceneId === this.getActiveSceneId()) {
			return true;
		}
		const exists = this.editor.scenes
			.getScenes()
			.some((scene) => scene.id === entry.sceneId);
		if (!exists) {
			console.warn(
				"[commands] Dropped a history entry whose scene no longer exists.",
			);
			return false;
		}
		// switchToScene has no awaits, so the switch is complete on return.
		void this.editor.scenes.switchToScene({ sceneId: entry.sceneId });
		return true;
	}

	canUndo(): boolean {
		return this.history.length > 0;
	}

	canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	clear(): void {
		this.history = [];
		this.redoStack = [];
	}

	private getSelectionSnapshot(): EditorSelectionSnapshot {
		return this.editor.selection.getSnapshot();
	}

	private applySelectionOverride(
		result: CommandResult | undefined,
	): EditorSelectionSnapshot | undefined {
		if (!result?.selection) {
			return undefined;
		}
		return this.editor.selection.applySelectionPatch({
			patch: result.selection,
		});
	}

	private runReactors(): void {
		for (const reactor of this.reactors) {
			reactor();
		}
	}

	private applyRippleIfEnabled({
		beforeTracks,
	}: {
		beforeTracks: SceneTracks | null;
	}): void {
		if (!this.isRippleEnabled || !beforeTracks) {
			return;
		}

		const afterTracks = this.editor.scenes.getActiveSceneOrNull()?.tracks;
		if (!afterTracks) {
			return;
		}
		const adjustments = computeRippleAdjustments({
			beforeTracks,
			afterTracks,
		});
		if (adjustments.length === 0) {
			return;
		}

		const tracksWithRipple = applyRippleAdjustments({
			tracks: afterTracks,
			adjustments,
		});
		this.editor.timeline.updateTracks(tracksWithRipple);
	}
}
