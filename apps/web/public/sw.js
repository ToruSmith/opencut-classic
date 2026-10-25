// 離線快取:頁面(導覽)優先走網路、失敗才用快取;其他靜態檔先用快取並在背景更新。
const CACHE = "opencut-slim-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
			await self.clients.claim();
		})(),
	);
});

self.addEventListener("fetch", (event) => {
	const request = event.request;
	if (request.method !== "GET") return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;

	if (request.mode === "navigate") {
		event.respondWith(
			(async () => {
				try {
					const fresh = await fetch(request);
					const cache = await caches.open(CACHE);
					cache.put(request, fresh.clone());
					return fresh;
				} catch {
					const cached = await caches.match(request, { ignoreSearch: true });
					return cached || (await caches.match("./")) || Response.error();
				}
			})(),
		);
		return;
	}

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);
			const cached = await cache.match(request);
			const network = fetch(request)
				.then((response) => {
					if (response.ok) cache.put(request, response.clone());
					return response;
				})
				.catch(() => null);
			return cached || (await network) || Response.error();
		})(),
	);
});
