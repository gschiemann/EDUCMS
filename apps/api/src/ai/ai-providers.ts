/**
 * AI provider adapters — translate our internal {system, userPrompt}
 * shape into the wire format each provider expects.
 *
 * Adding a new provider here is 3 things:
 *   1) Add the literal to AiProvider union below
 *   2) Add a case to dispatchAi() with its model name + endpoint
 *   3) Add the validation regex to validateApiKeyShape()
 *
 * 2026-05-04 BYOK pivot — operators can supply their own keys so cost
 * shifts to them. We still default to Anthropic with our platform key
 * for the trial-mode tenants who haven't configured BYOK yet.
 */

export type AiProvider = 'anthropic' | 'openai' | 'google';

/** Normalize user input — accept "Anthropic" / "claude" etc. */
export function coerceProvider(s: string | null | undefined): AiProvider | null {
  if (!s) return null;
  const lc = String(s).trim().toLowerCase();
  if (['anthropic', 'claude'].includes(lc)) return 'anthropic';
  if (['openai', 'gpt', 'gpt-4', 'chatgpt'].includes(lc)) return 'openai';
  if (['google', 'gemini', 'palm'].includes(lc)) return 'google';
  return null;
}

/**
 * Recognize OpenAI "reasoning" models (gpt-5 family, o1/o3/o4). These
 * use the Chat Completions API but with a DIFFERENT parameter contract:
 * `max_completion_tokens` instead of `max_tokens`, and they reject any
 * non-default `temperature`. Sending the legacy params 400s on every
 * call. Centralized here so both the text-gen dispatcher and the
 * alt-text vision path branch identically. Match is prefix-based so a
 * future `gpt-5.1` / `o3-mini` is covered without a catalog edit.
 */
export function isOpenAiReasoningModel(modelId: string | null | undefined): boolean {
  const id = String(modelId || '').trim().toLowerCase();
  if (!id) return false;
  // gpt-5*, o1*, o3*, o4* are reasoning models. gpt-4* / gpt-3.5* are not.
  return /^(gpt-5|o1|o3|o4)(-|$|\.|\d)/.test(id);
}

/**
 * Sanity check the shape of a provider key BEFORE we send it. This is
 * a UX guardrail — catches "you pasted the wrong thing" early without
 * burning a real API call. The provider validates for real on the
 * test request after.
 */
export function validateApiKeyShape(provider: AiProvider, key: string): string | null {
  const trimmed = (key || '').trim();
  if (!trimmed) return 'API key is required.';
  if (trimmed.length < 16) return 'API key looks too short.';
  if (trimmed.length > 256) return 'API key looks too long.';
  if (provider === 'anthropic') {
    if (!trimmed.startsWith('sk-ant-')) {
      return 'Anthropic keys start with "sk-ant-". Double-check you copied the right one.';
    }
  } else if (provider === 'openai') {
    if (!trimmed.startsWith('sk-')) {
      return 'OpenAI keys start with "sk-". Double-check you copied the right one.';
    }
  } else if (provider === 'google') {
    if (!trimmed.startsWith('AIza')) {
      return 'Google AI keys start with "AIza". Get one from aistudio.google.com/apikey.';
    }
  }
  return null;
}

/**
 * Canonical model catalog — exposed via GET /ai/models so the FE
 * shows a picker driven by the current backend list. Hard-coded so
 * we can ship a new model option without a DB migration; replace as
 * providers refresh their lineups.
 *
 * Cost numbers are USD per 1M tokens (input / output) as published
 * by each provider's pricing page as of 2026-05-25. Per-call cost
 * for a typical 300-token output generation is roughly
 *   (output_per_1M / 1_000_000) * 300
 * which for Haiku at $4/M output → ~$0.0012 per call. The catalog
 * pre-computes that into `estCostPerCallUsd` so the FE doesn't have
 * to model token math.
 *
 * `default: true` marks the model the FE selects when a provider is
 * first chosen. We default to the cheapest passable model so a user
 * pasting a key without picking a model lands somewhere safe + low-
 * cost.
 */
