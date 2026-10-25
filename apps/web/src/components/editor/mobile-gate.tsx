"use client";

import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { useRouter } from "@/hooks/use-router";

const STORAGE_KEY = "mobile-acknowledged";

interface MobileGateProps {
	children: React.ReactNode;
}

export function MobileGate({ children }: MobileGateProps) {
	const router = useRouter();
	const [show, setShow] = useState<boolean | null>(null);

	useEffect(() => {
		const isMobile = window.innerWidth < 1024;
		const acknowledged = localStorage.getItem(STORAGE_KEY) === "true";
		setShow(isMobile && !acknowledged);
	}, []);

	if (show === null) return null;
	if (!show) return <>{children}</>;

	const handleContinue = () => {
		localStorage.setItem(STORAGE_KEY, "true");
		setShow(false);
	};

	const handleGoBack = () => {
		router.back();
	};

	return (
		<div className="bg-background relative flex h-screen w-screen flex-col overflow-hidden">
			<Button
				variant="text"
				className="absolute top-6 left-6 flex items-center gap-1 text-muted-foreground"
				onClick={handleGoBack}
			>
				<HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
				<span className=" text-sm">Go back</span>
			</Button>

			<div className="flex flex-1 flex-col justify-center gap-5 px-7">
				<div className="flex flex-col gap-3">
					<h1 className="text-foreground text-3xl font-bold tracking-tight">
						目前僅支援桌面版
					</h1>
					<p className="text-muted-foreground text-sm leading-relaxed">
						尚未針對手機或平板最佳化,版面可能跑掉。請改用電腦開啟。
					</p>
				</div>
				<div className="flex items-center gap-3">
					<Button onClick={handleContinue}>仍然進入</Button>
				</div>
			</div>
		</div>
	);
}
