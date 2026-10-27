import { pickSplitTimes } from "@/timeline/bookmarks/beat-markers";

/**
 * 自動排片(最小版本):依節拍把素材池的片段排滿一段時間範圍。純函式,有測試。
 * - 切點 = 範圍內的節拍(每 N 拍、最短片段),再用 `maxCuts` 設上限(太多就改成隔幾個取一個)。
 * - 每段隨機(固定種子,可重現)從素材池抽一支,不連續抽同一支;只有一支或沒得選時才重複。
 * - 影片:入點隨機,但出點不超過素材長度;素材比切段短的不會被抽中,全部都太短時用最長的那支並縮短該段(留空隙,回報 `shortfallCount`)。
 * - 圖片:任意長度都可以,入點固定 0。
 * 不做智慧選片、不做變速(第二版)。時間單位全是 tick(整數)。
 */

export interface AutoCutSource {
	id: string;
	kind: "video" | "image";
	/** 影片的素材長度(tick);圖片不看這個 */
	durationTicks: number;
}

export interface AutoCutPiece {
	sourceId: string;
	kind: "video" | "image";
	startTime: number;
	duration: number;
	/** 影片在素材裡的入點(tick);圖片是 0 */
	trimStart: number;
	/** 影片素材結尾被裁掉的長度;圖片是 0 */
	trimEnd: number;
	/** 影片的素材長度;圖片是 undefined */
	sourceDuration?: number;
}

export interface AutoCutPlan {
	pieces: AutoCutPiece[];
	/** 因為超過上限而被稀釋掉的切點數 */
	thinnedCuts: number;
	/** 沒有任何素材夠長、只好縮短的段數(畫面會有空隙) */
	shortfallCount: number;
}

export const DEFAULT_MAX_CUTS = 150;

function createRandom({ seed }: { seed: number }): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function planAutoCut({
	beats,
	start,
	end,
	sources,
	every,
	minGap,
	maxCuts = DEFAULT_MAX_CUTS,
	seed,
}: {
	beats: number[];
	start: number;
	end: number;
	sources: AutoCutSource[];
	every: number;
	/** tick;0 = 不限 */
	minGap: number;
	maxCuts?: number;
	seed: number;
}): AutoCutPlan {
	const empty: AutoCutPlan = { pieces: [], thinnedCuts: 0, shortfallCount: 0 };
	const usable = sources.filter(
		(source) => source.kind === "image" || source.durationTicks > 0,
	);
	if (usable.length === 0 || !(end > start)) return empty;

	let cuts = pickSplitTimes({ beats, start, end, every, minGap });
	let thinnedCuts = 0;
	const limit = Math.max(1, Math.floor(maxCuts));
	if (cuts.length + 1 > limit) {
		const step = Math.ceil((cuts.length + 1) / limit);
		const kept = cuts.filter((_, index) => index % step === step - 1);
		thinnedCuts = cuts.length - kept.length;
		cuts = kept;
	}

	const boundaries = [start, ...cuts, end];
	const random = createRandom({ seed });
	const pieces: AutoCutPiece[] = [];
	let shortfallCount = 0;
	let previousId: string | null = null;

	for (let i = 0; i + 1 < boundaries.length; i++) {
		const startTime = boundaries[i];
		const length = boundaries[i + 1] - startTime;
		if (!(length > 0)) continue;

		const fitting = usable.filter(
			(source) => source.kind === "image" || source.durationTicks >= length,
		);
		let pool = fitting;
		let short = false;
		if (pool.length === 0) {
			const longest = usable.reduce((a, b) => (b.durationTicks > a.durationTicks ? b : a));
			pool = [longest];
			short = true;
		}
		const withoutPrevious = pool.filter((source) => source.id !== previousId);
		const choices = withoutPrevious.length > 0 ? withoutPrevious : pool;
		const source = choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
		previousId = source.id;

		if (source.kind === "image") {
			pieces.push({
				sourceId: source.id,
				kind: "image",
				startTime,
				duration: length,
				trimStart: 0,
				trimEnd: 0,
			});
			continue;
		}

		const duration = Math.min(length, source.durationTicks);
		if (short) shortfallCount += 1;
		const room = source.durationTicks - duration;
		const trimStart = Math.floor(random() * (room + 1));
		pieces.push({
			sourceId: source.id,
			kind: "video",
			startTime,
			duration,
			trimStart,
			trimEnd: source.durationTicks - trimStart - duration,
			sourceDuration: source.durationTicks,
		});
	}

	return { pieces, thinnedCuts, shortfallCount };
}