export interface AiModelInfo {
  /** Wire model id sent to the provider (the exact string the API expects). */
  id: string;
  /** Operator-facing label. */
  label: string;
  /** One-liner tagline that explains the tier. */
  tagline: string;
  /** USD per 1M input tokens (provider list price). */
  inputPer1M: number;
  /** USD per 1M output tokens. */
  outputPer1M: number;
  /** Pre-computed estimate for our typical 300-token-output call. */
  estCostPerCallUsd: number;
  /** First-pick model for this provider. */
  default?: boolean;
}

export interface AiProviderInfo {
  id: AiProvider;
  label: string;
  /** Help text shown under the provider picker. */
  description: string;
  /** Operator-facing link to get a key. */
  getKeyUrl: string;
  models: AiModelInfo[];
}

const PER_CALL_OUTPUT_TOKENS = 300;

function estCost(inputPer1M: number, outputPer1M: number): number {
  // Conservative estimate — treats the WHOLE call as output tokens
  // (input is usually < 500 tokens in our generations, but the
  // operator should see a number that won't surprise them up). One
  // typical generation; for the touch-template generator (1500
  // tokens output) the FE multiplies by 5.
  return (outputPer1M / 1_000_000) * PER_CALL_OUTPUT_TOKENS;
}

// 2026-05-25 (afternoon) — operator: "just give 3 options each, the
// cheapest for standard stuff, middle for maybe more like text and
// then max for the designing." Slimmed every provider to exactly
// three tiers. Tier semantics are CONSISTENT across providers so an
// operator picking "Standard" gets a comparable cost/quality
// envelope whether they're on Anthropic, OpenAI, or Google:
//
//   • Standard — cheap, fast, fine for short signage copy
//   • Balanced — middle, better at structured JSON + nuance
//   • Premium  — top tier, use for AI-generated template layouts
//                / complex prompts
//
// Model IDs are wire-strings sent to the provider verbatim. A typo or
// speculative ID returns 404 and the test-on-save flow refuses to
// persist the operator's key, so EVERY id below must be a real,
// currently-GA model. The catalog is a one-file edit with no migration —
// every operator's settings page picks up a refreshed `id:` at next
// page-load via /ai/key/catalog.
//
// REFRESH CADENCE: review this catalog roughly quarterly, or whenever a
// provider's pricing page gets a refresh.
//
// 2026-07-13 dead-model purge (audit W0-03) — the 2026-05-30 refresh
// aged badly; two catalog entries were serving 404s to customers:
//   • claude-3-5-haiku-20241022 RETIRED 2026-02-19 (was the Anthropic
//     DEFAULT — every Standard-tier Anthropic call died) → claude-haiku-4-5.
//   • gemini-2.0-flash SHUT DOWN 2026-06-01 → replaced by
//     gemini-3.5-flash (GA, free tier).
//   • claude-opus-4-1-20250805 is deprecated and RETIRES 2026-08-05 (three
//     weeks out) → claude-opus-4-6 ($5/$25 — a price DROP from 4.1's
//     $15/$75). Balanced bumped claude-sonnet-4-5 → claude-sonnet-4-6
//     (same price, current generation, identical request shape).
//   • gemini-2.5-flash/pro PRICES corrected against the live pricing page
//     (2.5-flash is $0.30/$2.50, not the $0.075/$0.30 we showed). Both are
//     deprecated with a 2026-10-16 shutdown — still runnable + free-tier,
//     kept until then; tools/check-model-retirements.cjs warns 60 days out.
//   • gpt-5 is marked deprecated by OpenAI (no shutdown date published; the
//     GPT-5.5/5.6 successor API ids are not verifiable from the public
//     model page yet). It runs fine today — kept, tracked in the
//     retirement checker; swap when the successor id is confirmed.
// Alt-text vision (ai-alt-text.service.ts) pins the same Standard-tier
// Anthropic id — keep them in lock-step (both claude-haiku-4-5 today).
export const AI_PROVIDERS: AiProviderInfo[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    description: 'Recommended.',
    getKeyUrl: 'https://console.anthropic.com/settings/keys',
    models: [
      {
        id: 'claude-haiku-4-5',
        label: 'Standard — Claude Haiku 4.5',
        tagline: 'Best for everyday copy and announcements.',
        inputPer1M: 1.00, outputPer1M: 5.00,
        estCostPerCallUsd: estCost(1.00, 5.00),
        default: true,
      },
      {
        id: 'claude-sonnet-4-6',
        label: 'Balanced — Claude Sonnet 4.6',
        tagline: 'Better for longer copy.',
        inputPer1M: 3.00, outputPer1M: 15.00,
        estCostPerCallUsd: estCost(3.00, 15.00),
      },
      {
        id: 'claude-opus-4-6',
        label: 'Premium — Claude Opus 4.6',
        tagline: 'Best for AI-generated template designs.',
        inputPer1M: 5.00, outputPer1M: 25.00,
        estCostPerCallUsd: estCost(5.00, 25.00),
      },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI (GPT)',
    description: 'Use if you already have an OpenAI account.',
    getKeyUrl: 'https://platform.openai.com/api-keys',
    models: [
      {
        id: 'gpt-4o-mini',
        label: 'Standard — GPT-4o mini',
        tagline: 'Best for everyday copy and announcements.',
        inputPer1M: 0.15, outputPer1M: 0.60,
        estCostPerCallUsd: estCost(0.15, 0.60),
        default: true,
      },
      {
        id: 'gpt-4.1',
        label: 'Balanced — GPT-4.1',
        tagline: 'Better for longer copy.',
        inputPer1M: 2.00, outputPer1M: 8.00,
        estCostPerCallUsd: estCost(2.00, 8.00),
      },
      {
        id: 'gpt-5',
        label: 'Premium — GPT-5',
        tagline: 'Best for AI-generated template designs.',
        inputPer1M: 5.00, outputPer1M: 20.00,
        estCostPerCallUsd: estCost(5.00, 20.00),
      },
    ],
  },
  {
    id: 'google',
    label: 'Google (Gemini)',
    description: 'Cheapest. Generous free tier.',
    getKeyUrl: 'https://aistudio.google.com/apikey',
    models: [
      // 2026-05-25 — Google retired the gemini-1.5-* family for newly-
      // created AI Studio projects. A fresh key (created after April
      // 2025) only sees the 2.x catalog; testing against 1.5-flash
      // returned a 404 "model not found on your Google account" for
      // the operator's brand-new key. Catalog is now 2.x-only, with
      // 2.5-flash as the default (free tier, same generous limits
      // 1.5-flash used to have: 15 req/min, 1500 req/day).
      //
      // 2.5-pro is gated behind paid tier on AI Studio — flagged in
      // its tagline so the operator knows before picking it.
      // 2026-07-13 (W0-03): gemini-2.0-flash was SHUT DOWN by Google on
      // 2026-06-01 — every call 404'd. Replaced with gemini-3.5-flash
      // (current GA generation, free tier). 2.5-flash stays the default:
      // it is deprecated (shutdown 2026-10-16, tracked in
      // check-model-retirements.cjs) but remains the cheapest free-tier
      // option until then. Prices below re-verified against
      // ai.google.dev/gemini-api/docs/pricing on 2026-07-13.
      {
        id: 'gemini-2.5-flash',
        label: 'Standard — Gemini 2.5 Flash',
        tagline: 'Best for everyday copy and announcements. Free tier covers 1500 calls/day.',
        inputPer1M: 0.30, outputPer1M: 2.50,
        estCostPerCallUsd: estCost(0.30, 2.50),
        default: true,
      },
      {
        id: 'gemini-3.5-flash',
        label: 'Balanced — Gemini 3.5 Flash',
        tagline: 'Current-generation flash model. Free tier available.',
        inputPer1M: 1.50, outputPer1M: 9.00,
        estCostPerCallUsd: estCost(1.50, 9.00),
      },
      {
        id: 'gemini-2.5-pro',
        label: 'Premium — Gemini 2.5 Pro',
        tagline: 'Best for AI-generated template designs. Requires paid AI Studio tier.',
        inputPer1M: 1.25, outputPer1M: 10.00,
        estCostPerCallUsd: estCost(1.25, 10.00),
      },
    ],
  },
];

