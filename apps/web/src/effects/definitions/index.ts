import { effectsRegistry } from "../registry";
import { blurEffectDefinition } from "./blur";
import { chromaKeyEffectDefinition } from "./chroma-key";
import {
	colorAdjustEffectDefinition,
	grayscaleEffectDefinition,
	sepiaEffectDefinition,
	vignetteEffectDefinition,
} from "./color";

const defaultEffects = [
	blurEffectDefinition,
	chromaKeyEffectDefinition,
	colorAdjustEffectDefinition,
	grayscaleEffectDefinition,
	sepiaEffectDefinition,
	vignetteEffectDefinition,
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
