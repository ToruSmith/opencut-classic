import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/editor/use-editor";
import { FREEZE_MAX_SECONDS } from "@/timeline/freeze-frame";
import type { VideoElement } from "@/timeline";

const OPTIONS = [0.5, 1, 2, FREEZE_MAX_SECONDS];

/**
 * 凍結影格:在播放頭把這個影片片段切開,中間插入一段定格畫面,後面的片段往後推。
 * 定格段是同一支影片的複本(0.01x、靜音),不新增素材。
 */
export function FreezeFrameSection({
	element,
	trackId,
}: {
	element: VideoElement;
	trackId: string;
}) {
	const editor = useEditor();

	const freeze = ({ seconds }: { seconds: number }) => {
		const result = editor.timeline.freezeFrame({
			trackId,
			elementId: element.id,
			time: editor.playback.getCurrentTime(),
			seconds,
		});
		if (!result.done) {
			toast.error(result.error ?? "沒有套用");
			return;
		}
		toast.success(`已在播放頭定格 ${seconds} 秒(同一條軌道後面的片段已往後推;一次復原)`);
	};

	return (
		<div className="flex flex-col gap-2">
			<span className="text-muted-foreground text-xs">
				凍結影格(把播放頭移到這個片段中間,按下要定格的秒數)
			</span>
			<div className="flex flex-wrap gap-1">
				{OPTIONS.map((seconds) => (
					<Button key={seconds} size="sm" variant="outline" onClick={() => freeze({ seconds })}>
						{seconds} 秒
					</Button>
				))}
			</div>
			<span className="text-muted-foreground text-xs">
				其他軌道不會跟著移動;定格段靜音。高幀率素材(60fps)的長定格後半段可能多跳一格。
			</span>
		</div>
	);
}
