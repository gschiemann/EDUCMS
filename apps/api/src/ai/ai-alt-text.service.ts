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
 *     Falls back to Anthropic claude-3-5-haiku with vision (similar
 *     cost) when only an ANTHROPIC_API_KEY is configured. Google Gemini
 *     vision is not yet supported here because the gemini-2.5-flash
 *     vision interface is more verbose to wire and the two-provider
 *     fallback covers the common BYOK + platform cases.
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

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { openAiKey } from './ai-key-cipher';
import { mapProviderQuotaError } from './ai-providers';

// Conservative cost estimates (USD per image @ ≤300-token reply,
// includes the base64 image payload tokenization). These match the
// 2026-05-25 catalog list prices in ai-providers.ts.
//   * gpt-4o-mini   $0.15/M in, $0.60/M out → ~$0.0010-0.0025/call
//                   with image input (varies with image size; ~0.002
//                   for a 1920px JPEG)
//   * claude-3-5-haiku  $1.00/M in, $5.00/M out → ~$0.003-0.005/call
const OPENAI_EST_COST_USD = 0.002;
const ANTHROPIC_EST_COST_USD = 0.004;

// Hard cap on persisted alt-text. WCAG short-alt ≤125 chars; this
// matches the Prisma column VARCHAR(160). Anything longer is clipped
// silently — a 1000-char rant from the model is useless to a screen
// reader.
const MAX_ALT_TEXT_CHARS = 160;

// Hard fetch timeout. Alt-text generation runs fire-and-forget after
// upload; we don't want a hung provider holding a connection.
const FETCH_TIMEOUT_MS = 5_000;

