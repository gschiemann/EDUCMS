/**
 * AiService — multi-provider content generation for signage operators.
 *
 * 2026-05-04 BYOK pivot — operators can configure their OWN provider
 * credentials in Settings → Integrations, and AI generations route
 * through their account at their cost. Platform ANTHROPIC_API_KEY
 * stays as a free-trial fallback for tenants who haven't configured.
 *
 * Resolution order at generate() time:
 *   1) Tenant has a stored key (ai_key_encrypted) → decrypt + use
 *      with their chosen provider (anthropic | openai)
 *   2) Else fall back to process.env.ANTHROPIC_API_KEY (platform
 *      free-trial) on Anthropic
 *   3) Else throw 503 "AI is not configured" (current friendly error)
 *
 * Cost guardrails (apply regardless of who pays):
 *   - Per-tenant rate limit: 30 generations / hour (in-memory, soft)
 *   - max_tokens: 300 — caps spend at ~$0.005/call on either provider
 *
 * What it generates:
 *   - announcement   — eye-catching message for an ANNOUNCEMENT widget
 *   - quote          — motivational line for a fitness widget
 *   - menu_item      — short, appetizing description for a menu item
 *   - promo          — daily-special promo for a SPECIALS_CALLOUT widget
 *   - daypart        — auto-suggest breakfast/lunch/dinner copy by hour
 *   - ticker         — short scrolling-ticker line
 */

