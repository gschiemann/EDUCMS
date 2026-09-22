/**
 * AI model catalog — models, prices and request rules as DATA (2026-09-22).
 *
 * WHY. Greg (2026-09-22): "models get upgraded every month from every AI vendor so we need to be
 * built so that it auto upgrades our models without code changes... if a new cheaper better
 * version is released our system should take advantage and all of the sudden customers get more
 * usage because its cheaper for the same cost."
 *
 * Until today every model id, every price and every request rule was hard-coded — the catalog in
 * ai-providers.ts, `/^gemini-2\.5/`-style regexes in the dispatcher, a fixed `'claude-haiku-4-5'`
 * in the alt-text service — and a vendor release meant a code change. That is how the catalog
 * drifted a generation behind (gemini-2.5 defaults a month from shutdown; gpt-5 priced at 4× its
 * real rate), and how a new model family breaks every call on the first request (Claude 5 rejects
 * `temperature`; Gemini 3 takes `thinkingLevel`, not `thinkingBudget`).
 *
 * HOW IT WORKS NOW
 *   * Callers never name a model. They ask for a TIER (standard / balanced / premium) — or, on our
 *     own key, a JOB (fast / design) that maps to a tier — and the catalog answers with the NEWEST
 *     version in that tier's FAMILY (claude-haiku, gpt-sol, gemini-flash, …) that is not failed,
 *     not retiring and inside the tier's price ceiling.
 *   * A family is an id PATTERN, so when a vendor ships the next version (claude-opus-5-6,
 *     gpt-5.7-sol, gemini-3.9-flash) it is picked up by the daily sync (ai-model-sync.cron.ts)
 *     from the public model feeds, canary-tested, and adopted — no deploy.
 *   * Every request parameter that differs between models (temperature, the effort/thinking knob
 *     and its allowed values, output ceilings) is a CAPABILITY on the model entry. The dispatcher
 *     reads capabilities; it never pattern-matches ids. A model we learned about from a feed and
 *     have no verified rules for gets the conservative shape (no temperature — omitting it is
 *     always valid), and a provider 400 that names a parameter is retried once without it and the
 *     lesson is recorded (see `learnCapability`).
 *   * Prices are data too. Usage is metered in dollars at the price of the model that actually
 *     served the call, so a cheaper release stretches every customer's included allowance on the
 *     day it is adopted — the exact outcome Greg asked for.
 *
 * WHAT STILL NEEDS A HUMAN: a vendor that RENAMES a tier (OpenAI went mini → luna/terra/sol in one
 * generation) needs its family pattern updated — that is a catalog-state edit in Super Admin, not a
 * deploy, and the sync lists every new model that matched no family so nobody has to go looking.
 *
 * This file is PURE (no Nest, no Prisma, no network) so every rule is unit-testable. State lives in
 * the `ai_catalog_state` row (ai-catalog-store.service.ts) and is loaded into the process-wide
 * catalog with `setCatalogState`; a fresh database, a failed sync or an unreachable feed leaves the
 * SEED below in charge, which is itself a complete, verified lineup.
 */
import type { AiProvider } from './ai-providers';
import type { SyncReport } from './ai-model-sync';

export type AiTier = 'standard' | 'balanced' | 'premium';
export const AI_TIERS: readonly AiTier[] = ['standard', 'balanced', 'premium'];

/**
 * What a platform-key call is FOR. `fast` = conversation, extraction, captions, short copy — the
 * provider's cheapest good model. `design` = a full board — where the money should go.
 */
export type AiJob = 'fast' | 'design';

/** How a model expresses "how hard to think". null = the model has no such knob. */
export type EffortStyle =
  | 'anthropic-output-config' // Messages API `output_config: { effort }` (Claude Opus 4.6+, Sonnet 4.6+, Claude 5)
  | 'openai-reasoning-effort' // Chat Completions `reasoning_effort` (gpt-5*, gpt-6*, o-series)
  | 'gemini-thinking-level'; // generateContent `generationConfig.thinkingConfig.thinkingLevel` (Gemini 3.x)

export interface ModelCapabilities {
  /**
   * Send an explicit `temperature`? Claude 5 and OpenAI reasoning models REJECT it (400), Gemini 3
   * guidance is to leave it at the default. Omitting it is valid on every model, so anything we
   * have not verified defaults to false.
   */
  temperature: boolean;
  effort: EffortStyle | null;
  /** Allowed effort values, in the provider's words ('low', 'medium', 'none', 'minimal', …). */
  effortLevels: string[];
  /**
   * Thinking/reasoning tokens are produced on (at least some) calls and count against the output
   * ceiling — the request must carry headroom above the visible budget or the reply comes back
   * empty (the 2026-06-28 gpt-5 and gemini-2.5 empty-reply incidents).
   */
  reasoning: boolean;
  /** Provider max output tokens for one call (null = unknown; do not clamp). */
  maxOutputTokens: number | null;
  /** Accepts image input (alt text, "Upload a look"). */
  vision: boolean;
}

