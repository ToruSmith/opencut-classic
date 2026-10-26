export function formatDate({ date }: { date: Date }): string {
	return date.toLocaleDateString("zh-TW", {
		month: "numeric",
		day: "numeric",
		year: "numeric",
	});
}
