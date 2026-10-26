import { effectsRegistry } from "../registry";
import { blurEffectDefinition } from "./blur";
import { chromaKeyEffectDefinition } from "./chroma-key";
import {
	glowEffectDefinition,
	sharpenEffectDefinition,
	splitToneEffectDefinition,
} from "./detail";
import {
	colorAdjustEffectDefinition,
	grayscaleEffectDefinition,
	sepiaEffectDefinition,
	vignetteEffectDefinition,
} from "./color";
import {
	chromaticAberrationEffectDefinition,
	pixelateEffectDefinition,
	posterizeEffectDefinition,
} from "./stylize";
import {
	coolLookEffectDefinition,
	filmFadeLookEffectDefinition,
	toneEffectDefinition,
	warmLookEffectDefinition,
} from "./tone";

const defaultEffects = [
	blurEffectDefinition,
	chromaKeyEffectDefinition,
	colorAdjustEffectDefinition,
	grayscaleEffectDefinition,
	sepiaEffectDefinition,
	vignetteEffectDefinition,
	toneEffectDefinition,
	warmLookEffectDefinition,
	coolLookEffectDefinition,
	filmFadeLookEffectDefinition,
	sharpenEffectDefinition,
	glowEffectDefinition,
	splitToneEffectDefinition,
	pixelateEffectDefinition,
	chromaticAberrationEffectDefinition,
	posterizeEffectDefinition,
];

export function registerDefaultEffects(): void {
	for (const definition of defaultEffects) {
		if (effectsRegistry.has(definition.type)) {
			continue;
		}
		effectsRegistry.register({
			key: definition.type,
			definition,
		});
	}
}
