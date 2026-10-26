"use client";

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditor } from "@/editor/use-editor";
import {
	AUDIO_FADE_IN_KEY,
	AUDIO_FADE_MAX_SECONDS,
	AUDIO_FADE_OUT_KEY,
	getAudioFades,
} from "@/timeline/audio-fade";
import type { AudioElement } from "@/timeline/types";
import { TICKS_PER_SECOND } from "@/wasm";
import { cn } from "@/utils/ui";

const HANDLE_SIZE_PX = 10;
/** 把手離片段邊緣至少這麼遠,不和調整長度的邊緣把手搶滑鼠 */
const EDGE_INSET_PX = 8;
const FADE_STEP_SECONDS = 0.05;
const TOOLTIP_OFFSET_PX = 10;

type Side = "in" | "out";

/**
 * 片段左上 / 右上角的淡入淡出把手:往片段內側拖曳就是加長淡化。
 * 拖曳中用 previewElements 即時預覽,放開才寫進復原紀錄(和音量線相同的流程)。
 */
export function AudioFadeHandles({
	element,
	trackId,
	pixelsPerSecond,
}: {
	element: AudioElement;
	trackId: string;
	pixelsPerSecond: number;
}) {
	const editor = useEditor();
	const durationSeconds = element.duration / TICKS_PER_SECOND;
	const { fadeIn, fadeOut } = getAudioFades({
		params: element.params,
		durationSeconds,
	});

	const dragRef = useRef<{
		side: Side;
		pointerId: number;
		startClientX: number;
		startSeconds: number;
		changed: boolean;
	} | null>(null);
	const [dragging, setDragging] = useState<Side | null>(null);
	const [tooltip, setTooltip] = useState<{
		x: number;
		y: number;
		text: string;
	} | null>(null);

	const preview = useCallback(
		({ side, seconds }: { side: Side; seconds: number }) => {
			const key = side === "in" ? AUDIO_FADE_IN_KEY : AUDIO_FADE_OUT_KEY;
			editor.timeline.previewElements({
				updates: [
					{
						trackId,
						elementId: element.id,
						// params 是整包取代,一定要帶上原本的其他參數
						updates: { params: { ...element.params, [key]: seconds } },
					},
				],
			});
		},
		[editor, element.id, element.params, trackId],
	);

	const finish = useCallback(
		({ commit }: { commit: boolean }) => {
			const drag = dragRef.current;
			dragRef.current = null;
			setDragging(null);
			setTooltip(null);
			if (commit && drag?.changed) {
				editor.timeline.commitPreview();
			} else {
				editor.timeline.discardPreview();
			}
		},
		[editor],
	);

	const handlePointerDown = useCallback(
		(side: Side) => (event: React.PointerEvent<HTMLDivElement>) => {
			if (event.button !== 0) return;
			event.preventDefault();
			event.stopPropagation();
			editor.selection.setSelectedElements({
				elements: [{ trackId, elementId: element.id }],
			});
			dragRef.current = {
				side,
				pointerId: event.pointerId,
				startClientX: event.clientX,
				startSeconds: side === "in" ? fadeIn : fadeOut,
				changed: false,
			};
			setDragging(side);
			event.currentTarget.setPointerCapture(event.pointerId);
		},
		[editor.selection, element.id, fadeIn, fadeOut, trackId],
	);

	const handlePointerMove = useCallback(
		(event: React.PointerEvent) => {
			const drag = dragRef.current;
			if (!drag || drag.pointerId !== event.pointerId) return;
			event.preventDefault();
			const deltaPx = event.clientX - drag.startClientX;
			// 淡入往右拉變長,淡出往左拉變長
			const deltaSeconds =
				(drag.side === "in" ? deltaPx : -deltaPx) /
				Math.max(1e-6, pixelsPerSecond);
			const otherSide = drag.side === "in" ? fadeOut : fadeIn;
			const maxSeconds = Math.max(
				0,
				Math.min(AUDIO_FADE_MAX_SECONDS, durationSeconds - otherSide),
			);
			const raw = Math.min(maxSeconds, Math.max(0, drag.startSeconds + deltaSeconds));
			const seconds =
				Math.round(raw / FADE_STEP_SECONDS) * FADE_STEP_SECONDS;
			drag.changed = drag.changed || Math.abs(seconds - drag.startSeconds) > 1e-9;
			preview({ side: drag.side, seconds });
			setTooltip({
				x: event.clientX + TOOLTIP_OFFSET_PX,
				y: event.clientY - TOOLTIP_OFFSET_PX,
				text: `${drag.side === "in" ? "淡入" : "淡出"} ${seconds.toFixed(2)} 秒`,
			});
		},
		[durationSeconds, fadeIn, fadeOut, pixelsPerSecond, preview],
	);

	const handlePointerUp = useCallback(
		(event: React.PointerEvent) => {
			if (dragRef.current?.pointerId !== event.pointerId) return;
			event.preventDefault();
			event.stopPropagation();
			finish({ commit: true });
		},
		[finish],
	);

	const handlePointerCancel = useCallback(
		(event: React.PointerEvent) => {
			if (dragRef.current?.pointerId !== event.pointerId) return;
			finish({ commit: false });
		},
		[finish],
	);

	const handleLostPointerCapture = useCallback(() => {
		if (!dragRef.current) return;
		finish({ commit: dragRef.current.changed });
	}, [finish]);

	const stop = useCallback((event: React.MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
	}, []);

	const fadeInPx = fadeIn * pixelsPerSecond;
	const fadeOutPx = fadeOut * pixelsPerSecond;

	const renderHandle = (side: Side) => {
		const offsetPx = side === "in" ? fadeInPx : fadeOutPx;
		const hasFade = (side === "in" ? fadeIn : fadeOut) > 0;
		return (
			// eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- 拖曳把手;精確數值可在屬性面板輸入
			<div
				className={cn(
					"pointer-events-auto absolute top-0 z-10 cursor-ew-resize touch-none rounded-full border border-black/40 bg-white shadow transition-opacity",
					hasFade || dragging === side
						? "opacity-90"
						: "opacity-0 group-hover/audio:opacity-80",
				)}
				style={{
					width: HANDLE_SIZE_PX,
					height: HANDLE_SIZE_PX,
					[side === "in" ? "left" : "right"]:
						`${Math.max(EDGE_INSET_PX, offsetPx) - HANDLE_SIZE_PX / 2}px`,
				}}
				onClick={stop}
				onMouseDown={(event) => event.stopPropagation()}
				onPointerDown={handlePointerDown(side)}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
				onPointerCancel={handlePointerCancel}
				onLostPointerCapture={handleLostPointerCapture}
				title={side === "in" ? "拖曳調整淡入" : "拖曳調整淡出"}
			/>
		);
	};

	return (
		<div className="pointer-events-none absolute inset-0">
			{/* 淡化區域:淡化線上方的三角形陰影 */}
			{fadeInPx > 0 && (
				<div
					className="pointer-events-none absolute inset-y-0 left-0 bg-black/30"
					style={{
						width: fadeInPx,
						clipPath: "polygon(0 0, 0 100%, 100% 0)",
					}}
				/>
			)}
			{fadeOutPx > 0 && (
				<div
					className="pointer-events-none absolute inset-y-0 right-0 bg-black/30"
					style={{
						width: fadeOutPx,
						clipPath: "polygon(0 0, 100% 0, 100% 100%)",
					}}
				/>
			)}
			{renderHandle("in")}
			{renderHandle("out")}
			{tooltip &&
				createPortal(
					<div
						className="pointer-events-none fixed left-0 top-0 z-50 -translate-y-full rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white whitespace-nowrap"
						style={{
							transform: `translate(${tooltip.x}px, ${tooltip.y}px)`,
						}}
					>
						{tooltip.text}
					</div>,
					document.body,
				)}
		</div>
	);
}
