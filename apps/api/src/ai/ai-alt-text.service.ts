/**
 * AiAltTextService — vision-driven alt-text generation for image assets.
 *
 * 2026-05-28 audit P1-2. Closes the accessibility gap where every uploaded
 * image had `<img alt="">` (or no alt at all) because the operator never
 * filled the field. The accessibility audit (WCAG 1.1.1) flags every such
 * image; a screen reader announces "image" with no context. Worse for
 * search: SEO/searchability inside the asset library is also lost.
 *
 * Architecture:
 *   - Provider order: OpenAI 4o-mini vision (cheapest at $0.002/call)
 *     when an OPENAI_API_KEY is available on the tenant OR platform.
 *     Falls back to Anthropic Claude Haiku 4.5 with vision (similar
 *     cost) when only an ANTHROPIC_API_KEY is configured.
 *   - Google/Gemini vision IS now supported (2026-05-29 audit §3/§4
 *     fix). The Gemini 2.x models are natively multimodal; we send the
 *     image as an `inlineData` part (base64) to
 *     `…/models/<model>:generateContent` with the key in the
 *     `x-goog-api-key` HEADER (never on the URL — Google echoes the URL
 *     in error bodies). This closes the gap where a tenant who set a
 *     Google BYOK key got sparkle + touch-template but SILENTLY no
 *     alt-text (the skip even falsely claimed "no provider configured").
 *     Google vision is only ever used via BYOK (the platform fallback
 *     keys are still OpenAI→Anthropic); a Google-keyed tenant uses
 *     their configured gemini-* model.
 *   - Hard 5-second AbortSignal timeout per provider call. Alt-text is
 *     fire-and-forget from the controller, so the budget is small and
 *     should never block an upload.
 *   - Hard cap at 160 chars on the persisted string (Prisma column is
 *     VARCHAR(160)). WCAG short-alt convention is ≤125; the extra room
 *     accommodates operator overrides.
 *   - Per-call AuditLog entry on BOTH success and failure (P1-2 spec).
 *     Captures tenantId, assetId, bytes-processed, provider, model, and
 *     a coarse cost estimate so SUPER_ADMIN can answer "what's our
 *     monthly alt-text spend?" without a separate dashboard.
 *   - Free-tier-cap enforcement: if a tenant has NO BYOK key AND the
 *     platform monthly free-tier counter is exhausted, the call is
 *     SKIPPED (no upstream call made) and an audit row is written with
 *     code: AI_CAP_REACHED. Same `Tenant.aiPlatformUsage*` counter
 *     that AiService uses, so usage is unified.
 *
 * This service deliberately does NOT throw on errors — every public
 * method either returns the generated alt-text or returns null + logs.
 * The controller calls it fire-and-forget; we never want a vision API
 * outage to cascade into an upload failure.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { openAiKey } from './ai-key-cipher';
import {
  mapProviderQuotaError,
  requestParamsFor,
  textFromResponse,
  usageFromResponse,
  visionModelFor,
} from './ai-providers';
import type { TokenUsage } from './ai-model-catalog';
import { platformKeyFor, platformVisionProvider } from './ai-platform-keys';
import { findTenantAiKeyRow } from './ai-tenant-key';
import { AiUsageMeterService } from './ai-usage-meter.service';
import { AiAllowanceService } from './ai-allowance.service';
import { aiWindowCount, aiRecordEvent, resolveAiHourlyCap } from './ai-hourly-cap';
import { menuFromPhotoReading, type ExtractedMenu } from './menu-extractor';

/** Providers whose vision API alt-text supports. All three of the
 *  catalog providers are now covered (OpenAI + Anthropic via platform
 *  or BYOK, Google via BYOK). Kept as a named type so the quota-error
 *  + result shapes stay in lock-step with resolveProvider. */
type AltTextProvider = 'openai' | 'anthropic' | 'google';

// Conservative cost estimates (USD per image @ ≤300-token reply,
// includes the base64 image payload tokenization). These match the
// 2026-05-25 catalog list prices in ai-providers.ts.
//   * gpt-4o-mini   $0.15/M in, $0.60/M out → ~$0.0010-0.0025/call
//                   with image input (varies with image size; ~0.002
//                   for a 1920px JPEG)
//   * claude-haiku-4-5  $1.00/M in, $5.00/M out → ~$0.003-0.005/call
const OPENAI_EST_COST_USD = 0.002;
const ANTHROPIC_EST_COST_USD = 0.004;
//   * gemini-2.5-flash  $0.075/M in, $0.30/M out → ~$0.0005-0.0015/call
//                   with image input. Cheapest of the three; Google's
//                   free tier (1500 req/day) often makes it $0 for the
//                   tenant.
const GOOGLE_EST_COST_USD = 0.001;

// Hard cap on persisted alt-text. WCAG short-alt ≤125 chars; this
// matches the Prisma column VARCHAR(160). Anything longer is clipped
// silently — a 1000-char rant from the model is useless to a screen
// reader.
const MAX_ALT_TEXT_CHARS = 160;

