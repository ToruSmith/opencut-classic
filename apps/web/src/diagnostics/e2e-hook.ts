/**
 * 自動驗收用的測試掛鉤(只有網址帶 `?e2e` 才會載入,見 main.tsx)。
 *
 * 給 `apps/web/e2e/run.mjs`(Playwright,無頭 Chromium、只用 CPU)與 AI 剪輯師使用:
 * 不依賴 GPU,也不用操作介面,就能建專案、匯入素材、排時間軸、播放並讀取狀態。
 * 一般使用者不會碰到:沒有 `?e2e` 時這個檔案根本不會被下載。
 *
 * 所有時間參數都是「秒」,內部才轉成 MediaTime。
 */
import { EditorCore } from "@/core";
import { processMediaAssets } from "@/media/processing";
import { buildElementFromMedia } from "@/timeline/element-utils";
import type { MediaAsset } from "@/media/types";
import { getImageCacheSize } from "@/services/renderer/nodes/image-node";
import { wasmCompositor } from "@/services/renderer/compositor/wasm-compositor";
import { MAX_ACTIVE_SINKS, videoCache } from "@/services/video-cache/service";
import { mediaTimeFromSeconds, mediaTimeToSeconds } from "@/wasm";

interface ImportedAssetInfo {
	id: string;
	name: string;
	type: string;
	duration: number | null;
}

function guessMimeType({ url }: { url: string }): string {
	const lower = url.toLowerCase().split("?")[0];
	if (lower.endsWith(".webm")) return "video/webm";
	if (lower.endsWith(".mp4")) return "video/mp4";
	if (lower.endsWith(".png")) return "image/png";
	if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
	if (lower.endsWith(".wav")) return "audio/wav";
	return "application/octet-stream";
}

function describeAsset(asset: MediaAsset): ImportedAssetInfo {
	return {
		id: asset.id,
		name: asset.name,
		type: asset.type,
		duration: asset.duration ?? null,
	};
}

function getAssetsById({ ids }: { ids: string[] }): MediaAsset[] {
	const editor = EditorCore.getInstance();
	const all = editor.media.getAssets();
	return ids.map((id) => {
		const asset = all.find((candidate) => candidate.id === id);
		if (!asset) throw new Error(`找不到素材 ${id}`);
		return asset;
	});
}

