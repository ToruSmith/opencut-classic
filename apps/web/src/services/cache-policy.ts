/**
 * 快取淘汰規則(純函式,有測試)。
 * 影片解碼器與圖片快取都靠它限制數量,避免素材一多記憶體與解碼器數量一路增加。
 */

export interface EvictionEntry {
	key: string;
	/** 最後一次使用的時間(ms,越小越舊) */
	lastUsed: number;
	/** 正在處理中(例如還有解碼請求在排隊),不可淘汰 */
	busy: boolean;
}

/**
 * 回傳要淘汰的 key(由最舊的開始)。
 * 數量超過 `max` 才會淘汰;`keep` 與忙碌中的項目一律保留,所以全部都忙時可能淘汰不夠。
 */
export function pickEvictions({
	entries,
	max,
	keep,
}: {
	entries: EvictionEntry[];
	max: number;
	keep?: string;
}): string[] {
	const excess = entries.length - Math.max(0, max);
	if (excess <= 0) return [];

	return entries
		.filter((entry) => !entry.busy && entry.key !== keep)
		.sort((a, b) => a.lastUsed - b.lastUsed)
		.slice(0, excess)
		.map((entry) => entry.key);
}

/**
 * 把 Map 當 LRU 用(依插入順序):命中時先 `touchLru` 搬到最後,
 * 新增後呼叫 `trimLru` 把最舊的刪到剩 `max` 筆。回傳被刪掉的 key。
 */
export function touchLru<K, V>({ map, key }: { map: Map<K, V>; key: K }): V | undefined {
	if (!map.has(key)) return undefined;
	const value = map.get(key) as V;
	map.delete(key);
	map.set(key, value);
	return value;
}

export function trimLru<K, V>({ map, max }: { map: Map<K, V>; max: number }): K[] {
	const evicted: K[] = [];
	const limit = Math.max(0, max);
	while (map.size > limit) {
		const oldest = map.keys().next();
		if (oldest.done) break;
		map.delete(oldest.value);
		evicted.push(oldest.value);
	}
	return evicted;
}

/**
 * 是否落在預熱視窗:`clipTime` = 目前時間 - 片段開始時間(負值 = 還沒開始),
 * `lookahead` 與 `clipTime` 用同一個單位(預覽用 tick)。
 */
export function isWithinPrewarmWindow({
	clipTime,
	lookahead,
}: {
	clipTime: number;
	lookahead: number;
}): boolean {
	return clipTime < 0 && clipTime >= -lookahead;
}
