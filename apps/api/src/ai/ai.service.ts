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

import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { dispatchAi, type AiProvider, coerceProvider } from './ai-providers';
import { openAiKey } from './ai-key-cipher';
import { isVertical } from '@cms/api-types';

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

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Lazy in-memory rate limiter. Tenant id → rolling-1h timestamps.
   *  Cleared on pod restart — the cap is "soft" by design and exists
   *  to prevent runaway loops, not for spend control. */
  private readonly recentByTenant = new Map<string, number[]>();
  private readonly HOURLY_CAP = 30;

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
   * Race window: if two requests both observe a stale month, both
   * write count=1 instead of one writing 1 and the other 2. Worst
   * case is a 1-call undercount per rollover boundary per tenant.
   * Never an over-count, so spend stays bounded.
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
    source: 'tenant' | 'platform';
  } | null> {
    // 1) Tenant BYOK
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: { aiProvider: true, aiKeyEncrypted: true } as any,
    }) as any;
    if (tenant?.aiKeyEncrypted) {
      const provider = coerceProvider(tenant.aiProvider);
      if (provider) {
        try {
          const apiKey = openAiKey(tenant.aiKeyEncrypted);
          return { provider, apiKey, source: 'tenant' };
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
    const platformKey = process.env.ANTHROPIC_API_KEY;
    if (platformKey) {
      return { provider: 'anthropic', apiKey: platformKey, source: 'platform' };
    }
    return null;
  }

  async generate(opts: AiGenerateRequest & { tenantId: string }): Promise<AiGenerateResponse> {
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
    if (opts.vertical && !isVertical(String(opts.vertical).toUpperCase())) {
      throw new BadRequestException('Invalid vertical.');
    }
    // Tone whitelist — same idea, prevents prompt injection via the
    // user-controlled tone field.
    const ALLOWED_TONES = new Set(['energetic', 'elegant', 'playful', 'serious', 'casual']);
    if (opts.tone && !ALLOWED_TONES.has(opts.tone)) {
      throw new BadRequestException('Invalid tone.');
    }

    // Rate-limit: 30/hour/tenant. Sliding window kept in-memory.
    // CYCLE-5 ai-rate-limit-leak fix: do NOT increment before the
    // upstream call — a failed call would otherwise consume a quota
    // slot. The push is moved to AFTER the successful Anthropic
    // response below.
    // CYCLE-5 ai-tenant-map-leak fix: prune entries during the check.
    // If the filtered list is empty, drop the Map entry entirely so
    // the Map can't grow unbounded across long-lived tenants.
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const recent = (this.recentByTenant.get(opts.tenantId) || []).filter((t) => t > oneHourAgo);
    if (recent.length === 0) {
      this.recentByTenant.delete(opts.tenantId);
    } else {
      this.recentByTenant.set(opts.tenantId, recent);
    }
    if (recent.length >= this.HOURLY_CAP) {
      throw new BadRequestException(
        `Hit the hourly AI cap (${this.HOURLY_CAP} generations/hour). Try again later or contact sales for a higher tier.`,
      );
    }

    // Monthly platform cap (Canva-style free tier). Only enforced for
    // platform-paid generations — BYOK tenants bypass entirely. The
    // editor surfaces this via the `usage` field on the success
    // response so the next click already sees the new count without
    // a second fetch. Cap-reached error message is intentionally
    // shaped so the editor can pattern-match and pop the upgrade
    // modal: it always contains "monthly free AI" and the resetAt
    // ISO date.
    if (resolved.source === 'platform') {
      const u = await this.readPlatformUsage(opts.tenantId);
      if (u.used >= u.cap) {
        const resetAt = u.resetAt;
        throw new BadRequestException(
          `Hit the monthly free AI cap (${u.cap} generations). Connect your own provider key in Settings → AI provider for unlimited, or wait until the cap resets at ${resetAt}.`,
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
        system: SYSTEM_PROMPTS[opts.intent],
        userPrompt,
        maxTokens: 300,
      });
      if (out.errorStatus) {
        this.logger.warn(
          `${resolved.provider} non-2xx (${resolved.source}): ${out.errorStatus} ${(out.errorBody || '').slice(0, 200)}`,
        );
        // 401 from a tenant BYOK key → it's invalid. Tell the operator
        // exactly that so they re-paste in Settings instead of bouncing
        // around looking for a config issue. Other statuses get a
        // generic message (provider-specific debugging is not the
        // operator's job).
        if (out.errorStatus === 401 && resolved.source === 'tenant') {
          throw new ServiceUnavailableException(
            `Your ${resolved.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key was rejected (401). Re-enter it in Settings → Integrations.`,
          );
        }
        if (out.errorStatus === 429) {
          throw new ServiceUnavailableException(
            `${resolved.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} rate-limited the request. Try again in a moment.`,
          );
        }
        throw new ServiceUnavailableException(
          `AI service (${resolved.provider}) responded ${out.errorStatus}.`,
        );
      }
      raw = out.raw;
    } catch (err: any) {
      if (err instanceof ServiceUnavailableException) throw err;
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
    // NOT consume the tenant's hourly cap.
    recent.push(now);
    this.recentByTenant.set(opts.tenantId, recent);

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
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const recent = (this.recentByTenant.get(opts.tenantId) || []).filter((t) => t > oneHourAgo);
    if (recent.length === 0) this.recentByTenant.delete(opts.tenantId);
    else this.recentByTenant.set(opts.tenantId, recent);
    if (recent.length >= this.HOURLY_CAP) {
      throw new BadRequestException(
        `Hit the hourly AI cap (${this.HOURLY_CAP} generations/hour). Try again later.`,
      );
    }
    if (resolved.source === 'platform') {
      const u = await this.readPlatformUsage(opts.tenantId);
      if (u.used >= u.cap) {
        throw new BadRequestException(
          `Hit the monthly free AI cap (${u.cap} generations). Add your own provider key in Settings → AI provider for unlimited.`,
        );
      }
    }

    // System prompt — strict, schema-anchored, no creative latitude on
    // the structure. The AI's job is content + arrangement, NOT to
    // invent new widget types or touch action shapes.
    const system = TOUCH_TEMPLATE_SYSTEM_PROMPT;
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
        system,
        userPrompt,
        // Higher cap than the text-snippet path because a 6-zone
        // template with touch actions is ~1.5KB JSON. 1500 keeps spend
        // bounded (~$0.02/call on Haiku) but leaves headroom.
        maxTokens: 1500,
      });
      if (out.errorStatus) {
        if (out.errorStatus === 401 && resolved.source === 'tenant') {
          throw new ServiceUnavailableException(
            `Your ${resolved.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key was rejected. Re-enter it in Settings → Integrations.`,
          );
        }
        if (out.errorStatus === 429) {
          throw new ServiceUnavailableException('AI service rate-limited the request. Try again in a moment.');
        }
        throw new ServiceUnavailableException(`AI service responded ${out.errorStatus}.`);
      }
      raw = out.raw;
    } catch (err: any) {
      if (err instanceof ServiceUnavailableException) throw err;
      this.logger.error(`AI touch-template dispatch failed: ${err?.message}`);
      throw new ServiceUnavailableException('AI service unreachable.');
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
    // result. Same leak-fix pattern as generate().
    recent.push(now);
    this.recentByTenant.set(opts.tenantId, recent);
    if (resolved.source === 'platform') {
      try { await this.bumpPlatformUsage(opts.tenantId); }
      catch (e: any) { this.logger.warn(`Platform usage bump failed: ${e?.message}`); }
    }
    let usage: { used: number; cap: number; resetAt: string } | null = null;
    if (resolved.source === 'platform') {
      const u = await this.readPlatformUsage(opts.tenantId);
      usage = { used: u.used, cap: u.cap, resetAt: u.resetAt };
    }
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
      // open-url / webhook: must be https. Anything else falls through
      // as text (scene/template name lookups happen later).
      if (type === 'open-url' || type === 'webhook') {
        if (!/^https:\/\//i.test(target)) return undefined;
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
