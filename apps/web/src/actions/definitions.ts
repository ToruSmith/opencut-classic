import type { ShortcutKey } from "@/actions/keybinding";
import type { TActionWithOptionalArgs } from "./types";

export type TActionCategory =
	| "playback"
	| "navigation"
	| "editing"
	| "selection"
	| "history"
	| "timeline"
	| "controls"
	| "assets";

export interface TActionBaseDefinition {
	description: string;
	category: TActionCategory;
	args?: Record<string, unknown>;
}

export interface TActionDefinition extends TActionBaseDefinition {
	defaultShortcuts?: readonly ShortcutKey[];
}

export const ACTIONS = {
	"toggle-play": {
		description: "播放/暫停",
		category: "playback",
	},
	"stop-playback": {
		description: "停止播放",
		category: "playback",
	},
	"seek-forward": {
		description: "前進 1 秒",
		category: "playback",
		args: { seconds: "number" },
	},
	"seek-backward": {
		description: "後退 1 秒",
		category: "playback",
		args: { seconds: "number" },
	},
	"frame-step-forward": {
		description: "下一格",
		category: "navigation",
	},
	"frame-step-backward": {
		description: "上一格",
		category: "navigation",
	},
	"jump-forward": {
		description: "前進 5 秒",
		category: "navigation",
		args: { seconds: "number" },
	},
	"jump-backward": {
		description: "後退 5 秒",
		category: "navigation",
		args: { seconds: "number" },
	},
	"goto-start": {
		description: "跳到開頭",
		category: "navigation",
	},
	"goto-end": {
		description: "跳到結尾",
		category: "navigation",
	},
	split: {
		description: "在播放頭分割",
		category: "editing",
	},
	"split-left": {
		description: "分割並刪除左側",
		category: "editing",
	},
	"split-right": {
		description: "分割並刪除右側",
		category: "editing",
	},
	"delete-selected": {
		description: "刪除選取項目",
		category: "editing",
	},
	"copy-selected": {
		description: "複製選取項目",
		category: "editing",
	},
	"paste-copied": {
		description: "在播放頭貼上",
		category: "editing",
	},
	"toggle-snapping": {
		description: "切換吸附",
		category: "editing",
	},
	"toggle-ripple-editing": {
		description: "切換連動剪輯",
		category: "editing",
	},
	"toggle-source-audio": {
		description: "擷取或還原原始音訊",
		category: "editing",
	},
	"select-all": {
		description: "全選",
		category: "selection",
	},
	"cancel-interaction": {
		description: "取消目前操作",
		category: "controls",
	},
	"deselect-all": {
		description: "取消全選",
		category: "selection",
	},
	"duplicate-selected": {
		description: "複製選取元素",
		category: "selection",
	},
	"toggle-elements-muted-selected": {
		description: "靜音/取消靜音",
		category: "selection",
	},
	"toggle-elements-visibility-selected": {
		description: "顯示/隱藏選取項目",
		category: "selection",
	},
	"toggle-bookmark": {
		description: "在播放頭切換書籤",
		category: "timeline",
	},
	undo: {
		description: "復原",
		category: "history",
	},
	redo: {
		description: "重做",
		category: "history",
	},
	"remove-media-asset": {
		description: "移除素材",
		category: "assets",
		args: { projectId: "string", assetId: "string" },
	},
	"remove-media-assets": {
		description: "移除素材",
		category: "assets",
		args: { projectId: "string", assetIds: "string[]" },
	},
} as const satisfies Record<string, TActionBaseDefinition>;

export type TAction = keyof typeof ACTIONS;

const ACTION_DEFAULT_SHORTCUTS = [
	["toggle-play", ["space", "k"]],
	["seek-forward", ["l"]],
	["seek-backward", ["j"]],
	["frame-step-forward", ["right"]],
	["frame-step-backward", ["left"]],
	["jump-forward", ["shift+right"]],
	["jump-backward", ["shift+left"]],
	["goto-start", ["home", "enter"]],
	["goto-end", ["end"]],
	["split", ["s"]],
	["split-left", ["q"]],
	["split-right", ["w"]],
	["delete-selected", ["backspace", "delete"]],
	["copy-selected", ["ctrl+c"]],
	["paste-copied", ["ctrl+v"]],
	["toggle-snapping", ["n"]],
	["select-all", ["ctrl+a"]],
	["cancel-interaction", ["escape"]],
	["duplicate-selected", ["ctrl+d"]],
	["undo", ["ctrl+z"]],
	["redo", ["ctrl+shift+z", "ctrl+y"]],
] as const satisfies ReadonlyArray<
	readonly [TActionWithOptionalArgs, readonly ShortcutKey[]]
>;

const ACTION_DEFAULT_SHORTCUTS_BY_ACTION = new Map<
	TAction,
	readonly ShortcutKey[]
>(ACTION_DEFAULT_SHORTCUTS);

export function getActionDefinition({
	action,
}: {
	action: TAction;
}): TActionDefinition {
	return {
		...ACTIONS[action],
		defaultShortcuts: ACTION_DEFAULT_SHORTCUTS_BY_ACTION.get(action),
	};
}

export function getDefaultShortcuts(): Map<
	ShortcutKey,
	TActionWithOptionalArgs
> {
	const shortcuts = new Map<ShortcutKey, TActionWithOptionalArgs>();

	for (const [action, defaultShortcuts] of ACTION_DEFAULT_SHORTCUTS) {
		for (const shortcut of defaultShortcuts) {
			shortcuts.set(shortcut, action);
		}
	}

	return shortcuts;
}
