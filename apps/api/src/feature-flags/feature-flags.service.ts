import { Injectable, Logger } from '@nestjs/common';

export const FLAGS = {
  EMERGENCY_NEW_UI: 'emergency_new_ui',
  TEMPLATE_BUILDER_V2: 'template_builder_v2',
  SIS_INTEGRATION: 'sis_integration',
} as const;

export type FlagKey = (typeof FLAGS)[keyof typeof FLAGS];

export interface FlagContext {
  userId?: string;
  tenantId?: string;
  role?: string;
}

/**
 * Minimal env-backed feature flag service with an OpenFeature-shaped API.
 * Sprint 2 swaps the body for an @openfeature/server-sdk client pointed at
 * self-hosted GrowthBook — call sites don't change.
 */
@Injectable()
export class FeatureFlagsService {
  private readonly logger = new Logger('FeatureFlags');

  isEnabled(flag: FlagKey, _ctx: FlagContext = {}): boolean {
    const envName = `FF_${flag.toUpperCase()}`;
    return process.env[envName] === 'true';
  }

  allFlags(): Record<FlagKey, boolean> {
    const out = {} as Record<FlagKey, boolean>;
    for (const key of Object.values(FLAGS)) out[key] = this.isEnabled(key);
    return out;
  }
}