export type CatalogModelStatus = 'active' | 'unverified' | 'failed' | 'retired';

export interface CatalogModel {
  provider: AiProvider;
  /** Wire id sent to the provider, verbatim. */
  id: string;
  /** Operator-facing name ("Claude Opus 5.5"). */
  label: string;
  /** Family this id belongs to (derived from FAMILY_PATTERNS), or null for a one-off. */
  family: string | null;
  /** Numeric version parsed from the id — orders versions inside a family. */
  version: number[];
  /** Vendor release date (ISO date) when known; tie-breaker after version. */
  releasedAt: string | null;
  /** USD per 1M input tokens. */
  inputPer1M: number;
  /** USD per 1M output tokens (thinking tokens bill as output). */
  outputPer1M: number;
  caps: ModelCapabilities;
  /**
   * active     — verified: seed entry, or a feed model that passed a live canary call.
   * unverified — seen in the feeds but never called (no platform key for that provider). Eligible,
   *              because the dispatcher carries a fallback to a verified model for the first call.
   * failed     — the provider refused it (404 / model-invalid); skipped until the next sync clears it.
   * retired    — past its provider shutdown date.
   */
  status: CatalogModelStatus;
  /** Provider shutdown date (ISO date) when announced. */
  retiresAt: string | null;
  source: 'seed' | 'feed';
}

// ─── Families ────────────────────────────────────────────────────────────────────────────────
/**
 * A family is every version of ONE product line. Patterns are anchored so dated snapshots
 * (`claude-opus-4-5-20251101`), `-pro`/`-codex`/`-image` variants and `:batch` ids never qualify —
 * only the vendor's own evergreen alias for each version does. Capture groups are the version.
 */
export interface FamilyPattern {
  provider: AiProvider;
  family: string;
  /** RegExp source, anchored; groups = version components. Kept as a string so state can override it. */
  pattern: string;
}

export const DEFAULT_FAMILY_PATTERNS: FamilyPattern[] = [
  { provider: 'anthropic', family: 'claude-haiku', pattern: '^claude-haiku-(\\d+)(?:-(\\d{1,2}))?$' },
  { provider: 'anthropic', family: 'claude-sonnet', pattern: '^claude-sonnet-(\\d+)(?:-(\\d{1,2}))?$' },
  { provider: 'anthropic', family: 'claude-opus', pattern: '^claude-opus-(\\d+)(?:-(\\d{1,2}))?$' },
  { provider: 'anthropic', family: 'claude-fable', pattern: '^claude-fable-(\\d+)(?:-(\\d{1,2}))?$' },
  { provider: 'openai', family: 'gpt-luna', pattern: '^gpt-(\\d+)(?:\\.(\\d+))?-luna$' },
  { provider: 'openai', family: 'gpt-terra', pattern: '^gpt-(\\d+)(?:\\.(\\d+))?-terra$' },
  { provider: 'openai', family: 'gpt-sol', pattern: '^gpt-(\\d+)(?:\\.(\\d+))?-sol$' },
  { provider: 'openai', family: 'gpt-astra', pattern: '^gpt-(\\d+)(?:\\.(\\d+))?-astra$' },
  { provider: 'openai', family: 'gpt-mini', pattern: '^gpt-(\\d+)(?:\\.(\\d+))?-mini$' },
  { provider: 'google', family: 'gemini-flash-lite', pattern: '^gemini-(\\d+)(?:\\.(\\d+))?-flash-lite$' },
  { provider: 'google', family: 'gemini-flash', pattern: '^gemini-(\\d+)(?:\\.(\\d+))?-flash$' },
  { provider: 'google', family: 'gemini-pro', pattern: '^gemini-(\\d+)(?:\\.(\\d+))?-pro(?:-preview)?$' },
];

/**
 * Which family serves each tier. Consistent envelopes across vendors (the 2026-05-25 rule: an
 * operator picking "Standard" gets comparable cost/quality whichever vendor they are on).
 */
export const DEFAULT_TIER_FAMILIES: Record<AiProvider, Record<AiTier, string>> = {
  anthropic: { standard: 'claude-haiku', balanced: 'claude-sonnet', premium: 'claude-opus' },
  openai: { standard: 'gpt-luna', balanced: 'gpt-terra', premium: 'gpt-sol' },
  google: { standard: 'gemini-flash-lite', balanced: 'gemini-flash', premium: 'gemini-pro' },
};

