import type { EditorCore } from "@/core";
import { toast } from "sonner";
import type { MediaAsset } from "@/media/types";
import { storageService } from "@/services/storage/service";
import { generateUUID } from "@/utils/id";
import { videoCache } from "@/services/video-cache/service";
import { waveformCache } from "@/services/waveform-cache/service";
import { BatchCommand, RemoveMediaAssetCommand } from "@/commands";
import { ProxyCancelledError, createVideoProxy } from "@/media/proxy";

interface ProxyJob {
	projectId: string;
	progress: number;
	controller: AbortController;
}

export class MediaManager {
	private assets: MediaAsset[] = [];
	private isLoading = false;
	private listeners = new Set<() => void>();
	private proxyJobs = new Map<string, ProxyJob>();

	constructor(private editor: EditorCore) {}

	async addMediaAsset({
		projectId,
		asset,
	}: {
		projectId: string;
		asset: Omit<MediaAsset, "id">;
	}): Promise<MediaAsset | null> {
		const newAsset: MediaAsset = {
			...asset,
			id: generateUUID(),
		};

		this.assets = [...this.assets, newAsset];
		this.notify();

		try {
			await storageService.saveMediaAsset({ projectId, mediaAsset: newAsset });
			this.editor.project.ratchetFpsForImportedMedia({
				importedAssets: [newAsset],
			});
			return newAsset;
		} catch (error) {
			console.error("Failed to save media asset:", error);
			this.assets = this.assets.filter((asset) => asset.id !== newAsset.id);
			this.notify();

			if (storageService.isQuotaExceededError({ error })) {
				toast.error("瀏覽器儲存空間不足", {
					description: error instanceof Error ? error.message : undefined,
				});
			}

			return null;
		}
	}

	removeMediaAsset({ projectId, id }: { projectId: string; id: string }): void {
		this.removeMediaAssets({ projectId, ids: [id] });
	}

	removeMediaAssets({
		projectId,
		ids,
	}: {
		projectId: string;
		ids: string[];
	}): void {
		const uniqueIds = [...new Set(ids)];
		if (uniqueIds.length === 0) {
			return;
		}

		const command =
			uniqueIds.length === 1
				? new RemoveMediaAssetCommand({
						projectId,
						assetId: uniqueIds[0],
					})
				: new BatchCommand(
						uniqueIds.map((id) =>
							new RemoveMediaAssetCommand({
								projectId,
								assetId: id,
							}),
						),
					);

		this.editor.command.execute({ command });
	}

	async loadProjectMedia({ projectId }: { projectId: string }): Promise<void> {
		this.isLoading = true;
		this.notify();

		try {
			const mediaAssets = await storageService.loadAllMediaAssets({
				projectId,
			});
			this.assets = mediaAssets;
			this.notify();
		} catch (error) {
			console.error("Failed to load media assets:", error);
		} finally {
			this.isLoading = false;
			this.notify();
		}
	}

	async clearProjectMedia({ projectId }: { projectId: string }): Promise<void> {
		waveformCache.clearAll();

		this.assets.forEach((asset) => {
			if (asset.url) {
				URL.revokeObjectURL(asset.url);
			}
			if (asset.thumbnailUrl) {
				URL.revokeObjectURL(asset.thumbnailUrl);
			}
		});

		const mediaIds = this.assets.map((asset) => asset.id);
		this.assets = [];
		this.notify();

		try {
			await Promise.all(
				mediaIds.map((id) =>
					storageService.deleteMediaAsset({ projectId, id }),
				),
			);
		} catch (error) {
			console.error("Failed to clear media assets from storage:", error);
		}
	}

	clearAllAssets(): void {
		videoCache.clearAll();
		waveformCache.clearAll();

		this.assets.forEach((asset) => {
			if (asset.url) {
				URL.revokeObjectURL(asset.url);
			}
			if (asset.thumbnailUrl) {
				URL.revokeObjectURL(asset.thumbnailUrl);
			}
		});

		this.assets = [];
		this.notify();
	}

