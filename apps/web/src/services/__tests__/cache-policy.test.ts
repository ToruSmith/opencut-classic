import { describe, expect, test } from "bun:test";
import {
	isWithinPrewarmWindow,
	pickEvictions,
	touchLru,
	trimLru,
} from "../cache-policy";

const entry = (key: string, lastUsed: number, busy = false) => ({
	key,
	lastUsed,
	busy,
});

describe("pickEvictions", () => {
	test("沒超過上限不淘汰", () => {
		expect(
			pickEvictions({ entries: [entry("a", 1), entry("b", 2)], max: 2 }),
		).toEqual([]);
	});

	test("超過時從最舊的開始淘汰", () => {
		const result = pickEvictions({
			entries: [entry("a", 5), entry("b", 1), entry("c", 3), entry("d", 9)],
			max: 2,
		});
		expect(result).toEqual(["b", "c"]);
	});

	test("忙碌中與 keep 不淘汰,即使最舊", () => {
		const result = pickEvictions({
			entries: [entry("a", 1, true), entry("b", 2), entry("c", 3), entry("d", 4)],
			max: 2,
			keep: "b",
		});
		expect(result).toEqual(["c", "d"]);
	});

	test("全部忙碌時淘汰不夠也不報錯", () => {
		const result = pickEvictions({
			entries: [entry("a", 1, true), entry("b", 2, true), entry("c", 3, true)],
			max: 1,
		});
		expect(result).toEqual([]);
	});

	test("max 為 0 時淘汰所有可淘汰的", () => {
		const result = pickEvictions({
			entries: [entry("a", 1), entry("b", 2)],
			max: 0,
		});
		expect(result).toEqual(["a", "b"]);
	});
});

describe("LRU Map", () => {
	test("touchLru 把命中的項目搬到最後", () => {
		const map = new Map([
			["a", 1],
			["b", 2],
			["c", 3],
		]);
		expect(touchLru({ map, key: "a" })).toBe(1);
		expect([...map.keys()]).toEqual(["b", "c", "a"]);
		expect(touchLru({ map, key: "zzz" })).toBeUndefined();
	});

	test("trimLru 刪最舊的直到剩 max 筆並回報", () => {
		const map = new Map([
			["a", 1],
			["b", 2],
			["c", 3],
		]);
		touchLru({ map, key: "a" });
		expect(trimLru({ map, max: 2 })).toEqual(["b"]);
		expect([...map.keys()]).toEqual(["c", "a"]);
		expect(trimLru({ map, max: 5 })).toEqual([]);
	});
});

describe("isWithinPrewarmWindow", () => {
	test("只在片段開始前的視窗內為真", () => {
		expect(isWithinPrewarmWindow({ clipTime: -50, lookahead: 100 })).toBe(true);
		expect(isWithinPrewarmWindow({ clipTime: -100, lookahead: 100 })).toBe(true);
		expect(isWithinPrewarmWindow({ clipTime: -101, lookahead: 100 })).toBe(false);
		expect(isWithinPrewarmWindow({ clipTime: 0, lookahead: 100 })).toBe(false);
		expect(isWithinPrewarmWindow({ clipTime: 10, lookahead: 100 })).toBe(false);
	});
});