const e2eApi = {
	maxActiveSinks: MAX_ACTIVE_SINKS,

	/** 建立專案並回傳 id;呼叫端再把網址切到 `#/editor/<id>` */
	async createProject({ name }: { name: string }): Promise<string> {
		return EditorCore.getInstance().project.createNewProject({ name });
	},

	/** 專案已載入(編輯器頁面載入完成)才回傳 true */
	isProjectReady({ id }: { id: string }): boolean {
		return (
			EditorCore.getInstance().project.getActiveOrNull()?.metadata.id === id
		);
	},

	/** 從網址抓檔案,走和「匯入素材」相同的處理流程 */
	async importFromUrls({
		urls,
	}: {
		urls: string[];
	}): Promise<ImportedAssetInfo[]> {
		const editor = EditorCore.getInstance();
		const project = editor.project.getActive();
		const files = await Promise.all(
			urls.map(async (url) => {
				const response = await fetch(url);
				if (!response.ok) throw new Error(`下載失敗 ${url}: ${response.status}`);
				const blob = await response.blob();
				const name = decodeURIComponent(url.split("/").pop() ?? "file");
				return new File([blob], name, {
					type: guessMimeType({ url }),
					lastModified: 1_700_000_000_000,
				});
			}),
		);
		const processed = await processMediaAssets({ files });
		const added: ImportedAssetInfo[] = [];
		for (const asset of processed) {
			const created = await editor.media.addMediaAsset({
				projectId: project.metadata.id,
				asset,
			});
			if (created) added.push(describeAsset(created));
		}
		return added;
	},

	/** 每個素材各放一整段,首尾相接(用來檢查「播放頭在哪就是哪個素材」) */
	buildSequential({ assetIds }: { assetIds: string[] }): number {
		const editor = EditorCore.getInstance();
		let cursor = 0;
		const items = getAssetsById({ ids: assetIds }).map((asset) => {
			const seconds = asset.duration ?? 5;
			const element = buildElementFromMedia({
				mediaId: asset.id,
				mediaType: asset.type,
				name: asset.name,
				duration: mediaTimeFromSeconds({ seconds }),
				startTime: mediaTimeFromSeconds({ seconds: cursor }),
			});
			cursor += seconds;
			return { element, placement: { mode: "auto" as const } };
		});
		editor.timeline.insertElements({ items });
		return cursor;
	},

	/**
	 * 模擬 AMV 快剪:`count` 段、每段 `clipSeconds`,輪流取不同素材(每個切點都換素材,
	 * 最吃解碼器),入點錯開。回傳總秒數。
	 */
	buildFastCut({
		assetIds,
		count,
		clipSeconds,
	}: {
		assetIds: string[];
		count: number;
		clipSeconds: number;
	}): number {
		const editor = EditorCore.getInstance();
		const assets = getAssetsById({ ids: assetIds });
		const items = [];
		for (let index = 0; index < count; index += 1) {
			const asset = assets[index % assets.length];
			const sourceSeconds = asset.duration ?? 5;
			const maxStart = Math.max(0, sourceSeconds - clipSeconds - 0.05);
			const trimStartSeconds = (index * 0.37) % Math.max(0.01, maxStart);
			const base = buildElementFromMedia({
				mediaId: asset.id,
				mediaType: asset.type,
				name: `${asset.name}#${index}`,
				duration: mediaTimeFromSeconds({ seconds: clipSeconds }),
				startTime: mediaTimeFromSeconds({ seconds: index * clipSeconds }),
			});
			const element = {
				...base,
				trimStart: mediaTimeFromSeconds({ seconds: trimStartSeconds }),
				trimEnd: mediaTimeFromSeconds({
					seconds: Math.max(0, sourceSeconds - trimStartSeconds - clipSeconds),
				}),
				sourceDuration: mediaTimeFromSeconds({ seconds: sourceSeconds }),
			} as typeof base;
			items.push({ element, placement: { mode: "auto" as const } });
		}
		editor.timeline.insertElements({ items });
		return count * clipSeconds;
	},

	/** 圖片連續排列,每張 `clipSeconds`,輪流取素材 */
	buildImageRun({
		assetIds,
		count,
		clipSeconds,
	}: {
		assetIds: string[];
		count: number;
		clipSeconds: number;
	}): number {
		const editor = EditorCore.getInstance();
		const assets = getAssetsById({ ids: assetIds });
		const items = [];
		for (let index = 0; index < count; index += 1) {
			const asset = assets[index % assets.length];
			const element = buildElementFromMedia({
				mediaId: asset.id,
				mediaType: asset.type,
				name: `${asset.name}#${index}`,
				duration: mediaTimeFromSeconds({ seconds: clipSeconds }),
				startTime: mediaTimeFromSeconds({ seconds: index * clipSeconds }),
			});
			items.push({ element, placement: { mode: "auto" as const } });
		}
		editor.timeline.insertElements({ items });
		return count * clipSeconds;
	},

	seek({ seconds }: { seconds: number }): void {
		EditorCore.getInstance().playback.seek({
			time: mediaTimeFromSeconds({ seconds }),
		});
	},
	play(): void {
		EditorCore.getInstance().playback.play();
	},
	pause(): void {
		EditorCore.getInstance().playback.pause();
	},

	/** 目前狀態(時間、解碼器與圖片快取數量、JS 記憶體),驗收腳本用來判斷有沒有守住上限 */
	state() {
		const editor = EditorCore.getInstance();
		const memory = (
			performance as Performance & { memory?: { usedJSHeapSize: number } }
		).memory;
		return {
			timeSeconds: mediaTimeToSeconds({
				time: editor.playback.getCurrentTime(),
			}),
			isPlaying: editor.playback.getIsPlaying(),
			totalSeconds: mediaTimeToSeconds({
				time: editor.timeline.getTotalDuration(),
			}),
			isDegraded: editor.renderer.isDegraded,
			videoSinks: videoCache.getStats().totalSinks,
			imageCacheSize: getImageCacheSize(),
			heapMB: memory ? Math.round(memory.usedJSHeapSize / 1048576) : null,
			assetCount: editor.media.getAssets().length,
		};
	},

	/** 替預覽用的畫布加上記號,讓 Playwright 能只截這一塊來取樣顏色 */
	markPreviewCanvas(): boolean {
		try {
			wasmCompositor.getCanvas().dataset.e2ePreview = "1";
			return true;
		} catch {
			return false;
		}
	},
};

export type E2eApi = typeof e2eApi;

declare global {
	interface Window {
		__opencut?: E2eApi;
	}
}

export function installE2eHook(): void {
	window.__opencut = e2eApi;
}
