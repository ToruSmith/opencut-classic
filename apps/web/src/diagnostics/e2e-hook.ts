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

	/**
	 * 編輯延遲:對第一個片段連續改名 `count` 次(每次都會讓時間軸狀態換新),
	 * 量「呼叫 → 兩個動畫影格之後」的時間,同時收集 long task。
	 * `baseline` 是同樣流程但不做編輯的等待時間,拿來扣掉影格本身的間隔。
	 */
	async measureEdits({ count, kind = "rename" }: { count: number; kind?: "rename" | "opacity" }): Promise<{
		editMs: number[];
		baselineMs: number[];
		longTasksMs: number[];
		clipCount: number;
	}> {
		const editor = EditorCore.getInstance();
		const scene = editor.scenes.getActiveScene().tracks;
		const tracks = [...scene.overlay, scene.main, ...scene.audio];
		const track = tracks.find((candidate) => candidate.elements.length > 0);
		if (!track) throw new Error("時間軸沒有片段");
		const target = track.elements[0];
		const clipCount = tracks.reduce((sum, t) => sum + t.elements.length, 0);
		const frames = () =>
			new Promise<void>((done) =>
				requestAnimationFrame(() => requestAnimationFrame(() => done())),
			);
		const longTasksMs: number[] = [];
		let observer: PerformanceObserver | null = null;
		try {
			observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) longTasksMs.push(Math.round(entry.duration));
			});
			observer.observe({ entryTypes: ["longtask"] });
		} catch {}

		const baselineMs: number[] = [];
		for (let i = 0; i < 10; i += 1) {
			const t0 = performance.now();
			await frames();
			baselineMs.push(Math.round(performance.now() - t0));
		}
		const editMs: number[] = [];
		for (let i = 0; i < count; i += 1) {
			const t0 = performance.now();
			editor.timeline.updateElements({
				updates: [
					{
						trackId: track.id,
						elementId: target.id,
						patch:
							kind === "opacity"
								? ({
										params: { ...(target as { params?: Record<string, unknown> }).params, opacity: i % 2 === 0 ? 0.9 : 1 },
									} as Partial<typeof target>)
								: { name: `edit-${i}` },
					},
				],
				pushHistory: false,
			});
			await frames();
			editMs.push(Math.round(performance.now() - t0));
			await new Promise((done) => setTimeout(done, 80));
		}
		observer?.disconnect();
		return { editMs, baselineMs, longTasksMs, clipCount };
	},

	/** 刪除時間軸上的片段:`keep` = 保留前幾個(依開始時間),其餘全部刪掉;0 = 全刪。回傳刪掉幾個 */
	deleteClips({ keep }: { keep: number }): number {
		const editor = EditorCore.getInstance();
		const scene = editor.scenes.getActiveScene().tracks;
		const all = [...scene.overlay, scene.main, ...scene.audio].flatMap((track) =>
			track.elements.map((element) => ({
				trackId: track.id,
				elementId: element.id,
				startTime: element.startTime,
			})),
		);
		all.sort((a, b) => a.startTime - b.startTime);
		const doomed = all.slice(keep).map(({ trackId, elementId }) => ({ trackId, elementId }));
		if (doomed.length > 0) editor.timeline.deleteElements({ elements: doomed });
		return doomed.length;
	},

	/** 從素材庫刪掉素材(會連帶移除時間軸上使用它的片段),走和介面相同的指令 */
	removeAssets({ ids }: { ids: string[] }): void {
		const editor = EditorCore.getInstance();
		editor.media.removeMediaAssets({
			projectId: editor.project.getActive().metadata.id,
			ids,
		});
	},

	/** 選取時間軸上全部片段(之後用鍵盤 Delete 走和使用者相同的快捷鍵路徑) */
	selectAllClips(): number {
		const editor = EditorCore.getInstance();
		const scene = editor.scenes.getActiveScene().tracks;
		const refs = [...scene.overlay, scene.main, ...scene.audio].flatMap((track) =>
			track.elements.map((element) => ({ trackId: track.id, elementId: element.id })),
		);
		editor.selection.setSelectedElements({ elements: refs });
		return refs.length;
	},

	/**
	 * 一鍵效能報告(給使用者在自己的電腦上量真實 GPU 的數字):
	 * 網址加 `?e2e` 開啟編輯器,載入專案後在 Console 執行 `copy(JSON.stringify(await __opencut.perfReport({ seconds: 10 }), null, 1))`。
	 * 會從目前位置播放 `seconds` 秒,回傳各階段耗時(平均 / p95,ms)、計數與瀏覽器 / 繪圖資訊,結束後暫停。
	 */
	async perfReport({ seconds = 10 }: { seconds?: number } = {}) {
		const editor = EditorCore.getInstance();
		const sink: Array<{
			frames: number;
			spans: Array<{ span: string; meanMs: number; p95Ms: number }>;
			counters: Array<{ counter: string; total: number }>;
		}> = [];
		(window as unknown as { __renderPerfSink?: unknown[] }).__renderPerfSink = sink;
		window.__renderPerf = true;
		const startedAt = performance.now();
		editor.playback.play();
		await new Promise((done) => setTimeout(done, seconds * 1000));
		editor.playback.pause();
		window.__renderPerf = false;
		const elapsedSec = (performance.now() - startedAt) / 1000;
		let frames = 0;
		const spanMean: Record<string, number> = {};
		const spanP95: Record<string, number> = {};
		const counters: Record<string, number> = {};
		for (const entry of sink) {
			frames += entry.frames;
			for (const row of entry.spans) {
				spanMean[row.span] = Math.max(spanMean[row.span] ?? 0, row.meanMs);
				spanP95[row.span] = Math.max(spanP95[row.span] ?? 0, row.p95Ms);
			}
			for (const row of entry.counters) {
				counters[row.counter] = (counters[row.counter] ?? 0) + row.total;
			}
		}
		let gpu = "unknown";
		try {
			const canvas = document.createElement("canvas");
			const gl = canvas.getContext("webgl");
			const info = gl?.getExtension("WEBGL_debug_renderer_info");
			if (gl && info) gpu = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
		} catch {}
		const brokenFlush = sink.length === 0;
		return {
			note: brokenFlush
				? "沒有收到效能資料:播放時間太短(每 60 格才輸出一次),或時間軸是空的"
				: "span 為各輪最大值的『平均/p95』ms;frames 是這段期間渲染的格數",
			seconds: Math.round(elapsedSec * 10) / 10,
			renderedFrames: frames,
			fpsRendered: Math.round((frames / elapsedSec) * 10) / 10,
			spansMeanP95Ms: Object.fromEntries(
				Object.keys(spanMean).map((name) => [
					name,
					`${spanMean[name].toFixed(1)}/${(spanP95[name] ?? 0).toFixed(1)}`,
				]),
			),
			counters,
			gpu,
			webgpu: typeof navigator !== "undefined" && "gpu" in navigator,
			userAgent: navigator.userAgent,
			cores: navigator.hardwareConcurrency,
			degraded: editor.renderer.isDegraded,
			clips: editor.scenes
				.getActiveScene()
				.tracks.main.elements.length,
			totalSeconds: mediaTimeToSeconds({ time: editor.timeline.getTotalDuration() }),
		};
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
