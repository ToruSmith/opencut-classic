import type { EditorCore } from "@/core";
import type {
	Bookmark,
	ElementRef,
	SceneTracks,
	TimelineElement,
	TScene,
} from "@/timeline";
import { storageService } from "@/services/storage/service";
import {
	getMainScene,
	ensureMainScene,
	canDeleteScene,
	findCurrentScene,
} from "@/timeline/scenes";
import {
	getBookmarkAtTime,
	getFrameTime,
	isBookmarkAtTime,
} from "@/timeline/bookmarks/index";
import {
	CreateSceneCommand,
	DeleteSceneCommand,
	MoveBookmarkCommand,
	RemoveBookmarkCommand,
	RenameSceneCommand,
	ToggleBookmarkCommand,
	UpdateBookmarkCommand,
} from "@/commands/scene";
import {
	addMediaTime,
	type MediaTime,
	maxMediaTime,
	minMediaTime,
	subMediaTime,
	ZERO_MEDIA_TIME,
} from "@/wasm";
import {
	type CompoundFailureReason,
	findScenesReferencingScene,
	flattenCompoundTracks,
	isCompoundElement,
	syncCompoundSourceDurations,
} from "@/timeline/compound";
import {
	type PlanResult,
	planCreateCompound,
	planUngroupCompound,
	ScenesSnapshotCommand,
} from "@/commands/timeline/compound";

type CompoundActionResult =
	| { ok: true }
	| { ok: false; reason: CompoundFailureReason };

interface CompoundNavigationEntry {
	parentSceneId: string;
	compoundElementId: string;
}

export class ScenesManager {
	private active: TScene | null = null;
	private list: TScene[] = [];
	private listeners = new Set<() => void>();
	/** Where the user came from when they opened compound clips (not saved). */
	private compoundPath: CompoundNavigationEntry[] = [];

	constructor(private editor: EditorCore) {}

	createCompoundFromSelection({
		elementRefs,
	}: {
		elementRefs: ElementRef[];
	}): CompoundActionResult {
		const activeScene = this.getActiveScene();
		return this.applyPlan(
			planCreateCompound({ scenes: this.list, activeScene, elementRefs }),
			activeScene.id,
		);
	}

	ungroupCompound({ ref }: { ref: ElementRef }): CompoundActionResult {
		const activeScene = this.getActiveScene();
		return this.applyPlan(
			planUngroupCompound({ scenes: this.list, activeScene, ref }),
			activeScene.id,
		);
	}

	private applyPlan(
		plan: PlanResult,
		activeSceneId: string,
	): CompoundActionResult {
		if (!plan.ok) return plan;
		this.editor.command.execute({
			command: new ScenesSnapshotCommand(plan.change, activeSceneId),
		});
		return { ok: true };
	}

	/** Open a compound clip for editing, keeping the playhead on the same frame. */
	async enterCompound({
		ref,
	}: {
		ref: ElementRef;
	}): Promise<CompoundActionResult> {
		const activeScene = this.getActiveScene();
		const element = [...activeScene.tracks.overlay, activeScene.tracks.main]
			.find((track) => track.id === ref.trackId)
			?.elements.find((candidate) => candidate.id === ref.elementId);
		if (!element || !isCompoundElement(element)) {
			return { ok: false, reason: "compound-not-found" };
		}
		if (!this.list.some((scene) => scene.id === element.sceneId)) {
			return { ok: false, reason: "scene-not-found" };
		}

		const outerTime = this.editor.playback.getCurrentTime();
		const clampedOuter = minMediaTime({
			a: maxMediaTime({ a: outerTime, b: element.startTime }),
			b: addMediaTime({ a: element.startTime, b: element.duration }),
		});
		const innerTime = addMediaTime({
			a: subMediaTime({ a: clampedOuter, b: element.startTime }),
			b: element.trimStart,
		});

		const path = [
			...this.compoundPath,
			{ parentSceneId: activeScene.id, compoundElementId: element.id },
		];
		await this.switchToScene({ sceneId: element.sceneId });
		this.compoundPath = path;
		this.notify();
		this.editor.playback.seek({ time: innerTime });
		return { ok: true };
	}

	/** Leave the compound clip that is open, back to where it was opened from. */
	async exitCompound(): Promise<void> {
		const active = this.getActiveScene();
		if (active.kind !== "compound") return;

		const entry = this.compoundPath[this.compoundPath.length - 1];
		const parentId =
			entry && this.list.some((scene) => scene.id === entry.parentSceneId)
				? entry.parentSceneId
				: (findScenesReferencingScene({
						scenes: this.list,
						sceneId: active.id,
					})[0]?.id ?? getMainScene({ scenes: this.list })?.id);
		if (!parentId) return;

		const innerTime = this.editor.playback.getCurrentTime();
		const path = entry ? this.compoundPath.slice(0, -1) : [];
		await this.switchToScene({ sceneId: parentId });
		this.compoundPath = path;
		this.notify();

		const parent = this.getActiveScene();
		const clip = entry
			? [...parent.tracks.overlay, parent.tracks.main]
					.flatMap((track): TimelineElement[] => track.elements)
					.find((element) => element.id === entry.compoundElementId)
			: undefined;
		if (clip) {
			const offset = subMediaTime({ a: innerTime, b: clip.trimStart });
			const clamped = minMediaTime({
				a: maxMediaTime({ a: offset, b: ZERO_MEDIA_TIME }),
				b: clip.duration,
			});
			this.editor.playback.seek({
				time: addMediaTime({ a: clip.startTime, b: clamped }),
			});
		}
	}

