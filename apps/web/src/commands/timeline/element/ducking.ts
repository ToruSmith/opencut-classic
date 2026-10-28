import { Command, type CommandResult } from "@/commands/base-command";
import { upsertPathKeyframe } from "@/animation/keyframes";
import { EditorCore } from "@/core";
import type { SceneTracks, TimelineElement } from "@/timeline";
import { resolveAnimationTarget } from "@/timeline/animation-targets";
import { getElementVolume, type AudioCapableElement } from "@/timeline/audio-state";
import { planDucking, type DuckRange } from "@/timeline/ducking";
import { mediaTimeFromSeconds, mediaTimeToSeconds } from "@/wasm";

type ElementRef = { trackId: string; elementId: string };

/**
 * 自動壓低背景音:對選取的音樂片段,把音量關鍵影格改成「人聲期間壓低、結束後放開」。
 * 規劃在 timeline/ducking.ts(純函式)。會**取代**該片段原有的音量關鍵影格(基準音量不變),
 * 全部算完才更新一次時間軸狀態,單一復原步驟。
 */
export class DuckingCommand extends Command {
	private savedState: SceneTracks | null = null;
	private appliedCount = 0;
	private errorMessage: string | null = null;

	constructor(
		private readonly params: {
			targets: ElementRef[];
			voiceRanges: DuckRange[];
			duckDb: number;
			attackSeconds: number;
			releaseSeconds: number;
		},
	) {
		super();
	}

	getAppliedCount(): number {
		return this.appliedCount;
	}

	getError(): string | null {
		return this.errorMessage;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		const original = editor.scenes.getActiveScene().tracks;
		this.savedState = original;
		this.appliedCount = 0;
		this.errorMessage = null;

		const wanted = new Set(this.params.targets.map((t) => `${t.trackId}:${t.elementId}`));
		let lastError: string | null = null;

		const rewrite = <T extends { id: string; elements: unknown[] }>(track: T): T => {
			const elements = (track.elements as TimelineElement[]).map((element) => {
				if (!wanted.has(`${track.id}:${element.id}`)) return element;
				if (element.type !== "audio" && element.type !== "video") return element;
				const audio = element as AudioCapableElement;

				const plan = planDucking({
					voiceRanges: this.params.voiceRanges,
					musicStart: mediaTimeToSeconds({ time: audio.startTime }),
					musicDuration: mediaTimeToSeconds({ time: audio.duration }),
					baseDb: getElementVolume({ element: audio }),
					duckDb: this.params.duckDb,
					attackSeconds: this.params.attackSeconds,
					releaseSeconds: this.params.releaseSeconds,
				});
				if (!plan.ok) {
					lastError = plan.reason;
					return element;
				}

				// 先拿掉舊的音量關鍵影格,再依計畫寫入
				const { volume: _removed, ...otherAnimations } = (audio.animations ?? {}) as Record<string, unknown>;
				let next = { ...audio, animations: otherAnimations } as AudioCapableElement;
				for (const point of plan.keyframes) {
					const target = resolveAnimationTarget({ element: next, path: "volume" });
					if (!target) break;
					next = {
						...next,
						animations: upsertPathKeyframe({
							animations: next.animations,
							propertyPath: "volume",
							time: mediaTimeFromSeconds({ seconds: point.seconds }),
							value: point.value,
							channelLayout: target.channelLayout,
							coerceValue: target.coerceValue,
						}),
					} as AudioCapableElement;
				}
				this.appliedCount += 1;
				return next as TimelineElement;
			});
			return { ...track, elements } as T;
		};

		const updated: SceneTracks = {
			overlay: original.overlay.map((track) => rewrite(track)),
			main: rewrite(original.main),
			audio: original.audio.map((track) => rewrite(track)),
		};
		if (this.appliedCount === 0) {
			this.errorMessage = lastError ?? "沒有可套用的音樂片段";
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
