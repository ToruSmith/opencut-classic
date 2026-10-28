import type { EditorCore } from "@/core";
import type { ElementBounds } from "@/preview/element-bounds";
import type { ParamValues } from "@/params";
import type {
	SceneTracks,
	TrackType,
	TimelineTrack,
	TimelineElement,
	RetimeConfig,
} from "@/timeline";
import { calculateTotalDuration } from "@/timeline";
import { TimelineDragSource } from "@/timeline/drag-source";
import { findTrackInSceneTracks } from "@/timeline/track-element-update";
import { lastFrameMediaTime, type MediaTime, ZERO_MEDIA_TIME } from "@/wasm";
import {
	canElementBeHidden,
	canElementHaveAudio,
} from "@/timeline/element-utils";
import { isElementMuted } from "@/timeline/audio-state";
import type {
	AnimationPath,
	AnimationInterpolation,
	ScalarCurveKeyframePatch,
} from "@/animation/types";
import type { ParamValue } from "@/params";
import {
	getElementLocalTime,
	resolveAnimationPathValueAtTime,
} from "@/animation";
import { resolveAnimationTarget } from "@/timeline/animation-targets";
import { BatchCommand } from "@/commands";
import { computeReorder, type ReorderMode, type ReorderPiece } from "@/timeline/reorder";
import {
	AddTrackCommand,
	RemoveTrackCommand,
	ToggleTrackMuteCommand,
	ToggleTrackVisibilityCommand,
	InsertElementCommand,
	DeleteElementsCommand,
	DuplicateElementsCommand,
	UpdateElementsCommand,
	SplitElementsCommand,
	MoveElementCommand,
	ReorderElementsCommand,
	QuickCutCommand,
	AutoCutCommand,
	KaraokeCommand,
	CutTransitionCommand,
	SpeedRampCommand,
	BeatPulseCommand,
	TracksSnapshotCommand,
	UpsertKeyframeCommand,
	RemoveKeyframeCommand,
	RetimeKeyframeCommand,
	UpdateScalarKeyframeCurveCommand,
	AddClipEffectCommand,
	ApplyWipeCommand,
	DeleteFreeformPathMaskPointsCommand,
	InsertFreeformPathMaskPointCommand,
	RemoveClipEffectCommand,
	UpdateClipEffectParamsCommand,
	ToggleClipEffectCommand,
	ReorderClipEffectsCommand,
	RemoveMaskCommand,
	ToggleMaskInvertedCommand,
	UpsertEffectParamKeyframeCommand,
	RemoveEffectParamKeyframeCommand,
	ToggleSourceAudioSeparationCommand,
} from "@/commands/timeline";
import type { InsertElementParams } from "@/commands/timeline/element/insert-element";
import type {
	PlannedElementMove,
	PlannedTrackCreation,
} from "@/timeline/group-move";

export class TimelineManager {
	private listeners = new Set<() => void>();
	private previewOverlay = new Map<string, Partial<TimelineElement>>();
	private previewTracks: SceneTracks | null = null;
	public readonly dragSource = new TimelineDragSource();

	constructor(private editor: EditorCore) {}

	addTrack({ type, index }: { type: TrackType; index?: number }): string {
		const command = new AddTrackCommand({ type, index });
		this.editor.command.execute({ command });
		return command.getTrackId();
	}

	removeTrack({ trackId }: { trackId: string }): void {
		const command = new RemoveTrackCommand(trackId);
		this.editor.command.execute({ command });
	}

	insertElement({ element, placement }: InsertElementParams): void {
		const command = new InsertElementCommand({ element, placement });
		this.editor.command.execute({ command });
	}

	/** 一次插入多個元素,合成一個復原步驟(例如效果組合) */
	insertElements({ items }: { items: InsertElementParams[] }): void {
		if (items.length === 0) return;
		const commands = items.map(
			({ element, placement }) => new InsertElementCommand({ element, placement }),
		);
		const command = commands.length === 1 ? commands[0] : new BatchCommand(commands);
		this.editor.command.execute({ command });
	}

