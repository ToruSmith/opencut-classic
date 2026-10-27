"use client";

import { useEffect, useRef, useCallback } from "react";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { DraggableItem } from "@/components/editor/panels/assets/draggable-item";
import { effectsRegistry, EFFECT_TARGET_ELEMENT_TYPES } from "@/effects";
import { effectPreviewService } from "@/services/renderer/effect-preview";
import { useEditor } from "@/editor/use-editor";
import { buildEffectElement } from "@/timeline/element-utils";
import type { EffectDefinition } from "@/effects/types";
import { EFFECT_PRESETS, type EffectPreset } from "@/effects/presets";
import { mediaTimeFromSeconds } from "@/wasm/media-time";

export function EffectsView() {
	const effects = effectsRegistry.getAll();

	return (
		<PanelView title="特效">
			<div className="flex flex-col gap-4">
				<PresetList />
				<EffectsGrid effects={effects} />
			</div>
		</PanelView>
	);
}

function PresetList() {
	const editor = useEditor();

	const handleApply = useCallback(
		(preset: EffectPreset) => {
			const startTime = editor.playback.getCurrentTime();
			const duration =
				preset.durationSeconds === undefined
					? undefined
					: mediaTimeFromSeconds({ seconds: preset.durationSeconds });
			const items = preset.layers
				.filter((layer) => effectsRegistry.has(layer.effectType))
				.map((layer) => {
					const element = buildEffectElement({
						effectType: layer.effectType,
						startTime,
						duration,
					});
					return {
						placement: { mode: "auto", trackType: "effect" } as const,
						element: {
							...element,
							params: { ...element.params, ...layer.params },
						},
					};
				});
			editor.timeline.insertElements({ items });
		},
		[editor],
	);

	return (
		<div className="flex flex-col gap-2">
			<p className="text-xs text-muted-foreground">組合(點一下,在播放頭位置放入多個特效)</p>
			<div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
				{EFFECT_PRESETS.map((preset) => (
					<button
						key={preset.id}
						type="button"
						title={preset.description}
						onClick={() => handleApply(preset)}
						className="flex flex-col gap-1 rounded-md border bg-card p-2 text-left hover:bg-accent"
					>
						<span className="text-sm font-medium">{preset.name}</span>
						<span className="text-xs text-muted-foreground">{preset.description}</span>
					</button>
				))}
			</div>
		</div>
	);
}

function EffectsGrid({ effects }: { effects: EffectDefinition[] }) {
	return (
		<div
			className="grid gap-2"
			style={{ gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))" }}
		>
			{effects.map((effect) => (
				<EffectItem key={effect.type} effect={effect} />
			))}
		</div>
	);
}

function EffectPreviewCanvas({ effectType }: { effectType: string }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const render = () => {
			if (canvasRef.current) {
				effectPreviewService.renderPreview({
					effectType,
					params: {},
					targetCanvas: canvasRef.current,
				});
			}
		};

		render();
		return effectPreviewService.onPreviewImageReady({ callback: render });
	}, [effectType]);

	return <canvas ref={canvasRef} className="size-full" />;
}

function EffectItem({ effect }: { effect: EffectDefinition }) {
	const editor = useEditor();

	const handleAddToTimeline = useCallback(() => {
		const currentTime = editor.playback.getCurrentTime();
		const element = buildEffectElement({
			effectType: effect.type,
			startTime: currentTime,
		});

		editor.timeline.insertElement({
			placement: { mode: "auto", trackType: "effect" },
			element,
		});
	}, [editor, effect.type]);

	const preview = <EffectPreviewCanvas effectType={effect.type} />;

	return (
		<DraggableItem
			name={effect.name}
			preview={preview}
			dragData={{
				id: effect.type,
				name: effect.name,
				type: "effect",
				effectType: effect.type,
				targetElementTypes: EFFECT_TARGET_ELEMENT_TYPES,
			}}
			onAddToTimeline={handleAddToTimeline}
			aspectRatio={1}
			isRounded
			variant="card"
			containerClassName="w-full"
		/>
	);
}
