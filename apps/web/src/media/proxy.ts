/**
 * 代理檔(proxy):把大影片轉成低解析度、關鍵影格密集的 H.264,只給「預覽」用。
 * 匯出與快照仍然讀原始檔,所以畫質不受影響。
 *
 * - 時間戳和原始檔完全一致(trim.start = 0),預覽與匯出的畫格才會對齊。
 * - 每 0.5 秒一個關鍵影格:手機或相機的長 GOP 影片拖曳時間軸會快很多。
 * - 不含音訊:預覽的聲音一直是讀原始檔。
 *
 * mediabunny 體積大,一律動態載入(專案列表用不到)。
 */

/** 代理檔長邊上限(像素) */
export const PROXY_MAX_EDGE = 1280;
const PROXY_KEYFRAME_INTERVAL_SECONDS = 0.5;

/** 依原始尺寸算代理檔尺寸:等比縮小到長邊不超過上限、不放大、寬高都是偶數(H.264 需要) */
export function computeProxySize({
	width,
	height,
	maxEdge = PROXY_MAX_EDGE,
}: {
	width: number;
	height: number;
	maxEdge?: number;
}): { width: number; height: number } | null {
	if (!(width > 0) || !(height > 0)) return null;
	const scale = Math.min(1, maxEdge / Math.max(width, height));
	const even = (value: number) => Math.max(2, Math.round((value * scale) / 2) * 2);
	return { width: even(width), height: even(height) };
}

export class ProxyCancelledError extends Error {
	constructor() {
		super("已取消建立代理檔");
		this.name = "ProxyCancelledError";
	}
}

/**
 * 轉檔。writable 有給就直接串流寫入(OPFS),不然先放在記憶體再回傳 Blob。
 * 失敗會丟錯;被取消會丟 ProxyCancelledError。
 */
export async function createVideoProxy({
	file,
	writable,
	onProgress,
	signal,
}: {
	file: File;
	writable?: FileSystemWritableFileStream;
	onProgress?: (progress: number) => void;
	signal?: AbortSignal;
}): Promise<Blob | null> {
	const {
		Input,
		Output,
		Conversion,
		ALL_FORMATS,
		BlobSource,
		BufferTarget,
		StreamTarget,
		Mp4OutputFormat,
		QUALITY_MEDIUM,
		getFirstEncodableVideoCodec,
	} = await import("mediabunny");

	const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track) throw new Error("找不到影片軌");
		if (!(await track.canDecode())) {
			throw new Error("瀏覽器無法解碼這個影片格式");
		}
		const size = computeProxySize({
			width: track.displayWidth,
			height: track.displayHeight,
		});
		if (!size) throw new Error("無法讀取影片尺寸");

		const codec = await getFirstEncodableVideoCodec(["avc", "vp9", "av1"], {
			width: size.width,
			height: size.height,
		});
		if (!codec) throw new Error("瀏覽器無法編碼影片(不支援 WebCodecs 編碼)");

		const target = writable
			? new StreamTarget(
					writable as unknown as WritableStream<{
						type: "write";
						data: Uint8Array;
						position: number;
					}>,
					{ chunked: true },
				)
			: new BufferTarget();
		const output = new Output({ format: new Mp4OutputFormat(), target });

		const conversion = await Conversion.init({
			input,
			output,
			// 從 0 開始算,不要把第一格的時間戳平移掉,否則和原始檔對不上
			trim: { start: 0 },
			video: {
				width: size.width,
				height: size.height,
				fit: "fill",
				codec,
				bitrate: QUALITY_MEDIUM,
				keyFrameInterval: PROXY_KEYFRAME_INTERVAL_SECONDS,
				// 旋轉直接畫進畫面,代理檔的尺寸就是畫面上看到的尺寸
				allowRotationMetadata: false,
				forceTranscode: true,
			},
			audio: { discard: true },
			showWarnings: false,
		});
		if (!conversion.isValid) {
			throw new Error("這個影片無法建立代理檔");
		}

		const abort = () => {
			void conversion.cancel();
		};
		signal?.addEventListener("abort", abort, { once: true });
		conversion.onProgress = (progress) => onProgress?.(progress);
		try {
			await conversion.execute();
		} catch (error) {
			if (signal?.aborted) throw new ProxyCancelledError();
			throw error;
		} finally {
			signal?.removeEventListener("abort", abort);
		}
		if (signal?.aborted) throw new ProxyCancelledError();

		if (target instanceof BufferTarget) {
			const buffer = target.buffer;
			return buffer ? new Blob([buffer], { type: "video/mp4" }) : null;
		}
		return null;
	} finally {
		input.dispose();
	}
}
