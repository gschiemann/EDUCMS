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
// Why I left Opus 4 (not 4.5/4.7) as Anthropic Premium: model IDs
// are wire-strings sent to the provider. A typo or speculative ID
// returns 404 and the test-on-save flow refuses to persist the
// operator's key. The catalog is a one-file edit with no migration —
// when Anthropic / OpenAI / Google publish a confirmed-working
// newer model id (Opus 4.5, GPT-5.5, Gemini 3.0, etc.), update the
// `id:` field below and push; every operator's settings page picks
// up the new option at next page-load via /ai/key/catalog.
//
// REFRESH CADENCE: review this catalog roughly quarterly, or
// whenever a provider's pricing page gets a refresh.
export const AI_PROVIDERS: AiProviderInfo[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    description: 'Recommended — best fit for our prompts.',
    getKeyUrl: 'https://console.anthropic.com/settings/keys',
    models: [
      {
        id: 'claude-3-5-haiku-20241022',
        label: 'Standard — Claude 3.5 Haiku',
        tagline: 'Fast + cheap. Day-to-day copy, announcements, ticker text.',
        inputPer1M: 0.80, outputPer1M: 4.00,
        estCostPerCallUsd: estCost(0.80, 4.00),
        default: true,
      },
      {
        id: 'claude-3-5-sonnet-20241022',
        label: 'Balanced — Claude 3.5 Sonnet',
        tagline: 'More nuance + better structured output. Pick for long copy.',
        inputPer1M: 3.00, outputPer1M: 15.00,
        estCostPerCallUsd: estCost(3.00, 15.00),
      },
      {
        id: 'claude-opus-4-20250514',
        label: 'Premium — Claude Opus 4',
        tagline: 'Top tier. Use for AI-generated template layouts + complex prompts.',
        inputPer1M: 15.00, outputPer1M: 75.00,
        estCostPerCallUsd: estCost(15.00, 75.00),
      },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI (GPT)',
    description: 'Good if you already have an OpenAI account.',
    getKeyUrl: 'https://platform.openai.com/api-keys',
    models: [
      {
        id: 'gpt-4o-mini',
        label: 'Standard — GPT-4o mini',
        tagline: 'Fast + cheap. Day-to-day copy, announcements, ticker text.',
        inputPer1M: 0.15, outputPer1M: 0.60,
        estCostPerCallUsd: estCost(0.15, 0.60),
        default: true,
      },
      {
        id: 'gpt-4.1',
        label: 'Balanced — GPT-4.1',
        tagline: 'Better instruction-following. Pick for long copy + structured output.',
        inputPer1M: 2.00, outputPer1M: 8.00,
        estCostPerCallUsd: estCost(2.00, 8.00),
      },
      {
        id: 'gpt-5',
        label: 'Premium — GPT-5',
        tagline: 'Top tier. Use for AI-generated template layouts + complex prompts.',
        inputPer1M: 5.00, outputPer1M: 20.00,
        estCostPerCallUsd: estCost(5.00, 20.00),
      },
    ],
  },
  {
    id: 'google',
    label: 'Google (Gemini)',
    description: 'Lowest-cost option of the three. Generous free tier on aistudio.google.com.',
    getKeyUrl: 'https://aistudio.google.com/apikey',
    models: [
      // SECURITY/COMPAT (audit-B3 fix, 2026-05-25) — default is
      // gemini-1.5-flash, not 2.0. 2.0 is region-gated on
      // aistudio.google.com free-tier accounts and would refuse
      // to save with a confusing 404. 1.5-flash is available
      // everywhere and identical price.
      {
        id: 'gemini-1.5-flash',
        label: 'Standard — Gemini 1.5 Flash',
        tagline: 'Fast + cheap. Day-to-day copy, announcements, ticker text.',
        inputPer1M: 0.075, outputPer1M: 0.30,
        estCostPerCallUsd: estCost(0.075, 0.30),
        default: true,
      },
      {
        id: 'gemini-1.5-pro',
        label: 'Balanced — Gemini 1.5 Pro',
        tagline: 'Longer reasoning runway. Pick for long copy + structured output.',
        inputPer1M: 1.25, outputPer1M: 5.00,
        estCostPerCallUsd: estCost(1.25, 5.00),
      },
      {
        id: 'gemini-2.5-pro',
        label: 'Premium — Gemini 2.5 Pro',
        tagline: 'Top tier. Use for AI-generated template layouts + complex prompts.',
        inputPer1M: 2.50, outputPer1M: 10.00,
        estCostPerCallUsd: estCost(2.50, 10.00),
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

interface DispatchInput {
  apiKey: string;
  /** Catalog model id; falls back to provider default if absent. */
  model?: string;
  system: string;
  userPrompt: string;
  maxTokens: number;
}

interface DispatchOutput {
  raw: string;
  /** Provider-reported errors map to ServiceUnavailableException upstream. */
  errorStatus?: number;
  errorBody?: string;
}

/**
 * Single entrypoint for both providers. Caller passes the system +
 * user prompts; we shape them appropriately and return the raw text
 * response. Caller does the JSON parsing (it's the same on both ends
 * because our system prompts force JSON output).
 */
export async function dispatchAi(
  provider: AiProvider,
  input: DispatchInput,
): Promise<DispatchOutput> {
  // Resolve which model to send. Tenant's saved choice (input.model)
  // takes precedence; falls back to provider default if absent OR if
  // the saved id isn't in our current catalog (model was removed /
  // renamed by the provider; better to fall back to a known-good one
  // than to send a request that 404s).
  const requested = input.model || '';
  const model = isKnownModel(provider, requested) ? requested : defaultModelFor(provider);

  // SECURITY (audit-B2 fix, 2026-05-25) — Node 20's `fetch` has no
  // default timeout. A hung provider would hold an Express handler
  // open indefinitely; with our small Railway dyno + 10-connection
  // Prisma pool this is a trivial DOS. Every provider call below
  // attaches AbortSignal.timeout(15_000) so a stalled upstream
  // aborts in 15s. 15s is enough headroom for a slow Anthropic
  // first-token response without being long enough to chain into
  // a worker pile-up under load.
  const FETCH_TIMEOUT_MS = 15_000;

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
        system: input.system,
        messages: [{ role: 'user', content: input.userPrompt }],
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
    // Use chat completions (not the new /v1/responses) for max compat
    // with operators who configured a key on a non-current account.
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: input.maxTokens,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.userPrompt },
        ],
      }),
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
    // SECURITY (audit-B1 fix, 2026-05-25) — Google supports the key
    // as either a URL query param OR an `x-goog-api-key` header.
    // We use the HEADER so the key never appears in the request URL
    // — Google error responses commonly echo the request URL in
    // `INVALID_ARGUMENT` / quota / 429 bodies, and that body is
    // logged upstream in ai.service.ts:331. Header keeps the key
    // out of `errorBody` entirely.
    //
    // System instruction is a sibling of `contents` in this API,
    // not a message role. maxOutputTokens is camelCase (not
    // max_tokens). gemini-1.5-flash + later support `systemInstruction`;
    // older gemini-pro (which we don't list in the catalog) does not.
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}` +
      `:generateContent`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': input.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: [{ role: 'user', parts: [{ text: input.userPrompt }] }],
        generationConfig: { maxOutputTokens: input.maxTokens, temperature: 0.7 },
      }),
      // SECURITY (audit-B2 fix) — see fetch-timeout note above the
      // anthropic branch.
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      // Belt-and-suspenders against B1: even with the header path
      // above, redact any `key=...` substring that might appear in
      // forwarded error bodies (e.g. Cloudflare interstitials,
      // proxied error pages) before bubbling upstream.
      let errorBody = await res.text().catch(() => '');
      errorBody = errorBody.replace(/[?&]key=[^&\s"']+/g, '&key=REDACTED');
      return { raw: '', errorStatus: res.status, errorBody };
    }
    const json = (await res.json()) as any;
    // Gemini returns parts[] under candidates[0].content.parts.
    const parts = json?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts)
      ? parts.map((p: any) => p?.text ?? '').join('')
      : '';
    return { raw: text };
  }

  // Unreachable given coerceProvider() validates upstream, but keeps
  // the type-checker happy.
  return { raw: '', errorStatus: 400, errorBody: `Unsupported provider: ${provider}` };
}
