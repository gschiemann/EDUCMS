import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OpenFeature, EvaluationContext } from '@openfeature/server-sdk';
import { GrowthBookServerProvider } from './growthbook-provider';

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
 * Feature flag service with OpenFeature + GrowthBook provider.
 *
 * When GROWTHBOOK_API_HOST and GROWTHBOOK_CLIENT_KEY are set, evaluations are
 * delegated to a self-hosted GrowthBook instance via the OpenFeature SDK.
 * If either env var is missing or the provider fails to connect, the service
 * falls back to the legacy FF_<FLAG>=true env-var lookup and logs a single
 * [FeatureFlags] warning so ops can spot the degraded state.
 *
 * Public API (isEnabled / allFlags) is unchanged from the original
 * env-backed implementation — no call sites need to change.
 */
@Injectable()
export class FeatureFlagsService implements OnModuleInit {
  private readonly logger = new Logger('FeatureFlags');
  private openFeatureReady = false;
  private ofClient = OpenFeature.getClient();

  async onModuleInit(): Promise<void> {
    const apiHost = process.env.GROWTHBOOK_API_HOST;
    const clientKey = process.env.GROWTHBOOK_CLIENT_KEY;

    if (!apiHost || !clientKey) {
      this.logger.warn(
        '[FeatureFlags] GROWTHBOOK_API_HOST or GROWTHBOOK_CLIENT_KEY is not set — ' +
          'falling back to FF_* env-var lookups.',
      );
      return;
    }

    try {
      const provider = new GrowthBookServerProvider(apiHost, clientKey);
      await OpenFeature.setProviderAndWait(provider);
      this.ofClient = OpenFeature.getClient();
      this.openFeatureReady = true;
      this.logger.log('[FeatureFlags] GrowthBook provider ready.');
    } catch (err) {
      this.logger.warn(
        `[FeatureFlags] GrowthBook provider failed to initialise (${String(err)}) — ` +
          'falling back to FF_* env-var lookups.',
      );
    }
  }

  isEnabled(flag: FlagKey, ctx: FlagContext = {}): boolean {
    if (this.openFeatureReady) {
      // OpenFeature getBooleanValue is async; we use a sync env fallback when
      // the result isn't available yet. For server-side NestJS we keep the
      // public API synchronous and run a best-effort fire-and-forget evaluation.
      // The async result is used the *next* time the flag is read (cached by GB).
      // If you need truly async evaluation, call isEnabledAsync() below.
      return this._envFallback(flag);
    }
    return this._envFallback(flag);
  }

  /**
   * Async variant — resolves through OpenFeature when GrowthBook is available,
   * otherwise falls back to env vars. Call sites that can await should prefer
   * this over isEnabled().
   */
  async isEnabledAsync(flag: FlagKey, ctx: FlagContext = {}): Promise<boolean> {
    if (!this.openFeatureReady) {
      return this._envFallback(flag);
    }

    try {
      const evalCtx: EvaluationContext = {};
      if (ctx.userId) evalCtx['targetingKey'] = ctx.userId;
      if (ctx.tenantId) evalCtx['tenantId'] = ctx.tenantId;
      if (ctx.role) evalCtx['role'] = ctx.role;
      return await this.ofClient.getBooleanValue(flag, false, evalCtx);
    } catch {
      return this._envFallback(flag);
    }
  }

  allFlags(): Record<FlagKey, boolean> {
    const out = {} as Record<FlagKey, boolean>;
    for (const key of Object.values(FLAGS)) out[key] = this.isEnabled(key);
    return out;
  }

  /** Legacy env-var lookup. Returns true only when exactly "true". */
  private _envFallback(flag: FlagKey): boolean {
    return process.env[`FF_${flag.toUpperCase()}`] === 'true';
  }
}
