import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * 把很少變動的第三方套件獨立成檔。
 * 你每次部署,應用程式碼的 hash 都會變;第三方套件獨立後,瀏覽器可以沿用快取,
 * 不必每次重抓(例如 mediabunny 單獨就將近 400 KB)。
 */
function manualVendorChunk(id: string): string | undefined {
	if (!id.includes("node_modules")) return undefined;
	if (/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom)\//.test(id)) {
		return "vendor-react";
	}
	if (/node_modules\/mediabunny\//.test(id)) return "vendor-mediabunny";
	if (/node_modules\/@hugeicons\//.test(id)) return "vendor-icons";
	if (
		/node_modules\/(@radix-ui|radix-ui|@floating-ui|react-remove-scroll|react-remove-scroll-bar|react-style-singleton|use-callback-ref|use-sidecar|aria-hidden)\//.test(
			id,
		)
	) {
		return "vendor-radix";
	}
	return undefined;
}

/**
 * 產生 precache.json:離線模式開啟時,依這份清單把所有程式碼先抓進快取。
 * 路由與面板做了 lazy load 之後,沒走過的功能不會自動進快取,離線時就會載入失敗。
 * 轉錄用的 worker 與 onnx wasm 體積大、又需要連網下載模型,所以不列入。
 */
function precacheManifest(): Plugin {
	return {
		name: "opencut-precache-manifest",
		apply: "build",
		generateBundle(_options, bundle) {
			const files = Object.keys(bundle)
				.filter((name) => /\.(js|css|wasm)$/.test(name))
				.filter((name) => !/^assets\/(worker-|ort-)/.test(name))
				.sort();
			this.emitFile({
				type: "asset",
				fileName: "precache.json",
				source: JSON.stringify(files),
			});
		},
	};
}

export default defineConfig({
	// 相對路徑：放在任何子目錄（例如 GitHub Pages）都能運作
	base: "./",
	plugins: [react(), wasm(), precacheManifest()],
	resolve: {
		alias: [
			{ find: /^@\//, replacement: `${r("./src")}/` },
		// CI builds the Rust/WASM crates (custom shaders) and points here.
		...(process.env.OPENCUT_WASM_LOCAL
			? [{ find: /^opencut-wasm$/, replacement: r("../../rust/wasm/pkg") }]
			: []),
		],
	},
	worker: {
		format: "es",
		plugins: () => [wasm()],
	},
	optimizeDeps: { exclude: ["opencut-wasm"] },
	build: {
		target: "esnext",
		chunkSizeWarningLimit: 4000,
		// CI 分析打包內容用(scripts/report-bundle.mjs);一般建置與部署不產生 sourcemap
		sourcemap: process.env.BUNDLE_ANALYZE === "1",
		rollupOptions: {
			output: { manualChunks: manualVendorChunk },
		},
	},
	server: { port: 3000, host: true },
	preview: { port: 3000, host: true },
});
