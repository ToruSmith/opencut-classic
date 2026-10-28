/**
 * 切點轉場(剪映「熱門轉場」那一類):不需要重疊軌道。
 * 在切點前一段的最後 h 秒把效果強度拉到最高,後一段的前 h 秒從最高降回 0,
 * 中間那一刀被模糊 / 閃光 / 故障蓋住,看起來就是一個轉場。
 *
 * 全部用「片段上的特效 + 特效參數的關鍵影格」做,不動片段的位置 / 縮放關鍵影格,
 * 所以再套一次時只要拿掉 id 以 `cut-` 開頭的特效與它們的關鍵影格就能乾淨地取代。
 * 轉場以外的時間參數是中性值,特效定義的 `skipWhen` / `buildPasses` 不送 pass,不多花 GPU。
 *
 * 純函式:時間都是「相對片段開頭的秒數」,由呼叫端換成 MediaTime。
 */

export type CutTransitionKind = "flash" | "zoom" | "whip" | "spin" | "glitch" | "shake";
export type CutDirection = "left" | "right" | "up" | "down";

export const CUT_TRANSITION_KINDS: ReadonlyArray<CutTransitionKind> = [
	"flash",
	"zoom",
	"whip",
	"spin",
	"glitch",
	"shake",
];

/** 切點轉場建立的特效 id 前綴:用來辨認、取代 */
export const CUT_EFFECT_ID_PREFIX = "cut-";

/** 每一側最短長度(秒);比這短就不做那一側 */
export const MIN_SIDE_SECONDS = 1 / 30;

export interface CutEffectKeyframe {
	paramKey: string;
	/** 相對片段開頭的秒數 */
	seconds: number;
	value: number;
}

export interface CutEffectPlan {
	effectType: string;
	/** 特效的固定參數(覆寫預設值);會做關鍵影格的參數放中性值 */
	params: Record<string, number | string | boolean>;
	keyframes: CutEffectKeyframe[];
}

export interface CutTransitionPlan {
	/** 切點前那一段要加的特效 */
	out: CutEffectPlan[];
	/** 切點後那一段要加的特效 */
	in: CutEffectPlan[];
}

/** 緩入曲線(加速衝向切點);用幾個中間關鍵影格近似,不依賴 bezier 切線 */
const EASE_POINTS: ReadonlyArray<{ progress: number; amount: number }> = [
	{ progress: 0, amount: 0 },
	{ progress: 0.5, amount: 0.25 },
	{ progress: 0.8, amount: 0.64 },
	{ progress: 1, amount: 1 },
];

/**
 * 從 rest 到 peak 的關鍵影格。side = "out":在片段最後 h 秒加速到 peak(切點時最強);
 * side = "in":在片段前 h 秒從 peak 減速回 rest(鏡像)。
 */
export function easeKeyframes({
	paramKey,
	side,
	sideSeconds,
	clipSeconds,
	rest,
	peak,
}: {
	paramKey: string;
	side: "out" | "in";
	sideSeconds: number;
	clipSeconds: number;
	rest: number;
	peak: number;
}): CutEffectKeyframe[] {
	return EASE_POINTS.map(({ progress, amount }) => ({
		paramKey,
		seconds:
			side === "out"
				? clipSeconds - sideSeconds + progress * sideSeconds
				: (1 - progress) * sideSeconds,
		value: rest + (peak - rest) * amount,
	})).sort((a, b) => a.seconds - b.seconds);
}

/** 一側能用的長度:不超過要求的長度,也不超過片段的一半(避免和另一端的轉場重疊) */
export function sideSecondsFor({
	requested,
	clipSeconds,
}: {
	requested: number;
	clipSeconds: number;
}): number {
	if (!(requested > 0) || !(clipSeconds > 0)) return 0;
	const seconds = Math.min(requested, clipSeconds / 2);
	return seconds >= MIN_SIDE_SECONDS ? seconds : 0;
}

const DIRECTION_VECTOR: Record<CutDirection, { x: number; y: number; angle: number }> = {
	right: { x: 1, y: 0, angle: 0 },
	left: { x: -1, y: 0, angle: 0 },
	down: { x: 0, y: 1, angle: 90 },
	up: { x: 0, y: -1, angle: 90 },
};

/**
 * 一個切點的轉場計畫。sideSeconds = 每一側的長度(總長是兩倍);intensity 0..1 縮放所有峰值。
 * 片段太短的那一側會被省略(回傳空陣列),兩側都不行時回傳 null。
 */
