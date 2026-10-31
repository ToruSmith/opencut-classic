import type { CanvasSink, Input, WrappedCanvas } from "mediabunny";
import { pickEvictions } from "@/services/cache-policy";

/**
 * 同時保留的解碼器上限。每個解碼器佔一個硬體解碼實例與 3 張畫布,
 * 瀏覽器的硬體解碼實例有限,素材很多(自動排片、快剪)時沒有上限會越積越多。
 * 超過時淘汰最久沒用、而且沒有請求排隊的那個;被淘汰的素材之後用到時會重新開啟。
 */
export const MAX_ACTIVE_SINKS = 12;

interface VideoSinkData {
	input: Input;
	sink: CanvasSink;
	iterator: AsyncGenerator<WrappedCanvas, void, unknown> | null;
	currentFrame: WrappedCanvas | null;
	nextFrame: WrappedCanvas | null;
	lastTime: number;
	prefetching: boolean;
	prefetchPromise: Promise<void> | null;
	/** 最後一次被請求的時間(performance.now),淘汰用 */
	lastUsed: number;
	/** 還在排隊或處理中的請求數;大於 0 不可淘汰 */
	inflight: number;
}

/** 預覽時解碼的最大尺寸(通常是專案畫布大小);省略代表用影片原始解析度(匯出) */
export interface VideoDecodeLimit {
	width: number;
	height: number;
}

function getSinkKey({
	mediaId,
	maxSize,
}: {
	mediaId: string;
	maxSize?: VideoDecodeLimit;
}): string {
	return maxSize ? `${mediaId}@${maxSize.width}x${maxSize.height}` : mediaId;
}

export class VideoCache {
	private sinks = new Map<string, VideoSinkData>();
	private initPromises = new Map<string, Promise<void>>();
	private frameChain = new Map<string, Promise<unknown>>();
	private seekGenerations = new Map<string, number>();
	/** 預熱失敗的素材先停一陣子再試,避免每格都重新開檔 */
	private prewarmBackoffUntil = new Map<string, number>();

	async getFrameAt({
		mediaId,
		file,
		time,
		maxSize,
		maxWaitMs,
		onStale,
	}: {
		mediaId: string;
		file: File;
		time: number;
		/** 預覽用:把解碼後的畫面縮到不超過這個尺寸,大幅減少 4K 素材的解碼後處理與紋理上傳量 */
		maxSize?: VideoDecodeLimit;
		/**
		 * 播放中用:解碼超過這個時間還沒好,就先回傳這個解碼器目前的那一格(解碼在背景繼續),
		 * 不讓整格畫面等一個慢的素材。暫停 / 拖曳時不要給,才會拿到精確的那一格。
		 * 這個解碼器還沒有任何畫面時仍會等。
		 */
		maxWaitMs?: number;
		/** 回傳的是舊的那一格(超時)時呼叫,讓呼叫端知道暫停後要補渲染 */
		onStale?: () => void;
	}): Promise<WrappedCanvas | null> {
		// 預覽與匯出各用自己的解碼器,互不搶同一個 iterator
		const key = getSinkKey({ mediaId, maxSize });
		await this.ensureSink({ key, file, maxSize });

		const sinkData = this.sinks.get(key);
		if (!sinkData) return null;

		sinkData.lastUsed = performance.now();
		sinkData.inflight += 1;

		const generation = (this.seekGenerations.get(key) ?? 0) + 1;
		this.seekGenerations.set(key, generation);

		const previous = this.frameChain.get(key) ?? Promise.resolve();
		const current = previous.then(() => {
			if (this.seekGenerations.get(key) !== generation) {
				return sinkData.currentFrame ?? null;
			}
			return this.resolveFrame({ sinkData, time });
		});
		const settled = current.catch(() => {});
		this.frameChain.set(key, settled);
		void settled.then(() => {
			sinkData.inflight = Math.max(0, sinkData.inflight - 1);
		});

		this.evictExcess({ keep: key });

		const stale = sinkData.currentFrame;
		if (maxWaitMs === undefined || !stale) {
			return current;
		}

		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<"timeout">((resolve) => {
			timer = setTimeout(() => resolve("timeout"), maxWaitMs);
		});
		try {
			const winner = await Promise.race([current, timeout]);
			if (winner === "timeout") {
				onStale?.();
				return stale;
			}
			return winner;
		} finally {
			if (timer !== undefined) clearTimeout(timer);
		}
	}

