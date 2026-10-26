import { describe, expect, test } from "bun:test";
import {
	collectMatchingFiles,
	FolderScanCancelledError,
	type FolderDirectoryHandleLike,
	type FolderFileHandleLike,
} from "../relink-folder";

function fileHandle(name: string, size = 1): FolderFileHandleLike & { reads: number } {
	const handle = {
		kind: "file" as const,
		name,
		reads: 0,
		async getFile() {
			handle.reads += 1;
			return new File([new Uint8Array(size)], name);
		},
	};
	return handle;
}

function dir(
	name: string,
	entries: Array<FolderFileHandleLike | FolderDirectoryHandleLike>,
): FolderDirectoryHandleLike {
	return {
		kind: "directory",
		name,
		async *values() {
			for (const entry of entries) yield entry;
		},
	};
}

describe("collectMatchingFiles", () => {
	test("找得到子資料夾裡的檔案,只讀檔名符合的", async () => {
		const wanted = fileHandle("a.mp4", 3);
		const other = fileHandle("other.mp4");
		const nested = fileHandle("b.wav", 2);
		const root = dir("root", [wanted, other, dir("sub", [nested])]);

		const files = await collectMatchingFiles({
			directory: root,
			names: new Set(["a.mp4", "b.wav"]),
		});
		expect(files.map((f) => [f.name, f.size])).toEqual([
			["a.mp4", 3],
			["b.wav", 2],
		]);
		expect(other.reads).toBe(0);
	});

	test("略過隱藏資料夾與 node_modules", async () => {
		const hidden = fileHandle("a.mp4");
		const root = dir("root", [
			dir(".cache", [hidden]),
			dir("node_modules", [fileHandle("a.mp4")]),
		]);
		const files = await collectMatchingFiles({
			directory: root,
			names: new Set(["a.mp4"]),
		});
		expect(files).toEqual([]);
		expect(hidden.reads).toBe(0);
	});

	test("讀檔失敗的略過,不影響其他檔案", async () => {
		const broken: FolderFileHandleLike = {
			kind: "file",
			name: "a.mp4",
			getFile: async () => {
				throw new Error("busy");
			},
		};
		const root = dir("root", [broken, fileHandle("b.mp4")]);
		const files = await collectMatchingFiles({
			directory: root,
			names: new Set(["a.mp4", "b.mp4"]),
		});
		expect(files.map((f) => f.name)).toEqual(["b.mp4"]);
	});

	test("可以取消", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			collectMatchingFiles({
				directory: dir("root", [fileHandle("a.mp4")]),
				names: new Set(["a.mp4"]),
				signal: controller.signal,
			}),
		).rejects.toBeInstanceOf(FolderScanCancelledError);
	});

	test("回報進度", async () => {
		const progress: number[] = [];
		await collectMatchingFiles({
			directory: dir("root", [dir("a", []), dir("b", [])]),
			names: new Set(),
			onProgress: ({ folders }) => progress.push(folders),
		});
		expect(progress).toEqual([1, 2, 3]);
	});
});
