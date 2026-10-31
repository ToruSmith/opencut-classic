import type { EditorCore } from "@/core";
import { hasAnimatedVolume } from "@/timeline/audio-state";
import { VOLUME_DB_MAX, VOLUME_DB_MIN } from "@/timeline/audio-constants";
import { computeNormalizeAdjustment, DEFAULT_TARGET_DB } from "@/media/loudness";
import { measureElementLoudness } from "@/media/loudness-analysis";

export interface NormalizeItemResult {
	elementId: string;
	name: string;
	status: "changed" | "skipped";
	reason?: string;
	loudnessDb?: number;
	volumeDb?: number;
}

/**
 * 把指定的片段各自調到同一響度(音量 = 目標 - 量到的響度,受峰值與範圍限制)。
 * 只改 `params.volume`,一次更新時間軸、單一復原步驟。有音量關鍵影格的片段會略過(不替使用者洗掉動畫)。
 */
export async function normalizeElementsVolume({
	editor,
	refs,
	targetDb = DEFAULT_TARGET_DB,
}: {
	editor: EditorCore;
	refs: Array<{ trackId: string; elementId: string }>;
	targetDb?: number;
}): Promise<NormalizeItemResult[]> {
	const mediaAssets = editor.media.getAssets();
	const results: NormalizeItemResult[] = [];
	const updates: Array<{
		trackId: string;
		elementId: string;
		patch: { params: Record<string, unknown> };
	}> = [];

	for (const { track, element } of editor.timeline.getElementsWithTracks({ elements: refs })) {
		if (element.type !== "audio" && element.type !== "video") continue;
		const base = { elementId: element.id, name: element.name };
		if (hasAnimatedVolume({ element })) {
			results.push({ ...base, status: "skipped", reason: "音量有關鍵影格" });
			continue;
		}
		const measured = await measureElementLoudness({ element, mediaAssets });
		if (!measured) {
			results.push({ ...base, status: "skipped", reason: "沒有可量的聲音" });
			continue;
		}
		const adjustment = computeNormalizeAdjustment({
			result: measured,
			targetDb,
			minVolumeDb: VOLUME_DB_MIN,
			maxVolumeDb: VOLUME_DB_MAX,
		});
		if (!adjustment.ok) {
			results.push({ ...base, status: "skipped", reason: adjustment.reason });
			continue;
		}
		updates.push({
			trackId: track.id,
			elementId: element.id,
			patch: { params: { ...element.params, volume: adjustment.volumeDb } },
		});
		results.push({
			...base,
			status: "changed",
			loudnessDb: measured.loudnessDb ?? undefined,
			volumeDb: adjustment.volumeDb,
		});
	}

	if (updates.length > 0) {
		editor.timeline.updateElements({ updates: updates as never });
	}
	return results;
}
