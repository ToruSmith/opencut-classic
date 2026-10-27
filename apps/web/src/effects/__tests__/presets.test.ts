import { describe, expect, test } from "bun:test";
import { blurEffectDefinition } from "../definitions/blur";
import { chromaKeyEffectDefinition } from "../definitions/chroma-key";
import {
	colorAdjustEffectDefinition,
	grayscaleEffectDefinition,
	sepiaEffectDefinition,
	vignetteEffectDefinition,
} from "../definitions/color";
import {
	glowEffectDefinition,
	sharpenEffectDefinition,
	splitToneEffectDefinition,
} from "../definitions/detail";
import { lutEffectDefinition } from "../definitions/lut";
import {
	cameraShakeEffectDefinition,
	glitchEffectDefinition,
	mirrorEffectDefinition,
	zoomBlurEffectDefinition,
} from "../definitions/motion";
import {
	chromaticAberrationEffectDefinition,
	filmGrainEffectDefinition,
	pixelateEffectDefinition,
	posterizeEffectDefinition,
} from "../definitions/stylize";
import {
	coolLookEffectDefinition,
	filmFadeLookEffectDefinition,
	toneEffectDefinition,
	warmLookEffectDefinition,
} from "../definitions/tone";
import { EFFECT_PRESETS } from "../presets";
import { LUT_PRESETS } from "@/lut/presets";
import type { EffectDefinition } from "../types";

const DEFINITIONS: EffectDefinition[] = [
	blurEffectDefinition,
	chromaKeyEffectDefinition,
	colorAdjustEffectDefinition,
	grayscaleEffectDefinition,
	sepiaEffectDefinition,
	vignetteEffectDefinition,
	glowEffectDefinition,
	sharpenEffectDefinition,
	splitToneEffectDefinition,
	lutEffectDefinition,
	cameraShakeEffectDefinition,
	glitchEffectDefinition,
	mirrorEffectDefinition,
	zoomBlurEffectDefinition,
	chromaticAberrationEffectDefinition,
	filmGrainEffectDefinition,
	pixelateEffectDefinition,
	posterizeEffectDefinition,
	coolLookEffectDefinition,
	filmFadeLookEffectDefinition,
	toneEffectDefinition,
	warmLookEffectDefinition,
];
const byType = new Map(DEFINITIONS.map((d) => [d.type, d]));

describe("效果組合", () => {
	test("id 不重複、至少有一層", () => {
		const ids = EFFECT_PRESETS.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const preset of EFFECT_PRESETS) expect(preset.layers.length).toBeGreaterThan(0);
	});

	for (const preset of EFFECT_PRESETS) {
		test(`${preset.name}:特效存在、參數 key 存在且在範圍內`, () => {
			for (const layer of preset.layers) {
				const definition = byType.get(layer.effectType);
				expect(definition, `找不到特效 ${layer.effectType}`).toBeDefined();
				for (const [key, value] of Object.entries(layer.params ?? {})) {
					const param = definition!.params.find((p) => p.key === key);
					expect(param, `${layer.effectType} 沒有參數 ${key}`).toBeDefined();
					if (param!.type === "number") {
						expect(typeof value).toBe("number");
						expect(value as number).toBeGreaterThanOrEqual(param!.min ?? -Infinity);
						expect(value as number).toBeLessThanOrEqual(param!.max ?? Infinity);
					}
				}
			}
		});
	}

	test("LUT 層指定的內建風格存在", () => {
		const ids = new Set(LUT_PRESETS.map((p) => p.id));
		for (const preset of EFFECT_PRESETS)
			for (const layer of preset.layers)
				if (layer.effectType === "lut") expect(ids.has(String(layer.params?.lut))).toBe(true);
	});
});
