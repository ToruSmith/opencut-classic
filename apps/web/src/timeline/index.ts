import { type MediaTime, ZERO_MEDIA_TIME } from "@/wasm";
import { computeContentEnd } from "./content-end";
import type { SceneTracks } from "./types";

export * from "./types";
export * from "./drag";
export * from "./track-capabilities";
export * from "./track-element-update";
export * from "./element-utils";
export * from "./audio-separation";
export * from "./zoom-utils";
export * from "./ruler-utils";
export * from "./pixel-utils";

export function calculateTotalDuration({
	tracks,
}: {
	tracks: SceneTracks;
}): MediaTime {
	// 特效片段不撐長時間軸(見 content-end.ts)
	const end = computeContentEnd({ tracks });
	return end > 0 ? (end as MediaTime) : ZERO_MEDIA_TIME;
}
