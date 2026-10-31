import "@fontsource-variable/inter";
import "@fontsource-variable/noto-sans-tc";
import { syncOfflineMode } from "@/services/offline-mode";
import "./app/globals.css";

import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

// 路由層級切分:專案列表不需要先載入整個編輯器
const loadProjectsPage = () => import("./app/projects/page");
const loadEditorPage = () => import("./app/editor/[project_id]/page");
const ProjectsPage = lazy(loadProjectsPage);
const EditorPage = lazy(loadEditorPage);

function RouteFallback() {
	return (
		<div className="text-muted-foreground flex h-screen w-screen items-center justify-center text-sm">
			載入中…
		</div>
	);
}

/** 專案列表顯示後,趁閒置先把編輯器抓好,點進專案時就不用再等 */
function prefetchEditorWhenIdle() {
	const connection = (
		navigator as Navigator & { connection?: { saveData?: boolean } }
	).connection;
	if (connection?.saveData) return;
	const run = () => {
		void loadEditorPage().catch(() => {});
		void import("mediabunny").catch(() => {});
	};
	if ("requestIdleCallback" in window) {
		window.requestIdleCallback(run, { timeout: 4000 });
	} else {
		setTimeout(run, 2000);
	}
}

// 自動驗收(Playwright / AI 剪輯師):網址帶 ?e2e 才載入測試掛鉤,一般使用者不會下載這段
if (new URLSearchParams(window.location.search).has("e2e")) {
	void import("@/diagnostics/e2e-hook").then((module) => module.installE2eHook());
}

const root = document.getElementById("root");
if (!root) throw new Error("找不到 #root 容器");

createRoot(root).render(
	<StrictMode>
		<ThemeProvider
			attribute="class"
			defaultTheme="system"
			disableTransitionOnChange={true}
		>
			<TooltipProvider>
				<Toaster />
				<HashRouter>
					<Suspense fallback={<RouteFallback />}>
						<Routes>
							<Route path="/" element={<Navigate to="/projects" replace />} />
							<Route path="/projects" element={<ProjectsPage />} />
							<Route path="/editor/:project_id" element={<EditorPage />} />
							<Route path="*" element={<Navigate to="/projects" replace />} />
						</Routes>
					</Suspense>
				</HashRouter>
			</TooltipProvider>
		</ThemeProvider>
	</StrictMode>,
);

// 離線模式:預設關閉,可在「儲存空間」視窗開啟
syncOfflineMode();

window.addEventListener("load", () => {
	if (window.location.hash.startsWith("#/editor/")) return;
	prefetchEditorWhenIdle();
});
