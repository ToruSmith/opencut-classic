import type {
	ParamDefinition,
	ParamValue,
	ParamValues,
} from "@/params";
import { MIN_TRANSFORM_SCALE } from "@/animation/transform";
import type { BlendMode } from "@/rendering";
import type {
	ElementType,
	TimelineElement,
} from "@/timeline";
import { DEFAULTS } from "@/timeline/defaults";
import { VOLUME_DB_MAX, VOLUME_DB_MIN } from "@/timeline/audio-constants";
import {
	CORNER_RADIUS_MAX,
	CORNER_RADIUS_MIN,
} from "@/text/background";

export type ElementParamDefinition<TKey extends string = string> =
	ParamDefinition<TKey> & {
		read?: ({ element }: { element: TimelineElement }) => ParamValue | null;
		write?: ({
			element,
			value,
		}: {
			element: TimelineElement;
			value: ParamValue;
		}) => TimelineElement;
	};

export function buildDefaultParamValues(
	params: readonly ParamDefinition[],
): ParamValues {
	const values: ParamValues = {};
	for (const param of params) {
		values[param.key] = param.default;
	}
	return values;
}

export class DefinitionRegistry<TKey extends string, TDefinition> {
	private definitions = new Map<TKey, TDefinition>();
	private entityName: string;

	constructor(entityName: string) {
		this.entityName = entityName;
	}

	register({
		key,
		definition,
	}: {
		key: TKey;
		definition: TDefinition;
	}): void {
		this.definitions.set(key, definition);
	}

	has(key: TKey): boolean {
		return this.definitions.has(key);
	}

	get(key: TKey): TDefinition {
		const def = this.definitions.get(key);
		if (!def) {
			throw new Error(`Unknown ${this.entityName}: ${key}`);
		}
		return def;
	}

	getAll(): TDefinition[] {
		return Array.from(this.definitions.values());
	}
}

const BLEND_MODE_OPTIONS: Array<{ value: BlendMode; label: string }> = [
	{ value: "normal", label: "正常" },
	{ value: "darken", label: "變暗" },
	{ value: "multiply", label: "色彩增值" },
	{ value: "color-burn", label: "加深顏色" },
	{ value: "lighten", label: "變亮" },
	{ value: "screen", label: "濾色" },
	{ value: "plus-lighter", label: "線性加亮" },
	{ value: "color-dodge", label: "加亮顏色" },
	{ value: "overlay", label: "覆蓋" },
	{ value: "soft-light", label: "柔光" },
	{ value: "hard-light", label: "實光" },
	{ value: "difference", label: "差異化" },
	{ value: "exclusion", label: "排除" },
	{ value: "hue", label: "色相" },
	{ value: "saturation", label: "飽和度" },
	{ value: "color", label: "顏色" },
	{ value: "luminosity", label: "明度" },
];

const visualElementParams: ElementParamDefinition[] = [
	{
		key: "transform.positionX",
		label: "位置 X",
		type: "number",
		default: DEFAULTS.element.transform.position.x,
		min: -100_000,
		step: 1,
	},
	{
		key: "transform.positionY",
		label: "位置 Y",
		type: "number",
		default: DEFAULTS.element.transform.position.y,
		min: -100_000,
		step: 1,
	},
	{
		key: "transform.scaleX",
		label: "縮放 X",
		type: "number",
		default: DEFAULTS.element.transform.scaleX,
		min: MIN_TRANSFORM_SCALE,
		step: 0.01,
	},
	{
		key: "transform.scaleY",
		label: "縮放 Y",
		type: "number",
		default: DEFAULTS.element.transform.scaleY,
		min: MIN_TRANSFORM_SCALE,
		step: 0.01,
	},
	{
		key: "transform.rotate",
		label: "旋轉",
		type: "number",
		default: DEFAULTS.element.transform.rotate,
		min: -360,
		max: 360,
		step: 1,
	},
	{
		key: "opacity",
		label: "不透明度",
		type: "number",
		default: DEFAULTS.element.opacity,
		min: 0,
		max: 1,
		step: 0.01,
	},
	{
		key: "blendMode",
		label: "混合模式",
		type: "select",
		default: DEFAULTS.element.blendMode,
		keyframable: false,
		options: BLEND_MODE_OPTIONS,
	},
];

const audioElementParams: ElementParamDefinition[] = [
	{
		key: "volume",
		label: "音量",
		type: "number",
		default: DEFAULTS.element.volume,
		min: VOLUME_DB_MIN,
		max: VOLUME_DB_MAX,
		step: 0.01,
	},
	{
		key: "muted",
		label: "靜音",
		type: "boolean",
		default: false,
		keyframable: false,
	},
];

