import { Command, type CommandResult } from "@/commands/base-command";
import { EditorCore } from "@/core";
import { clampRetimeRate } from "@/retime/rate";
import { planSpeedRamp, type SpeedRampProfile } from "@/retime/speed-ramp";
import type { SceneTracks, TimelineElement, VideoElement } from "@/timeline";
import {
	addMediaTime,
	mediaTimeToSeconds,
	roundMediaTime,
	subMediaTime,
	type MediaTime,
} from "@/wasm";
import { SplitElementsCommand } from "./split-elements";

/**
 * 變速曲線(階梯式):把一個影片片段切成 N 段(素材長度相同),各段套不同的固定倍率,總長度不變。
 * 規劃在 retime/speed-ramp.ts(純函式)。切割直接呼叫 SplitElementsCommand 的 execute()(由後往前,左半一直保留原 id),
 * 之後只更新一次時間軸狀態:每段的 retime / 開始時間 / 長度,聲音可選靜音 / 保留(變調或保持音高;分段變速的聲音接縫會跳)。
 * 復原時一次還原最初的軌道,所以是單一復原步驟。
 */
export type SpeedRampAudioMode = "mute" | "pitch" | "keep-pitch";

export class SpeedRampCommand extends Command {
	private savedState: SceneTracks | null = null;
	private pieceCount = 0;
	private errorMessage: string | null = null;

	constructor(
		private readonly params: {
			trackId: string;
			elementId: string;
			profile: SpeedRampProfile;
			/** 0..1 */
			strength: number;
			segments: number;
			/** mute = 靜音;pitch = 保留聲音、隨速度變調;keep-pitch = 保留聲音、保持音高 */
			audio: SpeedRampAudioMode;
		},
	) {
		super();
	}

	getPieceCount(): number {
		return this.pieceCount;
	}

	/** 沒有套用時的原因(execute 之後讀) */
	getError(): string | null {
		return this.errorMessage;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		const original = editor.scenes.getActiveScene().tracks;
		this.savedState = original;
		this.pieceCount = 0;
		this.errorMessage = null;

		const { trackId, elementId } = this.params;
		const track = [original.main, ...original.overlay].find((candidate) => candidate.id === trackId);
		const element = (track?.elements as TimelineElement[] | undefined)?.find(
			(candidate) => candidate.id === elementId,
		);
		if (!element || element.type !== "video") {
			this.errorMessage = "請選一個影片片段";
			return undefined;
		}
		const video = element as VideoElement;
		const baseRate = clampRetimeRate({ rate: video.retime?.rate ?? 1 });
		const durationSeconds = mediaTimeToSeconds({ time: video.duration });

		const plan = planSpeedRamp({
			durationSeconds,
			baseRate,
			profile: this.params.profile,
			strength: this.params.strength,
			segments: this.params.segments,
		});
		if (!plan.ok) {
			this.errorMessage = plan.reason;
			return undefined;
		}

		// 依「原本的片段時間」等分,由後往前切(左半保留原 id)
		const count = plan.pieces.length;
		const splitTimes: MediaTime[] = [];
		for (let index = 1; index < count; index++) {
			splitTimes.push(
				addMediaTime({
					a: video.startTime,
					b: roundMediaTime({ time: (video.duration * index) / count }),
				}),
			);
		}
		const pieceIds: string[] = [elementId];
		const rightIds: string[] = [];
		for (let index = splitTimes.length - 1; index >= 0; index--) {
			const split = new SplitElementsCommand({
				elements: [{ trackId, elementId }],
				splitTime: splitTimes[index],
				retainSide: "both",
				keepNames: true,
			});
			split.execute();
			const right = split.getRightSideElements()[0];
			if (!right) {
				this.undo();
				this.errorMessage = "切割失敗";
				return undefined;
			}
			rightIds.unshift(right.elementId);
		}
		pieceIds.push(...rightIds);

		// 切完之後再算一次(取得各段實際的素材長度),只更新一次時間軸
		const sliced = editor.scenes.getActiveScene().tracks;
		const slicedTrack = [sliced.main, ...sliced.overlay].find((candidate) => candidate.id === trackId);
		const originalEnd = addMediaTime({ a: video.startTime, b: video.duration });
		let cursor: MediaTime = video.startTime;
		const edits = new Map<string, Partial<VideoElement>>();
		pieceIds.forEach((id, index) => {
			const piece = (slicedTrack?.elements as TimelineElement[] | undefined)?.find(
				(candidate) => candidate.id === id,
			) as VideoElement | undefined;
			if (!piece) return;
			const rate = plan.pieces[index].rate;
			const isLast = index === pieceIds.length - 1;
			// 單位都是 tick:素材長度 = 切出來的顯示長度 × 原倍率;新顯示長度 = 素材長度 / 新倍率
			const nextDuration = isLast
				? subMediaTime({ a: originalEnd, b: cursor })
				: roundMediaTime({ time: (piece.duration * baseRate) / rate });
			edits.set(id, {
				startTime: cursor,
				duration: nextDuration,
				retime: { rate, maintainPitch: this.params.audio === "keep-pitch" },
				...(this.params.audio === "mute" ? { isSourceAudioEnabled: false } : {}),
			});
			cursor = addMediaTime({ a: cursor, b: nextDuration });
		});

		const patch = (candidate: { id: string; elements: unknown[] }) =>
			candidate.id === trackId
				? {
						...candidate,
						elements: (candidate.elements as TimelineElement[]).map((item) => {
							const change = edits.get(item.id);
							return change ? ({ ...item, ...change } as TimelineElement) : item;
						}),
					}
				: candidate;
		editor.timeline.updateTracks({
			...sliced,
			main: patch(sliced.main) as SceneTracks["main"],
			overlay: sliced.overlay.map((candidate) => patch(candidate)) as SceneTracks["overlay"],
		});
		this.pieceCount = pieceIds.length;
		return undefined;
	}

	undo(): void {
		if (this.savedState) {
			EditorCore.getInstance().timeline.updateTracks(this.savedState);
		}
	}
}
