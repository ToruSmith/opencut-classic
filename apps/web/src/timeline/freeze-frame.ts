import { toast } from "sonner";
import type { EditorCore } from "@/core";
import { buildConstantRetime } from "@/retime";
import { MIN_RETIME_RATE } from "@/retime/rate";
import { TICKS_PER_SECOND, roundMediaTime, type MediaTime } from "@/wasm";

const DEFAULT_HOLD_SECONDS = 2;

/**
 * 定格:把播放頭所在的那一格停住 `holdSeconds` 秒,
 * 後面的片段會自動往後推。做法:切出「一格」的小片段,再把它減速到幾乎靜止。
 * 注意:每格最多可拉長約 100 倍(30fps 約 3.3 秒)。
 */
export function freezeFrameAtPlayhead({
	editor,
	holdSeconds = DEFAULT_HOLD_SECONDS,
}: {
	editor: EditorCore;
	holdSeconds?: number;
}): void {
	const selected = editor.selection.getSelectedElements();
	const items = editor.timeline.getElementsWithTracks({ elements: selected });
	const target = items.length === 1 ? items[0] : null;
	if (!target || target.element.type !== "video") {
		toast.error("請先選取一段影片");
		return;
	}

	const fps = editor.project.getActive()?.settings.fps;
	if (!fps) return;
	const frameTicks = Math.round((TICKS_PER_SECOND * fps.denominator) / fps.numerator);
	const frameSeconds = frameTicks / TICKS_PER_SECOND;

	const { track, element } = target;
	const now = editor.playback.getCurrentTime();
	const t = roundMediaTime({ time: now });
	const end = element.startTime + element.duration;
	if (t <= element.startTime || t + frameTicks >= end) {
		toast.error("請把播放頭移到所選影片的中間");
		return;
	}

	const maxHold = frameSeconds / MIN_RETIME_RATE;
	const hold = Math.min(holdSeconds, maxHold);
	const rate = Math.max(MIN_RETIME_RATE, frameSeconds / hold);

	// 1) 在播放頭切開 → 右半段
	const rights = editor.timeline.splitElements({
		elements: [{ trackId: track.id, elementId: element.id }],
		splitTime: t,
	});
	if (rights.length === 0) return;

	// 2) 右半段再切一格 → 「一格」片段 F 與其後的片段
	const afterFrame = editor.timeline.splitElements({
		elements: rights,
		splitTime: roundMediaTime({ time: t + frameTicks }),
	});
	const frameRef = rights[0];

	// 3) 把 F 減速成靜止畫面(時間長度由減速規則自動算出),並靜音
	editor.timeline.updateElementRetime({
		trackId: frameRef.trackId,
		elementId: frameRef.elementId,
		retime: buildConstantRetime({ rate, maintainPitch: false }),
	});
	editor.timeline.updateElements({
		updates: [
			{
				trackId: frameRef.trackId,
				elementId: frameRef.elementId,
				patch: { muted: true } as never,
			},
		],
	});

	// 4) 把同軌道上 F 之後的片段往後推出多出來的長度
	const updatedTrack = editor.timeline.getTrackById({ trackId: frameRef.trackId });
	const frameElement = updatedTrack?.elements.find((e) => e.id === frameRef.elementId);
	if (!updatedTrack || !frameElement) return;
	const extra = frameElement.duration - frameTicks;
	if (extra <= 0) return;

	const frameEnd = roundMediaTime({ time: t + frameTicks });
	const moves = updatedTrack.elements
		.filter((e) => e.id !== frameElement.id && e.startTime >= frameEnd - 1 && e.startTime >= t + frameTicks - 1)
		.map((e) => ({
			sourceTrackId: updatedTrack.id,
			targetTrackId: updatedTrack.id,
			elementId: e.id,
			newStartTime: roundMediaTime({ time: e.startTime + extra }) as MediaTime,
		}));
	void afterFrame;
	editor.timeline.moveElements({ moves });
}
