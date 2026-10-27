/**
 * 找出「OPFS 裡有檔案、但沒有素材記錄」的孤兒檔案。純函式,有測試。
 *
 * 刪除素材(以及復原「匯入素材」)時只移除記錄、檔案先留著,這樣「復原 / 重做」可以從儲存空間重新讀到一份新的檔案
 * (OPFS 的 File 在檔案被刪或被改寫後會失效,丟 NotReadableError)。
 * 這些留下來的檔案在下次開啟專案時清掉(那時復原紀錄已經不存在了)。
 *
 * 保守規則:完全沒有任何素材記錄時不清理。那更可能是記錄資料庫被清掉或損毀,
 * 檔案還有機會靠備份 / 重新連結救回,不該在這時候刪。
 */
export function findOrphanMediaFileKeys({
	fileKeys,
	metadataKeys,
}: {
	fileKeys: string[];
	metadataKeys: string[];
}): string[] {
	if (metadataKeys.length === 0) return [];
	const known = new Set(metadataKeys);
	return fileKeys.filter((key) => !known.has(key));
}