	updateElementTrim({
		elementId,
		trimStart,
		trimEnd,
		startTime,
		duration,
		pushHistory = true,
	}: {
		elementId: string;
		trimStart: MediaTime;
		trimEnd: MediaTime;
		startTime?: MediaTime;
		duration?: MediaTime;
		pushHistory?: boolean;
	}): void {
		const trackId = this.findTrackIdForElement({ elementId });
		if (!trackId) {
			return;
		}

		const nextUpdates: Partial<TimelineElement> = {
			trimStart,
			trimEnd,
		};
		if (startTime !== undefined) {
			nextUpdates.startTime = startTime;
		}
		if (duration !== undefined) {
			nextUpdates.duration = duration;
		}

		this.updateElements({
			updates: [
				{
					trackId,
					elementId,
					patch: nextUpdates,
				},
			],
			pushHistory,
		});
	}

	updateElementRetime({
		trackId,
		elementId,
		retime,
		pushHistory = true,
	}: {
		trackId: string;
		elementId: string;
		retime?: RetimeConfig;
		pushHistory?: boolean;
	}): void {
		this.updateElements({
			updates: [
				{
					trackId,
					elementId,
					patch: {
						retime,
					},
				},
			],
			pushHistory,
		});
	}

	moveElements({
		moves,
		createTracks,
	}: {
		moves: PlannedElementMove[];
		createTracks?: PlannedTrackCreation[];
	}): void {
		if (moves.length === 0) {
			return;
		}

		const command = new MoveElementCommand({
			moves,
			createTracks,
		});
		this.editor.command.execute({ command });
	}

	toggleTrackMute({ trackId }: { trackId: string }): void {
		const command = new ToggleTrackMuteCommand(trackId);
		this.editor.command.execute({ command });
	}

	toggleTrackVisibility({ trackId }: { trackId: string }): void {
		const command = new ToggleTrackVisibilityCommand(trackId);
		this.editor.command.execute({ command });
	}

	splitElements({
		elements,
		splitTime,
		retainSide = "both",
	}: {
		elements: { trackId: string; elementId: string }[];
		splitTime: MediaTime;
		retainSide?: "both" | "left" | "right";
	}): { trackId: string; elementId: string }[] {
		const command = new SplitElementsCommand({
			elements,
			splitTime,
			retainSide,
		});
		this.editor.command.execute({ command });
		return command.getRightSideElements();
	}

	/**
	 * 在多個時間點切開同一批片段,合成一個復原步驟。
	 * 由後往前切:左半一直保留原本的 id,下一刀還能對同一個片段下手。
	 */
	splitElementsAtTimes({
		elements,
		splitTimes,
	}: {
		elements: { trackId: string; elementId: string }[];
		splitTimes: MediaTime[];
	}): void {
		const times = [...new Set(splitTimes)].sort((a, b) => b - a);
		if (times.length === 0 || elements.length === 0) return;
		const commands = times.map(
			(splitTime) =>
				new SplitElementsCommand({ elements, splitTime, keepNames: true }),
		);
		const command = commands.length === 1 ? commands[0] : new BatchCommand(commands);
		this.editor.command.execute({ command });
	}

	/** 重排選取的片段(同軌道內打散或反轉),一個復原步驟;回傳實際移動的片段數 */
	reorderElements({
		elements,
		mode,
		seed,
	}: {
		elements: { trackId: string; elementId: string }[];
		mode: ReorderMode;
		seed?: number;
	}): number {
		const pieces: ReorderPiece[] = [];
		for (const { element, track } of this.getElementsWithTracks({ elements })) {
			pieces.push({
				trackId: track.id,
				elementId: element.id,
				startTime: element.startTime,
				duration: element.duration,
			});
		}
		const placements = computeReorder({ pieces, mode, seed });
		if (placements.length === 0) return 0;
		this.editor.command.execute({ command: new ReorderElementsCommand(placements) });
		return placements.length;
	}

	/** 一鍵快剪:首尾相接 → 依節拍切 → 選擇性打散,一個復原步驟;回傳切出的片段數 */
	quickCut(params: ConstructorParameters<typeof QuickCutCommand>[0]): number {
		const command = new QuickCutCommand(params);
		this.editor.command.execute({ command });
		return command.getPieceCount();
	}

