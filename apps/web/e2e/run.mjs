#!/usr/bin/env node
/**
 * 自動驗收:無頭 Chromium(只用 CPU,走軟體繪圖)開啟建置好的網站,
 * 透過 `?e2e` 載入的測試掛鉤(src/diagnostics/e2e-hook.ts)建專案、匯入合成素材、排時間軸、播放,
 * 檢查「畫面顏色是否正確」「解碼器 / 圖片快取是否守住上限」「有沒有錯誤」,並輸出效能數字。
 *
 * 用法:node run.mjs --dist <網站資料夾> --fixtures <素材資料夾> --out <報告資料夾>
 * 素材由 make-fixtures.sh 產生。結束碼 0 = 全部通過,1 = 有項目失敗。
 *
 * 注意:軟體繪圖下的耗時比真實 GPU 慢很多,**絕對數字不能拿來和你家電腦比**;
 * 這裡的效能數字只用來比較「改動前後」與抓異常(例如某個計數暴增),
 * 判斷對錯的是顏色、上限、錯誤這些不隨速度改變的項目。
 */
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright";

const args = Object.fromEntries(
	process.argv.slice(2).reduce((pairs, value, index, all) => {
		if (value.startsWith("--")) pairs.push([value.slice(2), all[index + 1]]);
		return pairs;
	}, []),
);
const distDir = resolve(args.dist ?? "dist");
const fixturesDir = resolve(args.fixtures ?? "fixtures");
const outDir = resolve(args.out ?? "e2e-out");
mkdirSync(outDir, { recursive: true });

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json",
	".wasm": "application/wasm",
	".webm": "video/webm",
	".png": "image/png",
	".svg": "image/svg+xml",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".ico": "image/x-icon",
};

function serveFile({ response, filePath }) {
	if (!existsSync(filePath) || !statSync(filePath).isFile()) {
		response.writeHead(404);
		response.end("not found");
		return;
	}
	response.writeHead(200, {
		"content-type": MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream",
		"cache-control": "no-store",
	});
	createReadStream(filePath).pipe(response);
}

const server = createServer((request, response) => {
	const url = new URL(request.url ?? "/", "http://localhost");
	const pathname = decodeURIComponent(url.pathname);
	if (pathname.startsWith("/__fixtures__/")) {
		const name = normalize(pathname.slice("/__fixtures__/".length)).replace(/^(\.\.[/\\])+/, "");
		serveFile({ response, filePath: join(fixturesDir, name) });
		return;
	}
	const relative = normalize(pathname === "/" ? "/index.html" : pathname).replace(/^(\.\.[/\\])+/, "");
	serveFile({ response, filePath: join(distDir, relative) });
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

const results = [];
const warnings = [];
const fatalConsole = [];

function record({ name, ok, detail = "", metrics = undefined }) {
	results.push({ name, ok, detail, metrics });
	const mark = ok ? "PASS" : "FAIL";
	console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
	if (!ok) console.log(`::error title=e2e ${name}::${detail}`);
}

const FATAL_PATTERN = /NotReadableError|NotFoundError|Uncaught|RuntimeError|wgsl|shader|panick|unreachable/i;
const IGNORE_PATTERN = /powerPreference|ort-wasm|VerifyEachNodeIsAssignedToAnEp|content-length|favicon|GPU stall|swiftshader|Automatic fallback to software WebGL/i;

const browser = await chromium.launch({
	headless: true,
	args: [
		"--use-angle=swiftshader",
		"--use-gl=angle",
		"--enable-unsafe-swiftshader",
		"--ignore-gpu-blocklist",
		"--autoplay-policy=no-user-gesture-required",
		"--disable-background-timer-throttling",
		"--disable-renderer-backgrounding",
	],
});
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await context.newPage();

page.on("pageerror", (error) => {
	fatalConsole.push(`pageerror: ${error.message} @ ${String(error.stack ?? '').split('\n').slice(1, 4).map((l) => l.trim().replace(/https?:\/\/[^/]+\//, '')).join(' < ')}`);
});
page.on("console", (message) => {
	const text = message.text();
	if (message.type() === "error" || message.type() === "warning") {
		if (IGNORE_PATTERN.test(text)) return;
		if (message.type() === "error" && FATAL_PATTERN.test(text)) {
			fatalConsole.push(`console.error: ${text.slice(0, 300)}`);
		} else if (message.type() === "error") {
			warnings.push(text.slice(0, 300));
		}
	}
});

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function evaluate(fn, arg) {
	return page.evaluate(fn, arg);
}

async function waitFor({ label, fn, arg, timeout = 30000 }) {
	try {
		await page.waitForFunction(fn, arg, { timeout, polling: 250 });
		return true;
	} catch {
		console.log(`  等待逾時:${label}`);
		return false;
	}
}

/** 開一個新專案的編輯器頁面。第一次呼叫會載入網站。 */
async function openEditor({ name, first }) {
	if (first) {
		await page.goto(`${baseUrl}/?e2e=1#/projects`, { waitUntil: "load" });
		const hookReady = await waitFor({
			label: "測試掛鉤載入",
			fn: () => !!window.__opencut,
			timeout: 60000,
		});
		if (!hookReady) throw new Error("測試掛鉤沒有載入(window.__opencut 不存在)");
		// 剛載入時儲存層(IndexedDB 遷移、OPFS)可能還在初始化,太早建專案偶爾會卡住
		await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
		await sleep(4000);
	}
	const id = await evaluate((projectName) => window.__opencut.createProject({ name: projectName }), name);
	await evaluate((projectId) => {
		window.location.hash = `#/editor/${projectId}`;
	}, id);
	const ready = await waitFor({
		label: "專案載入",
		fn: (projectId) => window.__opencut.isProjectReady({ id: projectId }),
		arg: id,
		timeout: 90000,
	});
	if (!ready) {
		console.log("  專案沒有載入完成,重新載入再試一次");
		await page.reload({ waitUntil: "load" });
		const retry = await waitFor({
			label: "專案載入(重試)",
			fn: (projectId) => !!window.__opencut && window.__opencut.isProjectReady({ id: projectId }),
			arg: id,
			timeout: 90000,
		});
		if (!retry) {
			const diag = await page
				.evaluate(() => ({
					url: location.href,
					text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 200),
					hook: !!window.__opencut,
				}))
				.catch((error) => ({ error: String(error) }));
			throw new Error(`專案沒有載入完成 ${JSON.stringify(diag)}`);
		}
	}
	let marked = await waitFor({
		label: "預覽畫布出現",
		fn: () => window.__opencut.markPreviewCanvas(),
		timeout: 60000,
	});
	if (!marked) {
		// 冷啟動偶爾卡住(CI 上觀察到一次,重跑就過):重新載入頁面再試一次
		console.log("  預覽畫布沒出現,重新載入再試一次");
		await page.reload({ waitUntil: "load" });
		marked = await waitFor({
			label: "預覽畫布出現(重試)",
			fn: () => !!window.__opencut && window.__opencut.markPreviewCanvas(),
			timeout: 60000,
		});
	}
	if (!marked) {
		const diag = await page
			.evaluate(() => ({
				url: location.href,
				text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 200),
				canvases: document.querySelectorAll("canvas").length,
				hook: !!window.__opencut,
			}))
			.catch((error) => ({ error: String(error) }));
		throw new Error(`找不到預覽畫布 ${JSON.stringify(diag)}`);
	}
	return id;
}

