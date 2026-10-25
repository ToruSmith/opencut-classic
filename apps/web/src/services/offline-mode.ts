const KEY = "offline-mode";

export function isOfflineModeEnabled(): boolean {
	try {
		return localStorage.getItem(KEY) === "1";
	} catch {
		return false;
	}
}

function swUrl(): string {
	return `${import.meta.env.BASE_URL}sw.js`;
}

export async function enableOfflineMode(): Promise<void> {
	try {
		localStorage.setItem(KEY, "1");
	} catch {}
	await navigator.serviceWorker?.register(swUrl());
}

export async function disableOfflineMode(): Promise<void> {
	try {
		localStorage.removeItem(KEY);
	} catch {}
	for (const r of (await navigator.serviceWorker?.getRegistrations?.()) ?? []) {
		await r.unregister();
	}
	if ("caches" in window) {
		for (const name of await caches.keys()) await caches.delete(name);
	}
}

/** 啟動時依使用者設定同步狀態:預設關閉,只有開啟時才註冊 */
export function syncOfflineMode(): void {
	if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;
	window.addEventListener("load", () => {
		const task = isOfflineModeEnabled()
			? enableOfflineMode()
			: disableOfflineMode();
		task.catch((error) => console.warn("離線模式同步失敗", error));
	});
}