/**
 * Price ceilings (USD per 1M OUTPUT tokens) a newer version must fit under to be adopted
 * AUTOMATICALLY. A cheaper or same-price release is adopted the day it appears; a release that
 * costs more than the tier's envelope is listed in the sync report and waits for a human.
 */
export const DEFAULT_TIER_CEILINGS: Record<AiTier, number> = {
  standard: 6,
  balanced: 15,
  premium: 25,
};

/** Where a job runs on OUR key: a vendor, and a tier in that vendor's lineup. */
export interface PlatformRoute {
  provider: AiProvider;
  tier: AiTier;
}

/**
 * Our key's routing per job, in PREFERENCE ORDER: the first route whose vendor we hold a platform
 * key for wins (ai-platform-keys.ts), so a deploy is never stuck on a vendor it has no key for.
 *
 *   fast   → Anthropic Standard (Claude Haiku 4.5) — conversation, extraction, captions, copy.
 *   design → OpenAI Premium (GPT-6 Sol) — Greg, 2026-09-22: "for template generation we need a bad
 *            ass model, lets use the SOL 6 now" — then Google Premium. NO Anthropic route: Greg,
 *            the same day: "claude is a fucking piece of shit when it comes to anything design so
 *            i dont want that touching shit". A deploy with neither key has no board design on our
 *            key at all (AI_DESIGN_UNAVAILABLE) rather than a silent fall back to Claude.
 *
 * Super Admin rewrites the list (`platformRoutes`) with no deploy; an owner who deliberately puts
 * Anthropic on the design list gets it, but nothing adds it by default.
 */
export const DEFAULT_PLATFORM_ROUTES: Record<AiJob, PlatformRoute[]> = {
  fast: [
    { provider: 'anthropic', tier: 'standard' },
    { provider: 'openai', tier: 'standard' },
    { provider: 'google', tier: 'standard' },
  ],
  design: [
    { provider: 'openai', tier: 'premium' },
    { provider: 'google', tier: 'premium' },
  ],
};

/**
 * Image models, best first. Image generation runs only on a tenant's OWN OpenAI/Google key, so
 * this is their cost — the order is quality first, and each entry falls through to the next when
 * the account cannot use it (org gating, a model the vendor has not opened to them yet).
 * Overridable in Super Admin (`imageModels`) with no deploy.
 */
export const DEFAULT_IMAGE_MODELS: Record<'openai' | 'google', string[]> = {
  openai: ['gpt-image-2.5-sunburst', 'gpt-image-2', 'gpt-image-1'],
  google: ['gemini-3.1-flash-image'],
};

/** Effort per job where the model has the knob. `low` is valid on every effort model we know. */
export const DEFAULT_JOB_EFFORT: Record<AiJob, string> = {
  fast: 'low',
  design: 'low',
};

// ─── Seed ─────────────────────────────────────────────────────────────────────────────────────
// Verified 2026-09-22 against the vendors' own pages (platform.claude.com effort + Opus 5.5
// migration guide; OpenAI pricing; ai.google.dev pricing + Gemini 3 guide) and cross-checked
// against both public price feeds the sync reads (LiteLLM + OpenRouter). Where the feeds
// disagreed (OpenRouter lists gpt-5.6-sol at $2/$10; OpenAI and LiteLLM say $4/$20) the vendor
// wins — and the sync applies the same rule: two feeds must agree before a price moves.

const CLAUDE5_CAPS: ModelCapabilities = {
  temperature: false,
  effort: 'anthropic-output-config',
  effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  reasoning: true,
  maxOutputTokens: 128_000,
  vision: true,
};

const OPENAI_REASONING_CAPS: ModelCapabilities = {
  temperature: false,
  effort: 'openai-reasoning-effort',
  effortLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  reasoning: true,
  maxOutputTokens: 128_000,
  vision: true,
};

const GEMINI3_CAPS: ModelCapabilities = {
  temperature: false,
  effort: 'gemini-thinking-level',
  effortLevels: ['low', 'medium', 'high'],
  reasoning: true,
  maxOutputTokens: 65_536,
  vision: true,
};

function seed(
  provider: AiProvider,
  id: string,
  label: string,
  releasedAt: string,
  inputPer1M: number,
  outputPer1M: number,
  caps: ModelCapabilities,
): CatalogModel {
  const fam = familyOf(provider, id, DEFAULT_FAMILY_PATTERNS);
  return {
    provider,
    id,
    label,
    family: fam?.family ?? null,
    version: fam?.version ?? [],
    releasedAt,
    inputPer1M,
    outputPer1M,
    caps,
    status: 'active',
    retiresAt: null,
    source: 'seed',
  };
}

