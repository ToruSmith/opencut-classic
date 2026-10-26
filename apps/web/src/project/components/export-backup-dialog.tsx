import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/utils/ui";

type BackupMode = "full" | "project";

const MODES: Array<{ mode: BackupMode; title: string; description: string }> = [
	{
		mode: "full",
		title: "完整備份(含素材)",
		description:
			"專案和所有上傳的素材打包成一個檔案。檔案較大,但換電腦、換瀏覽器或清除資料後都能完整還原。",
	},
	{
		mode: "project",
		title: "只存專案(不含素材)",
		description:
			"只存時間軸、字幕、效果等編輯內容,檔案很小。匯入時再選取你電腦裡的原始素材,會依檔名與大小自動對上。原始素材請不要改名或刪除。",
	},
];

/** 匯出備份前選擇要不要包含素材 */
export function ExportBackupDialog({
	isOpen,
	onOpenChange,
	projectNames,
	onConfirm,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	projectNames: string[];
	onConfirm: ({ includeMedia }: { includeMedia: boolean }) => void;
}) {
	const [mode, setMode] = useState<BackupMode>("full");
	const title =
		projectNames.length === 1
			? `匯出備份:${projectNames[0]}`
			: `匯出 ${projectNames.length} 個專案的備份`;

	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle className="truncate max-w-[350px]">{title}</DialogTitle>
				</DialogHeader>
				<DialogBody className="flex flex-col gap-2">
					{MODES.map((option) => (
						<button
							key={option.mode}
							type="button"
							onClick={() => setMode(option.mode)}
							className={cn(
								"flex flex-col gap-1 rounded-md border p-3 text-left transition-colors",
								mode === option.mode
									? "border-foreground bg-accent"
									: "hover:bg-accent/50",
							)}
							aria-pressed={mode === option.mode}
						>
							<span className="text-sm font-medium">{option.title}</span>
							<span className="text-muted-foreground text-xs leading-relaxed">
								{option.description}
							</span>
						</button>
					))}
					<p className="text-muted-foreground text-xs">
						備份存的是時間軸的最終狀態,不包含「復原」的操作紀錄。
					</p>
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						取消
					</Button>
					<Button
						onClick={() => {
							onOpenChange(false);
							onConfirm({ includeMedia: mode === "full" });
						}}
					>
						匯出
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
