/**
 * Catalog sync — turn the vendors' public model feeds into catalog state (2026-09-22). PURE: the
 * cron (ai-model-sync.cron.ts) does the fetching, the canary calls and the write; everything that
 * DECIDES is here, where the spec can pin it.
 *
 * SOURCES (both public, no key):
 *   * OpenRouter's model list — every current model from all three vendors, with release date,
 *     prices, output ceiling, image input and the reasoning/effort levels each model accepts.
 *   * LiteLLM's price table — an independent, community-maintained price list.
 * plus, when we hold a key for the vendor (always for Anthropic — the platform key), the vendor's
 * OWN model list, which is the only authority on whether an id is callable at all.
 *
 * RULES
 *   * A model enters the catalog only when BOTH feeds list it — one feed alone is a rumour.
 *   * Its price is the HIGHER of the two feeds' prices. Metering must never under-count, and a
 *     real price cut shows up in both feeds within days, so a cut still lands (the "cheaper model →
 *     more usage" outcome) — it just waits for agreement. A >10% disagreement is reported.
 *     (Seen on day one: OpenRouter listed gpt-5.6-sol at $2/$10; OpenAI and LiteLLM say $4/$20.)
 *   * A feed can move a SEED model's price and retirement date, never its request rules — those
 *     were verified by hand. A feed-only model gets the conservative request shape (no
 *     temperature) plus the effort levels the feed says it accepts; live 400s correct the rest.
 *   * A new model that would take over a tier is `unverified` until a live canary call on our key
 *     passes. Vendors we hold no key for keep it `unverified`; the dispatcher carries a verified
 *     fallback for the first real call, and a refusal marks it failed.
 *   * Every NEW general chat model (released in the last 60 days) that matches no family is
 *     REPORTED — a vendor that renamed a product line needs a family-pattern edit in Super Admin,
 *     and this is how a human finds out. Old one-offs and audio/search/image ids are not news.
 */
import type { AiProvider } from './ai-providers';
import {
  AI_TIERS,
  conservativeCaps,
  familyOf,
  ResolvedCatalog,
  SEED_MODELS,
  type AiTier,
  type CatalogModel,
  type CatalogState,
  type ModelCapabilities,
} from './ai-model-catalog';

export interface FeedModel {
  provider: AiProvider;
  id: string;
  label?: string;
  inputPer1M: number;
  outputPer1M: number;
  releasedAt?: string | null;
  retiresAt?: string | null;
  effortLevels?: string[];
  maxOutputTokens?: number | null;
  vision?: boolean;
}

const PROVIDERS: AiProvider[] = ['anthropic', 'openai', 'google'];

/**
 * Ids that are not general chat models — audio, realtime, search, image, embedding, coding-agent
 * and tool variants. They never belong in a text tier, so they are never "unassigned" news.
 */
const NON_CHAT_ID = /(audio|realtime|tts|transcribe|search|embed|image|moderation|customtools|codex|computer|deep-research|live|native)/i;
/** Only a model released this recently is news worth a human's attention in the sync report. */
const UNASSIGNED_NEWS_DAYS = 60;
const EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

