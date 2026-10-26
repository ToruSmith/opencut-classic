"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/editor/use-editor";
import { isSourceAudioEnabled } from "@/timeline/audio-separation";
import {
	mediaTime,
	mediaTimeFromSeconds,
	mediaTimeToSeconds,
	TICKS_PER_SECOND,
} from "@/wasm";
import {
	AUDIO_FADE_IN_KEY,
	AUDIO_FADE_OUT_KEY,
} from "@/timeline/audio-fade";
import type { ParamValues } from "@/params";
import { planCrossDissolve } from "./cross-dissolve";
import {
	buildTransitionKeyframes,
	type TransitionMotion,
	type TransitionSide,
} from "./presets";

const DURATIONS = [0.3, 0.5, 1, 2];

const MOTIONS: Array<{
	motion: TransitionMotion;
	label: Record<TransitionSide, string>;
	hint: string;
}> = [
	{
		motion: "fade",
		label: { in: "淡入", out: "淡出" },
		hint: "畫面不透明度與音量漸變",
	},
	{
		motion: "slide-left",
		label: { in: "從左滑入", out: "向左滑出" },
		hint: "整個片段平移進出畫面",
	},
	{
		motion: "slide-right",
		label: { in: "從右滑入", out: "向右滑出" },
		hint: "整個片段平移進出畫面",
	},
	{
		motion: "slide-up",
		label: { in: "從上滑入", out: "向上滑出" },
		hint: "整個片段平移進出畫面",
	},
	{
		motion: "slide-down",
		label: { in: "從下滑入", out: "向下滑出" },
		hint: "整個片段平移進出畫面",
	},
	{
		motion: "zoom",
		label: { in: "縮放進入", out: "縮小退出" },
		hint: "由小放大並淡入(出場相反)",
	},
	{
		motion: "spin",
		label: { in: "旋轉進入", out: "旋轉退出" },
		hint: "轉動 90 度並淡入(出場相反)",
	},
	{
		motion: "pop",
		label: { in: "彈出", out: "彈出退場" },
		hint: "稍微放大再回到原大小",
	},
];