// Shared per-tenant hourly AI cap (audit §3 P3, 2026-05-30). Alt-text counts
// against the SAME ceiling as sparkle + touch-template + the concierge (one
// shared Redis sorted set, ai:rl:gen:<tenantId>). Resolved from the SAME
// env-overridable source as AiService.HOURLY_CAP so both stay in lock-step
// (2026-06-28: default raised 30 → 120, AI_HOURLY_CAP override).
const HOURLY_CAP = resolveAiHourlyCap();

// Hard fetch timeout. Alt-text generation runs fire-and-forget after
// upload; we don't want a hung provider holding a connection.
// 2026-09-22: 5s → 15s. The caption now runs on the provider's Standard-tier
// model (catalog-resolved, so it auto-upgrades) and the current Standard
// models reason before answering; a 5s ceiling was sized for gpt-4o-mini.
const FETCH_TIMEOUT_MS = 15_000;

// A caption is under 125 characters; 300 visible tokens is generous. Models that reason get
// headroom on top of this automatically (requestParamsFor).
const ALT_TEXT_MAX_TOKENS = 300;

// System prompt — short, deterministic, screen-reader-friendly.
// "Don't say image of" is in the WCAG H37 technique; the model will
// otherwise reflexively start with "An image of …" 90% of the time.
const ALT_TEXT_SYSTEM_PROMPT =
  'Generate a concise alt-text description (under 125 characters) for this image suitable for screen readers. ' +
  'Don\'t say "image of" or "picture of". Just describe the visible content. ' +
  'No emoji, no markdown, no quotes — return plain text only.';

// 2026-06-28 — Signage Concierge design-reference analysis. The customer
// uploads a photo of signage / a brand / a look they like; the concierge needs
// a compact STYLE read (not an accessibility caption) it can fold into the
// design brief. Strict JSON so the parse is reliable; defensive fallback in
// analyzeDesignReference treats a non-JSON reply as the summary.
const DESIGN_REFERENCE_SYSTEM_PROMPT =
  'You are a design analyst for digital signage. Look at this reference image ' +
  '(signage, a brand, a style the customer likes — or a photo of their MENU). Return ONLY JSON: ' +
  '{"summary":"1-2 sentences describing the visual style — mood, color feel, layout, typography vibe, imagery","palette":["#hex",...],' +
  '"menu":{"sections":[{"name":"Section","items":[{"name":"Item","price":"12.50","description":"short"}]}]}} ' +
  'with up to 6 dominant hex colors. Include "menu" ONLY when the image is a menu, menu board or price list; ' +
  'omit it for anything else. When you include it, copy every item name and price EXACTLY as printed ' +
  '(at most 8 sections and 60 items; keep descriptions under 140 characters or leave them out); ' +
  'never invent, round or guess a price — leave "price" out of an item whose price you cannot read clearly. ' +
  'No markdown, no text outside the JSON.';

// A design-reference read needs more room than a 125-char caption (a 1-2
// sentence style summary + a 6-color palette) — and since 2026-09-22 it can
// also carry a whole menu read off a photo (60 items of JSON is ~2.5k tokens).
// A style-only reply is still short, so the ceiling costs nothing there.
const DESIGN_REFERENCE_MAX_TOKENS = 3000;
// Operator-interactive (they're waiting on the concierge). A long menu takes
// longer to write out than a style summary; a short reply still returns fast.
const DESIGN_REFERENCE_TIMEOUT_MS = 30_000;
// Clamp the persisted style summary. ConciergeReference.summary is bounded to
// 4000 at the Zod boundary; 700 keeps the system-prompt reference block tight.
const MAX_DESIGN_SUMMARY_CHARS = 700;

export interface GenerateAltTextArgs {
  tenantId: string;
  /** Bytes to feed to the vision model. Pass the OPTIMIZED buffer when
   *  available — smaller payload = faster + cheaper. */
  imageBuffer: Buffer;
  /** mime type of imageBuffer; used both for provider payload framing
   *  and to short-circuit non-image inputs. */
  mimeType: string;
  /** Optional context hint to steer the model. Recommended source:
   *  the original filename ("lions-mascot.png" → "Lions mascot" hint
   *  helps the model identify the subject of a logo image). */
  contextHint?: string;
  /** Asset id for audit-log correlation. Optional because operator-
   *  triggered regenerations may pre-create the row before saving. */
  assetId?: string;
  /** Operator id for audit-log correlation on manual regenerations. */
  userId?: string;
}

export interface GenerateAltTextResult {
  altText: string;
  provider: AltTextProvider;
  model: string;
  /** Estimated USD spend for this call (catalog list price × tokens). */
  estCostUsd: number;
}

/**
 * Custom error thrown ONLY on provider OUT-OF-CREDIT failures.
 * Lets the controller surface "you ran out of credit" distinctly from
 * "the image was rejected." All other errors result in a null return.
 *
 * 2026-05-28 audit P1-7 — this is now POPULATED FROM the shared
 * `mapProviderQuotaError` (ai-providers.ts) rather than from a forked
 * copy of the quota-detection logic. The shared helper is the single
 * source of truth for "out of credit vs rate-limit" across every AI
 * surface (text-gen, touch-template, AND alt-text), so an Anthropic
 * vision call that 429s out-of-credit — or any future provider quirk —
 * disambiguates IDENTICALLY here as on the text-gen path. We retain
 * this concrete error type (instead of the helper's plain envelope)
 * because the controller + tests branch on `instanceof
 * AiAltTextQuotaError` to decide whether to surface the friendly
 * "add credits" toast.
 *
 * `code` mirrors the shared helper's `ProviderQuotaError.code` so the
 * audit row + any caller see the same disambiguation token used on the
 * text-gen path. Only `AI_PROVIDER_OUT_OF_CREDIT` is ever thrown — a
 * pure per-minute rate-limit (helper returns null) falls through to the
 * generic-error / null-return path, exactly like text-gen.
 */
