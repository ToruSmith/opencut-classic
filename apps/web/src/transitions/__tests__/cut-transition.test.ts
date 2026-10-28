import { describe, expect, test } from "bun:test";
import {
	CUT_TRANSITION_KINDS,
	cutEffectId,
	easeKeyframes,
	findCutPoints,
	pickCutKinds,
	planCutTransition,
	sideSecondsFor,
	stripCutEffects,
} from "../cut-transition";

describe("切點轉場:關鍵影格", () => {
	test("出場端:最後 h 秒加速到峰值,切點那一格最強", () => {
		const keys = easeKeyframes({ paramKey: "x", side: "out", sideSeconds: 0.2, clipSeconds: 2, rest: 0, peak: 100 });
		expect(keys[0]).toEqual({ paramKey: "x", seconds: 1.8, value: 0 });
		expect(keys.at(-1)).toEqual({ paramKey: "x", seconds: 2, value: 100 });
		// 緩入:前半段只走了四分之一
		expect(keys[1]!.value).toBeCloseTo(25);
	});

	test("進場端:開頭最強,h 秒後回到中性值,時間由小到大", () => {
		const keys = easeKeyframes({ paramKey: "x", side: "in", sideSeconds: 0.2, clipSeconds: 2, rest: 100, peak: 160 });
		expect(keys[0]).toEqual({ paramKey: "x", seconds: 0, value: 160 });
		expect(keys.at(-1)!.seconds).toBeCloseTo(0.2);
		expect(keys.at(-1)!.value).toBe(100);
		for (let i = 1; i < keys.length; i++) expect(keys[i]!.seconds).toBeGreaterThan(keys[i - 1]!.seconds);
	});

	test("一側長度不超過片段一半,太短就不做", () => {
		expect(sideSecondsFor({ requested: 0.2, clipSeconds: 2 })).toBe(0.2);
		expect(sideSecondsFor({ requested: 0.2, clipSeconds: 0.3 })).toBe(0.15);
		expect(sideSecondsFor({ requested: 0.2, clipSeconds: 0.04 })).toBe(0);
		expect(sideSecondsFor({ requested: 0, clipSeconds: 2 })).toBe(0);
	});
});

describe("切點轉場:計畫", () => {
	test("每種轉場都有計畫,關鍵影格在片段範圍內,固定參數是中性值(轉場以外不送 pass)", () => {
		const neutral: Record<string, number> = {
			brightness: 0, scale: 100, strength: 0, offsetX: 0, offsetY: 0, blur: 0, rotation: 0, intensity: 0, amount: 0,
		};
		for (const kind of CUT_TRANSITION_KINDS) {
			const plan = planCutTransition({ kind, sideSeconds: 0.2, outClipSeconds: 1, inClipSeconds: 1.5 });
			expect(plan).not.toBeNull();
			for (const side of ["out", "in"] as const) {
				for (const effect of plan![side]) {
					const clip = side === "out" ? 1 : 1.5;
					for (const keyframe of effect.keyframes) {
						expect(keyframe.seconds).toBeGreaterThanOrEqual(0);
						expect(keyframe.seconds).toBeLessThanOrEqual(clip + 1e-9);
						expect(effect.params[keyframe.paramKey]).toBe(neutral[keyframe.paramKey]);
					}
				}
			}
		}
	});

	test("甩鏡:兩端同一個運動方向(出場 0 → +,進場 - → 0)", () => {
		const plan = planCutTransition({ kind: "whip", direction: "right", sideSeconds: 0.2, outClipSeconds: 1, inClipSeconds: 1 })!;
		const outX = plan.out[0]!.keyframes.filter((k) => k.paramKey === "offsetX");
		const inX = plan.in[0]!.keyframes.filter((k) => k.paramKey === "offsetX");
		expect(outX.at(-1)!.value).toBeGreaterThan(0);
		expect(inX[0]!.value).toBeLessThan(0);
		expect(plan.in[0]!.params.blurAngle).toBe(0);
		const down = planCutTransition({ kind: "whip", direction: "down", sideSeconds: 0.2, outClipSeconds: 1, inClipSeconds: 1 })!;
		expect(down.out[0]!.keyframes.some((k) => k.paramKey === "offsetY")).toBe(true);
		expect(down.out[0]!.params.blurAngle).toBe(90);
	});

	test("強度縮放峰值;片段太短的一側省略,兩側都不行回傳 null", () => {
		const strong = planCutTransition({ kind: "flash", sideSeconds: 0.2, outClipSeconds: 1, inClipSeconds: 1, intensity: 1 })!;
		const weak = planCutTransition({ kind: "flash", sideSeconds: 0.2, outClipSeconds: 1, inClipSeconds: 1, intensity: 0.5 })!;
		expect(strong.out[0]!.keyframes.at(-1)!.value).toBe(100);
		expect(weak.out[0]!.keyframes.at(-1)!.value).toBe(50);
		const oneSide = planCutTransition({ kind: "flash", sideSeconds: 0.2, outClipSeconds: 0.01, inClipSeconds: 1 })!;
		expect(oneSide.out).toEqual([]);
		expect(oneSide.in.length).toBe(1);
		expect(planCutTransition({ kind: "flash", sideSeconds: 0.2, outClipSeconds: 0.01, inClipSeconds: 0.01 })).toBeNull();
	});
});

describe("切點轉場:找切點、抽籤、清除", () => {
	test("同一軌道首尾相接才算切點;有空隙、不同軌道不算", () => {
		const cuts = findCutPoints({
			items: [
				{ id: "b", trackId: "t1", start: 1, end: 2 },
				{ id: "a", trackId: "t1", start: 0, end: 1 },
				{ id: "c", trackId: "t1", start: 2.5, end: 3 },
				{ id: "d", trackId: "t2", start: 2, end: 3 },
			],
		});
		expect(cuts).toEqual([{ outId: "a", inId: "b", trackId: "t1", time: 1 }]);
	});

	test("隨機:同種子可重現、相鄰不重複", () => {
		const a = pickCutKinds({ count: 30, seed: 7 });
		expect(a).toEqual(pickCutKinds({ count: 30, seed: 7 }));
		for (let i = 1; i < a.length; i++) expect(a[i]).not.toBe(a[i - 1]);
		expect(pickCutKinds({ count: 0, seed: 1 })).toEqual([]);
	});

	test("清除只拿掉指定端的切點轉場特效與它們的關鍵影格", () => {
		const outId = cutEffectId({ side: "out", uuid: "1" });
		const inId = cutEffectId({ side: "in", uuid: "2" });
		const effects = [{ id: "user" }, { id: outId }, { id: inId }];
		const animations = {
			[`effects.${outId}.params.blur`]: { k: 1 },
			[`effects.${inId}.params.blur`]: { k: 2 },
			"effects.user.params.amount": { k: 3 },
			"transform.scaleX": { k: 4 },
		};
		const outOnly = stripCutEffects({ effects, animations, side: "out" });
		expect(outOnly.effects.map((e) => e.id)).toEqual(["user", inId]);
		expect(Object.keys(outOnly.animations).sort()).toEqual(
			[`effects.${inId}.params.blur`, "effects.user.params.amount", "transform.scaleX"].sort(),
		);
		const all = stripCutEffects({ effects, animations });
		expect(all.effects.map((e) => e.id)).toEqual(["user"]);
		expect(all.removed).toBe(2);
		expect(stripCutEffects({ effects: undefined, animations: undefined }).effects).toEqual([]);
	});
});
