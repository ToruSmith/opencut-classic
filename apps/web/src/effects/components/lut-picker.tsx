import { useRef, useState } from "react";
import { toast } from "sonner";
import { useEditor } from "@/editor/use-editor";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { LutParseError } from "@/lut/cube";

/**
 * LUT 調色效果的檔案選擇器:匯入 .cube,或從這個專案已匯入的 LUT 中挑一個。
 * 選好後寫入效果的 `lut` 參數(LUT 的 id)。
 */
export function LutPicker({
	value,
	onChange,
}: {
	value: string;
	onChange: (id: string) => void;
}) {
	const editor = useEditor();
	const luts = useEditor((e) => e.project.getActiveOrNull()?.luts);
	const inputRef = useRef<HTMLInputElement>(null);
	const [isImporting, setIsImporting] = useState(false);

	const entries = Object.entries(luts ?? {});
	const hasCurrent = value !== "" && Boolean(luts?.[value]);

	const handleFile = async (file: File | undefined) => {
		if (!file) return;
		setIsImporting(true);
		try {
			const id = await editor.project.addLutFromFile({ file });
			onChange(id);
		} catch (error) {
			toast.error("無法讀取 LUT", {
				description:
					error instanceof LutParseError ? error.message : "請確認是 3D LUT 的 .cube 檔",
			});
			if (!(error instanceof LutParseError)) console.error(error);
		} finally {
			setIsImporting(false);
			if (inputRef.current) inputRef.current.value = "";
		}
	};

	return (
		<div className="flex flex-col gap-2">
			{entries.length > 0 && (
				<Select value={hasCurrent ? value : undefined} onValueChange={onChange}>
					<SelectTrigger className="w-full">
						<SelectValue placeholder="選擇已匯入的 LUT" />
					</SelectTrigger>
					<SelectContent>
						{entries.map(([id, lut]) => (
							<SelectItem key={id} value={id}>
								{lut.name} ({lut.size}³)
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			)}
			{value !== "" && !hasCurrent && (
				<p className="text-xs text-destructive">
					找不到這個 LUT 的資料(可能來自別的專案),請重新匯入 .cube 檔。
				</p>
			)}
			<Button
				variant="secondary"
				size="sm"
				disabled={isImporting}
				onClick={() => inputRef.current?.click()}
			>
				{isImporting ? "讀取中…" : "匯入 .cube 檔…"}
			</Button>
			<input
				ref={inputRef}
				type="file"
				accept=".cube"
				className="hidden"
				onChange={(event) => void handleFile(event.target.files?.[0])}
			/>
		</div>
	);
}