export const SEED_MODELS: CatalogModel[] = [
  // Anthropic
  seed('anthropic', 'claude-haiku-4-5', 'Claude Haiku 4.5', '2025-10-15', 1.0, 5.0, {
    temperature: true,
    effort: null, // effort is not supported on Haiku 4.5 (platform.claude.com/…/effort, supportedModels)
    effortLevels: [],
    reasoning: false,
    maxOutputTokens: 64_000,
    vision: true,
  }),
  seed('anthropic', 'claude-sonnet-5', 'Claude Sonnet 5', '2026-06-30', 2.0, 10.0, CLAUDE5_CAPS),
  seed('anthropic', 'claude-opus-5-5', 'Claude Opus 5.5', '2026-09-21', 4.0, 20.0, CLAUDE5_CAPS),
  seed('anthropic', 'claude-fable-5-1', 'Claude Fable 5.1', '2026-08-31', 10.0, 50.0, CLAUDE5_CAPS),
  // OpenAI — every current model is a reasoning model; gpt-4o-mini stays as the no-reasoning
  // cheap option a super admin can pin, and as the alt-text fallback.
  seed('openai', 'gpt-5.6-luna', 'GPT-5.6 Luna', '2026-07-09', 0.2, 1.2, OPENAI_REASONING_CAPS),
  seed('openai', 'gpt-5.6-terra', 'GPT-5.6 Terra', '2026-07-09', 2.0, 12.0, OPENAI_REASONING_CAPS),
  seed('openai', 'gpt-5.6-sol', 'GPT-5.6 Sol', '2026-07-09', 4.0, 20.0, OPENAI_REASONING_CAPS),
  // GPT-6 Sol + Luna — released 2026-09-22 and adopted by production's first sync 40 minutes
  // later; seeded the same day from OpenAI's own docs (developers.openai.com model pages + pricing:
  // Chat Completions supported, max_completion_tokens, reasoning_effort none…max with default
  // medium, temperature only at effort 'none', image input, 128k max output). Sol $2/$10, Luna
  // $0.10/$0.50 — half the price of the 5.6 models they succeed.
  seed('openai', 'gpt-6-sol', 'GPT-6 Sol', '2026-09-22', 2.0, 10.0, OPENAI_REASONING_CAPS),
  seed('openai', 'gpt-6-luna', 'GPT-6 Luna', '2026-09-22', 0.1, 0.5, OPENAI_REASONING_CAPS),
  seed('openai', 'gpt-6-astra', 'GPT-6 Astra', '2026-09-03', 10.0, 50.0, {
    ...OPENAI_REASONING_CAPS,
    effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], // reasoning is mandatory — no 'none'
  }),
  seed('openai', 'gpt-4o-mini', 'GPT-4o mini', '2024-07-18', 0.15, 0.6, {
    temperature: true,
    effort: null,
    effortLevels: [],
    reasoning: false,
    maxOutputTokens: 16_384,
    vision: true,
  }),
  // Google — the 2.5 family is access-limited and shuts down 2026-10-16; it is deliberately NOT
  // sendable any more (a saved 2.5 choice heals forward — ai-legacy-models.ts).
  seed('google', 'gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite', '2026-07-21', 0.3, 2.5, {
    ...GEMINI3_CAPS,
    effortLevels: ['minimal', 'low', 'medium', 'high'],
  }),
  seed('google', 'gemini-3.8-flash', 'Gemini 3.8 Flash', '2026-09-02', 0.75, 3.75, GEMINI3_CAPS),
  seed('google', 'gemini-3.1-pro-preview', 'Gemini 3.1 Pro (preview)', '2026-02-19', 2.0, 12.0, GEMINI3_CAPS),
];

// ─── State ────────────────────────────────────────────────────────────────────────────────────
/**
 * Everything that can change WITHOUT a deploy. Persisted as one JSON document
 * (`ai_catalog_state.state`); every field is optional so an empty `{}` means "seed defaults".
 */
