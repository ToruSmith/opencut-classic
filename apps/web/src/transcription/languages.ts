export const LANGUAGES = [
	{ code: "en", name: "英文" },
	{ code: "es", name: "西班牙文" },
	{ code: "it", name: "義大利文" },
	{ code: "fr", name: "法文" },
	{ code: "de", name: "德文" },
	{ code: "pt", name: "葡萄牙文" },
	{ code: "ru", name: "俄文" },
	{ code: "ja", name: "日文" },
	{ code: "zh", name: "中文" },
] as const;

export type Language = (typeof LANGUAGES)[number];
export type LanguageCode = Language["code"];
