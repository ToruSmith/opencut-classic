import { Command, type CommandResult } from "@/commands/base-command";
import { EditorCore } from "@/core";
import type { TScene } from "@/timeline";
import { updateSceneInArray } from "@/timeline/scenes";
import { getFrameTime } from "@/timeline/bookmarks/index";
import { replaceBeatBookmarks } from "@/timeline/bookmarks/beat-markers";
import type { MediaTime } from "@/wasm";

/** 用節拍分析的結果取代目前場景的節拍書籤(傳空陣列 = 清除),一個復原步驟 */
export class SetBeatBookmarksCommand extends Command {
	private savedScenes: TScene[] | null = null;

	constructor(private times: MediaTime[]) {
		super();
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		const activeScene = editor.scenes.getActiveScene();
		const activeProject = editor.project.getActive();
		if (!activeScene || !activeProject) return;

		const scenes = editor.scenes.getScenes();
		this.savedScenes = [...scenes];

		const frameTimes = this.times.map((time) =>
			getFrameTime({ time, fps: activeProject.settings.fps }),
		);
		const bookmarks = replaceBeatBookmarks({
			bookmarks: activeScene.bookmarks,
			frameTimes,
		});
		editor.scenes.setScenes({
			scenes: updateSceneInArray({
				scenes,
				sceneId: activeScene.id,
				updates: { bookmarks },
			}),
		});
	}

	undo(): void {
		if (this.savedScenes) {
			EditorCore.getInstance().scenes.setScenes({ scenes: this.savedScenes });
		}
	}
}