import { Injectable, Logger, BadRequestException, ServiceUnavailableException, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { dispatchAi, mapProviderQuotaError, type AiProvider, coerceProvider } from './ai-providers';
import {
  aiWindowCount,
  aiRecordEvent,
  AI_RL_SUCCESS_PREFIX,
  AI_HOURLY_WINDOW_MS,
} from './ai-hourly-cap';
import { openAiKey } from './ai-key-cipher';
import { isVertical } from '@cms/api-types';
// SECURITY (audit-B4 fix, 2026-05-25) — AI-generated touch actions
// can include `open-url` / `webhook` targets. Without an SSRF guard,
// a prompt-injection attacker could coax the model into emitting
// `https://169.254.169.254/...` (AWS metadata), `https://10.0.0.x/...`
// (private LAN), or DNS-rebinding hosts. Those would persist into
// the template and fire at player render time — turning user
// prompts into an SSRF primitive. validatePublicUrl does the same
// host/IP-range check the branding scraper uses (loopback, link-
// local, RFC1918, ULA, IPv6 ::1, 0.0.0.0, multicast, etc.).
import { validatePublicUrl } from '../branding/safe-fetch';

// Audit-W5 fix (2026-05-25) — error-message helper. Was inlined
// `provider === 'anthropic' ? 'Anthropic' : 'OpenAI'` three times,
// which collapsed Google → "OpenAI" so a Google-keyed tenant got
// "Your OpenAI API key was rejected." Centralized here so adding
// providers later doesn't reintroduce the bug.
function providerDisplayName(p: AiProvider): string {
  if (p === 'anthropic') return 'Anthropic';
  if (p === 'openai') return 'OpenAI';
  if (p === 'google') return 'Google';
  return p;
}

export type AiIntent =
  | 'announcement'
  | 'quote'
  | 'menu_item'
  | 'promo'
  | 'daypart'
  | 'ticker';

export interface AiGenerateRequest {
  intent: AiIntent;
  /** Free-text context the operator types in. e.g. "spring break sale" or
   *  "introduce our new pour-over coffee station". Required. */
  context: string;
  /** Tone hint — defaults to whatever fits the intent. */
  tone?: 'energetic' | 'elegant' | 'playful' | 'serious' | 'casual';
  /** Number of options to return. Default 3. Max 5. */
  count?: number;
  /** Optional vertical hint so a gym promo doesn't read like a school
   *  announcement. Drives the system prompt. */
  vertical?: string;
}

export interface AiGenerateResponse {
  options: Array<{ text: string; tag?: string }>;
  intent: AiIntent;
}

const SYSTEM_PROMPTS: Record<AiIntent, string> = {
  announcement:
    'You write punchy digital-signage announcements for venues — schools, gyms, restaurants, retail, bars, corporate lobbies. Outputs are short, scannable from across a room, friendly but professional. Headline ≤8 words. Body ≤25 words. Never use clickbait, emoji, or all-caps gimmicks.',
  quote:
    'You write motivational one-liners for gym / fitness / wellness signage. ≤15 words. Specific, not vague — reference effort, consistency, recovery, or process, not generic "you got this" filler. Avoid clichés like "no pain no gain" or "rise and grind".',
  menu_item:
    'You write appetizing menu-item descriptions for restaurant signage. ≤18 words. Lead with technique or hero ingredient. Concrete sensory language (textures, smells, temperatures). Never use "delicious" or "amazing" — show, don\'t tell.',
  promo:
    'You write today-only promo cards for digital signage. Hook in ≤6 words, supporting line ≤20 words, optional price callout. Drive urgency without being sleazy. No "act now!!!", no exclamation pile-ons.',
  daypart:
    'You write daypart-specific copy for restaurant signage — breakfast, lunch, brunch, happy-hour, dinner, late-night. Match the energy of the meal. ≤20 words total. Time-of-day appropriate.',
  ticker:
    'You write scrolling-ticker lines for digital signage. ≤12 words per line. Information-dense. Multiple lines should each stand alone. No emoji.',
};

/**
 * Per-vertical VOICE clauses (audit §3/§14, 2026-05-30).
 *
 * Previously the vertical was a one-line USER-prompt hint
 * (`Vertical: gym`) — easy for the model to ignore, so a SPORTS
 * scoreboard hype line read the same as a K-12 lobby notice. These
 * clauses get PREPENDED to the intent system prompt (composeSystemPrompt
 * below) so tone is anchored in the always-obeyed system role.
 *
 * Keyed by the canonical VERTICALS enum (packages/api-types). Kept to a
 * single sentence each so the map stays maintainable and the cached
 * system block stays small. Verticals without an entry fall through to
 * a neutral default — never an error (the vertical is already validated
 * against isVertical() upstream, so an unknown key here just means
 * "no specialized voice yet", which is safe).
 */
const VERTICAL_VOICE: Record<string, string> = {
  K12:
    'AUDIENCE — a K-12 school: students, parents, teachers, staff. Voice: warm, encouraging, plainly informative; safe for all ages; never slangy or salesy.',
  SPORTS:
    'AUDIENCE — a live sports venue / athletic program: fans, players, a game-day crowd. Voice: high-energy, bold, hype; build crowd excitement; rally and celebrate without trash-talk or profanity.',
  GYM:
    'AUDIENCE — a gym / fitness club: members mid-workout. Voice: energizing and motivating, direct, action-oriented; nod to effort, progress, and consistency.',
  RESTAURANT:
    'AUDIENCE — a full-service restaurant: diners. Voice: appetizing and sensory, hospitable, a touch elevated; make the food and the experience the hero.',
  QSR:
    'AUDIENCE — a quick-service restaurant: fast-moving customers. Voice: fast, crave-able, value-forward; short and punchy; speed and tastiness over fine-dining prose.',
  BAR:
    'AUDIENCE — a bar / taproom / nightclub: an adult crowd (21+). Voice: lively, social, fun, a little cheeky; happy-hour and game-day energy; tasteful, never reckless about alcohol.',
  RETAIL:
    'AUDIENCE — a retail store: shoppers. Voice: clear and benefit-led, lightly promotional; drive footfall and highlight the offer without pressure.',
  FASHION:
    'AUDIENCE — a fashion / boutique brand: style-conscious shoppers. Voice: chic, aspirational, trend-aware, minimal; let the product feel premium.',
  CORPORATE:
    'AUDIENCE — a corporate lobby / internal comms: employees and visitors. Voice: polished, professional, concise, on-brand; informative over flashy.',
  HEALTHCARE:
    'AUDIENCE — a healthcare facility: patients, families, staff. Voice: calm, clear, reassuring, accessible; plain language; never alarmist or jokey.',
  HOSPITALITY:
    'AUDIENCE — a hotel / hospitality venue: guests. Voice: gracious, welcoming, refined, helpful; make guests feel looked-after.',
  WORSHIP:
    'AUDIENCE — a house of worship: a congregation. Voice: warm, sincere, inclusive, uplifting; respectful and community-minded; never commercial.',
};

/**
 * Compose the final system prompt for a generation: prepend the
 * vertical's voice clause (if any) to the intent's base prompt. The
 * vertical arrives already validated against isVertical() in
 * generateInner; we upper-case + look it up here. Unknown / absent
 * verticals → the bare intent prompt (current behavior), so this is a
 * pure additive enhancement with no regression for the default path.
 */
function composeSystemPrompt(intent: AiIntent, vertical?: string): string {
  const base = SYSTEM_PROMPTS[intent];
  const key = (vertical || '').trim().toUpperCase();
  const voice = key ? VERTICAL_VOICE[key] : undefined;
  return voice ? `${voice}\n\n${base}` : base;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // P1-14 (2026-05-28 audit) — both per-tenant hourly caps moved from
  // in-memory Maps to Redis sorted sets so they hold ACROSS replicas.
  // Railway runs >1 dyno under load; an in-memory cap is N×-bypassable
  // (each replica enforces its own 30/200). The sorted-set members are
  // timestamps; we ZADD on each event, ZREMRANGEBYSCORE-prune the
  // 1h window, and ZCARD to count. PEXPIRE garbage-collects idle keys
  // so the keyspace can't grow unbounded across long-lived tenants
  // (the old Map prune-on-empty did the same job process-locally).
  //
  // FAIL-OPEN policy (documented degradation): if Redis is unreachable
  // these caps are SKIPPED, not enforced — we never block a paying-
  // customer generation on a Redis blip. Both caps are abuse/runaway
  // guards, not the cost ceiling. The real spend ceiling is the
  // MONTHLY platform cap (Tenant.aiPlatformUsage* in Postgres, which
  // is durable + replica-safe already) PLUS max_tokens=300/1500 per
  // call. So a Redis outage can let a tenant briefly exceed 30/hr,
  // but it can NOT let them exceed the monthly platform credit budget.
  private readonly HOURLY_CAP = 30;
  private readonly HOURLY_FAILURE_CAP = 200;
  private readonly WINDOW_MS = AI_HOURLY_WINDOW_MS;
  // Redis key prefixes. Tenant id is appended. Kept distinct from any
  // realtime/pubsub keyspace so a tenant scan can't collide.
  //
  // The SUCCESS prefix is the SHARED constant from ai-hourly-cap.ts —
  // the 30/hr cap is one per-tenant ceiling across sparkle, touch-
  // template, AND alt-text (audit §3 P3). The FAILURE prefix is local
  // (abuse guard, not shared).
  private readonly RL_SUCCESS_PREFIX = AI_RL_SUCCESS_PREFIX;
  private readonly RL_FAILURE_PREFIX = 'ai:rl:fail:';

  /**
   * Count events in the trailing 1h window for a tenant. Delegates to the
   * shared sliding-window helper (ai-hourly-cap.ts) so the success-cap
   * window is byte-identical across every AI surface. Fails OPEN
   * (returns 0) when Redis is unavailable.
   */
  private async windowCount(prefix: string, tenantId: string): Promise<number> {
    return aiWindowCount(this.redis.publisher, tenantId, prefix);
  }

  /**
   * Record one event in the tenant's sliding window. Delegates to the
   * shared helper. Best-effort — never throws.
   */
  private async recordEvent(prefix: string, tenantId: string): Promise<void> {
    await aiRecordEvent(this.redis.publisher, tenantId, prefix);
  }

  /**
   * Audit-W1 fix — register a failure of any kind against the per-
   * tenant cap. Now Redis-backed (P1-14) so the failure ceiling holds
   * across replicas. Call at every catch / bad-input branch in
   * generate() and generateTouchTemplate().
   *
   * The threat model is "stop one tenant from looping bad calls for
   * free" — the AUTHED endpoint already has RBAC + session controls
   * upstream. Fail-open on Redis loss is acceptable (a blip doesn't
   * let bad calls hit the upstream provider any faster than the
   * monthly platform cap allows).
   */
  private async recordFailure(tenantId: string): Promise<void> {
    await this.recordEvent(this.RL_FAILURE_PREFIX, tenantId);
  }
  private async checkFailureCap(tenantId: string): Promise<void> {
    const count = await this.windowCount(this.RL_FAILURE_PREFIX, tenantId);
    if (count >= this.HOURLY_FAILURE_CAP) {
      throw new HttpException(
        {
          message: 'Too many failed AI requests in the last hour. Wait an hour or contact support.',
          code: 'AI_FAILURE_CAP_REACHED',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Monthly platform-paid generation cap per tenant. The Canva /
   * OptiSigns / Notion model — platform pays, capped per tenant per
   * calendar month, BYOK admins bypass the cap entirely (their cost,
   * their unlimited).
   *
   * Tunable via AI_FREE_TIER_CAP env var without a deploy migration.
   * 200/mo at Haiku 300-token output ≈ $1/tenant/mo at full burn,
   * which is the budget envelope we sized for.
   */
  private get freeTierCap(): number {
    const fromEnv = parseInt(process.env.AI_FREE_TIER_CAP || '', 10);
    return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 200;
  }

  /** Current UTC month as 'YYYY-MM' for usage bucket key. */
  private currentMonthKey(): string {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  /**
   * Read the tenant's current-month platform usage. Returns 0 if the
   * stored bucket is from a previous month (auto-reset on rollover —
   * no cron). BYOK tenants are not tracked; they pass null here and
   * the caller skips the cap check.
   */
  private async readPlatformUsage(tenantId: string): Promise<{ used: number; cap: number; resetAt: string }> {
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: { aiPlatformUsageMonth: true, aiPlatformUsageCount: true } as any,
    }) as any;
    const monthKey = this.currentMonthKey();
    const used = tenant?.aiPlatformUsageMonth === monthKey
      ? (tenant?.aiPlatformUsageCount ?? 0)
      : 0;
    // resetAt = first day of next month UTC. Editor uses this to render
    // "resets in 12 days" without needing its own date math.
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { used, cap: this.freeTierCap, resetAt: next.toISOString() };
  }

  /**
   * Atomic-ish increment of the platform usage counter. Two-step:
   *   1) If the stored month != current month, write a fresh bucket
   *      with count=1 (rollover).
   *   2) Else atomic increment the existing bucket.
   *
   * Race windows (documented per audit-W3, 2026-05-25):
   *   (a) Two requests both observe a stale month on rollover →
   *       both write count=1 instead of one writing 1 and the other 2.
   *       Worst case: 1-call undercount per rollover per tenant.
   *       Acceptable; reset month boundary is once / tenant / month.
   *   (b) Two requests on the SAME month both check usage at slot
   *       cap-1, both proceed, both bump → count = cap+1 briefly.
   *       Worst case: one-call overshoot per concurrent burst. The
   *       caller is the user clicking the sparkle button — they can
   *       physically only burst a couple at once before the UI
   *       feedback catches up. Cost ceiling is bounded.
   *   In either direction the over/undershoot is small and one-per-
   *   tenant. Switching to a true transactional check (SELECT ... FOR
   *   UPDATE + UPDATE inside a tx) would close both windows at the
   *   cost of a row-lock on every AI call. Not worth it for $5/mo
   *   spend ceiling.
   */
  private async bumpPlatformUsage(tenantId: string): Promise<void> {
    const monthKey = this.currentMonthKey();
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: { aiPlatformUsageMonth: true } as any,
    }) as any;
    if (tenant?.aiPlatformUsageMonth !== monthKey) {
      await this.prisma.client.tenant.update({
        where: { id: tenantId },
        data: {
          aiPlatformUsageMonth: monthKey,
          aiPlatformUsageCount: 1,
        } as any,
      });
    } else {
      await this.prisma.client.tenant.update({
        where: { id: tenantId },
        data: { aiPlatformUsageCount: { increment: 1 } } as any,
      });
    }
  }

  /**
   * Public read for the GET /ai/key status endpoint so the editor
   * can render "X of 200 free this month" without a second round
   * trip. BYOK tenants get used=0/cap=null.
   */
  async getUsage(tenantId: string): Promise<{ source: 'tenant' | 'platform' | 'none'; used: number; cap: number | null; resetAt: string | null }> {
    const resolved = await this.resolveProviderKey(tenantId);
    if (!resolved) return { source: 'none', used: 0, cap: null, resetAt: null };
    if (resolved.source === 'tenant') return { source: 'tenant', used: 0, cap: null, resetAt: null };
    const u = await this.readPlatformUsage(tenantId);
    return { source: 'platform', used: u.used, cap: u.cap, resetAt: u.resetAt };
  }

  /**
   * Resolve which provider key to use for this tenant. BYOK wins;
   * platform key is the trial-mode fallback. Returns null if neither
   * is configured — caller surfaces the friendly 503.
   */
  private async resolveProviderKey(tenantId: string): Promise<{
    provider: AiProvider;
    apiKey: string;
    /** Catalog model id; empty string means dispatch uses provider default. */
    model: string;
    source: 'tenant' | 'platform';
  } | null> {
    // 1) Tenant BYOK
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: { aiProvider: true, aiKeyEncrypted: true, aiModel: true } as any,
    }) as any;
    if (tenant?.aiKeyEncrypted) {
      const provider = coerceProvider(tenant.aiProvider);
      if (provider) {
        try {
          const apiKey = openAiKey(tenant.aiKeyEncrypted);
          return {
            provider,
            apiKey,
            model: typeof tenant.aiModel === 'string' ? tenant.aiModel : '',
            source: 'tenant',
          };
        } catch (e: any) {
          // Decryption failed (master key rotation, corrupted blob).
          // Don't crash the request — log + fall through to platform.
          // Operator will see "AI is not configured" and re-enter the
          // key from settings.
          this.logger.error(`Failed to decrypt tenant AI key (${tenantId}): ${e?.message}`);
        }
      }
    }
    // 2) Platform fallback (current behavior — ANTHROPIC_API_KEY env).
    // No model selection on platform fallback; the dispatcher picks
    // the provider default (cheapest tier) so platform spend is
    // bounded.
    const platformKey = process.env.ANTHROPIC_API_KEY;
    if (platformKey) {
      return { provider: 'anthropic', apiKey: platformKey, model: '', source: 'platform' };
    }
    return null;
  }

  async generate(opts: AiGenerateRequest & { tenantId: string; userId?: string }): Promise<AiGenerateResponse> {
    // Audit-W1 wrap: any throw out of the rest of this method
    // (bad input, provider 4xx/5xx, cap-reached, decryption fail)
    // counts as a failure against the per-tenant cap. The wrapper
    // checks the cap BEFORE doing any work — sustained failures
    // from one tenant are blocked at the door.
    await this.checkFailureCap(opts.tenantId);
    try {
      return await this.generateInner(opts);
    } catch (e) {
      await this.recordFailure(opts.tenantId);
      throw e;
    }
  }

  private async generateInner(opts: AiGenerateRequest & { tenantId: string; userId?: string }): Promise<AiGenerateResponse> {
    const resolved = await this.resolveProviderKey(opts.tenantId);
    if (!resolved) {
      throw new ServiceUnavailableException(
        'AI is not configured. Add your provider API key in Settings → Integrations, or contact your admin.',
      );
    }
    if (!opts.context || !opts.context.trim()) {
      throw new BadRequestException('Provide some context for the AI to work with.');
    }
    if (!SYSTEM_PROMPTS[opts.intent]) {
      throw new BadRequestException(`Unknown intent: ${opts.intent}`);
    }
    // 2026-05-03 SECURITY FIX — operator-controlled inputs flow into a
    // paid Anthropic call. Without caps an attacker (or buggy widget)
    // could ship a 100KB context to amplify cost. Hard caps below; the
    // model also has max_tokens=300 on output as a separate guard.
    if (opts.context.length > 2000) {
      throw new BadRequestException('Context too long. Keep it under 2000 characters.');
    }
    // `vertical` is interpolated into the user prompt — whitelist it
    // against the canonical VERTICALS so a malicious string can't
    // change the system prompt or pollute logs.
    // Validated against the canonical VERTICALS list
    // (packages/api-types/src/verticals.ts), case-insensitively — the
    // single source of truth, so a malicious string can't change the
    // system prompt or pollute logs.
    // Audit-W6 fix (2026-05-25) — clamp BEFORE toUpperCase(). A
    // malicious 1MB `vertical` string defeats the 2000-char `context`
    // cap above (vertical is interpolated into the prompt too) and
    // also burns CPU on the upper-case scan. The Zod schema in the
    // controller caps at 40 chars; this is defense-in-depth in case
    // the service is ever called from a non-Zod path (cron, internal).
    if (opts.vertical && !isVertical(String(opts.vertical).slice(0, 40).toUpperCase())) {
      throw new BadRequestException('Invalid vertical.');
    }
    // Tone whitelist — same idea, prevents prompt injection via the
    // user-controlled tone field.
    const ALLOWED_TONES = new Set(['energetic', 'elegant', 'playful', 'serious', 'casual']);
    if (opts.tone && !ALLOWED_TONES.has(opts.tone)) {
      throw new BadRequestException('Invalid tone.');
    }

    // Rate-limit: 30/hour/tenant. P1-14 — sliding window now in Redis
    // (replica-safe), not an in-memory Map. CYCLE-5 ai-rate-limit-leak
    // fix preserved: do NOT record the slot before the upstream call —
    // a failed call must not consume a quota slot. The recordEvent is
    // AFTER the successful, usable result below. windowCount prunes the
    // expired members as a side effect, so the key can't grow unbounded.
    if ((await this.windowCount(this.RL_SUCCESS_PREFIX, opts.tenantId)) >= this.HOURLY_CAP) {
      throw new BadRequestException(
        `Hit the hourly AI cap (${this.HOURLY_CAP} generations/hour). Try again later or contact sales for a higher tier.`,
      );
    }

    // Monthly platform cap (Canva-style free tier). Only enforced for
    // platform-paid generations — BYOK tenants bypass entirely. The
    // editor surfaces this via the `usage` field on the success
    // response so the next click already sees the new count without
    // Audit-W8 fix (2026-05-25) — was throwing a plain
    // BadRequestException with a string the FE regex'd for "monthly
    // free AI cap". That breaks the moment an i18n pass touches the
    // message. Now throws an HttpException with a structured `code:
    // 'AI_CAP_REACHED'` field. AllExceptionsFilter passes the code
    // through to the response envelope so the FE matches on
    // `errorCode === 'AI_CAP_REACHED'`. Cap value + resetAt are
    // exposed as separate fields so the FE doesn't have to parse
    // the human string.
    if (resolved.source === 'platform') {
      const u = await this.readPlatformUsage(opts.tenantId);
      if (u.used >= u.cap) {
        const resetAt = u.resetAt;
        throw new HttpException(
          {
            message: `Hit the monthly free AI cap (${u.cap} generations). Connect your own provider key in Settings → AI provider for unlimited, or wait until the cap resets at ${resetAt}.`,
            code: 'AI_CAP_REACHED',
            cap: u.cap,
            used: u.used,
            resetAt,
          },
          HttpStatus.PAYMENT_REQUIRED, // 402 — appropriate per RFC for "your free tier is exhausted, pay (or upgrade) to continue".
        );
      }
    }

    const count = Math.min(Math.max(opts.count ?? 3, 1), 5);
    const tone = opts.tone || 'casual';
    const vertical = opts.vertical || 'venue';

    const userPrompt = [
      `Context: ${opts.context.trim()}`,
      `Vertical: ${vertical}`,
      `Tone: ${tone}`,
      `Generate ${count} distinct options.`,
      '',
      'Return ONLY a JSON array of objects, no preamble, no markdown:',
      '[{ "text": "..." }, { "text": "..." }, ...]',
      'Each "text" is the full piece of copy ready to paste. No labels, no numbering inside the text.',
    ].join('\n');

    let raw: string;
    try {
      const out = await dispatchAi(resolved.provider, {
        apiKey: resolved.apiKey,
        model: resolved.model,
        // Vertical-aware system prompt (audit §3/§14) — composes the
        // intent prompt with the vertical's voice clause so a SPORTS vs
        // SCHOOL vs RESTAURANT announcement is tonally distinct, not
        // just a one-line user-prompt hint the model can ignore.
        system: composeSystemPrompt(opts.intent, opts.vertical),
        userPrompt,
        maxTokens: 300,
      });
      if (out.errorStatus) {
        this.logger.warn(
          `${resolved.provider} non-2xx (${resolved.source}): ${out.errorStatus} ${(out.errorBody || '').slice(0, 200)}`,
        );
        // 2026-05-26 audit AI-P0-1 — disambiguate "out of credit" from
        // "rate-limited" at generate-time (was only at test-on-save).
        // Returns structured envelope with code: 'AI_PROVIDER_OUT_OF_CREDIT'
        // so the FE can show the right "add money / wait for quota"
        // copy and CTA. Falls through to the generic paths below when
        // null (= it really IS a rate-limit, not out-of-credit).
        const quotaErr = mapProviderQuotaError(resolved.provider, out.errorStatus, out.errorBody);
        if (quotaErr) {
          throw new HttpException(
            {
              message: quotaErr.message,
              code: quotaErr.code,
              provider: quotaErr.provider,
              keySource: resolved.source, // 'tenant' = BYOK; 'platform' = our key
            },
            HttpStatus.PAYMENT_REQUIRED, // 402 — same as AI_CAP_REACHED, "pay to continue"
          );
        }
        // A bad BYOK key → tell the operator exactly that so they re-paste
        // in Settings instead of hunting a phantom config issue. 401 = bad
        // key; 403 = key valid but lacks access to that model; Google also
        // signals a bad key as HTTP 400 with "API_KEY_INVALID" in the body.
        // Other statuses get a generic message (provider-specific debugging
        // is not the operator's job).
        const keyRejected =
          out.errorStatus === 401 ||
          out.errorStatus === 403 ||
          (out.errorStatus === 400 && /api[_ ]?key|API_KEY_INVALID|PERMISSION_DENIED/i.test(out.errorBody || ''));
        if (keyRejected && resolved.source === 'tenant') {
          throw new ServiceUnavailableException(
            `Your ${providerDisplayName(resolved.provider)} API key was rejected (${out.errorStatus}). Re-enter it in Settings → Integrations.`,
          );
        }
        if (out.errorStatus === 429) {
          throw new ServiceUnavailableException(
            `${providerDisplayName(resolved.provider)} rate-limited the request. Try again in a moment.`,
          );
        }
        throw new ServiceUnavailableException(
          `AI service (${resolved.provider}) responded ${out.errorStatus}.`,
        );
      }
      raw = out.raw;
    } catch (err: any) {
      // Re-throw ANY intentional HttpException untouched — not just
      // ServiceUnavailableException. The structured 402 out-of-credit
      // envelope thrown above (code: AI_PROVIDER_OUT_OF_CREDIT) is a plain
      // HttpException; the old `instanceof ServiceUnavailableException` guard
      // let it fall through to the generic 503 below, so the AI-P0-1
      // generate-time disambiguation was dead code (2026-06-09 Fable audit).
      // ServiceUnavailableException/BadRequestException both extend
      // HttpException, so every prior 503/400 path still surfaces; only raw
      // network failures (plain Error from dispatchAi) become "unreachable".
      if (err instanceof HttpException) throw err;
      this.logger.error(`AI dispatch failed: ${err?.message}`);
      throw new ServiceUnavailableException('AI service unreachable.');
    }

    // Defensive parse — model is instructed to return JSON only, but
    // sometimes wraps in ```json fences or prefaces. Strip + fallback.
    let options: Array<{ text: string; tag?: string }> = [];
    const stripped = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    try {
      const parsed = JSON.parse(stripped);
      if (Array.isArray(parsed)) {
        options = parsed
          .map((o: any) => ({ text: String(o?.text || '').trim(), tag: o?.tag }))
          .filter((o) => o.text);
      }
    } catch {
      // Plain-text fallback: split on blank lines, pick the first N.
      options = stripped
        .split(/\n{2,}/)
        .map((s) => ({ text: s.trim() }))
        .filter((o) => o.text)
        .slice(0, count);
    }
    if (options.length === 0) {
      throw new ServiceUnavailableException('AI returned an empty result. Try rephrasing your context.');
    }

    // CYCLE-5 ai-rate-limit-leak fix: only count a quota slot once
    // the upstream call returned a usable, non-empty result. A failed
    // fetch / non-2xx / empty parse earlier in this method now does
    // NOT consume the tenant's hourly cap. P1-14 — recorded in Redis.
    await this.recordEvent(this.RL_SUCCESS_PREFIX, opts.tenantId);

    // Bump platform monthly counter on success. BYOK calls bypass
    // (their cost, untracked). Errors before this point don't bump.
    if (resolved.source === 'platform') {
      try {
        await this.bumpPlatformUsage(opts.tenantId);
      } catch (e: any) {
        // Don't fail the user-facing response on a counter write
        // error — log + accept the small over-spend risk.
        this.logger.warn(`Platform usage bump failed (${opts.tenantId}): ${e?.message}`);
      }
    }

    // Return live usage so the editor can update the badge without a
    // second round trip. BYOK → null (unlimited).
    let usage: { used: number; cap: number; resetAt: string } | null = null;
    if (resolved.source === 'platform') {
      const u = await this.readPlatformUsage(opts.tenantId);
      usage = { used: u.used, cap: u.cap, resetAt: u.resetAt };
    }
    // 2026-05-26 audit AI-P0-4 — log every successful generation.
    // SUPER_ADMIN can now answer "which tenant burned through 199 of
    // 200 platform credits this month?" via the audit log. Captures
    // dimensions (no prompt content — operator-supplied free text
    // could contain student names / PII; intent + tone + vertical
    // are the privacy-safe forensic fields). Source tells us whether
    // it was platform credit or BYOK.
    await this.prisma.client.auditLog.create({
      data: {
        action: 'AI_GENERATE',
        targetType: 'tenant',
        targetId: opts.tenantId,
        tenantId: opts.tenantId,
        userId: opts.userId || null,
        details: JSON.stringify({
          intent: opts.intent,
          tone: opts.tone || null,
          vertical: opts.vertical || null,
          provider: resolved.provider,
          model: resolved.model,
          source: resolved.source,
          optionsReturned: options.length,
        }),
      },
    }).catch(() => { /* audit best-effort — never fail the generation on log error */ });
    return { options, intent: opts.intent, source: resolved.source, usage } as any;
  }

  /**
   * Phase D3 (2026-05-12) — AI-generate a touch template from a prompt.
   *
   * Generates the FULL template structure (zones with positions, widget
   * types, and touch actions) so an operator can type "lobby check-in
   * kiosk with three tap-buttons: Sign in, Visiting hours, Wi-Fi info"
   * and get back a working template they can iterate on.
   *
   * Reuses the same provider resolution + rate limit + monthly cap path
   * the text-snippet generate() uses; this is a heavier call so the
   * max_tokens is higher and we run a second sanitize pass on the JSON
   * before persisting.
   *
   * Output shape — strictly validated server-side before persisting:
   *   { name, description?, zones: [ {widgetType, x, y, width, height,
   *     defaultConfig?, touchAction?, sceneId?, name? } ], scenes?: [ { name } ] }
   *
   * All coordinates are clamped to [0, 100]; widget types are intersected
   * against a hard allowlist; touch action `type` is intersected against
   * the TouchActionConfig discriminated union. Any field that fails
   * validation is dropped, never echoed back to the operator — we'd
   * rather hand back 5 valid zones than 7 zones with 2 corrupt ones.
   */
  async generateTouchTemplate(opts: {
    tenantId: string;
    userId?: string; // 2026-05-26 audit AI-P0-4 — for AuditLog row
    prompt: string;
    screenWidth?: number;
    screenHeight?: number;
    vertical?: string;
  }): Promise<{
    parsed: {
      name: string;
      description?: string;
      zones: Array<{
        name?: string;
        widgetType: string;
        x: number;
        y: number;
        width: number;
        height: number;
        defaultConfig?: Record<string, any>;
        touchAction?: any;
        sceneId?: string | null;
      }>;
      scenes?: Array<{ name: string }>;
    };
    source: 'tenant' | 'platform';
    usage: { used: number; cap: number; resetAt: string } | null;
  }> {
    // Audit-W1 — same failure-cap wrapper as generate().
    await this.checkFailureCap(opts.tenantId);
    try {
      return await this.generateTouchTemplateInner(opts);
    } catch (e) {
      await this.recordFailure(opts.tenantId);
      throw e;
    }
  }

  private async generateTouchTemplateInner(opts: {
    tenantId: string;
    userId?: string;
    prompt: string;
    screenWidth?: number;
    screenHeight?: number;
    vertical?: string;
  }): Promise<any> {
    const resolved = await this.resolveProviderKey(opts.tenantId);
    if (!resolved) {
      throw new ServiceUnavailableException(
        'AI is not configured. Add your provider API key in Settings → Integrations, or contact your admin.',
      );
    }
    const prompt = (opts.prompt || '').trim();
    if (!prompt) throw new BadRequestException('Tell the AI what kind of touch template to build.');
    if (prompt.length > 2000) {
      throw new BadRequestException('Prompt too long. Keep it under 2000 characters.');
    }

    // Same rate limit + monthly cap path as generate(). One generation
    // burns one slot regardless of which generator the operator picks.
    // P1-14 — shared Redis-backed hourly window (same key as generate()
    // so the 30/hr cap is across BOTH generators, not per-generator).
    if ((await this.windowCount(this.RL_SUCCESS_PREFIX, opts.tenantId)) >= this.HOURLY_CAP) {
      throw new BadRequestException(
        `Hit the hourly AI cap (${this.HOURLY_CAP} generations/hour). Try again later.`,
      );
    }
    if (resolved.source === 'platform') {
      const u = await this.readPlatformUsage(opts.tenantId);
      if (u.used >= u.cap) {
        throw new HttpException(
          {
            message: `Hit the monthly free AI cap (${u.cap} generations). Add your own provider key in Settings → AI provider for unlimited.`,
            code: 'AI_CAP_REACHED',
            cap: u.cap,
            used: u.used,
            resetAt: u.resetAt,
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
    }

    // System prompt — strict, schema-anchored, no creative latitude on
    // the structure. The AI's job is content + arrangement, NOT to
    // invent new widget types or touch action shapes.
    //
    // Vertical-aware (audit §3/§14) — prepend the vertical's voice clause
    // so the PLACEHOLDER COPY the model fills into TEXT/ANNOUNCEMENT/QUOTE
    // zones reads in the right tone (a SPORTS kiosk vs a HEALTHCARE
    // check-in screen). The structural schema rules below are unchanged;
    // unknown/absent verticals fall through to the bare schema prompt.
    const voiceKey = (opts.vertical || '').trim().toUpperCase();
    const voiceClause = voiceKey ? VERTICAL_VOICE[voiceKey] : undefined;
    const system = voiceClause
      ? `${voiceClause}\n\n${TOUCH_TEMPLATE_SYSTEM_PROMPT}`
      : TOUCH_TEMPLATE_SYSTEM_PROMPT;
    const userPrompt = [
      `Operator description: ${prompt}`,
      `Vertical: ${opts.vertical || 'venue'}`,
      `Canvas: ${opts.screenWidth || 1920} × ${opts.screenHeight || 1080} px (landscape).`,
      '',
      'Return ONLY a JSON object matching the schema. No preamble, no markdown fences, no commentary.',
    ].join('\n');

    let raw: string;
    try {
      const out = await dispatchAi(resolved.provider, {
        apiKey: resolved.apiKey,
        model: resolved.model,
        system,
        userPrompt,
        // Higher cap than the text-snippet path because a 6-zone
        // template with touch actions is ~1.5KB JSON. 1500 keeps spend
        // bounded (~$0.02/call on Haiku) but leaves headroom.
        maxTokens: 1500,
      });
      if (out.errorStatus) {
        // 2026-05-26 audit AI-P0-1 — out-of-credit disambiguation on
        // the touch-template path too. Same shared helper as the
        // text-snippet generate(), same FE handling.
        const quotaErr = mapProviderQuotaError(resolved.provider, out.errorStatus, out.errorBody);
        if (quotaErr) {
          throw new HttpException(
            {
              message: quotaErr.message,
              code: quotaErr.code,
              provider: quotaErr.provider,
              keySource: resolved.source,
            },
            HttpStatus.PAYMENT_REQUIRED,
          );
        }
        const keyRejected =
          out.errorStatus === 401 ||
          out.errorStatus === 403 ||
          (out.errorStatus === 400 && /api[_ ]?key|API_KEY_INVALID|PERMISSION_DENIED/i.test(out.errorBody || ''));
        if (keyRejected && resolved.source === 'tenant') {
          throw new ServiceUnavailableException(
            `Your ${providerDisplayName(resolved.provider)} API key was rejected (${out.errorStatus}). Re-enter it in Settings → Integrations.`,
          );
        }
        if (out.errorStatus === 429) {
          throw new ServiceUnavailableException('AI service rate-limited the request. Try again in a moment.');
        }
        throw new ServiceUnavailableException(`AI service responded ${out.errorStatus}.`);
      }
      raw = out.raw;
    } catch (err: any) {
      // Same fix as the content-generate path: re-throw ANY HttpException
      // (incl. the structured 402 AI_PROVIDER_OUT_OF_CREDIT thrown above)
      // instead of only ServiceUnavailableException, which downgraded it to
      // the generic 503 here (2026-06-09 Fable audit — second dead-code site).
      if (err instanceof HttpException) throw err;
      this.logger.error(`AI touch-template dispatch failed: ${err?.message}`);
      throw new ServiceUnavailableException('AI service unreachable.');
    }

    // Empty (but non-error) reply — e.g. a thinking model that exhausted
    // its output budget, or a provider that returned no content. Give an
    // actionable message instead of letting JSON.parse('') throw a cryptic
    // "unparseable" error.
    if (!raw || !raw.trim()) {
      throw new ServiceUnavailableException(
        'The AI model returned an empty response — it may have run out of output budget. Try a shorter prompt, or switch to a faster model like Gemini Flash in Settings → AI provider.',
      );
    }

    const stripped = raw
      .replace(/^```(?:json)?\n?/, '')
      .replace(/\n?```$/, '')
      .trim();
    let parsed: any;
    try {
      parsed = JSON.parse(stripped);
    } catch (e: any) {
      this.logger.warn(`AI returned non-JSON for touch template: ${stripped.slice(0, 200)}`);
      throw new ServiceUnavailableException('AI returned an unparseable response. Try rephrasing your prompt.');
    }

    const sanitized = sanitizeTouchTemplate(parsed);
    if (!sanitized.zones.length) {
      throw new ServiceUnavailableException('AI returned no usable zones. Try a more specific prompt.');
    }

    // Bump rate-limit + monthly counter only AFTER a successful, usable
    // result. Same leak-fix pattern as generate(). P1-14 — Redis-backed.
    await this.recordEvent(this.RL_SUCCESS_PREFIX, opts.tenantId);
    if (resolved.source === 'platform') {
      try { await this.bumpPlatformUsage(opts.tenantId); }
      catch (e: any) { this.logger.warn(`Platform usage bump failed: ${e?.message}`); }
    }
    let usage: { used: number; cap: number; resetAt: string } | null = null;
    if (resolved.source === 'platform') {
      const u = await this.readPlatformUsage(opts.tenantId);
      usage = { used: u.used, cap: u.cap, resetAt: u.resetAt };
    }
    // 2026-05-26 audit AI-P0-4 — touch-template generations also
    // audit-logged. SUPER_ADMIN can attribute every "AI-built
    // interactive template" to a specific user+tenant.
    await this.prisma.client.auditLog.create({
      data: {
        action: 'AI_TEMPLATE_GENERATED',
        targetType: 'tenant',
        targetId: opts.tenantId,
        tenantId: opts.tenantId,
        userId: opts.userId || null,
        details: JSON.stringify({
          vertical: opts.vertical || null,
          screenWidth: opts.screenWidth || null,
          screenHeight: opts.screenHeight || null,
          provider: resolved.provider,
          model: resolved.model,
          source: resolved.source,
          zoneCount: Array.isArray(sanitized?.zones) ? sanitized.zones.length : 0,
        }),
      },
    }).catch(() => { /* audit best-effort */ });
    return { parsed: sanitized, source: resolved.source, usage };
  }
}

// ───────────────────────────────────────────────────────
// Touch-template generation — system prompt + sanitizer.
//
// Kept at module scope (not inside the class) so unit tests can import
// sanitizeTouchTemplate() directly without instantiating the service.
// ───────────────────────────────────────────────────────

/**
 * Subset of widget types that are safe to AI-generate. Excludes anything
 * that would need server-side configuration (DEVICE_*, SCREEN_*, RSS_FEED
 * with auth tokens, etc.) or that's heavyweight enough that random
 * placement makes no sense. Operator can still drop excluded widgets
 * manually in the builder.
 */
const TOUCH_GEN_ALLOWED_WIDGETS = new Set([
  'TEXT', 'RICH_TEXT', 'ANNOUNCEMENT', 'TICKER',
  'CLOCK', 'WEATHER', 'COUNTDOWN', 'CALENDAR',
  'IMAGE', 'IMAGE_CAROUSEL', 'VIDEO', 'LOGO',
  'BELL_SCHEDULE', 'LUNCH_MENU', 'STAFF_SPOTLIGHT',
  'WEBPAGE', 'QUOTE',
  'DECORATION',
]);

/** Touch action types the AI may emit. Mirrors TouchActionConfig in
 *  apps/web/src/components/template-builder/types.ts. Anything outside
 *  this set is dropped during sanitize. */
const TOUCH_GEN_ALLOWED_ACTIONS = new Set([
  'open-url', 'play-video', 'goto-template', 'goto-scene',
  'show-overlay', 'reset-idle', 'sound-toggle', 'webhook',
  'request-help',
]);

const TOUCH_TEMPLATE_SYSTEM_PROMPT = `You design interactive touch-screen templates for digital signage. The
operator describes what they want; you return a JSON object that the
template builder can render directly.

OUTPUT SCHEMA (strict — no extra fields):
{
  "name": string,                     // ≤ 60 chars
  "description": string,              // ≤ 200 chars, optional
  "zones": [
    {
      "name": string,                 // ≤ 30 chars, e.g. "Sign In button"
      "widgetType": one of: TEXT, RICH_TEXT, ANNOUNCEMENT, TICKER, CLOCK,
                            WEATHER, COUNTDOWN, CALENDAR, IMAGE,
                            IMAGE_CAROUSEL, VIDEO, LOGO, BELL_SCHEDULE,
                            LUNCH_MENU, STAFF_SPOTLIGHT, WEBPAGE, QUOTE,
                            DECORATION
      "x":      0–100,                // percent of canvas width
      "y":      0–100,                // percent of canvas height
      "width":  3–100,                // percent
      "height": 3–100,                // percent
      "defaultConfig": { ... },       // widget-specific config; common keys:
                                      //   TEXT/RICH_TEXT:   { content }
                                      //   ANNOUNCEMENT:     { message }
                                      //   TICKER:           { messages: string[] }
                                      //   COUNTDOWN:        { label, targetDate }
                                      //   QUOTE:            { quote, author }
                                      //   STAFF_SPOTLIGHT:  { staffName, role }
                                      //   WEBPAGE:          { url }
      "touchAction": {                // optional; ONLY for interactive zones
        "type": one of: open-url, play-video, goto-template, goto-scene,
                        show-overlay, reset-idle, sound-toggle, webhook,
                        request-help,
        "target": string              // URL, asset id, scene name, or template name
      }
    }
  ],
  "scenes": [ { "name": string } ]    // optional; include for multi-screen
                                      // interactions. First scene is the
                                      // default. Names should be short.
}

RULES:
- 3-8 zones per template. Don't crowd the canvas; whitespace is good.
- No two zones should overlap by more than 10%.
- For touch templates, AT LEAST 2 zones should have a touchAction set.
- Use 'goto-scene' with target=scene-name for in-template navigation;
  the server resolves the name to the matching scene id.
- TouchAction targets that look like URLs MUST start with https://.
- No webhook targets to private IPs or localhost.
- TEXT / ANNOUNCEMENT / QUOTE widgets should have populated content
  fields. Don't return empty defaultConfig — the operator should see
  meaningful placeholder copy on first load.
- For Wi-Fi / sign-in / kiosk scenarios, use ANNOUNCEMENT for headlines
  and TEXT for body copy.
- Pick zones that fit a 1920×1080 landscape canvas unless told otherwise.

Return JSON ONLY. No markdown fences, no prose, no apology. If the
operator's prompt is unsuitable for a touch template, return a minimal
valid template explaining the issue in the description field.`;

/**
 * Strip every field that doesn't match the schema. Soft on individual
 * zones (drop bad ones, keep good ones) but strict on the top-level
 * envelope (must have a name + at least one zone after filtering).
 */
function sanitizeTouchTemplate(raw: any): {
  name: string;
  description?: string;
  zones: Array<{
    name?: string;
    widgetType: string;
    x: number;
    y: number;
    width: number;
    height: number;
    defaultConfig?: Record<string, any>;
    touchAction?: any;
    sceneId?: string | null;
  }>;
  scenes?: Array<{ name: string }>;
} {
  if (!raw || typeof raw !== 'object') {
    return { name: 'Untitled', zones: [] };
  }
  const name = typeof raw.name === 'string' && raw.name.trim()
    ? raw.name.trim().slice(0, 60)
    : 'Untitled template';
  const description = typeof raw.description === 'string' && raw.description.trim()
    ? raw.description.trim().slice(0, 200)
    : undefined;

  const clampPct = (n: any, min = 0, max = 100): number | null => {
    const v = typeof n === 'number' ? n : parseFloat(String(n));
    if (!Number.isFinite(v)) return null;
    return Math.max(min, Math.min(max, v));
  };

  // Actions whose semantics require a non-empty `target` to be valid.
  // If sanitize ends up with no target on one of these, drop the whole
  // action (player short-circuits on `!target` anyway, leaving the
  // visitor with a non-responding tap — worse UX than no action at all).
  const ACTIONS_REQUIRING_TARGET = new Set([
    'open-url', 'play-video', 'goto-template', 'goto-scene',
    'show-overlay', 'webhook',
  ]);

  const sanitizeAction = (a: any): any | undefined => {
    if (!a || typeof a !== 'object') return undefined;
    const type = String(a.type || '').trim();
    if (!TOUCH_GEN_ALLOWED_ACTIONS.has(type)) return undefined;
    const out: any = { type };
    if (typeof a.target === 'string' && a.target.trim()) {
      const target = a.target.trim().slice(0, 1000);
      // open-url / webhook: must be https AND must not target a
      // private / loopback / link-local host. The latter check
      // (audit-B4 fix) defends against prompt-injection attempts to
      // emit `https://169.254.169.254/...`, `https://10.x.x.x/...`,
      // etc. — those would otherwise persist into the template and
      // fire at player tap time. validatePublicUrl throws SsrfError
      // on IP-literal hits; we swallow and drop the action (same
      // failure-mode as a malformed scheme above). DNS-based
      // hostnames pass synchronous IP-literal validation and rely
      // on the player's own outbound network controls — that's
      // documented as a defense-in-depth gap, not a blocker, in
      // the audit follow-up. The synchronous validatePublicUrl is
      // sufficient for the literal-IP threat model.
      if (type === 'open-url' || type === 'webhook') {
        if (!/^https:\/\//i.test(target)) return undefined;
        try {
          validatePublicUrl(target);
        } catch {
          return undefined;
        }
      }
      out.target = target;
    }
    // Drop the whole action if a required target was never resolved.
    // (Functional audit caught: AI emitting `{type:'goto-scene'}` with
    // no target → player short-circuits → tap dies silently.)
    if (ACTIONS_REQUIRING_TARGET.has(type) && !out.target) return undefined;
    // Preserve the optional flags the model may emit.
    if (type === 'open-url' && a.openInNewTab === true) out.openInNewTab = true;
    if (type === 'play-video' && a.returnOnEnd !== false) out.returnOnEnd = true;
    if ((type === 'goto-template' || type === 'goto-scene') && a.transition === 'fade') {
      out.transition = 'fade';
    }
    if (type === 'webhook') {
      out.method = a.method === 'GET' ? 'GET' : 'POST';
      if (a.payload && typeof a.payload === 'object' && !Array.isArray(a.payload)) {
        // Bound payload size; only string/number/boolean leaves.
        const flat: Record<string, any> = {};
        let count = 0;
        for (const [k, v] of Object.entries(a.payload)) {
          if (count >= 10) break;
          if (typeof k !== 'string' || k.length > 64) continue;
          if (['string', 'number', 'boolean'].includes(typeof v)) {
            flat[k] = v;
            count += 1;
          }
        }
        out.payload = flat;
      }
    }
    // Audit-W9 fix (2026-05-25) — request-help is "show a help
    // bubble with this body text." Body was previously dropped
    // because sanitizeAction only copied `target`. Operator
    // saw AI-generated request-help buttons with no message.
    // Cap to 500 chars (player surface, bubble text — not a
    // novel).
    if (type === 'request-help' && typeof a.body === 'string') {
      const body = a.body.trim().slice(0, 500);
      if (body) out.body = body;
    }
    return out;
  };

  const zonesIn = Array.isArray(raw.zones) ? raw.zones : [];
  const zonesOut: Array<any> = [];
  for (const z of zonesIn.slice(0, 20)) {
    if (!z || typeof z !== 'object') continue;
    const widgetType = String(z.widgetType || '').trim().toUpperCase();
    if (!TOUCH_GEN_ALLOWED_WIDGETS.has(widgetType)) continue;
    const x = clampPct(z.x);
    const y = clampPct(z.y);
    const width = clampPct(z.width, 3);
    const height = clampPct(z.height, 3);
    if (x == null || y == null || width == null || height == null) continue;
    // Don't allow zones to overflow the canvas. Shrink instead of dropping.
    const safeW = Math.min(width, 100 - x);
    const safeH = Math.min(height, 100 - y);
    if (safeW < 3 || safeH < 3) continue;

    const cfg = z.defaultConfig && typeof z.defaultConfig === 'object' && !Array.isArray(z.defaultConfig)
      ? scrubConfigLeaves(z.defaultConfig) as Record<string, any>
      : undefined;
    zonesOut.push({
      name: typeof z.name === 'string' && z.name.trim() ? z.name.trim().slice(0, 30) : undefined,
      widgetType,
      x,
      y,
      width: safeW,
      height: safeH,
      defaultConfig: cfg,
      touchAction: sanitizeAction(z.touchAction),
      // sceneId can't be set at generation time — the scenes don't have
      // ids yet. The controller will resolve sceneId after scenes are
      // created from `scenes[]` names.
    });
  }

  const scenesIn = Array.isArray(raw.scenes) ? raw.scenes : [];
  const scenesOut: Array<{ name: string }> = [];
  for (const s of scenesIn.slice(0, 8)) {
    if (!s || typeof s !== 'object') continue;
    const sName = typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 60) : '';
    if (sName) scenesOut.push({ name: sName });
  }

  return { name, description, zones: zonesOut, scenes: scenesOut.length ? scenesOut : undefined };
}

// Recursively scrub a `defaultConfig` value tree. Strips:
//   - prototype-pollution keys (`__proto__`, `constructor`, `prototype`)
//   - keys longer than 64 chars
//   - dangerous URL schemes anywhere a string appears
//   - depth > 4 (defends against an AI emitting deeply nested config)
// Returns a NEW object/array — never mutates the input — so the
// sanitizer is safe to call on caller-owned objects.
//
// Reasoning: WidgetRenderer reads many keys from defaultConfig and
// some (WEBPAGE.url, IMAGE.assetUrl) get rendered as href/src. A
// `javascript:` URL today flows into widgets that defensively gate on
// schema, but a future widget that doesn't is a stored-XSS waiting to
// happen. Scrub at the sanitizer boundary so no AI value with a
// dangerous scheme ever reaches Prisma in the first place.
const DANGEROUS_URL_SCHEME_RE = /^(?:javascript|data|vbscript|file|blob):/i;
function scrubConfigLeaves(value: any, depth = 0): any {
  if (depth > 4) return undefined;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (DANGEROUS_URL_SCHEME_RE.test(value)) return '';
    return value.slice(0, 4000);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => scrubConfigLeaves(v, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    let count = 0;
    for (const [k, v] of Object.entries(value)) {
      // Block prototype-pollution + over-long keys.
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      if (typeof k !== 'string' || k.length > 64) continue;
      if (count >= 50) break; // Bound shallow-object width too.
      const scrubbed = scrubConfigLeaves(v, depth + 1);
      if (scrubbed !== undefined) out[k] = scrubbed;
      count += 1;
    }
    return out;
  }
  // Functions / symbols / etc — drop.
  return undefined;
}

// Export the sanitizer for unit testing.
export { sanitizeTouchTemplate, scrubConfigLeaves };
