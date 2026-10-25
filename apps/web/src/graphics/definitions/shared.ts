import type { ParamDefinition } from "@/params";

export type GraphicStrokeAlign = "inside" | "center" | "outside";

export const STROKE_ALIGN_PARAM: ParamDefinition<"strokeAlign"> = {
	key: "strokeAlign",
	label: "描邊對齊",
	type: "select",
	default: "center",
	group: "stroke",
	options: [
		{ value: "inside", label: "內側" },
		{ value: "center", label: "置中" },
		{ value: "outside", label: "外側" },
	],
};
