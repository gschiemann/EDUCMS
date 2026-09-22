/**
 * Daily AI model catalog sync (2026-09-22) — how new vendor releases reach production with no deploy.
 *
 * Once a day, leader-leased (two replicas must not both canary and both write): fetch the public
 * model feeds, merge them into the catalog (ai-model-sync.ts decides everything), run a tiny live
 * CANARY call on every new tier pick we hold a key for, and write the result. Every replica picks
 * the new state up within 5 minutes (ai-catalog-store.service.ts).
 *
 * The canary is the safety net that makes auto-adoption safe: a release the vendor listed but our
 * key cannot call, or whose request rules we do not know yet, fails HERE — a two-token "ping" —
 * and the tier stays on the previous version. Never on a customer's generation.
 *
 * `AI_MODEL_SYNC_DISABLED=1` stops it (the catalog then stays exactly where it is). A failed fetch
 * changes nothing: the sync writes only when both feeds were read.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { LEASE, LeaderLeaseService, leadThisTick } from '../realtime/leader-lease.service';
import { PrismaService } from '../prisma/prisma.service';
import { ensureSystemTenant, SYSTEM_TENANT_ID } from '../security/system-tenant';
import { AiCatalogStoreService } from './ai-catalog-store.service';
import { applyCanaryResults, mergeFeeds, parseLiteLlm, parseOpenRouter, type SyncReport } from './ai-model-sync';
import { dispatchAi, type AiProvider } from './ai-providers';
import { platformKeyFor } from './ai-platform-keys';
import type { CatalogState } from './ai-model-catalog';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const LITELLM_PRICES_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const FEED_TIMEOUT_MS = 20_000;
const FEED_MAX_BYTES = 12 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  const text = await res.text();
  if (text.length > FEED_MAX_BYTES) throw new Error(`${new URL(url).host} feed larger than ${FEED_MAX_BYTES} bytes`);
  return JSON.parse(text);
}

@Injectable()
export class AiModelSyncCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiModelSyncCron.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastRunDay = -1;

  constructor(
    private readonly store: AiCatalogStoreService,
    private readonly prisma: PrismaService,
    @Optional() private readonly lease?: LeaderLeaseService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test' || process.env.AI_MODEL_SYNC_DISABLED === '1') return;
    // Hourly wake, once-a-day run (the day bucket), so a restart never skips a day and a fleet of
    // restarts never runs it more than once.
    this.timer = setInterval(() => void this.tick(), 60 * 60_000);
    this.timer.unref?.();
    // First run shortly after boot, off the startup path.
    const first = setTimeout(() => void this.tick(), 2 * 60_000);
    first.unref?.();
    this.logger.log('AI model catalog sync scheduled (daily).');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    const day = Math.floor(Date.now() / DAY_MS);
    if (day === this.lastRunDay) return;
    const status = await leadThisTick(this.lease, LEASE.AI_MODEL_SYNC);
    if (!status.leader) return;
    this.lastRunDay = day;
    try {
      await this.runOnce('schedule');
    } catch (e: any) {
      this.logger.warn(`AI model sync failed: ${e?.message}`);
    }
  }

  /** One full sync. Public for Super Admin's "sync now". Returns the report (also stored). */
  async runOnce(trigger: 'schedule' | 'admin'): Promise<SyncReport> {
    if (this.running) throw new Error('A catalog sync is already running.');
    this.running = true;
    try {
      const [orJson, llJson] = await Promise.all([fetchJson(OPENROUTER_MODELS_URL), fetchJson(LITELLM_PRICES_URL)]);
      const openrouter = parseOpenRouter(orJson);
      const litellm = parseLiteLlm(llJson);
      if (openrouter.length < 20 || litellm.length < 20) {
        throw new Error(`feeds look truncated (openrouter ${openrouter.length}, litellm ${litellm.length}) — nothing changed`);
      }

      // The vendor's own list is the authority on "callable with our key" — read for every vendor
      // we hold a platform key for (Anthropic, and OpenAI once OPENAI_API_KEY is set).
      const vendorIds: Partial<Record<AiProvider, Set<string>>> = {};
      const anthropicKey = platformKeyFor('anthropic');
      if (anthropicKey) {
        try {
          const json: any = await fetchJson('https://api.anthropic.com/v1/models?limit=1000', {
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
          });
          const ids = (Array.isArray(json?.data) ? json.data : []).map((m: any) => String(m?.id || '')).filter(Boolean);
          if (ids.length) vendorIds.anthropic = new Set(ids);
        } catch (e: any) {
          this.logger.warn(`Anthropic model list unavailable (${e?.message}) — canaries still gate adoption.`);
        }
      }

      const openaiKey = platformKeyFor('openai');
      if (openaiKey) {
        try {
          const json: any = await fetchJson('https://api.openai.com/v1/models', { authorization: `Bearer ${openaiKey}` });
          const ids = (Array.isArray(json?.data) ? json.data : []).map((m: any) => String(m?.id || '')).filter(Boolean);
          if (ids.length) vendorIds.openai = new Set(ids);
        } catch (e: any) {
          this.logger.warn(`OpenAI model list unavailable (${e?.message}) — canaries still gate adoption.`);
        }
      }

      const { state: current } = await this.store.read();
      const { state: merged, report } = mergeFeeds({ current, openrouter, litellm, vendorIds, now: new Date() });

      // Canary every tier pick that is not yet verified, on a key we hold.
      const results: Array<{ provider: AiProvider; id: string; ok: boolean; error?: string }> = [];
      for (const pick of report.needsCanary) {
        const key = platformKeyFor(pick.provider);
        if (!key) continue; // stays unverified; the dispatcher's fallback covers the first real call
        try {
          const out = await dispatchAi(pick.provider, {
            apiKey: key,
            model: pick.id,
            job: 'fast',
            system: 'Reply with the single word ok.',
            userPrompt: 'ping',
            maxTokens: 16,
            timeoutMs: 60_000,
          });
          const ok = !out.errorStatus && out.model === pick.id && !out.failedModel;
          results.push({ provider: pick.provider, id: pick.id, ok, error: ok ? undefined : `${out.errorStatus}: ${(out.errorBody || '').slice(0, 200)}` });
        } catch (e: any) {
          results.push({ provider: pick.provider, id: pick.id, ok: false, error: e?.message || 'canary threw' });
        }
      }
      const withCanaries = applyCanaryResults(merged, results, new Date());
      const finalReport: SyncReport = {
        ...report,
        errors: [
          ...report.errors,
          ...results.filter((r) => !r.ok).map((r) => `canary ${r.provider}:${r.id} failed — ${r.error}`),
        ],
      };

      await this.store.update((s) => ({
        // Keep anything a super admin or live traffic wrote while we were fetching.
        ...s,
        models: withCanaries.models,
        failures: { ...(withCanaries.failures || {}), ...pickNewFailures(s, current) },
        lastSync: finalReport,
      } as CatalogState));

      await this.audit(finalReport, trigger);
      this.logger.log(
        `AI model sync (${trigger}): ${finalReport.adopted.length} tier change(s), ${finalReport.priceChanges.length} price change(s), ` +
          `${finalReport.added.length} new, ${finalReport.unassigned.length} unassigned, ${finalReport.errors.length} error(s).`,
      );
      return finalReport;
    } finally {
      this.running = false;
    }
  }

  private async audit(report: SyncReport, trigger: string): Promise<void> {
    try {
      await ensureSystemTenant(this.prisma.client as any);
      await this.prisma.client.auditLog.create({
        data: {
          action: 'AI_MODEL_CATALOG_SYNCED',
          targetType: 'ai-catalog',
          targetId: 'singleton',
          tenantId: SYSTEM_TENANT_ID,
          userId: null,
          details: JSON.stringify({
            trigger,
            adopted: report.adopted,
            priceChanges: report.priceChanges.slice(0, 40),
            added: report.added.slice(0, 40),
            unassigned: report.unassigned.slice(0, 40),
            disagreements: report.disagreements.slice(0, 20),
            errors: report.errors.slice(0, 20),
          }),
        },
      });
    } catch (e: any) {
      this.logger.warn(`AI model sync audit write failed: ${e?.message}`);
    }
  }
}

/** Failures live traffic recorded AFTER we read `before` — keep them through our write. */
function pickNewFailures(latest: CatalogState, before: CatalogState): Record<string, { at: string; error: string }> {
  const out: Record<string, { at: string; error: string }> = {};
  for (const [k, v] of Object.entries(latest.failures || {})) {
    if (!before.failures?.[k] || before.failures[k].at !== v.at) out[k] = v;
  }
  return out;
}