export function getProviderInfo(provider: AiProvider): AiProviderInfo | null {
  return AI_PROVIDERS.find((p) => p.id === provider) || null;
}

export function getModelInfo(provider: AiProvider, modelId: string): AiModelInfo | null {
  const p = getProviderInfo(provider);
  if (!p) return null;
  return p.models.find((m) => m.id === modelId) || null;
}

export function defaultModelFor(provider: AiProvider): string {
  const p = getProviderInfo(provider);
  if (!p) return '';
  const def = p.models.find((m) => m.default);
  return def?.id || p.models[0]?.id || '';
}

/**
 * Validate that an operator-supplied model id is one we know about
 * for that provider. We accept ONLY catalog models to prevent a
 * tenant typo from silently routing to an unsupported endpoint that
 * either 404s or — worse — picks up an unexpected model price.
 *
 * If you need to add a model, add it to AI_PROVIDERS above. We
 * intentionally do NOT support free-text model ids.
 */
export function isKnownModel(provider: AiProvider, modelId: string): boolean {
  return !!getModelInfo(provider, modelId);
}

/**
 * Legacy → current model aliases (audit W0-03, 2026-07-13).
 *
 * Tenants persist their chosen model id in Tenant.aiModel. When a provider
 * retires a model, every tenant who saved it starts 404ing on EVERY
 * generation until they happen to revisit settings — that is exactly how
 * the retired claude-3-5-haiku default broke Standard-tier Anthropic
 * calls fleet-wide. This map heals saved ids at resolution time.
 */
