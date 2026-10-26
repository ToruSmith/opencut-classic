import type { ParamDefinition, ParamValues } from "@/params";

export interface Effect {
	id: string;
	type: string;
	params: ParamValues;
	enabled: boolean;
}

export type EffectUniformValue = number | number[];

export interface EffectPass {
	shader: string;
	uniforms: Record<string, EffectUniformValue>;
	/**
	 * 第二張輸入貼圖(例如 LUT)。frame-descriptor 會依 id 找到資料並上傳;
	 * 找不到時把這個 pass 拿掉。對應 Rust 的 EffectPassDescriptor.texture_id。
	 */
	textureId?: string;
}

export interface EffectPassTemplate {
	shader: string;
	uniforms(params: {
		effectParams: ParamValues;
		width: number;
		height: number;
		/** 從片段開頭算起的秒數。會隨時間變化的效果(例如底片顆粒)用來當亂數種子;縮圖預覽為 0。 */
		time?: number;
	}): Record<string, EffectUniformValue>;
}

export interface EffectRendererConfig {
	passes: EffectPassTemplate[];
	buildPasses?: (params: {
		effectParams: ParamValues;
		width: number;
		height: number;
		time?: number;
	}) => EffectPass[];
}

export interface EffectDefinition {
	type: string;
	name: string;
	keywords: string[];
	params: ParamDefinition[];
	renderer: EffectRendererConfig;
}
