import type { MediaAssetData } from "@/services/storage/types";

export type MediaType = "image" | "video" | "audio";

export interface MediaAsset
	extends Omit<MediaAssetData, "size" | "lastModified"> {
	file: File;
	url?: string;
	/** 預覽用的低解析度代理檔(只有影片、而且使用者建立過才有) */
	proxyFile?: File;
}