export interface CatalogState {
  /** Models learned from the feeds, plus price/status updates to seed models. Keyed provider:id. */
  models?: CatalogModel[];
  familyPatterns?: FamilyPattern[];
  tierFamilies?: Partial<Record<AiProvider, Partial<Record<AiTier, string>>>>;
  tierCeilings?: Partial<Record<AiTier, number>>;
  /** Our key's routing per job, preference order (see DEFAULT_PLATFORM_ROUTES). */
  platformRoutes?: Partial<Record<AiJob, PlatformRoute[]>>;
  /**
   * LEGACY (first release of 2026-09-22): the tier a job ran on when our key was Anthropic-only.
   * Still honoured when `platformRoutes` has no entry for that job — read as Anthropic at that tier.
   */
  platformJobs?: Partial<Record<AiJob, AiTier>>;
  jobEffort?: Partial<Record<AiJob, string>>;
  /** Super-admin pins: provider → tier → model id. A pin beats "newest in family". */
  pins?: Partial<Record<AiProvider, Partial<Record<AiTier, string>>>>;
  /** Image model preference per vendor, best first (see DEFAULT_IMAGE_MODELS). */
  imageModels?: Partial<Record<'openai' | 'google', string[]>>;
  /** Capability corrections learned from live provider errors, keyed provider:id. */
  learnedCaps?: Record<string, Partial<ModelCapabilities>>;
  /** Models the provider refused, keyed provider:id → { at, error }. Cleared by the next good sync. */
  failures?: Record<string, { at: string; error: string }>;
  /** What the last daily sync did (ai-model-sync.cron.ts) — shown in Super Admin. */
  lastSync?: SyncReport;
}

export function modelKey(provider: AiProvider, id: string): string {
  return `${provider}:${id}`;
}

/** Parse which family (if any) an id belongs to, and its version. */
export function familyOf(
  provider: AiProvider,
  id: string,
  patterns: FamilyPattern[],
): { family: string; version: number[] } | null {
  for (const p of patterns) {
    if (p.provider !== provider) continue;
    let re: RegExp;
    try {
      re = new RegExp(p.pattern);
    } catch {
      continue; // a malformed admin-supplied pattern must never take the dispatcher down
    }
    const m = re.exec(id);
    if (!m) continue;
    const version = m
      .slice(1)
      .filter((g) => g !== undefined && g !== '')
      .map((g) => Number(g))
      .filter((n) => Number.isFinite(n));
    return { family: p.family, version };
  }
  return null;
}

