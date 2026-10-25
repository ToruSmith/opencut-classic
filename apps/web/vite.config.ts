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
			// 過渡期：以相容層取代 Next.js 的元件，之後再逐步換成原生寫法
			{ find: /^next\/link$/, replacement: r("./src/shims/next-link.tsx") },
			{ find: /^next\/image$/, replacement: r("./src/shims/next-image.tsx") },
			{
				find: /^next\/navigation$/,
				replacement: r("./src/shims/next-navigation.ts"),
			},
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