	/** 正在建立代理檔時回傳進度 0..1,沒有在建立回傳 null */
	getProxyProgress({ id }: { id: string }): number | null {
		return this.proxyJobs.get(id)?.progress ?? null;
	}

	/**
	 * 建立預覽用代理檔。轉檔可能要花一段時間,期間可以繼續編輯;
	 * 完成後預覽自動改讀代理檔,匯出仍讀原始檔。
	 */
	async createProxy({
		projectId,
		id,
	}: {
		projectId: string;
		id: string;
	}): Promise<void> {
		const asset = this.assets.find((item) => item.id === id);
		if (!asset || asset.type !== "video" || this.proxyJobs.has(id)) return;

		const job: ProxyJob = {
			projectId,
			progress: 0,
			controller: new AbortController(),
		};
		this.proxyJobs.set(id, job);
		this.notify();

		let lastNotified = 0;
		try {
			// 先清掉舊的代理檔與完成標記,轉到一半失敗時才不會誤用舊檔
			await storageService.deleteMediaProxy({ projectId, id }).catch(() => {});
			const writable = await storageService
				.openMediaProxyWritable({ projectId, id })
				.catch(() => null);
			const blob = await createVideoProxy({
				file: asset.file,
				writable: writable ?? undefined,
				signal: job.controller.signal,
				onProgress: (progress) => {
					job.progress = progress;
					// 進度每 2% 才通知一次,避免一直重繪
					if (progress - lastNotified >= 0.02) {
						lastNotified = progress;
						this.notify();
					}
				},
			});
			if (blob) {
				await storageService.saveMediaProxy({
					projectId,
					id,
					file: new File([blob], `${id}.mp4`, { type: "video/mp4" }),
				});
			}

			await storageService.markMediaProxyComplete({ projectId, id });
			const proxyFile = await storageService.loadCompletedMediaProxy({
				projectId,
				id,
			});
			if (!proxyFile) {
				throw new Error("代理檔寫入失敗");
			}
			// 轉檔期間專案可能已關閉或素材已刪除:只有素材還在時才掛上去
			if (this.assets.some((item) => item.id === id)) {
				this.assets = this.assets.map((item) =>
					item.id === id ? { ...item, proxyFile } : item,
				);
				videoCache.clearVideo({ mediaId: id });
				toast.success(`「${asset.name}」的代理檔已建立`, {
					description: "預覽會改用低解析度版本,匯出仍使用原始檔。",
				});
			}
		} catch (error) {
			await storageService.deleteMediaProxy({ projectId, id }).catch(() => {});
			if (error instanceof ProxyCancelledError) {
				toast(`已取消建立「${asset.name}」的代理檔`);
			} else {
				console.error("建立代理檔失敗", error);
				toast.error(`無法建立「${asset.name}」的代理檔`, {
					description: error instanceof Error ? error.message : undefined,
				});
			}
		} finally {
			this.proxyJobs.delete(id);
			this.notify();
		}
	}

	cancelProxy({ id }: { id: string }): void {
		this.proxyJobs.get(id)?.controller.abort();
	}

	async removeProxy({
		projectId,
		id,
	}: {
		projectId: string;
		id: string;
	}): Promise<void> {
		this.assets = this.assets.map((item) => {
			if (item.id !== id) return item;
			const { proxyFile: _proxyFile, ...rest } = item;
			return rest;
		});
		videoCache.clearVideo({ mediaId: id });
		this.notify();
		await storageService.deleteMediaProxy({ projectId, id }).catch((error) => {
			console.warn("刪除代理檔失敗", error);
		});
	}

	getAssets(): MediaAsset[] {
		return this.assets;
	}

	setAssets({ assets }: { assets: MediaAsset[] }): void {
		this.assets = assets;
		this.notify();
	}

	isLoadingMedia(): boolean {
		return this.isLoading;
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
}