	/**
	 * 片段快開始前先把解碼器準備好(開檔、解析軌道),不會移動已經在用的解碼器:
	 * 同一個素材被切成很多段時,它們共用一個解碼器,這裡不能把它 seek 走。
	 * 只有解碼器剛建好、還沒有任何畫面時,才順便解起點那一格。
	 */
	async prewarm({
		mediaId,
		file,
		time,
		maxSize,
	}: {
		mediaId: string;
		file: File;
		time: number;
		maxSize?: VideoDecodeLimit;
	}): Promise<void> {
		const key = getSinkKey({ mediaId, maxSize });
		const now = performance.now();
		if ((this.prewarmBackoffUntil.get(key) ?? 0) > now) return;
		try {
			await this.ensureSink({ key, file, maxSize });
			const sinkData = this.sinks.get(key);
			if (!sinkData) return;
			sinkData.lastUsed = performance.now();
			if (!sinkData.iterator && !sinkData.currentFrame && sinkData.inflight === 0) {
				await this.getFrameAt({ mediaId, file, time, maxSize });
			}
		} catch {
			// 預熱失敗不影響播放;真的需要畫面時會再試並照常回報錯誤
			this.prewarmBackoffUntil.set(key, now + 5000);
		}
	}

	/** 解碼器超過上限時淘汰最久沒用、且沒有請求排隊的 */
	private evictExcess({ keep }: { keep?: string }): void {
		const victims = pickEvictions({
			entries: [...this.sinks.entries()].map(([key, data]) => ({
				key,
				lastUsed: data.lastUsed,
				busy: data.inflight > 0 || this.initPromises.has(key),
			})),
			max: MAX_ACTIVE_SINKS,
			keep,
		});
		for (const key of victims) {
			this.disposeSink({ key });
		}
	}

	private disposeSink({ key }: { key: string }): void {
		const sinkData = this.sinks.get(key);
		if (sinkData?.iterator) {
			void sinkData.iterator.return();
		}
		sinkData?.input.dispose();
		this.sinks.delete(key);
		this.initPromises.delete(key);
		this.frameChain.delete(key);
		this.seekGenerations.delete(key);
		this.prewarmBackoffUntil.delete(key);
	}

	private async resolveFrame({
		sinkData,
		time,
	}: {
		sinkData: VideoSinkData;
		time: number;
	}): Promise<WrappedCanvas | null> {
		if (sinkData.nextFrame && sinkData.nextFrame.timestamp <= time) {
			sinkData.currentFrame = sinkData.nextFrame;
			sinkData.nextFrame = null;
			this.startPrefetch({ sinkData });
		}

		if (
			sinkData.currentFrame &&
			this.isFrameValid({ frame: sinkData.currentFrame, time })
		) {
			if (!sinkData.nextFrame && !sinkData.prefetching) {
				this.startPrefetch({ sinkData });
			}
			return sinkData.currentFrame;
		}

		if (
			sinkData.iterator &&
			sinkData.currentFrame &&
			time >= sinkData.lastTime &&
			time < sinkData.lastTime + 2.0
		) {
			const frame = await this.iterateToTime({ sinkData, targetTime: time });
			if (frame) {
				if (!sinkData.nextFrame && !sinkData.prefetching) {
					this.startPrefetch({ sinkData });
				}
				return frame;
			}
		}

		const frame = await this.seekToTime({ sinkData, time });
		if (frame && !sinkData.nextFrame && !sinkData.prefetching) {
			this.startPrefetch({ sinkData });
		}
		return frame;
	}

	private isFrameValid({
		frame,
		time,
	}: {
		frame: WrappedCanvas;
		time: number;
	}): boolean {
		return time >= frame.timestamp && time < frame.timestamp + frame.duration;
	}
	private async iterateToTime({
		sinkData,
		targetTime,
	}: {
		sinkData: VideoSinkData;
		targetTime: number;
	}): Promise<WrappedCanvas | null> {
		if (!sinkData.iterator) return null;

		try {
			while (true) {
				// Wait for any pending prefetch to finish before touching iterator
				if (sinkData.prefetching && sinkData.prefetchPromise) {
					await sinkData.prefetchPromise;
				}

				// Check if the nextFrame (which might have just arrived) is what we need
				if (
					sinkData.nextFrame &&
					sinkData.nextFrame.timestamp <= targetTime + 0.05 // Tolerance
				) {
					sinkData.currentFrame = sinkData.nextFrame;
					sinkData.nextFrame = null;
				} else {
					const { value: frame, done } = await sinkData.iterator.next();

					if (done || !frame) break;

					sinkData.currentFrame = frame;
				}

				const frame = sinkData.currentFrame;
				if (!frame) break;

				sinkData.lastTime = frame.timestamp;

				if (this.isFrameValid({ frame, time: targetTime })) {
					return frame;
				}

				if (frame.timestamp > targetTime + 1.0) break;
			}
		} catch (error) {
			console.warn("Iterator failed, will restart:", error);
			sinkData.iterator = null;
		}

		return null;
	}
	private async seekToTime({
		sinkData,
		time,
	}: {
		sinkData: VideoSinkData;
		time: number;
	}): Promise<WrappedCanvas | null> {
		try {
			if (sinkData.prefetching && sinkData.prefetchPromise) {
				await sinkData.prefetchPromise;
			}

			if (sinkData.iterator) {
				await sinkData.iterator.return();
				sinkData.iterator = null;
			}

			sinkData.nextFrame = null;
			sinkData.iterator = sinkData.sink.canvases(time);
			sinkData.lastTime = time;

			// Fetch current frame
			const { value: frame } = await sinkData.iterator.next();

			if (frame) {
				sinkData.currentFrame = frame;
				this.startPrefetch({ sinkData });
				return frame;
			}
		} catch (error) {
			console.warn("Failed to seek video:", error);
		}

		return null;
	}

