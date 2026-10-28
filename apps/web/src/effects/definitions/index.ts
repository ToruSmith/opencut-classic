import { effectsRegistry } from "../registry";
import { blurEffectDefinition } from "./blur";
import { chromaKeyEffectDefinition } from "./chroma-key";
import { lutEffectDefinition } from "./lut";
import { wipeEffectDefinition } from "./wipe";
import { cutMotionEffectDefinition } from "./cut-motion";
import {
	cameraShakeEffectDefinition,
	glitchEffectDefinition,
	mirrorEffectDefinition,
	zoomBlurEffectDefinition,
} from "./motion";
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
	filmGrainEffectDefinition,
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
	filmGrainEffectDefinition,
	lutEffectDefinition,
	cameraShakeEffectDefinition,
	zoomBlurEffectDefinition,
	glitchEffectDefinition,
	mirrorEffectDefinition,
	wipeEffectDefinition,
	cutMotionEffectDefinition,
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