	/** 自動排片:新增一條影片軌並放入規劃好的片段,一個復原步驟;回傳新軌道 id */
	autoCut(params: ConstructorParameters<typeof AutoCutCommand>[0]): string | null {
		const command = new AutoCutCommand(params);
		this.editor.command.execute({ command });
		return command.getTrackId();
	}

	/** 卡拉 OK 填色:對選取的字幕加上一層會隨時間填色的複本,一個復原步驟;回傳處理的句數 */
	applyKaraoke(params: ConstructorParameters<typeof KaraokeCommand>[0]): number {
		const command = new KaraokeCommand(params);
		this.editor.command.execute({ command });
		return command.getCount();
	}

	/** 切點轉場;回傳實際套用的切點數 */
	applyCutTransitions(params: ConstructorParameters<typeof CutTransitionCommand>[0]): number {
		const command = new CutTransitionCommand(params);
		this.editor.command.execute({ command });
		return command.getAppliedCount();
	}

	/** 變速曲線(階梯式);回傳切出的段數(0 = 沒套用,原因在 error) */
	applySpeedRamp(params: ConstructorParameters<typeof SpeedRampCommand>[0]): {
		pieces: number;
		error: string | null;
	} {
		const command = new SpeedRampCommand(params);
		this.editor.command.execute({ command });
		return { pieces: command.getPieceCount(), error: command.getError() };
	}

	/** 節拍脈衝(踩點縮放);回傳套用的片段數與脈衝數(applied 為 0 時原因在 error) */
	applyBeatPulse(params: ConstructorParameters<typeof BeatPulseCommand>[0]): {
		applied: number;
		pulses: number;
		error: string | null;
	} {
		const command = new BeatPulseCommand(params);
		this.editor.command.execute({ command });
		return {
			applied: command.getAppliedCount(),
			pulses: command.getPulseCount(),
			error: command.getError(),
		};
	}

	getTotalDuration(): MediaTime {
		const activeScene = this.editor.scenes.getActiveSceneOrNull();
		if (!activeScene) {
			return ZERO_MEDIA_TIME;
		}

		return calculateTotalDuration({ tracks: activeScene.tracks });
	}

	getLastFrameTime(): MediaTime {
		const duration = this.getTotalDuration();
		const fps = this.editor.project.getActive()?.settings.fps;
		if (!fps || duration <= 0) return duration;
		return lastFrameMediaTime({ duration, fps });
	}

	getTrackById({ trackId }: { trackId: string }): TimelineTrack | null {
		const activeScene = this.editor.scenes.getActiveSceneOrNull();
		if (!activeScene) {
			return null;
		}

		return findTrackInSceneTracks({ tracks: activeScene.tracks, trackId });
	}

	getElementsWithTracks({
		elements,
	}: {
		elements: { trackId: string; elementId: string }[];
	}): Array<{ track: TimelineTrack; element: TimelineElement }> {
		const result: Array<{ track: TimelineTrack; element: TimelineElement }> =
			[];

		for (const { trackId, elementId } of elements) {
			const track = this.getTrackById({ trackId });
			const element = track?.elements.find(
				(trackElement) => trackElement.id === elementId,
			);

			if (track && element) {
				result.push({ track, element });
			}
		}

		return result;
	}

	deleteElements({
		elements,
		ripple = false,
	}: {
		elements: { trackId: string; elementId: string }[];
		ripple?: boolean;
	}): void {
		const command = new DeleteElementsCommand({ elements, ripple });
		this.editor.command.execute({ command });
	}

	toggleSourceAudioSeparation({
		trackId,
		elementId,
	}: {
		trackId: string;
		elementId: string;
	}): void {
		const command = new ToggleSourceAudioSeparationCommand({
			trackId,
			elementId,
		});
		this.editor.command.execute({ command });
	}

	updateElements({
		updates,
		pushHistory = true,
	}: {
		updates: Array<{
			trackId: string;
			elementId: string;
			patch: Partial<TimelineElement>;
		}>;
		pushHistory?: boolean;
	}): void {
		if (updates.length === 0) {
			return;
		}

		const command = new UpdateElementsCommand({
			updates,
		});
		if (pushHistory) {
			this.editor.command.execute({ command });
		} else {
			command.execute();
		}
	}