const LEGACY_MODEL_ALIASES: Record<AiProvider, Record<string, string>> = {
  anthropic: {
    'claude-3-5-haiku-20241022': 'claude-haiku-4-5',   // retired 2026-02-19
    'claude-3-5-sonnet-20241022': 'claude-sonnet-4-6', // retired 2025-10-28
    'claude-sonnet-4-5-20250929': 'claude-sonnet-4-6', // catalog bump 2026-07-13
    'claude-opus-4-20250514': 'claude-opus-4-6',       // deprecated
    'claude-opus-4-1-20250805': 'claude-opus-4-6',     // retires 2026-08-05
  },
  openai: {},
  google: {
    'gemini-1.5-flash': 'gemini-2.5-flash', // retired for new projects 2025
    'gemini-1.5-pro': 'gemini-2.5-pro',
    'gemini-2.0-flash': 'gemini-3.5-flash', // shut down 2026-06-01
  },
};

/**
 * Resolve a SAVED tenant model id to something runnable today:
 *   - still in the catalog → unchanged;
 *   - known legacy id → its current successor;
 *   - anything else (typo, removed, unknown) → '' so dispatch falls back
 *     to the provider default instead of sending a dead id to the wire.
 * Never throws; '' is the safe value everywhere model is optional.
 */
export function healLegacyModelId(provider: AiProvider, modelId: unknown): string {
  if (typeof modelId !== 'string' || !modelId.trim()) return '';
  const id = modelId.trim();
  if (isKnownModel(provider, id)) return id;
  return LEGACY_MODEL_ALIASES[provider]?.[id] ?? '';
}

