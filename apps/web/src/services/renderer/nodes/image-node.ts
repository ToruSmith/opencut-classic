import { touchLru, trimLru } from "@/services/cache-policy";
import {
	VisualNode,
	type ResolvedVisualSourceNodeState,
	type VisualNodeParams,
} from "./visual-node";

export interface ImageNodeParams extends VisualNodeParams {
	url: string;
	maxSourceSize?: number;
}

export interface CachedImageSource {
	source: HTMLImageElement | OffscreenCanvas;
	width: number;
	height: number;
}

/**
 * 最多同時保留的圖片數(依最近使用排序)。預覽的圖最大 2048 px,
 * 一張解碼後約 16 MB,沒有上限時整條時間軸的圖片都會常駐。
 * 被淘汰的圖下次用到時重新載入(正在畫的那一格不受影響,畫面持有自己的參照)。
 */
const MAX_CACHED_IMAGES = 48;
const imageSourceCache = new Map<string, Promise<CachedImageSource>>();

/** 目前快取了幾張圖(自動驗收用,確認不在時間範圍內的圖沒有被載入、也守住上限) */
export function getImageCacheSize(): number {
	return imageSourceCache.size;
}

export function loadImageSource({
	url,
	maxSourceSize,
}: {
	url: string;
	maxSourceSize?: number;
}): Promise<CachedImageSource> {
	const cacheKey = `${url}::${maxSourceSize ?? "full"}`;

	const cached = touchLru({ map: imageSourceCache, key: cacheKey });
	if (cached) return cached;

	const promise = (async (): Promise<CachedImageSource> => {
		const image = new Image();

		await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error("Image load failed"));
			image.src = url;
		});

		const naturalWidth = image.naturalWidth;
		const naturalHeight = image.naturalHeight;
		const exceedsLimit =
			maxSourceSize &&
			(naturalWidth > maxSourceSize || naturalHeight > maxSourceSize);

		if (exceedsLimit) {
			const scale = Math.min(
				maxSourceSize / naturalWidth,
				maxSourceSize / naturalHeight,
			);
			const scaledWidth = Math.round(naturalWidth * scale);
			const scaledHeight = Math.round(naturalHeight * scale);

			const offscreen = new OffscreenCanvas(scaledWidth, scaledHeight);
			const ctx = offscreen.getContext("2d");

			if (ctx) {
				ctx.drawImage(image, 0, 0, scaledWidth, scaledHeight);
				return { source: offscreen, width: scaledWidth, height: scaledHeight };
			}
		}

		return { source: image, width: naturalWidth, height: naturalHeight };
	})();

	imageSourceCache.set(cacheKey, promise);
	// 載入失敗(例如網址已被釋放)不要把失敗結果留在快取裡
	promise.catch(() => {
		if (imageSourceCache.get(cacheKey) === promise) {
			imageSourceCache.delete(cacheKey);
		}
	});
	trimLru({ map: imageSourceCache, max: MAX_CACHED_IMAGES });
	return promise;
}

export class ImageNode extends VisualNode<
	ImageNodeParams,
	ResolvedVisualSourceNodeState
> {}
