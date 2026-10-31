// Bun cannot load opencut-wasm's bundler-target entry (`import * as wasm from
// "./opencut_wasm_bg.wasm"`), so every test that touches media time crashes.
// Instantiate the real wasm by hand and serve the bindings as "opencut-wasm".
import { mock } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(join(process.cwd(), "package.json"));
const pkgDir = dirname(require.resolve("opencut-wasm/package.json"));
const bg = await import(join(pkgDir, "opencut_wasm_bg.js"));
const bytes = readFileSync(join(pkgDir, "opencut_wasm_bg.wasm"));
const { instance } = await WebAssembly.instantiate(bytes, {
	"./opencut_wasm_bg.js": bg,
});
bg.__wbg_set_wasm(instance.exports);
(instance.exports as { __wbindgen_start?: () => void }).__wbindgen_start?.();

mock.module("opencut-wasm", () => bg);
