import type { TProject, TProjectMetadata } from "@/project/types";
import { getProjectDurationFromScenes } from "@/timeline/scenes";
import type { MediaAsset } from "@/media/types";
import { IndexedDBAdapter } from "./indexeddb-adapter";
import { OPFSAdapter } from "./opfs-adapter";
import {
	type StorageCapacityCheckResult,
	StorageQuotaExceededError,
	evaluateStorageCapacity,
	isStorageQuotaExceededError,
	readStorageQuotaStatus,
} from "./quota";
import type {
	MediaAssetData,
	StorageConfig,
	SerializedProject,
	SerializedScene,
} from "./types";
import type { SavedSoundsData, SavedSound, SoundEffect } from "@/sounds/types";
import {
	migrations,
	runStorageMigrations,
} from "@/services/storage/migrations";
import type { Bookmark, SceneTracks, TScene } from "@/timeline";
import { roundMediaTime } from "@/wasm";
import {
	type SnapshotInfo,
	shouldTakeSnapshot,
	snapshotId,
	snapshotsToPrune,
} from "./snapshot-policy";

interface ProjectSnapshotRecord {
	projectId: string;
	createdAt: number;
	/** 只含會影響內容的部分,用來判斷「內容有沒有變」 */
	content: string;
	project: SerializedProject;
}

export type ProjectSnapshotSummary = SnapshotInfo;

/** 比較內容時忽略修改時間、縮圖、時間軸捲動位置這類不算「內容」的欄位 */
function snapshotContent({ project }: { project: SerializedProject }): string {
	return JSON.stringify({
		scenes: project.scenes,
		settings: project.settings,
		currentSceneId: project.currentSceneId,
	});
}

function parseSnapshotId({ id }: { id: string }): SnapshotInfo | null {
	const separator = id.lastIndexOf(":");
	if (separator <= 0) return null;
	const createdAt = Number(id.slice(separator + 1));
	if (!Number.isFinite(createdAt)) return null;
	return { id, projectId: id.slice(0, separator), createdAt };
}

function normalizeBookmarks({ raw }: { raw: unknown }): Bookmark[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.map((item): Bookmark | null => {
			if (typeof item === "number") {
				return { time: roundMediaTime({ time: item }) };
			}
			const obj = item as Record<string, unknown>;
			if (
				typeof obj !== "object" ||
				obj === null ||
				typeof obj.time !== "number"
			) {
				return null;
			}
			return {
				time: roundMediaTime({ time: obj.time }),
				...(typeof obj.note === "string" && { note: obj.note }),
				...(typeof obj.color === "string" && { color: obj.color }),
				...(typeof obj.duration === "number" && {
					duration: roundMediaTime({ time: obj.duration }),
				}),
			};
		})
		.filter((b): b is Bookmark => b !== null);
}

class StorageService {
	private projectsAdapter: IndexedDBAdapter<SerializedProject>;
	private savedSoundsAdapter: IndexedDBAdapter<SavedSoundsData>;
	private snapshotsAdapter = new IndexedDBAdapter<ProjectSnapshotRecord>({
		dbName: "video-editor-snapshots",
		storeName: "snapshots",
		version: 1,
	});
	/** 每個專案最近一份快照(避免每次存檔都去讀資料庫) */
	private latestSnapshots = new Map<string, { createdAt: number; content: string }>();
	private config: StorageConfig;
	private migrationsPromise: Promise<void> | null = null;

	constructor() {
		this.config = {
			projectsDb: "video-editor-projects",
			mediaDb: "video-editor-media",
			savedSoundsDb: "video-editor-saved-sounds",
			version: 1,
		};

		this.projectsAdapter = new IndexedDBAdapter<SerializedProject>({
			dbName: this.config.projectsDb,
			storeName: "projects",
			version: this.config.version,
		});

		this.savedSoundsAdapter = new IndexedDBAdapter<SavedSoundsData>({
			dbName: this.config.savedSoundsDb,
			storeName: "saved-sounds",
			version: this.config.version,
		});
	}

	private async ensureMigrations(): Promise<void> {
		if (this.migrationsPromise) {
			await this.migrationsPromise;
			return;
		}

		this.migrationsPromise = runStorageMigrations({ migrations }).then(
			() => undefined,
		);
		await this.migrationsPromise;
	}