/** Compare two version arrays (missing components = 0). Positive when a > b. */
export function compareVersions(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * The merged, resolved view of seed + state. Built once per state change; every lookup after that
 * is a Map read. Immutable — `setCatalogState` swaps the whole object.
 */
export class ResolvedCatalog {
  readonly models = new Map<string, CatalogModel>();
  readonly patterns: FamilyPattern[];
  readonly tierFamilies: Record<AiProvider, Record<AiTier, string>>;
  readonly tierCeilings: Record<AiTier, number>;
  readonly platformRoutes: Record<AiJob, PlatformRoute[]>;
  readonly jobEffort: Record<AiJob, string>;
  readonly pins: Partial<Record<AiProvider, Partial<Record<AiTier, string>>>>;

  constructor(readonly state: CatalogState = {}, private readonly now: () => Date = () => new Date()) {
    this.patterns = state.familyPatterns?.length ? state.familyPatterns : DEFAULT_FAMILY_PATTERNS;
    this.tierFamilies = {
      anthropic: { ...DEFAULT_TIER_FAMILIES.anthropic, ...(state.tierFamilies?.anthropic || {}) },
      openai: { ...DEFAULT_TIER_FAMILIES.openai, ...(state.tierFamilies?.openai || {}) },
      google: { ...DEFAULT_TIER_FAMILIES.google, ...(state.tierFamilies?.google || {}) },
    };
    this.tierCeilings = { ...DEFAULT_TIER_CEILINGS, ...(state.tierCeilings || {}) };
    this.platformRoutes = {
      fast: routesFromState(state, 'fast'),
      design: routesFromState(state, 'design'),
    };
    this.jobEffort = { ...DEFAULT_JOB_EFFORT, ...(state.jobEffort || {}) };
    this.pins = state.pins || {};

    for (const m of SEED_MODELS) this.models.set(modelKey(m.provider, m.id), { ...m, caps: { ...m.caps } });
    for (const m of state.models || []) {
      if (!m || !m.provider || !m.id || !isFinitePrice(m.inputPer1M) || !isFinitePrice(m.outputPer1M)) continue;
      const key = modelKey(m.provider, m.id);
      const prev = this.models.get(key);
      const fam = familyOf(m.provider, m.id, this.patterns);
      this.models.set(key, {
        ...(prev || {}),
        ...m,
        // A seed model keeps its verified request rules; a feed can move its price and status only.
        caps: prev?.source === 'seed' ? prev.caps : { ...(m.caps || conservativeCaps()) },
        source: prev?.source === 'seed' ? 'seed' : m.source || 'feed',
        family: fam?.family ?? null,
        version: fam?.version ?? [],
      } as CatalogModel);
    }
    for (const [key, learned] of Object.entries(state.learnedCaps || {})) {
      const m = this.models.get(key);
      if (m) this.models.set(key, { ...m, caps: { ...m.caps, ...learned } });
    }
    for (const [key, f] of Object.entries(state.failures || {})) {
      const m = this.models.get(key);
      if (m && f) this.models.set(key, { ...m, status: 'failed' });
    }
  }

  /** Image models to try for a vendor, best first. */
  imageModels(provider: 'openai' | 'google'): string[] {
    const fromState = this.state.imageModels?.[provider];
    const list = Array.isArray(fromState) ? fromState.filter((m) => typeof m === 'string' && m.trim()) : [];
    return list.length ? list : DEFAULT_IMAGE_MODELS[provider];
  }

  get(provider: AiProvider, id: string): CatalogModel | null {
    return this.models.get(modelKey(provider, id)) || null;
  }

  list(provider?: AiProvider): CatalogModel[] {
    const all = Array.from(this.models.values());
    return provider ? all.filter((m) => m.provider === provider) : all;
  }

  /** Could this model be SENT right now? (Known, not failed, not past its shutdown date.) */
  isUsable(m: CatalogModel | null): m is CatalogModel {
    if (!m) return false;
    if (m.status === 'failed' || m.status === 'retired') return false;
    if (m.retiresAt) {
      const cutoff = Date.parse(`${m.retiresAt}T00:00:00Z`);
      // Stop routing to a model two weeks BEFORE its shutdown — never ride one to the wire.
      if (Number.isFinite(cutoff) && cutoff - this.now().getTime() < 14 * 86_400_000) return false;
    }
    return true;
  }

  /**
   * Every model eligible to serve a tier, best first: the tier's family, usable, inside the
   * price ceiling; highest version, then newest release, then cheapest.
   */
  tierCandidates(provider: AiProvider, tier: AiTier): CatalogModel[] {
    const family = this.tierFamilies[provider]?.[tier];
    const ceiling = this.tierCeilings[tier];
    return this.list(provider)
      .filter((m) => m.family === family && this.isUsable(m) && m.outputPer1M <= ceiling)
      .sort(
        (a, b) =>
          compareVersions(b.version, a.version) ||
          (b.releasedAt || '').localeCompare(a.releasedAt || '') ||
          a.outputPer1M - b.outputPer1M,
      );
  }

  /**
   * The model for a tier, plus a verified FALLBACK for the dispatcher to use if the provider
   * refuses the first choice (a brand-new id our key cannot see yet, a preview pulled early).
   */
  resolveTier(provider: AiProvider, tier: AiTier): { model: CatalogModel; fallback: CatalogModel | null } {
    const pinnedId = this.pins[provider]?.[tier];
    const pinned = pinnedId ? this.get(provider, pinnedId) : null;
    const candidates = this.tierCandidates(provider, tier);
    const verified = candidates.filter((m) => m.status === 'active');
    let model: CatalogModel | null = this.isUsable(pinned) ? pinned : candidates[0] || null;
    if (!model) {
      // Nothing in the family qualifies (admin broke a pattern, every version failed): fall back
      // to the seed's model for this tier so a call is still possible. Never throws.
      model = seedModelForTier(provider, tier);
    }
    // Fallback, in order: another VERIFIED version in the same family (the previous release when
    // a new one was just adopted); the tier's seed model; then a neighbouring tier's model — so a
    // refused model degrades a board to a cheaper model instead of failing it outright.
    const chosen = model;
    const sameFamily = verified.find((m) => m.id !== chosen.id);
    const seedSame = seedModelForTier(provider, tier);
    let fallback: CatalogModel | null = sameFamily || (seedSame.id !== chosen.id ? seedSame : null);
    if (!fallback) {
      for (const other of FALLBACK_TIERS[tier]) {
        const alt =
          this.tierCandidates(provider, other).find((m) => m.status === 'active' && m.id !== chosen.id) ||
          seedModelForTier(provider, other);
        if (alt && alt.id !== chosen.id && this.isUsable(alt)) {
          fallback = alt;
          break;
        }
      }
    }
    return { model, fallback };
  }

  /**
   * The route a job takes on OUR key: the first in its preference list whose vendor we hold a key
   * for. null only when we hold no platform key at all.
   */
  routeForJob(job: AiJob, hasPlatformKey: (provider: AiProvider) => boolean): PlatformRoute | null {
    for (const r of this.platformRoutes[job]) {
      if (hasPlatformKey(r.provider)) return r;
    }
    return null;
  }

  /** The effort level to send for a job, clamped to what the model accepts (null = send none). */
  effortFor(model: CatalogModel, job: AiJob): string | null {
    if (!model.caps.effort || model.caps.effortLevels.length === 0) return null;
    const wanted = this.jobEffort[job] || DEFAULT_JOB_EFFORT[job];
    if (model.caps.effortLevels.includes(wanted)) return wanted;
    // The wanted level is not offered (e.g. 'low' on a model whose floor is 'medium'): take the
    // CHEAPEST level the model does offer, in the order vendors use.
    const order = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
    const offered = order.filter((l) => model.caps.effortLevels.includes(l));
    return offered[0] ?? null;
  }
}

const PROVIDERS_ORDER: AiProvider[] = ['anthropic', 'openai', 'google'];

function isRoute(r: unknown): r is PlatformRoute {
  const x = r as PlatformRoute;
  return (
    !!x &&
    PROVIDERS_ORDER.includes(x.provider) &&
    (x.tier === 'standard' || x.tier === 'balanced' || x.tier === 'premium')
  );
}

/**
 * A job's route list from state: an explicit `platformRoutes` entry wins; the legacy tier-only
 * `platformJobs` entry reads as Anthropic at that tier, ahead of the defaults — for the FAST job
 * only (design never runs on Claude unless an owner explicitly lists it); else the defaults.
 * Every list is completed with the default routes for vendors it does not mention, so a list
 * naming one vendor still falls through to the others when that vendor has no key.
 */
function routesFromState(state: CatalogState, job: AiJob): PlatformRoute[] {
  const explicit = state.platformRoutes?.[job];
  let head: PlatformRoute[] = [];
  if (Array.isArray(explicit) && explicit.some(isRoute)) {
    head = explicit.filter(isRoute);
  } else if (job === 'fast' && state.platformJobs?.[job]) {
    const legacyTier = state.platformJobs[job] as AiTier;
    head = isRoute({ provider: 'anthropic', tier: legacyTier }) ? [{ provider: 'anthropic', tier: legacyTier }] : [];
  }
  const out: PlatformRoute[] = [];
  for (const r of [...head, ...DEFAULT_PLATFORM_ROUTES[job]]) {
    if (!out.some((o) => o.provider === r.provider)) out.push({ provider: r.provider, tier: r.tier });
  }
  return out;
}

function isFinitePrice(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n < 10_000;
}

/** The request shape for a model nobody has verified: nothing optional, effort left at default. */
export function conservativeCaps(): ModelCapabilities {
  return {
    temperature: false,
    effort: null,
    effortLevels: [],
    reasoning: true, // assume thinking may happen → always carry headroom
    maxOutputTokens: null,
    vision: false,
  };
}

/** Where a refused model's call goes next, when its own family has no other verified version. */
const FALLBACK_TIERS: Record<AiTier, AiTier[]> = {
  standard: ['balanced'],
  balanced: ['standard'],
  premium: ['balanced', 'standard'],
};

const SEED_TIER_IDS: Record<AiProvider, Record<AiTier, string>> = {
  anthropic: { standard: 'claude-haiku-4-5', balanced: 'claude-sonnet-5', premium: 'claude-opus-5-5' },
  openai: { standard: 'gpt-6-luna', balanced: 'gpt-5.6-terra', premium: 'gpt-6-sol' },
  google: { standard: 'gemini-3.5-flash-lite', balanced: 'gemini-3.8-flash', premium: 'gemini-3.1-pro-preview' },
};

function seedModelForTier(provider: AiProvider, tier: AiTier): CatalogModel {
  const id = SEED_TIER_IDS[provider][tier];
  const m = SEED_MODELS.find((s) => s.provider === provider && s.id === id);
  // SEED_TIER_IDS only names SEED_MODELS entries (pinned by the spec), so this cannot miss.
  return m as CatalogModel;
}

// ─── Process-wide catalog ─────────────────────────────────────────────────────────────────────
let current = new ResolvedCatalog({});

/** The catalog every dispatch reads. Seed-only until the store loads state. */
export function getCatalog(): ResolvedCatalog {
  return current;
}

/** Swap in a new state (store load, sync, admin edit). Never throws on a bad document. */
export function setCatalogState(state: CatalogState | null | undefined): ResolvedCatalog {
  try {
    current = new ResolvedCatalog(state && typeof state === 'object' ? state : {});
  } catch {
    current = new ResolvedCatalog({});
  }
  return current;
}

/**
 * Listeners for what live traffic teaches us (a capability a model rejected, a model the provider
 * refused). The store persists them so every replica — and the next boot — learns it too.
 */
type CatalogLesson =
  | { kind: 'capability'; provider: AiProvider; id: string; caps: Partial<ModelCapabilities> }
  | { kind: 'failure'; provider: AiProvider; id: string; error: string };
const lessonListeners = new Set<(lesson: CatalogLesson) => void>();

export function onCatalogLesson(fn: (lesson: CatalogLesson) => void): () => void {
  lessonListeners.add(fn);
  return () => lessonListeners.delete(fn);
}

/** Record a capability correction in THIS process immediately, and notify the store. */
export function learnCapability(provider: AiProvider, id: string, caps: Partial<ModelCapabilities>): void {
  const state = current.state;
  const key = modelKey(provider, id);
  const learnedCaps = { ...(state.learnedCaps || {}), [key]: { ...(state.learnedCaps?.[key] || {}), ...caps } };
  current = new ResolvedCatalog({ ...state, learnedCaps });
  for (const fn of lessonListeners) {
    try {
      fn({ kind: 'capability', provider, id, caps });
    } catch {
      /* a listener must never break a dispatch */
    }
  }
}

/** Mark a model refused by its provider, so resolution skips it until the next good sync. */
export function markModelFailed(provider: AiProvider, id: string, error: string): void {
  const state = current.state;
  const key = modelKey(provider, id);
  const failures = { ...(state.failures || {}), [key]: { at: new Date().toISOString(), error: error.slice(0, 300) } };
  current = new ResolvedCatalog({ ...state, failures });
  for (const fn of lessonListeners) {
    try {
      fn({ kind: 'failure', provider, id, error });
    } catch {
      /* never break a dispatch */
    }
  }
}

// ─── Cost ─────────────────────────────────────────────────────────────────────────────────────
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Anthropic prompt-cache reads (billed at 0.1× input). */
  cacheReadTokens?: number;
  /** Anthropic prompt-cache writes (billed at 1.25× input for the 5-minute cache). */
  cacheWriteTokens?: number;
}