async function importFixtures({ names }) {
	return evaluate(
		(urls) => window.__opencut.importFromUrls({ urls }),
		names.map((fileName) => `${baseUrl}/__fixtures__/${fileName}`),
	);
}

/** 截預覽畫布,回傳中心區塊的平均顏色 */
async function sampleCenterColor() {
	const locator = page.locator('[data-e2e-preview="1"]');
	const buffer = await locator.screenshot({ type: "png" });
	return evaluate(async (base64) => {
		const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
		const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
		const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
		const ctx = canvas.getContext("2d");
		ctx.drawImage(bitmap, 0, 0);
		const size = 24;
		const x = Math.floor(bitmap.width / 2 - size / 2);
		const y = Math.floor(bitmap.height / 2 - size / 2);
		const data = ctx.getImageData(x, y, size, size).data;
		let r = 0;
		let g = 0;
		let b = 0;
		const pixels = data.length / 4;
		for (let i = 0; i < data.length; i += 4) {
			r += data[i];
			g += data[i + 1];
			b += data[i + 2];
		}
		return [Math.round(r / pixels), Math.round(g / pixels), Math.round(b / pixels)];
	}, buffer.toString("base64"));
}

const CLIP_COLORS = {
	red: [255, 0, 0],
	green: [0, 128, 0], // ffmpeg 的 green 是 CSS 綠(0,128,0),不是 lime
	blue: [0, 0, 255],
	yellow: [255, 255, 0],
};
const CLIP_ORDER = ["red", "green", "blue", "yellow"];