	private getProjectMediaAdapters({ projectId }: { projectId: string }) {
		const mediaMetadataAdapter = new IndexedDBAdapter<MediaAssetData>({
			dbName: `${this.config.mediaDb}-${projectId}`,
			storeName: "media-metadata",
			version: this.config.version,
		});

		const mediaAssetsAdapter = new OPFSAdapter(`media-files-${projectId}`);

		return { mediaMetadataAdapter, mediaAssetsAdapter };
	}

	async canStoreFile({
		size,
	}: {
		size: number;
	}): Promise<StorageCapacityCheckResult> {
		const quotaStatus = await readStorageQuotaStatus();
		return evaluateStorageCapacity({
			requiredBytes: size,
			quotaStatus,
		});
	}

	isQuotaExceededError({ error }: { error: unknown }): boolean {
		return isStorageQuotaExceededError({ error });
	}

	private stripAudioBuffers({ tracks }: { tracks: SceneTracks }): SceneTracks {
		return {
			...tracks,
			audio: tracks.audio.map((track) => ({
				...track,
				elements: track.elements.map((element) => {
					const { buffer: _buffer, ...rest } = element;
					return rest;
				}),
			})),
		};
	}

	async saveProject({ project }: { project: TProject }): Promise<void> {
		const duration =
			project.metadata.duration ??
			getProjectDurationFromScenes({ scenes: project.scenes });
		const serializedScenes: SerializedScene[] = project.scenes.map((scene) => ({
			id: scene.id,
			name: scene.name,
			isMain: scene.isMain,
			tracks: this.stripAudioBuffers({ tracks: scene.tracks }),
			bookmarks: scene.bookmarks,
			createdAt: scene.createdAt.toISOString(),
			updatedAt: scene.updatedAt.toISOString(),
		}));

		const serializedProject: SerializedProject = {
			metadata: {
				id: project.metadata.id,
				name: project.metadata.name,
				thumbnail: project.metadata.thumbnail,
				duration,
				createdAt: project.metadata.createdAt.toISOString(),
				updatedAt: project.metadata.updatedAt.toISOString(),
			},
			scenes: serializedScenes,
			currentSceneId: project.currentSceneId,
			settings: project.settings,
			version: project.version,
			timelineViewState: project.timelineViewState,
		};

		await this.projectsAdapter.set({
			key: project.metadata.id,
			value: serializedProject,
		});
	}

	async loadProject({
		id,
	}: {
		id: string;
	}): Promise<{ project: TProject } | null> {
		await this.ensureMigrations();
		const serializedProject = await this.projectsAdapter.get(id);

		if (!serializedProject) return null;

		if (
			typeof serializedProject !== "object" ||
			serializedProject === null ||
			typeof serializedProject.metadata !== "object" ||
			serializedProject.metadata === null
		) {
			console.warn(
				"[storage] Skipping malformed project entry (missing metadata):",
				{ id, entry: serializedProject },
			);
			return null;
		}

		const scenes =
			serializedProject.scenes?.map((scene) => ({
				id: scene.id,
				name: scene.name,
				isMain: scene.isMain,
				tracks: scene.tracks,
				bookmarks: normalizeBookmarks({ raw: scene.bookmarks }),
				createdAt: new Date(scene.createdAt),
				updatedAt: new Date(scene.updatedAt),
			})) ?? [];

		const project: TProject = {
			metadata: {
				id: serializedProject.metadata.id,
				name: serializedProject.metadata.name,
				thumbnail: serializedProject.metadata.thumbnail,
				duration: roundMediaTime({
					time:
						serializedProject.metadata.duration ??
						getProjectDurationFromScenes({ scenes }),
				}),
				createdAt: new Date(serializedProject.metadata.createdAt),
				updatedAt: new Date(serializedProject.metadata.updatedAt),
			},
			scenes,
			currentSceneId: serializedProject.currentSceneId || "",
			settings: serializedProject.settings,
			version: serializedProject.version,
			timelineViewState: serializedProject.timelineViewState,
		};

		return { project };
	}

	async loadAllProjects(): Promise<TProject[]> {
		const projectIds = await this.projectsAdapter.list();
		const projects: TProject[] = [];

		for (const id of projectIds) {
			const result = await this.loadProject({ id });
			if (result?.project) {
				projects.push(result.project);
			}
		}

		return projects.sort(
			(a, b) => b.metadata.updatedAt.getTime() - a.metadata.updatedAt.getTime(),
		);
	}