// System prompt — short, deterministic, screen-reader-friendly.
// "Don't say image of" is in the WCAG H37 technique; the model will
// otherwise reflexively start with "An image of …" 90% of the time.
const ALT_TEXT_SYSTEM_PROMPT =
  'Generate a concise alt-text description (under 125 characters) for this image suitable for screen readers. ' +
  'Don\'t say "image of" or "picture of". Just describe the visible content. ' +
  'No emoji, no markdown, no quotes — return plain text only.';

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
  provider: 'openai' | 'anthropic';
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
    public readonly provider: 'openai' | 'anthropic',
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

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve which provider key to use. BYOK wins; we look at the
   * tenant's stored aiProvider preference first, falling back to
   * whichever platform env var is available.
   *
   * Differs from AiService.resolveProviderKey because alt-text REQUIRES
   * vision-capable models — Gemini wiring is deferred. Hard-prefers
   * OpenAI 4o-mini (cheapest) when available; falls back to Anthropic.
   */
  private async resolveProvider(tenantId: string): Promise<{
    provider: 'openai' | 'anthropic';
    apiKey: string;
    source: 'tenant' | 'platform';
  } | null> {
    // 1) Tenant BYOK — only if their key is for openai OR anthropic.
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: { aiProvider: true, aiKeyEncrypted: true } as any,
    }) as any;
    if (tenant?.aiKeyEncrypted && tenant?.aiProvider) {
      const provider = String(tenant.aiProvider).toLowerCase();
      if (provider === 'openai' || provider === 'anthropic') {
        try {
          const apiKey = openAiKey(tenant.aiKeyEncrypted);
          return { provider: provider as 'openai' | 'anthropic', apiKey, source: 'tenant' };
        } catch (e: any) {
          // Decryption fail — log + try platform fallback.
          this.logger.warn(`Tenant ${tenantId} alt-text key decrypt failed: ${e?.message}`);
        }
      }
    }
    // 2) Platform fallback — prefer OpenAI 4o-mini (cheapest); fall
    // back to Anthropic Haiku.
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      return { provider: 'openai', apiKey: openaiKey, source: 'platform' };
    }
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey) {
      return { provider: 'anthropic', apiKey: anthropicKey, source: 'platform' };
    }
    return null;
  }

  /**
   * Check the same monthly platform free-tier cap AiService uses.
   * Returns true ONLY when (source==platform AND cap exhausted). BYOK
   * tenants bypass entirely.
   */
  private async isPlatformCapExhausted(tenantId: string): Promise<boolean> {
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: { aiPlatformUsageMonth: true, aiPlatformUsageCount: true } as any,
    }) as any;
    if (!tenant) return false;
    const now = new Date();
    const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const used = tenant.aiPlatformUsageMonth === monthKey ? (tenant.aiPlatformUsageCount ?? 0) : 0;
    const cap = parseInt(process.env.AI_FREE_TIER_CAP || '', 10);
    const limit = Number.isFinite(cap) && cap > 0 ? cap : 200;
    return used >= limit;
  }

  /**
   * Increment the platform usage counter on a successful platform-paid
   * call. Mirrors AiService.bumpPlatformUsage — keeps the counter in
   * sync regardless of which AI surface consumed the credit.
   */
  private async bumpPlatformUsage(tenantId: string): Promise<void> {
    const now = new Date();
    const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: { aiPlatformUsageMonth: true } as any,
    }) as any;
    if (tenant?.aiPlatformUsageMonth !== monthKey) {
      await this.prisma.client.tenant.update({
        where: { id: tenantId },
        data: { aiPlatformUsageMonth: monthKey, aiPlatformUsageCount: 1 } as any,
      });
    } else {
      await this.prisma.client.tenant.update({
        where: { id: tenantId },
        data: { aiPlatformUsageCount: { increment: 1 } } as any,
      });
    }
  }

  /**
   * Best-effort audit row. NEVER throws — alt-text is fire-and-forget
   * and a logging failure mustn't fail the controller.
   */
  private async auditLog(args: {
    tenantId: string;
    userId?: string;
    action: 'AI_ALT_TEXT_GENERATED' | 'AI_ALT_TEXT_SKIPPED' | 'AI_ALT_TEXT_FAILED';
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

    // Guard 2: resolve a vision-capable provider.
    const resolved = await this.resolveProvider(args.tenantId);
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

    // Encode image as base64 data URL once for both providers.
    const base64 = args.imageBuffer.toString('base64');

    let altText: string | null = null;
    let model = '';
    let estCost = 0;
    try {
      if (resolved.provider === 'openai') {
        model = 'gpt-4o-mini';
        altText = await this.callOpenAi(resolved.apiKey, base64, mime, args.contextHint, model);
        estCost = OPENAI_EST_COST_USD;
      } else {
        model = 'claude-3-5-haiku-20241022';
        altText = await this.callAnthropic(resolved.apiKey, base64, mime, args.contextHint, model);
        estCost = ANTHROPIC_EST_COST_USD;
      }
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

    // Bump platform counter on a successful platform-paid call. BYOK
    // counts are untracked (their cost, their unlimited).
    if (resolved.source === 'platform') {
      try { await this.bumpPlatformUsage(args.tenantId); }
      catch (e: any) {
        this.logger.warn(`alt-text platform usage bump failed (${args.tenantId}): ${e?.message}`);
      }
    }

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
    provider: 'openai' | 'anthropic',
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
    const label = provider === 'openai' ? 'OpenAI' : 'Anthropic';
    throw new Error(`${label} ${status}: ${body.slice(0, 200)}`);
  }

  /**
   * OpenAI 4o-mini vision call. Returns the raw alt text on success;
   * throws AiAltTextQuotaError on out-of-credit (via the shared
   * mapProviderQuotaError helper) so the operator-triggered path can
   * surface the friendly message.
   */
  private async callOpenAi(
    apiKey: string,
    base64Image: string,
    mimeType: string,
    contextHint: string | undefined,
    model: string,
  ): Promise<string | null> {
    const userText = contextHint
      ? `Context (from filename — may be misleading): ${contextHint.slice(0, 200)}. Describe the image:`
      : 'Describe the image:';
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        messages: [
          { role: 'system', content: ALT_TEXT_SYSTEM_PROMPT },
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
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // P1-7: route through the shared helper. Out-of-credit → quota
      // error; rate-limit / other → generic error → caller returns null.
      this.throwMappedProviderError('openai', res.status, body);
    }
    const json = (await res.json()) as any;
    const text = json?.choices?.[0]?.message?.content;
    return typeof text === 'string' && text.trim() ? text.trim() : null;
  }

  /**
   * Anthropic Haiku vision call. Same return contract as the OpenAI
   * variant; throws AiAltTextQuotaError on out-of-credit via the shared
   * mapProviderQuotaError helper (covers 402 AND the 400/429
   * credit_balance_too_low forms — the old forked logic here missed
   * the 429 form entirely, which was the P1-7 bug).
   */
  private async callAnthropic(
    apiKey: string,
    base64Image: string,
    mimeType: string,
    contextHint: string | undefined,
    model: string,
  ): Promise<string | null> {
    const userText = contextHint
      ? `Context (from filename — may be misleading): ${contextHint.slice(0, 200)}. Describe the image:`
      : 'Describe the image:';
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        system: ALT_TEXT_SYSTEM_PROMPT,
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
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // P1-7: route through the shared helper. Out-of-credit → quota
      // error; rate-limit / other → generic error → caller returns null.
      this.throwMappedProviderError('anthropic', res.status, body);
    }
    const json = (await res.json()) as any;
    const text = json?.content?.[0]?.text;
    return typeof text === 'string' && text.trim() ? text.trim() : null;
  }
}
