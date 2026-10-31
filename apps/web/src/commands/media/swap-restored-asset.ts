import { EditorCore } from "@/core";
import type { MediaAsset } from "@/media/types";
import { videoCache } from "@/services/video-cache/service";

/**
 * 復原 / 重做後,把記憶體裡的素材換成從儲存空間重新讀到的版本(檔案與網址是新的)。
 * 這段時間使用者可能又改了素材清單:只換同 id 的那一筆,找不到就把新網址釋放掉。
 */
export function swapRestoredAsset({ restored }: { restored: MediaAsset }): void {
	const editor = EditorCore.getInstance();
	const assets = editor.media.getAssets();
	const current = assets.find((asset) => asset.id === restored.id);
	if (!current || current.file === restored.file) {
		if (!current && restored.url) URL.revokeObjectURL(restored.url);
		return;
	}
	// 解碼器還綁著舊的 File(OPFS 的舊 File 在檔案被刪 / 改寫後會失效),要丟掉重開
	videoCache.clearVideo({ mediaId: restored.id });
	if (current.url && current.url !== restored.url) {
		URL.revokeObjectURL(current.url);
	}
	editor.media.setAssets({
		assets: assets.map((asset) => (asset.id === restored.id ? restored : asset)),
	});
}