const textElementParams: ElementParamDefinition[] = [
	{
		key: "content",
		label: "內容",
		type: "text",
		default: "Default text",
		keyframable: false,
	},
	{
		key: "fontFamily",
		label: "字型",
		type: "font",
		default: "Arial",
		keyframable: false,
	},
	{
		key: "fontSize",
		label: "字體大小",
		type: "number",
		default: 15,
		min: 1,
		step: 1,
	},
	{
		key: "color",
		label: "顏色",
		type: "color",
		default: "#ffffff",
	},
	{
		key: "textAlign",
		label: "對齊",
		type: "select",
		default: "center",
		keyframable: false,
		options: [
			{ value: "left", label: "靠左" },
			{ value: "center", label: "置中" },
			{ value: "right", label: "靠右" },
		],
	},
	{
		key: "fontWeight",
		label: "字重",
		type: "select",
		default: "normal",
		keyframable: false,
		options: [
			{ value: "normal", label: "正常" },
			{ value: "bold", label: "粗體" },
		],
	},
	{
		key: "fontStyle",
		label: "字型樣式",
		type: "select",
		default: "normal",
		keyframable: false,
		options: [
			{ value: "normal", label: "正常" },
			{ value: "italic", label: "斜體" },
		],
	},
	{
		key: "textDecoration",
		label: "文字裝飾",
		type: "select",
		default: "none",
		keyframable: false,
		options: [
			{ value: "none", label: "無" },
			{ value: "underline", label: "底線" },
			{ value: "line-through", label: "刪除線" },
		],
	},
	{
		key: "letterSpacing",
		label: "字距",
		type: "number",
		default: DEFAULTS.text.letterSpacing,
		min: -100,
		step: 0.1,
	},
	{
		key: "lineHeight",
		label: "行高",
		type: "number",
		default: DEFAULTS.text.lineHeight,
		min: 0.1,
		step: 0.1,
	},
	{
		key: "background.enabled",
		label: "啟用背景",
		type: "boolean",
		default: DEFAULTS.text.background.enabled,
		keyframable: false,
	},
	{
		key: "background.color",
		label: "背景顏色",
		type: "color",
		default: DEFAULTS.text.background.color,
		dependencies: [{ param: "background.enabled", equals: true }],
	},
	{
		key: "background.cornerRadius",
		label: "背景圓角",
		type: "number",
		default: DEFAULTS.text.background.cornerRadius,
		min: CORNER_RADIUS_MIN,
		max: CORNER_RADIUS_MAX,
		step: 1,
		dependencies: [{ param: "background.enabled", equals: true }],
	},
	{
		key: "background.paddingX",
		label: "背景內距 X",
		type: "number",
		default: DEFAULTS.text.background.paddingX,
		min: 0,
		step: 1,
		dependencies: [{ param: "background.enabled", equals: true }],
	},
	{
		key: "background.paddingY",
		label: "背景內距 Y",
		type: "number",
		default: DEFAULTS.text.background.paddingY,
		min: 0,
		step: 1,
		dependencies: [{ param: "background.enabled", equals: true }],
	},
	{
		key: "background.offsetX",
		label: "背景偏移 X",
		type: "number",
		default: DEFAULTS.text.background.offsetX,
		min: -100_000,
		step: 1,
		dependencies: [{ param: "background.enabled", equals: true }],
	},
	{
		key: "background.offsetY",
		label: "背景偏移 Y",
		type: "number",
		default: DEFAULTS.text.background.offsetY,
		min: -100_000,
		step: 1,
		dependencies: [{ param: "background.enabled", equals: true }],
	},
];

export const elementParamRegistry = new DefinitionRegistry<
	ElementType,
	readonly ElementParamDefinition[]
>("element params");

elementParamRegistry.register({
	key: "video",
	definition: [...visualElementParams, ...audioElementParams],
});
elementParamRegistry.register({ key: "image", definition: visualElementParams });
elementParamRegistry.register({
	key: "text",
	definition: [...textElementParams, ...visualElementParams],
});
elementParamRegistry.register({
	key: "sticker",
	definition: visualElementParams,
});
elementParamRegistry.register({
	key: "graphic",
	definition: visualElementParams,
});
elementParamRegistry.register({ key: "audio", definition: audioElementParams });
elementParamRegistry.register({ key: "effect", definition: [] });

export function getElementParams({
	element,
}: {
	element: TimelineElement;
}): readonly ElementParamDefinition[] {
	return elementParamRegistry.has(element.type)
		? elementParamRegistry.get(element.type)
		: [];
}

export function getBuiltInElementParams({
	type,
}: {
	type: ElementType;
}): readonly ElementParamDefinition[] {
	return elementParamRegistry.has(type) ? elementParamRegistry.get(type) : [];
}

export function getElementParam({
	element,
	key,
}: {
	element: TimelineElement;
	key: string;
}): ElementParamDefinition | null {
	return (
		getElementParams({ element }).find((param) => param.key === key) ?? null
	);
}

export function readElementParamValue({
	element,
	param,
}: {
	element: TimelineElement;
	param: ElementParamDefinition;
}): ParamValue | null {
	if (param.read) {
		return param.read({ element });
	}
	if ("params" in element) {
		return element.params[param.key] ?? param.default;
	}
	return null;
}

export function writeElementParamValue({
	element,
	param,
	value,
}: {
	element: TimelineElement;
	param: ElementParamDefinition;
	value: ParamValue;
}): TimelineElement {
	if (param.write) {
		return param.write({ element, value });
	}
	if ("params" in element) {
		return {
			...element,
			params: {
				...element.params,
				[param.key]: value,
			},
		};
	}
	return element;
}

export function buildElementParamValues({
	element,
}: {
	element: TimelineElement;
}): ParamValues {
	const values: ParamValues = {};
	for (const param of getElementParams({ element })) {
		const value = readElementParamValue({ element, param });
		if (value !== null) {
			values[param.key] = value;
		}
	}
	return values;
}

