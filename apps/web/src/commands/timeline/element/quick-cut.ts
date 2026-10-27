import { Command, type CommandResult } from "@/commands/base-command";
import { EditorCore } from "@/core";
import type { SceneTracks } from "@/timeline";
import { pickSplitTimes } from "@/timeline/bookmarks/beat-markers";
import { computeReorder, type ReorderPiece } from "@/timeline/reorder";
import type { MediaTime } from "@/wasm";
import { ReorderElementsCommand } from "./reorder-elements";
import { SplitElementsCommand } from "./split-elements";

type ElementRef = { trackId: string; elementId: string };

/**
 * 一鍵快剪(AMV):選取同一條軌道上的幾段素材 →
 *   1. 依目前順序首尾相接(補掉空隙)
 *   2. 在節拍處切開(每 N 拍、最短片段)
 *   3. 選擇性地把所有小段隨機打散
 * 全部做在同一個復原步驟裡:直接呼叫既有指令的 execute(),復原時一次還原最初的軌道。
 */
export class QuickCutCommand extends Command {
	private savedState: SceneTracks | null = null;
	private pieceCount = 0;

	constructor(
		private readonly params: {
			elements: ElementRef[];
			/** 節拍時間(tick) */
			beats: number[];
			every: number;
			/** tick;0 = 不限 */
			minGap: number;
			shuffle: boolean;
			seed: number;
		},
	) {
		super();
	}

	getPieceCount(): number {
		return this.pieceCount;
	}

	private readPieces({ elements }: { elements: ElementRef[] }): ReorderPiece[] {
		const editor = EditorCore.getInstance();
		return editor.timeline
			.getElementsWithTracks({ elements })
			.map(({ track, element }) => ({
				trackId: track.id,
				elementId: element.id,
				startTime: element.startTime,
				duration: element.duration,
			}));
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.savedState = editor.scenes.getActiveScene().tracks;
		const { elements, beats, every, minGap, shuffle, seed } = this.params;

		// 1. 首尾相接
		const packed = computeReorder({ pieces: this.readPieces({ elements }), mode: "pack" });
		if (packed.length > 0) new ReorderElementsCommand(packed).execute();

		// 2. 在節拍處切開;每個片段各自挑切點,再由後往前切(左半一直保留原 id)
		const allPieces: ElementRef[] = [...elements];
		const splitTimesByElement = new Map<string, number[]>();
		for (const piece of this.readPieces({ elements })) {
			splitTimesByElement.set(
				`${piece.trackId}:${piece.elementId}`,
				pickSplitTimes({
					beats,
					start: piece.startTime,
					end: piece.startTime + piece.duration,
					every,
					minGap,
				}),
			);
		}
		const allTimes = [...new Set([...splitTimesByElement.values()].flat())].sort((a, b) => b - a);
		for (const splitTime of allTimes) {
			const targets = elements.filter((ref) =>
				(splitTimesByElement.get(`${ref.trackId}:${ref.elementId}`) ?? []).includes(splitTime),
			);
			if (targets.length === 0) continue;
			const split = new SplitElementsCommand({
				elements: targets,
				splitTime: splitTime as MediaTime,
				keepNames: true,
			});
			split.execute();
			allPieces.push(...split.getRightSideElements());
		}
		this.pieceCount = allPieces.length;

		// 3. 打散所有小段
		if (shuffle) {
			const shuffled = computeReorder({
				pieces: this.readPieces({ elements: allPieces }),
				mode: "shuffle",
				seed,
			});
			if (shuffled.length > 0) new ReorderElementsCommand(shuffled).execute();
		}
		return undefined;
	}

	undo(): void {
		if (this.savedState) {
			EditorCore.getInstance().timeline.updateTracks(this.savedState);
		}
	}
}
