import { splitAnimationsAtTime } from "@/animation/keyframes";
import { getSourceSpanAtClipTime } from "@/retime/split";
import type { TimelineElement } from "@/timeline/types";
import {
	addMediaTime,
	type MediaTime,
	roundMediaTime,
	subMediaTime,
} from "@/wasm";

function getRetime(element: TimelineElement) {
	return element.type === "video" || element.type === "audio"
		? element.retime
		: undefined;
}

/**
 * Cut an element down to the part that lies inside `[windowStart, windowEnd)`.
 *
 * Uses exactly the same arithmetic as `SplitElementsCommand` (snap the source
 * span once, derive the other side from it) so a clip cut here is identical to
 * one split by hand at the window edges. Returns the element unchanged when it
 * already fits, and `null` when nothing of it is inside the window.
 */
export function clipElementToWindow<TElement extends TimelineElement>({
	element,
	windowStart,
	windowEnd,
}: {
	element: TElement;
	windowStart: MediaTime;
	windowEnd: MediaTime;
}): TElement | null {
	const elementEnd = addMediaTime({
		a: element.startTime,
		b: element.duration,
	});
	if (elementEnd <= windowStart || element.startTime >= windowEnd) {
		return null;
	}

	let result: TElement = element;
	const retime = getRetime(element);

	if (result.startTime < windowStart) {
		const cut = subMediaTime({ a: windowStart, b: result.startTime });
		const cutSourceSpan = roundMediaTime({
			time: getSourceSpanAtClipTime({ clipTime: cut, retime }),
		});
		const { rightAnimations } = splitAnimationsAtTime({
			animations: result.animations,
			splitTime: cut,
			shouldIncludeSplitBoundary: true,
		});
		result = {
			...result,
			startTime: windowStart,
			duration: subMediaTime({ a: result.duration, b: cut }),
			trimStart: addMediaTime({ a: result.trimStart, b: cutSourceSpan }),
			animations: rightAnimations,
		};
	}

	const resultEnd = addMediaTime({ a: result.startTime, b: result.duration });
	if (resultEnd > windowEnd) {
		const keep = subMediaTime({ a: windowEnd, b: result.startTime });
		const keepSourceSpan = roundMediaTime({
			time: getSourceSpanAtClipTime({ clipTime: keep, retime }),
		});
		const totalSourceSpan = roundMediaTime({
			time: getSourceSpanAtClipTime({ clipTime: result.duration, retime }),
		});
		const { leftAnimations } = splitAnimationsAtTime({
			animations: result.animations,
			splitTime: keep,
			shouldIncludeSplitBoundary: true,
		});
		result = {
			...result,
			duration: keep,
			trimEnd: addMediaTime({
				a: result.trimEnd,
				b: subMediaTime({ a: totalSourceSpan, b: keepSourceSpan }),
			}),
			animations: leftAnimations,
		};
	}

	return result;
}

/** Move an element by `offset` (may be negative). */
export function shiftElement<TElement extends TimelineElement>({
	element,
	offset,
}: {
	element: TElement;
	offset: MediaTime;
}): TElement {
	return {
		...element,
		startTime: addMediaTime({ a: element.startTime, b: offset }),
	};
}