export function planCutTransition({
	kind,
	direction = "right",
	sideSeconds,
	outClipSeconds,
	inClipSeconds,
	intensity = 1,
}: {
	kind: CutTransitionKind;
	direction?: CutDirection;
	sideSeconds: number;
	outClipSeconds: number;
	inClipSeconds: number;
	intensity?: number;
}): CutTransitionPlan | null {
	const outSeconds = sideSecondsFor({ requested: sideSeconds, clipSeconds: outClipSeconds });
	const inSeconds = sideSecondsFor({ requested: sideSeconds, clipSeconds: inClipSeconds });
	if (outSeconds === 0 && inSeconds === 0) return null;
	const k = Math.min(1, Math.max(0.1, Number.isFinite(intensity) ? intensity : 1));

	const effect = ({
		side,
		effectType,
		params = {},
		ramps,
	}: {
		side: "out" | "in";
		effectType: string;
		params?: Record<string, number | string | boolean>;
		ramps: Array<{ paramKey: string; rest: number; peak: number }>;
	}): CutEffectPlan[] => {
		const seconds = side === "out" ? outSeconds : inSeconds;
		if (seconds === 0) return [];
		const clipSeconds = side === "out" ? outClipSeconds : inClipSeconds;
		const fixed: Record<string, number | string | boolean> = { ...params };
		const keyframes: CutEffectKeyframe[] = [];
		for (const ramp of ramps) {
			fixed[ramp.paramKey] = ramp.rest;
			keyframes.push(
				...easeKeyframes({
					paramKey: ramp.paramKey,
					side,
					sideSeconds: seconds,
					clipSeconds,
					rest: ramp.rest,
					peak: ramp.rest + (ramp.peak - ramp.rest) * k,
				}),
			);
		}
		return [{ effectType, params: fixed, keyframes }];
	};
	const both = (
		build: (side: "out" | "in", sign: number) => CutEffectPlan[],
	): CutTransitionPlan => ({ out: build("out", 1), in: build("in", -1) });

	switch (kind) {
		case "flash":
			return both((side) =>
				effect({ side, effectType: "color-adjust", ramps: [{ paramKey: "brightness", rest: 0, peak: 100 }] }),
			);

		case "zoom":
			// 前一段一路放大衝進去,後一段從放大的狀態收回(都帶放射模糊)
			return both((side) => [
				...effect({ side, effectType: "cut-motion", ramps: [{ paramKey: "scale", rest: 100, peak: 160 }] }),
				...effect({ side, effectType: "zoom-blur", ramps: [{ paramKey: "strength", rest: 0, peak: 70 }] }),
			]);

		case "whip": {
			// 甩鏡:畫面往方向甩出去,下一段從反方向接著甩進來(同一個運動方向),方向模糊蓋住接縫
			const v = DIRECTION_VECTOR[direction];
			return both((side, sign) =>
				effect({
					side,
					effectType: "cut-motion",
					params: { blurAngle: v.angle },
					ramps: [
						...(v.x !== 0 ? [{ paramKey: "offsetX", rest: 0, peak: 60 * v.x * sign }] : []),
						...(v.y !== 0 ? [{ paramKey: "offsetY", rest: 0, peak: 60 * v.y * sign }] : []),
						{ paramKey: "blur", rest: 0, peak: 18 },
					],
				}),
			);
		}

		case "spin":
			return both((side, sign) => [
				...effect({
					side,
					effectType: "cut-motion",
					ramps: [
						{ paramKey: "rotation", rest: 0, peak: 45 * sign },
						{ paramKey: "scale", rest: 100, peak: 130 },
					],
				}),
				...effect({ side, effectType: "zoom-blur", ramps: [{ paramKey: "strength", rest: 0, peak: 50 }] }),
			]);

		case "glitch":
			return both((side) => [
				...effect({
					side,
					effectType: "glitch",
					params: { shift: 160, rate: 24 },
					ramps: [{ paramKey: "intensity", rest: 0, peak: 100 }],
				}),
				...effect({
					side,
					effectType: "chromatic-aberration",
					params: { mode: "linear", angle: 0 },
					ramps: [{ paramKey: "amount", rest: 0, peak: 24 }],
				}),
			]);

		case "shake":
			// 前一段輕微推近,後一段一進來就重重一震再穩住
			return {
				out: effect({ side: "out", effectType: "cut-motion", ramps: [{ paramKey: "scale", rest: 100, peak: 108 }] }),
				in: [
					...effect({
						side: "in",
						effectType: "camera-shake",
						params: { speed: 22, fill: true },
						ramps: [
							{ paramKey: "amount", rest: 0, peak: 90 },
							{ paramKey: "rotation", rest: 0, peak: 4 },
						],
					}),
					...effect({ side: "in", effectType: "cut-motion", ramps: [{ paramKey: "scale", rest: 100, peak: 112 }] }),
				],
			};
	}
}