/**
 * Cost of one call in MICRO-dollars (USD × 1e6), at the catalog price of the model that served it.
 * Unknown model → priced as the most expensive model we know for that provider, so an unpriced id
 * can never make usage look cheaper than it was.
 */
export function costMicros(provider: AiProvider, modelId: string, usage: TokenUsage, cat = getCatalog()): number {
  const known = cat.get(provider, modelId);
  const m = known || mostExpensive(provider, cat);
  if (!m) return 0;
  const input = Math.max(0, usage.inputTokens || 0);
  const output = Math.max(0, usage.outputTokens || 0);
  const cacheRead = Math.max(0, usage.cacheReadTokens || 0);
  const cacheWrite = Math.max(0, usage.cacheWriteTokens || 0);
  const { read, write } = cacheRatios(provider, m, !!known);
  // Prices are USD per 1M tokens, so tokens × price = micro-dollars exactly.
  const micros =
    input * m.inputPer1M + output * m.outputPer1M + cacheRead * m.inputPer1M * read + cacheWrite * m.inputPer1M * write;
  return Math.max(0, Math.round(micros));
}

/** Anthropic models whose cache hits are cheaper than the standard 0.1x (vendor pricing page). */
const ANTHROPIC_CACHE_READ: Record<string, number> = {
  'claude-opus-5-5': 0.05,
  'claude-fable-5-1': 0.025,
};

