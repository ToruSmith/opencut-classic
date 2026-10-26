/**
 * 「選擇資料夾」重新連結素材:掃描使用者選的資料夾(含子資料夾),
 * 找出檔名和缺少的素材相同的檔案。
 *
 * - 只用檔名過濾,只有檔名符合的才呼叫 getFile()(取得大小與內容的參照),
 *   所以就算資料夾裡有上萬個檔案也很快;不會讀檔案內容。
 * - 略過隱藏資料夾(. 開頭)與常見的大型程式資料夾,避免誤選整顆硬碟時掃很久。
 * - 可以用 AbortSignal 取消;每掃完一個資料夾回報一次進度。
 *
 * 只依賴 handle 的最小介面,單元測試用假物件就能跑。
 */

export interface FolderFileHandleLike {
	kind: "file";
	name: string;
	getFile(): Promise<File>;
}

export interface FolderDirectoryHandleLike {
	kind: "directory";
	name: string;
	values(): AsyncIterable<FolderFileHandleLike | FolderDirectoryHandleLike>;
}

const SKIPPED_DIRECTORIES = new Set([
	"node_modules",
	"$RECYCLE.BIN",
	"System Volume Information",
]);
const MAX_DEPTH = 12;

export class FolderScanCancelledError extends Error {
	constructor() {
		super("已取消掃描資料夾");
		this.name = "FolderScanCancelledError";
	}
}

export async function collectMatchingFiles({
	directory,
	names,
	signal,
	onProgress,
}: {
	directory: FolderDirectoryHandleLike;
	/** 要找的檔名(缺少的素材的名稱) */
	names: ReadonlySet<string>;
	signal?: AbortSignal;
	onProgress?: (progress: { folders: number; found: number }) => void;
}): Promise<File[]> {
	const found: File[] = [];
	let folders = 0;

	const walk = async (dir: FolderDirectoryHandleLike, depth: number) => {
		if (signal?.aborted) throw new FolderScanCancelledError();
		const subdirectories: FolderDirectoryHandleLike[] = [];
		for await (const entry of dir.values()) {
			if (signal?.aborted) throw new FolderScanCancelledError();
			if (entry.kind === "directory") {
				if (
					depth < MAX_DEPTH &&
					!entry.name.startsWith(".") &&
					!SKIPPED_DIRECTORIES.has(entry.name)
				) {
					subdirectories.push(entry);
				}
				continue;
			}
			if (!names.has(entry.name)) continue;
			try {
				found.push(await entry.getFile());
			} catch {
				// 沒有權限或檔案正在被使用:略過,其他檔案照常處理
			}
		}
		folders += 1;
		onProgress?.({ folders, found: found.length });
		for (const subdirectory of subdirectories) {
			await walk(subdirectory, depth + 1);
		}
	};

	await walk(directory, 0);
	return found;
}

type DirectoryPicker = (options?: {
	mode?: "read" | "readwrite";
	id?: string;
}) => Promise<FolderDirectoryHandleLike>;

/** 瀏覽器是否支援選資料夾(目前只有 Chrome / Edge 等 Chromium 系) */
export function canPickFolder(): boolean {
	return (
		typeof window !== "undefined" &&
		typeof (window as unknown as { showDirectoryPicker?: unknown })
			.showDirectoryPicker === "function"
	);
}

/** 讓使用者選資料夾;取消時回傳 null */
export async function pickFolder(): Promise<FolderDirectoryHandleLike | null> {
	const picker = (window as unknown as { showDirectoryPicker?: DirectoryPicker })
		.showDirectoryPicker;
	if (!picker) return null;
	try {
		// id 讓瀏覽器記住上次選的位置,下次直接從那裡開始
		return await picker.call(window, { mode: "read", id: "opencut-relink" });
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") return null;
		throw error;
	}
}
