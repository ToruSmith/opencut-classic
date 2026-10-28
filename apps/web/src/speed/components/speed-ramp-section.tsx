import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/editor/use-editor";
import { clampRetimeRate } from "@/retime/rate";
import {
	planSpeedRamp,
	type SpeedRampProfile,
} from "@/retime/speed-ramp";
import type { VideoElement } from "@/timeline";
import { mediaTimeToSeconds } from "@/wasm";
import type { SpeedRampAudioMode } from "@/commands/timeline/element/speed-ramp";

const PROFILE_OPTIONS: Array<{ value: SpeedRampProfile; label: string; hint: string }> = [
	{ value: "accelerate", label: "漸快", hint: "慢慢加速衝出去" },
	{ value: "decelerate", label: "漸慢", hint: "由快慢慢收" },
	{ value: "slow-middle", label: "子彈時間", hint: "兩端快、中間放慢" },
	{ value: "fast-middle", label: "中間衝刺", hint: "兩端慢、中間加速" },
];

const STRENGTH_OPTIONS = [
	{ value: 0.4, label: "弱" },
	{ value: 0.7, label: "中" },
	{ value: 1, label: "強" },
];

const SEGMENT_OPTIONS = [8, 12, 20];

const AUDIO_OPTIONS: Array<{ value: SpeedRampAudioMode; label: string }> = [
	{ value: "mute", label: "靜音" },
	{ value: "pitch", label: "保留(變調)" },
	{ value: "keep-pitch", label: "保留(不變調)" },
];

/**
 * 變速曲線(階梯式近似):把這個片段切成 N 段、各段套不同的固定速度,總長度不變。
 * 不是連續曲線(專案格式只有單一倍率),段數越多越平順,但切點越多預覽越吃力。
 */
export function SpeedRampSection({
	element,
	trackId,
}: {
	element: VideoElement;
	trackId: string;
}) {
	const editor = useEditor();
	const [profile, setProfile] = useState<SpeedRampProfile>("accelerate");
	const [strength, setStrength] = useState(0.7);
	const [segments, setSegments] = useState(12);
	const [audio, setAudio] = useState<SpeedRampAudioMode>("mute");

	const plan = planSpeedRamp({
		durationSeconds: mediaTimeToSeconds({ time: element.duration }),
		baseRate: clampRetimeRate({ rate: element.retime?.rate ?? 1 }),
		profile,
		strength,
		segments,
	});

	const apply = () => {
		if (!plan.ok) {
			toast.error(plan.reason);
			return;
		}
		const result = editor.timeline.applySpeedRamp({
			trackId,
			elementId: element.id,
			profile,
			strength,
			segments,
			audio,
		});
		if (result.error) {
			toast.error(result.error);
			return;
		}
		toast.success(
			`已切成 ${result.pieces} 段變速(${plan.minRate.toFixed(2)}x ~ ${plan.maxRate.toFixed(2)}x,聲音:${AUDIO_OPTIONS.find((o) => o.value === audio)?.label};一次復原)`,
		);
	};

	return (
		<div className="flex flex-col gap-2">
			<span className="text-muted-foreground text-xs">
				變速曲線(把片段切成多段、各段速度不同,總長度不變)
			</span>
			<div className="grid grid-cols-2 gap-1">
				{PROFILE_OPTIONS.map((option) => (
					<Button
						key={option.value}
						size="sm"
						variant={profile === option.value ? "default" : "outline"}
						title={option.hint}
						onClick={() => setProfile(option.value)}
					>
						{option.label}
					</Button>
				))}
			</div>
			<div className="flex flex-wrap items-center gap-1">
				<span className="text-muted-foreground text-xs">強度</span>
				{STRENGTH_OPTIONS.map((option) => (
					<Button
						key={option.value}
						size="sm"
						variant={strength === option.value ? "default" : "outline"}
						onClick={() => setStrength(option.value)}
					>
						{option.label}
					</Button>
				))}
				<span className="text-muted-foreground ml-2 text-xs">段數</span>
				{SEGMENT_OPTIONS.map((option) => (
					<Button
						key={option}
						size="sm"
						variant={segments === option ? "default" : "outline"}
						onClick={() => setSegments(option)}
					>
						{option}
					</Button>
				))}
			</div>
			<div className="flex flex-wrap items-center gap-1">
				<span className="text-muted-foreground text-xs">原聲</span>
				{AUDIO_OPTIONS.map((option) => (
					<Button
						key={option.value}
						size="sm"
						variant={audio === option.value ? "default" : "outline"}
						onClick={() => setAudio(option.value)}
					>
						{option.label}
					</Button>
				))}
			</div>
			<Button size="sm" disabled={!plan.ok} onClick={apply}>
				套用變速曲線
			</Button>
			<span className="text-muted-foreground text-xs">
				{plan.ok
					? `預計 ${plan.minRate.toFixed(2)}x ~ ${plan.maxRate.toFixed(2)}x。慢速段在 30fps 素材上會有點一格一格;預覽吃力請先建立代理檔。`
					: plan.reason}
			</span>
		</div>
	);
}
