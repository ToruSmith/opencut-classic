/**
 * bun test 的前置作業:用真正的 WASM 初始化 `opencut-wasm`。
 *
 * 套件是 wasm-pack 的 bundler 目標,靠打包器的「ESM 匯入 .wasm」功能載入,
 * bun 不支援這個功能,所以測試裡任何依賴 WASM 的 `const`(例如 ZERO_MEDIA_TIME)
 * 都會在模組載入一半時丟錯、之後一直處於未初始化狀態。
 * 這裡手動載入 .wasm、接上膠水程式,再用 mock.module 把套件換成已初始化的版本。
 * 測試用的是真正的 Rust 實作,不是另外寫一份 JavaScript。
 */
import { mock } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

async function initializeWasmForTests(): Promise<void> {
	const packageDir = join(import.meta.dir, "node_modules", "opencut-wasm");
	if (!existsSync(join(packageDir, "opencut_wasm_bg.wasm"))) {
		throw new Error(`找不到 ${packageDir}/opencut_wasm_bg.wasm`);
	}

	const glue = await import(join(packageDir, "opencut_wasm_bg.js"));
	const { instance } = await WebAssembly.instantiate(
		readFileSync(join(packageDir, "opencut_wasm_bg.wasm")),
		{ "./opencut_wasm_bg.js": glue },
	);
	glue.__wbg_set_wasm(instance.exports);
	(instance.exports as { __wbindgen_start?: () => void }).__wbindgen_start?.();

	mock.module("opencut-wasm", () => glue);
}

try {
	await initializeWasmForTests();
} catch (error) {
	// 載入失敗時不要讓所有測試一起掛掉;依賴 WASM 的測試會自己失敗並顯示原因
	console.warn("[test-setup] 無法初始化 opencut-wasm:", error);
}
