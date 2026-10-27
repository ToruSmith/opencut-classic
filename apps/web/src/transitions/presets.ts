/**
 * 進場 / 出場動畫的關鍵影格產生器。
 *
 * 純函式:只依賴元素資料,不碰 wasm 或編輯器狀態,所以可以直接單元測試。
 * 時間一律用「相對於片段開頭的秒數」,由呼叫端轉成 MediaTime。
 *
 * 注意:元素目前的音量、不透明度、位置等值存在 `element.params`,
 * 動畫的「基準值」必須從那裡讀,否則動畫結束時會跳回預設值。
 */

export type TransitionSide = "in" | "out";

export type TransitionMotion =
	| "fade"
	| "slide-left"
	| "slide-right"
	| "slide-up"
	| "slide-down"
	| "zoom"
	| "spin"
	| "pop";

export interface TransitionKeyframe {
	propertyPath: string;
	/** 相對片段開頭的秒數 */
	seconds: number;
	value: number;
}

export interface TransitionTarget {
	type: string;
	params: Record<string, unknown>;
	/** 片段長度(秒) */
	durationSeconds: number;
	/** 影片片段的原始音訊是否啟用;只有啟用時才有聲音可淡化 */
	hasAudio: boolean;
}

export const TRANSITION_VOLUME_DB_MIN = -60;
const VISUAL_TYPES = new Set(["video", "image", "text", "sticker", "graphic"]);
const MIN_FADE_SECONDS = 0.01;

export const SLIDE_MOTIONS: ReadonlyArray<TransitionMotion> = [
	"slide-left",
	"slide-right",
	"slide-up",
	"slide-down",
];

export function isVisualType({ type }: { type: string }): boolean {
	return VISUAL_TYPES.has(type);
}

