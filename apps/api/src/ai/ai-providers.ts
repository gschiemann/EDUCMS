/**
 * AI provider adapters — translate our internal {system, userPrompt}
 * shape into the wire format each provider expects.
 *
 * 2026-09-22 — the MODEL CHOICE and every model-specific REQUEST RULE moved out of this file and
 * into data (ai-model-catalog.ts). This file no longer knows any model by name: it asks the
 * catalog which model serves a tier, and reads that model's capabilities (temperature allowed?
 * which effort knob, which levels? thinking headroom? output ceiling?) to shape the request. A
 * vendor release is picked up by the daily catalog sync without touching this file.
 *
 * Adding a new PROVIDER is still code: the AiProvider union, a branch in dispatchAiMessages, a key
 * shape in validateApiKeyShape, and its family patterns in the catalog.
 *
 * 2026-05-04 BYOK pivot — operators can supply their own keys so cost
 * shifts to them. We still default to Anthropic with our platform key
 * for the trial-mode tenants who haven't configured BYOK yet.
 */

import {
  AI_TIERS,
  conservativeCaps,
  getCatalog,
  learnCapability,
  type AiJob,
  type AiTier,
  type CatalogModel,
  type ModelCapabilities,
  type TokenUsage,
} from './ai-model-catalog';
import { tierForSavedChoice } from './ai-legacy-models';

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
 * Recognize OpenAI "reasoning" models. These use the Chat Completions API
 * but with a DIFFERENT parameter contract: `max_completion_tokens` instead
 * of `max_tokens`, and they reject any non-default `temperature`. Sending
 * the legacy params 400s on every call. The alt-text vision path branches
 * on this too.
 *
 * 2026-09-22 — answered from the catalog's capabilities first. An id the
 * catalog has never seen is treated as reasoning unless it is plainly a
 * gpt-3/gpt-4 family model: every OpenAI model since gpt-5 reasons, and the
 * reasoning contract (`max_completion_tokens`, no temperature) is also
 * valid on the older models, so the conservative answer can never 400.
 */
