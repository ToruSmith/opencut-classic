/**
 * 專案版本快照的規則(純函式,有測試)。
 *
 * 快照只存專案內容(時間軸、設定),不存素材檔:素材本來就在 OPFS,
 * 快照很小(通常幾十 KB),可以多留幾份。它防的是「改壞了、復原紀錄又已經消失」,
 * 不防瀏覽器清除資料——那個要靠匯出備份檔。
 */

/** 同一個專案兩次自動快照至少間隔 */
export const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;
/** 每個專案最多保留幾份 */
export const MAX_SNAPSHOTS_PER_PROJECT = 20;
/** 超過這麼久沒匯出備份就提醒 */
export const BACKUP_REMINDER_MS = 7 * 24 * 60 * 60 * 1000;

export interface SnapshotInfo {
	id: string;
	projectId: string;
	createdAt: number;
}

export function snapshotId({
	projectId,
	createdAt,
}: {
	projectId: string;
	createdAt: number;
}): string {
	return `${projectId}:${createdAt}`;
}

export function shouldTakeSnapshot({
	lastSnapshotAt,
	now,
	lastContent,
	content,
}: {
	lastSnapshotAt: number | null;
	now: number;
	/** 上一份快照的內容(序列化後的字串);沒有就是 null */
	lastContent: string | null;
	content: string;
}): boolean {
	if (lastContent !== null && lastContent === content) return false;
	if (lastSnapshotAt === null) return true;
	return now - lastSnapshotAt >= SNAPSHOT_INTERVAL_MS;
}

/** 回傳要刪掉的快照(保留最新的 max 份) */
export function snapshotsToPrune({
	snapshots,
	max = MAX_SNAPSHOTS_PER_PROJECT,
}: {
	snapshots: ReadonlyArray<SnapshotInfo>;
	max?: number;
}): SnapshotInfo[] {
	const sorted = [...snapshots].sort((a, b) => b.createdAt - a.createdAt);
	return sorted.slice(Math.max(0, max));
}

/**
 * 是否該提醒備份:專案在上次備份之後有修改,而且距離上次備份(或專案建立)超過 7 天。
 */
export function needsBackupReminder({
	lastBackupAt,
	createdAt,
	updatedAt,
	now,
}: {
	lastBackupAt: number | null;
	createdAt: number;
	updatedAt: number;
	now: number;
}): boolean {
	const reference = lastBackupAt ?? createdAt;
	if (lastBackupAt !== null && updatedAt <= lastBackupAt) return false;
	return now - reference >= BACKUP_REMINDER_MS;
}
