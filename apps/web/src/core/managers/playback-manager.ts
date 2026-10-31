import type { EditorCore } from "@/core";
import {
	addMediaTime,
	clampMediaTime,
	type MediaTime,
	mediaTimeFromSeconds,
	roundFrameTime,
	ZERO_MEDIA_TIME,
} from "@/wasm";

export class PlaybackManager {
	private isPlaying = false;
	private currentTime: MediaTime = ZERO_MEDIA_TIME;
	private volume = 1;
	private muted = false;
	private previousVolume = 1;
	private isScrubbing = false;
	private listeners = new Set<() => void>();
	private updateListeners = new Set<(time: MediaTime) => void>();
	private seekListeners = new Set<(time: MediaTime) => void>();
	private playbackTimer: number | null = null;
	private playbackStartWallTime = 0;
	private playbackStartTime: MediaTime = ZERO_MEDIA_TIME;
	private timelineScopeBound = false;
	/** 音訊時鐘(秒);回傳 null 代表目前沒有可用的音訊時鐘,改用牆上時鐘 */
	private clockSource: (() => number | null) | null = null;

	constructor(private editor: EditorCore) {}

	bindTimelineScope(): void {
		if (this.timelineScopeBound) {
			return;
		}

		const reconcile = () => {
			this.reconcileTimelineScope();
		};
		this.editor.timeline.subscribe(reconcile);
		this.editor.scenes.subscribe(reconcile);
		this.timelineScopeBound = true;
		this.reconcileTimelineScope();
	}

	setClockSource({ source }: { source: (() => number | null) | null }): void {
		this.clockSource = source;
	}

	play(): void {
		const maxTime = this.editor.timeline.getTotalDuration();
		if (maxTime <= 0) {
			return;
		}

		if (this.currentTime >= maxTime) {
			this.seek({ time: ZERO_MEDIA_TIME });
		}

		this.isPlaying = true;
		this.startTimer();
		this.notify();
	}

	pause(): void {
		this.isPlaying = false;
		this.stopTimer();
		this.notify();
	}

	toggle(): void {
		if (this.isPlaying) {
			this.pause();
		} else {
			this.play();
		}
	}

	seek({ time }: { time: MediaTime }): void {
		this.currentTime = this.clampTimeToTimeline(time);
		if (this.isPlaying) {
			this.playbackStartWallTime = performance.now();
			this.playbackStartTime = this.currentTime;
		}
		this.notify();
		this.notifySeek(this.currentTime);
	}

	setVolume({ volume }: { volume: number }): void {
		const clampedVolume = Math.max(0, Math.min(1, volume));
		this.volume = clampedVolume;
		this.muted = clampedVolume === 0;
		if (clampedVolume > 0) {
			this.previousVolume = clampedVolume;
		}
		this.notify();
	}

	mute(): void {
		if (this.volume > 0) {
			this.previousVolume = this.volume;
		}
		this.muted = true;
		this.volume = 0;
		this.notify();
	}

	unmute(): void {
		this.muted = false;
		this.volume = this.previousVolume;
		this.notify();
	}

	toggleMute(): void {
		if (this.muted) {
			this.unmute();
		} else {
			this.mute();
		}
	}

	getIsPlaying(): boolean {
		return this.isPlaying;
	}

	getCurrentTime(): MediaTime {
		return this.currentTime;
	}

	getVolume(): number {
		return this.volume;
	}

	isMuted(): boolean {
		return this.muted;
	}

	setScrubbing({ isScrubbing }: { isScrubbing: boolean }): void {
		this.isScrubbing = isScrubbing;
		this.notify();
	}

	getIsScrubbing(): boolean {
		return this.isScrubbing;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	onUpdate(listener: (time: MediaTime) => void): () => void {
		this.updateListeners.add(listener);
		return () => this.updateListeners.delete(listener);
	}

	onSeek(listener: (time: MediaTime) => void): () => void {
		this.seekListeners.add(listener);
		return () => this.seekListeners.delete(listener);
	}

	private reconcileTimelineScope(): void {
		const maxTime = this.editor.timeline.getTotalDuration();
		const nextTime = this.clampTimeToTimeline(this.currentTime);
		const shouldPause = this.isPlaying && nextTime >= maxTime;
		const timeChanged = nextTime !== this.currentTime;

		if (!timeChanged && !shouldPause) {
			return;
		}

		if (shouldPause) {
			this.isPlaying = false;
			this.stopTimer();
		}

		this.currentTime = nextTime;
		this.notify();

		if (timeChanged) {
			this.notifySeek(this.currentTime);
			this.dispatchSeekEvent(this.currentTime);
		}
	}

	private notify(): void {
		this.listeners.forEach((fn) => {
			fn();
		});
	}

	private notifyUpdate(time: MediaTime): void {
		this.updateListeners.forEach((fn) => {
			fn(time);
		});
	}

	private notifySeek(time: MediaTime): void {
		this.seekListeners.forEach((fn) => {
			fn(time);
		});
	}

	private startTimer(): void {
		if (this.playbackTimer) {
			cancelAnimationFrame(this.playbackTimer);
		}

		this.playbackStartWallTime = performance.now();
		this.playbackStartTime = this.currentTime;
		this.updateTime();
	}

	private stopTimer(): void {
		if (this.playbackTimer) {
			cancelAnimationFrame(this.playbackTimer);
			this.playbackTimer = null;
		}
	}

	private updateTime = (): void => {
		if (!this.isPlaying) return;

		const fps = this.editor.project.getActive()?.settings.fps;
		const elapsedSeconds =
			(performance.now() - this.playbackStartWallTime) / 1000;
		const wallTime = addMediaTime({
			a: this.playbackStartTime,
			b: mediaTimeFromSeconds({ seconds: elapsedSeconds }),
		});
		const audioSeconds = this.clockSource?.() ?? null;
		let rawTime = wallTime;
		if (audioSeconds !== null && Number.isFinite(audioSeconds)) {
			const audioTime = mediaTimeFromSeconds({ seconds: Math.max(0, audioSeconds) });
			// 時間不倒退(輸出延遲估計的小抖動不該讓播放頭往回跳)
			rawTime = audioTime > this.currentTime ? audioTime : this.currentTime;
			// 把牆上時鐘對齊到目前時間,音訊時鐘中斷時退回去不會跳
			this.playbackStartWallTime = performance.now();
			this.playbackStartTime = rawTime;
		}
		const newTime = fps ? roundFrameTime({ time: rawTime, fps }) : rawTime;
		const maxTime = this.editor.timeline.getTotalDuration();

		if (newTime >= maxTime) {
			this.pause();
			this.currentTime = maxTime;
			this.notify();
		this.notifySeek(maxTime);
		this.dispatchSeekEvent(maxTime);
		return;
		}

		this.currentTime = newTime;
		this.notifyUpdate(newTime);
		this.dispatchUpdateEvent(newTime);
		this.playbackTimer = requestAnimationFrame(this.updateTime);
	};

	private clampTimeToTimeline(time: MediaTime): MediaTime {
		const maxTime = this.editor.timeline.getTotalDuration();
		return clampMediaTime({ time, min: ZERO_MEDIA_TIME, max: maxTime });
	}

	private dispatchSeekEvent(time: MediaTime): void {
		if (typeof window === "undefined") {
			return;
		}
	}

	private dispatchUpdateEvent(time: MediaTime): void {
		if (typeof window === "undefined") {
			return;
		}
	}
}
