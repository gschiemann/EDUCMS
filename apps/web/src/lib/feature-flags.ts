import { isOpenFeatureReady, getOpenFeatureClient } from './feature-flags-init';

export const FLAGS = {
  EMERGENCY_NEW_UI: 'emergency_new_ui',
  TEMPLATE_BUILDER_V2: 'template_builder_v2',
  SIS_INTEGRATION: 'sis_integration',
  AUTO_BRANDING: 'auto_branding',
  SPORTS_PLAYER_STATS: 'sports_player_stats',
  SPORTS_RECORDS_MILESTONES: 'sports_records_milestones',
} as const;

export type FlagKey = (typeof FLAGS)[keyof typeof FLAGS];

// Intended default per flag when the provider doesn't define it. The builder
// + auto-branding are core/default-ON; if GrowthBook is ready but a flag is
// undefined there, `getBooleanValue(flag, false)` would wrongly return false
// (this once disabled the whole template builder). Default to the real intent.
const FLAG_DEFAULTS: Record<string, boolean> = {
  [FLAGS.TEMPLATE_BUILDER_V2]: true,
  [FLAGS.AUTO_BRANDING]: true,
  [FLAGS.EMERGENCY_NEW_UI]: false,
  [FLAGS.SIS_INTEGRATION]: false,
  [FLAGS.SPORTS_PLAYER_STATS]: false,
  [FLAGS.SPORTS_RECORDS_MILESTONES]: false,
};

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
  const intendedDefault = FLAG_DEFAULTS[flag] ?? false;
  if (isOpenFeatureReady()) {
    try {
      return getOpenFeatureClient().getBooleanValue(flag, intendedDefault);
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
      // ALWAYS ON — the builder is THE editing experience; every preset's
      // Customize button routes through it. The old `NEXT_PUBLIC_FF_..._V2`
      // kill-switch was a foot-gun: .env.example shipped it ='false', so any
      // environment seeded from the example silently disabled Customize — it
      // bounced straight back to the template list ("builder never launches").
      // Removed. To gate it in future, use GrowthBook (operator-toggleable),
      // not a build-time env var.
      return true;
    case FLAGS.SIS_INTEGRATION:
      return process.env.NEXT_PUBLIC_FF_SIS_INTEGRATION === 'true';
    case FLAGS.SPORTS_PLAYER_STATS:
      return process.env.NEXT_PUBLIC_FF_SPORTS_PLAYER_STATS === 'true';
    case FLAGS.SPORTS_RECORDS_MILESTONES:
      return process.env.NEXT_PUBLIC_FF_SPORTS_RECORDS_MILESTONES === 'true';
    case FLAGS.AUTO_BRANDING:
      // Default-on in development (NODE_ENV === 'development') so the
      // demo works out-of-the-box on localhost. Prod requires explicit opt-in.
      // Default ON in all environments (the demo headliner). Set
      // NEXT_PUBLIC_FF_AUTO_BRANDING=false on Vercel to disable.
      if (process.env.NEXT_PUBLIC_FF_AUTO_BRANDING === 'false') return false;
      return true;
    default:
      return false;
  }
}
