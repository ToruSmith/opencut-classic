"use client";

import { useState } from "react";
import { TransitionTopIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/utils/ui";
import {
	getExportMimeType,
	getExportFileExtension,
	downloadBuffer,
} from "@/export";
import { Check, Copy, Download, RotateCcw } from "lucide-react";
import {
	EXPORT_FORMAT_VALUES,
	EXPORT_QUALITY_VALUES,
	type ExportFormat,
	type ExportQuality,
} from "@/export";
import {
	Section,
	SectionContent,
	SectionHeader,
	SectionTitle,
} from "@/components/section";
import { useEditor } from "@/editor/use-editor";
import { DEFAULT_EXPORT_OPTIONS } from "@/export/defaults";
import { formatRangeFileSuffix, resolveExportRange } from "@/export/range";
import { mediaTimeToSeconds, TICKS_PER_SECOND } from "@/wasm";

function isExportFormat(value: string): value is ExportFormat {
	return EXPORT_FORMAT_VALUES.some((formatValue) => formatValue === value);
}

function isExportQuality(value: string): value is ExportQuality {
	return EXPORT_QUALITY_VALUES.some((qualityValue) => qualityValue === value);
}

export function ExportButton() {
	const [isExportPopoverOpen, setIsExportPopoverOpen] = useState(false);
	const editor = useEditor();
	const activeProject = useEditor((e) => e.project.getActiveOrNull());
	const hasProject = !!activeProject;

	const handlePopoverOpenChange = ({ open }: { open: boolean }) => {
		if (!open) {
			editor.project.cancelExport();
			editor.project.clearExportState();
		}
		setIsExportPopoverOpen(open);
	};

	return (
		<Popover
			open={isExportPopoverOpen}
			onOpenChange={(open) => handlePopoverOpenChange({ open })}
		>
			<PopoverTrigger asChild>
				<button
					type="button"
					className={cn(
						"flex items-center gap-1.5 rounded-md bg-[#38BDF8] px-[0.12rem] py-[0.12rem] text-white",
						hasProject ? "cursor-pointer" : "cursor-not-allowed opacity-50",
					)}
					onClick={hasProject ? () => setIsExportPopoverOpen(true) : undefined}
					disabled={!hasProject}
					onKeyDown={(event) => {
						if (hasProject && (event.key === "Enter" || event.key === " ")) {
							event.preventDefault();
							setIsExportPopoverOpen(true);
						}
					}}
				>
					<div className="relative flex items-center gap-1.5 rounded-[0.6rem] bg-linear-270 from-[#2567EC] to-[#37B6F7] px-4 py-1 shadow-[0_1px_3px_0px_rgba(0,0,0,0.65)]">
						<HugeiconsIcon icon={TransitionTopIcon} className="z-50 size-3.5" />
						<span className="z-50 text-[0.875rem]">匯出</span>
						<div className="absolute top-0 left-0 z-10 flex size-full items-center justify-center rounded-[0.6rem] bg-linear-to-t from-white/0 to-white/50">
							<div className="absolute top-[0.08rem] z-50 h-[calc(100%-2px)] w-[calc(100%-2px)] rounded-[0.6rem] bg-linear-270 from-[#2567EC] to-[#37B6F7]"></div>
						</div>
					</div>
				</button>
			</PopoverTrigger>
			{hasProject && <ExportPopover onOpenChange={setIsExportPopoverOpen} />}
		</Popover>
	);
}

function ExportPopover({
	onOpenChange,
}: {
	onOpenChange: (open: boolean) => void;
}) {
	const editor = useEditor();
	const activeProject = useEditor((e) => e.project.getActive());
	const exportState = useEditor((e) => e.project.getExportState());
	const { isExporting, progress, result: exportResult } = exportState;
	const [format, setFormat] = useState<ExportFormat>(
		DEFAULT_EXPORT_OPTIONS.format,
	);
	const [quality, setQuality] = useState<ExportQuality>(
		DEFAULT_EXPORT_OPTIONS.quality,
	);
	const [shouldIncludeAudio, setShouldIncludeAudio] = useState<boolean>(
		DEFAULT_EXPORT_OPTIONS.includeAudio ?? true,
	);

	// 範圍匯出:只輸出時間軸上的一段(起迄會對齊影格)
	const [useRange, setUseRange] = useState(false);
	const [rangeStart, setRangeStart] = useState("0");
	const [rangeEnd, setRangeEnd] = useState("");
	const totalSeconds = mediaTimeToSeconds({ time: editor.timeline.getTotalDuration() });
	const rangeCheck = (() => {
		if (!useRange || !activeProject) return null;
		const fps = activeProject.settings.fps;
		return resolveExportRange({
			startSeconds: Number.parseFloat(rangeStart),
			endSeconds: Number.parseFloat(rangeEnd === "" ? String(totalSeconds) : rangeEnd),
			totalTicks: editor.timeline.getTotalDuration(),
			ticksPerFrame: Math.round((TICKS_PER_SECOND * fps.denominator) / fps.numerator),
			ticksPerSecond: TICKS_PER_SECOND,
		});
	})();
	const rangeInvalid = rangeCheck !== null && !rangeCheck.ok;
	const setFromPlayhead = ({ target }: { target: "start" | "end" }) => {
		const seconds = mediaTimeToSeconds({ time: editor.playback.getCurrentTime() });
		const text = (Math.round(seconds * 100) / 100).toString();
		if (target === "start") setRangeStart(text);
		else setRangeEnd(text);
	};

	const handleExport = async () => {
		if (!activeProject) return;
		const range =
			rangeCheck?.ok === true
				? { startSeconds: rangeCheck.startSeconds, endSeconds: rangeCheck.endSeconds }
				: undefined;
		const nameSuffix = range ? formatRangeFileSuffix(range) : "";

		// 支援的瀏覽器(Chrome/Edge):先選存檔位置,影片會邊編碼邊寫入磁碟,不佔記憶體
		let writable: FileSystemWritableFileStream | undefined;
		const picker = (
			window as unknown as {
				showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle>;
			}
		).showSaveFilePicker;
		if (picker) {
			try {
				const extension = getExportFileExtension({ format });
				const handle = await picker.call(window, {
					suggestedName: `${activeProject.metadata.name}${nameSuffix}${extension}`,
					types: [
						{
							description: format === "webm" ? "WebM 影片" : "MP4 影片",
							accept: { [getExportMimeType({ format })]: [extension] },
						},
					],
				});
				writable = await handle.createWritable();
			} catch (error) {
				if (error instanceof DOMException && error.name === "AbortError") return;
				console.warn("無法使用直接寫檔,改用記憶體匯出", error);
			}
		}

		const result = await editor.project.export({
			options: {
				format,
				quality,
				fps: activeProject.settings.fps,
				includeAudio: shouldIncludeAudio,
				writable,
				range,
			},
		});

		if (result.cancelled) {
			editor.project.clearExportState();
			return;
		}

		if (result.success && result.streamed) {
			editor.project.clearExportState();
			onOpenChange(false);
			return;
		}

		if (result.success && result.buffer) {
			downloadBuffer({
				buffer: result.buffer,
				filename: `${activeProject.metadata.name}${nameSuffix}${getExportFileExtension({ format })}`,
				mimeType: getExportMimeType({ format }),
			});

			editor.project.clearExportState();
			onOpenChange(false);
		}
	};

	const handleCancel = () => {
		editor.project.cancelExport();
	};

	return (
		<PopoverContent className="bg-background mr-4 flex w-80 flex-col p-0">
			{exportResult && !exportResult.success ? (
				<ExportError
					error={exportResult.error || "Unknown error occurred"}
					onRetry={handleExport}
				/>
			) : (
				<>
					<div className="flex items-center justify-between p-3 border-b">
						<h3 className="font-medium text-sm">
							{isExporting ? "匯出中" : "匯出專案"}
						</h3>
					</div>

					<div className="flex flex-col gap-4">
						{!isExporting && (
							<>
								<div className="flex flex-col">
									<Section
										collapsible
										defaultOpen={false}
										showTopBorder={false}
									>
										<SectionHeader>
											<SectionTitle>格式</SectionTitle>
										</SectionHeader>
										<SectionContent>
											<RadioGroup
												value={format}
												onValueChange={(value) => {
													if (isExportFormat(value)) {
														setFormat(value);
													}
												}}
											>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="mp4" id="mp4" />
													<Label htmlFor="mp4">
														MP4 (H.264) - Better compatibility
													</Label>
												</div>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="webm" id="webm" />
													<Label htmlFor="webm">
														WebM (VP9) - Smaller file size
													</Label>
												</div>
											</RadioGroup>
										</SectionContent>
									</Section>

									<Section collapsible defaultOpen={false}>
										<SectionHeader>
											<SectionTitle>品質</SectionTitle>
										</SectionHeader>
										<SectionContent>
											<RadioGroup
												value={quality}
												onValueChange={(value) => {
													if (isExportQuality(value)) {
														setQuality(value);
													}
												}}
											>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="low" id="low" />
													<Label htmlFor="low">低 - 檔案最小</Label>
												</div>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="medium" id="medium" />
													<Label htmlFor="medium">中 - 平衡</Label>
												</div>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="high" id="high" />
													<Label htmlFor="high">高 - 建議</Label>
												</div>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="very_high" id="very_high" />
													<Label htmlFor="very_high">
														極高 - 檔案最大
													</Label>
												</div>
											</RadioGroup>
										</SectionContent>
									</Section>

									<Section collapsible defaultOpen={false}>
										<SectionHeader>
											<SectionTitle>音訊</SectionTitle>
										</SectionHeader>
										<SectionContent>
											<div className="flex items-center space-x-2">
												<Checkbox
													id="include-audio"
													checked={shouldIncludeAudio}
													onCheckedChange={(checked) =>
														setShouldIncludeAudio(!!checked)
													}
												/>
												<Label htmlFor="include-audio">
													匯出時包含音訊
												</Label>
											</div>
										</SectionContent>
									</Section>
								</div>

								<Section collapsible defaultOpen={false}>
									<SectionHeader>
										<SectionTitle>範圍</SectionTitle>
									</SectionHeader>
									<SectionContent>
										<div className="flex flex-col gap-2">
											<div className="flex items-center space-x-2">
												<Checkbox
													id="export-range"
													checked={useRange}
													onCheckedChange={(checked) => {
														setUseRange(!!checked);
														if (checked && rangeEnd === "") {
															setRangeEnd((Math.round(totalSeconds * 100) / 100).toString());
														}
													}}
												/>
												<Label htmlFor="export-range">只匯出一段(檔名會帶範圍)</Label>
											</div>
											{useRange && (
												<>
													<div className="flex items-center gap-2 text-xs">
														<span className="w-8">起點</span>
														<input
															type="number"
															min={0}
															step={0.1}
															value={rangeStart}
															onChange={(event) => setRangeStart(event.target.value)}
															className="bg-background border-input w-20 rounded-md border px-1 py-0.5"
														/>
														<span>秒</span>
														<Button
															size="sm"
															variant="outline"
															className="h-6 px-2 text-xs"
															onClick={() => setFromPlayhead({ target: "start" })}
														>
															用播放頭
														</Button>
													</div>
													<div className="flex items-center gap-2 text-xs">
														<span className="w-8">終點</span>
														<input
															type="number"
															min={0}
															step={0.1}
															value={rangeEnd}
															onChange={(event) => setRangeEnd(event.target.value)}
															className="bg-background border-input w-20 rounded-md border px-1 py-0.5"
														/>
														<span>秒</span>
														<Button
															size="sm"
															variant="outline"
															className="h-6 px-2 text-xs"
															onClick={() => setFromPlayhead({ target: "end" })}
														>
															用播放頭
														</Button>
													</div>
													<p
														className={cn(
															"text-xs",
															rangeInvalid ? "text-destructive" : "text-muted-foreground",
														)}
													>
														{rangeCheck?.ok
															? `實際範圍 ${rangeCheck.startSeconds.toFixed(2)} ~ ${rangeCheck.endSeconds.toFixed(2)} 秒(${rangeCheck.frameCount} 格,已對齊影格)`
															: rangeCheck
																? rangeCheck.reason
																: ""}
													</p>
												</>
											)}
										</div>
									</SectionContent>
								</Section>

								<div className="p-3 pt-0">
									<Button
										onClick={handleExport}
										className="w-full gap-2"
										disabled={rangeInvalid}
									>
										<Download className="size-4" />
										匯出
									</Button>
								</div>
							</>
						)}

						{isExporting && (
							<div className="space-y-4 p-3">
								<div className="flex flex-col gap-2">
									<div className="flex items-center justify-between text-center">
										<p className="text-muted-foreground text-sm">
											{Math.round(progress * 100)}%
										</p>
										<p className="text-muted-foreground text-sm">100%</p>
									</div>
									<Progress value={progress * 100} className="w-full" />
								</div>

								<Button
									variant="outline"
									className="w-full rounded-md"
									onClick={handleCancel}
								>
									取消
								</Button>
							</div>
						)}
					</div>
				</>
			)}
		</PopoverContent>
	);
}

function ExportError({
	error,
	onRetry,
}: {
	error: string;
	onRetry: () => void;
}) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		await navigator.clipboard.writeText(error);
		setCopied(true);
		setTimeout(() => setCopied(false), 1000);
	};

	return (
		<div className="space-y-4 p-3">
			<div className="flex flex-col gap-1.5">
				<p className="text-destructive text-sm font-medium">匯出失敗</p>
				<p className="text-muted-foreground text-xs">{error}</p>
			</div>

			<div className="flex gap-2">
				<Button
					variant="outline"
					size="sm"
					className="h-8 flex-1 text-xs"
					onClick={handleCopy}
				>
					{copied ? <Check className="text-constructive" /> : <Copy />}
					複製
				</Button>
				<Button
					variant="outline"
					size="sm"
					className="h-8 flex-1 text-xs"
					onClick={onRetry}
				>
					<RotateCcw />
					重試
				</Button>
			</div>
		</div>
	);
}