	async loadAllProjectsMetadata(): Promise<TProjectMetadata[]> {
		await this.ensureMigrations();
		const serializedProjects = await this.projectsAdapter.getAll();

		const metadata: TProjectMetadata[] = [];
		for (const serializedProject of serializedProjects) {
			if (
				typeof serializedProject !== "object" ||
				serializedProject === null ||
				typeof serializedProject.metadata !== "object" ||
				serializedProject.metadata === null
			) {
				console.warn(
					"[storage] Skipping malformed project entry (missing metadata):",
					serializedProject,
				);
				continue;
			}

			metadata.push({
				id: serializedProject.metadata.id,
				name: serializedProject.metadata.name,
				thumbnail: serializedProject.metadata.thumbnail,
				duration: roundMediaTime({
					time:
						serializedProject.metadata.duration ??
						getProjectDurationFromScenes({
							scenes: (serializedProject.scenes ?? []) as unknown as TScene[],
						}),
				}),
				createdAt: new Date(serializedProject.metadata.createdAt),
				updatedAt: new Date(serializedProject.metadata.updatedAt),
			});
		}

		return metadata.sort(
			(a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
		);
	}

	async deleteProject({ id }: { id: string }): Promise<void> {
		await this.projectsAdapter.remove(id);
		await this.deleteProjectSnapshots({ projectId: id }).catch((error) => {
			console.warn("刪除版本快照失敗", error);
		});
	}

	/** 列出某專案的快照(新的在前),只讀 key,不載入內容 */
	async listProjectSnapshots({
		projectId,
	}: {
		projectId: string;
	}): Promise<ProjectSnapshotSummary[]> {
		const ids = await this.snapshotsAdapter.list();
		return ids
			.map((id) => parseSnapshotId({ id: String(id) }))
			.filter(
				(info): info is SnapshotInfo =>
					info !== null && info.projectId === projectId,
			)
			.sort((a, b) => b.createdAt - a.createdAt);
	}

	/**
	 * 存檔後呼叫:內容有變且距離上一份夠久,才存一份新快照。
	 * force 用在「還原前先保存目前狀態」,不受時間間隔限制。
	 */
	async snapshotProject({
		projectId,
		force = false,
	}: {
		projectId: string;
		force?: boolean;
	}): Promise<void> {
		const project = await this.projectsAdapter.get(projectId);
		if (!project || typeof project !== "object" || !project.metadata) return;
		const content = snapshotContent({ project });

		let latest = this.latestSnapshots.get(projectId) ?? null;
		if (!latest) {
			const [newest] = await this.listProjectSnapshots({ projectId });
			if (newest) {
				const record = await this.snapshotsAdapter.get(newest.id);
				if (record) {
					latest = { createdAt: newest.createdAt, content: record.content };
				}
			}
		}

		const now = Date.now();
		const shouldTake = force
			? latest?.content !== content
			: shouldTakeSnapshot({
					lastSnapshotAt: latest?.createdAt ?? null,
					now,
					lastContent: latest?.content ?? null,
					content,
				});
		if (!shouldTake) return;

		await this.snapshotsAdapter.set({
			key: snapshotId({ projectId, createdAt: now }),
			value: { projectId, createdAt: now, content, project },
		});
		this.latestSnapshots.set(projectId, { createdAt: now, content });

		const snapshots = await this.listProjectSnapshots({ projectId });
		for (const old of snapshotsToPrune({ snapshots })) {
			await this.snapshotsAdapter.remove(old.id);
		}
	}

	/**
	 * 把專案內容還原成某份快照。還原前會先把目前狀態存成快照,所以還原本身也能再還原回去。
	 * 素材不在快照裡:快照之後刪掉的素材,還原後會顯示為缺少的素材。
	 * 專案不能正開在編輯器裡(呼叫端負責)。
	 */
	async restoreProjectSnapshot({
		snapshotId: id,
	}: {
		snapshotId: string;
	}): Promise<void> {
		const record = await this.snapshotsAdapter.get(id);
		if (!record) throw new Error("找不到這個版本");
		const current = await this.projectsAdapter.get(record.projectId);
		if (!current) throw new Error("找不到專案");

		await this.snapshotProject({ projectId: record.projectId, force: true });

		const { id: _storedId, ...snapshotProject } = record.project as SerializedProject & {
			id?: string;
		};
		await this.projectsAdapter.set({
			key: record.projectId,
			value: {
				...snapshotProject,
				metadata: {
					...snapshotProject.metadata,
					id: record.projectId,
					// 名稱沿用目前的(使用者可能在快照之後改過名)
					name: current.metadata.name,
					updatedAt: new Date().toISOString(),
				},
			},
		});
		this.latestSnapshots.delete(record.projectId);

		// 快照可能是舊版格式:重跑一次遷移,讓它馬上升級到目前版本
		this.migrationsPromise = null;
		await this.ensureMigrations();
	}

	private async deleteProjectSnapshots({
		projectId,
	}: {
		projectId: string;
	}): Promise<void> {
		const snapshots = await this.listProjectSnapshots({ projectId });
		for (const snapshot of snapshots) {
			await this.snapshotsAdapter.remove(snapshot.id);
		}
		this.latestSnapshots.delete(projectId);
	}

	async saveMediaAsset({
		projectId,
		mediaAsset,
	}: {
		projectId: string;
		mediaAsset: MediaAsset;
	}): Promise<void> {
		const { mediaMetadataAdapter, mediaAssetsAdapter } =
			this.getProjectMediaAdapters({ projectId });

		const metadata: MediaAssetData = {
			id: mediaAsset.id,
			name: mediaAsset.name,
			type: mediaAsset.type,
			size: mediaAsset.file.size,
			lastModified: mediaAsset.file.lastModified,
			width: mediaAsset.width,
			height: mediaAsset.height,
			duration: mediaAsset.duration,
			thumbnailUrl: mediaAsset.thumbnailUrl,
			ephemeral: mediaAsset.ephemeral,
		};

		try {
			await mediaAssetsAdapter.set({
				key: mediaAsset.id,
				value: mediaAsset.file,
			});
			await mediaMetadataAdapter.set({
				key: mediaAsset.id,
				value: metadata,
			});
		} catch (error) {
			try {
				await mediaAssetsAdapter.remove(mediaAsset.id);
			} catch {
				// Ignore cleanup failures so the original storage error is preserved.
			}

			if (this.isQuotaExceededError({ error })) {
				throw new StorageQuotaExceededError({
					requiredBytes: mediaAsset.file.size,
				});
			}

			throw error;
		}
	}

	async loadMediaAsset({
		projectId,
		id,
	}: {
		projectId: string;
		id: string;
	}): Promise<MediaAsset | null> {
		const { mediaMetadataAdapter, mediaAssetsAdapter } =
			this.getProjectMediaAdapters({ projectId });

		const [file, metadata] = await Promise.all([
			mediaAssetsAdapter.get(id),
			mediaMetadataAdapter.get(id),
		]);

		if (!file || !metadata) return null;

		let url: string;
		if (metadata.type === "image" && (!file.type || file.type === "")) {
			try {
				const text = await file.text();
				if (text.trim().startsWith("<svg")) {
					const svgBlob = new Blob([text], { type: "image/svg+xml" });
					url = URL.createObjectURL(svgBlob);
				} else {
					url = URL.createObjectURL(file);
				}
			} catch {
				url = URL.createObjectURL(file);
			}
		} else {
			url = URL.createObjectURL(file);
		}

		return {
			id: metadata.id,
			name: metadata.name,
			type: metadata.type,
			file,
			url,
			width: metadata.width,
			height: metadata.height,
			duration: metadata.duration,
			thumbnailUrl: metadata.thumbnailUrl,
			ephemeral: metadata.ephemeral,
		};
	}

	async loadAllMediaAssets({
		projectId,
	}: {
		projectId: string;
	}): Promise<MediaAsset[]> {
		const { mediaMetadataAdapter } = this.getProjectMediaAdapters({
			projectId,
		});

		const mediaIds = await mediaMetadataAdapter.list();
		const mediaItems: MediaAsset[] = [];

		for (const id of mediaIds) {
			const item = await this.loadMediaAsset({ projectId, id });
			if (item) {
				mediaItems.push(item);
			}
		}

		return mediaItems;
	}

	async deleteMediaAsset({
		projectId,
		id,
	}: {
		projectId: string;
		id: string;
	}): Promise<void> {
		const { mediaMetadataAdapter, mediaAssetsAdapter } =
			this.getProjectMediaAdapters({ projectId });

		await Promise.all([
			mediaAssetsAdapter.remove(id),
			mediaMetadataAdapter.remove(id),
		]);
	}

	async deleteProjectMedia({
		projectId,
	}: {
		projectId: string;
	}): Promise<void> {
		const { mediaMetadataAdapter, mediaAssetsAdapter } =
			this.getProjectMediaAdapters({ projectId });

		await Promise.all([
			mediaMetadataAdapter.clear(),
			mediaAssetsAdapter.clear(),
		]);
	}

	async clearAllData(): Promise<void> {
		await this.projectsAdapter.clear();
		await this.snapshotsAdapter.clear().catch(() => {});
		this.latestSnapshots.clear();
		// project-specific media and timelines cleaned up when projects are deleted
	}

	async getStorageInfo(): Promise<{
		projects: number;
		isOPFSSupported: boolean;
		isIndexedDBSupported: boolean;
	}> {
		const projectIds = await this.projectsAdapter.list();

		return {
			projects: projectIds.length,
			isOPFSSupported: this.isOPFSSupported(),
			isIndexedDBSupported: this.isIndexedDBSupported(),
		};
	}

	async getProjectStorageInfo({ projectId }: { projectId: string }): Promise<{
		mediaItems: number;
	}> {
		const { mediaMetadataAdapter } = this.getProjectMediaAdapters({
			projectId,
		});

		const mediaIds = await mediaMetadataAdapter.list();

		return {
			mediaItems: mediaIds.length,
		};
	}

	async loadSavedSounds(): Promise<SavedSoundsData> {
		try {
			const savedSoundsData = await this.savedSoundsAdapter.get("user-sounds");
			return (
				savedSoundsData || {
					sounds: [],
					lastModified: new Date().toISOString(),
				}
			);
		} catch (error) {
			console.error("Failed to load saved sounds:", error);
			return { sounds: [], lastModified: new Date().toISOString() };
		}
	}

	async saveSoundEffect({
		soundEffect,
	}: {
		soundEffect: SoundEffect;
	}): Promise<void> {
		try {
			const currentData = await this.loadSavedSounds();

			if (currentData.sounds.some((sound) => sound.id === soundEffect.id)) {
				return; // Already saved
			}

			const savedSound: SavedSound = {
				id: soundEffect.id,
				name: soundEffect.name,
				username: soundEffect.username,
				previewUrl: soundEffect.previewUrl,
				downloadUrl: soundEffect.downloadUrl,
				duration: soundEffect.duration,
				tags: soundEffect.tags,
				license: soundEffect.license,
				savedAt: new Date().toISOString(),
			};

			const updatedData: SavedSoundsData = {
				sounds: [...currentData.sounds, savedSound],
				lastModified: new Date().toISOString(),
			};

			await this.savedSoundsAdapter.set({
				key: "user-sounds",
				value: updatedData,
			});
		} catch (error) {
			console.error("Failed to save sound effect:", error);
			throw error;
		}
	}

	async removeSavedSound({ soundId }: { soundId: number }): Promise<void> {
		try {
			const currentData = await this.loadSavedSounds();

			const updatedData: SavedSoundsData = {
				sounds: currentData.sounds.filter((sound) => sound.id !== soundId),
				lastModified: new Date().toISOString(),
			};

			await this.savedSoundsAdapter.set({
				key: "user-sounds",
				value: updatedData,
			});
		} catch (error) {
			console.error("Failed to remove saved sound:", error);
			throw error;
		}
	}

	async isSoundSaved({ soundId }: { soundId: number }): Promise<boolean> {
		try {
			const currentData = await this.loadSavedSounds();
			return currentData.sounds.some((sound) => sound.id === soundId);
		} catch (error) {
			console.error("Failed to check if sound is saved:", error);
			return false;
		}
	}

	async clearSavedSounds(): Promise<void> {
		try {
			await this.savedSoundsAdapter.remove("user-sounds");
		} catch (error) {
			console.error("Failed to clear saved sounds:", error);
			throw error;
		}
	}

	/**
	 * 備份檔格式:[8 bytes 標頭長度][JSON 標頭][素材檔案 1][素材檔案 2]...
	 * 以 Blob 串接,檔案內容不會被整個讀進記憶體。
	 */
	async exportProjectBundle({ id }: { id: string }): Promise<Blob> {
		await this.ensureMigrations();
		const project = await this.projectsAdapter.get(id);
		if (!project) throw new Error("找不到專案");

		const { mediaMetadataAdapter, mediaAssetsAdapter } =
			this.getProjectMediaAdapters({ projectId: id });
		const mediaIds = await mediaMetadataAdapter.list();

		const media: Array<{ metadata: MediaAssetData; size: number; mime: string }> = [];
		const parts: BlobPart[] = [];
		for (const mediaId of mediaIds) {
			const [file, metadata] = await Promise.all([
				mediaAssetsAdapter.get(mediaId),
				mediaMetadataAdapter.get(mediaId),
			]);
			if (!file || !metadata) continue;
			media.push({ metadata, size: file.size, mime: file.type });
			parts.push(file);
		}

		const header = new TextEncoder().encode(
			JSON.stringify({
				format: "opencut-slim-backup",
				version: 1,
				exportedAt: new Date().toISOString(),
				project,
				media,
			}),
		);
		const lengthBytes = new Uint8Array(8);
		new DataView(lengthBytes.buffer).setBigUint64(0, BigInt(header.length));
		return new Blob([lengthBytes, header, ...parts], {
			type: "application/octet-stream",
		});
	}

	/** 匯入備份檔,一律建立為新專案(不會覆蓋現有專案),回傳新專案 ID */
	async importProjectBundle({ file }: { file: Blob }): Promise<string> {
		await this.ensureMigrations();
		const lengthView = new DataView(await file.slice(0, 8).arrayBuffer());
		const headerLength = Number(lengthView.getBigUint64(0));
		if (!Number.isFinite(headerLength) || headerLength <= 0 || headerLength > file.size) {
			throw new Error("這不是有效的備份檔");
		}
		const header = JSON.parse(
			await file.slice(8, 8 + headerLength).text(),
		) as {
			format?: string;
			project?: SerializedProject;
			media?: Array<{ metadata: MediaAssetData; size: number; mime: string }>;
		};
		if (header.format !== "opencut-slim-backup" || !header.project || !header.media) {
			throw new Error("這不是有效的備份檔");
		}

		const newId = crypto.randomUUID();
		const { mediaMetadataAdapter, mediaAssetsAdapter } =
			this.getProjectMediaAdapters({ projectId: newId });

		try {
			let offset = 8 + headerLength;
			for (const item of header.media) {
				const slice = file.slice(offset, offset + item.size, item.mime);
				offset += item.size;
				const restored = new File([slice], item.metadata.name, {
					type: item.mime,
					lastModified: item.metadata.lastModified,
				});
				await mediaAssetsAdapter.set({ key: item.metadata.id, value: restored });
				await mediaMetadataAdapter.set({
					key: item.metadata.id,
					value: item.metadata,
				});
			}

			const now = new Date().toISOString();
			await this.projectsAdapter.set({
				key: newId,
				value: {
					...header.project,
					metadata: {
						...header.project.metadata,
						id: newId,
						name: `${header.project.metadata.name} (匯入)`,
						updatedAt: now,
					},
				},
			});
		} catch (error) {
			await Promise.all([
				mediaMetadataAdapter.clear(),
				mediaAssetsAdapter.clear(),
			]).catch(() => {});
			if (this.isQuotaExceededError({ error })) {
				throw new Error("瀏覽器儲存空間不足,無法匯入");
			}
			throw error;
		}
		return newId;
	}

	/** 專案內所有素材的總大小(bytes),以及素材數量 */
	async getProjectMediaUsage({
		projectId,
	}: {
		projectId: string;
	}): Promise<{ bytes: number; count: number }> {
		const { mediaMetadataAdapter } = this.getProjectMediaAdapters({ projectId });
		const ids = await mediaMetadataAdapter.list();
		let bytes = 0;
		let count = 0;
		for (const id of ids) {
			const metadata = await mediaMetadataAdapter.get(id);
			if (!metadata) continue;
			bytes += metadata.size ?? 0;
			count += 1;
		}
		return { bytes, count };
	}

	isOPFSSupported(): boolean {
		return OPFSAdapter.isSupported();
	}

	isIndexedDBSupported(): boolean {
		return "indexedDB" in window;
	}

	isFullySupported(): boolean {
		return this.isIndexedDBSupported() && this.isOPFSSupported();
	}
}

export const storageService = new StorageService();
export { StorageService };