	/** Names from the outermost scene down to the open compound clip. */
	getCompoundBreadcrumb(): Array<{ sceneId: string; name: string }> {
		const cache = this.breadcrumbCache;
		if (
			cache &&
			cache.active === this.active &&
			cache.list === this.list &&
			cache.path === this.compoundPath
		) {
			return cache.value;
		}

		const active = this.active;
		let value: Array<{ sceneId: string; name: string }> = [];
		if (active && active.kind === "compound") {
			const byId = new Map(this.list.map((scene) => [scene.id, scene]));
			const crumbs = this.compoundPath
				.map((entry) => byId.get(entry.parentSceneId))
				.filter((scene): scene is TScene => scene !== undefined)
				.map((scene) => ({ sceneId: scene.id, name: scene.name }));
			value = [...crumbs, { sceneId: active.id, name: active.name }];
		}
		this.breadcrumbCache = {
			active,
			list: this.list,
			path: this.compoundPath,
			value,
		};
		return value;
	}

	private breadcrumbCache: {
		active: TScene | null;
		list: TScene[];
		path: CompoundNavigationEntry[];
		value: Array<{ sceneId: string; name: string }>;
	} | null = null;

	async createScene({
		name,
		isMain = false,
	}: {
		name: string;
		isMain: boolean;
	}): Promise<string> {
		if (!this.editor.project.getActive()) {
			throw new Error("No active project");
		}

		const command = new CreateSceneCommand({ name, isMain });
		this.editor.command.execute({ command });
		return command.getSceneId();
	}

	async deleteScene({ sceneId }: { sceneId: string }): Promise<void> {
		const sceneToDelete = this.list.find((s) => s.id === sceneId);

		if (!sceneToDelete) {
			throw new Error("Scene not found");
		}

		const { canDelete, reason } = canDeleteScene({
			scene: sceneToDelete,
			scenes: this.list,
		});
		if (!canDelete) {
			throw new Error(reason);
		}

		if (!this.editor.project.getActive()) {
			throw new Error("No active project");
		}

		const command = new DeleteSceneCommand(sceneId);
		this.editor.command.execute({ command });
	}

	async renameScene({
		sceneId,
		name,
	}: {
		sceneId: string;
		name: string;
	}): Promise<void> {
		if (!this.editor.project.getActive()) {
			throw new Error("No active project");
		}

		const command = new RenameSceneCommand({
			sceneId,
			newName: name,
		});
		this.editor.command.execute({ command });
	}

	async switchToScene({ sceneId }: { sceneId: string }): Promise<void> {
		if (!this.list.some((s) => s.id === sceneId)) {
			throw new Error("Scene not found");
		}

		// Leaving a compound scene may have changed its length; keep every
		// compound clip's resize bounds in line with its real contents.
		this.list = syncCompoundSourceDurations({ scenes: this.list });
		const targetScene = this.list.find((s) => s.id === sceneId) as TScene;

		const activeProject = this.editor.project.getActive();

		if (activeProject) {
			const updatedProject = {
				...activeProject,
				scenes: this.list,
				currentSceneId: sceneId,
				metadata: {
					...activeProject.metadata,
					updatedAt: new Date(),
				},
			};

			this.editor.project.setActiveProject({ project: updatedProject });
		}

		this.compoundPath = [];
		this.active = targetScene;
		this.notify();
	}

	async toggleBookmark({ time }: { time: MediaTime }): Promise<void> {
		const command = new ToggleBookmarkCommand(time);
		this.editor.command.execute({ command });
	}

	isBookmarked({ time }: { time: MediaTime }): boolean {
		const activeScene = this.getActiveScene();
		const activeProject = this.editor.project.getActive();

		if (!activeScene || !this.active || !activeProject) return false;

		const frameTime = getFrameTime({
			time,
			fps: activeProject.settings.fps,
		});

		return isBookmarkAtTime({ bookmarks: activeScene.bookmarks, frameTime });
	}

	async removeBookmark({ time }: { time: MediaTime }): Promise<void> {
		const command = new RemoveBookmarkCommand(time);
		this.editor.command.execute({ command });
	}

	async updateBookmark({
		time,
		updates,
	}: {
		time: MediaTime;
		updates: Partial<Omit<Bookmark, "time">>;
	}): Promise<void> {
		const command = new UpdateBookmarkCommand({ time, updates });
		this.editor.command.execute({ command });
	}

