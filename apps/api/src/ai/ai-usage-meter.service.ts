/**
 * AI usage meter — one ledger row per provider call (2026-09-22).
 *
 * Every dispatch reports the tokens the provider says it used; this prices them at the catalog
 * rate of the model that served the call (`costMicros`, ai-model-catalog.ts) and appends a row to
 * `ai_usage_events`. Platform-key rows are what the included allowance sums
 * (ai-allowance.service.ts); BYOK rows are recorded too, so "what does AI actually cost" is one
 * query for any tenant, but they are never counted against the allowance.
 *
 * BEST-EFFORT BY DESIGN: a meter failure is logged and swallowed. It must never fail a generation
 * the provider already completed (and already billed us for) — the operator would lose the result
 * AND the spend would still have happened.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiAllowanceService } from './ai-allowance.service';
import { costMicros, type TokenUsage } from './ai-model-catalog';
import type { AiProvider } from './ai-providers';

export interface MeterEntry {
  tenantId: string;
  provider: AiProvider;
  /** Catalog id the request was sent as (what it is priced at). */
  model: string;
  source: 'platform' | 'tenant';
  /** Which surface spent it — 'designer', 'concierge', 'alt-text', … */
  feature: string;
  usage: TokenUsage | undefined;
  durationMs?: number;
}

@Injectable()
export class AiUsageMeterService {
  private readonly logger = new Logger(AiUsageMeterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly allowance: AiAllowanceService,
  ) {}

  /** Record one call. Returns the cost in micro-dollars (0 when nothing was billable). */
  async record(entry: MeterEntry): Promise<number> {
    const usage = entry.usage;
    if (!usage || (!usage.inputTokens && !usage.outputTokens && !usage.cacheReadTokens && !usage.cacheWriteTokens)) {
      return 0;
    }
    try {
      const micros = costMicros(entry.provider, entry.model, usage);
      const orgTenantId = await this.allowance.orgTenantIdFor(entry.tenantId);
      await this.prisma.client.aiUsageEvent.create({
        data: {
          tenantId: entry.tenantId,
          orgTenantId,
          feature: entry.feature.slice(0, 40),
          provider: entry.provider,
          model: entry.model.slice(0, 80),
          source: entry.source,
          inputTokens: clampInt(usage.inputTokens),
          outputTokens: clampInt(usage.outputTokens),
          cacheReadTokens: clampInt(usage.cacheReadTokens),
          cacheWriteTokens: clampInt(usage.cacheWriteTokens),
          costMicros: clampInt(micros),
          durationMs: entry.durationMs != null ? clampInt(entry.durationMs) : null,
        },
      });
      if (entry.source === 'platform') this.allowance.invalidate(orgTenantId);
      return micros;
    } catch (e: any) {
      this.logger.warn(`AI usage meter write failed (${entry.feature}, ${entry.provider}/${entry.model}): ${e?.message}`);
      return 0;
    }
  }
}

function clampInt(n: unknown): number {
  const v = Math.round(Number(n) || 0);
  return Math.max(0, Math.min(v, 2_000_000_000));
}
