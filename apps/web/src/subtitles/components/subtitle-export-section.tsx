import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/editor/use-editor";
import { formatLrc, formatSrt } from "@/subtitles/serialize";
import type { TimelineElement } from "@/timeline";
import type { CaptionChunk } from "@/transcription/types";
import { downloadBlob } from "@/utils/browser";
import { mediaTimeToSeconds } from "@/wasm";

/**
 * 匯出字幕:把時間軸上的文字片段寫成 SRT / LRC。
 * 有選取文字片段時只匯出選取的;沒選時匯出所有文字片段。
 * 用途:在這裡用節拍 / 點拍對好時間,交給 kinetic-lyric-console 上動態效果,再把綠幕輸出放回來去背疊上。
 */
export function SubtitleExportSection() {
	const editor = useEditor();

	const collect = (): CaptionChunk[] => {
		const selected = editor.timeline
			.getElementsWithTracks({ elements: editor.selection.getSelectedElements() })
			.map(({ element }) => element)
			.filter((element) => element.type === "text");
		const source =
			selected.length > 0
				? selected
				: [editor.scenes.getActiveScene().tracks.main, ...editor.scenes.getActiveScene().tracks.overlay]
						.flatMap((track): TimelineElement[] => [...track.elements])
						.filter((element) => element.type === "text");
		return source.map((element) => ({
			text: String(element.params.content ?? ""),
			startTime: mediaTimeToSeconds({ time: element.startTime }),
			duration: mediaTimeToSeconds({ time: element.duration }),
		}));
	};

	const exportAs = ({ format }: { format: "srt" | "lrc" }) => {
		const cues = collect().filter((cue) => cue.text.trim().length > 0);
		if (cues.length === 0) {
			toast.error("時間軸上沒有文字片段可以匯出");
			return;
		}
		const body = format === "srt" ? formatSrt({ cues }) : formatLrc({ cues });
		const name = editor.project.getActive().metadata.name || "字幕";
		downloadBlob({
			blob: new Blob([body], { type: "text/plain;charset=utf-8" }),
			filename: `${name}.${format}`,
		});
		toast.success(`已匯出 ${cues.length} 句字幕`);
	};

	return (
		<div className="flex flex-col gap-2">
			<span className="text-sm font-medium">匯出字幕</span>
			<p className="text-muted-foreground text-xs leading-relaxed">
				把時間軸上的字幕寫成檔案(有選取時只匯出選取的)。可在這裡用節拍、點拍對好時間,交給 kinetic-lyric-console
				做動態字幕,再把它輸出的綠幕影片放回時間軸,加「去背(綠幕)」疊上。
			</p>
			<div className="flex gap-1">
				<Button type="button" size="sm" variant="outline" onClick={() => exportAs({ format: "srt" })}>
					匯出 SRT
				</Button>
				<Button type="button" size="sm" variant="outline" onClick={() => exportAs({ format: "lrc" })}>
					匯出 LRC
				</Button>
			</div>
		</div>
	);
}