	async moveBookmark({
		fromTime,
		toTime,
	}: {
		fromTime: MediaTime;
		toTime: MediaTime;
	}): Promise<void> {
		const command = new MoveBookmarkCommand({ fromTime, toTime });
		this.editor.command.execute({ command });
	}

	getBookmarkAtTime({ time }: { time: MediaTime }) {
		const activeScene = this.active;
		const activeProject = this.editor.project.getActive();

		if (!activeScene || !activeProject) return null;

		const frameTime = getFrameTime({
			time,
			fps: activeProject.settings.fps,
		});

		return getBookmarkAtTime({
			bookmarks: activeScene.bookmarks,
			frameTime,
		});
	}

	async loadProjectScenes({ projectId }: { projectId: string }): Promise<void> {
		try {
			const result = await storageService.loadProject({ id: projectId });
			if (result?.project.scenes) {
				const ensuredScenes = result.project.scenes ?? [];
				const currentScene = findCurrentScene({
					scenes: ensuredScenes,
					currentSceneId: result.project.currentSceneId,
				});

				this.list = ensuredScenes;
				this.active = currentScene;
				this.notify();
			}
		} catch (error) {
			console.error("Failed to load project scenes:", error);
			this.list = [];
			this.active = null;
			this.notify();
		}
	}

	initializeScenes({
		scenes,
		currentSceneId,
	}: {
		scenes: TScene[];
		currentSceneId?: string;
	}): void {
		const ensuredScenes = ensureMainScene({ scenes });
		const currentScene = currentSceneId
			? ensuredScenes.find((s) => s.id === currentSceneId)
			: null;

		const fallbackScene = getMainScene({ scenes: ensuredScenes });

		this.list = ensuredScenes;
		this.active = currentScene || fallbackScene;
		this.notify();

		const hasAddedMainScene = ensuredScenes.length > scenes.length;
		if (hasAddedMainScene) {
			const activeProject = this.editor.project.getActive();

			if (activeProject) {
				const updatedProject = {
					...activeProject,
					scenes: ensuredScenes,
					metadata: {
						...activeProject.metadata,
						updatedAt: new Date(),
					},
				};

				this.editor.project.setActiveProject({ project: updatedProject });
				this.editor.save.markDirty({ force: true });
			}
		}
	}

	clearScenes(): void {
		this.list = [];
		this.active = null;
		this.notify();
	}

	getActiveScene(): TScene {
		if (!this.active) {
			throw new Error("No active scene.");
		}
		return this.active;
	}

	getActiveSceneOrNull(): TScene | null {
		return this.active;
	}

	getScenes(): TScene[] {
		return this.list;
	}

	/**
	 * Tracks as the renderer and audio mixer should see them: compound clips
	 * expanded into ordinary elements. Defaults to the active scene.
	 */
	getPlaybackTracks({ tracks }: { tracks?: SceneTracks } = {}): SceneTracks {
		const source = tracks ?? this.getActiveScene().tracks;
		return flattenCompoundTracks({ tracks: source, scenes: this.list });
	}

	/**
	 * The scene that export and the project thumbnail render. While the user is
	 * inside a compound clip that is the main scene, so exporting from there
	 * still produces the whole project.
	 */
	getExportScene(): TScene {
		const active = this.getActiveScene();
		if (active.kind !== "compound") return active;
		return getMainScene({ scenes: this.list }) ?? active;
	}

	setScenes({
		scenes,
		activeSceneId,
	}: {
		scenes: TScene[];
		activeSceneId?: string;
	}): void {
		this.list = scenes;
		const nextActiveSceneId = activeSceneId ?? this.active?.id ?? null;
		this.active = nextActiveSceneId
			? (scenes.find((scene) => scene.id === nextActiveSceneId) ?? null)
			: null;
		this.notify();

		const activeProject = this.editor.project.getActive();
		if (activeProject) {
			const updatedProject = {
				...activeProject,
				scenes,
				metadata: {
					...activeProject.metadata,
					updatedAt: new Date(),
				},
			};
			this.editor.project.setActiveProject({ project: updatedProject });
		}
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		this.listeners.forEach((fn) => {
			fn();
		});
	}

	updateSceneTracks({ tracks }: { tracks: SceneTracks }): void {
		if (!this.active) return;

		const updatedScene: TScene = {
			...this.active,
			tracks,
			updatedAt: new Date(),
		};

		this.list = this.list.map((s) =>
			s.id === this.active?.id ? updatedScene : s,
		);
		this.active = updatedScene;
		this.notify();

		const activeProject = this.editor.project.getActive();
		if (activeProject) {
			const updatedProject = {
				...activeProject,
				scenes: this.list,
				metadata: {
					...activeProject.metadata,
					updatedAt: new Date(),
				},
			};
			this.editor.project.setActiveProject({ project: updatedProject });
		}
	}
}
