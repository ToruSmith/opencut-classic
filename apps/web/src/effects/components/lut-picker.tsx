import { useRef, useState } from "react";
import { toast } from "sonner";
import { useEditor } from "@/editor/use-editor";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { LutParseError } from "@/lut/cube";
import { isBuiltinLutId, LUT_PRESETS } from "@/lut/presets";

/**
 * LUT 調色效果的風格選擇器:內建風格、這個專案匯入過的 .cube,或匯入新的 .cube。
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

	const imported = Object.entries(luts ?? {});
	const isKnown =
		value !== "" &&
		(isBuiltinLutId({ id: value })
			? LUT_PRESETS.some((preset) => preset.id === value)
			: Boolean(luts?.[value]));

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
			<Select value={isKnown ? value : undefined} onValueChange={onChange}>
				<SelectTrigger className="w-full">
					<SelectValue placeholder="選擇風格" />
				</SelectTrigger>
				<SelectContent>
					<SelectGroup>
						<SelectLabel>內建風格</SelectLabel>
						{LUT_PRESETS.map((preset) => (
							<SelectItem key={preset.id} value={preset.id}>
								{preset.name}
							</SelectItem>
						))}
					</SelectGroup>
					{imported.length > 0 && (
						<>
							<SelectSeparator />
							<SelectGroup>
								<SelectLabel>已匯入的 .cube</SelectLabel>
								{imported.map(([id, lut]) => (
									<SelectItem key={id} value={id}>
										{lut.name}
									</SelectItem>
								))}
							</SelectGroup>
						</>
					)}
				</SelectContent>
			</Select>
			{value !== "" && !isKnown && (
				<p className="text-xs text-destructive">
					找不到這個 LUT 的資料(可能來自別的專案),請重新匯入 .cube 檔或改選內建風格。
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
			<p className="text-xs text-muted-foreground">
				LUT 是「調色預設檔」,其他剪輯或調色軟體做好的顏色風格可以存成 .cube 帶過來用。
			</p>
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
