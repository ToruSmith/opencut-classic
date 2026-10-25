// 列出 dist 內的檔案大小(原始 / gzip),輸出成 GitHub Actions 註解與工作摘要。
// 用法:node scripts/report-bundle.mjs [dist 目錄] [顯示筆數]
import { readdirSync, readFileSync, statSync, appendFileSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";

const root = process.argv[2] ?? "dist";
const limit = Number(process.argv[3] ?? 40);

const files = [];
const walk = (dir) => {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) walk(path);
		else files.push(path);
	}
};
walk(root);

const compressible = /\.(js|mjs|css|html|json|svg|wasm|txt)$/;
const rows = files.map((path) => {
	const data = readFileSync(path);
	const gzip = compressible.test(path) ? gzipSync(data).length : data.length;
	return { name: relative(root, path), size: data.length, gzip };
});
rows.sort((a, b) => b.gzip - a.gzip);

const kb = (n) => (n / 1024).toFixed(1).padStart(9);
const sum = (key, filter = () => true) =>
	rows.filter(filter).reduce((total, row) => total + row[key], 0);
const isCode = (row) => /\.(js|mjs|css)$/.test(row.name);
const isInitial = (row) => /^assets\/(index|main)[^/]*\.(js|css)$/.test(row.name);

const lines = [
	`總計 ${rows.length} 個檔案: ${(sum("size") / 1048576).toFixed(2)} MB(gzip 後約 ${(sum("gzip") / 1048576).toFixed(2)} MB)`,
	`JS+CSS: ${kb(sum("size", isCode))} KB / gzip ${kb(sum("gzip", isCode))} KB`,
	`入口 index chunk: ${kb(sum("size", isInitial))} KB / gzip ${kb(sum("gzip", isInitial))} KB`,
	"",
	`${"raw KB".padStart(9)} ${"gzip KB".padStart(9)}  檔案(依 gzip 由大到小,前 ${limit} 個)`,
	...rows.slice(0, limit).map((r) => `${kb(r.size)} ${kb(r.gzip)}  ${r.name}`),
];

console.log(lines.join("\n"));

if (process.env.GITHUB_ACTIONS) {
	const encoded = lines
		.join("\n")
		.replace(/%/g, "%25")
		.replace(/\r/g, "%0D")
		.replace(/\n/g, "%0A");
	console.log(`::notice title=bundle-report::${encoded}`);
	if (process.env.GITHUB_STEP_SUMMARY) {
		appendFileSync(
			process.env.GITHUB_STEP_SUMMARY,
			`### 打包大小\n\n\`\`\`\n${lines.join("\n")}\n\`\`\`\n`,
		);
	}
}
