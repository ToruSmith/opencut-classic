import { describe, expect, test } from "bun:test";
import { getEffectElementDisplayName } from "../display-name";

describe("特效片段的顯示名稱", () => {
	const name = (n: string) =>
		getEffectElementDisplayName({ name: n, effectType: "film-grain", definitionName: "底片顆粒" });

	test("舊版自動產生的英文名稱改顯示中文", () => {
		expect(name("Film-grain")).toBe("底片顆粒");
		expect(name("film-grain")).toBe("底片顆粒");
		expect(name("")).toBe("底片顆粒");
	});

	test("使用者自己取的名稱不變", () => {
		expect(name("開場顆粒")).toBe("開場顆粒");
	});

	test("找不到定義時維持原名", () => {
		expect(
			getEffectElementDisplayName({ name: "Old", effectType: "old", definitionName: null }),
		).toBe("Old");
	});
});
