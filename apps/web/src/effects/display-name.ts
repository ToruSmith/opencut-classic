import { capitalizeFirstLetter } from "@/utils/string";

/**
 * 特效片段在時間軸上顯示的名稱。
 * 舊版建立片段時把英文 type 首字大寫存成名稱(例如 "Film-grain"),
 * 這種「自動產生」的名稱改顯示中文名稱;使用者自己改過的名稱照原樣顯示。
 */
export function getEffectElementDisplayName({
	name,
	effectType,
	definitionName,
}: {
	name: string;
	effectType: string;
	definitionName: string | null;
}): string {
	if (!definitionName) return name;
	const trimmed = name.trim();
	if (trimmed === "" || trimmed === effectType || trimmed === capitalizeFirstLetter({ string: effectType })) {
		return definitionName;
	}
	return name;
}
