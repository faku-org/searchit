import type { EventCategory, EventWeights } from "@searchit/shared";

// Sports events lean on bib-number OCR: a lower confidence floor lets noisy
// number crops still surface text, while a tighter face-match distance keeps
// identity linking conservative since faces are secondary there. Vacation
// events flip that (fewer false-positive OCR fragments, looser face linking
// since recognizing people matters more); "general" preserves this repo's
// pre-category defaults (FACE_MATCH_MAX_DISTANCE's own env fallback is 0.6).
// Tuned as starting presets per issue #1 -- "custom" lets a specific event
// override either number directly instead of picking a preset.
const CATEGORY_PRESETS: Record<Exclude<EventCategory, "custom">, EventWeights> = {
  sports: { ocrMinConfidence: 0.3, faceMatchMaxDistance: 0.5 },
  vacation: { ocrMinConfidence: 0.65, faceMatchMaxDistance: 0.68 },
  general: { ocrMinConfidence: 0.5, faceMatchMaxDistance: 0.6 },
};

export function resolveEventWeights(event: {
  category: EventCategory;
  customOcrMinConfidence: number | null;
  customFaceMatchMaxDistance: number | null;
}): EventWeights {
  if (event.category === "custom") {
    return {
      ocrMinConfidence:
        event.customOcrMinConfidence ?? CATEGORY_PRESETS.general.ocrMinConfidence,
      faceMatchMaxDistance:
        event.customFaceMatchMaxDistance ??
        CATEGORY_PRESETS.general.faceMatchMaxDistance,
    };
  }
  return CATEGORY_PRESETS[event.category];
}
