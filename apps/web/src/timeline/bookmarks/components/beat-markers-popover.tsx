import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { useEditor } from "@/editor/use-editor";
import type { BeatMode } from "@/media/beat-detect";
import { mediaTimeFromSeconds } from "@/wasm";
import { isBeatBookmark } from "@/timeline/bookmarks/beat-markers";

/**
 * 節拍標記:分析時間軸的聲音,在重音或節拍位置加上橘色書籤。
 * 書籤可以吸附(拖曳片段、移動播放頭都會吸到),拿來對齊剪輯點。
 */
export function BeatMarkersPopover({
	open,
	onOpenChange,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	children: React.ReactNode;
}) {
	const editor = useEditor();
	const beatCount = useEditor(
		(e) => e.scenes.getActiveSceneOrNull()?.bookmarks.filter((bookmark) => isBeatBookmark({ bookmark })).length ?? 0,
	);
	const [mode, setMode] = useState<BeatMode>("onsets");
	const [sensitivity, setSensitivity] = useState(50);
	const [progress, setProgress] = useState<number | null>(null);
	const [summary, setSummary] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	const busy = progress !== null;

	const handleAnalyze = async () => {
		const totalDuration = editor.timeline.getTotalDuration();
		if (totalDuration <= 0) {
			toast.error("時間軸是空的");
			return;
		}
		const controller = new AbortController();
		abortRef.current = controller;
		setProgress(0);
		setSummary(null);
		try {
			const { analyzeTimelineBeats } = await import("@/media/beat-analysis");
			const result = await analyzeTimelineBeats({
				tracks: editor.scenes.getActiveScene().tracks,
				mediaAssets: editor.media.getAssets(),
				totalDuration,
				mode,
				sensitivity: sensitivity / 100,
				onProgress: setProgress,
				signal: controller.signal,
			});
			if (!result) {
				toast.error("時間軸上沒有聲音可以分析");
				return;
			}
			if (result.times.length === 0) {
				toast.error(
					mode === "grid" ? "抓不到穩定的節拍,試試「重音」模式" : "沒有找到重音,試試調高靈敏度",
				);
				return;
			}
			editor.scenes.setBeatBookmarks({
				times: result.times.map((seconds) => mediaTimeFromSeconds({ seconds })),
			});
			const text =
				result.bpm !== undefined
					? `約 ${result.bpm.toFixed(1)} BPM,共 ${result.times.length} 個標記`
					: `共 ${result.times.length} 個標記`;
			setSummary(text);
			toast.success(`已加入節拍標記(${text})`);
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError") return;
			console.error(error);
			toast.error("節拍分析失敗", {
				description: error instanceof Error ? error.message : undefined,
			});
		} finally {
			abortRef.current = null;
			setProgress(null);
		}
	};

	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			{children}
			<PopoverContent className="flex w-72 flex-col gap-3" align="end">
				<div className="text-sm font-medium">節拍標記</div>
				<p className="text-muted-foreground text-xs leading-relaxed">
					分析時間軸的聲音,在節奏點加上橘色書籤,剪片段時會自動吸附。
				</p>
				<div className="flex gap-1">
					<Button
						size="sm"
						variant={mode === "onsets" ? "default" : "outline"}
						disabled={busy}
						onClick={() => setMode("onsets")}
					>
						重音(鼓點)
					</Button>
					<Button
						size="sm"
						variant={mode === "grid" ? "default" : "outline"}
						disabled={busy}
						onClick={() => setMode("grid")}
					>
						節拍格(每一拍)
					</Button>
				</div>
				{mode === "onsets" ? (
					<div className="flex flex-col gap-1">
						<span className="text-muted-foreground text-xs">靈敏度 {sensitivity}</span>
						<Slider
							min={0}
							max={100}
							step={5}
							value={[sensitivity]}
							disabled={busy}
							onValueChange={([value]) => setSensitivity(value ?? 50)}
						/>
					</div>
				) : (
					<p className="text-muted-foreground text-xs">
						估計整首歌的速度後,依固定間隔標出每一拍。適合節奏穩定的音樂。
					</p>
				)}
				<div className="flex gap-2">
					<Button size="sm" disabled={busy} onClick={() => void handleAnalyze()}>
						{busy ? `分析中 ${Math.round((progress ?? 0) * 100)}%` : "分析並加入標記"}
					</Button>
					{busy ? (
						<Button size="sm" variant="outline" onClick={() => abortRef.current?.abort()}>
							取消
						</Button>
					) : (
						<Button
							size="sm"
							variant="outline"
							disabled={beatCount === 0}
							onClick={() => {
								editor.scenes.setBeatBookmarks({ times: [] });
								setSummary(null);
							}}
						>
							清除節拍標記
						</Button>
					)}
				</div>
				{(summary || beatCount > 0) && (
					<p className="text-muted-foreground text-xs">
						{summary ?? `目前有 ${beatCount} 個節拍標記`}
					</p>
				)}
			</PopoverContent>
		</Popover>
	);
}