export function TransitionsView() {
	const editor = useEditor();
	const [seconds, setSeconds] = useState(0.5);
	const [side, setSide] = useState<TransitionSide>("in");

	const apply = ({
		motion,
		sides,
	}: {
		motion: TransitionMotion;
		sides: TransitionSide[];
	}) => {
		const selected = editor.selection.getSelectedElements();
		const items = editor.timeline.getElementsWithTracks({ elements: selected });
		if (items.length === 0) {
			toast.error("請先在時間軸選取片段");
			return;
		}

		const canvas = editor.project.getActive().settings.canvasSize;
		const keyframes: Parameters<
			typeof editor.timeline.upsertKeyframes
		>[0]["keyframes"] = [];

		for (const { track, element } of items) {
			const target = {
				type: element.type,
				params: element.params,
				durationSeconds: mediaTimeToSeconds({ time: element.duration }),
				hasAudio:
					element.type === "video" ? isSourceAudioEnabled({ element }) : false,
			};
			for (const currentSide of sides) {
				for (const keyframe of buildTransitionKeyframes({
					target,
					motion,
					side: currentSide,
					seconds,
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
			}
		}

		if (keyframes.length === 0) {
			toast.error("選取的項目不支援這個轉場");
			return;
		}
		editor.timeline.upsertKeyframes({ keyframes });
	};

	const applyCrossDissolve = () => {
		const selected = editor.selection.getSelectedElements();
		if (selected.length !== 1) {
			toast.error("請在時間軸選取一段片段(前一段或後一段都可以)");
			return;
		}
		const tracks = editor.scenes.getActiveScene().tracks;
		const plan = planCrossDissolve({
			tracks,
			trackId: selected[0].trackId,
			elementId: selected[0].elementId,
		});
		if (!plan.ok) {
			toast.error(plan.reason);
			return;
		}

		const paramUpdates: Array<{
			trackId: string;
			elementId: string;
			params: ParamValues;
		}> = [];
		const keyframes: Parameters<
			typeof editor.timeline.applyElementEdits
		>[0]["keyframes"] = [];

		for (const action of plan.actions) {
			const item = editor.timeline.getElementsWithTracks({
				elements: [{ trackId: action.trackId, elementId: action.elementId }],
			})[0];
			if (!item) continue;
			const { element } = item;
			if (action.kind === "audio") {
				// 同一個片段可能前面已經改過參數(例如同時有淡入與淡出),要接續累加
				const pending = paramUpdates.find(
					(update) =>
						update.trackId === action.trackId &&
						update.elementId === action.elementId,
				);
				const key = action.side === "in" ? AUDIO_FADE_IN_KEY : AUDIO_FADE_OUT_KEY;
				const seconds =
					Math.round((action.duration / TICKS_PER_SECOND) * 100) / 100;
				if (pending) {
					pending.params = { ...pending.params, [key]: seconds };
				} else {
					paramUpdates.push({
						trackId: action.trackId,
						elementId: action.elementId,
						params: { ...element.params, [key]: seconds },
					});
				}
				continue;
			}

			const baseOpacity =
				typeof element.params.opacity === "number" ? element.params.opacity : 1;
			const fadeStart =
				action.side === "in" ? 0 : element.duration - action.duration;
			const fadeEnd = action.side === "in" ? action.duration : element.duration;
			keyframes.push(
				{
					trackId: action.trackId,
					elementId: action.elementId,
					propertyPath: "opacity",
					time: mediaTime({ ticks: Math.max(0, Math.round(fadeStart)) }),
					value: action.side === "in" ? 0 : baseOpacity,
				},
				{
					trackId: action.trackId,
					elementId: action.elementId,
					propertyPath: "opacity",
					time: mediaTime({ ticks: Math.max(0, Math.round(fadeEnd)) }),
					value: action.side === "in" ? baseOpacity : 0,
				},
			);
		}

		editor.timeline.applyElementEdits({ paramUpdates, keyframes });
		toast.success(
			`已套用交叉溶解(${(plan.overlap / TICKS_PER_SECOND).toFixed(2)} 秒)`,
		);
	};

	return (
		<PanelView title="轉場">
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<span className="text-muted-foreground text-xs">兩段之間</span>
					<Button
						variant="outline"
						className="h-auto flex-col items-start gap-0.5 py-2"
						onClick={applyCrossDissolve}
					>
						<span>交叉溶解</span>
						<span className="text-muted-foreground text-left text-xs font-normal whitespace-normal">
							後一段放在另一條軌道、開頭和前一段重疊,選取其中一段後按下;重疊多長,轉場就多長(畫面與聲音)
						</span>
					</Button>
				</div>
				<div className="flex flex-col gap-2">
					<span className="text-muted-foreground text-xs">套用在</span>
					<div className="flex gap-1">
						<Button
							size="sm"
							variant={side === "in" ? "default" : "outline"}
							onClick={() => setSide("in")}
						>
							片段開頭(進場)
						</Button>
						<Button
							size="sm"
							variant={side === "out" ? "default" : "outline"}
							onClick={() => setSide("out")}
						>
							片段結尾(出場)
						</Button>
					</div>
				</div>
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
					<Button
						variant="outline"
						className="h-auto flex-col items-start gap-0.5 py-2"
						onClick={() => apply({ motion: "fade", sides: ["in", "out"] })}
					>
						<span>淡入淡出</span>
						<span className="text-muted-foreground text-xs font-normal">
							開頭淡入、結尾淡出(畫面與音量)
						</span>
					</Button>
					{MOTIONS.map((m) => (
						<Button
							key={m.motion}
							variant="outline"
							className="h-auto flex-col items-start gap-0.5 py-2"
							onClick={() => apply({ motion: m.motion, sides: [side] })}
						>
							<span>{m.label[side]}</span>
							<span className="text-muted-foreground text-xs font-normal">
								{m.hint}
							</span>
						</Button>
					))}
				</div>
				<p className="text-muted-foreground text-xs leading-relaxed">
					先在時間軸選取片段(可多選)再按下。動畫以關鍵影格實作,之後可以在屬性面板或曲線編輯器微調,也可用「復原」撤銷。
					音訊的淡入淡出也可以直接拖曳時間軸上音訊片段左上、右上角的圓點,或在屬性面板輸入秒數。
				</p>
			</div>
		</PanelView>
	);
}
