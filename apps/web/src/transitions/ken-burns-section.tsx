import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/editor/use-editor";
import { mediaTimeFromSeconds, mediaTimeToSeconds } from "@/wasm";
import {
	KEN_BURNS_KINDS,
	buildKenBurnsKeyframes,
	pickKenBurnsKinds,
	type KenBurnsKind,
} from "./ken-burns";

const KIND_LABEL: Record<KenBurnsKind, string> = {
	"zoom-in": "推近",
	"zoom-out": "拉遠",
	"pan-left": "← 平移",
	"pan-right": "→ 平移",
	"pan-up": "↑ 平移",
	"pan-down": "↓ 平移",
};

const ZOOM_OPTIONS = [
	{ value: 0.08, label: "輕微" },
	{ value: 0.15, label: "中" },
	{ value: 0.3, label: "明顯" },
];

const VISUAL_TYPES = new Set(["image", "video", "text", "sticker", "graphic"]);

/**
 * 緩慢推近 / 拉遠 / 平移(Ken Burns):整個片段長度的縮放與位置關鍵影格,適合圖片、相簿與歌詞影片。
 * 可框選多個片段一次套用;「每個隨機」每張各抽一種、相鄰不重複。
 */
export function KenBurnsSection() {
	const editor = useEditor();
	const [zoom, setZoom] = useState(0.15);
	const [seed, setSeed] = useState(1);

	const apply = ({ kind }: { kind: KenBurnsKind | "random" }) => {
		const selected = editor.selection.getSelectedElements();
		const items = editor.timeline
			.getElementsWithTracks({ elements: selected })
			.filter(({ element }) => VISUAL_TYPES.has(element.type))
			.sort((a, b) => a.element.startTime - b.element.startTime);
		if (items.length === 0) {
			toast.error("請先在時間軸選取圖片或影片片段");
			return;
		}
		const canvas = editor.project.getActive().settings.canvasSize;
		const kinds =
			kind === "random"
				? pickKenBurnsKinds({ count: items.length, seed })
				: items.map(() => kind);

		const keyframes: Parameters<typeof editor.timeline.upsertKeyframes>[0]["keyframes"] = [];
		items.forEach(({ track, element }, index) => {
			const kenKind = kinds[index];
			if (!kenKind) return;
			for (const keyframe of buildKenBurnsKeyframes({
				params: element.params,
				durationSeconds: mediaTimeToSeconds({ time: element.duration }),
				kind: kenKind,
				zoom,
				canvas,
			})) {
				keyframes.push({
					trackId: track.id,
					elementId: element.id,
					propertyPath: keyframe.propertyPath,
					time: mediaTimeFromSeconds({ seconds: keyframe.seconds }),
					value: keyframe.value,
				});
			}
		});
		if (keyframes.length === 0) {
			toast.error("沒有可套用的片段");
			return;
		}
		editor.timeline.upsertKeyframes({ keyframes });
		if (kind === "random") setSeed((value) => value + 1);
		toast.success(`已對 ${items.length} 個片段加上動態(一次復原)`);
	};

	return (
		<div className="flex flex-col gap-2">
			<span className="text-muted-foreground text-xs">
				緩慢推近 / 平移(整個片段長度,適合圖片;可框選多個一次套用)
			</span>
			<div className="flex flex-wrap items-center gap-1">
				<span className="text-muted-foreground text-xs">幅度</span>
				{ZOOM_OPTIONS.map((option) => (
					<Button
						key={option.value}
						size="sm"
						variant={zoom === option.value ? "default" : "outline"}
						onClick={() => setZoom(option.value)}
					>
						{option.label}
					</Button>
				))}
			</div>
			<div className="grid grid-cols-3 gap-1">
				{KEN_BURNS_KINDS.map((kind) => (
					<Button key={kind} size="sm" variant="outline" onClick={() => apply({ kind })}>
						{KIND_LABEL[kind]}
					</Button>
				))}
			</div>
			<Button size="sm" onClick={() => apply({ kind: "random" })}>
				每個隨機
			</Button>
			<span className="text-muted-foreground text-xs">
				在縮放 / 位置上做關鍵影格,可在屬性面板微調。再套一次會覆蓋頭尾兩個關鍵影格;若片段已有進出場動畫的縮放 / 位置關鍵影格會混在一起。
			</span>
		</div>
	);
}
