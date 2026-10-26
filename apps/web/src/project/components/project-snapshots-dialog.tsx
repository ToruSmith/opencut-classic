import { useEffect, useState } from "react";
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
import type { ProjectSnapshotSummary } from "@/services/storage/service";

const dateTimeFormat = new Intl.DateTimeFormat("zh-TW", {
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
});

function formatRelative({ ms, now }: { ms: number; now: number }): string {
	const minutes = Math.floor((now - ms) / 60_000);
	if (minutes < 1) return "剛剛";
	if (minutes < 60) return `${minutes} 分鐘前`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} 小時前`;
	return `${Math.floor(hours / 24)} 天前`;
}

/**
 * 專案的版本紀錄:編輯時每 10 分鐘(內容有變才)自動存一份,最多 20 份。
 * 還原會先把目前狀態也存成一份,所以隨時可以再還原回來。
 */
export function ProjectSnapshotsDialog({
	isOpen,
	onOpenChange,
	projectId,
	projectName,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	projectId: string;
	projectName: string;
}) {
	const editor = useEditor();
	const [snapshots, setSnapshots] = useState<ProjectSnapshotSummary[] | null>(null);
	const [confirmingId, setConfirmingId] = useState<string | null>(null);
	const [isRestoring, setIsRestoring] = useState(false);

	useEffect(() => {
		if (!isOpen) return;
		let cancelled = false;
		setSnapshots(null);
		setConfirmingId(null);
		editor.project
			.listSnapshots({ id: projectId })
			.then((list) => {
				if (!cancelled) setSnapshots(list);
			})
			.catch((error) => {
				console.error("讀取版本紀錄失敗", error);
				if (!cancelled) setSnapshots([]);
			});
		return () => {
			cancelled = true;
		};
	}, [editor, isOpen, projectId]);

	const handleRestore = async (snapshotId: string) => {
		if (confirmingId !== snapshotId) {
			setConfirmingId(snapshotId);
			return;
		}
		setIsRestoring(true);
		try {
			await editor.project.restoreSnapshot({ projectId, snapshotId });
			toast.success("已還原到所選版本", {
				description: "還原前的狀態也存成了一個版本,需要時可以再還原回去。",
			});
			onOpenChange(false);
		} catch (error) {
			toast.error("還原失敗", {
				description: error instanceof Error ? error.message : "請再試一次",
			});
		} finally {
			setIsRestoring(false);
			setConfirmingId(null);
		}
	};

	const now = Date.now();

	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle className="truncate max-w-[350px]">
						版本紀錄:{projectName}
					</DialogTitle>
				</DialogHeader>
				<DialogBody className="flex flex-col gap-3">
					<p className="text-muted-foreground text-sm">
						編輯時每 10 分鐘自動保存一份時間軸(只在內容有變時),最多保留 20 份。
						版本只包含時間軸與設定,不含素材檔;瀏覽器資料被清除時版本也會一起消失,
						重要專案請另外「匯出備份」。
					</p>
					{snapshots === null ? (
						<p className="text-muted-foreground text-sm">讀取中…</p>
					) : snapshots.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							還沒有版本。開啟專案編輯一段時間後就會出現。
						</p>
					) : (
						<ul className="flex max-h-80 flex-col divide-y overflow-y-auto rounded-md border">
							{snapshots.map((snapshot) => (
								<li
									key={snapshot.id}
									className="flex items-center justify-between gap-3 px-3 py-2"
								>
									<div className="flex min-w-0 flex-col">
										<span className="text-sm font-medium">
											{dateTimeFormat.format(snapshot.createdAt)}
										</span>
										<span className="text-muted-foreground text-xs">
											{formatRelative({ ms: snapshot.createdAt, now })}
										</span>
									</div>
									<Button
										size="sm"
										variant={confirmingId === snapshot.id ? "destructive" : "outline"}
										disabled={isRestoring}
										onClick={() => void handleRestore(snapshot.id)}
									>
										{confirmingId === snapshot.id ? "確定還原?" : "還原"}
									</Button>
								</li>
							))}
						</ul>
					)}
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						關閉
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
