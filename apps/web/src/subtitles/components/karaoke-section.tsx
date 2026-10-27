import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/editor/use-editor";

const SWEEP_OPTIONS = [
	{ value: 1, label: "填到句尾" },
	{ value: 0.9, label: "90%" },
	{ value: 0.8, label: "80%" },
];

/** 卡拉 OK 填色:選取字幕後,在上方疊一層高亮色,隨時間由左向右填滿 */
export function KaraokeSection() {
	const editor = useEditor();
	const [color, setColor] = useState("#ffd23f");
	const [sweepFraction, setSweepFraction] = useState(1);

	const handleApply = () => {
		const selected = editor.selection.getSelectedElements();
		const texts = editor.timeline
			.getElementsWithTracks({ elements: selected })
			.filter(({ element }) => element.type === "text");
		if (texts.length === 0) {
			toast.error("請先在時間軸選取字幕(可框選整條字幕軌)");
			return;
		}
		const count = editor.timeline.applyKaraoke({
			elements: texts.map(({ track, element }) => ({
				trackId: track.id,
				elementId: element.id,
			})),
			color,
			sweepFraction,
		});
		if (count === 0) {
			toast.error("選取的字幕沒有可以填色的內容");
			return;
		}
		toast.success(`已為 ${count} 句字幕加上填色(可一次復原)`);
	};

	return (
		<div className="flex flex-col gap-2">
			<span className="text-sm font-medium">卡拉 OK 填色</span>
			<p className="text-muted-foreground text-xs leading-relaxed">
				選取字幕(例如匯入 LRC 後框選整條字幕軌),在上方疊一層高亮色,隨每句的時間由左向右填滿。
				原本的字幕是底色。多行的字幕會整塊一起由左向右填。一次復原。
			</p>
			<label className="flex items-center gap-2 text-xs">
				高亮顏色
				<input
					type="color"
					value={color}
					onChange={(event) => setColor(event.target.value)}
					className="h-6 w-10 cursor-pointer"
				/>
			</label>
			<span className="text-muted-foreground text-xs">填色佔整句的比例</span>
			<div className="flex flex-wrap gap-1">
				{SWEEP_OPTIONS.map((option) => (
					<Button
						key={option.value}
						size="sm"
						variant={sweepFraction === option.value ? "default" : "outline"}
						onClick={() => setSweepFraction(option.value)}
					>
						{option.label}
					</Button>
				))}
			</div>
			<Button type="button" variant="outline" onClick={handleApply}>
				對選取的字幕加上填色
			</Button>
		</div>
	);
}
