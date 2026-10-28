/**
 * 自動壓低背景音(ducking):人聲(旁白、對白)出現時,把音樂的音量壓低,結束後再回來。
 * 純函式,不碰 wasm 或編輯器狀態。
 *
 * 做法是把壓低「烘」成音樂片段的音量關鍵影格(dB),而不是新增一條執行期的音訊規則:
 * 預覽、匯出、轉錄、波形都已經吃音量關鍵影格,所以自動一致,音訊管線完全不用改。
 * 代價是人聲移動 / 改長度之後要重新套用一次。
 */

export interface DuckRange {
	/** 時間軸上的開始 / 結束(秒) */
	start: number;
	end: number;
}

export interface DuckKeyframe {
	/** 相對音樂片段開頭的秒數 */
	seconds: number;
	/** 音量 dB */
	value: number;
}

export const DUCK_DEFAULTS = {
	duckDb: -12,
	attackSeconds: 0.25,
	releaseSeconds: 0.6,
} as const;

/** 合併重疊或距離小於 `gap` 的區間,回傳依開始時間排序的新陣列 */
export function mergeRanges({
	ranges,
	gap,
}: {
	ranges: ReadonlyArray<DuckRange>;
	gap: number;
}): DuckRange[] {
	const sorted = ranges
		.filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
		.map((r) => ({ ...r }))
		.sort((a, b) => a.start - b.start);
	const merged: DuckRange[] = [];
	for (const range of sorted) {
		const last = merged[merged.length - 1];
		if (last && range.start - last.end <= gap) {
			last.end = Math.max(last.end, range.end);
		} else {
			merged.push(range);
		}
	}
	return merged;
}

export type DuckPlan =
	| { ok: true; keyframes: DuckKeyframe[]; duckedRanges: number }
	| { ok: false; reason: string };

/**
 * @param musicStart 音樂片段在時間軸上的開始(秒)
 * @param musicDuration 音樂片段長度(秒)
 * @param baseDb 音樂片段目前的音量(dB),壓低是「相對」這個值
 * @param duckDb 人聲期間要壓低多少(負數,例如 -12)
 */
export function planDucking({
	voiceRanges,
	musicStart,
	musicDuration,
	baseDb,
	duckDb,
	attackSeconds,
	releaseSeconds,
	minDb = -60,
}: {
	voiceRanges: ReadonlyArray<DuckRange>;
	musicStart: number;
	musicDuration: number;
	baseDb: number;
	duckDb: number;
	attackSeconds: number;
	releaseSeconds: number;
	minDb?: number;
}): DuckPlan {
	if (!(musicDuration > 0)) return { ok: false, reason: "音樂片段長度無效" };
	if (!(duckDb < 0)) return { ok: false, reason: "壓低量要是負數(dB)" };
	const attack = Math.max(0, attackSeconds);
	const release = Math.max(0, releaseSeconds);
	const ducked = Math.max(minDb, baseDb + duckDb);

	// 相鄰兩段的「放開 + 壓下」放不下就合併成一段,關鍵影格時間才會嚴格遞增
	const local = mergeRanges({
		ranges: voiceRanges
			.map((r) => ({ start: r.start - musicStart, end: r.end - musicStart }))
			.filter((r) => r.end > 0 && r.start < musicDuration),
		gap: attack + release,
	});
	if (local.length === 0) {
		return { ok: false, reason: "選取的人聲和這段音樂在時間上沒有重疊" };
	}

	const points: DuckKeyframe[] = [];
	const push = ({ seconds, value }: DuckKeyframe) => {
		const t = Math.min(musicDuration, Math.max(0, seconds));
		const last = points[points.length - 1];
		if (last && Math.abs(last.seconds - t) < 1e-6) {
			// 同一時間點取較小(較壓低)的音量
			last.value = Math.min(last.value, value);
			return;
		}
		points.push({ seconds: t, value });
	};

	// 片段開頭就有人聲:從壓低的音量開始,不要先從原音量降下來
	if (local[0]!.start - attack <= 0) push({ seconds: 0, value: ducked });
	else push({ seconds: 0, value: baseDb });

	for (const range of local) {
		const start = Math.max(0, range.start);
		const end = Math.min(musicDuration, range.end);
		if (range.start - attack > 0) {
			push({ seconds: range.start - attack, value: baseDb });
		}
		push({ seconds: start, value: ducked });
		push({ seconds: end, value: ducked });
		if (end + release < musicDuration) {
			push({ seconds: end + release, value: baseDb });
		} else if (end < musicDuration) {
			push({ seconds: musicDuration, value: baseDb });
		}
	}
	return { ok: true, keyframes: points, duckedRanges: local.length };
}
