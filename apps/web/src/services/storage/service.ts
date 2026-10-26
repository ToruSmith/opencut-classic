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
	IMPORTED_SUFFIX,
	planProjectIdRepair,
	stripImportedSuffix,
} from "./project-repair";
import { matchRelinkFiles } from "./relink";
import {
	SNAPSHOT_INTERVAL_MS,
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

interface BundleMediaEntry {
	metadata: MediaAssetData;
	size: number;
	mime: string;
	/** false:備份裡沒有這個檔案,匯入後要重新連結(第 1 版的備份沒有這個欄位,視為 true) */
	included?: boolean;
}

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

		this.migrationsPromise = runStorageMigrations({ migrations })
			.then(() => this.repairMismatchedProjectIds())
			.catch((error) => {
				console.error("[storage] 修復專案紀錄失敗", error);
			})
			.then(() => undefined);
		await this.migrationsPromise;
	}

	/** 見 project-repair.ts:修復舊版匯入留下的「key 與 metadata.id 不一致」紀錄 */
	private async repairMismatchedProjectIds(): Promise<void> {
		const records = (await this.projectsAdapter.getAll()) as Array<
			SerializedProject & { id?: string }
		>;
		const existingKeys = new Set(
			records.map((record) => record.id).filter((id): id is string => !!id),
		);
		for (const record of records) {
			const recordKey = record.id;
			const metadataId = record.metadata?.id;
			if (!recordKey || !metadataId || recordKey === metadataId) continue;

			const { mediaMetadataAdapter } = this.getProjectMediaAdapters({
				projectId: recordKey,
			});
			const originalHasMedia = (await mediaMetadataAdapter.list()).length > 0;
			const plan = planProjectIdRepair({
				recordKey,
				metadataId,
				existingKeys,
				originalHasMedia,
			});
			if (!plan) continue;

			const { id: _id, ...content } = record;
			if (plan.copyToId) {
				await this.projectsAdapter.set({ key: plan.copyToId, value: content });
				existingKeys.add(plan.copyToId);
			}
			if (plan.original === "restore") {
				await this.projectsAdapter.set({
					key: recordKey,
					value: {
						...content,
						metadata: {
							...content.metadata,
							id: recordKey,
							name: stripImportedSuffix({ name: content.metadata.name }),
						},
					},
				});
			} else {
				await this.projectsAdapter.remove(recordKey);
				existingKeys.delete(recordKey);
			}
			console.info("[storage] 已修復匯入造成的專案紀錄錯誤", {
				recordKey,
				metadataId,
				plan,
			});
		}
	}

	private getProjectMediaAdapters({ projectId }: { projectId: string }) {
		const mediaMetadataAdapter = new IndexedDBAdapter<MediaAssetData>({
			dbName: `${this.config.mediaDb}-${projectId}`,
			storeName: "media-metadata",
			version: this.config.version,
		});

		const mediaAssetsAdapter = new OPFSAdapter(`media-files-${projectId}`);
		const mediaProxiesAdapter = new OPFSAdapter(`media-proxies-${projectId}`);

		return { mediaMetadataAdapter, mediaAssetsAdapter, mediaProxiesAdapter };
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
			luts: project.luts,
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
			luts: serializedProject.luts,
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
		let latest = this.latestSnapshots.get(projectId) ?? null;
		if (!latest) {
			const [newest] = await this.listProjectSnapshots({ projectId });
			if (newest) {
				const record = await this.snapshotsAdapter.get(newest.id);
				if (record) {
					latest = { createdAt: newest.createdAt, content: record.content };
					this.latestSnapshots.set(projectId, latest);
				}
			}
		}

		const now = Date.now();
		// 大部分存檔都還沒到間隔,先擋掉,不必讀專案、也不必序列化比對
		if (!force && latest && now - latest.createdAt < SNAPSHOT_INTERVAL_MS) return;

		const project = await this.projectsAdapter.get(projectId);
		if (!project || typeof project !== "object" || !project.metadata) return;
		const content = snapshotContent({ project });
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

		// 只用「完整寫完」的代理檔:轉檔中途關掉分頁會留下不完整的檔案,沒有完成標記就不用
		const proxyFile =
			metadata.type === "video"
				? await this.loadCompletedMediaProxy({ projectId, id }).catch(() => null)
				: null;

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
			...(proxyFile ? { proxyFile } : {}),
		};
	}

	/** 開一個寫入代理檔的串流;不支援時回傳 null(改用 saveMediaProxy 一次寫入) */
	async openMediaProxyWritable({
		projectId,
		id,
	}: {
		projectId: string;
		id: string;
	}): Promise<FileSystemWritableFileStream | null> {
		const { mediaProxiesAdapter } = this.getProjectMediaAdapters({ projectId });
		return mediaProxiesAdapter.createWritable(id);
	}

	async saveMediaProxy({
		projectId,
		id,
		file,
	}: {
		projectId: string;
		id: string;
		file: File;
	}): Promise<void> {
		const { mediaProxiesAdapter } = this.getProjectMediaAdapters({ projectId });
		await mediaProxiesAdapter.set({ key: id, value: file });
	}

	/** 轉檔成功後呼叫:留下完成標記,之後載入專案才會使用這個代理檔 */
	async markMediaProxyComplete({
		projectId,
		id,
	}: {
		projectId: string;
		id: string;
	}): Promise<void> {
		const { mediaProxiesAdapter } = this.getProjectMediaAdapters({ projectId });
		await mediaProxiesAdapter.set({
			key: `${id}.done`,
			value: new File([], `${id}.done`),
		});
	}

	async loadCompletedMediaProxy({
		projectId,
		id,
	}: {
		projectId: string;
		id: string;
	}): Promise<File | null> {
		const { mediaProxiesAdapter } = this.getProjectMediaAdapters({ projectId });
		const marker = await mediaProxiesAdapter.get(`${id}.done`);
		if (!marker) return null;
		const file = await mediaProxiesAdapter.get(id);
		return file && file.size > 0 ? file : null;
	}

	async deleteMediaProxy({
		projectId,
		id,
	}: {
		projectId: string;
		id: string;
	}): Promise<void> {
		const { mediaProxiesAdapter } = this.getProjectMediaAdapters({ projectId });
		await mediaProxiesAdapter.remove(`${id}.done`);
		await mediaProxiesAdapter.remove(id);
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
		await this.deleteMediaProxy({ projectId, id }).catch(() => {});
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
		await this.getProjectMediaAdapters({ projectId })
			.mediaProxiesAdapter.clear()
			.catch(() => {});
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
	 *
	 * includeMedia = false 時只存專案(時間軸與素材清單),檔案很小;
	 * 匯入後由使用者重新選取原始素材,依檔名與大小對回去(relinkMedia)。
	 */
	async exportProjectBundle({
		id,
		includeMedia = true,
	}: {
		id: string;
		includeMedia?: boolean;
	}): Promise<Blob> {
		await this.ensureMigrations();
		const stored = (await this.projectsAdapter.get(id)) as
			| (SerializedProject & { id?: string })
			| null;
		if (!stored) throw new Error("找不到專案");
		const { id: _storedId, ...project } = stored;

		const { mediaMetadataAdapter, mediaAssetsAdapter } =
			this.getProjectMediaAdapters({ projectId: id });
		const mediaIds = await mediaMetadataAdapter.list();

		const media: BundleMediaEntry[] = [];
		const parts: BlobPart[] = [];
		for (const mediaId of mediaIds) {
			const metadata = await mediaMetadataAdapter.get(mediaId);
			if (!metadata) continue;
			const file = includeMedia ? await mediaAssetsAdapter.get(mediaId) : null;
			if (file) {
				media.push({ metadata, size: file.size, mime: file.type, included: true });
				parts.push(file);
			} else {
				// 只存專案,或素材檔本來就不見了:留下清單,匯入後可以重新連結
				media.push({ metadata, size: 0, mime: "", included: false });
			}
		}

		const header = new TextEncoder().encode(
			JSON.stringify({
				format: "opencut-slim-backup",
				version: 2,
				exportedAt: new Date().toISOString(),
				includesMedia: includeMedia,
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

	/**
	 * 匯入備份檔,一律建立為新專案(不會覆蓋現有專案)。
	 * 回傳新專案 ID 與需要重新連結的素材數量(只存專案的備份,或備份時素材已遺失)。
	 */
	async importProjectBundle({
		file,
	}: {
		file: Blob;
	}): Promise<{ id: string; missingCount: number }> {
		await this.ensureMigrations();
		if (file.size < 8) throw new Error("這不是有效的備份檔");
		const lengthView = new DataView(await file.slice(0, 8).arrayBuffer());
		const headerLength = Number(lengthView.getBigUint64(0));
		if (!Number.isFinite(headerLength) || headerLength <= 0 || headerLength > file.size) {
			throw new Error("這不是有效的備份檔");
		}
		let header: {
			format?: string;
			project?: SerializedProject & { id?: string };
			media?: BundleMediaEntry[];
		};
		try {
			header = JSON.parse(await file.slice(8, 8 + headerLength).text());
		} catch {
			throw new Error("這不是有效的備份檔");
		}
		if (header.format !== "opencut-slim-backup" || !header.project || !header.media) {
			throw new Error("這不是有效的備份檔");
		}

		const newId = crypto.randomUUID();
		const { mediaMetadataAdapter, mediaAssetsAdapter } =
			this.getProjectMediaAdapters({ projectId: newId });

		let missingCount = 0;
		try {
			let offset = 8 + headerLength;
			for (const item of header.media) {
				// 第 1 版沒有 included 欄位,一律含素材
				const included = item.included !== false;
				if (included) {
					const slice = file.slice(offset, offset + item.size, item.mime);
					offset += item.size;
					if (slice.size !== item.size) {
						throw new Error("備份檔不完整(檔案可能被截斷)");
					}
					const restored = new File([slice], item.metadata.name, {
						type: item.mime,
						lastModified: item.metadata.lastModified,
					});
					await mediaAssetsAdapter.set({ key: item.metadata.id, value: restored });
				} else {
					missingCount += 1;
				}
				await mediaMetadataAdapter.set({
					key: item.metadata.id,
					value: item.metadata,
				});
			}

			// 備份裡的紀錄帶著原專案的 id,一定要拿掉,否則會寫到原專案上(舊版的 bug)
			const { id: _oldId, ...project } = header.project;
			const now = new Date().toISOString();
			await this.projectsAdapter.set({
				key: newId,
				value: {
					...project,
					metadata: {
						...project.metadata,
						id: newId,
						name: `${stripImportedSuffix({ name: project.metadata.name })}${IMPORTED_SUFFIX}`,
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

		// 匯入的可能是舊版格式:馬上跑一次遷移
		this.migrationsPromise = null;
		await this.ensureMigrations();
		return { id: newId, missingCount };
	}

	/** 有素材清單、但瀏覽器裡沒有檔案的素材(需要重新連結) */
	async listMissingMedia({
		projectId,
	}: {
		projectId: string;
	}): Promise<MediaAssetData[]> {
		const { mediaMetadataAdapter, mediaAssetsAdapter } =
			this.getProjectMediaAdapters({ projectId });
		const missing: MediaAssetData[] = [];
		for (const id of await mediaMetadataAdapter.list()) {
			const metadata = await mediaMetadataAdapter.get(id);
			if (!metadata) continue;
			const file = await mediaAssetsAdapter.get(id).catch(() => null);
			if (!file) missing.push(metadata);
		}
		return missing;
	}

	/**
	 * 用使用者選的檔案補回缺少的素材:先比檔名 + 大小,再退一步只比檔名(同名只有一個時)。
	 * 回傳成功連結的數量與還缺的素材。
	 */
	async relinkMedia({
		projectId,
		files,
	}: {
		projectId: string;
		files: File[];
	}): Promise<{ linked: number; remaining: MediaAssetData[] }> {
		const missing = await this.listMissingMedia({ projectId });
		const matches = matchRelinkFiles({ missing, files });
		const { mediaMetadataAdapter, mediaAssetsAdapter } =
			this.getProjectMediaAdapters({ projectId });

		let linked = 0;
		for (const { metadata, file } of matches) {
			try {
				await mediaAssetsAdapter.set({ key: metadata.id, value: file });
				await mediaMetadataAdapter.set({
					key: metadata.id,
					value: {
						...metadata,
						size: file.size,
						lastModified: file.lastModified,
					},
				});
				linked += 1;
			} catch (error) {
				await mediaAssetsAdapter.remove(metadata.id).catch(() => {});
				if (this.isQuotaExceededError({ error })) {
					throw new Error("瀏覽器儲存空間不足,無法加入素材");
				}
				throw error;
			}
		}
		return { linked, remaining: await this.listMissingMedia({ projectId }) };
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
