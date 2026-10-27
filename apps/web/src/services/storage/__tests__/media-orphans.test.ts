import { describe, expect, test } from "bun:test";
import { findOrphanMediaFileKeys } from "../media-orphans";

describe("findOrphanMediaFileKeys", () => {
	test("沒有記錄的檔案是孤兒,有記錄的不是", () => {
		expect(
			findOrphanMediaFileKeys({ fileKeys: ["a", "b", "c"], metadataKeys: ["a", "c"] }),
		).toEqual(["b"]);
	});

	test("全部都有記錄時沒有孤兒", () => {
		expect(findOrphanMediaFileKeys({ fileKeys: ["a"], metadataKeys: ["a", "x"] })).toEqual([]);
	});

	test("完全沒有素材記錄時不清理(可能是記錄資料庫遺失)", () => {
		expect(findOrphanMediaFileKeys({ fileKeys: ["a", "b"], metadataKeys: [] })).toEqual([]);
	});

	test("沒有檔案時回傳空陣列", () => {
		expect(findOrphanMediaFileKeys({ fileKeys: [], metadataKeys: ["a"] })).toEqual([]);
	});
});