function colorDistance(a, b) {
	return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

/** 等到預覽中心顏色接近期望值(任一個候選)。回傳 { ok, color, waitedMs } */
async function waitForColor({ candidates, timeout = 20000, tolerance = 70 }) {
	const start = Date.now();
	let color = [0, 0, 0];
	while (Date.now() - start < timeout) {
		color = await sampleCenterColor();
		if (candidates.some((candidate) => colorDistance(color, candidate) <= tolerance)) {
			return { ok: true, color, waitedMs: Date.now() - start };
		}
		await sleep(300);
	}
	return { ok: false, color, waitedMs: Date.now() - start };
}

function summarizePerf({ sink }) {
	const entries = sink ?? [];
	let frames = 0;
	const counters = {};
	const spanP95 = {};
	const spanMean = {};
	for (const entry of entries) {
		frames += entry.frames;
		for (const row of entry.counters ?? []) {
			counters[row.counter] = (counters[row.counter] ?? 0) + row.total;
		}
		for (const row of entry.spans ?? []) {
			spanP95[row.span] = Math.max(spanP95[row.span] ?? 0, row.p95Ms);
			spanMean[row.span] = Math.max(spanMean[row.span] ?? 0, row.meanMs);
		}
	}
	const busy = counters.previewBusyTick ?? 0;
	const spansMs = Object.fromEntries(
		Object.keys(spanMean).map((name) => [name, `${spanMean[name].toFixed(1)}/${(spanP95[name] ?? 0).toFixed(1)}`]),
	);
	return {
		spansMeanP95Ms: spansMs,
		renderedFrames: frames,
		previewBusyTicks: busy,
		busyRatio: frames + busy > 0 ? +(busy / (frames + busy)).toFixed(3) : 0,
		previewFrameP95Ms: spanP95.previewFrame ?? null,
		previewFrameMeanMs: spanMean.previewFrame ?? null,
		resolveP95Ms: spanP95.resolve ?? null,
		counters,
	};
}

/** 讀介面上實際顯示的東西:含時間格式的文字(連同所在元素)、播放 / 暫停圖示、預覽中心顏色 */
async function uiProbe() {
	const dom = await evaluate(() => {
		const timeLike = /\d{1,2}:\d{2}/;
		const rows = [];
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
		while (walker.nextNode()) {
			const value = (walker.currentNode.textContent ?? "").trim();
			if (value.length > 0 && value.length < 24 && timeLike.test(value)) {
				const parent = walker.currentNode.parentElement;
				const where = (parent?.className?.toString() ?? "").split(" ").slice(0, 3).join(".").slice(0, 40);
				rows.push(`${value}@${where}`);
			}
		}
		const icons = {
			play: document.querySelectorAll("svg.lucide-play, svg[class*='play']").length,
			pause: document.querySelectorAll("svg.lucide-pause, svg[class*='pause']").length,
		};
		return { rows: [...new Set(rows)].slice(0, 14), icons };
	});
	let color = null;
	try {
		color = await sampleCenterColor();
	} catch {}
	return `介面時間=${JSON.stringify(dom.rows)} 圖示=${JSON.stringify(dom.icons)} 預覽中心=rgb(${color ? color.join(",") : "?"})`;
}

async function scenario({ name, run }) {
	console.log(`\n=== ${name} ===`);
	try {
		await run();
	} catch (error) {
		record({ name: `${name}:執行`, ok: false, detail: error instanceof Error ? error.message : String(error) });
		try {
			await page.screenshot({ path: join(outDir, `${name}-error.png`) });
		} catch {}
	}
}

// ---------------------------------------------------------------------------
// 情境 A:依序播放的四段純色影片,在每段中間暫停,畫面必須是那一段的顏色
// ---------------------------------------------------------------------------
await scenario({
	name: "A-sequential",
	run: async () => {
		await openEditor({ name: "e2e-sequential", first: true });
		const state0 = await evaluate(() => window.__opencut.state());
		record({
			name: "A 啟動:繪圖後端",
			ok: true,
			detail: `isDegraded=${state0.isDegraded}(true 代表沒有可用的 GPU 繪圖,走降級路徑)`,
		});
		const videoFiles = readdirSync(fixturesDir).filter((file) => file.startsWith("clip-") && file.endsWith(".webm")).sort();
		const imported = await importFixtures({ names: videoFiles });
		record({
			name: "A 匯入影片",
			ok: imported.length === 4 && imported.every((asset) => asset.type === "video" && (asset.duration ?? 0) > 5),
			detail: JSON.stringify(imported.map((asset) => [asset.name, asset.duration])),
		});
		const total = await evaluate((ids) => window.__opencut.buildSequential({ assetIds: ids }), imported.map((asset) => asset.id));
		record({ name: "A 排時間軸", ok: total > 20, detail: `總長 ${total} 秒` });

		for (let index = 0; index < 4; index += 1) {
			const at = index * 6 + 3;
			await evaluate((seconds) => window.__opencut.seek({ seconds }), at);
			const expected = CLIP_COLORS[CLIP_ORDER[index]];
			const result = await waitForColor({ candidates: [expected] });
			record({
				name: `A 暫停在 ${at}s 顯示 ${CLIP_ORDER[index]}`,
				ok: result.ok,
				detail: `實際 rgb(${result.color.join(",")}),等了 ${result.waitedMs} ms`,
			});
			if (!result.ok) await page.screenshot({ path: join(outDir, `A-seek-${at}.png`) });
		}
	},
});

// ---------------------------------------------------------------------------
// 情境 B:AMV 快剪(60 段、每段 0.5 秒、每個切點都換素材)連續播放
// ---------------------------------------------------------------------------
await scenario({
	name: "B-fastcut",
	run: async () => {
		await openEditor({ name: "e2e-fastcut", first: false });
		const videoFiles = readdirSync(fixturesDir).filter((file) => file.startsWith("clip-") && file.endsWith(".webm")).sort();
		const imported = await importFixtures({ names: videoFiles });
		const total = await evaluate(
			(ids) => window.__opencut.buildFastCut({ assetIds: ids, count: 60, clipSeconds: 0.5 }),
			imported.map((asset) => asset.id),
		);
		await evaluate(() => window.__opencut.seek({ seconds: 0 }));
		await waitForColor({ candidates: [CLIP_COLORS.red], timeout: 20000 });

		const heapBefore = (await evaluate(() => window.__opencut.state())).heapMB;
		await evaluate(() => {
			window.__renderPerf = true;
			window.__renderPerfSink = [];
		});
		await evaluate(() => window.__opencut.play());
		let maxSinks = 0;
		const playMs = 15000;
		const startedAt = Date.now();
		while (Date.now() - startedAt < playMs) {
			const state = await evaluate(() => window.__opencut.state());
			maxSinks = Math.max(maxSinks, state.videoSinks);
			await sleep(500);
		}
		await evaluate(() => window.__opencut.pause());
		const stateAfter = await evaluate(() => window.__opencut.state());
		const sink = await evaluate(() => window.__renderPerfSink);
		await evaluate(() => {
			window.__renderPerf = false;
		});
		const perf = summarizePerf({ sink });
		const progressed = stateAfter.timeSeconds > 1;
		record({
			name: "B 播放有前進",
			ok: progressed,
			detail: `播放頭到 ${stateAfter.timeSeconds.toFixed(2)}s / ${total}s,渲染 ${perf.renderedFrames} 格`,
			metrics: perf,
		});
		record({
			name: "B 解碼器守住上限",
			ok: maxSinks <= 12,
			detail: `最多同時 ${maxSinks} 個(上限 ${await evaluate(() => window.__opencut.maxActiveSinks)})`,
		});

		// 暫停後必須停在精確的那一格(播放中可能用過舊的一格,暫停要補渲染)
		const t = stateAfter.timeSeconds;
		const index = Math.floor(t / 0.5);
		const nearBoundary = Math.abs(t / 0.5 - Math.round(t / 0.5)) < 0.1;
		const candidates = [CLIP_COLORS[CLIP_ORDER[index % 4]]];
		if (nearBoundary) {
			candidates.push(CLIP_COLORS[CLIP_ORDER[(index + 1) % 4]]);
			candidates.push(CLIP_COLORS[CLIP_ORDER[(index + 3) % 4]]);
		}
		const color = await waitForColor({ candidates });
		record({
			name: "B 暫停後畫面是精確的那一段",
			ok: color.ok,
			detail: `t=${t.toFixed(2)}s 應為 ${CLIP_ORDER[index % 4]},實際 rgb(${color.color.join(",")})`,
		});
		await page.screenshot({ path: join(outDir, "B-after-pause.png") });

		const heapAfter = (await evaluate(() => window.__opencut.state())).heapMB;
		record({
			name: "B 記憶體(僅記錄)",
			ok: true,
			detail: `JS heap ${heapBefore} → ${heapAfter} MB`,
		});
		record({
			name: "B 效能摘要(僅記錄,軟體繪圖)",
			ok: true,
			detail: `busyRatio=${perf.busyRatio} previewFrame p95=${perf.previewFrameP95Ms}ms 貼圖上傳=${perf.counters.textureUpload ?? 0};各階段 平均/p95 ms=${JSON.stringify(perf.spansMeanP95Ms)}`,
			metrics: perf,
		});
	},
});

// ---------------------------------------------------------------------------
// 情境 C:60 張不同圖片連續排列,不在時間範圍內的圖不應被載入,快取守住上限
// ---------------------------------------------------------------------------
await scenario({
	name: "C-images",
	run: async () => {
		await openEditor({ name: "e2e-images", first: false });
		const imageFiles = readdirSync(fixturesDir).filter((file) => file.endsWith(".png")).sort();
		const imported = await importFixtures({ names: imageFiles });
		record({ name: "C 匯入圖片", ok: imported.length === imageFiles.length, detail: `${imported.length} 張` });
		await evaluate(
			(ids) => window.__opencut.buildImageRun({ assetIds: ids, count: 60, clipSeconds: 0.5 }),
			imported.map((asset) => asset.id),
		);
		await evaluate(() => window.__opencut.seek({ seconds: 0 }));
		await sleep(3000);
		const atStart = await evaluate(() => window.__opencut.state());
		record({
			name: "C 第一格只載入現在與即將出現的圖",
			ok: atStart.imageCacheSize <= 4,
			detail: `快取 ${atStart.imageCacheSize} 張(舊行為會是 ${imageFiles.length} 張全部載入)`,
		});

		await evaluate(() => window.__opencut.play());
		let maxImages = 0;
		const startedAt = Date.now();
		while (Date.now() - startedAt < 12000) {
			const state = await evaluate(() => window.__opencut.state());
			maxImages = Math.max(maxImages, state.imageCacheSize);
			await sleep(500);
		}
		await evaluate(() => window.__opencut.pause());
		record({
			name: "C 播放時圖片快取守住上限",
			ok: maxImages <= 48,
			detail: `最多 ${maxImages} 張(上限 48)`,
		});
		const heap = (await evaluate(() => window.__opencut.state())).heapMB;
		record({ name: "C 記憶體(僅記錄)", ok: true, detail: `JS heap ${heap} MB` });
	},
});

// ---------------------------------------------------------------------------
// 情境 D:20 支不同來源輪流快剪,解碼器數量必須被限制在上限(淘汰會被觸發)
// ---------------------------------------------------------------------------
await scenario({
	name: "D-many-sources",
	run: async () => {
		await openEditor({ name: "e2e-many", first: false });
		const files = readdirSync(fixturesDir).filter((file) => file.startsWith("many-") && file.endsWith(".webm")).sort();
		const imported = await importFixtures({ names: files });
		record({ name: "D 匯入多支影片", ok: imported.length === files.length && files.length >= 16, detail: `${imported.length} 支` });
		await evaluate(
			(ids) => window.__opencut.buildFastCut({ assetIds: ids, count: 40, clipSeconds: 0.5 }),
			imported.map((asset) => asset.id),
		);
		await evaluate(() => window.__opencut.seek({ seconds: 0 }));
		await sleep(2000);
		await evaluate(() => window.__opencut.play());
		let maxSinks = 0;
		const startedAt = Date.now();
		while (Date.now() - startedAt < 14000) {
			const state = await evaluate(() => window.__opencut.state());
			maxSinks = Math.max(maxSinks, state.videoSinks);
			await sleep(400);
		}
		await evaluate(() => window.__opencut.pause());
		const after = await evaluate(() => window.__opencut.state());
		const limit = await evaluate(() => window.__opencut.maxActiveSinks);
		record({ name: "D 播放有前進", ok: after.timeSeconds > 1, detail: `播放頭 ${after.timeSeconds.toFixed(2)}s` });
		record({
			name: "D 解碼器守住上限",
			ok: maxSinks <= limit,
			detail: `最多 ${maxSinks} 個(上限 ${limit};${files.length} 支來源,無上限時會到 ${files.length})`,
		});
		record({
			name: "D 淘汰有被觸發(僅記錄)",
			ok: true,
			detail: maxSinks >= limit ? "有達到上限,淘汰運作中" : `只到 ${maxSinks},沒有逼到上限`,
		});
	},
});

// ---------------------------------------------------------------------------
// 情境 E:編輯延遲。時間軸片段越多,每次小改動(改名)要花多久?
// 用來判斷「場景索引取代整棵重建」值不值得做;只記錄數字,不判對錯。
// ---------------------------------------------------------------------------
await scenario({
	name: "E-edit-latency",
	run: async () => {
		const videoFiles = readdirSync(fixturesDir).filter((file) => file.startsWith("clip-") && file.endsWith(".webm")).sort();
		for (const [clips, kind] of [[60, "rename"], [240, "rename"], [60, "opacity"], [240, "opacity"]]) {
			await openEditor({ name: `e2e-edit-${clips}-${kind}`, first: false });
			const imported = await importFixtures({ names: videoFiles });
			await evaluate(
				(args) => window.__opencut.buildFastCut(args),
				{ assetIds: imported.map((asset) => asset.id), count: clips, clipSeconds: 0.5 },
			);
			await evaluate(() => window.__opencut.seek({ seconds: 0 }));
			await sleep(2500);
			await evaluate(() => {
				window.__renderPerf = true;
				window.__renderPerfSink = [];
			});
			const result = await evaluate((args) => window.__opencut.measureEdits(args), { count: 30, kind });
			await sleep(1500);
			const sink = await evaluate(() => window.__renderPerfSink);
			await evaluate(() => {
				window.__renderPerf = false;
			});
			const stat = (values) => {
				const sorted = [...values].sort((a, b) => a - b);
				const mean = values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length);
				return { mean: Math.round(mean), p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0, max: sorted[sorted.length - 1] ?? 0 };
			};
			const edit = stat(result.editMs);
			const base = stat(result.baselineMs);
			let rebuildMean = null;
			let rebuildMax = null;
			for (const entry of sink ?? []) {
				for (const row of entry.spans ?? []) {
					if (row.span === "sceneRebuild") {
						rebuildMean = Math.max(rebuildMean ?? 0, row.meanMs);
						rebuildMax = Math.max(rebuildMax ?? 0, row.p95Ms);
					}
				}
			}
			const longTotal = result.longTasksMs.reduce((sum, v) => sum + v, 0);
			record({
				name: `E 編輯延遲(${result.clipCount} 個片段,${kind === "opacity" ? "改不透明度" : "改名"},僅記錄)`,
				ok: true,
				detail: `編輯 平均 ${edit.mean}ms p95 ${edit.p95}ms 最大 ${edit.max}ms;基準(不編輯) 平均 ${base.mean}ms;long task ${result.longTasksMs.length} 次共 ${longTotal}ms;sceneRebuild 平均 ${rebuildMean ?? "n/a"}ms p95 ${rebuildMax ?? "n/a"}ms`,
				metrics: { clips: result.clipCount, edit, base, longTasks: result.longTasksMs, rebuildMean, rebuildMax },
			});
		}
	},
});

