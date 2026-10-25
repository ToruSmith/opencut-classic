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

const PRECACHE_SIGNATURE_KEY = "offline-precache-signature";
const PRECACHE_CONCURRENCY = 4;

/**
 * 把建置時列出的所有程式碼先抓一次(經由 service worker 進快取)。
 * 版本沒變就略過,避免每次開啟都重抓。
 */
async function precacheBuildAssets(): Promise<void> {
	if (!import.meta.env.PROD) return;
	const base = import.meta.env.BASE_URL;
	const response = await fetch(`${base}precache.json`, { cache: "no-cache" });
	if (!response.ok) return;
	const files: string[] = await response.json();

	const signature = files.join("|");
	try {
		if (localStorage.getItem(PRECACHE_SIGNATURE_KEY) === signature) return;
	} catch {}

	// 等 service worker 接管頁面,之後的 fetch 才會被它快取
	await navigator.serviceWorker?.ready;

	const queue = [...files];
	const worker = async () => {
		for (let file = queue.shift(); file; file = queue.shift()) {
			await fetch(`${base}${file}`).catch(() => {});
		}
	};
	await Promise.all(Array.from({ length: PRECACHE_CONCURRENCY }, worker));

	try {
		localStorage.setItem(PRECACHE_SIGNATURE_KEY, signature);
	} catch {}
}

export async function enableOfflineMode(): Promise<void> {
	try {
		localStorage.setItem(KEY, "1");
	} catch {}
	await navigator.serviceWorker?.register(swUrl());
	await precacheBuildAssets().catch((error) =>
		console.warn("離線預載失敗", error),
	);
}

export async function disableOfflineMode(): Promise<void> {
	try {
		localStorage.removeItem(KEY);
		localStorage.removeItem(PRECACHE_SIGNATURE_KEY);
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