export class AiAltTextQuotaError extends Error {
  constructor(
    public readonly provider: AltTextProvider,
    public readonly statusCode: number,
    message: string,
    public readonly code: 'AI_PROVIDER_OUT_OF_CREDIT' = 'AI_PROVIDER_OUT_OF_CREDIT',
  ) {
    super(message);
    this.name = 'AiAltTextQuotaError';
  }
}

@Injectable()
export class AiAltTextService {
  private readonly logger = new Logger(AiAltTextService.name);

  constructor(
    private readonly prisma: PrismaService,
    // RedisService is @Global (RealtimeModule) — injected so alt-text
    // can share the 30/hr sliding-window cap with the other AI surfaces.
    private readonly redis: RedisService,
    // 2026-09-22 — dollar-metered ledger + the organisation's included allowance, shared with
    // AiService. @Optional so the specs that construct this by hand keep compiling.
    @Optional() private readonly meter?: AiUsageMeterService,
    @Optional() private readonly allowance?: AiAllowanceService,
  ) {}

  /**
   * Resolve which provider key to use. BYOK wins; we look at the
   * tenant's stored aiProvider preference first, falling back to
   * whichever platform env var is available.
   *
   * All three catalog providers support vision; the MODEL is the provider's
   * Standard tier, resolved live from the catalog (`visionModelFor`, 2026-09-22),
   * so a caption auto-upgrades with every other `fast` job:
   *   - OpenAI    BYOK or platform OPENAI_API_KEY
   *   - Anthropic BYOK or platform ANTHROPIC_API_KEY
   *   - Google    BYOK only (the platform fallback keys are OpenAI→Anthropic)
   *
   * ECONOMIC-MODEL SAFETY (2026-08-03) — the S5 `AI_KEY_UNREADABLE` hard stop
   * shipped to every spend path in `AiService.resolveProviderKey` on
   * 2026-07-16, but THIS resolver kept a pre-hardening copy: on a decrypt
   * failure it logged a warning and fell straight through to the platform
   * OPENAI_API_KEY / ANTHROPIC_API_KEY. So a tenant whose BYOK key became
   * unreadable (master-key rotation, corrupted blob) silently billed the
   * PLATFORM Tier-1 budget for their Tier-2 alt-text — the exact thing
   * CLAUDE.md's economic model forbids ("The platform must NEVER silently
   * spend Tier-1 budget on Tier-2 actions"), and it was invisible because
   * alt-text is fire-and-forget. A configured-but-unreadable key is now a
   * hard stop: no platform call, no spend, an actionable audit row.
   *
   * Returns one of four outcomes so the caller can emit an HONEST skip
   * reason (2026-05-29 audit §3 fix — the old code logged
   * `no_ai_provider_configured` even when a provider WAS configured but
   * alt-text couldn't use it):
   *   - { resolved }            → a usable vision provider + key
   *   - { unreadableKey }       → a BYOK key IS set but could not be
   *                               decrypted. HARD STOP — never falls back
   *                               to the platform key. Caller emits
   *                               `ai_key_unreadable`.
   *   - { unsupportedProvider } → a BYOK key IS set, but for a provider
   *                               alt-text can't use (no recognized
   *                               vision branch). Caller emits
   *                               `provider_unsupported_for_altext`.
   *   - {}                      → no key at all anywhere. Caller emits
   *                               `no_ai_provider_configured`.
   */
  private async resolveProvider(tenantId: string): Promise<{
    resolved?: {
      provider: AltTextProvider;
      apiKey: string;
      model: string;
      source: 'tenant' | 'platform';
    };
    /** Set when a BYOK key exists but could not be decrypted — distinct
     *  from both "no key at all" and "provider has no vision branch". */
    unreadableKey?: true;
    /** Set when a BYOK key exists but its provider has no alt-text
     *  vision branch — distinct from "no key at all". */
    unsupportedProvider?: string;
  }> {
    // 1) BYOK — this tenant's own key, else the nearest ancestor's (ai-tenant-key.ts); supports
    // openai, anthropic, OR google for vision.
    const tenant = await findTenantAiKeyRow(this.prisma.client as any, tenantId);
    if (tenant?.aiKeyEncrypted && tenant?.aiProvider) {
      const provider = String(tenant.aiProvider).toLowerCase();
      if (provider === 'openai' || provider === 'anthropic' || provider === 'google') {
        try {
          const apiKey = openAiKey(tenant.aiKeyEncrypted);
          // Reading an image is a `fast` job: every provider uses its
          // Standard-tier vision model (visionModelFor), never the tenant's
          // board-design tier — so `model` here is informational only.
          const model = '';
          return {
            resolved: {
              provider: provider as AltTextProvider,
              apiKey,
              model,
              source: 'tenant',
            },
          };
        } catch (e: any) {
          // Decryption failed (master-key rotation, corrupted blob). This
          // used to fall through to the platform key — silently spending
          // Tier-1 budget on a Tier-2 action. HARD STOP instead; the caller
          // audits `ai_key_unreadable` so the operator re-enters the key.
          this.logger.error(`Failed to decrypt tenant AI key (${tenant.keyTenantId}) for alt-text: ${e?.message}`);
          return { unreadableKey: true };
        }
      } else {
        // A BYOK key is configured but for a provider we have no vision
        // branch for. With openai/anthropic/google all covered this is
        // only reachable for a future/unknown provider — but we must
        // NOT claim "no provider configured" (the §3 honesty bug).
        return { unsupportedProvider: provider };
      }
    }
    // 2) Platform fallback — our OpenAI key when we hold one (its Standard-tier
    // vision model is the cheapest caption: GPT-6 Luna at $0.10/$0.50 vs Claude
    // Haiku 4.5 at $1/$5), else our Anthropic key (platformVisionProvider — the
    // same answer Super Admin shows). No Google platform vision.
    const visionProvider = platformVisionProvider();
    const platformKey = visionProvider ? platformKeyFor(visionProvider) : null;
    if (visionProvider && platformKey) {
      return { resolved: { provider: visionProvider, apiKey: platformKey, model: '', source: 'platform' } };
    }
    return {};
  }

