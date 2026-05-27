/**
 * HardwareRecommenderService — vertical → recommended hardware mapping.
 *
 * 2026-05-27 — Created so the Integration Concierge can top-pin a
 * hardware recommendation alongside its integration list. For a Sports
 * vertical tenant we recommend the Goodview EP6N (docs/EP6N_HARDWARE_
 * EVAL.md). For other verticals we currently return null — once we have
 * field data on what hardware wins per vertical we'll fill those in.
 *
 * Called from:
 *   - IntegrationsController to enrich discoverFromUrl / discoverFromDescription
 *     output with a hardware suggestion.
 *   - Future: per-vertical onboarding wizard's "Recommended hardware" step.
 *
 * NOTE: the canonical hardware catalog + per-vertical mapping lives in
 * `packages/api-types/src/hardware.ts` so the frontend reads from the
 * same source. This service is a thin wrapper that exposes it through
 * Nest's DI graph + provides shape-stable response DTOs.
 */
import { Injectable } from '@nestjs/common';
import {
  hardwareConciergeBlurb,
  HARDWARE_PRESENTATIONS,
  HardwareModel,
  HardwarePresentation,
  VERTICAL_RECOMMENDED_HARDWARE,
} from '@cms/api-types';

export interface RecommendedHardware {
  modelId: HardwareModel;
  name: string;
  manufacturer: string;
  blurb: string;
  /** Plain-English list of what this hardware is required for in this vertical. */
  requiredFor: string[];
  /** Order-this URL (or spec doc when no e-commerce link exists). */
  href: string;
  /** Standout capabilities — first 3 from the catalog highlights. */
  topHighlights: string[];
  /** Per-CLAUDE.md Concierge style — single short sentence the UI surfaces as a tooltip. */
  shortBlurb: string;
}

@Injectable()
export class HardwareRecommenderService {
  /**
   * Resolve the recommended hardware for a vertical, or null if no
   * recommendation has been baked in yet.
   */
  recommend(vertical: string | null | undefined): RecommendedHardware | null {
    if (!vertical) return null;
    const concierge = hardwareConciergeBlurb(vertical);
    if (!concierge) return null;
    const def: HardwarePresentation | undefined = HARDWARE_PRESENTATIONS[concierge.modelId];
    if (!def) return null;

    return {
      modelId: concierge.modelId,
      name: def.name,
      manufacturer: def.manufacturer,
      blurb: concierge.blurb,
      requiredFor: concierge.required_for,
      href: concierge.href,
      topHighlights: def.highlights.slice(0, 3),
      shortBlurb: def.blurb,
    };
  }

  /**
   * List the full hardware catalog. Used by the pair-screen "What
   * hardware?" picker so the frontend doesn't need to hard-code the
   * catalog.
   */
  catalog(): HardwarePresentation[] {
    return Object.values(HARDWARE_PRESENTATIONS);
  }

  /** Resolve a single model definition. */
  describe(modelId: string): HardwarePresentation | null {
    return HARDWARE_PRESENTATIONS[modelId as HardwareModel] || null;
  }

  /** Resolve the recommendation map verbatim, useful for diagnostic endpoints. */
  verticalMap(): Partial<Record<string, HardwareModel>> {
    return VERTICAL_RECOMMENDED_HARDWARE;
  }
}
