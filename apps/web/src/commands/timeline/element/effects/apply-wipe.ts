import { Command, type CommandResult } from "@/commands/base-command";
import { buildEffectParamPath } from "@/animation/effect-param-channel";
import type { ParamValues } from "@/params";
import type { MediaTime } from "@/wasm";
import { UpsertKeyframeCommand } from "../keyframes/upsert-keyframe";
import { AddClipEffectCommand } from "./add-effect";
import { UpdateClipEffectParamsCommand } from "./update-effect-params";

/**
 * 在片段上加一個「擦除」特效、設好參數、並對進度做關鍵影格,合成一個復原步驟。
 * 特效 id 要等 AddClipEffectCommand 執行後才知道,所以像 QuickCutCommand 一樣
 * 直接呼叫子指令的 execute(),undo 時反向還原。
 */
export class ApplyWipeCommand extends Command {
	private executed: Command[] = [];

	constructor(
		private readonly input: {
			trackId: string;
			elementId: string;
			params: ParamValues;
			progressKeyframes: Array<{ time: MediaTime; value: number }>;
		},
	) {
		super();
	}

	execute(): CommandResult | undefined {
		const { trackId, elementId, params, progressKeyframes } = this.input;
		this.executed = [];

		const add = new AddClipEffectCommand({ trackId, elementId, effectType: "wipe" });
		add.execute();
		this.executed.push(add);
		const effectId = add.getEffectId();
		if (!effectId) return undefined;

		const update = new UpdateClipEffectParamsCommand({
			trackId,
			elementId,
			effectId,
			params,
		});
		update.execute();
		this.executed.push(update);

		const propertyPath = buildEffectParamPath({ effectId, paramKey: "progress" });
		for (const { time, value } of progressKeyframes) {
			const keyframe = new UpsertKeyframeCommand({
				trackId,
				elementId,
				propertyPath,
				time,
				value,
			});
			keyframe.execute();
			this.executed.push(keyframe);
		}
		return undefined;
	}

	undo(): void {
		for (const command of [...this.executed].reverse()) {
			command.undo();
		}
		this.executed = [];
	}
}
