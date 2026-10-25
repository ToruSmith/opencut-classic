"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/editor/use-editor";
import { mediaTimeFromSeconds, mediaTimeToSeconds } from "@/wasm";
import { VOLUME_DB_MIN } from "@/timeline/audio-constants";
import { DEFAULTS } from "@/timeline/defaults";

type FadeKind = "in" | "out" | "both";

const DURATIONS = [0.3, 0.5, 1, 2];

const PRESETS: Array<{ kind: FadeKind; label: string; hint: string }> = [
	{ kind: "in", label: "淡入", hint: "片段開頭由透明(音訊由靜音)漸顯" },
	{ kind: "out", label: "淡出", hint: "片段結尾漸漸消失" },
	{ kind: "both", label: "淡入淡出", hint: "開頭淡入、結尾淡出" },
];

export function TransitionsView() {
	const editor = useEditor();
	const [seconds, setSeconds] = useState(0.5);

	const applyFade = (kind: FadeKind) => {
		const selected = editor.selection.getSelectedElements();
		const items = editor.timeline.getElementsWithTracks({ elements: selected });
		if (items.length === 0) {
			toast.error("請先在時間軸選取片段");
			return;
		}

		const keyframes: Parameters<typeof editor.timeline.upsertKeyframes>[0]["keyframes"] = [];
		for (const { track, element } of items) {
			const isAudio = element.type === "audio";
			const isVisual = element.type === "video" || element.type === "image";
			if (!isAudio && !isVisual) continue;

			const durationSeconds = mediaTimeToSeconds({ time: element.duration });
			const fade = Math.min(seconds, durationSeconds / 2);
			if (fade <= 0) continue;

			const path = isAudio ? "volume" : "opacity";
			const low = isAudio ? VOLUME_DB_MIN : 0;
			const high = isAudio
				? ((element as { volume?: number }).volume ?? DEFAULTS.element.volume)
				: ((element as { opacity?: number }).opacity ?? DEFAULTS.element.opacity);
			const at = (s: number) => mediaTimeFromSeconds({ seconds: s });
			const base = { trackId: track.id, elementId: element.id, propertyPath: path };

			if (kind === "in" || kind === "both") {
				keyframes.push({ ...base, time: at(0), value: low });
				keyframes.push({ ...base, time: at(fade), value: high });
			}
			if (kind === "out" || kind === "both") {
				keyframes.push({ ...base, time: at(durationSeconds - fade), value: high });
				keyframes.push({ ...base, time: at(durationSeconds), value: low });
			}
		}

		if (keyframes.length === 0) {
			toast.error("選取的項目不支援淡化");
			return;
		}
		editor.timeline.upsertKeyframes({ keyframes });
	};

	return (
		<PanelView title="轉場">
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<span className="text-muted-foreground text-xs">長度</span>
					<div className="flex gap-1">
						{DURATIONS.map((d) => (
							<Button
								key={d}
								size="sm"
								variant={seconds === d ? "default" : "outline"}
								onClick={() => setSeconds(d)}
							>
								{d} 秒
							</Button>
						))}
					</div>
				</div>
				<div className="flex flex-col gap-2">
					{PRESETS.map((p) => (
						<Button
							key={p.kind}
							variant="outline"
							className="h-auto flex-col items-start gap-0.5 py-2"
							onClick={() => applyFade(p.kind)}
						>
							<span>{p.label}</span>
							<span className="text-muted-foreground text-xs font-normal">{p.hint}</span>
						</Button>
					))}
				</div>
				<p className="text-muted-foreground text-xs leading-relaxed">
					先在時間軸選取片段再按下。要做「溶接」:把後一段拖到上方另一條軌道、與前一段重疊,
					再分別對兩段套用淡入與淡出即可。可用「復原」撤銷。
				</p>
			</div>
		</PanelView>
	);
}