function isoDate(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    const d = new Date(v < 10_000_000_000 ? v * 1000 : v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
}

function perMillion(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  const m = n * 1_000_000;
  return Math.round(m * 10_000) / 10_000; // $0.0001 precision, no float noise
}

/**
 * OpenRouter `/api/v1/models` → feed models for our three vendors. `:batch`/`:free` variants and
 * vendors we do not speak are dropped. Anthropic slugs use dots where the native ids use dashes
 * (claude-opus-5.5 ↔ claude-opus-5-5).
 */
export function parseOpenRouter(json: unknown): FeedModel[] {
  const data = (json as any)?.data;
  if (!Array.isArray(data)) return [];
  const out: FeedModel[] = [];
  for (const m of data) {
    const full = typeof m?.id === 'string' ? m.id : '';
    if (!full || full.includes(':')) continue;
    const [vendor, slug] = full.split('/', 2);
    const provider = vendor === 'anthropic' || vendor === 'openai' || vendor === 'google' ? (vendor as AiProvider) : null;
    if (!provider || !slug) continue;
    const id = provider === 'anthropic' ? slug.replace(/\./g, '-') : slug;
    const input = perMillion(m?.pricing?.prompt);
    const output = perMillion(m?.pricing?.completion);
    if (input == null || output == null || output === 0) continue;
    const efforts: string[] = Array.isArray(m?.reasoning?.supported_efforts)
      ? m.reasoning.supported_efforts.filter((e: unknown) => typeof e === 'string')
      : [];
    const name = typeof m?.name === 'string' ? m.name.replace(/^[^:]+:\s*/, '').trim() : '';
    out.push({
      provider,
      id,
      label: name || undefined,
      inputPer1M: input,
      outputPer1M: output,
      releasedAt: isoDate(m?.created),
      retiresAt: isoDate(m?.expiration_date),
      effortLevels: EFFORT_ORDER.filter((l) => efforts.includes(l)),
      maxOutputTokens: Number(m?.top_provider?.max_completion_tokens) || null,
      vision: Array.isArray(m?.architecture?.input_modalities) ? m.architecture.input_modalities.includes('image') : undefined,
    });
  }
  return out;
}

/** LiteLLM `model_prices_and_context_window.json` → feed models (chat mode only). */
export function parseLiteLlm(json: unknown): FeedModel[] {
  if (!json || typeof json !== 'object') return [];
  const out: FeedModel[] = [];
  for (const [key, v] of Object.entries(json as Record<string, any>)) {
    if (!v || typeof v !== 'object' || v.mode !== 'chat') continue;
    const lp = String(v.litellm_provider || '');
    let provider: AiProvider | null = null;
    let id = key;
    if (lp === 'anthropic') provider = 'anthropic';
    else if (lp === 'openai') provider = 'openai';
    else if (lp === 'gemini') {
      provider = 'google';
      id = key.replace(/^gemini\//, '');
    }
    if (!provider || id.includes('/') || id.includes(':')) continue;
    const input = perMillion(v.input_cost_per_token);
    const output = perMillion(v.output_cost_per_token);
    if (input == null || output == null || output === 0) continue;
    out.push({
      provider,
      id,
      inputPer1M: input,
      outputPer1M: output,
      retiresAt: isoDate(v.deprecation_date),
      maxOutputTokens: Number(v.max_output_tokens) || null,
      vision: v.supports_vision === true ? true : undefined,
    });
  }
  return out;
}

export interface SyncReport {
  at: string;
  /** Tier → model changes this sync caused, per vendor. */
  adopted: Array<{ provider: AiProvider; tier: AiTier; from: string; to: string }>;
  priceChanges: Array<{ provider: AiProvider; id: string; from: [number, number]; to: [number, number] }>;
  added: string[];
  /** Ids in both feeds that match no family — a renamed product line waiting for a pattern edit. */
  unassigned: string[];
  /** Feeds disagree by >10% on price (the higher price is used). */
  disagreements: Array<{ provider: AiProvider; id: string; openrouter: [number, number]; litellm: [number, number] }>;
  /** Tier picks that still need a live canary before they are trusted. */
  needsCanary: Array<{ provider: AiProvider; id: string }>;
  errors: string[];
}

function disagree(a: number, b: number): boolean {
  const hi = Math.max(a, b);
  return hi > 0 && Math.abs(a - b) / hi > 0.1;
}

/**
 * Merge the feeds into the next catalog state. `vendorIds` is the vendor's own model list when we
 * could read it (a model the vendor does not list for our key is skipped); undefined = unknown.
 */
export function mergeFeeds(args: {
  current: CatalogState;
  openrouter: FeedModel[];
  litellm: FeedModel[];
  vendorIds?: Partial<Record<AiProvider, Set<string>>>;
  now: Date;
}): { state: CatalogState; report: SyncReport } {
  const { current, openrouter, litellm, vendorIds, now } = args;
  const before = new ResolvedCatalog(current, () => now);
  const report: SyncReport = {
    at: now.toISOString(),
    adopted: [],
    priceChanges: [],
    added: [],
    unassigned: [],
    disagreements: [],
    needsCanary: [],
    errors: [],
  };

  const litellmBy = new Map(litellm.map((m) => [`${m.provider}:${m.id}`, m]));
  const existing = new Map((current.models || []).map((m) => [`${m.provider}:${m.id}`, m]));
  const seedBy = new Map(SEED_MODELS.map((m) => [`${m.provider}:${m.id}`, m]));
  const nextModels = new Map<string, CatalogModel>(existing);

  for (const or of openrouter) {
    const key = `${or.provider}:${or.id}`;
    const ll = litellmBy.get(key);
    if (!ll) continue; // one feed alone is a rumour
    const vendorList = vendorIds?.[or.provider];
    if (vendorList && !vendorList.has(or.id)) continue; // the vendor does not offer it to our key
    const fam = familyOf(or.provider, or.id, before.patterns);
    if (!fam && !seedBy.has(key)) {
      // Worth a human's attention only when it is a NEW general chat model — the signal that a
      // vendor renamed a product line (OpenAI went mini → luna/terra/sol in one generation). Old
      // one-offs and audio/search/image variants are not news.
      const released = or.releasedAt ? Date.parse(`${or.releasedAt}T00:00:00Z`) : NaN;
      const recent = Number.isFinite(released) && now.getTime() - released <= UNASSIGNED_NEWS_DAYS * 86_400_000;
      if (recent && !NON_CHAT_ID.test(or.id)) report.unassigned.push(key);
      continue;
    }
    if (disagree(or.inputPer1M, ll.inputPer1M) || disagree(or.outputPer1M, ll.outputPer1M)) {
      report.disagreements.push({
        provider: or.provider,
        id: or.id,
        openrouter: [or.inputPer1M, or.outputPer1M],
        litellm: [ll.inputPer1M, ll.outputPer1M],
      });
    }
    const inputPer1M = Math.max(or.inputPer1M, ll.inputPer1M);
    const outputPer1M = Math.max(or.outputPer1M, ll.outputPer1M);
    const retiresAt = or.retiresAt || ll.retiresAt || null;
    const prior = existing.get(key) || seedBy.get(key) || null;

    if (prior && (prior.inputPer1M !== inputPer1M || prior.outputPer1M !== outputPer1M)) {
      report.priceChanges.push({
        provider: or.provider,
        id: or.id,
        from: [prior.inputPer1M, prior.outputPer1M],
        to: [inputPer1M, outputPer1M],
      });
    }

    const caps: ModelCapabilities = prior?.caps
      ? prior.caps
      : {
          ...conservativeCaps(),
          effort:
            or.effortLevels && or.effortLevels.length
              ? or.provider === 'anthropic'
                ? 'anthropic-output-config'
                : or.provider === 'openai'
                  ? 'openai-reasoning-effort'
                  : 'gemini-thinking-level'
              : null,
          effortLevels: or.effortLevels || [],
          maxOutputTokens: or.maxOutputTokens ?? ll.maxOutputTokens ?? null,
          vision: or.vision === true || ll.vision === true,
        };

    const status = prior ? (prior.status === 'failed' ? 'unverified' : prior.status) : 'unverified';
    const model: CatalogModel = {
      provider: or.provider,
      id: or.id,
      label: prior?.label || or.label || or.id,
      family: fam?.family ?? null,
      version: fam?.version ?? [],
      releasedAt: prior?.releasedAt || or.releasedAt || null,
      inputPer1M,
      outputPer1M,
      caps,
      // A fresh sync is a fresh chance: a model that failed before is retried as unverified.
      status,
      retiresAt,
      source: seedBy.has(key) ? 'seed' : 'feed',
    };
    if (!prior) report.added.push(key);
    nextModels.set(key, model);
  }

  // The previous sync's failures are cleared — each sync re-tests from scratch.
  const failures = { ...(current.failures || {}) };
  for (const key of nextModels.keys()) delete failures[key];

  const state: CatalogState = { ...current, models: Array.from(nextModels.values()), failures };
  const after = new ResolvedCatalog(state, () => now);
  for (const provider of PROVIDERS) {
    for (const tier of AI_TIERS) {
      const from = before.resolveTier(provider, tier).model;
      const to = after.resolveTier(provider, tier).model;
      if (from.id !== to.id) report.adopted.push({ provider, tier, from: from.id, to: to.id });
      if (to.status === 'unverified' && !report.needsCanary.some((n) => n.provider === provider && n.id === to.id)) {
        report.needsCanary.push({ provider, id: to.id });
      }
    }
  }
  return { state, report };
}

/** Apply canary outcomes: pass → active, fail → failed (the tier falls back to the next version). */
export function applyCanaryResults(
  state: CatalogState,
  results: Array<{ provider: AiProvider; id: string; ok: boolean; error?: string }>,
  now: Date,
): CatalogState {
  const models = (state.models || []).map((m) => {
    const r = results.find((x) => x.provider === m.provider && x.id === m.id);
    if (!r) return m;
    return { ...m, status: r.ok ? ('active' as const) : ('failed' as const) };
  });
  const failures = { ...(state.failures || {}) };
  for (const r of results) {
    if (!r.ok) failures[`${r.provider}:${r.id}`] = { at: now.toISOString(), error: (r.error || 'canary failed').slice(0, 300) };
  }
  return { ...state, models, failures };
}