	/** 加「擦除」特效並對進度做關鍵影格(單一復原步驟) */
	applyWipeTransition({
		trackId,
		elementId,
		params,
		progressKeyframes,
	}: {
		trackId: string;
		elementId: string;
		params: ParamValues;
		progressKeyframes: Array<{ time: MediaTime; value: number }>;
	}): void {
		this.editor.command.execute({
			command: new ApplyWipeCommand({
				trackId,
				elementId,
				params,
				progressKeyframes,
			}),
		});
	}

	addClipEffect({
		trackId,
		elementId,
		effectType,
	}: {
		trackId: string;
		elementId: string;
		effectType: string;
	}): string {
		const command = new AddClipEffectCommand({
			trackId,
			elementId,
			effectType,
		});
		this.editor.command.execute({ command });
		return command.getEffectId() ?? "";
	}

	removeClipEffect({
		trackId,
		elementId,
		effectId,
	}: {
		trackId: string;
		elementId: string;
		effectId: string;
	}): void {
		const command = new RemoveClipEffectCommand({
			trackId,
			elementId,
			effectId,
		});
		this.editor.command.execute({ command });
	}

	removeMask({
		trackId,
		elementId,
		maskId,
	}: {
		trackId: string;
		elementId: string;
		maskId: string;
	}): void {
		const command = new RemoveMaskCommand({
			trackId,
			elementId,
			maskId,
		});
		this.editor.command.execute({ command });
	}

	deleteFreeformPathMaskPoints({
		trackId,
		elementId,
		maskId,
		pointIds,
	}: {
		trackId: string;
		elementId: string;
		maskId: string;
		pointIds: string[];
	}): void {
		if (pointIds.length === 0) {
			return;
		}
		const command = new DeleteFreeformPathMaskPointsCommand({
			trackId,
			elementId,
			maskId,
			pointIds,
		});
		this.editor.command.execute({ command });
	}

	insertFreeformPathMaskPoint({
		trackId,
		elementId,
		maskId,
		segmentIndex,
		canvasPoint,
		bounds,
	}: {
		trackId: string;
		elementId: string;
		maskId: string;
		segmentIndex: number;
		canvasPoint: { x: number; y: number };
		bounds: ElementBounds;
	}): void {
		const command = new InsertFreeformPathMaskPointCommand({
			trackId,
			elementId,
			maskId,
			segmentIndex,
			canvasPoint,
			bounds,
		});
		this.editor.command.execute({ command });
	}

	updateClipEffectParams({
		trackId,
		elementId,
		effectId,
		params,
		pushHistory = true,
	}: {
		trackId: string;
		elementId: string;
		effectId: string;
		params: Partial<ParamValues>;
		pushHistory?: boolean;
	}): void {
		const command = new UpdateClipEffectParamsCommand({
			trackId,
			elementId,
			effectId,
			params,
		});
		if (pushHistory) {
			this.editor.command.execute({ command });
		} else {
			command.execute();
		}
	}

	toggleClipEffect({
		trackId,
		elementId,
		effectId,
	}: {
		trackId: string;
		elementId: string;
		effectId: string;
	}): void {
		const command = new ToggleClipEffectCommand({
			trackId,
			elementId,
			effectId,
		});
		this.editor.command.execute({ command });
	}

	toggleMaskInverted({
		trackId,
		elementId,
		maskId,
	}: {
		trackId: string;
		elementId: string;
		maskId: string;
	}): void {
		const command = new ToggleMaskInvertedCommand({
			trackId,
			elementId,
			maskId,
		});
		this.editor.command.execute({ command });
	}

	reorderClipEffects({
		trackId,
		elementId,
		fromIndex,
		toIndex,
	}: {
		trackId: string;
		elementId: string;
		fromIndex: number;
		toIndex: number;
	}): void {
		const command = new ReorderClipEffectsCommand({
			trackId,
			elementId,
			fromIndex,
			toIndex,
		});
		this.editor.command.execute({ command });
	}

