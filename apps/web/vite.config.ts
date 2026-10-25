import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
	// 相對路徑：放在任何子目錄（例如 GitHub Pages）都能運作
	base: "./",
	plugins: [react(), wasm()],
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
	build: { target: "esnext", chunkSizeWarningLimit: 4000 },
	server: { port: 3000, host: true },
	preview: { port: 3000, host: true },
});
