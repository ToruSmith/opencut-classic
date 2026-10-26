import { describe, expect, test } from "bun:test";
import {
	BACKUP_REMINDER_MS,
	SNAPSHOT_INTERVAL_MS,
	needsBackupReminder,
	shouldTakeSnapshot,
	snapshotsToPrune,
} from "../snapshot-policy";

describe("shouldTakeSnapshot", () => {
	test("第一次一定要存", () => {
		expect(
			shouldTakeSnapshot({ lastSnapshotAt: null, now: 0, lastContent: null, content: "a" }),
		).toBe(true);
	});

	test("內容沒變就不存", () => {
		expect(
			shouldTakeSnapshot({
				lastSnapshotAt: 0,
				now: SNAPSHOT_INTERVAL_MS * 10,
				lastContent: "a",
				content: "a",
			}),
		).toBe(false);
	});

	test("間隔不夠不存,夠了才存", () => {
		const base = { lastSnapshotAt: 1000, lastContent: "a", content: "b" };
		expect(shouldTakeSnapshot({ ...base, now: 1000 + SNAPSHOT_INTERVAL_MS - 1 })).toBe(false);
		expect(shouldTakeSnapshot({ ...base, now: 1000 + SNAPSHOT_INTERVAL_MS })).toBe(true);
	});
});

describe("snapshotsToPrune", () => {
	test("保留最新的幾份,刪掉舊的", () => {
		const snapshots = [3, 1, 4, 2].map((createdAt) => ({
			id: `p:${createdAt}`,
			projectId: "p",
			createdAt,
		}));
		expect(snapshotsToPrune({ snapshots, max: 2 }).map((s) => s.createdAt)).toEqual([2, 1]);
		expect(snapshotsToPrune({ snapshots, max: 10 })).toEqual([]);
	});
});

describe("needsBackupReminder", () => {
	const day = 24 * 60 * 60 * 1000;

	test("從沒備份、建立超過 7 天就提醒", () => {
		expect(
			needsBackupReminder({ lastBackupAt: null, createdAt: 0, updatedAt: day, now: BACKUP_REMINDER_MS }),
		).toBe(true);
		expect(
			needsBackupReminder({ lastBackupAt: null, createdAt: 0, updatedAt: day, now: day }),
		).toBe(false);
	});

	test("備份之後沒再修改就不提醒", () => {
		expect(
			needsBackupReminder({ lastBackupAt: 5 * day, createdAt: 0, updatedAt: 4 * day, now: 100 * day }),
		).toBe(false);
	});

	test("備份之後有修改、又過了 7 天才提醒", () => {
		const base = { lastBackupAt: 10 * day, createdAt: 0, updatedAt: 11 * day };
		expect(needsBackupReminder({ ...base, now: 12 * day })).toBe(false);
		expect(needsBackupReminder({ ...base, now: 10 * day + BACKUP_REMINDER_MS })).toBe(true);
	});
});