function readNumber({
	params,
	key,
	fallback,
}: {
	params: Record<string, unknown>;
	key: string;
	fallback: number;
}): number {
	const value = params[key];
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** 動畫長度不超過片段一半,這樣同一片段上的進場與出場不會互相重疊 */
export function clampTransitionSeconds({
	seconds,
	durationSeconds,
}: {
	seconds: number;
	durationSeconds: number;
}): number {
	return Math.min(seconds, durationSeconds / 2);
}

/**
 * 以一組「(進度, 數值)」關鍵點展開成關鍵影格。
 * side 為 "in" 時進度 0 在片段開頭、1 在動畫結束;
 * 為 "out" 時時間軸鏡像,進度 0 在動畫開始、1 在片段結尾,並且數值順序反轉。
 */
export function ramp({
	propertyPath,
	side,
	durationSeconds,
	seconds,
	points,
}: {
	propertyPath: string;
	side: TransitionSide;
	durationSeconds: number;
	seconds: number;
	/** 進場方向的關鍵點:progress 0..1,value;最後一點必須是基準值 */
	points: Array<{ progress: number; value: number }>;
}): TransitionKeyframe[] {
	if (side === "in") {
		return points.map(({ progress, value }) => ({
			propertyPath,
			seconds: progress * seconds,
			value,
		}));
	}
	const start = durationSeconds - seconds;
	return points.map(({ progress, value }) => ({
		propertyPath,
		seconds: start + (1 - progress) * seconds,
		value,
	}));
}

export function buildTransitionKeyframes({
	target,
	motion,
	side,
	seconds,
	canvas,
}: {
	target: TransitionTarget;
	motion: TransitionMotion;
	side: TransitionSide;
	seconds: number;
	canvas: { width: number; height: number };
}): TransitionKeyframe[] {
	const d = clampTransitionSeconds({
		seconds,
		durationSeconds: target.durationSeconds,
	});
	if (!(d >= MIN_FADE_SECONDS)) return [];

	const { params, durationSeconds } = target;
	const isVisual = isVisualType({ type: target.type });
	const canHaveVolume =
		target.type === "audio" || (target.type === "video" && target.hasAudio);
	const make = ({
		propertyPath,
		points,
	}: {
		propertyPath: string;
		points: Array<{ progress: number; value: number }>;
	}) =>
		ramp({ propertyPath, side, durationSeconds, seconds: d, points });

	const baseOpacity = readNumber({ params, key: "opacity", fallback: 1 });
	const baseVolume = readNumber({ params, key: "volume", fallback: 0 });
	const baseX = readNumber({ params, key: "transform.positionX", fallback: 0 });
	const baseY = readNumber({ params, key: "transform.positionY", fallback: 0 });
	const baseScaleX = readNumber({ params, key: "transform.scaleX", fallback: 1 });
	const baseScaleY = readNumber({ params, key: "transform.scaleY", fallback: 1 });
	const baseRotate = readNumber({ params, key: "transform.rotate", fallback: 0 });

	const fadeOpacity = () =>
		make({
			propertyPath: "opacity",
			points: [
				{ progress: 0, value: 0 },
				{ progress: 1, value: baseOpacity },
			],
		});

	switch (motion) {
		case "fade": {
			const result: TransitionKeyframe[] = [];
			if (isVisual) result.push(...fadeOpacity());
			if (canHaveVolume) {
				result.push(
					...make({
						propertyPath: "volume",
						points: [
							{ progress: 0, value: TRANSITION_VOLUME_DB_MIN },
							{ progress: 1, value: baseVolume },
						],
					}),
				);
			}
			return result;
		}

		case "slide-left":
		case "slide-right":
		case "slide-up":
		case "slide-down": {
			if (!isVisual) return [];
			// 從畫面外滑進來 / 滑到畫面外:偏移一個畫布寬或高
			const horizontal = motion === "slide-left" || motion === "slide-right";
			// 「從左滑入」= 起點在左邊(負方向);「向左滑出」= 終點在左邊
			const sign = motion === "slide-left" || motion === "slide-up" ? -1 : 1;
			const offset = (horizontal ? canvas.width : canvas.height) * sign;
			return make({
				propertyPath: horizontal ? "transform.positionX" : "transform.positionY",
				points: [
					{ progress: 0, value: (horizontal ? baseX : baseY) + offset },
					{ progress: 1, value: horizontal ? baseX : baseY },
				],
			});
		}

		case "zoom": {
			if (!isVisual) return [];
			// 進場由小放大,出場縮小消失(出場時 ramp 會自動鏡像)
			const from = 0.6;
			return [
				...make({
					propertyPath: "transform.scaleX",
					points: [
						{ progress: 0, value: baseScaleX * from },
						{ progress: 1, value: baseScaleX },
					],
				}),
				...make({
					propertyPath: "transform.scaleY",
					points: [
						{ progress: 0, value: baseScaleY * from },
						{ progress: 1, value: baseScaleY },
					],
				}),
				...fadeOpacity(),
			];
		}

		case "spin": {
			if (!isVisual) return [];
			return [
				...make({
					propertyPath: "transform.rotate",
					points: [
						{ progress: 0, value: baseRotate - 90 },
						{ progress: 1, value: baseRotate },
					],
				}),
				...fadeOpacity(),
			];
		}

		case "pop": {
			if (!isVisual) return [];
			// 先稍微超過再回到原大小,像彈出來
			const overshoot = 1.12;
			const scalePoints = (base: number) => [
				{ progress: 0, value: 0 },
				{ progress: 0.65, value: base * overshoot },
				{ progress: 1, value: base },
			];
			return [
				...make({
					propertyPath: "transform.scaleX",
					points: scalePoints(baseScaleX),
				}),
				...make({
					propertyPath: "transform.scaleY",
					points: scalePoints(baseScaleY),
				}),
				...make({
					propertyPath: "opacity",
					points: [
						{ progress: 0, value: 0 },
						{ progress: 0.3, value: baseOpacity },
						{ progress: 1, value: baseOpacity },
					],
				}),
			];
		}
	}
}

/** 隨機轉場可抽的動畫(不含單純淡化,切點處淡化會變成一格一格閃黑) */
export const RANDOM_MOTION_POOL: ReadonlyArray<TransitionMotion> = [
	"slide-left",
	"slide-right",
	"slide-up",
	"slide-down",
	"zoom",
	"spin",
	"pop",
];

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

/**
 * 為 count 個切點各抽一種動畫:同樣的種子結果相同,且相鄰兩個不會抽到一樣的。
 */
export function pickRandomMotions({
	count,
	seed,
	pool = RANDOM_MOTION_POOL,
}: {
	count: number;
	seed: number;
	pool?: ReadonlyArray<TransitionMotion>;
}): TransitionMotion[] {
	if (count <= 0 || pool.length === 0) return [];
	const random = mulberry32({ seed });
	const result: TransitionMotion[] = [];
	for (let i = 0; i < count; i++) {
		const candidates =
			pool.length > 1 && i > 0 ? pool.filter((motion) => motion !== result[i - 1]) : pool;
		result.push(candidates[Math.floor(random() * candidates.length)]);
	}
	return result;
}