// ---------------------------------------------------------------------------
// 情境 F:把片段從時間軸拿掉之後,播放與播放頭必須跟著停 / 縮回(使用者回報的疑似 bug)
// ---------------------------------------------------------------------------
await scenario({
	name: "F-delete-clips",
	run: async () => {
		const videoFiles = readdirSync(fixturesDir).filter((file) => file.startsWith("clip-") && file.endsWith(".webm")).sort();
		await openEditor({ name: "e2e-delete", first: false });
		const imported = await importFixtures({ names: videoFiles });
		const ids = imported.map((asset) => asset.id);

		// F1:播放中,全部刪掉
		await evaluate((assetIds) => window.__opencut.buildSequential({ assetIds }), ids);
		await evaluate(() => window.__opencut.seek({ seconds: 8 }));
		await evaluate(() => window.__opencut.play());
		await sleep(1500);
		await evaluate(() => window.__opencut.deleteClips({ keep: 0 }));
		await sleep(2500);
		const f1 = await evaluate(() => window.__opencut.state());
		record({
			name: "F1 播放中全部刪掉:停止播放、總長 0、播放頭回 0",
			ok: !f1.isPlaying && f1.totalSeconds === 0 && f1.timeSeconds === 0,
			detail: `isPlaying=${f1.isPlaying} 總長=${f1.totalSeconds}s 播放頭=${f1.timeSeconds.toFixed(2)}s;${await uiProbe()}`,
		});

		// F2:暫停,播放頭在後面,刪掉後面幾段 → 播放頭不能超過新的總長
		await evaluate((assetIds) => window.__opencut.buildSequential({ assetIds }), ids);
		await evaluate(() => window.__opencut.seek({ seconds: 20 }));
		await evaluate(() => window.__opencut.deleteClips({ keep: 2 }));
		await sleep(1500);
		const f2 = await evaluate(() => window.__opencut.state());
		record({
			name: "F2 暫停時刪掉後段:播放頭不超過新總長",
			ok: f2.totalSeconds > 11 && f2.totalSeconds < 13 && f2.timeSeconds <= f2.totalSeconds + 0.05,
			detail: `總長=${f2.totalSeconds.toFixed(2)}s 播放頭=${f2.timeSeconds.toFixed(2)}s`,
		});

		// F3:播放中刪掉播放頭所在與之後的片段(留前 1 段 6 秒)→ 必須停下,不能繼續跑
		await evaluate(() => window.__opencut.seek({ seconds: 3 }));
		await evaluate(() => window.__opencut.play());
		await sleep(800);
		await evaluate(() => window.__opencut.deleteClips({ keep: 1 }));
		await sleep(5000);
		const f3 = await evaluate(() => window.__opencut.state());
		record({
			name: "F3 播放中刪掉後段:播放頭不越過新總長、最後會停",
			ok: !f3.isPlaying && f3.timeSeconds <= f3.totalSeconds + 0.05,
			detail: `isPlaying=${f3.isPlaying} 總長=${f3.totalSeconds.toFixed(2)}s 播放頭=${f3.timeSeconds.toFixed(2)}s;${await uiProbe()}`,
		});

		// F4:全刪後再按播放,不該開始跑
		await evaluate(() => window.__opencut.deleteClips({ keep: 0 }));
		await sleep(800);
		await evaluate(() => window.__opencut.play());
		await sleep(1500);
		const f4 = await evaluate(() => window.__opencut.state());
		record({
			name: "F4 空時間軸按播放:不播放、播放頭 0",
			ok: !f4.isPlaying && f4.timeSeconds === 0,
			detail: `isPlaying=${f4.isPlaying} 播放頭=${f4.timeSeconds.toFixed(2)}s`,
		});
	},
});