interface DispatchInput {
  apiKey: string;
  /** Catalog model id; falls back to provider default if absent. */
  model?: string;
  system: string;
  userPrompt: string;
  maxTokens: number;
  /**
   * OPTIONAL hard override for the abort ceiling (ms). When set, this wins
   * over the model-aware `slowModel` ceiling below — for a caller that KNOWS
   * its call is cheap/small (e.g. the brief-extraction pass, ≤500 tokens) and
   * wants a short, snappy timeout even on a "slow" reasoning model rather than
   * inheriting that model's generous multi-minute ceiling. Never used to make
   * a call wait LONGER than the model-aware ceiling would — only shorter.
   */
  timeoutMs?: number;
}

/** One turn in a multi-turn conversation. `assistant` = a prior model reply. */
export interface DispatchMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface DispatchMessagesInput {
  apiKey: string;
  /** Catalog model id; falls back to provider default if absent. */
  model?: string;
  system: string;
  /** See DispatchInput.timeoutMs — same optional hard override, single-turn or multi-turn. */
  timeoutMs?: number;
  /** Full conversation so far, oldest first. MUST start with a `user` turn. */
  messages: DispatchMessage[];
  maxTokens: number;
}

interface DispatchOutput {
  raw: string;
  /** Provider-reported errors map to ServiceUnavailableException upstream. */
  errorStatus?: number;
  errorBody?: string;
}

/**
 * Single-turn entrypoint — the original {system, userPrompt} shape every
 * generation surface uses. Thin wrapper over dispatchAiMessages with a
 * one-element user-message array. The wire payload is byte-identical to
 * the historical single-turn request on all three providers (Anthropic
 * `messages:[{user}]`, OpenAI `[system,user]`, Google `contents:[{user}]`),
 * so this is a no-behavior-change delegation — the existing generation
 * paths + CI exercise it.
 */
export async function dispatchAi(
  provider: AiProvider,
  input: DispatchInput,
): Promise<DispatchOutput> {
  return dispatchAiMessages(provider, {
    apiKey: input.apiKey,
    model: input.model,
    system: input.system,
    messages: [{ role: 'user', content: input.userPrompt }],
    maxTokens: input.maxTokens,
    timeoutMs: input.timeoutMs,
  });
}

/**
 * Multi-turn entrypoint — same provider shaping as the single-turn path
 * but accepts a full {role,content}[] conversation so a stateful surface
 * (the signage concierge) can hold a real back-and-forth. Anthropic and
 * OpenAI take the array verbatim (assistant turns become assistant
 * messages); Google maps the `assistant` role to its `model` role. Model
 * resolution, temperature parity, the 15s abort, OpenAI-reasoning param
 * branching, and Gemini-2.5 thinking handling are all identical to the
 * single-turn path.
 */
