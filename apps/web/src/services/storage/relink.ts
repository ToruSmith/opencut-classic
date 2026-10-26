/**
 * 重新連結素材:把使用者選的檔案對回專案裡缺少的素材(純函式,有測試)。
 *
 * 1. 檔名 + 檔案大小都一樣 → 一定是同一個檔案
 * 2. 只有檔名一樣、而且選的檔案裡只有一個同名的 → 也接受(例如重新轉存過,大小變了)
 * 每個檔案只用一次;同名但多個候選時寧可不連結,也不要接錯。
 */

export interface RelinkCandidate {
	id: string;
	name: string;
	size: number;
}

export function matchRelinkFiles<
	TMissing extends RelinkCandidate,
	TFile extends { name: string; size: number },
>({
	missing,
	files,
}: {
	missing: ReadonlyArray<TMissing>;
	files: ReadonlyArray<TFile>;
}): Array<{ metadata: TMissing; file: TFile }> {
	const used = new Set<TFile>();
	const matches: Array<{ metadata: TMissing; file: TFile }> = [];
	const pending: TMissing[] = [];

	for (const metadata of missing) {
		const exact = files.find(
			(file) =>
				!used.has(file) && file.name === metadata.name && file.size === metadata.size,
		);
		if (exact) {
			used.add(exact);
			matches.push({ metadata, file: exact });
		} else {
			pending.push(metadata);
		}
	}

	for (const metadata of pending) {
		const sameName = files.filter(
			(file) => !used.has(file) && file.name === metadata.name,
		);
		const otherMissingWithSameName = pending.filter(
			(other) => other.name === metadata.name,
		).length;
		if (sameName.length === 1 && otherMissingWithSameName === 1) {
			used.add(sameName[0]);
			matches.push({ metadata, file: sameName[0] });
		}
	}

	return matches;
}