  /**
   * Is the organisation's INCLUDED AI for this month used up? The same dollar allowance
   * AiService enforces (ai-allowance.service.ts — $ per paired screen, pooled per organisation),
   * so a caption and a board draw on one budget. Only the platform key is limited; BYOK tenants
   * never reach this. No allowance service (hand-built specs) → never exhausted.
   */
  private async isPlatformCapExhausted(tenantId: string): Promise<boolean> {
    if (!this.allowance) return false;
    const a = await this.allowance.snapshot(tenantId);
    return a.usedMicros >= a.includedMicros;
  }

  /** Write the ledger row for one vision call (best-effort; never throws). */
  private async meterCall(
    tenantId: string,
    resolved: { provider: AltTextProvider; source: 'tenant' | 'platform' },
    model: string,
    feature: string,
    usage: TokenUsage | undefined,
  ): Promise<void> {
    if (!this.meter) return;
    await this.meter.record({ tenantId, provider: resolved.provider, model, source: resolved.source, feature, usage });
  }

  /**
   * Best-effort audit row. NEVER throws — alt-text is fire-and-forget
   * and a logging failure mustn't fail the controller.
   */
  private async auditLog(args: {
    tenantId: string;
    userId?: string;
    action:
      | 'AI_ALT_TEXT_GENERATED'
      | 'AI_ALT_TEXT_SKIPPED'
      | 'AI_ALT_TEXT_FAILED'
      // 2026-06-28 — Signage Concierge design-reference image analysis.
      | 'AI_DESIGN_REFERENCE_ANALYZED'
      | 'AI_DESIGN_REFERENCE_SKIPPED'
      | 'AI_DESIGN_REFERENCE_FAILED';
    assetId?: string;
    details: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.prisma.client.auditLog.create({
        data: {
          action: args.action,
          targetType: args.assetId ? 'asset' : 'tenant',
          targetId: args.assetId || args.tenantId,
          tenantId: args.tenantId,
          userId: args.userId || null,
          details: JSON.stringify(args.details),
        },
      });
    } catch (e: any) {
      this.logger.debug(`alt-text audit log write failed: ${e?.message}`);
    }
  }