	upsertKeyframes({
		keyframes,
	}: {
		keyframes: Array<{
			trackId: string;
			elementId: string;
			propertyPath: AnimationPath;
			time: MediaTime;
			value: ParamValue;
			interpolation?: AnimationInterpolation;
			keyframeId?: string;
		}>;
	}): void {
		if (keyframes.length === 0) {
			return;
		}

		const commands = keyframes.map(
			({
				trackId,
				elementId,
				propertyPath,
				time,
				value,
				interpolation,
				keyframeId,
			}) =>
				new UpsertKeyframeCommand({
					trackId,
					elementId,
					propertyPath,
					time,
					value,
					interpolation,
					keyframeId,
				}),
		);
		const command =
			commands.length === 1 ? commands[0] : new BatchCommand(commands);
		this.editor.command.execute({ command });
	}

	/**
	 * 一次套用參數修改與關鍵影格(例如交叉溶解),合成一個復原步驟。
	 * 參數修改先做、關鍵影格後做;params 會整包取代,呼叫端要帶上原本的其他參數。
	 */
	applyElementEdits({
		paramUpdates,
		keyframes,
	}: {
		paramUpdates: Array<{
			trackId: string;
			elementId: string;
			params: ParamValues;
		}>;
		keyframes: Array<{
			trackId: string;
			elementId: string;
			propertyPath: AnimationPath;
			time: MediaTime;
			value: ParamValue;
		}>;
	}): void {
		const commands = [
			...(paramUpdates.length > 0
				? [
						new UpdateElementsCommand({
							updates: paramUpdates.map(({ trackId, elementId, params }) => ({
								trackId,
								elementId,
								patch: { params },
							})),
						}),
					]
				: []),
			...keyframes.map(
				({ trackId, elementId, propertyPath, time, value }) =>
					new UpsertKeyframeCommand({
						trackId,
						elementId,
						propertyPath,
						time,
						value,
					}),
			),
		];
		if (commands.length === 0) return;
		const command =
			commands.length === 1 ? commands[0] : new BatchCommand(commands);
		this.editor.command.execute({ command });
	}

	removeKeyframes({
		keyframes,
	}: {
		keyframes: Array<{
			trackId: string;
			elementId: string;
			propertyPath: AnimationPath;
			keyframeId: string;
		}>;
	}): void {
		if (keyframes.length === 0) {
			return;
		}

		// Pre-sample values at playhead for each (element, property) pair.
		// This preserves "what you see is what you get" when all keyframes are deleted.
		const playheadTime = this.editor.playback.getCurrentTime();
		const valueAtPlayheadMap = new Map<string, ParamValue | null>();

		for (const { trackId, elementId, propertyPath } of keyframes) {
			const key = `${elementId}:${propertyPath}`;
			if (valueAtPlayheadMap.has(key)) {
				continue;
			}

			const element = this.getElementByRef({ trackId, elementId });
			if (!element) {
				valueAtPlayheadMap.set(key, null);
				continue;
			}

			const localTime = getElementLocalTime({
				timelineTime: playheadTime,
				elementStartTime: element.startTime,
				elementDuration: element.duration,
			});

			const target = resolveAnimationTarget({ element, path: propertyPath });
			const baseValue = target?.getBaseValue() ?? null;
			if (baseValue === null) {
				valueAtPlayheadMap.set(key, null);
				continue;
			}

			const value = resolveAnimationPathValueAtTime({
				animations: element.animations,
				propertyPath,
				localTime,
				fallbackValue: baseValue,
			});
			valueAtPlayheadMap.set(key, value);
		}

		const commands = keyframes.map(
			({ trackId, elementId, propertyPath, keyframeId }) =>
				new RemoveKeyframeCommand({
					trackId,
					elementId,
					propertyPath,
					keyframeId,
					valueAtPlayhead:
						valueAtPlayheadMap.get(`${elementId}:${propertyPath}`) ?? null,
				}),
		);
		const command =
			commands.length === 1 ? commands[0] : new BatchCommand(commands);
		this.editor.command.execute({ command });
	}

