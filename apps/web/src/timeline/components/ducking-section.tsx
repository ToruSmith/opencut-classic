import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/editor/use-editor";
import { DUCK_DEFAULTS } from "@/timeline/ducking";
import { mediaTimeToSeconds } from "@/wasm";

const DEPTH_OPTIONS = [
	{ value: -8, label: "輕 -8 dB" },
	{ value: -12, label: "中 -12 dB" },
	{ value: -18, label: "重 -18 dB" },
];

/**
 * 自動壓低背景音:選「人聲軌」和「音樂軌」,按套用。
 * 不靠選取片段(這個面板是彈出視窗,點時間軸選片段它就關了,記住的選取會消失)。
 * 壓低會烘成音樂軌上每個片段的音量關鍵影格(預覽、匯出、波形自動一致);人聲移動後要重新套用。
 */
export function DuckingSection() {
	const editor = useEditor();
	const tracks = useEditor((e) => e.scenes.getActiveSceneOrNull()?.tracks ?? null);
	const [voiceTrackId, setVoiceTrackId] = useState<string | null>(null);
	const [musicTrackId, setMusicTrackId] = useState<string | null>(null);
	const [duckDb, setDuckDb] = useState<number>(DUCK_DEFAULTS.duckDb);
	const [result, setResult] = useState<string | null>(null);

	const candidates = tracks
		? [...tracks.overlay, tracks.main, ...tracks.audio]
				.map((track) => {
					const clips = (track.elements as Array<{ type: string; name: string }>).filter(
						(element) => element.type === "audio" || element.type === "video",
					);
					return { id: track.id, type: track.type, name: track.name, clips };
				})
				.filter((track) => track.clips.length > 0)
		: [];
	const labelOf = (track: (typeof candidates)[number], index: number) =>
		`${track.type === "audio" ? "音訊軌" : "影片軌"} ${index + 1}:${track.clips[0]?.name ?? ""}${
			track.clips.length > 1 ? ` 等 ${track.clips.length} 段` : ""
		}`;

	const apply = () => {
		if (!tracks || !voiceTrackId || !musicTrackId) return;
		if (voiceTrackId === musicTrackId) {
			toast.error("人聲軌和音樂軌不能是同一條");
			return;
		}
		const all = [...tracks.overlay, tracks.main, ...tracks.audio];
		const voiceTrack = all.find((track) => track.id === voiceTrackId);
		const musicTrack = all.find((track) => track.id === musicTrackId);
		if (!voiceTrack || !musicTrack) {
			toast.error("找不到選取的軌道,請重新選擇");
			return;
		}
		const isAudible = (element: { type: string }) =>
			element.type === "audio" || element.type === "video";
		const voiceRanges = (voiceTrack.elements as Array<{ type: string; startTime: number; duration: number }>)
			.filter(isAudible)
			.map((element) => {
				const start = mediaTimeToSeconds({ time: element.startTime as never });
				return { start, end: start + mediaTimeToSeconds({ time: element.duration as never }) };
			});
		const targets = (musicTrack.elements as Array<{ id: string; type: string }>)
			.filter(isAudible)
			.map((element) => ({ trackId: musicTrack.id, elementId: element.id }));

		const outcome = editor.timeline.applyDucking({
			targets,
			voiceRanges,
			duckDb,
			attackSeconds: DUCK_DEFAULTS.attackSeconds,
			releaseSeconds: DUCK_DEFAULTS.releaseSeconds,
		});
		if (outcome.error) {
			setResult(outcome.error);
			toast.error(outcome.error);
			return;
		}
		const message = `已壓低 ${outcome.applied} 個音樂片段(依 ${voiceRanges.length} 個人聲片段;一次復原)。到音樂片段的屬性面板「音量」可看到關鍵影格。`;
		setResult(message);
		toast.success("已套用自動壓低");
	};

	const picker = ({
		title,
		value,
		onChange,
	}: {
		title: string;
		value: string | null;
		onChange: (id: string) => void;
	}) => (
		<div className="flex flex-col gap-1">
			<span className="text-muted-foreground text-xs">{title}</span>
			{candidates.length === 0 ? (
				<span className="text-muted-foreground text-xs">時間軸上還沒有音訊或影片片段</span>
			) : (
				<div className="flex flex-col gap-1">
					{candidates.map((track, index) => (
						<Button
							key={track.id}
							size="sm"
							className="h-auto justify-start py-1 text-left whitespace-normal"
							variant={value === track.id ? "default" : "outline"}
							onClick={() => onChange(track.id)}
						>
							{labelOf(track, index)}
						</Button>
					))}
				</div>
			)}
		</div>
	);

	return (
		<div className="flex flex-col gap-2">
			<span className="text-sm font-medium">自動壓低背景音</span>
			<span className="text-muted-foreground text-xs leading-relaxed">
				旁白 / 對白出現時,自動把音樂音量壓低。選好兩條軌道就能套用,不需要先選取片段。
			</span>
			{picker({ title: "1. 人聲軌(旁白、對白)", value: voiceTrackId, onChange: setVoiceTrackId })}
			{picker({ title: "2. 音樂軌(要被壓低的)", value: musicTrackId, onChange: setMusicTrackId })}
			<div className="flex flex-wrap items-center gap-1">
				<span className="text-muted-foreground text-xs">壓低量</span>
				{DEPTH_OPTIONS.map((option) => (
					<Button
						key={option.value}
						size="sm"
						variant={duckDb === option.value ? "default" : "outline"}
						onClick={() => setDuckDb(option.value)}
					>
						{option.label}
					</Button>
				))}
			</div>
			<Button size="sm" disabled={!voiceTrackId || !musicTrackId} onClick={apply}>
				套用
			</Button>
			{result && <p className="text-muted-foreground text-xs">{result}</p>}
			<span className="text-muted-foreground text-xs">
				人聲前 0.25 秒壓下、結束後 0.6 秒放開;會取代音樂片段原有的音量關鍵影格,人聲移動或改長度後要重新套用。
			</span>
		</div>
	);
}
