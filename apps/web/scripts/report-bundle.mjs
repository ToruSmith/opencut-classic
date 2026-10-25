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
const rows = files.filter((path) => !path.endsWith(".map")).map((path) => {
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

// ---- 以 sourcemap 估算各 chunk 內「是誰佔了多少位元組」(需用 BUNDLE_ANALYZE=1 建置) ----
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = new Map([...B64].map((char, index) => [char, index]));

function decodeVlq(text, start, out) {
	let shift = 0;
	let value = 0;
	let index = start;
	for (;;) {
		const digit = B64_INDEX.get(text[index++]);
		value += (digit & 31) << shift;
		if (!(digit & 32)) break;
		shift += 5;
	}
	out.push(value & 1 ? -(value >> 1) : value >> 1);
	return index;
}

function groupOf(source) {
	const marker = source.lastIndexOf("node_modules/");
	if (marker !== -1) {
		const rest = source.slice(marker + "node_modules/".length).split("/");
		return rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
	}
	const srcMarker = source.lastIndexOf("/src/");
	const path = srcMarker !== -1 ? source.slice(srcMarker + 5) : source;
	return `src/${path.split("/").slice(0, 2).join("/")}`;
}

function attribute(jsPath) {
	const mapPath = `${jsPath}.map`;
	let map;
	try {
		map = JSON.parse(readFileSync(mapPath, "utf8"));
	} catch {
		return null;
	}
	const code = readFileSync(jsPath, "utf8").split("\n");
	const groups = new Map();
	const add = (source, bytes) => {
		if (bytes <= 0) return;
		const key = source === undefined ? "(未對應)" : groupOf(map.sources[source]);
		groups.set(key, (groups.get(key) ?? 0) + bytes);
	};
	let source = 0;
	map.mappings.split(";").forEach((line, lineIndex) => {
		let column = 0;
		const text = code[lineIndex] ?? "";
		const segments = line ? line.split(",") : [];
		let previous = null;
		for (const segment of segments) {
			const fields = [];
			let cursor = 0;
			while (cursor < segment.length) cursor = decodeVlq(segment, cursor, fields);
			column += fields[0];
			if (fields.length > 1) source += fields[1];
			if (previous) add(previous.source, column - previous.column);
			previous = { column, source: fields.length > 1 ? source : undefined };
		}
		if (previous) add(previous.source, text.length - previous.column);
	});
	return [...groups.entries()].sort((a, b) => b[1] - a[1]);
}

const analysis = [];
for (const row of rows.filter((r) => r.name.endsWith(".js")).slice(0, 4)) {
	const groups = attribute(join(root, row.name));
	if (!groups) continue;
	analysis.push("", `── ${row.name}(${(row.size / 1024).toFixed(0)} KB)內容佔比 ──`);
	for (const [name, bytes] of groups.slice(0, 28)) {
		analysis.push(`${(bytes / 1024).toFixed(1).padStart(9)} KB  ${name}`);
	}
}
lines.push(...analysis);

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