export async function dispatchAiMessages(
  provider: AiProvider,
  input: DispatchMessagesInput,
): Promise<DispatchOutput> {
  // Resolve which model to send. Tenant's saved choice (input.model)
  // takes precedence; falls back to provider default if absent OR if
  // the saved id isn't in our current catalog (model was removed /
  // renamed by the provider; better to fall back to a known-good one
  // than to send a request that 404s).
  const requested = input.model || '';
  const model = isKnownModel(provider, requested) ? requested : defaultModelFor(provider);

  // Temperature parity (2026-05-29 audit §3) — pin a single explicit
  // temperature on ALL three providers. 0.7 keeps signage copy varied
  // without the off-the-rails drift of 1.0. Reasoning models (see openai
  // branch) reject an explicit temperature, so it's applied per-branch.
  const TEMPERATURE = 0.7;

  // SECURITY (audit-B2 fix, 2026-05-25) — Node 20's `fetch` has no default
  // timeout; a hung provider would hold an Express handler open forever, so
  // every call attaches an AbortSignal.timeout.
  //
  // 2026-06-28 BETA FINDING — the old flat 15s aborted EVERY gpt-5 call with
  // "AI service unreachable", making the premium tier unusable across the WHOLE
  // app (concierge AND board generation). Reasoning / premium models (gpt-5 +
  // o-series, gemini-2.5, claude opus) emit internal reasoning tokens and
  // routinely take 20-60s+ for a non-trivial generation.
  //
  // 2026-06-30 PROD INCIDENT — a flat 90s STILL wasn't enough for the single
  // biggest call in the app: a full HTML designer board (generate-designer asks
  // for 16k visible tokens). gpt-5's latency is highly variable, and the
  // 3-candidate picker fires THREE of these in parallel on one key — they
  // contend, all blow past 90s together, the whole batch fails, and the
  // operator sees "Could not reach the AI service" (Railway log: three
  // "operation was aborted due to timeout" in the same ms). The abort guard
  // must scale with the WORK requested, not a flat number: a 300-token snippet
  // and a 16k-token board are not the same wait. So for slow models the ceiling
  // is now `base + per-visible-token` — a board lands ~186s, concierge ~97s,
  // snippets ~92s (never below the old 90s floor). Hard-capped at 240s, which
  // is deliberately UNDER Railway's edge limit: a request with no bytes flowing
  // (we don't stream) is closed by the edge proxy after 300s anyway, so a
  // ceiling past that would just trade our clean 503 for an opaque proxy reset.
  // Fast models (Haiku / gpt-4o-mini / Gemini Flash) return in seconds — 30s is
  // an abort guard, not a wait. AI calls are user-initiated + capped per hour,
  // so a longer ceiling can't pile up workers under load.
  const slowModel =
    isOpenAiReasoningModel(model) || /^gemini-2\.5/.test(model) || /opus/i.test(model);
  const maxTok = input.maxTokens || 1000;
  const modelCeilingMs = slowModel
    ? Math.min(240_000, 90_000 + maxTok * 6)
    : 30_000;
  // A caller-supplied timeoutMs (e.g. the brief-extraction pass — small,
  // wants to fail fast rather than inherit a slow-model's multi-minute
  // ceiling) can only SHORTEN the wait, never lengthen it past what the
  // model-aware ceiling already allows.
  const FETCH_TIMEOUT_MS =
    typeof input.timeoutMs === 'number' && input.timeoutMs > 0
      ? Math.min(input.timeoutMs, modelCeilingMs)
      : modelCeilingMs;

  // Defensive: every provider requires a non-empty conversation. Callers
  // always pass at least one user turn, but guard so a bad caller gets a
  // clean envelope instead of an opaque provider 400.
  const turns = (input.messages || []).filter(
    (m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.length > 0,
  );
  if (turns.length === 0) {
    return { raw: '', errorStatus: 400, errorBody: 'No conversation messages supplied.' };
  }

  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': input.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: input.maxTokens,
        temperature: TEMPERATURE,
        // Anthropic ephemeral prompt cache (audit §3, 2026-05-30) — our
        // system prompts are STATIC and re-sent verbatim. The block-array
        // form carries cache_control for a ~90% discount on the system
        // input tokens within the 5-min TTL. Anthropic-only.
        system: [
          {
            type: 'text',
            text: input.system,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: turns.map((m) => ({ role: m.role, content: m.content })),
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      return { raw: '', errorStatus: res.status, errorBody };
    }
    const json = (await res.json()) as any;
    return { raw: json?.content?.[0]?.text || '' };
  }

  if (provider === 'openai') {
    // Use chat completions (not /v1/responses) for max compat.
    //
    // 2026-05-29 audit §5 — OpenAI reasoning models (gpt-5 family, o1/o3/o4)
    // REJECT the legacy `max_tokens` param (use `max_completion_tokens`)
    // AND reject any non-default `temperature`. Branch the body so the
    // catalog's gpt-5 Premium tier works instead of 400-ing every call.
    const reasoning = isOpenAiReasoningModel(model);
    const body: Record<string, any> = {
      model,
      messages: [
        { role: 'system', content: input.system },
        ...turns.map((m) => ({ role: m.role, content: m.content })),
      ],
    };
    if (reasoning) {
      // 2026-06-28 BETA FINDING #2 — a reasoning model's INTERNAL reasoning
      // tokens count against max_completion_tokens. With the caller's modest
      // budget (300 snippet / 900 board / 1100 concierge / 2600 set), GPT-5
      // spent the ENTIRE budget reasoning and returned ZERO visible text →
      // "The AI model returned an empty response" on every call. Same class as
      // the Gemini-2.5 thinking-budget bug. Two fixes:
      //   1) reasoning_effort 'low' — this is signage copy / template JSON, not
      //      a math proof; low keeps GPT-5 fast + cheap and stops it from
      //      burning the whole budget thinking. (minimal/low/medium/high are
      //      the accepted values for gpt-5 + o-series; 'low' is safe on all.)
      //   2) give the VISIBLE output real headroom on top of the reasoning
      //      spend — the caller's maxTokens is the desired visible size, so add
      //      a generous reasoning allowance (billed only on tokens actually
      //      emitted, so a high ceiling just prevents truncation).
      body.reasoning_effort = 'low';
      body.max_completion_tokens = input.maxTokens + 12000;
      // Reasoning models only accept the default temperature — omit it.
    } else {
      body.max_tokens = input.maxTokens;
      body.temperature = TEMPERATURE;
    }
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      return { raw: '', errorStatus: res.status, errorBody };
    }
    const json = (await res.json()) as any;
    return { raw: json?.choices?.[0]?.message?.content || '' };
  }

  if (provider === 'google') {
    // Google Generative Language API (Gemini).
    //
    // SECURITY (audit-B1 fix, 2026-05-25) — pass the key as the
    // `x-goog-api-key` header (not a URL query param) so it never appears
    // in error bodies. System instruction is a sibling of `contents`, not
    // a message role; assistant turns use the `model` role.
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}` +
      `:generateContent`;
    // ── Gemini 2.5 "thinking" handling (2026-06-08, BYOK launch fix) ──
    // The 2.5 family emits internal "thinking" tokens that count against
    // maxOutputTokens; on a small budget it can spend the whole budget
    // thinking and return finishReason=MAX_TOKENS with ZERO text. Disable
    // thinking on 2.5-flash; give 2.5-pro (thinking unkillable) a generous
    // ceiling. Non-2.5 models are left untouched.
    const genConfig: Record<string, any> = {
      temperature: TEMPERATURE,
      maxOutputTokens: input.maxTokens,
    };
    if (/^gemini-2\.5-flash/.test(model)) {
      genConfig.thinkingConfig = { thinkingBudget: 0 };
    } else if (/^gemini-2\.5/.test(model)) {
      genConfig.maxOutputTokens = Math.max(input.maxTokens, 8192);
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': input.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: turns.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        generationConfig: genConfig,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      // Belt-and-suspenders: redact any `key=...` substring that might
      // appear in forwarded error bodies before bubbling upstream.
      let errorBody = await res.text().catch(() => '');
      errorBody = errorBody.replace(/[?&]key=[^&\s"']+/g, '&key=REDACTED');
      return { raw: '', errorStatus: res.status, errorBody };
    }
    const json = (await res.json()) as any;
    const parts = json?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts)
      ? parts.map((p: any) => p?.text ?? '').join('')
      : '';
    if (!text.trim()) {
      // 200 OK but no usable text — almost always finishReason=MAX_TOKENS
      // (thinking exhausted the budget) or a SAFETY/RECITATION block.
      // Surface it as an error envelope rather than a silent ''.
      const finish =
        json?.candidates?.[0]?.finishReason ||
        json?.promptFeedback?.blockReason ||
        'NO_TEXT';
      return {
        raw: '',
        errorStatus: 502,
        errorBody: `Gemini returned no text (finishReason=${finish}, model=${model})`,
      };
    }
    return { raw: text };
  }

  // Unreachable given coerceProvider() validates upstream, but keeps
  // the type-checker happy.
  return { raw: '', errorStatus: 400, errorBody: `Unsupported provider: ${provider}` };
}

/**
 * Recognize provider-side "out of credit / quota exhausted" responses.
 *
 * Every provider conflates "rate-limited (try again in seconds)" with
 * "you're out of money (add credits)" on the SAME HTTP status code,
 * disambiguated only by the response body's error.type / status. The
 * audit on 2026-05-26 found we only disambiguated this at test-on-save,
 * not at generate-time — so an operator burning through credits on a
 * real generation got an unactionable "rate-limited, try again" toast
 * forever. This helper is the single source of truth, called from
 * BOTH ai-key.controller.ts (test-on-save) AND ai.service.ts (every
 * generate). Adding a new provider quirk = adding a branch here.
 *
 *  OpenAI:    HTTP 429, body has error.type === 'insufficient_quota'
 *  Anthropic: HTTP 400, body has error.type === 'invalid_request_error'
 *             AND message contains 'credit balance is too low'.
 *             (Anthropic also rarely uses HTTP 402 — handle both.)
 *  Google:    HTTP 429, body has status === 'RESOURCE_EXHAUSTED' or
 *             error.status === 'RESOURCE_EXHAUSTED'. Note that
 *             'RESOURCE_EXHAUSTED' here can mean EITHER per-minute
 *             rate limit OR daily/monthly quota — Google doesn't
 *             distinguish in the API response, only in the docs.
 *             We surface a Google-specific message that covers both.
 *
 * Returns a structured envelope when matched, null otherwise. Caller
 * is expected to map null → use generic error handling.
 */
export interface ProviderQuotaError {
  code: 'AI_PROVIDER_OUT_OF_CREDIT' | 'AI_PROVIDER_RATE_LIMIT';
  message: string;
  /** Provider that emitted the error. Useful for FE branching by brand. */
  provider: AiProvider;
}
export function mapProviderQuotaError(
  provider: AiProvider,
  errorStatus: number,
  errorBody: string | undefined,
): ProviderQuotaError | null {
  const body = errorBody || '';

  if (provider === 'openai' && errorStatus === 429) {
    const isOutOfCredit =
      /insufficient_quota|exceeded your current quota|billing_hard_limit_reached|"type"\s*:\s*"insufficient_quota"/i.test(body);
    if (isOutOfCredit) {
      return {
        code: 'AI_PROVIDER_OUT_OF_CREDIT',
        provider,
        message:
          'Your OpenAI API account has no credit balance. Heads up: ChatGPT Plus only covers the chat website — API access is a separate balance. Add credits at platform.openai.com → Settings → Billing → Add to credit balance (minimum $5), then try again.',
      };
    }
    // Real rate-limit (per-minute throttle). Return null so caller
    // falls through to the generic "try again in a moment" message.
    return null;
  }

  if (provider === 'anthropic') {
    if (
      errorStatus === 402 ||
      (errorStatus === 400 &&
        /credit_balance_too_low|credit balance is too low|"type"\s*:\s*"credit_balance_too_low"/i.test(body))
    ) {
      return {
        code: 'AI_PROVIDER_OUT_OF_CREDIT',
        provider,
        message:
          'Your Anthropic API account has run out of credit. Add credits at console.anthropic.com → Settings → Billing → Buy credits, then try again.',
      };
    }
    return null;
  }

  if (provider === 'google' && errorStatus === 429) {
    const isQuota =
      /RESOURCE_EXHAUSTED|quotaExceeded|"status"\s*:\s*"RESOURCE_EXHAUSTED"/i.test(body);
    if (isQuota) {
      return {
        code: 'AI_PROVIDER_OUT_OF_CREDIT',
        provider,
        message:
          "Your Google Gemini quota is exhausted. The free tier resets daily; if you keep hitting the cap, enable billing at console.cloud.google.com → Billing for higher limits. Or wait until tomorrow and try again.",
      };
    }
    return null;
  }

  return null;
}
