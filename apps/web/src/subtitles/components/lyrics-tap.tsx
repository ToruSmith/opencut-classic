import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/editor/use-editor";
import { insertCaptionChunksAsTextTrack } from "@/subtitles/insert";
import { buildCuesFromTaps, splitLyricLines } from "@/subtitles/timed-lines";
import { mediaTimeFromSeconds, mediaTimeToSeconds } from "@/wasm";

/** 人按鍵通常比聽到的點晚一點,預設往前補一點 */
const DEFAULT_LATENCY_SECONDS = 0.1;
const REWIND_SECONDS = 2;

/**
 * 點拍同步歌詞:貼上純歌詞 → 播放 → 每句開始按空白鍵。
 * 時間取自播放頭(editor.playback),按鍵只寫進 ref,
 * 只有「目前第幾句」是本元件的 state,不碰全域狀態;完成時才一次寫入(單一復原步驟)。
 */
export function LyricsTap() {
	const editor = useEditor();
	const [text, setText] = useState("");
	const [latency, setLatency] = useState(DEFAULT_LATENCY_SECONDS);
	const [active, setActive] = useState(false);
	const [tapCount, setTapCount] = useState(0);
	const linesRef = useRef<string[]>([]);
	const tapsRef = useRef<number[]>([]);
	const latencyRef = useRef(latency);
	latencyRef.current = latency;

	const finish = ({ cancel }: { cancel: boolean }) => {
		const lines = linesRef.current;
		const taps = tapsRef.current;
		setActive(false);
		editor.playback.pause();
		if (cancel) return;
		const cues = buildCuesFromTaps({ lines, taps });
		if (cues.length === 0) {
			toast.error("還沒有任何一句打好時間");
			return;
		}
		insertCaptionChunksAsTextTrack({ editor, captions: cues });
		toast.success(`已加入 ${cues.length} 句字幕`);
	};
	const finishRef = useRef(finish);
	finishRef.current = finish;

	const start = () => {
		const lines = splitLyricLines({ input: text });
		if (lines.length === 0) {
			toast.error("請先貼上歌詞(一行一句)");
			return;
		}
		if (editor.timeline.getTotalDuration() <= 0) {
			toast.error("時間軸上要先有音樂,才能播放點拍");
			return;
		}
		linesRef.current = lines;
		tapsRef.current = [];
		setTapCount(0);
		setActive(true);
		if (document.activeElement instanceof HTMLElement) {
			document.activeElement.blur();
		}
		if (!editor.playback.getIsPlaying()) editor.playback.play();
	};

	useEffect(() => {
		if (!active) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			const isTap = event.code === "Space";
			const isBack = event.code === "Backspace";
			if (!isTap && !isBack) return;
			// 在 window 的捕獲階段先處理,避免全域快捷鍵(空白 = 播放 / 暫停)搶走
			event.preventDefault();
			event.stopPropagation();
			if (event.repeat) return;
			const taps = tapsRef.current;
			const lines = linesRef.current;
			if (isTap) {
				if (taps.length > lines.length) return;
				const now = mediaTimeToSeconds({
					time: editor.playback.getCurrentTime(),
				});
				taps.push(Math.max(0, now - latencyRef.current));
				setTapCount(taps.length);
				if (taps.length === lines.length + 1) finishRef.current({ cancel: false });
				return;
			}
			const removed = taps.pop();
			if (removed === undefined) return;
			setTapCount(taps.length);
			editor.playback.seek({
				time: mediaTimeFromSeconds({
					seconds: Math.max(0, removed - REWIND_SECONDS),
				}),
			});
		};
		window.addEventListener("keydown", handleKeyDown, { capture: true });
		return () =>
			window.removeEventListener("keydown", handleKeyDown, { capture: true });
	}, [active, editor]);

	const lines = linesRef.current;
	const current = lines[tapCount];

	return (
		<div className="flex flex-col gap-2">
			<span className="text-sm font-medium">點拍同步歌詞</span>
			{!active ? (
				<>
					<textarea
						value={text}
						onChange={(event) => setText(event.target.value)}
						placeholder="貼上沒有時間的歌詞,一行一句"
						rows={5}
						className="bg-background border-input w-full resize-y rounded-md border p-2 text-sm"
					/>
					<label className="text-muted-foreground flex items-center gap-2 text-xs">
						按鍵補償(秒)
						<input
							type="number"
							min={0}
							max={0.5}
							step={0.05}
							value={latency}
							onChange={(event) =>
								setLatency(Math.min(0.5, Math.max(0, Number(event.target.value) || 0)))
							}
							className="bg-background border-input w-16 rounded-md border px-1 py-0.5"
						/>
					</label>
					<Button type="button" variant="outline" onClick={start}>
						開始點拍(從播放頭播放)
					</Button>
					<p className="text-muted-foreground text-xs leading-relaxed">
						每句開始時按空白鍵;按退格鍵回到上一句重打(播放頭會倒回 2 秒)。
						最後一句唱完再按一次空白鍵,標出結束點。
					</p>
				</>
			) : (
				<>
					<div className="bg-muted rounded-md p-3 text-sm">
						<div className="text-muted-foreground text-xs">
							{tapCount < lines.length
								? `下一句(${tapCount + 1} / ${lines.length})— 按空白鍵`
								: "最後一句唱完時按空白鍵結束"}
						</div>
						<div className="mt-1 text-base font-medium">
							{current ?? "(全部打完)"}
						</div>
						{tapCount > 0 && (
							<div className="text-muted-foreground mt-1 text-xs">
								上一句:{lines[tapCount - 1]}
							</div>
						)}
					</div>
					<div className="flex gap-2">
						<Button
							type="button"
							className="flex-1"
							onClick={() => finish({ cancel: false })}
						>
							完成
						</Button>
						<Button
							type="button"
							variant="outline"
							className="flex-1"
							onClick={() => finish({ cancel: true })}
						>
							取消
						</Button>
					</div>
				</>
			)}
		</div>
	);
}
