import { Command, type CommandResult } from "@/commands/base-command";
import { EditorCore } from "@/core";
import type { SceneTracks, TimelineElement, TimelineTrack } from "@/timeline";
import type { ReorderPlacement } from "@/timeline/reorder";
import type { MediaTime } from "@/wasm";

/**
 * 一次設定多個片段的開始時間(重排用)。
 * 刻意不走 UpdateElementsCommand:它逐筆套用,主軌的「最早片段貼齊 0」規則會在中途狀態誤判。
 * 這裡直接一次換掉整批,結果由呼叫端(computeReorder)保證不重疊。
 */
export class ReorderElementsCommand extends Command {
	private savedState: SceneTracks | null = null;

	constructor(private readonly placements: ReorderPlacement[]) {
		super();
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.savedState = editor.scenes.getActiveScene().tracks;
		const startByKey = new Map(
			this.placements.map((p) => [`${p.trackId}:${p.elementId}`, p.startTime]),
		);

		const updateTrack = <TTrack extends TimelineTrack>(track: TTrack): TTrack => {
			if (!this.placements.some((p) => p.trackId === track.id)) return track;
			const elements = track.elements.map((element): TimelineElement => {
				const start = startByKey.get(`${track.id}:${element.id}`);
				return start === undefined
					? element
					: ({ ...element, startTime: start as MediaTime } as TimelineElement);
			});
			return { ...track, elements } as TTrack;
		};

		editor.timeline.updateTracks({
			overlay: this.savedState.overlay.map(updateTrack),
			main: updateTrack(this.savedState.main),
			audio: this.savedState.audio.map(updateTrack),
		});
		return undefined;
	}

	undo(): void {
		if (this.savedState) {
			EditorCore.getInstance().timeline.updateTracks(this.savedState);
		}
	}
}