	private startPrefetch({ sinkData }: { sinkData: VideoSinkData }): void {
		if (sinkData.prefetching || !sinkData.iterator || sinkData.nextFrame) {
			return;
		}

		sinkData.prefetching = true;
		sinkData.prefetchPromise = this.prefetchNextFrame({ sinkData });
	}

	private async prefetchNextFrame({
		sinkData,
	}: {
		sinkData: VideoSinkData;
	}): Promise<void> {
		if (!sinkData.iterator) {
			sinkData.prefetching = false;
			sinkData.prefetchPromise = null;
			return;
		}

		try {
			const { value: frame, done } = await sinkData.iterator.next();

			if (done || !frame) {
				sinkData.prefetching = false;
				sinkData.prefetchPromise = null;
				return;
			}

			sinkData.nextFrame = frame;
			sinkData.prefetching = false;
			sinkData.prefetchPromise = null;
		} catch (error) {
			console.warn("Prefetch failed:", error);
			sinkData.prefetching = false;
			sinkData.prefetchPromise = null;
			sinkData.iterator = null;
		}
	}
	private async ensureSink({
		key,
		file,
		maxSize,
	}: {
		key: string;
		file: File;
		maxSize?: VideoDecodeLimit;
	}): Promise<void> {
		if (this.sinks.has(key)) return;

		if (this.initPromises.has(key)) {
			await this.initPromises.get(key);
			return;
		}

		const initPromise = this.initializeSink({ key, file, maxSize });
		this.initPromises.set(key, initPromise);

		try {
			await initPromise;
		} finally {
			this.initPromises.delete(key);
		}
	}
	private async initializeSink({
		key,
		file,
		maxSize,
	}: {
		key: string;
		file: File;
		maxSize?: VideoDecodeLimit;
	}): Promise<void> {
		// mediabunny 體積大,等到真的要解碼影片才載入
		const { ALL_FORMATS, BlobSource, CanvasSink, Input } = await import(
			"mediabunny"
		);
		const input = new Input({
			source: new BlobSource(file),
			formats: ALL_FORMATS,
		});

		try {
			const videoTrack = await input.getPrimaryVideoTrack();
			if (!videoTrack) {
				throw new Error("No video track found");
			}

			const canDecode = await videoTrack.canDecode();
			if (!canDecode) {
				throw new Error("Video codec not supported for decoding");
			}

			// 只給 width,高度會依比例自動推算(不會有黑邊);來源較小時維持原尺寸
			const scale = maxSize
				? Math.min(
						1,
						maxSize.width / videoTrack.displayWidth,
						maxSize.height / videoTrack.displayHeight,
					)
				: 1;
			const sink = new CanvasSink(videoTrack, {
				poolSize: 3,
				fit: "contain",
				...(scale < 1
					? { width: Math.max(2, Math.round(videoTrack.displayWidth * scale)) }
					: {}),
			});

			this.sinks.set(key, {
				input,
				sink,
				iterator: null,
				currentFrame: null,
				nextFrame: null,
				lastTime: -1,
				prefetching: false,
				prefetchPromise: null,
				lastUsed: performance.now(),
				inflight: 0,
			});
		} catch (error) {
			input.dispose();
			console.error(`Failed to initialize video sink for ${key}:`, error);
			throw error;
		}
	}

	/** 清掉某個素材的所有解碼器(原始解析度與各種預覽尺寸) */
	clearVideo({ mediaId }: { mediaId: string }): void {
		const belongsToMedia = (key: string) =>
			key === mediaId || key.startsWith(`${mediaId}@`);

		for (const key of [...this.sinks.keys()].filter(belongsToMedia)) {
			this.disposeSink({ key });
		}

		for (const map of [
			this.initPromises,
			this.frameChain,
			this.seekGenerations,
		] as Array<Map<string, unknown>>) {
			for (const key of [...map.keys()].filter(belongsToMedia)) {
				map.delete(key);
			}
		}
	}

	clearAll(): void {
		for (const key of [...this.sinks.keys()]) {
			this.clearVideo({ mediaId: key.split("@")[0] });
		}
	}

	getStats() {
		return {
			totalSinks: this.sinks.size,
			activeSinks: Array.from(this.sinks.values()).filter((s) => s.iterator)
				.length,
			cachedFrames: Array.from(this.sinks.values()).filter(
				(s) => s.currentFrame,
			).length,
		};
	}
}

export const videoCache = new VideoCache();
