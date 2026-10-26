import { buildLutTexture, isStoredLut, type LutTextureLayout, type StoredLut } from "./cube";
import { getBuiltinLut } from "./presets";

/**
 * 目前專案的 LUT(記憶體)。專案載入或匯入 LUT 時登記,渲染時用 id 查。
 * 貼圖像素第一次用到才展開,之後快取。
 */

const LUT_TEXTURE_PREFIX = "lut:";

const stored = new Map<string, StoredLut>();
const textures = new Map<string, LutTextureLayout>();

export function registerLuts({ luts }: { luts: Record<string, unknown> | undefined }): void {
	for (const [id, lut] of Object.entries(luts ?? {})) {
		if (!isStoredLut(lut)) {
			console.warn("略過格式不對的 LUT", id);
			continue;
		}
		if (stored.get(id)?.data === lut.data) continue;
		stored.set(id, lut);
		textures.delete(id);
	}
}

/** 專案匯入的 LUT,或內建風格(id 以 builtin- 開頭) */
export function getStoredLut({ id }: { id: string }): StoredLut | null {
	return stored.get(id) ?? getBuiltinLut({ id });
}

export function getLutTexture({ id }: { id: string }): LutTextureLayout | null {
	const cached = textures.get(id);
	if (cached) return cached;
	const lut = getStoredLut({ id });
	if (!lut) return null;
	try {
		const texture = buildLutTexture({ lut });
		textures.set(id, texture);
		return texture;
	} catch (error) {
		console.warn("LUT 資料損毀", id, error);
		return null;
	}
}

/** 效果 pass 的 textureId;frame-descriptor 用它把 LUT 當成貼圖上傳 */
export function lutTextureId({ id }: { id: string }): string {
	return `${LUT_TEXTURE_PREFIX}${id}`;
}

export function getLutTextureByTextureId({
	textureId,
}: {
	textureId: string;
}): LutTextureLayout | null {
	if (!textureId.startsWith(LUT_TEXTURE_PREFIX)) return null;
	return getLutTexture({ id: textureId.slice(LUT_TEXTURE_PREFIX.length) });
}
