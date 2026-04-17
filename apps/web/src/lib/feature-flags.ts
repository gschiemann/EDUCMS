import { isOpenFeatureReady, getOpenFeatureClient } from './feature-flags-init';

export const FLAGS = {
  EMERGENCY_NEW_UI: 'emergency_new_ui',
  TEMPLATE_BUILDER_V2: 'template_builder_v2',
  SIS_INTEGRATION: 'sis_integration',
} as const;

export type FlagKey = (typeof FLAGS)[keyof typeof FLAGS];

/**
 * Evaluate a feature flag.
 *
 * When the OpenFeature + GrowthBook provider has been initialised (via
 * `initFeatureFlags()` in layout.tsx), evaluation is delegated to the
 * provider so toggles take effect without a redeploy.
 *
 * When GrowthBook is not configured or not yet ready, falls back to the
 * legacy NEXT_PUBLIC_FF_* env-var switch (build-time values only).
 *
 * NOTE: The web-sdk client is synchronous — no awaiting needed.
 */
export function isFeatureEnabled(flag: FlagKey): boolean {
  if (isOpenFeatureReady()) {
    try {
      return getOpenFeatureClient().getBooleanValue(flag, false);
    } catch {
      // Defensive: fall through to env fallback
    }
  }

  // Legacy build-time fallback.
  // Next.js requires literal `process.env.NEXT_PUBLIC_*` reads at build time.
  switch (flag) {
    case FLAGS.EMERGENCY_NEW_UI:
      return process.env.NEXT_PUBLIC_FF_EMERGENCY_NEW_UI === 'true';
    case FLAGS.TEMPLATE_BUILDER_V2:
      return process.env.NEXT_PUBLIC_FF_TEMPLATE_BUILDER_V2 === 'true';
    case FLAGS.SIS_INTEGRATION:
      return process.env.NEXT_PUBLIC_FF_SIS_INTEGRATION === 'true';
    default:
      return false;
  }
}
