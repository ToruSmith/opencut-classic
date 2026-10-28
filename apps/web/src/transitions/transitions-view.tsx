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
import { planCrossDissolve, type DissolveAction } from "./cross-dissolve";
import {
	buildPairKeyframes,
	planPairTransition,
	type PairDirection,
	type PairKind,
} from "./pair-transition";
import { planWipeForItem } from "./wipe-transition";
import { CutTransitionSection } from "./cut-transition-section";
import { KenBurnsSection } from "./ken-burns-section";
import type { WipeKind } from "@/effects/definitions/wipe";
import {
	buildTransitionKeyframes,
	pickRandomMotions,
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

const PAIR_KINDS: Array<{ kind: PairKind; label: string; hint: string }> = [
	{ kind: "push", label: "推移", hint: "前一段被後一段推出畫面,兩段一起移動" },
	{
		kind: "slide",
		label: "滑動擦除",
		hint: "上層那一段滑進來蓋住(覆蓋)或滑出去露出下面(揭開)",
	},
	{ kind: "zoom", label: "縮放", hint: "前一段放大、後一段由小放大,上層淡化銜接" },
];

const PAIR_DIRECTIONS: Array<{ direction: PairDirection; label: string }> = [
	{ direction: "left", label: "← 向左" },
	{ direction: "right", label: "→ 向右" },
	{ direction: "up", label: "↑ 向上" },
	{ direction: "down", label: "↓ 向下" },
];

const WIPE_KINDS_UI: Array<{ kind: WipeKind; label: string; hint: string }> = [
	{
		kind: "linear",
		label: "線性擦除",
		hint: "上層那一段沿著選的方向被擦掉,露出下面(出場),或被擦開(進場);有柔邊",
	},
	{
		kind: "iris",
		label: "圓形光圈",
		hint: "從畫面中心打開一個圓,越開越大",
	},
	{
		kind: "clock",
		label: "時鐘掃過",
		hint: "像時鐘指針從 12 點鐘順時針掃一圈",
	},
	{
		kind: "blinds",
		label: "百葉窗",
		hint: "整個畫面切成 8 條,每條同時沿方向擦開",
	},
	{
		kind: "checker",
		label: "棋盤",
		hint: "格子交錯擦開,一半先、一半後",
	},
	{
		kind: "diamond",
		label: "菱形",
		hint: "從中心打開一個菱形",
	},
	{
		kind: "dissolve",
		label: "噪點溶解",
		hint: "像墨水暈開或燒穿,不規則地溶掉",
	},
	{
		kind: "blocks",
		label: "方塊崩落",
		hint: "畫面切成方塊,隨機一塊一塊消失(硬邊最明顯)",
	},
	{
		kind: "split",
		label: "對開",
		hint: "從中線往兩側打開(像拉開門);方向決定是左右開還是上下開",
	},
];

const WIPE_SOFTNESS = [
	{ value: 0, label: "硬邊" },
	{ value: 20, label: "柔邊" },
	{ value: 60, label: "很柔" },
];

export function TransitionsView() {
	const editor = useEditor();
	const [seconds, setSeconds] = useState(0.5);
	const [side, setSide] = useState<TransitionSide>("in");
	const [pairDirection, setPairDirection] = useState<PairDirection>("left");
	const [wipeSoftness, setWipeSoftness] = useState(20);
	const [wipeReverse, setWipeReverse] = useState(false);

	const apply = ({
		motion,
		sides,
		randomSeed,
	}: {
		motion?: TransitionMotion;
		sides: TransitionSide[];
		/** 有值時每個片段各抽一種動畫(依開始時間排序,相鄰不重複) */
		randomSeed?: number;
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

		const ordered =
			randomSeed === undefined
				? items
				: [...items].sort((a, b) => a.element.startTime - b.element.startTime);
		const randomMotions =
			randomSeed === undefined
				? []
				: pickRandomMotions({ count: ordered.length, seed: randomSeed });

		for (const [index, { track, element }] of ordered.entries()) {
			const itemMotion = randomSeed === undefined ? motion : randomMotions[index];
			if (!itemMotion) continue;
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
					motion: itemMotion,
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

	const applyPair = (kind: PairKind) => {
		const selected = editor.selection.getSelectedElements();
		if (selected.length !== 1) {
			toast.error("請在時間軸選取一段片段(前一段或後一段都可以)");
			return;
		}
		const plan = planPairTransition({
			tracks: editor.scenes.getActiveScene().tracks,
			trackId: selected[0].trackId,
			elementId: selected[0].elementId,
		});
		if (!plan.ok) {
			toast.error(plan.reason);
			return;
		}

		const canvas = editor.project.getActive().settings.canvasSize;
		const overlapSeconds = plan.overlap / TICKS_PER_SECOND;
		const keyframes: Parameters<
			typeof editor.timeline.applyElementEdits
		>[0]["keyframes"] = [];
		for (const planItem of plan.items) {
			const item = editor.timeline.getElementsWithTracks({
				elements: [{ trackId: planItem.trackId, elementId: planItem.elementId }],
			})[0];
			if (!item) continue;
			for (const keyframe of buildPairKeyframes({
				kind,
				direction: pairDirection,
				item: planItem,
				params: item.element.params,
				durationSeconds: mediaTimeToSeconds({ time: item.element.duration }),
				overlapSeconds,
				canvas,
			})) {
				keyframes.push({
					trackId: planItem.trackId,
					elementId: planItem.elementId,
					propertyPath: keyframe.propertyPath,
					time: mediaTimeFromSeconds({ seconds: keyframe.seconds }),
					value: keyframe.value,
				});
			}
		}
		if (keyframes.length === 0) {
			toast.error("選取的項目不支援這個轉場");
			return;
		}

		editor.timeline.applyElementEdits({
			paramUpdates: buildAudioFadeUpdates({ actions: plan.audio }),
			keyframes,
		});
		toast.success(`已套用轉場(${overlapSeconds.toFixed(2)} 秒)`);
	};

	const applyWipe = (kind: WipeKind) => {
		const selected = editor.selection.getSelectedElements();
		if (selected.length !== 1) {
			toast.error("請在時間軸選取一段片段(前一段或後一段都可以)");
			return;
		}
		const plan = planPairTransition({
			tracks: editor.scenes.getActiveScene().tracks,
			trackId: selected[0].trackId,
			elementId: selected[0].elementId,
		});
		if (!plan.ok) {
			toast.error(plan.reason);
			return;
		}
		const upperItem = plan.items.find((candidate) => candidate.upper);
		const target = upperItem
			? editor.timeline.getElementsWithTracks({
					elements: [{ trackId: upperItem.trackId, elementId: upperItem.elementId }],
				})[0]
			: undefined;
		if (!upperItem || !target || target.element.type === "audio") {
			toast.error("選取的項目不支援這個轉場");
			return;
		}
		const wipe = planWipeForItem({
			kind,
			direction: pairDirection,
			item: upperItem,
			softness: wipeSoftness,
			reverse: wipeReverse,
			durationSeconds: mediaTimeToSeconds({ time: target.element.duration }),
			overlapSeconds: plan.overlap / TICKS_PER_SECOND,
		});
		if (!wipe) {
			toast.error("選取的項目不支援這個轉場");
			return;
		}
		editor.timeline.applyWipeTransition({
			trackId: upperItem.trackId,
			elementId: upperItem.elementId,
			params: wipe.params,
			progressKeyframes: wipe.keyframes.map((keyframe) => ({
				time: mediaTimeFromSeconds({ seconds: keyframe.seconds }),
				value: keyframe.value,
			})),
		});
		toast.success(`已套用擦除(${(plan.overlap / TICKS_PER_SECOND).toFixed(2)} 秒)`);
	};

	const buildAudioFadeUpdates = ({ actions }: { actions: DissolveAction[] }) => {
		const updates: Array<{ trackId: string; elementId: string; params: ParamValues }> = [];
		for (const action of actions) {
			if (action.kind !== "audio") continue;
			const item = editor.timeline.getElementsWithTracks({
				elements: [{ trackId: action.trackId, elementId: action.elementId }],
			})[0];
			if (!item) continue;
			const key = action.side === "in" ? AUDIO_FADE_IN_KEY : AUDIO_FADE_OUT_KEY;
			const fadeSeconds = Math.round((action.duration / TICKS_PER_SECOND) * 100) / 100;
			const pending = updates.find(
				(u) => u.trackId === action.trackId && u.elementId === action.elementId,
			);
			if (pending) pending.params = { ...pending.params, [key]: fadeSeconds };
			else
				updates.push({
					trackId: action.trackId,
					elementId: action.elementId,
					params: { ...item.element.params, [key]: fadeSeconds },
				});
		}
		return updates;
	};

	return (
		<PanelView title="轉場">
			<div className="flex flex-col gap-4">
				<CutTransitionSection />
				<KenBurnsSection />
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
					<span className="text-muted-foreground text-xs">
						兩段之間(同樣要重疊在不同軌道)
					</span>
					<div className="flex flex-wrap gap-1">
						{PAIR_DIRECTIONS.map((d) => (
							<Button
								key={d.direction}
								size="sm"
								variant={pairDirection === d.direction ? "default" : "outline"}
								onClick={() => setPairDirection(d.direction)}
							>
								{d.label}
							</Button>
						))}
					</div>
					{PAIR_KINDS.map((k) => (
						<Button
							key={k.kind}
							variant="outline"
							className="h-auto flex-col items-start gap-0.5 py-2"
							onClick={() => applyPair(k.kind)}
						>
							<span>{k.label}</span>
							<span className="text-muted-foreground text-left text-xs font-normal whitespace-normal">
								{k.hint}
							</span>
						</Button>
					))}
					<span className="text-muted-foreground text-xs">
						方向是畫面內容移動的方向(縮放不分方向)。
					</span>
				</div>
				<div className="flex flex-col gap-2">
					<span className="text-muted-foreground text-xs">
						兩段之間的擦除(要重疊在不同軌道;方向用上面的箭頭 = 擦除前進方向)
					</span>
					<div className="flex flex-wrap gap-1">
						{WIPE_SOFTNESS.map((option) => (
							<Button
								key={option.value}
								size="sm"
								variant={wipeSoftness === option.value ? "default" : "outline"}
								onClick={() => setWipeSoftness(option.value)}
							>
								{option.label}
							</Button>
						))}
						<Button
							size="sm"
							variant={wipeReverse ? "default" : "outline"}
							onClick={() => setWipeReverse((value) => !value)}
						>
							反向
						</Button>
					</div>
					<div className="grid grid-cols-2 gap-1">
						{WIPE_KINDS_UI.map((k) => (
							<Button
								key={k.kind}
								variant="outline"
								className="h-auto flex-col items-start gap-0.5 py-2"
								title={k.hint}
								onClick={() => applyWipe(k.kind)}
							>
								<span>{k.label}</span>
								<span className="text-muted-foreground text-left text-xs font-normal whitespace-normal">
									{k.hint}
								</span>
							</Button>
						))}
					</div>
					<span className="text-muted-foreground text-xs">
						在上層那一段加「擦除」特效並對進度做關鍵影格,之後可在特效屬性裡調整;轉場以外的時間特效不會多跑一個 pass。
					</span>
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
						onClick={() =>
							apply({ sides: [side], randomSeed: Math.floor(Math.random() * 1_000_000) })
						}
					>
						<span>隨機轉場(每個片段抽一種)</span>
						<span className="text-muted-foreground text-left text-xs font-normal whitespace-normal">
							選取多個片段(例如快剪切出的小段),每段在上面選的「進場 / 出場」位置各抽一種滑動、縮放、旋轉或彈出,相鄰不重複。長度太長會自動縮到片段一半。每按一次重抽;一次復原。
						</span>
					</Button>
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
