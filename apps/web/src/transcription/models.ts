import type {
	TranscriptionModel,
	TranscriptionModelId,
} from "./types";

export const TRANSCRIPTION_MODELS: TranscriptionModel[] = [
	{
		id: "whisper-tiny",
		name: "極小",
		huggingFaceId: "onnx-community/whisper-tiny",
		description: "最快,準確度較低",
	},
	{
		id: "whisper-small",
		name: "小",
		huggingFaceId: "onnx-community/whisper-small",
		description: "速度與準確度平衡",
	},
	{
		id: "whisper-medium",
		name: "中",
		huggingFaceId: "onnx-community/whisper-medium",
		description: "準確度較高,速度較慢",
	},
	{
		id: "whisper-large-v3-turbo",
		name: "Large v3 Turbo",
		huggingFaceId: "onnx-community/whisper-large-v3-turbo",
		description: "準確度最佳,需 WebGPU 才有好效能",
	},
];

export const DEFAULT_TRANSCRIPTION_MODEL: TranscriptionModelId =
	"whisper-small";
