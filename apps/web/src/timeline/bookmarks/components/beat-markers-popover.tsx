import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { useEditor } from "@/editor/use-editor";
import type { BeatMode } from "@/media/beat-detect";
import { mediaTimeFromSeconds, TICKS_PER_SECOND } from "@/wasm";
import { isBeatBookmark, pickSplitTimes } from "@/timeline/bookmarks/beat-markers";
import type { MediaTime } from "@/wasm";
import { DEFAULT_MAX_CUTS, planAutoCut } from "@/timeline/auto-cut";

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
	const [everyBeats, setEveryBeats] = useState(1);
	const [minPieceSeconds, setMinPieceSeconds] = useState(0);
	const [minGapSeconds, setMinGapSeconds] = useState(0.15);
	const [quickShuffle, setQuickShuffle] = useState(true);
	const [autoEvery, setAutoEvery] = useState(4);
	const [autoMinSeconds, setAutoMinSeconds] = useState(1);
	const [excludedAssetIds, setExcludedAssetIds] = useState<Set<string>>(new Set());
	const lastAutoTrackRef = useRef<string | null>(null);
	const mediaAssets = useEditor((e) => e.media.getAssets());
	const visualAssets = mediaAssets.filter(
		(asset) => asset.type === "video" || asset.type === "image",
	);
	const pickedAssets = visualAssets.filter((asset) => !excludedAssetIds.has(asset.id));
	const videosWithoutProxy = pickedAssets.filter(
		(asset) => asset.type === "video" && !asset.proxyFile,
	).length;

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
				minGapSeconds: mode === "onsets" ? minGapSeconds : undefined,
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

	const handleSplitAtBeats = () => {
		const selected = editor.selection.getSelectedElements();
		const items = editor.timeline.getElementsWithTracks({ elements: selected });
		if (items.length === 0) {
			toast.error("請先在時間軸選取要分割的片段");
			return;
		}
		const beats = editor.scenes
			.getActiveScene()
			.bookmarks.filter((bookmark) => isBeatBookmark({ bookmark }))
			.map((bookmark) => bookmark.time as number);
		if (beats.length === 0) {
			toast.error("還沒有節拍標記,請先分析");
			return;
		}
		// 各片段分別挑切點;同一批一起切,切點取聯集(重疊的片段在同一個時間點一起被切)
		const splitTimes = new Set<number>();
		let affected = 0;
		for (const { element } of items) {
			const times = pickSplitTimes({
				beats,
				start: element.startTime,
				end: element.startTime + element.duration,
				every: everyBeats,
				minGap: minPieceSeconds * TICKS_PER_SECOND,
			});
			if (times.length > 0) affected++;
			for (const time of times) splitTimes.add(time);
		}
		if (splitTimes.size === 0) {
			toast.error("選取的片段範圍內沒有節拍標記");
			return;
		}
		editor.timeline.splitElementsAtTimes({
			elements: selected,
			splitTimes: [...splitTimes] as MediaTime[],
		});
		toast.success(`已在 ${splitTimes.size} 個節拍處分割(${affected} 個片段)`);
	};

	const handleQuickCut = () => {
		const selected = editor.selection.getSelectedElements();
		const items = editor.timeline.getElementsWithTracks({ elements: selected });
		if (items.length === 0) {
			toast.error("請先在時間軸選取要快剪的素材(同一條軌道)");
			return;
		}
		if (new Set(items.map((item) => item.track.id)).size > 1) {
			toast.error("選取的素材需要在同一條軌道上");
			return;
		}
		const beats = editor.scenes
			.getActiveScene()
			.bookmarks.filter((bookmark) => isBeatBookmark({ bookmark }))
			.map((bookmark) => bookmark.time as number);
		if (beats.length === 0) {
			toast.error("還沒有節拍標記,請先分析");
			return;
		}
		const pieces = editor.timeline.quickCut({
			elements: selected,
			beats,
			every: everyBeats,
			minGap: minPieceSeconds * TICKS_PER_SECOND,
			shuffle: quickShuffle,
			seed: Math.floor(Math.random() * 1_000_000),
		});
		toast.success(`已快剪成 ${pieces} 段${quickShuffle ? "並打散" : ""}(可一次復原)`);
	};

	const handleAutoCut = () => {
		const scene = editor.scenes.getActiveScene();
		const beats = scene.bookmarks
			.filter((bookmark) => isBeatBookmark({ bookmark }))
			.map((bookmark) => bookmark.time as number);
		if (beats.length === 0) {
			toast.error("還沒有節拍標記,請先分析");
			return;
		}
		// 排滿的範圍 = 音訊軌上最後一個片段的結尾(音樂有多長就排多長)
		let end = 0;
		for (const track of scene.tracks.audio) {
			for (const element of track.elements) {
				end = Math.max(end, element.startTime + element.duration);
			}
		}
		if (end <= 0) {
			toast.error("音訊軌上要先有音樂,才知道要排多長");
			return;
		}
		const sources = pickedAssets
			.map((asset) => ({
				id: asset.id,
				kind: asset.type === "image" ? ("image" as const) : ("video" as const),
				durationTicks: Math.round((asset.duration ?? 0) * TICKS_PER_SECOND),
			}))
			.filter((source) => source.kind === "image" || source.durationTicks > 0);
		if (sources.length === 0) {
			toast.error("素材庫裡沒有可用的影片或圖片(請至少勾選一個)");
			return;
		}
		const plan = planAutoCut({
			beats,
			start: 0,
			end,
			sources,
			every: autoEvery,
			minGap: autoMinSeconds * TICKS_PER_SECOND,
			seed: Math.floor(Math.random() * 1_000_000),
		});
		if (plan.pieces.length === 0) {
			toast.error("排不出任何片段");
			return;
		}
		const trackId = editor.timeline.autoCut({
			pieces: plan.pieces,
			assets: pickedAssets.map((asset) => ({ id: asset.id, name: asset.name })),
			replaceTrackId: lastAutoTrackRef.current ?? undefined,
		});
		lastAutoTrackRef.current = trackId;
		const notes = [
			plan.thinnedCuts > 0 ? `切點超過上限 ${DEFAULT_MAX_CUTS},已自動減少` : null,
			plan.shortfallCount > 0 ? `${plan.shortfallCount} 段素材太短,畫面有空隙` : null,
		].filter(Boolean);
		toast.success(
			`已排入 ${plan.pieces.length} 段(再按一次會換一組並取代上次的結果,可一次復原)`,
			notes.length > 0 ? { description: notes.join(";") } : undefined,
		);
	};

	const handleReorder = (mode: "shuffle" | "reverse") => {
		const selected = editor.selection.getSelectedElements();
		if (selected.length < 2) {
			toast.error("請先在時間軸選取至少兩個片段(同一條軌道)");
			return;
		}
		const moved = editor.timeline.reorderElements({
			elements: selected,
			mode,
			seed: Math.floor(Math.random() * 1_000_000),
		});
		if (moved === 0) {
			toast.error("選取的片段需要在同一條軌道上,而且至少兩個");
			return;
		}
		toast.success(mode === "shuffle" ? `已重新打散 ${moved} 個片段` : `已反轉 ${moved} 個片段的順序`);
	};

	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			{children}
			<PopoverContent
				className="flex max-h-[var(--radix-popover-content-available-height)] w-72 flex-col gap-3 overflow-y-auto"
				align="end"
				collisionPadding={8}
			>
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
						<span className="text-muted-foreground mt-1 text-xs">
							最短間隔(兩個標記至少隔多久;標記太密就調大)
						</span>
						<div className="flex gap-1">
							{[0.15, 0.3, 0.5, 1].map((value) => (
								<Button
									key={value}
									size="sm"
									variant={minGapSeconds === value ? "default" : "outline"}
									disabled={busy}
									onClick={() => setMinGapSeconds(value)}
								>
									{value} 秒
								</Button>
							))}
						</div>
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
				<div className="border-t pt-3 flex flex-col gap-2">
					<span className="text-muted-foreground text-xs">依節拍分割選取的片段(剪 AMV)</span>
					<div className="flex items-center gap-1">
						{[1, 2, 4, 8].map((n) => (
							<Button
								key={n}
								size="sm"
								variant={everyBeats === n ? "default" : "outline"}
								onClick={() => setEveryBeats(n)}
							>
								每 {n} 拍
							</Button>
						))}
					</div>
					<span className="text-muted-foreground text-xs">
						最短片段(切出來的每一段至少多長;切太碎就調大)
					</span>
					<div className="flex flex-wrap gap-1">
						{[0, 1, 2, 3, 5].map((value) => (
							<Button
								key={value}
								size="sm"
								variant={minPieceSeconds === value ? "default" : "outline"}
								onClick={() => setMinPieceSeconds(value)}
							>
								{value === 0 ? "不限" : `${value} 秒`}
							</Button>
						))}
					</div>
					<Button
						size="sm"
						variant="outline"
						disabled={busy || beatCount === 0}
						onClick={handleSplitAtBeats}
					>
						依節拍分割
					</Button>
					<span className="text-muted-foreground text-xs">
						一鍵快剪:選取同一條軌道的幾段素材 → 首尾相接 → 依上面的設定在節拍處切開 →(可選)打散。一次復原。
					</span>
					<label className="flex items-center gap-2 text-xs">
						<input
							type="checkbox"
							checked={quickShuffle}
							onChange={(event) => setQuickShuffle(event.target.checked)}
						/>
						切完後隨機打散
					</label>
					<Button size="sm" disabled={busy || beatCount === 0} onClick={handleQuickCut}>
						一鍵快剪
					</Button>
					<span className="text-muted-foreground text-xs">
						重排選取的片段(同軌道;從最早的位置首尾相接,會補掉空隙)。建議用「節拍格」切出等長的小段再重排,節拍才不會跑掉。
					</span>
					<div className="flex gap-1">
						<Button size="sm" variant="outline" onClick={() => handleReorder("shuffle")}>
							隨機打散
						</Button>
						<Button size="sm" variant="outline" onClick={() => handleReorder("reverse")}>
							反轉順序
						</Button>
					</div>
				</div>
				<div className="border-t pt-3 flex flex-col gap-2">
					<span className="text-sm font-medium">自動排片(剪 AMV)</span>
					<span className="text-muted-foreground text-xs leading-relaxed">
						依節拍標記,從下面勾選的素材隨機抽片段,在新的一軌排滿整首音樂(影片靜音、不連續抽同一支)。
						要先分析節拍,且音訊軌上要有音樂。
					</span>
					<div className="flex items-center gap-1">
						{[2, 4, 8].map((n) => (
							<Button
								key={n}
								size="sm"
								variant={autoEvery === n ? "default" : "outline"}
								onClick={() => setAutoEvery(n)}
							>
								每 {n} 拍
							</Button>
						))}
					</div>
					<span className="text-muted-foreground text-xs">最短片段</span>
					<div className="flex flex-wrap gap-1">
						{[0, 1, 2, 3].map((value) => (
							<Button
								key={value}
								size="sm"
								variant={autoMinSeconds === value ? "default" : "outline"}
								onClick={() => setAutoMinSeconds(value)}
							>
								{value === 0 ? "不限" : `${value} 秒`}
							</Button>
						))}
					</div>
					<div className="max-h-32 overflow-y-auto rounded-md border p-2">
						{visualAssets.length === 0 ? (
							<span className="text-muted-foreground text-xs">素材庫裡還沒有影片或圖片</span>
						) : (
							visualAssets.map((asset) => (
								<label key={asset.id} className="flex items-center gap-2 py-0.5 text-xs">
									<input
										type="checkbox"
										checked={!excludedAssetIds.has(asset.id)}
										onChange={(event) =>
											setExcludedAssetIds((previous) => {
												const next = new Set(previous);
												if (event.target.checked) next.delete(asset.id);
												else next.add(asset.id);
												return next;
											})
										}
									/>
									<span className="truncate">{asset.name}</span>
								</label>
							))
						)}
					</div>
					{videosWithoutProxy > 0 && (
						<span className="text-xs text-amber-600">
							有 {videosWithoutProxy} 支影片還沒建立代理檔;片段很多時預覽會吃力,建議先到素材庫對它們「建立代理檔」。
						</span>
					)}
					<Button
						size="sm"
						disabled={busy || beatCount === 0 || pickedAssets.length === 0}
						onClick={handleAutoCut}
					>
						自動排片
					</Button>
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
