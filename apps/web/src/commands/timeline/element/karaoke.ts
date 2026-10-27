import { Command, type CommandResult } from "@/commands/base-command";
import { buildEffectParamPath } from "@/animation/effect-param-channel";
import { upsertPathKeyframe } from "@/animation/keyframes";
import { EditorCore } from "@/core";
import { buildDefaultEffectInstance, registerDefaultEffects } from "@/effects";
import { computeTextSpanFraction, planKaraokeSweep } from "@/subtitles/karaoke";
import type { SceneTracks, TextElement, TimelineElement } from "@/timeline";
import { resolveAnimationTarget } from "@/timeline/animation-targets";
import { getTextMeasurementContext, measureTextElement } from "@/text/measure-element";
import { generateUUID } from "@/utils/id";
import { mediaTimeFromSeconds, mediaTimeToSeconds } from "@/wasm";
import { AddTrackCommand } from "../track/add-track";

type ElementRef = { trackId: string; elementId: string };

function readNumber({ value, fallback }: { value: unknown; fallback: number }): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * 卡拉 OK 填色:選取的每句字幕,在上方新增一條文字軌,放一份「高亮色」的複本,
 * 複本加上擦除特效(線性掃過範圍 = 文字左右邊界),進度做關鍵影格 100 → 0,於是高亮色由左向右填滿。
 * 原本的字幕不動(當底色)。全部只更新一次時間軸狀態,單一復原步驟。
 * 邏輯在 subtitles/karaoke.ts(純函式);文字量測沿用 measureTextElement,不在渲染路徑裡重算。
 */
export class KaraokeCommand extends Command {
	private savedState: SceneTracks | null = null;
	private count = 0;

	constructor(
		private readonly params: {
			elements: ElementRef[];
			color: string;
			/** 填色佔整句長度的比例 */
			sweepFraction: number;
		},
	) {
		super();
	}

	getCount(): number {
		return this.count;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.savedState = editor.scenes.getActiveScene().tracks;
		this.count = 0;
		registerDefaultEffects();

		const canvas = editor.project.getActive().settings.canvasSize;
		const ctx = getTextMeasurementContext();
		const sources = editor.timeline
			.getElementsWithTracks({ elements: this.params.elements })
			.map(({ element }) => element)
			.filter((element): element is TextElement => element.type === "text")
			.sort((a, b) => a.startTime - b.startTime);
		if (sources.length === 0) return undefined;

		const highlights: TimelineElement[] = [];
		for (const [index, source] of sources.entries()) {
			const durationSeconds = mediaTimeToSeconds({ time: source.duration });
			const rotated = readNumber({ value: source.params["transform.rotate"], fallback: 0 }) !== 0;
			let span = { left: 0, right: 1 };
			if (!rotated) {
				const measured = measureTextElement({
					element: source,
					canvasHeight: canvas.height,
					localTime: 0,
					ctx,
				});
				span = computeTextSpanFraction({
					rectLeft: measured.visualRect.left,
					rectWidth: measured.visualRect.width,
					positionX: readNumber({ value: source.params["transform.positionX"], fallback: 0 }),
					scaleX: readNumber({ value: source.params["transform.scaleX"], fallback: 1 }),
					canvasWidth: canvas.width,
				});
			}
			const sweep = planKaraokeSweep({
				span,
				durationSeconds,
				sweepFraction: this.params.sweepFraction,
			});
			if (!sweep) continue;

			const wipe = buildDefaultEffectInstance({ effectType: "wipe" });
			wipe.params = { ...wipe.params, ...sweep.params };
			let highlight: TextElement = {
				...source,
				id: generateUUID(),
				name: `卡拉OK ${index + 1}`,
				params: { ...source.params, color: this.params.color },
				effects: [...(source.effects ?? []), wipe],
			};
			const propertyPath = buildEffectParamPath({ effectId: wipe.id, paramKey: "progress" });
			for (const keyframe of sweep.keyframes) {
				const target = resolveAnimationTarget({ element: highlight, path: propertyPath });
				if (!target) continue;
				highlight = {
					...highlight,
					animations: upsertPathKeyframe({
						animations: highlight.animations,
						propertyPath,
						time: mediaTimeFromSeconds({ seconds: keyframe.seconds }),
						value: keyframe.value,
						channelLayout: target.channelLayout,
						coerceValue: target.coerceValue,
					}),
				};
			}
			highlights.push(highlight);
		}
		if (highlights.length === 0) return undefined;

		const addTrack = new AddTrackCommand({ type: "text", index: 0 });
		addTrack.execute();
		const trackId = addTrack.getTrackId();
		const current = editor.scenes.getActiveScene().tracks;
		editor.timeline.updateTracks({
			...current,
			overlay: current.overlay.map((track) =>
				track.id === trackId
					? ({ ...track, elements: [...track.elements, ...highlights] } as typeof track)
					: track,
			),
		});
		this.count = highlights.length;
		return undefined;
	}

	undo(): void {
		if (this.savedState) {
			EditorCore.getInstance().timeline.updateTracks(this.savedState);
		}
	}
}