export function isOpenAiReasoningModel(modelId: string | null | undefined): boolean {
  const id = String(modelId || '').trim().toLowerCase();
  if (!id) return false;
  const known = getCatalog().get('openai', id);
  if (known) return known.caps.effort === 'openai-reasoning-effort' || known.caps.reasoning;
  return !/^(gpt-3|gpt-4|chatgpt-4)/.test(id);
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
 * The model picker the settings UI shows — exposed via GET /ai/key/catalog.
 *
 * 2026-09-22 — built from the LIVE catalog on every request, one entry per tier (the 2026-05-25
 * operator rule: "just give 3 options each, the cheapest for standard stuff, middle for maybe more
 * like text and then max for the designing"). The entry's `id` is whichever model serves that tier
 * TODAY, so when the catalog sync adopts a newer release the picker shows it at the next page load
 * — and a tenant's saved choice (stored as the TIER, see `tierForSavedChoice`) moves with it.
 *
 * Cost numbers are USD per 1M tokens (input / output). `estCostPerCallUsd` is our typical
 * 300-token output generation, treated conservatively as all-output so the operator never sees a
 * number that surprises them upward.
 */
export interface AiModelInfo {
  /** Wire model id sent to the provider (the exact string the API expects). */
  id: string;
  /** Tier this entry represents — what a save persists, so the choice auto-upgrades. */
  tier: AiTier;
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

function estCost(outputPer1M: number): number {
  return (outputPer1M / 1_000_000) * PER_CALL_OUTPUT_TOKENS;
}

const TIER_COPY: Record<AiTier, { word: string; tagline: string }> = {
  standard: { word: 'Standard', tagline: 'Best for everyday copy and announcements.' },
  balanced: { word: 'Balanced', tagline: 'Better for longer copy.' },
  premium: { word: 'Premium', tagline: 'Best for AI-generated template designs.' },
};

const PROVIDER_COPY: Record<AiProvider, Omit<AiProviderInfo, 'models' | 'id'>> = {
  anthropic: {
    label: 'Anthropic (Claude)',
    description: 'Recommended.',
    getKeyUrl: 'https://console.anthropic.com/settings/keys',
  },
  openai: {
    label: 'OpenAI (GPT)',
    description: 'Use if you already have an OpenAI account.',
    getKeyUrl: 'https://platform.openai.com/api-keys',
  },
  google: {
    label: 'Google (Gemini)',
    description: 'Cheapest. Generous free tier.',
    getKeyUrl: 'https://aistudio.google.com/apikey',
  },
};

export function aiProvidersForUi(): AiProviderInfo[] {
  const cat = getCatalog();
  return (['anthropic', 'openai', 'google'] as AiProvider[]).map((provider) => ({
    id: provider,
    ...PROVIDER_COPY[provider],
    models: AI_TIERS.map((tier) => {
      const m = cat.resolveTier(provider, tier).model;
      return {
        id: m.id,
        tier,
        label: `${TIER_COPY[tier].word} — ${m.label}`,
        tagline: TIER_COPY[tier].tagline,
        inputPer1M: m.inputPer1M,
        outputPer1M: m.outputPer1M,
        estCostPerCallUsd: estCost(m.outputPer1M),
        ...(tier === 'standard' ? { default: true } : {}),
      };
    }),
  }));
}

/** The cheapest good model for a provider (its Standard tier, resolved live). */
export function defaultModelFor(provider: AiProvider): string {
  return getCatalog().resolveTier(provider, 'standard').model.id;
}

/**
 * Would we accept this as a model choice for the provider? A tier key ('premium'), or any model
 * the catalog can currently send. Free-text ids stay refused — a typo must never route a tenant's
 * key to an unsupported endpoint or an unexpected price.
 */
export function isKnownModel(provider: AiProvider, modelId: string): boolean {
  if (!modelId) return false;
  if ((AI_TIERS as readonly string[]).includes(modelId)) return true;
  const cat = getCatalog();
  return cat.isUsable(cat.get(provider, modelId));
}

/**
 * Resolve a SAVED tenant choice (a tier key, a current id, or an id the vendor has since retired)
 * to the model that serves that tier TODAY. Never throws and never returns a dead id: an unknown
 * value resolves to the Standard tier, the cheapest safe choice.
 */
export function healLegacyModelId(provider: AiProvider, modelId: unknown): string {
  return getCatalog().resolveTier(provider, tierForSavedChoice(provider, modelId)).model.id;
}

/** Which model serves a tier right now, and the verified fallback if the provider refuses it. */
export function modelForTier(provider: AiProvider, tier: AiTier): { model: CatalogModel; fallback: CatalogModel | null } {
  return getCatalog().resolveTier(provider, tier);
}

interface DispatchInput {
  apiKey: string;
  /** Model id to send; falls back to the provider's Standard tier if absent or unknown. */
  model?: string;
  /**
   * A verified model to retry with ONCE if the provider refuses `model` (404 / model-invalid) —
   * what makes adopting a brand-new release safe on the first call.
   */
  fallbackModel?: string;
  /** What the call is for — picks the effort level where the model has the knob. */
  job?: AiJob;
  system: string;
  userPrompt: string;
  maxTokens: number;
  /**
   * OPTIONAL hard override for the abort ceiling (ms). When set, this wins
   * over the model-aware ceiling below — for a caller that KNOWS its call is
   * cheap/small (e.g. the brief-extraction pass, ≤500 tokens) and wants a
   * short, snappy timeout even on a slow reasoning model rather than
   * inheriting its generous multi-minute ceiling. Never used to make a call
   * wait LONGER than the model-aware ceiling would — only shorter.
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
  /** Model id to send; falls back to the provider's Standard tier if absent or unknown. */
  model?: string;
  /** See DispatchInput.fallbackModel. */
  fallbackModel?: string;
  /** See DispatchInput.job. */
  job?: AiJob;
  system: string;
  /** See DispatchInput.timeoutMs — same optional hard override, single-turn or multi-turn. */
  timeoutMs?: number;
  /** Full conversation so far, oldest first. MUST start with a `user` turn. */
  messages: DispatchMessage[];
  maxTokens: number;
}

export interface DispatchOutput {
  raw: string;
  /** Provider-reported errors map to ServiceUnavailableException upstream. */
  errorStatus?: number;
  errorBody?: string;
  /** The catalog model id the request was sent as (what usage is PRICED at). */
  model?: string;
  /** Token usage the provider reported for the call that produced `raw` (absent on errors). */
  usage?: TokenUsage;
  /** Set when the first-choice model was refused and `fallbackModel` answered instead. */
  failedModel?: string;
  /**
   * The vendor DECLINED the request on content grounds (Claude stop_reason=refusal, an OpenAI
   * `refusal`, a Gemini safety block). A content decision, not an outage: it never fails over to
   * another vendor — shopping a declined prompt around is not ours to do.
   */
  refusal?: boolean;
  /** Wall-clock time of the provider call(s), ms. */
  durationMs?: number;
}

/**
 * Single-turn entrypoint — the original {system, userPrompt} shape every
 * generation surface uses. Thin wrapper over dispatchAiMessages with a
 * one-element user-message array.
 */
export async function dispatchAi(
  provider: AiProvider,
  input: DispatchInput,
): Promise<DispatchOutput> {
  return dispatchAiMessages(provider, {
    apiKey: input.apiKey,
    model: input.model,
    fallbackModel: input.fallbackModel,
    job: input.job,
    system: input.system,
    messages: [{ role: 'user', content: input.userPrompt }],
    maxTokens: input.maxTokens,
    timeoutMs: input.timeoutMs,
  });
}

// Temperature parity (2026-05-29 audit §3) — models that TAKE a temperature
// all get the same 0.7: signage copy varied without the off-the-rails drift of
// 1.0. Models that reject one (Claude 5, OpenAI reasoning, Gemini 3 guidance)
// get none — that is a capability, not a provider branch, since 2026-09-22.
const TEMPERATURE = 0.7;

// A reasoning model's thinking tokens count against its output ceiling. The
// caller's maxTokens is the VISIBLE size it wants, so reasoning models get this
// much on top (billed only on tokens actually produced; a high ceiling only
// prevents the empty-reply truncation of 2026-06-28).
const REASONING_HEADROOM_TOKENS = 12_000;

interface RequestShape {
  /** Output ceiling to send (visible budget + reasoning headroom, clamped to the model max). */
  maxOutput: number;
  temperature: number | null;
  effort: string | null;
}

function shapeFor(model: CatalogModel, visibleMaxTokens: number, job: AiJob, drop: Set<string>): RequestShape {
  const caps: ModelCapabilities = model.caps;
  const visible = Math.max(1, Math.floor(visibleMaxTokens || 1000));
  let maxOutput = caps.reasoning && !drop.has('headroom') ? visible + REASONING_HEADROOM_TOKENS : visible;
  if (caps.maxOutputTokens) maxOutput = Math.min(maxOutput, caps.maxOutputTokens);
  return {
    maxOutput: Math.max(1, maxOutput),
    temperature: caps.temperature && !drop.has('temperature') ? TEMPERATURE : null,
    effort: drop.has('effort') ? null : getCatalog().effortFor(model, job),
  };
}

/**
 * The abort ceiling scales with the WORK requested and the kind of model.
 *
 * History, all of it still true: the old flat 15s aborted every gpt-5 call (2026-06-28); a flat
 * 90s still aborted three parallel 16k-token designer boards (2026-06-30 prod incident), so the
 * ceiling became base + per-visible-token, hard-capped at 240s — UNDER Railway's 300s edge limit
 * (we don't stream; a request with no bytes flowing is closed by the edge proxy after 300s, so a
 * longer ceiling would only trade our clean 503 for an opaque reset). AI calls are user-initiated
 * and capped per hour, so a long ceiling cannot pile up workers.
 *
 * 2026-09-22: the per-token term now applies to fast models too. A fast model asked for a full
 * 16k-token board used to get a flat 30s — shorter than it takes any model to write one.
 */
function timeoutFor(model: CatalogModel, visibleMaxTokens: number, callerTimeoutMs?: number): number {
  const visible = Math.max(1, visibleMaxTokens || 1000);
  const slow = model.caps.reasoning || model.outputPer1M >= 15;
  const ceiling = slow ? Math.min(240_000, 90_000 + visible * 9) : Math.min(240_000, 30_000 + visible * 5);
  return typeof callerTimeoutMs === 'number' && callerTimeoutMs > 0 ? Math.min(callerTimeoutMs, ceiling) : ceiling;
}

/** Does this provider error say the MODEL is the problem (unknown, retired, not on this account)? */
export function isModelRefusal(status: number, body: string): boolean {
  if (status === 404) return true;
  if (status !== 400 && status !== 403) return false;
  return /model/i.test(body) && /not[\s_-]?found|does not exist|do not have access|not available|unknown|invalid|unsupported|not supported|deprecated|retired/i.test(body);
}

/**
 * Which optional parameter a 400 is complaining about, if it is one we sent. Lets a model whose
 * rules changed (or a feed-discovered model with no verified rules) self-correct on the first call
 * instead of failing every call until someone edits code.
 */
function rejectedParameter(provider: AiProvider, status: number, body: string, shape: RequestShape, headroomUsed: boolean): 'temperature' | 'effort' | 'headroom' | null {
  if (status !== 400) return null;
  if (shape.temperature !== null && /temperature/i.test(body)) return 'temperature';
  if (shape.effort !== null) {
    const effortRe =
      provider === 'anthropic'
        ? /output_config|effort/i
        : provider === 'openai'
          ? /reasoning_effort|reasoning\.effort|reasoning effort/i
          : /thinking_?level|thinkingConfig|thinking_config|thinking level/i;
    if (effortRe.test(body)) return 'effort';
  }
  if (headroomUsed && /max_tokens|max_completion_tokens|maxOutputTokens|max_output_tokens|output tokens/i.test(body)) {
    return 'headroom';
  }
  return null;
}

/**
 * Multi-turn entrypoint — same provider shaping as the single-turn path
 * but accepts a full {role,content}[] conversation so a stateful surface
 * (the signage concierge) can hold a real back-and-forth. Anthropic and
 * OpenAI take the array verbatim (assistant turns become assistant
 * messages); Google maps the `assistant` role to its `model` role.
 */
export async function dispatchAiMessages(
  provider: AiProvider,
  input: DispatchMessagesInput,
): Promise<DispatchOutput> {
  // Defensive: every provider requires a non-empty conversation. Callers
  // always pass at least one user turn, but guard so a bad caller gets a
  // clean envelope instead of an opaque provider 400.
  const turns = (input.messages || []).filter(
    (m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.length > 0,
  );
  if (turns.length === 0) {
    return { raw: '', errorStatus: 400, errorBody: 'No conversation messages supplied.' };
  }

  const cat = getCatalog();
  // A model the catalog cannot send (unknown, failed, retiring) falls back to the provider's
  // Standard tier — better a known-good model than a request that 404s.
  const requested = input.model ? cat.get(provider, input.model) : null;
  const first: CatalogModel = cat.isUsable(requested) ? requested : cat.resolveTier(provider, 'standard').model;
  if (input.model && first.id !== input.model) {
    // A model id this vendor's catalog cannot send (unknown, failed, retiring — or another vendor's
    // id) never goes to the wire; say so, because upstream it means a routing mistake.
    console.warn(`[ai-providers] ${provider} cannot send "${input.model}" — using ${first.id} instead`);
  }
  const fallbackEntry = input.fallbackModel ? cat.get(provider, input.fallbackModel) : null;
  const fallback = fallbackEntry && fallbackEntry.id !== first.id ? fallbackEntry : null;
  const job: AiJob = input.job || 'fast';
  const started = Date.now();

  let model = first;
  let failedModel: string | undefined;
  const drop = new Set<string>();
  let attempts = 0;
  // At most: one self-correcting retry for a rejected parameter, and one fallback to a verified
  // model if the provider refuses the model itself.
  for (;;) {
    attempts += 1;
    const shape = shapeFor(model, input.maxTokens, job, drop);
    const out = await callProvider(provider, model, shape, input, turns, timeoutFor(model, input.maxTokens, input.timeoutMs));
    if (!out.errorStatus) {
      return { ...out, model: model.id, failedModel, durationMs: Date.now() - started };
    }
    const body = out.errorBody || '';
    if (attempts <= 2) {
      const param = rejectedParameter(provider, out.errorStatus, body, shape, shape.maxOutput > Math.max(1, input.maxTokens || 1000));
      if (param && !drop.has(param)) {
        drop.add(param);
        if (param === 'temperature') learnCapability(provider, model.id, { temperature: false });
        if (param === 'effort') learnCapability(provider, model.id, { effort: null, effortLevels: [] });
        continue;
      }
    }
    if (!failedModel && fallback && isModelRefusal(out.errorStatus, body)) {
      failedModel = model.id;
      model = fallback;
      drop.clear();
      attempts = 0;
      continue;
    }
    return { ...out, model: model.id, failedModel, durationMs: Date.now() - started };
  }
}

/** Gemini finishReasons that mean "declined on content grounds" (RECITATION is not one: it is about the output, not the request). */
const GEMINI_DECLINE_REASONS = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'IMAGE_SAFETY']);

async function callProvider(
  provider: AiProvider,
  model: CatalogModel,
  shape: RequestShape,
  input: DispatchMessagesInput,
  turns: DispatchMessage[],
  timeoutMs: number,
): Promise<Omit<DispatchOutput, 'model' | 'failedModel' | 'durationMs'>> {
  if (provider === 'anthropic') {
    const body: Record<string, any> = {
      model: model.id,
      max_tokens: shape.maxOutput,
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
    };
    if (shape.temperature !== null) body.temperature = shape.temperature;
    // Claude 5: effort is the thinking control (no `thinking` field — it 400s on Opus 5.5), no
    // beta header needed. A model without the knob gets nothing.
    if (shape.effort) body.output_config = { effort: shape.effort };
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': input.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      return { raw: '', errorStatus: res.status, errorBody };
    }
    const json = (await res.json()) as any;
    // Responses from thinking models START with thinking blocks — select the answer by TYPE, never
    // by position (content[0] is a thinking block on Claude 5).
    const text = textFromResponse('anthropic', json);
    const usage = usageFromResponse('anthropic', json);
    if (!text.trim()) {
      const stop = json?.stop_reason || 'no_text';
      return {
        raw: '',
        usage,
        errorStatus: 502,
        ...(stop === 'refusal' ? { refusal: true } : {}),
        errorBody:
          stop === 'refusal'
            ? `Claude declined this request (stop_reason=refusal, model=${model.id}).`
            : `Claude returned no text (stop_reason=${stop}, model=${model.id}).`,
      };
    }
    return { raw: text, usage };
  }

  if (provider === 'openai') {
    // Chat Completions for max compat. Every model gets `max_completion_tokens` (OpenAI deprecated
    // `max_tokens`, and reasoning models reject it); reasoning models get headroom on top of the
    // visible budget because their internal reasoning counts against it (2026-06-28 empty-reply
    // fix), and `reasoning_effort` from the catalog (low for our work — signage copy and boards
    // are not math proofs, and low keeps them fast and cheap).
    const body: Record<string, any> = {
      model: model.id,
      messages: [
        { role: 'system', content: input.system },
        ...turns.map((m) => ({ role: m.role, content: m.content })),
      ],
      max_completion_tokens: shape.maxOutput,
    };
    if (shape.effort) body.reasoning_effort = shape.effort;
    if (shape.temperature !== null) body.temperature = shape.temperature;
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      return { raw: '', errorStatus: res.status, errorBody };
    }
    const json = (await res.json()) as any;
    const usage = usageFromResponse('openai', json);
    const text = textFromResponse('openai', json);
    if (!text.trim()) {
      // 200 OK with no usable text: a refusal (content null + message.refusal), or a reasoning
      // model that spent its whole budget thinking (finish_reason=length). Same envelope as the
      // Claude and Gemini branches, so an empty answer is an error, never a silent ''.
      const choice = json?.choices?.[0];
      const refused = typeof choice?.message?.refusal === 'string' && choice.message.refusal.trim() !== '';
      return {
        raw: '',
        usage,
        errorStatus: 502,
        ...(refused ? { refusal: true } : {}),
        errorBody: refused
          ? `OpenAI declined this request (refusal, model=${model.id}).`
          : `OpenAI returned no text (finish_reason=${choice?.finish_reason || 'no_text'}, model=${model.id}).`,
      };
    }
    return { raw: text, usage };
  }

  if (provider === 'google') {
    // Google Generative Language API (Gemini).
    //
    // SECURITY (audit-B1 fix, 2026-05-25) — pass the key as the
    // `x-goog-api-key` header (not a URL query param) so it never appears
    // in error bodies. System instruction is a sibling of `contents`, not
    // a message role; assistant turns use the `model` role.
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.id)}` +
      `:generateContent`;
    // Gemini 3 thinks by default and its thought tokens count against maxOutputTokens (a hard
    // cutoff), so the ceiling carries headroom and `thinkingLevel` keeps the thinking short.
    // Temperature stays at the model default — Google's Gemini 3 guidance.
    const genConfig: Record<string, any> = { maxOutputTokens: shape.maxOutput };
    if (shape.temperature !== null) genConfig.temperature = shape.temperature;
    if (shape.effort) genConfig.thinkingConfig = { thinkingLevel: shape.effort };
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
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      // Belt-and-suspenders: redact any `key=...` substring that might
      // appear in forwarded error bodies before bubbling upstream.
      let errorBody = await res.text().catch(() => '');
      errorBody = errorBody.replace(/[?&]key=[^&\s"']+/g, '&key=REDACTED');
      return { raw: '', errorStatus: res.status, errorBody };
    }
    const json = (await res.json()) as any;
    // Thinking bills as output on Gemini (usageFromResponse adds thoughtsTokenCount).
    const usage = usageFromResponse('google', json);
    const text = textFromResponse('google', json);
    if (!text.trim()) {
      // 200 OK but no usable text — almost always finishReason=MAX_TOKENS
      // (thinking exhausted the budget) or a SAFETY/RECITATION block.
      // Surface it as an error envelope rather than a silent ''.
      const blockReason = json?.promptFeedback?.blockReason;
      const finish = json?.candidates?.[0]?.finishReason || blockReason || 'NO_TEXT';
      // A blocked prompt, or an answer stopped for safety / prohibited content, is Google declining
      // the request — not the model running out of budget.
      const refused = !!blockReason || GEMINI_DECLINE_REASONS.has(String(finish));
      return {
        raw: '',
        usage,
        errorStatus: 502,
        ...(refused ? { refusal: true } : {}),
        errorBody: `Gemini returned no text (finishReason=${finish}, model=${model.id})`,
      };
    }
    return { raw: text, usage };
  }

  // Unreachable given coerceProvider() validates upstream, but keeps
  // the type-checker happy.
  return { raw: '', errorStatus: 400, errorBody: `Unsupported provider: ${provider}` };
}

// ─── For callers that build their own request bodies (the vision calls) ─────────────────────
/**
 * The model an image-reading call runs on: the provider's Standard tier when it takes images
 * (it does today on all three), else the first tier that does. Alt text, "Upload a look" and menu
 * photos are `fast` jobs — they auto-upgrade with the Standard tier like every other fast job.
 */
export function visionModelFor(provider: AiProvider): string {
  const cat = getCatalog();
  for (const tier of AI_TIERS) {
    const m = cat.resolveTier(provider, tier).model;
    if (m.caps.vision) return m.id;
  }
  return cat.resolveTier(provider, 'standard').model.id;
}

/**
 * The capability-driven request fragments for `modelId` — exactly the rules dispatchAiMessages
 * applies (temperature only where accepted, the model's own effort knob, reasoning headroom on
 * the output ceiling) — for a caller that assembles its own body around image content.
 *   anthropic → { max_tokens, temperature?, output_config? }
 *   openai    → { max_completion_tokens, reasoning_effort?, temperature? }
 *   google    → { generationConfig: { maxOutputTokens, temperature?, thinkingConfig? } }
 */
export function requestParamsFor(
  provider: AiProvider,
  modelId: string,
  visibleMaxTokens: number,
  job: AiJob = 'fast',
): Record<string, any> {
  const known = getCatalog().get(provider, modelId);
  const model: CatalogModel = known || {
    provider,
    id: modelId,
    label: modelId,
    family: null,
    version: [],
    releasedAt: null,
    inputPer1M: 0,
    outputPer1M: 0,
    caps: conservativeCaps(),
    status: 'unverified',
    retiresAt: null,
    source: 'feed',
  };
  const shape = shapeFor(model, visibleMaxTokens, job, new Set());
  if (provider === 'anthropic') {
    return {
      max_tokens: shape.maxOutput,
      ...(shape.temperature !== null ? { temperature: shape.temperature } : {}),
      ...(shape.effort ? { output_config: { effort: shape.effort } } : {}),
    };
  }
  if (provider === 'openai') {
    return {
      max_completion_tokens: shape.maxOutput,
      ...(shape.effort ? { reasoning_effort: shape.effort } : {}),
      ...(shape.temperature !== null ? { temperature: shape.temperature } : {}),
    };
  }
  const generationConfig: Record<string, any> = { maxOutputTokens: shape.maxOutput };
  if (shape.temperature !== null) generationConfig.temperature = shape.temperature;
  if (shape.effort) generationConfig.thinkingConfig = { thinkingLevel: shape.effort };
  return { generationConfig };
}

/** The answer text of a provider reply — by block TYPE (thinking models lead with thinking blocks). */
export function textFromResponse(provider: AiProvider, json: any): string {
  if (provider === 'anthropic') {
    const blocks: any[] = Array.isArray(json?.content) ? json.content : [];
    return blocks
      .filter((b) => b && (b.type === 'text' || (b.type === undefined && typeof b.text === 'string')))
      .map((b) => b.text || '')
      .join('');
  }
  if (provider === 'openai') {
    const c = json?.choices?.[0]?.message?.content;
    return typeof c === 'string' ? c : '';
  }
  const parts = json?.candidates?.[0]?.content?.parts;
  return Array.isArray(parts) ? parts.filter((p: any) => !p?.thought).map((p: any) => p?.text ?? '').join('') : '';
}

/** Token usage a provider reply reports (what the usage ledger prices). */
export function usageFromResponse(provider: AiProvider, json: any): TokenUsage {
  if (provider === 'anthropic') {
    return {
      inputTokens: Number(json?.usage?.input_tokens) || 0,
      outputTokens: Number(json?.usage?.output_tokens) || 0,
      cacheReadTokens: Number(json?.usage?.cache_read_input_tokens) || 0,
      cacheWriteTokens: Number(json?.usage?.cache_creation_input_tokens) || 0,
    };
  }
  if (provider === 'openai') {
    // `prompt_tokens` counts every input token once, and each falls in exactly one price bucket:
    // uncached, cached (read), or cache WRITE (GPT-5.6 and later bill writes at 1.25x). costMicros
    // applies each model's own ratios.
    const prompt = Number(json?.usage?.prompt_tokens) || 0;
    const details = json?.usage?.prompt_tokens_details || {};
    const cached = Math.min(prompt, Number(details.cached_tokens) || 0);
    const written = Math.min(prompt - cached, Number(details.cache_write_tokens) || 0);
    return {
      inputTokens: prompt - cached - written,
      outputTokens: Number(json?.usage?.completion_tokens) || 0,
      ...(cached ? { cacheReadTokens: cached } : {}),
      ...(written ? { cacheWriteTokens: written } : {}),
    };
  }
  const meta = json?.usageMetadata || {};
  return {
    inputTokens: Number(meta.promptTokenCount) || 0,
    outputTokens: (Number(meta.candidatesTokenCount) || 0) + (Number(meta.thoughtsTokenCount) || 0),
  };
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