export interface CutCandidate {
	id: string;
	trackId: string;
	/** 秒 */
	start: number;
	/** 秒 */
	end: number;
}

export interface CutPoint {
	outId: string;
	inId: string;
	trackId: string;
	/** 切點時間(秒) */
	time: number;
}

/**
 * 從選取的片段找出切點:同一條軌道上,前一段的結尾和後一段的開頭相接(誤差 tolerance 秒內)。
 * 中間有空隙的不算切點(那裡本來就是黑畫面或下層畫面)。
 */
export function findCutPoints({
	items,
	toleranceSeconds = 1 / 60,
}: {
	items: ReadonlyArray<CutCandidate>;
	toleranceSeconds?: number;
}): CutPoint[] {
	const byTrack = new Map<string, CutCandidate[]>();
	for (const item of items) {
		if (!(item.end > item.start)) continue;
		const list = byTrack.get(item.trackId) ?? [];
		list.push(item);
		byTrack.set(item.trackId, list);
	}
	const cuts: CutPoint[] = [];
	for (const [trackId, list] of byTrack) {
		const sorted = [...list].sort((a, b) => a.start - b.start);
		for (let i = 1; i < sorted.length; i++) {
			const prev = sorted[i - 1]!;
			const next = sorted[i]!;
			if (Math.abs(next.start - prev.end) <= toleranceSeconds) {
				cuts.push({ outId: prev.id, inId: next.id, trackId, time: next.start });
			}
		}
	}
	return cuts.sort((a, b) => a.time - b.time);
}

function mulberry32({ seed }: { seed: number }): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** 為每個切點抽一種轉場:同種子可重現,相鄰不重複 */
export function pickCutKinds({
	count,
	seed,
	pool = CUT_TRANSITION_KINDS,
}: {
	count: number;
	seed: number;
	pool?: ReadonlyArray<CutTransitionKind>;
}): CutTransitionKind[] {
	if (count <= 0 || pool.length === 0) return [];
	const random = mulberry32({ seed });
	const result: CutTransitionKind[] = [];
	for (let i = 0; i < count; i++) {
		const candidates = pool.length > 1 && i > 0 ? pool.filter((kind) => kind !== result[i - 1]) : pool;
		result.push(candidates[Math.floor(random() * candidates.length)]!);
	}
	return result;
}

/**
 * 拿掉先前切點轉場加的特效與它們的關鍵影格(id 以 `cut-` 開頭)。
 * side 指定只拿掉某一端的:"out" = 片段結尾那組、"in" = 開頭那組;不指定 = 全部。
 * 端點記在 id 裡(`cut-out-…` / `cut-in-…`),這樣一個片段的開頭和結尾可以各有一組、互不干擾。
 */
export function stripCutEffects<
	E extends { id: string },
	A extends Record<string, unknown> | undefined,
>({
	effects,
	animations,
	side,
}: {
	effects: ReadonlyArray<E> | undefined;
	animations: A;
	side?: "out" | "in";
}): { effects: E[]; animations: A; removed: number } {
	const prefix = side ? `${CUT_EFFECT_ID_PREFIX}${side}-` : CUT_EFFECT_ID_PREFIX;
	const removedIds = new Set(
		(effects ?? []).filter((effect) => effect.id.startsWith(prefix)).map((effect) => effect.id),
	);
	const kept = (effects ?? []).filter((effect) => !removedIds.has(effect.id));
	if (removedIds.size === 0 || !animations) {
		return { effects: kept, animations, removed: removedIds.size };
	}
	const nextAnimations: Record<string, unknown> = {};
	for (const [path, data] of Object.entries(animations)) {
		const match = /^effects\.([^.]+)\.params\./.exec(path);
		if (match && removedIds.has(match[1]!)) continue;
		nextAnimations[path] = data;
	}
	return { effects: kept, animations: nextAnimations as A, removed: removedIds.size };
}

export function cutEffectId({ side, uuid }: { side: "out" | "in"; uuid: string }): string {
	return `${CUT_EFFECT_ID_PREFIX}${side}-${uuid}`;
}
