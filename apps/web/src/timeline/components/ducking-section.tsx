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

type Ref = { trackId: string; elementId: string };

/**
 * 自動壓低背景音:先選取人聲片段按「設為人聲」,再選取音樂片段按「套用」。
 * 壓低會烘成音樂片段的音量關鍵影格(預覽、匯出、波形自動一致);人聲移動後要重新套用。
 */
export function DuckingSection() {
	const editor = useEditor();
	const [voice, setVoice] = useState<Ref[]>([]);
	const [duckDb, setDuckDb] = useState<number>(DUCK_DEFAULTS.duckDb);

	const selectedAudioCapable = () =>
		editor.timeline
			.getElementsWithTracks({ elements: editor.selection.getSelectedElements() })
			.filter(({ element }) => element.type === "audio" || element.type === "video");

	const setVoiceFromSelection = () => {
		const items = selectedAudioCapable();
		if (items.length === 0) {
			toast.error("請先選取人聲(旁白 / 對白)的音訊或影片片段");
			return;
		}
		setVoice(items.map(({ track, element }) => ({ trackId: track.id, elementId: element.id })));
		toast.success(`已設定 ${items.length} 個人聲片段;接著選取音樂片段按「套用」`);
	};

	const apply = () => {
		const targets = selectedAudioCapable();
		if (voice.length === 0) {
			toast.error("請先設定人聲片段");
			return;
		}
		if (targets.length === 0) {
			toast.error("請選取要壓低的音樂片段");
			return;
		}
		const voiceKeys = new Set(voice.map((v) => `${v.trackId}:${v.elementId}`));
		const musicTargets = targets.filter(
			({ track, element }) => !voiceKeys.has(`${track.id}:${element.id}`),
		);
		if (musicTargets.length === 0) {
			toast.error("選取的片段就是人聲本身,請改選音樂片段");
			return;
		}
		const voiceRanges = editor.timeline
			.getElementsWithTracks({ elements: voice })
			.map(({ element }) => {
				const start = mediaTimeToSeconds({ time: element.startTime });
				return { start, end: start + mediaTimeToSeconds({ time: element.duration }) };
			});
		if (voiceRanges.length === 0) {
			toast.error("人聲片段已不存在,請重新設定");
			setVoice([]);
			return;
		}
		const result = editor.timeline.applyDucking({
			targets: musicTargets.map(({ track, element }) => ({ trackId: track.id, elementId: element.id })),
			voiceRanges,
			duckDb,
			attackSeconds: DUCK_DEFAULTS.attackSeconds,
			releaseSeconds: DUCK_DEFAULTS.releaseSeconds,
		});
		if (result.error) {
			toast.error(result.error);
			return;
		}
		toast.success(`已壓低 ${result.applied} 個音樂片段(取代原本的音量關鍵影格;一次復原)`);
	};

	return (
		<div className="flex flex-col gap-2">
			<span className="text-sm font-medium">自動壓低背景音</span>
			<div className="flex flex-wrap items-center gap-1">
				<Button size="sm" variant="outline" onClick={setVoiceFromSelection}>
					設為人聲{voice.length > 0 ? `(${voice.length})` : ""}
				</Button>
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
			<Button size="sm" disabled={voice.length === 0} onClick={apply}>
				套用到選取的音樂
			</Button>
			<span className="text-muted-foreground text-xs">
				人聲出現前 0.25 秒壓下、結束後 0.6 秒放開。會取代音樂片段原有的音量關鍵影格;人聲移動或改長度後要重新套用。
			</span>
		</div>
	);
}
