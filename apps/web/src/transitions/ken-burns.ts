/**
 * 緩慢推近 / 拉遠 / 平移(Ken Burns):整個片段長度的縮放 + 位置關鍵影格。
 * 純函式,不碰 wasm 或編輯器狀態。不增加任何 shader pass,預覽成本等同一般關鍵影格動畫。
 *
 * 基準值(縮放、位置)從 `element.params` 讀,動畫是「相對目前值」,不是覆蓋成固定值。
 * 平移時整段維持放大 `zoom`,位移量不超過放大多出來的邊,所以畫面邊緣不會露出來
 * (前提是素材本來就蓋滿畫布)。
 */

export const KEN_BURNS_KINDS = [
	"zoom-in",
	"zoom-out",
	"pan-left",
	"pan-right",
	"pan-up",
	"pan-down",
] as const;
export type KenBurnsKind = (typeof KEN_BURNS_KINDS)[number];

export interface KenBurnsKeyframe {
	propertyPath: string;
	/** 相對片段開頭的秒數 */
	seconds: number;
	value: number;
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

/**
 * @param zoom 推近 / 拉遠的幅度,或平移時的放大量(0.15 = 15%)
 */
export function buildKenBurnsKeyframes({
	params,
	durationSeconds,
	kind,
	zoom,
	canvas,
}: {
	params: Record<string, unknown>;
	durationSeconds: number;
	kind: KenBurnsKind;
	zoom: number;
	canvas: { width: number; height: number };
}): KenBurnsKeyframe[] {
	if (!(durationSeconds > 0) || !(zoom > 0)) return [];

	const baseScaleX = readNumber({ params, key: "transform.scaleX", fallback: 1 });
	const baseScaleY = readNumber({ params, key: "transform.scaleY", fallback: 1 });
	const baseX = readNumber({ params, key: "transform.positionX", fallback: 0 });
	const baseY = readNumber({ params, key: "transform.positionY", fallback: 0 });

	const end = durationSeconds;
	const scalePair = ({ from, to }: { from: number; to: number }) => [
		{ propertyPath: "transform.scaleX", seconds: 0, value: baseScaleX * from },
		{ propertyPath: "transform.scaleX", seconds: end, value: baseScaleX * to },
		{ propertyPath: "transform.scaleY", seconds: 0, value: baseScaleY * from },
		{ propertyPath: "transform.scaleY", seconds: end, value: baseScaleY * to },
	];

	if (kind === "zoom-in") return scalePair({ from: 1, to: 1 + zoom });
	if (kind === "zoom-out") return scalePair({ from: 1 + zoom, to: 1 });

	// 平移:全程放大 (1 + zoom),位移最多是放大多出來的邊的一半(兩側各一半)
	const horizontal = kind === "pan-left" || kind === "pan-right";
	const travel = ((horizontal ? canvas.width : canvas.height) * zoom) / 2;
	// 「向左平移」= 畫面內容往左移 = 位置由正到負
	const direction = kind === "pan-left" || kind === "pan-up" ? -1 : 1;
	const path = horizontal ? "transform.positionX" : "transform.positionY";
	const base = horizontal ? baseX : baseY;
	return [
		...scalePair({ from: 1 + zoom, to: 1 + zoom }),
		{ propertyPath: path, seconds: 0, value: base - direction * travel },
		{ propertyPath: path, seconds: end, value: base + direction * travel },
	];
}

/** 每個片段各抽一種,相鄰不重複;同種子可重現 */
export function pickKenBurnsKinds({
	count,
	seed,
}: {
	count: number;
	seed: number;
}): KenBurnsKind[] {
	if (count <= 0) return [];
	let state = (seed >>> 0) || 1;
	const random = () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const result: KenBurnsKind[] = [];
	for (let i = 0; i < count; i++) {
		const pool =
			i > 0 ? KEN_BURNS_KINDS.filter((kind) => kind !== result[i - 1]) : KEN_BURNS_KINDS;
		result.push(pool[Math.floor(random() * pool.length)]!);
	}
	return result;
}
