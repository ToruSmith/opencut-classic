import "@fontsource-variable/inter";
import "@fontsource-variable/noto-sans-tc";
import "./app/globals.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import ProjectsPage from "./app/projects/page";
import EditorPage from "./app/editor/[project_id]/page";

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
					<Routes>
						<Route path="/" element={<Navigate to="/projects" replace />} />
						<Route path="/projects" element={<ProjectsPage />} />
						<Route path="/editor/:project_id" element={<EditorPage />} />
						<Route path="*" element={<Navigate to="/projects" replace />} />
					</Routes>
				</HashRouter>
			</TooltipProvider>
		</ThemeProvider>
	</StrictMode>,
);
