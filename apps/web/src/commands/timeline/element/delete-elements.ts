import { Command, type CommandResult } from "@/commands/base-command";
import type { SceneTracks } from "@/timeline";
import { EditorCore } from "@/core";
import type { TimelineTrack } from "@/timeline";
import { applyRippleAdjustments, computeRippleAdjustments } from "@/ripple";

function removeTrackElements<TTrack extends TimelineTrack>({
	track,
	elements,
}: {
	track: TTrack;
	elements: { trackId: string; elementId: string }[];
}): TTrack {
	const nextElements = track.elements.filter(
		(element) =>
			!elements.some(
				(target) =>
					target.trackId === track.id && target.elementId === element.id,
			),
	);

	return { ...track, elements: nextElements } as TTrack;
}

export class DeleteElementsCommand extends Command {
	private savedState: SceneTracks | null = null;
	private readonly elements: { trackId: string; elementId: string }[];
	/** 波紋刪除:刪掉後把同軌後面的片段往前補上空隙 */
	private readonly ripple: boolean;

	constructor({
		elements,
		ripple = false,
	}: {
		elements: { trackId: string; elementId: string }[];
		ripple?: boolean;
	}) {
		super();
		this.elements = elements;
		this.ripple = ripple;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.savedState = editor.scenes.getActiveScene().tracks;

		const updatedTracks: SceneTracks = {
			overlay: this.savedState.overlay.map((track) =>
				removeTrackElements({ track, elements: this.elements }),
			),
			main: removeTrackElements({
				track: this.savedState.main,
				elements: this.elements,
			}),
			audio: this.savedState.audio.map((track) =>
				removeTrackElements({ track, elements: this.elements }),
			),
		};

		// 全域「連動剪輯」開著時 CommandManager 會自己補空隙,這裡就不重複做
		const shouldRipple = this.ripple && !editor.command.isRippleEnabled;
		const adjustments = shouldRipple
			? computeRippleAdjustments({
					beforeTracks: this.savedState,
					afterTracks: updatedTracks,
				})
			: [];
		editor.timeline.updateTracks(
			adjustments.length > 0
				? applyRippleAdjustments({ tracks: updatedTracks, adjustments })
				: updatedTracks,
		);

		return {
			selection: {
				selectedElements: [],
				selectedKeyframes: [],
				keyframeSelectionAnchor: null,
				selectedMaskPoints: null,
			},
		};
	}

	undo(): void {
		if (this.savedState) {
			const editor = EditorCore.getInstance();
			editor.timeline.updateTracks(this.savedState);
		}
	}
}
