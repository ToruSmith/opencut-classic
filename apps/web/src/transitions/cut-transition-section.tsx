import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/editor/use-editor";
import { mediaTimeToSeconds } from "@/wasm";
import {
	CUT_TRANSITION_KINDS,
	findCutPoints,
	pickCutKinds,
	type CutDirection,
	type CutTransitionKind,
} from "./cut-transition";

const KIND_UI: Record<CutTransitionKind, { label: string; hint: string }> = {
	flash: { label: "閃白", hint: "切點亮成一片白" },
	zoom: { label: "縮放衝入", hint: "放大衝進去、下一段收回" },
	whip: { label: "甩鏡", hint: "往方向甩出、下一段接著甩進來" },
	spin: { label: "旋轉甩入", hint: "轉一圈似的帶過切點" },
	glitch: { label: "故障切", hint: "訊號錯位 + RGB 分離" },
	shake: { label: "震動切", hint: "下一段一進來重重一震" },
};

const SIDE_OPTIONS = [
	{ value: 0.1, label: "快 0.2 秒" },
	{ value: 0.2, label: "中 0.4 秒" },
	{ value: 0.35, label: "慢 0.7 秒" },
];

const INTENSITY_OPTIONS = [
	{ value: 0.4, label: "弱" },
	{ value: 0.7, label: "中" },
	{ value: 1, label: "強" },
];

const DIRECTION_OPTIONS: Array<{ value: CutDirection; label: string }> = [
	{ value: "left", label: "←" },
	{ value: "right", label: "→" },
	{ value: "up", label: "↑" },
	{ value: "down", label: "↓" },
];

/**
 * 切點轉場(剪映「熱門轉場」那一類):不需要重疊軌道,直接套在同一條軌道相接的片段上。
 * 適合「依節拍分割 / 一鍵快剪」之後,框選整排片段一次套到所有切點。
 */
export function CutTransitionSection() {
	const editor = useEditor();
	const [sideSeconds, setSideSeconds] = useState(0.2);
	const [intensity, setIntensity] = useState(0.7);
	const [direction, setDirection] = useState<CutDirection>("right");
	const [seed, setSeed] = useState(1);

	const collectCuts = () => {
		const selected = editor.selection.getSelectedElements();
		const items = editor.timeline
			.getElementsWithTracks({ elements: selected })
			.filter(({ element }) => element.type !== "audio")
			.map(({ track, element }) => {
				const start = mediaTimeToSeconds({ time: element.startTime });
				return {
					id: element.id,
					trackId: track.id,
					start,
					end: start + mediaTimeToSeconds({ time: element.duration }),
				};
			});
		return findCutPoints({ items });
	};

	const apply = ({ kind }: { kind: CutTransitionKind | "random" | null }) => {
		const cuts = collectCuts();
		if (cuts.length === 0) {
			toast.error("請框選同一條軌道上「首尾相接」的兩段以上片段(中間不能有空隙)");
			return;
		}
		const kinds =
			kind === "random"
				? pickCutKinds({ count: cuts.length, seed })
				: cuts.map(() => kind);
		const applied = editor.timeline.applyCutTransitions({
			cuts: cuts.map((cut, index) => ({
				trackId: cut.trackId,
				outId: cut.outId,
				inId: cut.inId,
				kind: kinds[index] ?? null,
			})),
			sideSeconds,
			direction,
			intensity,
		});
		if (kind === "random") setSeed((value) => value + 1);
		if (kind === null) {
			toast.success(`已清除 ${cuts.length} 個切點的切點轉場`);
			return;
		}
		if (applied === 0) {
			toast.error("片段太短,沒有套用");
			return;
		}
		toast.success(`已在 ${applied} 個切點套用轉場(一次復原;再按會取代)`);
	};

	return (
		<div className="flex flex-col gap-2">
			<span className="text-muted-foreground text-xs">
				切點轉場(同一條軌道相接的片段,不需要重疊;可框選整排一次套用)
			</span>
			<div className="flex flex-wrap gap-1">
				{SIDE_OPTIONS.map((option) => (
					<Button
						key={option.value}
						size="sm"
						variant={sideSeconds === option.value ? "default" : "outline"}
						onClick={() => setSideSeconds(option.value)}
					>
						{option.label}
					</Button>
				))}
			</div>
			<div className="flex flex-wrap items-center gap-1">
				<span className="text-muted-foreground text-xs">強度</span>
				{INTENSITY_OPTIONS.map((option) => (
					<Button
						key={option.value}
						size="sm"
						variant={intensity === option.value ? "default" : "outline"}
						onClick={() => setIntensity(option.value)}
					>
						{option.label}
					</Button>
				))}
				<span className="text-muted-foreground ml-2 text-xs">甩鏡方向</span>
				{DIRECTION_OPTIONS.map((option) => (
					<Button
						key={option.value}
						size="sm"
						variant={direction === option.value ? "default" : "outline"}
						onClick={() => setDirection(option.value)}
					>
						{option.label}
					</Button>
				))}
			</div>
			<div className="grid grid-cols-2 gap-1">
				{CUT_TRANSITION_KINDS.map((kind) => (
					<Button
						key={kind}
						variant="outline"
						className="h-auto flex-col items-start gap-0.5 py-2"
						title={KIND_UI[kind].hint}
						onClick={() => apply({ kind })}
					>
						<span>{KIND_UI[kind].label}</span>
						<span className="text-muted-foreground text-left text-xs font-normal whitespace-normal">
							{KIND_UI[kind].hint}
						</span>
					</Button>
				))}
			</div>
			<div className="flex flex-wrap gap-1">
				<Button size="sm" onClick={() => apply({ kind: "random" })}>
					每個切點隨機
				</Button>
				<Button size="sm" variant="outline" onClick={() => apply({ kind: null })}>
					清除切點轉場
				</Button>
			</div>
			<span className="text-muted-foreground text-xs">
				在切點前後的片段上加特效並做關鍵影格(可在特效屬性調整);轉場以外的時間特效不跑 pass。再按一次會取代同一個切點上的舊轉場。
			</span>
		</div>
	);
}
