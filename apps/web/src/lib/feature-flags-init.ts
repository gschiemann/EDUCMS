/**
 * GrowthBook → OpenFeature Web provider + initialisation.
 *
 * Called once at app startup (apps/web/src/app/layout.tsx or similar).
 * If NEXT_PUBLIC_GROWTHBOOK_API_HOST / NEXT_PUBLIC_GROWTHBOOK_CLIENT_KEY are
 * not set, initialisation is skipped and feature-flags.ts falls back to the
 * legacy NEXT_PUBLIC_FF_* env-var switch automatically.
 */

'use client';

import {
  OpenFeature,
  Provider,
  ResolutionDetails,
  EvaluationContext,
  ProviderMetadata,
  StandardResolutionReasons,
  ErrorCode,
  Logger,
  JsonValue,
} from '@openfeature/web-sdk';
import { GrowthBook } from '@growthbook/growthbook';

// ---------------------------------------------------------------------------
// Thin GrowthBook → OpenFeature Web provider (synchronous evaluate)
// ---------------------------------------------------------------------------

class GrowthBookWebProvider implements Provider {
  readonly metadata: ProviderMetadata = { name: 'GrowthBook-Web' };
  readonly runsOn = 'client' as const;

  private gb: GrowthBook | null = null;

  constructor(
    private readonly apiHost: string,
    private readonly clientKey: string,
  ) {}

  async initialize(): Promise<void> {
    this.gb = new GrowthBook({
      apiHost: this.apiHost,
      clientKey: this.clientKey,
    });
    await this.gb.init({ streaming: false });
  }

  resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    _ctx: EvaluationContext,
    _logger: Logger,
  ): ResolutionDetails<boolean> {
    if (!this.gb) {
      return {
        value: defaultValue,
        reason: StandardResolutionReasons.DEFAULT,
        errorCode: ErrorCode.PROVIDER_NOT_READY,
      };
    }
    return {
      value: this.gb.isOn(flagKey),
      reason: StandardResolutionReasons.TARGETING_MATCH,
    };
  }

  resolveStringEvaluation(
    _flagKey: string,
    defaultValue: string,
    _ctx: EvaluationContext,
    _logger: Logger,
  ): ResolutionDetails<string> {
    return { value: defaultValue, reason: StandardResolutionReasons.DEFAULT };
  }

  resolveNumberEvaluation(
    _flagKey: string,
    defaultValue: number,
    _ctx: EvaluationContext,
    _logger: Logger,
  ): ResolutionDetails<number> {
    return { value: defaultValue, reason: StandardResolutionReasons.DEFAULT };
  }

  resolveObjectEvaluation<T extends JsonValue>(
    _flagKey: string,
    defaultValue: T,
    _ctx: EvaluationContext,
    _logger: Logger,
  ): ResolutionDetails<T> {
    return { value: defaultValue, reason: StandardResolutionReasons.DEFAULT };
  }
}

// ---------------------------------------------------------------------------
// Module-level state — initialise once per browser session
// ---------------------------------------------------------------------------

let _initPromise: Promise<void> | null = null;
let _providerReady = false;

export function isOpenFeatureReady(): boolean {
  return _providerReady;
}

export function getOpenFeatureClient() {
  return OpenFeature.getClient();
}

/**
 * Initialise the OpenFeature + GrowthBook provider.
 * Safe to call multiple times — subsequent calls return the cached promise.
 * Resolves immediately (with no provider) when env vars are absent.
 */
export function initFeatureFlags(): Promise<void> {
  if (_initPromise) return _initPromise;

  const apiHost = process.env.NEXT_PUBLIC_GROWTHBOOK_API_HOST;
  const clientKey = process.env.NEXT_PUBLIC_GROWTHBOOK_CLIENT_KEY;

  if (!apiHost || !clientKey) {
    // No GrowthBook config — stay on env-var fallback, no warning needed in browser
    _initPromise = Promise.resolve();
    return _initPromise;
  }

  _initPromise = OpenFeature.setProviderAndWait(
    new GrowthBookWebProvider(apiHost, clientKey),
  )
    .then(() => {
      _providerReady = true;
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.warn(
        '[FeatureFlags] GrowthBook web provider failed to initialise:',
        err,
        '— falling back to NEXT_PUBLIC_FF_* env vars.',
      );
    });

  return _initPromise;
}
