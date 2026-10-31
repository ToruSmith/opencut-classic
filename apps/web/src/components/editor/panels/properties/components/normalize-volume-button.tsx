"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/editor/use-editor";
import { normalizeElementsVolume } from "@/media/normalize-volume";
import { DEFAULT_TARGET_DB } from "@/media/loudness";

/**
 * 「標準化音量」:把目前選取的所有有聲音的片段,各自調到同一響度。
 * 選取多個片段再按一次,就能讓它們聽起來一樣大聲。
 */
export function NormalizeVolumeButton({
	trackId,
	elementId,
}: {
	trackId: string;
	elementId: string;
}) {
	const editor = useEditor();
	const [busy, setBusy] = useState(false);

	const handleClick = async () => {
		const selected = editor.selection.getSelectedElements();
		const refs =
			selected.some((ref) => ref.elementId === elementId) && selected.length > 0
				? selected
				: [{ trackId, elementId }];
		setBusy(true);
		try {
			const results = await normalizeElementsVolume({ editor, refs });
			const changed = results.filter((item) => item.status === "changed");
			const skipped = results.filter((item) => item.status === "skipped");
			if (changed.length === 0) {
				toast.error("沒有可標準化的片段", {
					description: skipped[0]?.reason,
				});
				return;
			}
			toast.success(`已把 ${changed.length} 個片段調到同一響度`, {
				description:
					skipped.length > 0
						? `略過 ${skipped.length} 個:${skipped[0]?.reason}`
						: `目標 ${DEFAULT_TARGET_DB} dB`,
			});
		} catch (error) {
			console.error(error);
			toast.error("標準化失敗", {
				description: error instanceof Error ? error.message : undefined,
			});
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="px-4 pb-4">
			<Button
				variant="outline"
				size="sm"
				className="w-full"
				disabled={busy}
				onClick={handleClick}
			>
				{busy ? "量測中…" : "標準化音量(選取的片段)"}
			</Button>
			<p className="text-muted-foreground mt-2 text-xs">
				量出片段的響度後,把音量調到 {DEFAULT_TARGET_DB} dB。選取多個片段會一起調到同一響度;有音量關鍵影格的片段會略過。
			</p>
		</div>
	);
}
