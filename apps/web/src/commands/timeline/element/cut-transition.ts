import { Command, type CommandResult } from "@/commands/base-command";
import { buildEffectParamPath } from "@/animation/effect-param-channel";
import { upsertPathKeyframe } from "@/animation/keyframes";
import { EditorCore } from "@/core";
import { buildDefaultEffectInstance, registerDefaultEffects } from "@/effects";
import { isVisualElement, updateElementInSceneTracks } from "@/timeline";
import type { SceneTracks, TimelineElement, VisualElement } from "@/timeline";
import { resolveAnimationTarget } from "@/timeline/animation-targets";
import {
	cutEffectId,
	planCutTransition,
	stripCutEffects,
	type CutDirection,
	type CutEffectPlan,
	type CutTransitionKind,
} from "@/transitions/cut-transition";
import { generateUUID } from "@/utils/id";
import { mediaTimeFromSeconds, mediaTimeToSeconds } from "@/wasm";

export interface CutTransitionRequest {
	trackId: string;
	outId: string;
	inId: string;
	/** null = 只清掉這個切點上的切點轉場 */
	kind: CutTransitionKind | null;
}

/**
 * 切點轉場:對每個切點,在前一段結尾、後一段開頭各加一組特效(id 以 `cut-out-` / `cut-in-` 開頭)並做關鍵影格。
 * 同一端原本的切點轉場會先拿掉,所以再按一次是「取代」不是越疊越多;片段的其他特效與關鍵影格不動。
 * 規劃在 transitions/cut-transition.ts(純函式);這裡只負責把計畫寫進片段,全部算完才更新一次時間軸狀態,單一復原步驟。
 */
export class CutTransitionCommand extends Command {
	private savedState: SceneTracks | null = null;
	private applied = 0;

	constructor(
		private readonly params: {
			cuts: CutTransitionRequest[];
			/** 每一側的秒數(總長是兩倍) */
			sideSeconds: number;
			direction: CutDirection;
			/** 0..1 */
			intensity: number;
		},
	) {
		super();
	}

	/** 實際加上轉場的切點數 */
	getAppliedCount(): number {
		return this.applied;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		const original = editor.scenes.getActiveScene().tracks;
		this.savedState = original;
		this.applied = 0;
		registerDefaultEffects();

		let tracks = original;
		const findElement = ({ trackId, elementId }: { trackId: string; elementId: string }) => {
			const all = [tracks.main, ...tracks.overlay, ...tracks.audio];
			const track = all.find((candidate) => candidate.id === trackId);
			return (track?.elements as TimelineElement[] | undefined)?.find((element) => element.id === elementId);
		};
		const update = ({
			trackId,
			elementId,
			change,
		}: {
			trackId: string;
			elementId: string;
			change: (element: VisualElement) => VisualElement;
		}) => {
			tracks = updateElementInSceneTracks({
				tracks,
				trackId,
				elementId,
				elementPredicate: isVisualElement,
				update: (element) => change(element as VisualElement),
			});
		};

		for (const cut of this.params.cuts) {
			const outElement = findElement({ trackId: cut.trackId, elementId: cut.outId });
			const inElement = findElement({ trackId: cut.trackId, elementId: cut.inId });
			if (!outElement || !inElement || !isVisualElement(outElement) || !isVisualElement(inElement)) continue;

			const plan = cut.kind
				? planCutTransition({
						kind: cut.kind,
						direction: this.params.direction,
						sideSeconds: this.params.sideSeconds,
						outClipSeconds: mediaTimeToSeconds({ time: outElement.duration }),
						inClipSeconds: mediaTimeToSeconds({ time: inElement.duration }),
						intensity: this.params.intensity,
					})
				: null;

			for (const side of ["out", "in"] as const) {
				update({
					trackId: cut.trackId,
					elementId: side === "out" ? cut.outId : cut.inId,
					change: (element) =>
						applySide({ element, side, effects: plan ? plan[side] : [] }),
				});
			}
			if (plan) this.applied += 1;
		}

		editor.timeline.updateTracks(tracks);
		return undefined;
	}

	undo(): void {
		if (this.savedState) {
			EditorCore.getInstance().timeline.updateTracks(this.savedState);
		}
	}
}

/** 拿掉這一端舊的切點轉場特效,加上新的,並寫入關鍵影格 */
function applySide({
	element,
	side,
	effects,
}: {
	element: VisualElement;
	side: "out" | "in";
	effects: CutEffectPlan[];
}): VisualElement {
	const stripped = stripCutEffects({ effects: element.effects, animations: element.animations, side });
	let next: VisualElement = { ...element, effects: stripped.effects, animations: stripped.animations };

	for (const plan of effects) {
		const instance = buildDefaultEffectInstance({ effectType: plan.effectType });
		instance.id = cutEffectId({ side, uuid: generateUUID() });
		instance.params = { ...instance.params, ...plan.params };
		next = { ...next, effects: [...(next.effects ?? []), instance] };

		for (const keyframe of plan.keyframes) {
			const propertyPath = buildEffectParamPath({ effectId: instance.id, paramKey: keyframe.paramKey });
			const target = resolveAnimationTarget({ element: next, path: propertyPath });
			if (!target) continue;
			next = {
				...next,
				animations: upsertPathKeyframe({
					animations: next.animations,
					propertyPath,
					time: mediaTimeFromSeconds({ seconds: keyframe.seconds }),
					value: keyframe.value,
					channelLayout: target.channelLayout,
					coerceValue: target.coerceValue,
				}),
			};
		}
	}
	return next;
}