/**
 * Cache prices as a fraction of the model's input price (vendor pricing pages, 2026-09-22). Where a
 * ratio is not known the choice errs HIGH — the allowance must never under-count what we are billed.
 *   Anthropic: reads 0.1x (lower on the models above), 5-minute writes 1.25x.
 *   OpenAI: GPT-5.6 and later read at 0.1x and write at 1.25x; older models have their own read
 *   rate (gpt-4o-mini 0.5x, gpt-4.1 0.25x), so 0.5x covers them, and they bill no write premium.
 *   Google: the reply does not split cached tokens out, so there is nothing to price.
 */
function cacheRatios(provider: AiProvider, m: CatalogModel, known: boolean): { read: number; write: number } {
  // An unknown id is priced as the vendor's dearest model; its own cache discounts do not apply.
  if (!known) return { read: provider === 'anthropic' ? 0.1 : 0.5, write: 1.25 };
  if (provider === 'anthropic') return { read: ANTHROPIC_CACHE_READ[m.id] ?? 0.1, write: 1.25 };
  if (provider === 'openai') {
    const [major = 0, minor = 0] = m.version;
    const gpt56OrLater = major > 5 || (major === 5 && minor >= 6);
    return gpt56OrLater ? { read: 0.1, write: 1.25 } : { read: 0.5, write: 1 };
  }
  return { read: 1, write: 1.25 };
}

function mostExpensive(provider: AiProvider, cat: ResolvedCatalog): CatalogModel | null {
  const all = cat.list(provider);
  if (all.length === 0) return null;
  return all.reduce((a, b) => (b.outputPer1M > a.outputPer1M ? b : a));
}