	retimeKeyframe({
		trackId,
		elementId,
		propertyPath,
		keyframeId,
		time,
	}: {
		trackId: string;
		elementId: string;
		propertyPath: AnimationPath;
		keyframeId: string;
		time: MediaTime;
	}): void {
		const command = new RetimeKeyframeCommand({
			trackId,
			elementId,
			propertyPath,
			keyframeId,
			nextTime: time,
		});
		this.editor.command.execute({ command });
	}

	updateKeyframeCurves({
		keyframes,
	}: {
		keyframes: Array<{
			trackId: string;
			elementId: string;
			propertyPath: AnimationPath;
			componentKey: string;
			keyframeId: string;
			patch: ScalarCurveKeyframePatch;
		}>;
	}): void {
		if (keyframes.length === 0) {
			return;
		}

		const commands = keyframes.map(
			({ trackId, elementId, propertyPath, componentKey, keyframeId, patch }) =>
				new UpdateScalarKeyframeCurveCommand({
					trackId,
					elementId,
					propertyPath,
					componentKey,
					keyframeId,
					patch,
				}),
		);
		const command =
			commands.length === 1 ? commands[0] : new BatchCommand(commands);
		this.editor.command.execute({ command });
	}

	upsertEffectParamKeyframe({
		trackId,
		elementId,
		effectId,
		paramKey,
		time,
		value,
		interpolation,
		keyframeId,
	}: {
		trackId: string;
		elementId: string;
		effectId: string;
		paramKey: string;
		time: MediaTime;
		value: number;
		interpolation?: "linear" | "hold";
		keyframeId?: string;
	}): void {
		const command = new UpsertEffectParamKeyframeCommand({
			trackId,
			elementId,
			effectId,
			paramKey,
			time,
			value,
			interpolation,
			keyframeId,
		});
		this.editor.command.execute({ command });
	}

	removeEffectParamKeyframe({
		trackId,
		elementId,
		effectId,
		paramKey,
		keyframeId,
	}: {
		trackId: string;
		elementId: string;
		effectId: string;
		paramKey: string;
		keyframeId: string;
	}): void {
		const command = new RemoveEffectParamKeyframeCommand({
			trackId,
			elementId,
			effectId,
			paramKey,
			keyframeId,
		});
		this.editor.command.execute({ command });
	}

	isPreviewActive(): boolean {
		return this.previewOverlay.size > 0;
	}

	previewElements({
		updates,
	}: {
		updates: readonly {
			trackId: string;
			elementId: string;
			updates: Partial<TimelineElement>;
		}[];
	}): void {
		let changedOverlayCount = 0;
		for (const { elementId, updates: elementUpdates } of updates) {
			const existingOverlay = this.previewOverlay.get(elementId);
			const changed = Object.entries(elementUpdates).some(([key, value]) => {
				return !Object.is(
					existingOverlay?.[key as keyof TimelineElement],
					value,
				);
			});
			if (changed) {
				changedOverlayCount += 1;
				const mergedOverlay = {
					...existingOverlay,
					...elementUpdates,
				} as Partial<TimelineElement>;
				this.previewOverlay.set(elementId, mergedOverlay);
			}
		}
		const committedTracks = this.editor.scenes.getActiveSceneOrNull()?.tracks;
		if (!committedTracks) {
			return;
		}
		if (changedOverlayCount === 0) {
			return;
		}
		this.previewTracks = this.applyPreviewOverlay(committedTracks);
		this.notify();
	}

	commitPreview(): void {
		if (this.previewOverlay.size === 0) return;
		const committedTracks = this.editor.scenes.getActiveSceneOrNull()?.tracks;
		if (!committedTracks) {
			return;
		}
		const afterTracks =
			this.previewTracks ?? this.applyPreviewOverlay(committedTracks);
		const command = new TracksSnapshotCommand({
			before: committedTracks,
			after: afterTracks,
		});
		this.editor.command.push({ command });
		this.previewOverlay.clear();
		this.previewTracks = null;
		this.updateTracks(afterTracks);
	}