  /**
   * Public entrypoint. Returns the generated alt-text on success, or
   * null on ANY failure path (no AI configured, no vision provider,
   * platform cap exhausted, provider error, timeout, malformed reply).
   *
   * Throws AiAltTextQuotaError ONLY for operator-triggered regenerations
   * where the FE wants to surface "you ran out of credit" — controller
   * branches on that error. Background calls from the upload path
   * catch and swallow.
   */
  async generateImageAltText(args: GenerateAltTextArgs): Promise<GenerateAltTextResult | null> {
    // Guard 1: must be an image. We accept the same image mime list the
    // controller accepts (jpeg/png/webp/gif) but skip animated GIFs
    // because the vision providers don't use frames usefully.
    const mime = (args.mimeType || '').toLowerCase();
    if (!mime.startsWith('image/')) {
      await this.auditLog({
        tenantId: args.tenantId,
        userId: args.userId,
        assetId: args.assetId,
        action: 'AI_ALT_TEXT_SKIPPED',
        details: { reason: 'not_an_image', mimeType: mime, bytes: args.imageBuffer.length },
      });
      return null;
    }

    // Guard 2: resolve a vision-capable provider. Distinguish "no key
    // at all" from "a key IS set but its provider can't do vision" so
    // the skip reason is HONEST (2026-05-29 audit §3 fix).
    const resolveOutcome = await this.resolveProvider(args.tenantId);
    // S5 hard stop (2026-08-03): a configured-but-unreadable BYOK key must
    // NEVER fall through to the platform (Tier-1) key. Skip + audit rather
    // than throw — this method is fire-and-forget from the upload path and
    // an unreadable key must not fail an operator's upload.
    if (resolveOutcome.unreadableKey) {
      await this.auditLog({
        tenantId: args.tenantId,
        userId: args.userId,
        assetId: args.assetId,
        action: 'AI_ALT_TEXT_SKIPPED',
        details: {
          reason: 'ai_key_unreadable',
          code: 'AI_KEY_UNREADABLE',
          message:
            'Your saved AI key could not be read — re-enter it in Settings → AI provider.',
        },
      });
      return null;
    }
    if (resolveOutcome.unsupportedProvider) {
      await this.auditLog({
        tenantId: args.tenantId,
        userId: args.userId,
        assetId: args.assetId,
        action: 'AI_ALT_TEXT_SKIPPED',
        details: {
          reason: 'provider_unsupported_for_altext',
          provider: resolveOutcome.unsupportedProvider,
          message:
            'This AI provider powers the text generators, but image alt-text needs OpenAI, Anthropic, or Google.',
        },
      });
      return null;
    }
    const resolved = resolveOutcome.resolved;
    if (!resolved) {
      await this.auditLog({
        tenantId: args.tenantId,
        userId: args.userId,
        assetId: args.assetId,
        action: 'AI_ALT_TEXT_SKIPPED',
        details: { reason: 'no_ai_provider_configured' },
      });
      return null;
    }

    // Guard 3: platform free-tier cap.
    if (resolved.source === 'platform' && await this.isPlatformCapExhausted(args.tenantId)) {
      await this.auditLog({
        tenantId: args.tenantId,
        userId: args.userId,
        assetId: args.assetId,
        action: 'AI_ALT_TEXT_SKIPPED',
        details: { reason: 'platform_cap_exhausted', provider: resolved.provider, source: resolved.source },
      });
      return null;
    }

    // Guard 4: SHARED 30/hr hourly cap (audit §3 P3). Alt-text counts
    // against the SAME per-tenant sliding window as sparkle + touch-
    // template, so an operator can't blow past 30/hr by mixing the
    // sparkle button with a bulk image upload. Applies to BOTH platform
    // and BYOK tenants — it's a runaway/abuse guard, not a spend cap
    // (mirrors AiService, which also checks the window for all sources).
    // Fire-and-forget contract preserved: at cap we SKIP + audit, we
    // never throw (an upload must not fail because the hour's AI budget
    // is spent). Fails OPEN on Redis loss (helper returns 0).
    if ((await aiWindowCount(this.redis.publisher, args.tenantId)) >= HOURLY_CAP) {
      await this.auditLog({
        tenantId: args.tenantId,
        userId: args.userId,
        assetId: args.assetId,
        action: 'AI_ALT_TEXT_SKIPPED',
        details: { reason: 'hourly_cap_reached', cap: HOURLY_CAP, provider: resolved.provider, source: resolved.source },
      });
      return null;
    }

    // Encode image as base64 data URL once for both providers.
    const base64 = args.imageBuffer.toString('base64');

    let altText: string | null = null;
    // The provider's Standard-tier vision model, resolved live (2026-09-22) — a caption rides
    // the same auto-upgrading tier as every other `fast` job; no model id lives in this file.
    const model = visionModelFor(resolved.provider);
    let estCost = 0;
    try {
      const userText = args.contextHint
        ? `Context (from filename — may be misleading): ${args.contextHint.slice(0, 200)}. Describe the image:`
        : 'Describe the image:';
      const out = await this.callVisionRaw(
        resolved.provider,
        resolved.apiKey,
        base64,
        mime,
        ALT_TEXT_SYSTEM_PROMPT,
        userText,
        model,
        ALT_TEXT_MAX_TOKENS,
        FETCH_TIMEOUT_MS,
      );
      altText = out.text;
      await this.meterCall(args.tenantId, resolved, model, 'alt-text', out.usage);
      estCost =
        resolved.provider === 'openai'
          ? OPENAI_EST_COST_USD
          : resolved.provider === 'google'
            ? GOOGLE_EST_COST_USD
            : ANTHROPIC_EST_COST_USD;
    } catch (e: any) {
      if (e instanceof AiAltTextQuotaError) {
        // Quota errors — log and re-throw so operator-triggered paths
        // can surface the friendly message. Background paths catch.
        await this.auditLog({
          tenantId: args.tenantId,
          userId: args.userId,
          assetId: args.assetId,
          action: 'AI_ALT_TEXT_FAILED',
          details: {
            provider: resolved.provider,
            model,
            source: resolved.source,
            errorCode: 'AI_QUOTA_EXHAUSTED',
            statusCode: e.statusCode,
            bytes: args.imageBuffer.length,
          },
        });
        if (resolved.source === 'platform') {
          // OUR key is out of credit — never show a tenant the vendor's "add credits to your
          // account" steps for an account they do not own. Log it loudly for us instead.
          this.logger.error(`PLATFORM AI KEY PROBLEM: our ${resolved.provider} key is out of credit (alt text)`);
          throw new AiAltTextQuotaError(
            resolved.provider,
            e.statusCode,
            'AI is temporarily unavailable. Try again in a few minutes.',
          );
        }
        throw e;
      }
      this.logger.warn(`alt-text generation failed (${resolved.provider}): ${e?.message}`);
      await this.auditLog({
        tenantId: args.tenantId,
        userId: args.userId,
        assetId: args.assetId,
        action: 'AI_ALT_TEXT_FAILED',
        details: {
          provider: resolved.provider,
          model,
          source: resolved.source,
          error: String(e?.message || e).slice(0, 200),
          bytes: args.imageBuffer.length,
        },
      });
      return null;
    }

    if (!altText) {
      await this.auditLog({
        tenantId: args.tenantId,
        userId: args.userId,
        assetId: args.assetId,
        action: 'AI_ALT_TEXT_FAILED',
        details: {
          provider: resolved.provider,
          model,
          source: resolved.source,
          error: 'empty_response',
          bytes: args.imageBuffer.length,
        },
      });
      return null;
    }

    // Sanitize: trim, strip surrounding quotes the model sometimes adds,
    // strip "image of" / "picture of" prefixes if they slipped through,
    // and clip to MAX_ALT_TEXT_CHARS.
    altText = altText.trim().replace(/^["'""'']+|["'""'']+$/g, '').trim();
    altText = altText.replace(/^(image|picture|photo|photograph|illustration)\s+of\s+/i, '');
    altText = altText.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (altText.length > MAX_ALT_TEXT_CHARS) {
      altText = altText.slice(0, MAX_ALT_TEXT_CHARS - 1).trimEnd() + '…';
    }

    // Record one slot in the SHARED 30/hr window (audit §3 P3) — ONLY
    // after a usable result, same leak-fix discipline as AiService
    // (a failed / empty call must not burn the hourly cap). Counts for
    // both platform and BYOK so the ceiling is one shared budget.
    // Best-effort — the helper swallows Redis errors.
    await aiRecordEvent(this.redis.publisher, args.tenantId);

    // Spend was metered at the call (meterCall → the usage ledger, real cost
    // at the catalog price) — there is no separate counter to bump.

    await this.auditLog({
      tenantId: args.tenantId,
      userId: args.userId,
      assetId: args.assetId,
      action: 'AI_ALT_TEXT_GENERATED',
      details: {
        provider: resolved.provider,
        model,
        source: resolved.source,
        bytes: args.imageBuffer.length,
        estCostUsd: estCost,
        chars: altText.length,
      },
    });

    return { altText, provider: resolved.provider, model, estCostUsd: estCost };
  }

  /**
   * Signage Concierge design-reference analysis (2026-06-28). Generalized
   * sibling of generateImageAltText: instead of a screen-reader caption it
   * returns a STYLE read (1-2 sentence summary + dominant palette) the
   * concierge folds into its design brief. Reuses the EXACT plumbing —
   * resolveProvider (BYOK→platform), isPlatformCapExhausted, the shared 30/hr
   * window (aiWindowCount/aiRecordEvent), bumpPlatformUsage, and auditLog — so
   * a reference upload counts against the same budget as every other AI
   * surface. Like alt-text it NEVER throws on a provider/cap miss; it returns
   * null (the caller surfaces a friendly "describe the look instead" message).
   *
   * Some duplication of the three provider wire-branches is acceptable here
   * (callVisionRaw) to avoid touching the load-bearing alt-text methods.
   */
  async analyzeDesignReference(args: {
    tenantId: string;
    userId?: string;
    imageBuffer: Buffer;
    mimeType: string;
  }): Promise<{ summary: string; palette: string[]; menu?: ExtractedMenu; provider: string; model: string } | null> {
    // Guard 1: must be an image.
    const mime = (args.mimeType || '').toLowerCase();
    if (!mime.startsWith('image/')) {
      await this.auditLog({
        tenantId: args.tenantId,
        userId: args.userId,
        action: 'AI_DESIGN_REFERENCE_SKIPPED',
        details: { reason: 'not_an_image', mimeType: mime, bytes: args.imageBuffer.length },
      });
      return null;
    }

    // Guard 2: resolve a vision-capable provider (HONEST skip reasons).
    const resolveOutcome = await this.resolveProvider(args.tenantId);
    // Same S5 hard stop as generateImageAltText — a configured-but-unreadable
    // BYOK key must never silently spend the platform (Tier-1) key.
    if (resolveOutcome.unreadableKey) {
      await this.auditLog({
        tenantId: args.tenantId,
        userId: args.userId,
        action: 'AI_DESIGN_REFERENCE_SKIPPED',
        details: {
          reason: 'ai_key_unreadable',
          code: 'AI_KEY_UNREADABLE',
          message:
            'Your saved AI key could not be read — re-enter it in Settings → AI provider.',
        },
      });
      return null;
    }
    if (resolveOutcome.unsupportedProvider) {
      await this.auditLog({
        tenantId: args.tenantId,
        userId: args.userId,
        action: 'AI_DESIGN_REFERENCE_SKIPPED',
        details: {
          reason: 'provider_unsupported_for_vision',
          provider: resolveOutcome.unsupportedProvider,
        },
      });
      return null;
    }
    const resolved = resolveOutcome.resolved;
    if (!resolved) {
      await this.auditLog({
        tenantId: args.tenantId,
        userId: args.userId,
        action: 'AI_DESIGN_REFERENCE_SKIPPED',
        details: { reason: 'no_ai_provider_configured' },
      });
      return null;
    }

    // Guard 3: platform free-tier monthly cap.
    if (resolved.source === 'platform' && await this.isPlatformCapExhausted(args.tenantId)) {
      await this.auditLog({
        tenantId: args.tenantId,
        userId: args.userId,
        action: 'AI_DESIGN_REFERENCE_SKIPPED',
        details: { reason: 'platform_cap_exhausted', provider: resolved.provider, source: resolved.source },
      });
      return null;
    }

    // Guard 4: SHARED 30/hr hourly cap (applies to BOTH platform + BYOK —
    // runaway guard, not a spend cap; fails OPEN on Redis loss).
    if ((await aiWindowCount(this.redis.publisher, args.tenantId)) >= HOURLY_CAP) {
      await this.auditLog({
        tenantId: args.tenantId,
        userId: args.userId,
        action: 'AI_DESIGN_REFERENCE_SKIPPED',
        details: { reason: 'hourly_cap_reached', cap: HOURLY_CAP, provider: resolved.provider, source: resolved.source },
      });
      return null;
    }

    const base64 = args.imageBuffer.toString('base64');
    const userText = 'Analyze the visual style of this reference image for digital signage.';

    let raw: string | null = null;
    // Same live Standard-tier vision model as alt text (2026-09-22).
    const model = visionModelFor(resolved.provider);
    try {
      const out = await this.callVisionRaw(
        resolved.provider,
        resolved.apiKey,
        base64,
        mime,
        DESIGN_REFERENCE_SYSTEM_PROMPT,
        userText,
        model,
        DESIGN_REFERENCE_MAX_TOKENS,
        DESIGN_REFERENCE_TIMEOUT_MS,
      );
      raw = out.text;
      await this.meterCall(args.tenantId, resolved, model, 'design-reference', out.usage);
    } catch (e: any) {
      // Quota errors + generic errors both → null (concierge degrades to
      // "describe the look instead"). Audit with the disambiguation.
      const isQuota = e instanceof AiAltTextQuotaError;
      this.logger.warn(`design-reference analysis failed (${resolved.provider}): ${e?.message}`);
      await this.auditLog({
        tenantId: args.tenantId,
        userId: args.userId,
        action: 'AI_DESIGN_REFERENCE_FAILED',
        details: {
          provider: resolved.provider,
          model,
          source: resolved.source,
          ...(isQuota
            ? { errorCode: 'AI_QUOTA_EXHAUSTED', statusCode: (e as AiAltTextQuotaError).statusCode }
            : { error: String(e?.message || e).slice(0, 200) }),
          bytes: args.imageBuffer.length,
        },
      });
      return null;
    }

    if (!raw || !raw.trim()) {
      await this.auditLog({
        tenantId: args.tenantId,
        userId: args.userId,
        action: 'AI_DESIGN_REFERENCE_FAILED',
        details: { provider: resolved.provider, model, source: resolved.source, error: 'empty_response' },
      });
      return null;
    }

    // Parse defensively — strip fences, JSON.parse, fall back to treating the
    // whole reply as the summary with an empty palette.
    const { summary, palette, rawMenu } = parseDesignReferenceReply(raw);
    // A photo of a printed menu / menu board becomes a real menu (2026-09-22).
    const menu = rawMenu ? menuFromPhotoReading(rawMenu, 'uploaded photo') : null;
    if (!summary) {
      await this.auditLog({
        tenantId: args.tenantId,
        userId: args.userId,
        action: 'AI_DESIGN_REFERENCE_FAILED',
        details: { provider: resolved.provider, model, source: resolved.source, error: 'no_summary' },
      });
      return null;
    }

    // Hourly window — record only AFTER a usable result (leak-fix). Spend
    // itself was metered at the call.
    await aiRecordEvent(this.redis.publisher, args.tenantId);

    await this.auditLog({
      tenantId: args.tenantId,
      userId: args.userId,
      action: 'AI_DESIGN_REFERENCE_ANALYZED',
      details: {
        provider: resolved.provider,
        model,
        source: resolved.source,
        bytes: args.imageBuffer.length,
        chars: summary.length,
        colors: palette.length,
        menuItems: menu?.itemCount ?? 0,
      },
    });

    return menu
      ? { summary, palette, menu, provider: resolved.provider, model }
      : { summary, palette, provider: resolved.provider, model };
  }

  /**
   * The ONE vision call (alt text, design references, menu photos). Same three provider wire
   * shapes as before, but every model-specific parameter now comes from the catalog
   * (`requestParamsFor`, 2026-09-22): temperature only where the model takes it, the model's own
   * effort knob, reasoning headroom on the output ceiling — so an upgrade to a thinking model
   * cannot 400 or come back empty. The answer is read by content-block TYPE (a thinking model's
   * reply starts with thinking blocks). Returns the text (null when empty) and the token usage for
   * the ledger; throws AiAltTextQuotaError on out-of-credit, a generic Error otherwise.
   */
  private async callVisionRaw(
    provider: AltTextProvider,
    apiKey: string,
    base64Image: string,
    mimeType: string,
    systemPrompt: string,
    userText: string,
    model: string,
    maxTokens: number,
    timeoutMs: number,
  ): Promise<{ text: string | null; usage: TokenUsage }> {
    const params = requestParamsFor(provider, model, maxTokens, 'fast');
    let res: Response;
    if (provider === 'openai') {
      res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          ...params,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                { type: 'text', text: userText },
                {
                  type: 'image_url',
                  image_url: { url: `data:${mimeType};base64,${base64Image}` },
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } else if (provider === 'google') {
      // SECURITY — the key goes in the `x-goog-api-key` HEADER, never on the URL: Google echoes
      // the request URL in error bodies, and those bodies flow into the audit row + logs.
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}` +
        `:generateContent`;
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [
            {
              role: 'user',
              parts: [
                { text: userText },
                { inlineData: { mimeType, data: base64Image } },
              ],
            },
          ],
          ...params, // { generationConfig }
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } else {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          ...params,
          // Ephemeral prompt cache — both system prompts are identical on every call, so the
          // block-array form carries cache_control for the ~90% repeat-call discount (bulk alt
          // text on an upload batch is exactly the case it pays off on). Anthropic-only.
          system: [
            {
              type: 'text',
              text: systemPrompt,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: { type: 'base64', media_type: mimeType, data: base64Image },
                },
                { type: 'text', text: userText },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    }
    if (!res.ok) {
      let body = await res.text().catch(() => '');
      // Belt-and-suspenders: redact any key=… before it reaches logs.
      if (provider === 'google') body = body.replace(/[?&]key=[^&\s"']+/g, '&key=REDACTED');
      this.throwMappedProviderError(provider, res.status, body);
    }
    const json = (await res.json()) as any;
    const text = textFromResponse(provider, json).trim();
    return { text: text || null, usage: usageFromResponse(provider, json) };
  }

  /**
   * Map a provider non-2xx through the SHARED `mapProviderQuotaError`
   * (audit P1-7). When the shared helper recognizes an out-of-credit
   * signature it throws the concrete `AiAltTextQuotaError` (so the
   * operator-triggered path surfaces the friendly "add credits"
   * message). When it returns null — a pure per-minute rate-limit, or
   * any other status — this throws a generic Error so the caller logs
   * + returns null (background paths swallow). Centralizing here means
   * Anthropic 429 / OpenAI 429 / Google all disambiguate exactly as on
   * the text-gen path, instead of the old forked logic that only knew
   * about Anthropic 402/400 + OpenAI 429.
   */
  private throwMappedProviderError(
    provider: AltTextProvider,
    status: number,
    body: string,
  ): never {
    const quotaErr = mapProviderQuotaError(provider, status, body);
    if (quotaErr && quotaErr.code === 'AI_PROVIDER_OUT_OF_CREDIT') {
      throw new AiAltTextQuotaError(provider, status, quotaErr.message, quotaErr.code);
    }
    // Pure rate-limit (helper → null) or any other non-2xx → generic
    // error → caller logs + returns null. The provider name + status
    // are preserved in the message for the audit row.
    const label = provider === 'openai' ? 'OpenAI' : provider === 'google' ? 'Google' : 'Anthropic';
    throw new Error(`${label} ${status}: ${body.slice(0, 200)}`);
  }

}

/**
 * Defensive parse of the design-reference model reply (2026-06-28). Strips
 * markdown fences, JSON.parses {summary, palette}, and falls back to treating
 * the whole reply as the summary (empty palette) on any failure. Clamps the
 * summary to MAX_DESIGN_SUMMARY_CHARS and palette to up to 6 valid 6-digit
 * hexes. Pure — exported for unit testing.
 */
export function parseDesignReferenceReply(raw: string): { summary: string; palette: string[]; rawMenu?: unknown } {
  const text = String(raw || '').trim();
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let obj: any = null;
  try {
    obj = JSON.parse(stripped);
  } catch {
    // The model sometimes prepends a sentence — grab the first {...} block.
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        obj = JSON.parse(stripped.slice(start, end + 1));
      } catch {
        obj = null;
      }
    }
  }

  const clampSummary = (s: string): string =>
    s.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_DESIGN_SUMMARY_CHARS);
  const clampPalette = (arr: any): string[] => {
    if (!Array.isArray(arr)) return [];
    return arr
      .map((c: any) => String(c || '').trim())
      .filter((c: string) => /^#?[0-9a-fA-F]{6}$/.test(c))
      .map((c: string) => (c.startsWith('#') ? c.toLowerCase() : `#${c.toLowerCase()}`))
      .filter((c: string, i: number, a: string[]) => a.indexOf(c) === i)
      .slice(0, 6);
  };

  if (obj && typeof obj === 'object') {
    const summary = typeof obj.summary === 'string' ? clampSummary(obj.summary) : '';
    const palette = clampPalette(obj.palette);
    // The menu, when the picture was one, is handed back RAW — the caller runs
    // it through menuFromPhotoReading(), the same normaliser a website menu
    // gets, so this stays a pure text parser.
    const rawMenu = obj.menu && typeof obj.menu === 'object' ? obj.menu : undefined;
    // If the JSON had no usable summary, fall through to the raw-text fallback.
    if (summary) return rawMenu ? { summary, palette, rawMenu } : { summary, palette };
  }

  // Total parse failure (or JSON with no summary) — use the whole reply as the
  // summary with an empty palette so the concierge still gets a style read.
  return { summary: clampSummary(text), palette: [] };
}