// ---------------------------------------------------------------------------
// 情境 G:從素材庫刪掉正在用的素材(會連帶移除片段),播放與播放頭同樣必須停 / 縮回
// ---------------------------------------------------------------------------
await scenario({
	name: "G-remove-assets",
	run: async () => {
		const videoFiles = readdirSync(fixturesDir).filter((file) => file.startsWith("clip-") && file.endsWith(".webm")).sort();
		await openEditor({ name: "e2e-remove-assets", first: false });
		const imported = await importFixtures({ names: videoFiles });
		const ids = imported.map((asset) => asset.id);

		// G1:播放中,刪掉全部素材
		await evaluate((assetIds) => window.__opencut.buildSequential({ assetIds }), ids);
		await evaluate(() => window.__opencut.seek({ seconds: 8 }));
		await evaluate(() => window.__opencut.play());
		await sleep(1500);
		await evaluate((assetIds) => window.__opencut.removeAssets({ ids: assetIds }), ids);
		await sleep(3000);
		const g1 = await evaluate(() => window.__opencut.state());
		record({
			name: "G1 播放中刪掉全部素材:停止播放、總長 0、播放頭回 0",
			ok: !g1.isPlaying && g1.totalSeconds === 0 && g1.timeSeconds === 0,
			detail: `isPlaying=${g1.isPlaying} 總長=${g1.totalSeconds}s 播放頭=${g1.timeSeconds.toFixed(2)}s 素材數=${g1.assetCount};${await uiProbe()}`,
		});

		// G2:只刪掉目前播放中的那支素材(green),其餘留著
		const again = await importFixtures({ names: videoFiles });
		const ids2 = again.map((asset) => asset.id);
		await evaluate((assetIds) => window.__opencut.buildSequential({ assetIds }), ids2);
		await evaluate(() => window.__opencut.seek({ seconds: 8 }));
		await evaluate(() => window.__opencut.play());
		await sleep(1000);
		await evaluate((assetIds) => window.__opencut.removeAssets({ ids: [assetIds[1]] }), ids2);
		await sleep(2500);
		const g2 = await evaluate(() => window.__opencut.state());
		await evaluate(() => window.__opencut.pause());
		record({
			name: "G2 播放中刪掉目前這支素材:播放頭仍在總長內",
			ok: g2.timeSeconds <= g2.totalSeconds + 0.05,
			detail: `isPlaying=${g2.isPlaying} 總長=${g2.totalSeconds.toFixed(2)}s 播放頭=${g2.timeSeconds.toFixed(2)}s;${await uiProbe()}`,
		});
	},
});

