/**
 * Thin GrowthBook → OpenFeature server provider.
 *
 * Uses GrowthBookClient (multi-user mode) to fetch features from the
 * GrowthBook API host and resolves flag values per-evaluation-context.
 *
 * Falls back to PROVIDER_NOT_READY if the env vars are absent so the
 * service can degrade to env-backed lookups.
 */

import {
  Provider,
  ResolutionDetails,
  EvaluationContext,
  ProviderMetadata,
  StandardResolutionReasons,
  ErrorCode,
  Logger,
  JsonValue,
} from '@openfeature/server-sdk';
import { GrowthBookClient } from '@growthbook/growthbook';

export class GrowthBookServerProvider implements Provider {
  readonly metadata: ProviderMetadata = { name: 'GrowthBook' };
  readonly runsOn = 'server' as const;

  private gbClient: GrowthBookClient | null = null;
  private ready = false;

  constructor(
    private readonly apiHost: string,
    private readonly clientKey: string,
  ) {}

  async initialize(): Promise<void> {
    this.gbClient = new GrowthBookClient({
      apiHost: this.apiHost,
      clientKey: this.clientKey,
    });
    await this.gbClient.init({ streaming: false });
    this.ready = true;
  }

  /** Map OpenFeature EvaluationContext to GrowthBook user attributes. */
  private buildAttributes(ctx: EvaluationContext): Record<string, string> {
    const attrs: Record<string, string> = {};
    if (ctx.targetingKey) attrs['id'] = ctx.targetingKey;
    if (typeof ctx['tenantId'] === 'string') attrs['tenantId'] = ctx['tenantId'];
    if (typeof ctx['role'] === 'string') attrs['role'] = ctx['role'];
    return attrs;
  }

  async resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    ctx: EvaluationContext,
    _logger: Logger,
  ): Promise<ResolutionDetails<boolean>> {
    if (!this.ready || !this.gbClient) {
      return {
        value: defaultValue,
        reason: StandardResolutionReasons.DEFAULT,
        errorCode: ErrorCode.PROVIDER_NOT_READY,
      };
    }

    try {
      const scoped = this.gbClient.createScopedInstance({
        attributes: this.buildAttributes(ctx),
      });
      const result = scoped.isOn(flagKey);
      return {
        value: result,
        reason: StandardResolutionReasons.TARGETING_MATCH,
      };
    } catch {
      return {
        value: defaultValue,
        reason: StandardResolutionReasons.ERROR,
        errorCode: ErrorCode.GENERAL,
      };
    }
  }

  // Required by Provider interface — flags are boolean-only in our schema
  async resolveStringEvaluation(
    _flagKey: string,
    defaultValue: string,
    _ctx: EvaluationContext,
    _logger: Logger,
  ): Promise<ResolutionDetails<string>> {
    return { value: defaultValue, reason: StandardResolutionReasons.DEFAULT };
  }

  async resolveNumberEvaluation(
    _flagKey: string,
    defaultValue: number,
    _ctx: EvaluationContext,
    _logger: Logger,
  ): Promise<ResolutionDetails<number>> {
    return { value: defaultValue, reason: StandardResolutionReasons.DEFAULT };
  }

  async resolveObjectEvaluation<T extends JsonValue>(
    _flagKey: string,
    defaultValue: T,
    _ctx: EvaluationContext,
    _logger: Logger,
  ): Promise<ResolutionDetails<T>> {
    return { value: defaultValue, reason: StandardResolutionReasons.DEFAULT };
  }
}
