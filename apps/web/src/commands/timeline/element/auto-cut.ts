import { Command, type CommandResult } from "@/commands/base-command";
import { EditorCore } from "@/core";
import type { SceneTracks, TimelineElement } from "@/timeline";
import type { AutoCutPiece } from "@/timeline/auto-cut";
import { buildElementFromMedia } from "@/timeline/element-utils";
import { generateUUID } from "@/utils/id";
import { mediaTime } from "@/wasm";
import { AddTrackCommand } from "../track/add-track";

/**
 * 自動排片:建立一條新的影片軌,把規劃好的片段一次放進去(只更新兩次時間軸狀態,不是每個片段一次),
 * 單一復原步驟。`replaceTrackId` 有值且那條軌道還在時,先移除它(「換種子重排」不會越疊越多)。
 * 影片素材預設靜音(音樂才是主聲軌)。
 */
export class AutoCutCommand extends Command {
	private savedState: SceneTracks | null = null;
	private trackId: string | null = null;

	constructor(
		private readonly params: {
			pieces: AutoCutPiece[];
			assets: Array<{ id: string; name: string }>;
			replaceTrackId?: string;
		},
	) {
		super();
	}

	getTrackId(): string | null {
		return this.trackId;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.savedState = editor.scenes.getActiveScene().tracks;
		const { pieces, assets, replaceTrackId } = this.params;
		const names = new Map(assets.map((asset) => [asset.id, asset.name]));

		if (replaceTrackId) {
			const base = this.savedState;
			if (base.overlay.some((track) => track.id === replaceTrackId)) {
				editor.timeline.updateTracks({
					...base,
					overlay: base.overlay.filter((track) => track.id !== replaceTrackId),
				});
			}
		}

		const addTrack = new AddTrackCommand({ type: "video", index: 0 });
		addTrack.execute();
		this.trackId = addTrack.getTrackId();
		const trackId = this.trackId;

		const elements = pieces.map((piece) => {
			const built = buildElementFromMedia({
				mediaId: piece.sourceId,
				mediaType: piece.kind,
				name: names.get(piece.sourceId) ?? "素材",
				duration: mediaTime({ ticks: piece.duration }),
				startTime: mediaTime({ ticks: piece.startTime }),
			});
			const element = {
				...built,
				id: generateUUID(),
				trimStart: mediaTime({ ticks: piece.trimStart }),
				trimEnd: mediaTime({ ticks: piece.trimEnd }),
				...(piece.kind === "video"
					? {
							sourceDuration: mediaTime({ ticks: piece.sourceDuration ?? piece.duration }),
							isSourceAudioEnabled: false,
						}
					: {}),
			};
			return element as unknown as TimelineElement;
		});

		const current = editor.scenes.getActiveScene().tracks;
		editor.timeline.updateTracks({
			...current,
			overlay: current.overlay.map((track) =>
				track.id === trackId
					? ({ ...track, elements: [...track.elements, ...elements] } as typeof track)
					: track,
			),
		});
		return undefined;
	}

	undo(): void {
		if (this.savedState) {
			EditorCore.getInstance().timeline.updateTracks(this.savedState);
		}
	}
}