// ---------------------------------------------------------------------------
// 情境 H:使用者回報的最單純情況:只放一支「有聲音」的影片,播放中把它拿掉
// (時間軸變空,播放與時間不應繼續)。有聲音才會走音訊時鐘路徑。
// ---------------------------------------------------------------------------
await scenario({
	name: "H-single-av-clip",
	run: async () => {
		for (const mode of ["clip", "asset"]) {
			await openEditor({ name: `e2e-av-${mode}`, first: false });
			const imported = await importFixtures({ names: ["av-clip.webm"] });
			const ids = imported.map((asset) => asset.id);
			await evaluate((assetIds) => window.__opencut.buildSequential({ assetIds }), ids);
			await evaluate(() => window.__opencut.seek({ seconds: 1 }));
			await evaluate(() => window.__opencut.play());
			await sleep(2000);
			const before = await evaluate(() => window.__opencut.state());
			if (mode === "clip") {
				await evaluate(() => window.__opencut.deleteClips({ keep: 0 }));
			} else {
				await evaluate((assetIds) => window.__opencut.removeAssets({ ids: assetIds }), ids);
			}
			const samples = [];
			for (let i = 0; i < 4; i += 1) {
				await sleep(700);
				const state = await evaluate(() => window.__opencut.state());
				samples.push(`${state.timeSeconds.toFixed(2)}${state.isPlaying ? "▶" : "■"}`);
			}
			const after = await evaluate(() => window.__opencut.state());
			record({
				name: `H 有聲音的單一片段,播放中${mode === "clip" ? "刪除片段" : "刪除素材"}:要停止、總長 0`,
				ok: !after.isPlaying && after.totalSeconds === 0 && after.timeSeconds === 0,
				detail: `刪除前 播放頭=${before.timeSeconds.toFixed(2)}s 播放中=${before.isPlaying};刪除後每 0.7s 取樣 ${samples.join(" ")};總長=${after.totalSeconds}s;${await uiProbe()}`,
			});
		}
	},
});

