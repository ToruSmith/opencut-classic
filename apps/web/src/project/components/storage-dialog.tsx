"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { storageService } from "@/services/storage/service";
import { useEditor } from "@/editor/use-editor";

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB", "TB"];
	let value = bytes / 1024;
	let i = 0;
	while (value >= 1024 && i < units.length - 1) {
		value /= 1024;
		i++;
	}
	return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`;
}

interface Usage {
	usage: number;
	quota: number;
	details: { caches?: number; indexedDB?: number; fileSystem?: number; serviceWorker?: number };
	persisted: boolean | null;
	cacheEntries: number;
	hasServiceWorker: boolean;
	projects: Array<{ id: string; name: string; bytes: number; count: number }>;
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
	return (
		<div className="flex items-start justify-between gap-4 py-1">
			<div className="flex flex-col">
				<span className="text-sm">{label}</span>
				{hint && <span className="text-muted-foreground text-xs">{hint}</span>}
			</div>
			<span className="text-sm font-medium whitespace-nowrap">{value}</span>
		</div>
	);
}

export function StorageDialog({
	isOpen,
	onOpenChange,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const editor = useEditor();
	const [data, setData] = useState<Usage | null>(null);
	const [online, setOnline] = useState(
		typeof navigator === "undefined" ? true : navigator.onLine,
	);

	useEffect(() => {
		const on = () => setOnline(true);
		const off = () => setOnline(false);
		window.addEventListener("online", on);
		window.addEventListener("offline", off);
		return () => {
			window.removeEventListener("online", on);
			window.removeEventListener("offline", off);
		};
	}, []);

	const refresh = useCallback(async () => {
		const estimate = (await navigator.storage?.estimate?.()) as
			| (StorageEstimate & {
					usageDetails?: Record<string, number>;
			  })
			| undefined;
		const persisted = (await navigator.storage?.persisted?.()) ?? null;

		let cacheEntries = 0;
		if ("caches" in window) {
			for (const name of await caches.keys()) {
				cacheEntries += (await (await caches.open(name)).keys()).length;
			}
		}
		const registrations = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];

		const saved = editor.project.getSavedProjects();
		const projects = await Promise.all(
			saved.map(async (p) => ({
				id: p.id,
				name: p.name,
				...(await storageService.getProjectMediaUsage({ projectId: p.id })),
			})),
		);
		projects.sort((a, b) => b.bytes - a.bytes);

		setData({
			usage: estimate?.usage ?? 0,
			quota: estimate?.quota ?? 0,
			details: {
				caches: estimate?.usageDetails?.caches,
				indexedDB: estimate?.usageDetails?.indexedDB,
				fileSystem: estimate?.usageDetails?.fileSystem,
				serviceWorker: estimate?.usageDetails?.serviceWorkerRegistrations,
			},
			persisted,
			cacheEntries,
			hasServiceWorker: registrations.length > 0,
			projects,
		});
	}, [editor]);

	useEffect(() => {
		if (isOpen) void refresh();
	}, [isOpen, refresh]);

	const clearOfflineCache = async () => {
		for (const name of await caches.keys()) await caches.delete(name);
		for (const r of (await navigator.serviceWorker?.getRegistrations?.()) ?? []) {
			await r.unregister();
		}
		toast.success("已清除離線快取", {
			description: "專案與素材不受影響。重新整理後會再重建離線快取。",
		});
		await refresh();
	};

	const requestPersist = async () => {
		const granted = await navigator.storage?.persist?.();
		toast[granted ? "success" : "error"](
			granted ? "已要求瀏覽器永久保存" : "瀏覽器未同意(可能需先安裝成 App 或多使用一陣子)",
		);
		await refresh();
	};

	const percent = data && data.quota > 0 ? (data.usage / data.quota) * 100 : 0;

	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>儲存空間與離線狀態</DialogTitle>
				</DialogHeader>
				<DialogBody className="flex flex-col gap-4">
					<div className="flex items-center gap-2 text-sm">
						<span
							className={`size-2 rounded-full ${online ? "bg-green-500" : "bg-amber-500"}`}
						/>
						{online ? "目前:已連線" : "目前:離線中(使用本機快取)"}
					</div>

					{!data ? (
						<span className="text-muted-foreground text-sm">讀取中…</span>
					) : (
						<>
							<div className="flex flex-col gap-1">
								<div className="bg-muted h-2 w-full overflow-hidden rounded-full">
									<div
										className="bg-primary h-full"
										style={{ width: `${Math.min(100, Math.max(percent, 0.5))}%` }}
									/>
								</div>
								<span className="text-muted-foreground text-xs">
									已用 {formatBytes(data.usage)} / 瀏覽器配額約 {formatBytes(data.quota)}
									({percent.toFixed(1)}%)
								</span>
							</div>

							<div className="flex flex-col divide-y">
								{data.details.fileSystem !== undefined && (
									<Row
										label="素材檔案"
										hint="你匯入影片的複本(通常最大)"
										value={formatBytes(data.details.fileSystem)}
									/>
								)}
								{data.details.indexedDB !== undefined && (
									<Row label="專案資料" hint="時間軸、設定等" value={formatBytes(data.details.indexedDB)} />
								)}
								{data.details.caches !== undefined && (
									<Row
										label="離線程式快取"
										hint={`${data.cacheEntries} 個檔案;${data.hasServiceWorker ? "離線功能已啟用" : "離線功能未啟用"}`}
										value={formatBytes(data.details.caches)}
									/>
								)}
							</div>

							<div className="flex flex-col gap-1">
								<span className="text-sm font-medium">各專案素材</span>
								{data.projects.length === 0 ? (
									<span className="text-muted-foreground text-xs">沒有專案</span>
								) : (
									<div className="flex max-h-40 flex-col divide-y overflow-auto">
										{data.projects.map((p) => (
											<Row
												key={p.id}
												label={p.name}
												hint={`${p.count} 個素材`}
												value={formatBytes(p.bytes)}
											/>
										))}
									</div>
								)}
							</div>

							<div className="flex flex-wrap gap-2">
								<Button variant="outline" size="sm" onClick={clearOfflineCache}>
									只清除離線快取
								</Button>
								{data.persisted === false && (
									<Button variant="outline" size="sm" onClick={requestPersist}>
										要求永久保存
									</Button>
								)}
								<Button variant="ghost" size="sm" onClick={() => void refresh()}>
									重新整理
								</Button>
							</div>
							<p className="text-muted-foreground text-xs leading-relaxed">
								{data.persisted
									? "瀏覽器已承諾保留這些資料,不會在空間不足時自動清除。"
									: "目前瀏覽器可能在硬碟空間不足時自動清除資料,重要專案請先匯出備份。"}
								「只清除離線快取」不會動到專案和素材。要刪專案請回專案列表。
							</p>
						</>
					)}
				</DialogBody>
			</DialogContent>
		</Dialog>
	);
}