	discardPreview(): void {
		if (this.previewOverlay.size === 0) return;
		this.previewOverlay.clear();
		this.previewTracks = null;
		this.notify();
	}

	private applyPreviewOverlay(tracks: SceneTracks): SceneTracks {
		if (this.previewOverlay.size === 0) return tracks;

		const applyTrackOverlay = <TTrack extends TimelineTrack>(
			track: TTrack,
		): TTrack => {
			const hasOverlay = track.elements.some((element) =>
				this.previewOverlay.has(element.id),
			);
			if (!hasOverlay) {
				return track;
			}

			const nextElements = track.elements.map((element) => {
				const overlay = this.previewOverlay.get(element.id);
				return overlay
					? ({ ...element, ...overlay } as TimelineElement)
					: element;
			});

			return { ...track, elements: nextElements } as TTrack;
		};

		return {
			overlay: tracks.overlay.map((track) => applyTrackOverlay(track)),
			main: applyTrackOverlay(tracks.main),
			audio: tracks.audio.map((track) => applyTrackOverlay(track)),
		};
	}

	duplicateElements({
		elements,
	}: {
		elements: { trackId: string; elementId: string }[];
	}): { trackId: string; elementId: string }[] {
		const command = new DuplicateElementsCommand({ elements });
		this.editor.command.execute({ command });
		return command.getDuplicatedElements();
	}

	toggleElementsVisibility({
		elements,
	}: {
		elements: { trackId: string; elementId: string }[];
	}): void {
		const shouldHide = elements.some(({ trackId, elementId }) => {
			const element = this.getElementByRef({ trackId, elementId });
			return element && canElementBeHidden(element) && !element.hidden;
		});

		const nextUpdates = elements.flatMap(({ trackId, elementId }) => {
			const element = this.getElementByRef({ trackId, elementId });
			if (!element || !canElementBeHidden(element)) {
				return [];
			}

			return [
				{
					trackId,
					elementId,
					patch: { hidden: shouldHide },
				},
			];
		});

		this.updateElements({ updates: nextUpdates });
	}

	toggleElementsMuted({
		elements,
	}: {
		elements: { trackId: string; elementId: string }[];
	}): void {
		const shouldMute = elements.some(({ trackId, elementId }) => {
			const element = this.getElementByRef({ trackId, elementId });
			return element && canElementHaveAudio(element) && !isElementMuted({ element });
		});

		const nextUpdates = elements.flatMap(({ trackId, elementId }) => {
			const element = this.getElementByRef({ trackId, elementId });
			if (!element || !canElementHaveAudio(element)) {
				return [];
			}

			return [
				{
					trackId,
					elementId,
					patch: { params: { muted: shouldMute } },
				},
			];
		});

		this.updateElements({ updates: nextUpdates });
	}

	getPreviewTracks(): SceneTracks | null {
		return (
			this.previewTracks ??
			this.editor.scenes.getActiveSceneOrNull()?.tracks ??
			null
		);
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		this.listeners.forEach((fn) => {
			fn();
		});
	}

	private getElementByRef({
		trackId,
		elementId,
	}: {
		trackId: string;
		elementId: string;
	}): TimelineElement | undefined {
		return this.getTrackById({ trackId })?.elements.find(
			(element) => element.id === elementId,
		);
	}

	private findTrackIdForElement({
		elementId,
	}: {
		elementId: string;
	}): string | null {
		const activeScene = this.editor.scenes.getActiveSceneOrNull();
		if (!activeScene) {
			return null;
		}

		if (
			activeScene.tracks.main.elements.some(
				(element) => element.id === elementId,
			)
		) {
			return activeScene.tracks.main.id;
		}

		for (const track of activeScene.tracks.overlay) {
			if (track.elements.some((element) => element.id === elementId)) {
				return track.id;
			}
		}

		for (const track of activeScene.tracks.audio) {
			if (track.elements.some((element) => element.id === elementId)) {
				return track.id;
			}
		}

		return null;
	}

	updateTracks(newTracks: SceneTracks): void {
		this.previewOverlay.clear();
		this.previewTracks = null;
		this.editor.scenes.updateSceneTracks({ tracks: newTracks });
		this.notify();
	}
}
