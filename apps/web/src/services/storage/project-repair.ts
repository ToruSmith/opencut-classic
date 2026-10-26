/**
 * 修復舊版「匯入備份」留下的錯誤紀錄(純函式,有測試)。
 *
 * 舊版匯入時,備份裡的專案紀錄帶著原專案的 `id`,寫進 IndexedDB 時把新的 key 蓋掉了:
 * 紀錄存在「原專案的 key」底下,但 metadata.id 是新 ID,素材則存在新 ID 底下。
 * 結果:
 * - 列表顯示的是新 ID,打開時用新 ID 找不到 → 編輯器又建立一個空白專案;
 * - 如果原專案在同一個瀏覽器,它的紀錄被蓋掉,從列表消失(素材還在)。
 *
 * 修法:把紀錄複製一份到 metadata.id 底下(匯入的專案);
 * 原 key 底下如果還有素材,代表原專案還在 → 改回原專案(拿掉「(匯入)」字樣);沒有素材就刪掉。
 */

export const IMPORTED_SUFFIX = " (匯入)";

export interface ProjectIdRepair {
	/** 要另存一份到這個 key(= metadata.id);已經存在就是 null */
	copyToId: string | null;
	/** 原 key 底下的紀錄:恢復成原專案,或刪掉 */
	original: "restore" | "remove";
}

export function planProjectIdRepair({
	recordKey,
	metadataId,
	existingKeys,
	originalHasMedia,
}: {
	recordKey: string;
	metadataId: string;
	existingKeys: ReadonlySet<string>;
	originalHasMedia: boolean;
}): ProjectIdRepair | null {
	if (!metadataId || recordKey === metadataId) return null;
	return {
		copyToId: existingKeys.has(metadataId) ? null : metadataId,
		original: originalHasMedia ? "restore" : "remove",
	};
}

/** 恢復原專案時,把匯入時加上的「(匯入)」拿掉 */
export function stripImportedSuffix({ name }: { name: string }): string {
	return name.endsWith(IMPORTED_SUFFIX)
		? name.slice(0, -IMPORTED_SUFFIX.length)
		: name;
}
