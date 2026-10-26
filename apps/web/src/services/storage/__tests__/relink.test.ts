import { describe, expect, test } from "bun:test";
import { matchRelinkFiles } from "../relink";

const meta = (id: string, name: string, size: number) => ({ id, name, size });
const file = (name: string, size: number) => ({ name, size });

describe("matchRelinkFiles", () => {
	test("檔名 + 大小相同就連結", () => {
		const a = file("a.mp4", 100);
		const result = matchRelinkFiles({
			missing: [meta("1", "a.mp4", 100)],
			files: [file("b.mp4", 100), a],
		});
		expect(result).toEqual([{ metadata: meta("1", "a.mp4", 100), file: a }]);
	});

	test("大小不同但檔名唯一,也連結", () => {
		const a = file("a.mp4", 999);
		const result = matchRelinkFiles({ missing: [meta("1", "a.mp4", 100)], files: [a] });
		expect(result.map((m) => m.file)).toEqual([a]);
	});

	test("同名候選有好幾個、大小都不對,寧可不連結", () => {
		const result = matchRelinkFiles({
			missing: [meta("1", "clip.mp4", 100)],
			files: [file("clip.mp4", 1), file("clip.mp4", 2)],
		});
		expect(result).toEqual([]);
	});

	test("兩個同名素材:各自用大小對上,不會重複使用同一個檔案", () => {
		const big = file("clip.mp4", 200);
		const small = file("clip.mp4", 100);
		const result = matchRelinkFiles({
			missing: [meta("1", "clip.mp4", 100), meta("2", "clip.mp4", 200)],
			files: [big, small],
		});
		expect(result.map((m) => [m.metadata.id, m.file.size])).toEqual([
			["1", 100],
			["2", 200],
		]);
	});

	test("沒有對應的檔案就略過", () => {
		expect(
			matchRelinkFiles({ missing: [meta("1", "a.mp4", 1)], files: [file("z.mp4", 1)] }),
		).toEqual([]);
	});
});
