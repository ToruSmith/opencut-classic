import { Command, type CommandResult } from "@/commands/base-command";
import { upsertPathKeyframe } from "@/animation/keyframes";
import { EditorCore } from "@/core";
import { isVisualElement } from "@/timeline";
import type { SceneTracks, TimelineElement, VisualElement } from "@/timeline";
import { resolveAnimationTarget } from "@/timeline/animation-targets";
import { planBeatPulse } from "@/timeline/beat-pulse";
import { mediaTimeFromSeconds, mediaTimeToSeconds } from "@/wasm";

type ElementRef = { trackId: string; elementId: string };

const SCALE_PATHS = ["transform.scaleX", "transform.scaleY"] as const;

/**
 * 節拍脈衝:對選取的畫面類片段,依節拍(秒,時間軸時間)在縮放上做「瞬間放大再收回」的關鍵影格。
 * 規劃在 timeline/beat-pulse.ts(純函式)。會**取代**這些片段原有的縮放關鍵影格(倍率乘在片段目前的縮放上),
 * 全部算完才更新一次時間軸狀態,單一復原步驟。
 */
export class BeatPulseCommand extends Command {
	private savedState: SceneTracks | null = null;
	private appliedCount = 0;
	private pulseCount = 0;
	private errorMessage: string | null = null;

	constructor(
		private readonly params: {
			elements: ElementRef[];
			/** 時間軸上的節拍時間(秒) */
			beats: number[];
			every: number;
			strength: number;
			decaySeconds: number;
		},
	) {
		super();
	}

	getAppliedCount(): number {
		return this.appliedCount;
	}

	getPulseCount(): number {
		return this.pulseCount;
	}

	getError(): string | null {
		return this.errorMessage;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		const original = editor.scenes.getActiveScene().tracks;
		this.savedState = original;
		this.appliedCount = 0;
		this.pulseCount = 0;
		this.errorMessage = null;

		const wanted = new Set(this.params.elements.map((ref) => `${ref.trackId}:${ref.elementId}`));
		let lastError: string | null = null;

		const rewrite = <T extends { id: string; elements: unknown[] }>(track: T): T => {
			const elements = (track.elements as TimelineElement[]).map((element) => {
				if (!wanted.has(`${track.id}:${element.id}`) || !isVisualElement(element)) return element;

				const plan = planBeatPulse({
					beats: this.params.beats,
					clipStart: mediaTimeToSeconds({ time: element.startTime }),
					clipDuration: mediaTimeToSeconds({ time: element.duration }),
					every: this.params.every,
					strength: this.params.strength,
					decaySeconds: this.params.decaySeconds,
				});
				if (!plan.ok) {
					lastError = plan.reason;
					return element;
				}

				let next: VisualElement = element;
				// 先拿掉舊的縮放關鍵影格
				if (next.animations) {
					const rest = { ...(next.animations as Record<string, unknown>) };
					for (const path of SCALE_PATHS) delete rest[path];
					next = { ...next, animations: rest as VisualElement["animations"] };
				}
				for (const path of SCALE_PATHS) {
					const baseValue = typeof next.params[path] === "number" ? (next.params[path] as number) : 1;
					for (const point of plan.keyframes) {
						const target = resolveAnimationTarget({ element: next, path });
						if (!target) break;
						next = {
							...next,
							animations: upsertPathKeyframe({
								animations: next.animations,
								propertyPath: path,
								time: mediaTimeFromSeconds({ seconds: point.seconds }),
								value: baseValue * point.factor,
								channelLayout: target.channelLayout,
								coerceValue: target.coerceValue,
							}),
						};
					}
				}
				this.appliedCount += 1;
				this.pulseCount += plan.pulses;
				return next as TimelineElement;
			});
			return { ...track, elements } as T;
		};

		const updated: SceneTracks = {
			overlay: original.overlay.map((track) => rewrite(track)),
			main: rewrite(original.main),
			audio: original.audio,
		};
		if (this.appliedCount === 0) {
			this.errorMessage = lastError ?? "請選取畫面類的片段(影片、圖片、文字…)";
			return undefined;
		}
		editor.timeline.updateTracks(updated);
		return undefined;
	}

	undo(): void {
		if (this.savedState) {
			EditorCore.getInstance().timeline.updateTracks(this.savedState);
		}
	}
}