// ---------------------------------------------------------------------------
// 情境 I:完全照使用者的操作:用鍵盤空白鍵播放、選取片段、按 Delete 刪除(走快捷鍵路徑)
// ---------------------------------------------------------------------------
await scenario({
	name: "I-keyboard-path",
	run: async () => {
		await openEditor({ name: "e2e-keyboard", first: false });
		const imported = await importFixtures({ names: ["av-clip.webm"] });
		await evaluate((assetIds) => window.__opencut.buildSequential({ assetIds }), imported.map((asset) => asset.id));
		await evaluate(() => window.__opencut.seek({ seconds: 0 }));
		await page.mouse.click(800, 120); // 點一下空白處讓焦點在頁面上
		await page.keyboard.press("Space");
		await sleep(2000);
		const before = await evaluate(() => window.__opencut.state());
		const selected = await evaluate(() => window.__opencut.selectAllClips());
		await page.keyboard.press("Delete");
		const samples = [];
		for (let i = 0; i < 4; i += 1) {
			await sleep(700);
			const state = await evaluate(() => window.__opencut.state());
			samples.push(`${state.timeSeconds.toFixed(2)}${state.isPlaying ? "▶" : "■"}/${state.totalSeconds.toFixed(1)}s`);
		}
		const after = await evaluate(() => window.__opencut.state());
		record({
			name: "I 空白鍵播放 + 選取 + Delete 鍵:要停止、總長 0",
			ok: before.isPlaying && selected > 0 && !after.isPlaying && after.totalSeconds === 0 && after.timeSeconds === 0,
			detail: `刪除前 播放中=${before.isPlaying} 播放頭=${before.timeSeconds.toFixed(2)}s 選取=${selected};刪除後取樣 ${samples.join(" ")};${await uiProbe()}`,
		});
	},
});

