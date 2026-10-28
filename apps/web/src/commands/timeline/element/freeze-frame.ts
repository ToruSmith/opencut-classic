import { Command, type CommandResult } from "@/commands/base-command";
import { EditorCore } from "@/core";
import type { SceneTracks, TimelineElement, VideoElement } from "@/timeline";
import { FREEZE_RATE, planFreezeFrame } from "@/timeline/freeze-frame";
import { generateUUID } from "@/utils/id";
import {
	addMediaTime,
	mediaTimeFromSeconds,
	mediaTimeToSeconds,
	roundMediaTime,
	type MediaTime,
} from "@/wasm";
import { SplitElementsCommand } from "./split-elements";

/**
 * 凍結影格:在播放頭把影片切成左右兩段,中間插入 N 秒的定格段(同一支影片、0.01x、靜音),
 * 同一條軌道上播放頭之後的片段全部往後推 N 秒。其他軌道不動。
 * 切割直接呼叫 SplitElementsCommand.execute(),之後只更新一次時間軸狀態;復原時一次還原最初的軌道。
 * 規劃與限制見 timeline/freeze-frame.ts。
 */
export class FreezeFrameCommand extends Command {
	private savedState: SceneTracks | null = null;
	private errorMessage: string | null = null;
	private done = false;

	constructor(
		private readonly params: {
			trackId: string;
			elementId: string;
			/** 播放頭(時間軸時間) */
			time: MediaTime;
			seconds: number;
		},
	) {
		super();
	}

	isDone(): boolean {
		return this.done;
	}

	getError(): string | null {
		return this.errorMessage;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		const original = editor.scenes.getActiveScene().tracks;
		this.savedState = original;
		this.errorMessage = null;
		this.done = false;

		const { trackId, elementId, time, seconds } = this.params;
		const track = [original.main, ...original.overlay].find((candidate) => candidate.id === trackId);
		const element = (track?.elements as TimelineElement[] | undefined)?.find(
			(candidate) => candidate.id === elementId,
		);
		if (!element || element.type !== "video") {
			this.errorMessage = "請選一個影片片段";
			return undefined;
		}
		const video = element as VideoElement;

		const plan = planFreezeFrame({
			elementStart: mediaTimeToSeconds({ time: video.startTime }),
			elementDuration: mediaTimeToSeconds({ time: video.duration }),
			playhead: mediaTimeToSeconds({ time }),
			freezeSeconds: seconds,
		});
		if (!plan.ok) {
			this.errorMessage = plan.reason;
			return undefined;
		}

		const baseRate = video.retime?.rate ?? 1;
		// 整段素材長度(tick):trimStart + 可見素材 + trimEnd
		const totalSource = roundMediaTime({
			time: video.trimStart + video.duration * baseRate + video.trimEnd,
		});

		const split = new SplitElementsCommand({
			elements: [{ trackId, elementId }],
			splitTime: time,
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

		const sliced = editor.scenes.getActiveScene().tracks;
		const slicedTrack = [sliced.main, ...sliced.overlay].find((candidate) => candidate.id === trackId);
		const pieces = slicedTrack?.elements as TimelineElement[] | undefined;
		const rightPiece = pieces?.find((candidate) => candidate.id === right.elementId) as VideoElement | undefined;
		if (!pieces || !rightPiece) {
			this.undo();
			this.errorMessage = "切割失敗";
			return undefined;
		}

		const freezeDuration = mediaTimeFromSeconds({ seconds });
		const sourceSpan = roundMediaTime({ time: freezeDuration * FREEZE_RATE });
		const freezeTrimEnd = Math.max(0, totalSource - rightPiece.trimStart - sourceSpan) as MediaTime;
		const freeze: VideoElement = {
			...video,
			id: generateUUID(),
			name: `${video.name}(定格)`,
			startTime: time,
			duration: freezeDuration,
			trimStart: rightPiece.trimStart,
			trimEnd: freezeTrimEnd,
			retime: { rate: FREEZE_RATE, maintainPitch: false },
			isSourceAudioEnabled: false,
			animations: undefined,
		};

		const elements = [
			...pieces.map((piece) =>
				piece.startTime >= time
					? ({ ...piece, startTime: addMediaTime({ a: piece.startTime, b: freezeDuration }) } as TimelineElement)
					: piece,
			),
			freeze,
		].sort((a, b) => a.startTime - b.startTime);

		const patch = <T extends { id: string; elements: unknown[] }>(candidate: T): T =>
			candidate.id === trackId ? ({ ...candidate, elements } as T) : candidate;
		editor.timeline.updateTracks({
			...sliced,
			main: patch(sliced.main),
			overlay: sliced.overlay.map((candidate) => patch(candidate)),
		});
		this.done = true;
		return undefined;
	}

	undo(): void {
		if (this.savedState) {
			EditorCore.getInstance().timeline.updateTracks(this.savedState);
		}
	}
}
