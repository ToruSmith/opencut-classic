import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useEditor } from "@/editor/use-editor";
import type { MediaAssetData } from "@/services/storage/types";
import {
	FolderScanCancelledError,
	canPickFolder,
	collectMatchingFiles,
	pickFolder,
} from "@/services/storage/relink-folder";

function formatSize({ bytes }: { bytes: number }): string {
	if (!(bytes > 0)) return "";
	if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
	if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
	return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * 重新連結素材:列出專案裡「有清單、沒有檔案」的素材,讓使用者一次選取多個本機檔案,
 * 依檔名與大小自動對回去。可以分好幾次選。
 */
export function RelinkMediaDialog({
	isOpen,
	onOpenChange,
	projectId,
	projectName,
	onRelinked,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	projectId: string;
	projectName: string;
	onRelinked?: () => void;
}) {
	const editor = useEditor();
	const inputRef = useRef<HTMLInputElement>(null);
	const [missing, setMissing] = useState<MediaAssetData[] | null>(null);
	const [isLinking, setIsLinking] = useState(false);
	const [scanStatus, setScanStatus] = useState<string | null>(null);
	const scanControllerRef = useRef<AbortController | null>(null);
	const supportsFolder = canPickFolder();

	useEffect(() => {
		if (!isOpen) return;
		let cancelled = false;
		setMissing(null);
		editor.project
			.listMissingMedia({ id: projectId })
			.then((list) => {
				if (!cancelled) setMissing(list);
			})
			.catch((error) => {
				console.error("讀取素材清單失敗", error);
				if (!cancelled) setMissing([]);
			});
		return () => {
			cancelled = true;
		};
	}, [editor, isOpen, projectId]);

	// 關閉視窗時停止還在進行的掃描
	useEffect(() => {
		if (!isOpen) scanControllerRef.current?.abort();
	}, [isOpen]);

	const handleFolder = async () => {
		if (!missing || missing.length === 0) return;
		let directory;
		try {
			directory = await pickFolder();
		} catch (error) {
			toast.error("無法開啟資料夾", {
				description: error instanceof Error ? error.message : undefined,
			});
			return;
		}
		if (!directory) return;

		const controller = new AbortController();
		scanControllerRef.current = controller;
		setScanStatus("掃描資料夾中…");
		let files: File[];
		try {
			files = await collectMatchingFiles({
				directory,
				names: new Set(missing.map((item) => item.name)),
				signal: controller.signal,
				onProgress: ({ folders, found }) =>
					setScanStatus(`已掃描 ${folders} 個資料夾,找到 ${found} 個同名檔案…`),
			});
		} catch (error) {
			if (!(error instanceof FolderScanCancelledError)) {
				toast.error("掃描資料夾失敗", {
					description: error instanceof Error ? error.message : undefined,
				});
			}
			return;
		} finally {
			scanControllerRef.current = null;
			setScanStatus(null);
		}

		if (files.length === 0) {
			toast.error("這個資料夾(含子資料夾)裡找不到同名的檔案", {
				description: "請確認選對資料夾,而且素材沒有改名。",
			});
			return;
		}
		await linkFiles(files);
	};

	const handleFiles = async (fileList: FileList | null) => {
		const files = fileList ? Array.from(fileList) : [];
		if (inputRef.current) inputRef.current.value = "";
		if (files.length === 0) return;
		await linkFiles(files);
	};

	const linkFiles = async (files: File[]) => {
		setIsLinking(true);
		try {
			const { linked, remaining } = await editor.project.relinkMedia({
				id: projectId,
				files,
			});
			setMissing(remaining);
			if (linked > 0) onRelinked?.();
			if (linked === 0) {
				toast.error("選的檔案沒有對上任何素材", {
					description: "請確認檔名和原本上傳時一樣。",
				});
			} else if (remaining.length === 0) {
				toast.success(`已連結 ${linked} 個素材,全部完成`);
				onOpenChange(false);
			} else {
				toast.success(`已連結 ${linked} 個素材,還缺 ${remaining.length} 個`);
			}
		} catch (error) {
			toast.error("連結素材失敗", {
				description: error instanceof Error ? error.message : undefined,
			});
		} finally {
			setIsLinking(false);
		}
	};

	const isBusy = isLinking || scanStatus !== null;

	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle className="truncate max-w-[350px]">
						重新連結素材:{projectName}
					</DialogTitle>
				</DialogHeader>
				<DialogBody className="flex flex-col gap-3">
					{missing === null ? (
						<p className="text-muted-foreground text-sm">讀取中…</p>
					) : missing.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							這個專案沒有缺少的素材。
						</p>
					) : (
						<>
							<p className="text-muted-foreground text-sm">
								下面的素材只有記錄、沒有檔案。
								{supportsFolder
									? "按「選擇資料夾」選素材所在的資料夾(會一併找子資料夾),或按「選取檔案」自己挑,"
									: "按「選取檔案」並一次選好它們(可以多選,也可以分幾次),"}
								會依檔名與大小自動對上。檔案會複製一份到瀏覽器裡。
							</p>
							<ul className="flex max-h-64 flex-col divide-y overflow-y-auto rounded-md border text-sm">
								{missing.map((item) => (
									<li
										key={item.id}
										className="flex items-center justify-between gap-3 px-3 py-1.5"
									>
										<span className="truncate">{item.name}</span>
										<span className="text-muted-foreground shrink-0 text-xs">
											{formatSize({ bytes: item.size })}
										</span>
									</li>
								))}
							</ul>
						</>
					)}
					{scanStatus && (
						<div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
							<span className="text-muted-foreground">{scanStatus}</span>
							<Button
								size="sm"
								variant="outline"
								onClick={() => scanControllerRef.current?.abort()}
							>
								取消
							</Button>
						</div>
					)}
					{isLinking && (
						<p className="text-muted-foreground text-sm">
							正在把素材複製進瀏覽器,檔案大的話需要一點時間…
						</p>
					)}
					<input
						ref={inputRef}
						type="file"
						multiple
						accept="image/*,video/*,audio/*"
						className="hidden"
						onChange={(event) => void handleFiles(event.target.files)}
					/>
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{missing && missing.length > 0 ? "稍後再說" : "關閉"}
					</Button>
					{missing && missing.length > 0 && (
						<>
							<Button
								variant={supportsFolder ? "outline" : "default"}
								disabled={isBusy}
								onClick={() => inputRef.current?.click()}
							>
								選取檔案
							</Button>
							{supportsFolder && (
								<Button disabled={isBusy} onClick={() => void handleFolder()}>
									{isBusy ? "處理中…" : "選擇資料夾"}
								</Button>
							)}
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