// ---------------------------------------------------------------------------
// 情境 J:確認使用者用的「一鍵效能報告」(__opencut.perfReport)能正常產出資料
// ---------------------------------------------------------------------------
await scenario({
	name: "J-perf-report",
	run: async () => {
		const videoFiles = readdirSync(fixturesDir).filter((file) => file.startsWith("clip-") && file.endsWith(".webm")).sort();
		await openEditor({ name: "e2e-perf-report", first: false });
		const imported = await importFixtures({ names: videoFiles });
		await evaluate(
			(args) => window.__opencut.buildFastCut(args),
			{ assetIds: imported.map((asset) => asset.id), count: 40, clipSeconds: 0.5 },
		);
		await evaluate(() => window.__opencut.seek({ seconds: 0 }));
		const report = await evaluate(() => window.__opencut.perfReport({ seconds: 8 }));
		record({
			name: "J 一鍵效能報告可用",
			ok: report.renderedFrames > 0 && Object.keys(report.spansMeanP95Ms).length > 0,
			detail: JSON.stringify(report).slice(0, 900),
		});
	},
});

// ---------------------------------------------------------------------------
// 總結
// ---------------------------------------------------------------------------
record({
	name: "全程沒有致命錯誤",
	ok: fatalConsole.length === 0,
	detail: fatalConsole.slice(0, 5).join(" | ") || "無",
});
if (warnings.length > 0) {
	console.log(`\n非致命的主控台錯誤(${warnings.length} 則,列前 5):`);
	for (const text of warnings.slice(0, 5)) console.log(`  - ${text}`);
}

await browser.close();
server.close();

const failed = results.filter((result) => !result.ok);
const lines = [
	"### 自動驗收(無頭 Chromium,軟體繪圖)",
	"",
	"| 項目 | 結果 | 說明 |",
	"| --- | --- | --- |",
	...results.map((result) => `| ${result.name} | ${result.ok ? "通過" : "**失敗**"} | ${String(result.detail).replace(/\|/g, "/")} |`),
	"",
	`通過 ${results.length - failed.length} / ${results.length}`,
	"",
	"> 軟體繪圖的耗時遠慢於真實 GPU,數字只用來比較前後與抓異常,不要和實機比。",
];
writeFileSync(join(outDir, "report.json"), JSON.stringify({ results, warnings }, null, 2));
writeFileSync(join(outDir, "summary.md"), lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);

console.log(`\n通過 ${results.length - failed.length} / ${results.length}`);
// annotations 讀得到(日誌下載會被擋)。單則太長會被截斷,所以每約 2500 字拆成一則(e2e-summary-1、-2…)
const summaryLines = results.map((r) => `${r.ok ? "PASS" : "FAIL"} ${r.name} — ${r.detail}`);
let chunk = [];
let chunkLen = 0;
let chunkIndex = 1;
const flushChunk = () => {
	if (chunk.length === 0) return;
	console.log(`::notice title=e2e-summary-${chunkIndex}::${chunk.join("%0A")}`);
	chunkIndex += 1;
	chunk = [];
	chunkLen = 0;
};
for (const line of summaryLines) {
	if (chunkLen + line.length > 2500) flushChunk();
	chunk.push(line);
	chunkLen += line.length;
}
flushChunk();
const perfRows = results.filter((r) => r.metrics).map((r) => `${r.name}: ${JSON.stringify(r.metrics)}`);
if (perfRows.length > 0) console.log(`::notice title=e2e-perf::${perfRows.join("%0A")}`);
process.exit(failed.length === 0 ? 0 : 1);
