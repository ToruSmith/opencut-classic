import { describe, expect, test } from "bun:test";
import { planProjectIdRepair, stripImportedSuffix } from "../project-repair";

describe("planProjectIdRepair", () => {
	test("key 和 metadata.id 一致時不需修復", () => {
		expect(
			planProjectIdRepair({
				recordKey: "a",
				metadataId: "a",
				existingKeys: new Set(["a"]),
				originalHasMedia: true,
			}),
		).toBeNull();
	});

	test("同一個瀏覽器匯入:另存到新 ID,原專案(還有素材)恢復", () => {
		expect(
			planProjectIdRepair({
				recordKey: "old",
				metadataId: "new",
				existingKeys: new Set(["old"]),
				originalHasMedia: true,
			}),
		).toEqual({ copyToId: "new", original: "restore" });
	});

	test("別的瀏覽器的備份:原 key 沒有素材 → 刪掉那筆", () => {
		expect(
			planProjectIdRepair({
				recordKey: "old",
				metadataId: "new",
				existingKeys: new Set(["old"]),
				originalHasMedia: false,
			}),
		).toEqual({ copyToId: "new", original: "remove" });
	});

	test("新 ID 已經存在就不再複製", () => {
		expect(
			planProjectIdRepair({
				recordKey: "old",
				metadataId: "new",
				existingKeys: new Set(["old", "new"]),
				originalHasMedia: false,
			})?.copyToId,
		).toBeNull();
	});
});

describe("stripImportedSuffix", () => {
	test("拿掉結尾的(匯入)", () => {
		expect(stripImportedSuffix({ name: "旅遊 (匯入)" })).toBe("旅遊");
		expect(stripImportedSuffix({ name: "旅遊" })).toBe("旅遊");
	});
});
