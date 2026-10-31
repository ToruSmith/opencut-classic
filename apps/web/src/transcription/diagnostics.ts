import type { DiagnosticsManager } from "@/core/managers/diagnostics-manager";
import { timelineHasAudio } from "@/media/audio";

export const TRANSCRIPTION_DIAGNOSTICS_SCOPE = "transcription";

export function registerTranscriptionDiagnostics({
	diagnostics,
}: {
	diagnostics: DiagnosticsManager;
}): void {
	diagnostics.register({
		id: "transcription.no_audio",
		scope: TRANSCRIPTION_DIAGNOSTICS_SCOPE,
		severity: "caution",
		message: "沒有偵測到聲音。請先在時間軸加入有聲音的片段。",
		check: (editor) => {
			const scene = editor.scenes.getActiveSceneOrNull();
			if (!scene) return false;
			return !timelineHasAudio({
				tracks: editor.scenes.getPlaybackTracks({ tracks: scene.tracks }),
				mediaAssets: editor.media.getAssets(),
			});
		},
	});
}
