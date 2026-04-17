export const FLAGS = {
  EMERGENCY_NEW_UI: 'emergency_new_ui',
  TEMPLATE_BUILDER_V2: 'template_builder_v2',
  SIS_INTEGRATION: 'sis_integration',
} as const;

export type FlagKey = (typeof FLAGS)[keyof typeof FLAGS];

/**
 * Read NEXT_PUBLIC_FF_<flag> from the build env. Flipping requires a redeploy
 * for now; Sprint 2 will switch to an API-driven client that caches the
 * `/api/v1/feature-flags` response so toggles take effect without rebuilds.
 */
export function isFeatureEnabled(flag: FlagKey): boolean {
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
