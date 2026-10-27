/**
 * 卡拉 OK 填色(純函式,有測試)。
 * 做法:每句歌詞疊兩層字幕——原本的字幕當底,上層複製一份換成「高亮色」並加一個擦除特效,
 * 擦除的線性掃過範圍剛好對應文字的左右邊界,進度做關鍵影格(100 → 0),高亮色就會隨時間由左向右填滿。
 * 片段數 = 句數 × 2,不是字數。
 */

export interface KaraokeSweep {
	/** 擦除特效的靜態參數(進度以外) */
	params: Record<string, string | number | boolean>;
	/** 進度關鍵影格,時間是相對片段開頭的秒數 */
	keyframes: Array<{ seconds: number; value: number }>;
}

/** 文字在畫面上的左右邊界(占畫面寬度的比例,0..1) */
export function computeTextSpanFraction({
	rectLeft,
	rectWidth,
	positionX,
	scaleX,
	canvasWidth,
	paddingFraction = 0.01,
}: {
	/** 量測得到的文字外框(相對於文字原點,像素) */
	rectLeft: number;
	rectWidth: number;
	positionX: number;
	scaleX: number;
	canvasWidth: number;
	/** 左右各多留一點,避免字形的外溢被切掉 */
	paddingFraction?: number;
}): { left: number; right: number } {
	if (
		!(canvasWidth > 0) ||
		!(Math.abs(scaleX) > 0) ||
		!(rectWidth > 0) ||
		!Number.isFinite(rectLeft + rectWidth + positionX + scaleX)
	) {
		return { left: 0, right: 1 };
	}
	const a = canvasWidth / 2 + positionX + scaleX * rectLeft;
	const b = a + scaleX * rectWidth;
	const left = Math.min(a, b) / canvasWidth - paddingFraction;
	const right = Math.max(a, b) / canvasWidth + paddingFraction;
	const clampedLeft = Math.min(1, Math.max(0, left));
	const clampedRight = Math.min(1, Math.max(0, right));
	if (!(clampedRight - clampedLeft > 0.001)) return { left: 0, right: 1 };
	return { left: clampedLeft, right: clampedRight };
}

export function planKaraokeSweep({
	span,
	durationSeconds,
	sweepFraction = 1,
}: {
	span: { left: number; right: number };
	durationSeconds: number;
	/** 填色佔整句長度的比例(1 = 一路填到句尾) */
	sweepFraction?: number;
}): KaraokeSweep | null {
	if (!(durationSeconds > 0)) return null;
	const fraction = Math.min(1, Math.max(0.05, sweepFraction));
	const sweep = durationSeconds * fraction;
	const toPercent = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 10000) / 100;
	return {
		params: {
			mode: "linear",
			progress: 100,
			softness: 0,
			// 往右掃,並反向:進度 100 → 0 時,可見的範圍從左邊長出來
			angle: 0,
			reverse: true,
			rangeStart: toPercent(span.left),
			rangeEnd: toPercent(span.right),
			centerX: 50,
			centerY: 50,
		},
		keyframes: [
			{ seconds: 0, value: 100 },
			{ seconds: sweep, value: 0 },
		],
	};
}
