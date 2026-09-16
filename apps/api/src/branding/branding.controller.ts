/**
 * BrandingController — scrape / preview / adopt / read / revert.
 *
 * Public endpoints:
 *   POST /api/v1/branding/scrape        — auth required, previews only
 *   POST /api/v1/branding/adopt         — auth + admin role, persists
 *   GET  /api/v1/branding/me            — auth required, current tenant
 *   DELETE /api/v1/branding/me          — auth + admin, revert
 *   POST /api/v1/branding/derive-palette — auth, palette math only
 *
 * Unauthenticated demo endpoint:
 *   POST /api/v1/branding/demo/scrape   — public, rate-limited by IP,
 *     never persists, no audit log tenant resolution — lets the
 *     marketing `/demo/branding` page work without an account.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole, Prisma } from '@cms/database';
import { SupabaseStorageService } from '../storage/supabase-storage.service';

import { BrandingScraperService, BrandingPreview, sanitizeFontFamilyName } from './branding-scraper.service';
import { BrandingRateLimiter } from './branding-rate-limiter';
import { safeFetch, SsrfError } from './safe-fetch';
import { derivePalette, parseColor, ensureContrast, contrastRatio, bestTextOn, deriveReadableShades, readableShadeAdjustments, ContrastReport } from './color-utils';
import { sanitizeLogoSvg } from './sanitize-svg';
import { selectVectorLogo } from './select-vector-logo';
import { isLogoBackground, resolveStoredLogoBackground } from './logo-colors';

import { createHash } from 'crypto';

/** Closed set for TenantBranding.appearanceMode. NULL/absent reads as 'branded'. */
function isAppearanceMode(v: unknown): v is 'branded' | 'neutral' {
  return v === 'branded' || v === 'neutral';
}

@Controller('api/v1/branding')
export class BrandingController {
  private readonly logger = new Logger(BrandingController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scraper: BrandingScraperService,
    private readonly limiter: BrandingRateLimiter,
    private readonly storage: SupabaseStorageService,
  ) {}

  // ── Authed scrape: preview only, no persistence ─────────────────
  @Post('scrape')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async scrape(@Request() req: any, @Body() body: { url: string }) {
    const tenantId = req.user.tenantId;
    return this.runScrape(body?.url, tenantId, req.user.id);
  }

  // ── Public demo scrape: aggressive throttle, no persistence ─────
  @Post('demo/scrape')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async demoScrape(@Body() body: { url: string }) {
    if (!body?.url) throw new HttpException({ code: 'BRANDING_URL_REQUIRED', message: 'url is required' }, HttpStatus.BAD_REQUEST);
    try {
      // Use the special "demo" bucket in the rate limiter
      this.limiter.check('__demo__');
      const preview = await this.scraper.scrape(body.url);
      // Sanitize: strip the heavy rawSnapshot for public demo to reduce
      // scrape-abuse info leak and network cost. The UI doesn't need it.
      const { rawSnapshot, ...safe } = preview;
      return safe;
    } catch (e: any) {
      return this.handleScrapeError(e);
    }
  }

  // ── Adopt: persists a BrandingPreview (possibly tweaked by the user) ──
  @Post('adopt')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async adopt(@Request() req: any, @Body() body: AdoptBody) {
    const tenantId = req.user.tenantId;
    if (!body) throw new HttpException({ code: 'BRANDING_BODY_REQUIRED', message: 'body required' }, HttpStatus.BAD_REQUEST);

    // Re-host the logo + favicon to Supabase so we never hotlink.
    let logoUrl: string | null = null;
    let logoSvgInline: string | null = null;
    let faviconUrl: string | null = null;
    let ogImageUrl: string | null = null;
    /** Operator-facing reason the logo is not what they picked. Null = it is. */
    let logoWarning: string | null = null;

    // ── THE APPLIED-vs-SELECTED FIX (2026-08-25) ───────────────────
    //
    // Operator, with a screenshot: the wizard showed the real brand mark
    // (a lotus) CHECKED, while the sidebar avatar rendered Pinterest's
    // circular P. Root cause was RIGHT HERE, and it was two bugs:
    //
    //  (1) Field-wise `??` fall-through. The old code read
    //        url       = logoOverride?.url       ?? logos[0]?.url
    //        svgInline = logoOverride?.svgInline ?? logos[0]?.svgInline
    //      Those are INDEPENDENT fallbacks. Pin a RASTER candidate (which
    //      has no svgInline) and `chosenSvg` silently fell through to
    //      candidate #0's inline SVG — a different mark entirely. The SVG
    //      branch below runs FIRST and wins, so the pinned raster never
    //      got a chance. A pin must be treated as ONE candidate: both
    //      fields come from the same object, or neither does.
    //
    //  (2) See `hasPinnedLogo` below — the cross-candidate vector scan
    //      used to run before the pinned raster and took ANY .svg in the
    //      list, pin or no pin.
    const pinnedLogo = body.logoOverride ?? body.logos?.[0] ?? null;
    const hasPinnedLogo = !!body.logoOverride;
    const chosenLogo = pinnedLogo?.url ?? null;
    let chosenSvg = pinnedLogo?.svgInline ?? null;

    // Diagnostic — so we can see exactly what the client is sending.
    // Enough signal to tell apart "body corrupted in transit" from
    // "client is sanitizing before POST" from "scraper returned junk".
    this.logger.log(
      `[adopt] tenant=${tenantId} ` +
      `overrideUrl=${body.logoOverride?.url?.slice(0,60) || '(none)'} ` +
      `overrideSvgLen=${(body.logoOverride?.svgInline || '').length} ` +
      `logos[0].svgLen=${(body.logos?.[0]?.svgInline || '').length} ` +
      `logos.count=${body.logos?.length ?? 0} ` +
      `chosenSvgLen=${(chosenSvg || '').length} ` +
      `chosenSvgStart=${(chosenSvg || '').slice(0, 80).replace(/\n/g, ' ')}`,
    );

    // Validate the SVG has real content BEFORE storing. Chardon's
    // scrape kept landing a ~224-byte file that was just whitespace +
    // the alt text 'Chardon Footer Logo@100' — cheerio picked up a
    // sibling <svg> that was a decorative text-only element, not the
    // real wordmark. A valid logo must contain at least one shape
    // primitive (path, circle, rect, polygon, image, use). If it
    // doesn't, fall through to the rasterized <img> candidate below.
    let chosenSvgValid = isRealSvg(chosenSvg);
    if (chosenSvg && !chosenSvgValid) {
      this.logger.warn(
        `Branding SVG rejected for tenant ${tenantId} — invalid markup (len=${chosenSvg.length}). Attempting re-scrape recovery.`,
      );
      // 2026-06-01 — the wizard sometimes ships a CORRUPTED svgInline: on
      // dominos.com it sent a 1-char "®" instead of the <svg> markup (a
      // frontend state/cache mangle between scrape → adopt; verified in the
      // [adopt] log: chosenSvgLen=1). The scraper's server-side $.html(el)
      // always yields the FULL markup, so when the chosen SVG is invalid but
      // we know the source URL, re-scrape and recover the real logo. Gated to
      // the failure case — a normal adopt with a valid SVG never re-scrapes.
      if (body.sourceUrl && /^https?:\/\//i.test(body.sourceUrl)) {
        try {
          const fresh = await this.scraper.scrape(body.sourceUrl);
          const recovered = (fresh.logos || []).find(
            (l: any) => l?.kind === 'svg-inline' && isRealSvg(l.svgInline),
          );
          if (recovered?.svgInline) {
            chosenSvg = recovered.svgInline;
            chosenSvgValid = true;
            this.logger.log(
              `[adopt] recovered a valid inline SVG via re-scrape of ${body.sourceUrl} for tenant ${tenantId} (len=${chosenSvg.length})`,
            );
          } else {
            this.logger.warn(`[adopt] re-scrape of ${body.sourceUrl} produced no valid SVG candidate — falling back to logoUrl.`);
          }
        } catch (e: any) {
          this.logger.warn(`[adopt] SVG-recovery re-scrape failed for tenant ${tenantId}: ${e?.message}`);
        }
      }
    }

    // (0) Operator-uploaded logo (data URL) wins over any scraped candidate —
    // the explicit choice + the escape hatch for sites that block our scraper
    // (Cloudflare-protected dominos.com returns "Not Found" for its own logo).
    if (body.logoDataUrl) {
      try {
        logoUrl = await this.uploadLogoDataUrl(tenantId, body.logoDataUrl);
        // SVG uploads also kept inline for crisp sidebar render.
        if (/^data:image\/svg\+xml/i.test(body.logoDataUrl)) {
          try {
            const svg = Buffer.from(body.logoDataUrl.split(',')[1] || '', 'base64').toString('utf8');
            if (svg.includes('<svg')) logoSvgInline = sanitizeLogoSvg(svg);
          } catch { /* best-effort inline */ }
        }
      } catch (e: any) {
        this.logger.warn(`[adopt] uploaded logo failed for tenant ${tenantId}: ${e?.message}`);
      }
    }

    if (!logoUrl && chosenSvg && chosenSvgValid) {
      // Two storage paths with different trust models:
      //
      // 1) logoSvgInline — rendered by admins via dangerouslySetInnerHTML
      //    in the same origin, so DOMPurify has to strip scripts + event
      //    handlers + foreignObject. Aggressive sanitization is correct.
      //
      // 2) logoUrl — served as a separate asset via <img src>. The browser
      //    sandboxes img sources: no script execution, no DOM access to
      //    the parent page. So the file stored on Supabase can be the
      //    RAW scraped SVG, preserving every <image>, <use xlink:href>,
      //    CSS filter, and embedded bitmap the real logo relies on.
      //
      // Before this fix we ran DOMPurify BEFORE the rehost. On SVGs with
      // lots of <image> + xlink:href (Chardon's 12.8KB tree+text
      // wordmark is 95% external references), sanitization shrank the
      // file to a ~224-byte empty wrapper and the sidebar <img>
      // rendered a blank/broken glyph even though the Supabase upload
      // technically succeeded.
      const cleaned = sanitizeLogoSvg(chosenSvg);
      if (cleaned !== chosenSvg) {
        this.logger.warn(
          `Branding SVG sanitized for tenant ${tenantId} — unsafe markup stripped (user ${req.user.id})`,
        );
      }
      logoSvgInline = cleaned;
      try {
        // Upload the RAW SVG (untrusted content served in a sandboxed
        // <img>; XSS threat model is contained by the browser).
        logoUrl = await this.rehost(chosenSvg, `branding/${tenantId}/logo.svg`, 'image/svg+xml');
      } catch (e: any) {
        this.logger.warn(`Inline SVG logo upload failed, falling back to inline: ${e?.message}`);
      }
    }
    // VECTOR-PRESERVATION (task #223, the Domino's bug). Before we fall
    // back to a raster, scan EVERY scraped candidate for a vector logo
    // (inline SVG or a `.svg` URL) and keep it as a vector. The chosen
    // candidate's inline SVG can be rejected (corrupt-in-transit or a
    // text-only wordmark) OR the operator may have pinned a raster while a
    // crisp SVG sits further down the list — both used to rasterize the
    // logo and ship a pixelated wordmark to a 4K wall. Only runs when the
    // primary SVG branch above didn't already produce a logo.
    //
    // BUG (2) — the vector scan below scans EVERY candidate for an inline
    // SVG or a `.svg` URL and takes the first one, in score order. That is
    // the right default (it upgrades a rasterized wordmark to a crisp
    // vector — the Domino's fix, task #223), but it MUST NOT out-vote an
    // explicit operator pin: with a Pinterest `.svg` anywhere in the list,
    // pinning the real lotus PNG still stored Pinterest.
    //
    // So when the operator pinned a candidate, rehost THAT first and only
    // fall through to the cross-candidate vector scan if the pin produced
    // nothing usable. With no pin (the template-adopt path, or a straight
    // "adopt what you found"), the original vector-first order is kept.
    if (!logoUrl && hasPinnedLogo && chosenLogo) {
      try {
        // rehostUrl preserves image/svg+xml, so a pinned .svg stays vector.
        logoUrl = await this.rehostUrl(chosenLogo, `branding/${tenantId}/logo`);
        this.logger.log(`[adopt] honored the operator's pinned logo for tenant ${tenantId}`);
      } catch (e: any) {
        this.logger.warn(`[adopt] pinned logo rehost failed for tenant ${tenantId}: ${e?.message}`);
      }
    }

    if (!logoUrl) {
      const vector = await this.pickVectorLogoCandidate(
        body.logos,
        `branding/${tenantId}`,
        isRealSvg,
        tenantId,
      );
      if (vector) {
        logoUrl = vector.logoUrl;
        if (!logoSvgInline && vector.logoSvgInline) logoSvgInline = vector.logoSvgInline;
      }
    }

    // Also try the raster logoUrl as a fallback OR primary (when no vector
    // candidate existed). If logoUrl is already set from the SVG/vector
    // branch, skip — the vector wins.
    if (!logoUrl && chosenLogo) {
      try {
        logoUrl = await this.rehostUrl(chosenLogo, `branding/${tenantId}/logo`);
      } catch (e: any) {
        // Do NOT fall back to storing the raw source URL: if we couldn't
        // fetch it as an image server-side (404 / bot-block / non-image),
        // it won't render in the browser either — storing it just recreates
        // the broken-logo bug. Leave logoUrl unset; the candidate loop below
        // (or manual upload) takes over.
        this.logger.warn(`Primary logo rehost failed for tenant ${tenantId}: ${e?.message}`);
      }
    }

    // If NO new logo was produced, preserve whatever the tenant already
    // has stored. Matters when the user opens /settings/branding (which
    // pre-fills the wizard with their existing logoUrl) and clicks
    // Adopt to tweak ONLY colors or displayName — we shouldn't wipe
    // their logo just because the wizard didn't re-scrape.
    if (!logoUrl) {
      try {
        const existing = await this.prisma.client.tenantBranding.findUnique({
          where: { tenantId },
          select: { logoUrl: true, logoSvgInline: true },
        });
        if (existing?.logoUrl) {
          logoUrl = existing.logoUrl;
          if (!logoSvgInline && existing.logoSvgInline) logoSvgInline = existing.logoSvgInline;
          this.logger.log(`[adopt] preserving existing logoUrl for tenant ${tenantId}`);
          // Greg, 2026-09-16: "still wont replace the fucking logo". He picked
          // the Kings mark, the wizard sent it, cdn.nba.com timed out inside
          // safeFetch, we silently kept the OLD file and answered SUCCESS.
          // The server knew; the operator could not. Say it.
          logoWarning =
            'We could not fetch that logo from the site, so your previous logo is still in place. Upload the image file instead.';
        }
      } catch { /* best-effort */ }
    }

    // If the SVG was rejected AND we had other logo candidates, try
    // them in score order. The client's logoOverride may have pinned
    // the bad one — fall back to the next best candidate on the server
    // so branding still succeeds without a re-scrape.
    if (!logoUrl && Array.isArray(body.logos)) {
      // Skip whatever we already tried (the pin, or candidate #0) rather
      // than blindly slicing off index 0 — with a pin, index 0 is a
      // candidate we have NOT tried yet and deserves a turn.
      const alreadyTried = new Set<string>([chosenLogo || '']);
      for (const cand of body.logos) {
        if (!cand?.url || alreadyTried.has(cand.url)) continue;
        // Skip favicons (.ico) — these are 16-32px icons designed for
        // browser tabs, not logos. Rendering one inside a 44px sidebar
        // tile looks like a blurry broken thumbnail. Chardon's scrape
        // returned an .ico in position #2 and my earlier fallback
        // loop happily stored it as the logo — that was the bug that
        // made the sidebar look empty.
        if (/\.(ico|icns)(\?|#|$)/i.test(cand.url)) {
          this.logger.log(`Logo fallback: skipping favicon candidate ${cand.url}`);
          continue;
        }
        try {
          logoUrl = await this.rehostUrl(cand.url, `branding/${tenantId}/logo-fb`);
          this.logger.log(`Logo fallback: used candidate #${body.logos.indexOf(cand)} (${cand.kind || '?'})`);
          break;
        } catch { /* try next */ }
      }
    }

    if (body.favicon) {
      try {
        faviconUrl = await this.rehostUrl(body.favicon, `branding/${tenantId}/favicon`);
      } catch {
        faviconUrl = body.favicon;
      }
    }

    if (body.ogImage) {
      try {
        ogImageUrl = await this.rehostUrl(body.ogImage, `branding/${tenantId}/og-image`);
      } catch {
        ogImageUrl = body.ogImage;
      }
    }

    // Derive the final palette from whatever primary the user settled on,
    // in case they tweaked it after the scrape. The WCAG nudge in
    // `derivePalette` runs first, then `body.palette` overrides — and
    // we re-enforce contrast AFTER the spread so a client-side spread
    // can't ship "yellow on white" to the DB. P0-6 (2026-05-27).
    const finalPrimary = body.palette?.primary ?? '#4f46e5';
    const finalAccent = body.palette?.accent;
    const palette = enforcePaletteContrast({ ...derivePalette(finalPrimary, finalAccent), ...(body.palette || {}) });

    // ── Logo backdrop (the wizard's 3rd picker, 2026-08-25) ────────
    // Rides inside the existing `palette` Json column — a new KEY, not a
    // new column, so there is NO schema migration. The value is a client
    // round-trip, so validate it against the enum and drop anything else
    // (paletteToCssVars only emits hex-shaped keys, so a junk value could
    // never reach CSS — but it must not reach the DB either).
    const requestedLogoBg = (body.palette as any)?.logoBackground ?? (body as any)?.logoBackground;
    // When no valid choice came from the client, MEASURE the mark we are about
    // to store rather than falling to the "unknown ink" default of 'primary'.
    // Greg, 2026-09-16: "it doesnt bring the logo either" — a near-black mark
    // was being chipped onto a near-black primary, so it was invisible.
    const resolvedLogoBg = resolveStoredLogoBackground({
      requested: requestedLogoBg,
      svgInline: logoSvgInline,
      primaryHex: (palette as any)?.primary ?? null,
    });
    if (resolvedLogoBg) {
      (palette as any).logoBackground = resolvedLogoBg;
    } else {
      delete (palette as any).logoBackground;
    }

    // VisionCore hardening (2026-07-21): a mangled family name (")",
    // "var(--hover-font") must never be persisted. The adopt body is a
    // client round-trip of the preview, so re-sanitize at the persist
    // boundary — not only at scrape time.
    const fontHeading = sanitizeFontFamilyName(body.fonts?.heading?.googleFont ?? body.fonts?.heading?.family ?? null);
    const fontBody = sanitizeFontFamilyName(body.fonts?.body?.googleFont ?? body.fonts?.body?.family ?? null);

    const record = await this.prisma.client.tenantBranding.upsert({
      where: { tenantId },
      create: {
        tenantId,
        displayName: body.displayName ?? null,
        tagline: body.tagline ?? null,
        logoUrl,
        logoSvgInline,
        faviconUrl,
        ogImageUrl,
        palette: palette as any,
        fontHeading,
        fontBody,
        fontHeadingUrl: body.fontsCssUrl ?? null,
        fontBodyUrl: body.fontsCssUrl ?? null,
        heroImages: (body.heroImages ?? []) as any,
        sourceUrl: body.sourceUrl ?? null,
        scrapedAt: body.scrapedAt ? new Date(body.scrapedAt) : new Date(),
        confidenceScores: (body.confidence ?? undefined) as any,
        rawSnapshot: (body.rawSnapshot ?? undefined) as any,
      },
      update: {
        displayName: body.displayName ?? null,
        tagline: body.tagline ?? null,
        logoUrl: logoUrl ?? undefined,
        logoSvgInline: logoSvgInline ?? undefined,
        faviconUrl: faviconUrl ?? undefined,
        ogImageUrl: ogImageUrl ?? undefined,
        palette: palette as any,
        fontHeading,
        fontBody,
        fontHeadingUrl: body.fontsCssUrl ?? null,
        fontBodyUrl: body.fontsCssUrl ?? null,
        heroImages: (body.heroImages ?? []) as any,
        sourceUrl: body.sourceUrl ?? undefined,
        scrapedAt: body.scrapedAt ? new Date(body.scrapedAt) : new Date(),
        confidenceScores: (body.confidence ?? undefined) as any,
        rawSnapshot: (body.rawSnapshot ?? undefined) as any,
      },
    });

    await this.prisma.client.auditLog.create({
      data: {
        action: 'ADOPT_BRANDING',
        targetType: 'tenant',
        targetId: tenantId,
        tenantId,
        userId: req.user.id,
        details: JSON.stringify({ sourceUrl: body.sourceUrl, confidence: body.confidence }),
      },
    });

    return { ok: true, branding: record, logoWarning };
  }

  /**
   * Per-template Brand Kit adopt — completely separate from the global
   * `/branding/adopt` endpoint. Writes ONLY to `Template.brandKit`
   * (a JSON column), never touches `TenantBranding`, never repaints
   * the dashboard chrome.
   *
   * Bug fix (2026-04-27): the template builder's "Detect brand"
   * button used to call /branding/adopt, which silently re-skinned
   * the entire CMS dashboard. Operator caught this immediately:
   * "you are suppose to bring in colors, logos, etc TO US ON THE
   * CUSTOM TEMPLATE MAKER but what you really do is update the
   * overall page brand from the template … those are two separate
   * things."
   *
   * Same body shape as /branding/adopt so the panel can pass the
   * scrape preview straight through. Same logo-rehost + SVG
   * sanitize logic via the shared `processBrandingAssets` helper.
   * Different storage path (`branding/templates/${id}/...`) so
   * per-template logos are isolated from the tenant's global logo.
   *
   * RBAC: any role allowed to edit templates (matches templates
   * controller's update path — CONTRIBUTOR can save drafts).
   */
  @Post('templates/:templateId/adopt')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  async adoptTemplateBranding(
    @Request() req: any,
    @Param('templateId') templateId: string,
    @Body() body: AdoptBody,
  ) {
    const tenantId = req.user.tenantId;
    if (!body) throw new HttpException({ code: 'BRANDING_BODY_REQUIRED', message: 'body required' }, HttpStatus.BAD_REQUEST);
    if (!templateId) throw new HttpException({ code: 'BRANDING_TEMPLATE_ID_REQUIRED', message: 'templateId required' }, HttpStatus.BAD_REQUEST);

    // Confirm the template exists and is in the caller's tenant.
    // System presets are intentionally exempt — they're shared across
    // all tenants and shouldn't carry tenant-specific brand data.
    const tpl = await this.prisma.client.template.findFirst({
      where: { id: templateId, tenantId },
      select: { id: true, name: true, isSystem: true, brandKit: true },
    });
    if (!tpl) {
      throw new HttpException({ code: 'BRANDING_TEMPLATE_NOT_FOUND', message: 'Template not found' }, HttpStatus.NOT_FOUND);
    }
    if (tpl.isSystem) {
      throw new HttpException({ code: 'BRANDING_SYSTEM_TEMPLATE_NOT_ALLOWED', message: 'System preset templates can\'t carry a per-template brand kit. Duplicate the preset first, then customize the copy.' }, HttpStatus.BAD_REQUEST);
    }

    // Process logo + favicon + palette through the shared helper.
    // Same SVG sanitization, same SSRF-safe rehost, scoped to a
    // template-specific Supabase prefix so a template's logo doesn't
    // collide with the tenant-global logo.
    const assets = await this.processBrandingAssets(
      body,
      `branding/templates/${templateId}`,
      tpl.brandKit as any,
    );

    const brandKit = {
      palette: assets.palette,
      logoUrl: assets.logoUrl,
      logoSvgInline: assets.logoSvgInline,
      faviconUrl: assets.faviconUrl,
      // VisionCore hardening: never persist a mangled family name (")",
      // "var(--hover-font") — the body is a client round-trip.
      fontHeading: sanitizeFontFamilyName(body.fonts?.heading?.googleFont ?? body.fonts?.heading?.family ?? null),
      fontBody: sanitizeFontFamilyName(body.fonts?.body?.googleFont ?? body.fonts?.body?.family ?? null),
      fontHeadingUrl: body.fontsCssUrl ?? null,
      fontBodyUrl: body.fontsCssUrl ?? null,
      displayName: body.displayName ?? null,
      sourceUrl: body.sourceUrl ?? null,
      scrapedAt: body.scrapedAt ? new Date(body.scrapedAt).toISOString() : new Date().toISOString(),
    };

    // Codex T05 (2026-09-13): the audit row used to be `.catch(() => {})` — a
    // privileged change that reported success with no record when the log
    // failed (§16). Mutation + audit are one transaction now: no record, no change.
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.template.update({
        where: { id: templateId, tenantId },
        data: { brandKit: brandKit as any },
        select: { id: true, name: true, brandKit: true, updatedAt: true },
      });
      await tx.auditLog.create({
        data: {
          action: 'ADOPT_TEMPLATE_BRAND_KIT',
          targetType: 'template',
          targetId: templateId,
          tenantId,
          userId: req.user.id,
          details: JSON.stringify({
            templateName: tpl.name,
            sourceUrl: body.sourceUrl,
            confidence: body.confidence,
          }),
        },
      });
      return row;
    });

    return { ok: true, brandKit: updated.brandKit, template: { id: updated.id, name: updated.name } };
  }

  /**
   * Clear a template's brand kit. Doesn't touch the global tenant
   * branding. Allowed for the same roles that can adopt.
   */
  @Delete('templates/:templateId/brand-kit')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  async clearTemplateBranding(
    @Request() req: any,
    @Param('templateId') templateId: string,
  ) {
    const tenantId = req.user.tenantId;
    const tpl = await this.prisma.client.template.findFirst({
      where: { id: templateId, tenantId },
      select: { id: true, name: true, isSystem: true },
    });
    if (!tpl) throw new HttpException({ code: 'BRANDING_TEMPLATE_NOT_FOUND', message: 'Template not found' }, HttpStatus.NOT_FOUND);

    // Prisma JSON columns require an explicit `Prisma.JsonNull`
    // sentinel to clear a value — the type rejects bare `null`.
    // Imported from @cms/database which re-exports the prisma
    // namespace.
    // Codex T05: mutation + audit in one transaction (see adoptTemplateBranding).
    await this.prisma.client.$transaction(async (tx) => {
      await tx.template.update({
        where: { id: templateId, tenantId },
        data: { brandKit: Prisma.JsonNull },
      });
      await tx.auditLog.create({
        data: {
          action: 'CLEAR_TEMPLATE_BRAND_KIT',
          targetType: 'template',
          targetId: templateId,
          tenantId,
          userId: req.user.id,
          details: JSON.stringify({ templateName: tpl.name }),
        },
      });
    });

    return { ok: true };
  }

  // ── Get current tenant branding (for SSR + settings page) ───────
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMine(@Request() req: any) {
    const tenantId = req.user.tenantId;
    const b = await this.prisma.client.tenantBranding.findUnique({ where: { tenantId } });
    return b ?? null;
  }

  // ── Revert to defaults ──────────────────────────────────────────
  // ── Manual branding override — escape hatch when the scraper can't
  // produce a usable logo (common: SVG uses external <image> refs the
  // sanitizer strips, or the site serves only a favicon). Admin pastes
  // a displayName + primary color + uploads a logo file or pastes a
  // URL, and we upsert tenant_branding directly. No scraping, no
  // guessing, no cross-tenant bleed — the tenantId comes from the
  // caller's JWT, not from the body.
  @Post('me/manual')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async manualAdopt(
    @Request() req: any,
    @Body() body: {
      displayName?: string;
      tagline?: string;
      primaryHex?: string;
      accentHex?: string;
      logoDataUrl?: string;   // data:image/png;base64,...  (uploaded file)
      logoUrl?: string;       // https://.../logo.png      (pasted URL)
      // Settings Command Center (2026-09-01) — 'branded' | 'neutral'.
      // Omitted = leave whatever is stored alone (this endpoint is also the
      // wizard's manual-adopt path, which knows nothing about appearance).
      appearanceMode?: string;
    },
  ) {
    const tenantId = req.user.tenantId;
    if (!tenantId) throw new HttpException({ code: 'BRANDING_NO_TENANT_SCOPE', message: 'No tenant scope on session' }, HttpStatus.FORBIDDEN);

    // Application appearance — validated against the closed set, never
    // free-text. `undefined` means "not part of this request".
    let appearanceMode: string | undefined;
    if (body?.appearanceMode !== undefined) {
      if (!isAppearanceMode(body.appearanceMode)) {
        throw new HttpException(
          { code: 'BRANDING_INVALID_APPEARANCE_MODE', message: "appearanceMode must be 'branded' or 'neutral'" },
          HttpStatus.BAD_REQUEST,
        );
      }
      appearanceMode = body.appearanceMode;
    }

    // Palette — derive from primary (+ optional accent) the same way
    // the scraper-adopt path does, so themes look consistent.
    const primary = parseColor(body?.primaryHex || '#4f46e5')?.hex || '#4f46e5';
    const accent = body?.accentHex ? (parseColor(body.accentHex)?.hex || null) : null;
    const palette: any = derivePalette(primary, accent || undefined);
    // 2026-08-25 — this path rebuilds the palette from scratch, which would
    // silently DROP the operator's logo-background choice (it lives as a key
    // inside the same Json column). Carry the stored value forward unless
    // this request explicitly sets a new one.
    const requestedLogoBg = (body as any)?.logoBackground;
    if (isLogoBackground(requestedLogoBg)) {
      palette.logoBackground = requestedLogoBg;
    } else {
      try {
        const prior = await this.prisma.client.tenantBranding.findUnique({
          where: { tenantId },
          select: { palette: true, logoSvgInline: true },
        });
        // MEASURE the mark before falling back to the stored guess. This path
        // only ever carried the prior value forward, so a backdrop chosen when
        // the mark was unmeasurable ('primary' — the "unknown ink" default)
        // survived every later edit, even once the markup was in hand. That is
        // how a near-black mark stayed chipped onto a dark primary through
        // four adopts. `adopt` got this on 2026-09-16; this path was missed.
        const measured = resolveStoredLogoBackground({
          svgInline: prior?.logoSvgInline ?? null,
          primaryHex: (palette as any)?.primary ?? null,
        });
        const priorBg = (prior?.palette as any)?.logoBackground;
        if (measured) palette.logoBackground = measured;
        else if (isLogoBackground(priorBg)) palette.logoBackground = priorBg;
      } catch { /* best-effort — a missing row just means no prior choice */ }
    }

    // Prior appearance mode, read only so the audit row can state what
    // actually CHANGED (§19.6). NULL is a real stored value meaning 'branded'.
    let priorAppearance: string = 'branded';
    if (appearanceMode !== undefined) {
      try {
        const prior = await this.prisma.client.tenantBranding.findUnique({
          where: { tenantId },
          select: { appearanceMode: true },
        });
        priorAppearance = prior?.appearanceMode || 'branded';
      } catch { /* best-effort — treated as the default */ }
    }

    let logoUrl: string | null = null;

    // (1) Uploaded file — data URL. Decode, rehost to Supabase.
    if (body.logoDataUrl && /^data:image\/[a-z+.-]+;base64,/.test(body.logoDataUrl)) {
      try {
        const match = body.logoDataUrl.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/)!;
        const mimeType = match[1];
        const b64 = match[2];
        const buf = Buffer.from(b64, 'base64');
        if (buf.byteLength > 2 * 1024 * 1024) {
          throw new HttpException({ code: 'BRANDING_LOGO_TOO_LARGE', message: 'Logo too large (max 2MB)' }, HttpStatus.BAD_REQUEST);
        }
        const ext = mimeType.split('/')[1].split('+')[0].replace(/[^a-z0-9]/gi, '') || 'png';
        const hash = createHash('sha256').update(buf).digest('hex').slice(0, 12);
        const path = `branding/${tenantId}/manual-${hash}.${ext}`;
        // uploadLogo (not upload) — task #223. The general `assets` bucket
        // doesn't allow image/svg+xml; this error message explicitly offers
        // SVG below, so it must land in the branding-logos bucket.
        logoUrl = await this.storage.uploadLogo(path, buf, mimeType);
      } catch (e: any) {
        this.logger.warn(`Manual logo upload failed for tenant ${tenantId}: ${e?.message}`);
        throw new HttpException({ code: 'BRANDING_LOGO_UPLOAD_FAILED', message: `Logo upload failed: ${e?.message}` }, HttpStatus.BAD_REQUEST);
      }
    } else if (body.logoUrl) {
      // (2) Pasted URL — rehost so we don't hotlink.
      try {
        const r = await safeFetch(body.logoUrl, { maxBytes: 2 * 1024 * 1024, timeoutMs: 8000 });
        if (r.status < 200 || r.status >= 300) {
          throw new Error(`image URL returned HTTP ${r.status}`);
        }
        if (/\.(ico|icns)(\?|#|$)/i.test(body.logoUrl)) {
          throw new Error('favicon URLs are too small to use as logos — paste a full-size image URL');
        }
        if (!looksLikeImage(r.body, r.contentType)) {
          throw new Error('that URL did not return an image — paste a direct link to a PNG/JPG/SVG');
        }
        const ext = extFromContentType(r.contentType) || extFromUrl(body.logoUrl) || 'png';
        const hash = createHash('sha256').update(r.body).digest('hex').slice(0, 12);
        const path = `branding/${tenantId}/manual-${hash}.${ext}`;
        // uploadLogo (not upload) — task #223, same reasoning as the data-URL
        // branch above: a pasted `.svg` URL must land in the branding-logos
        // bucket, which allows image/svg+xml.
        logoUrl = await this.storage.uploadLogo(path, r.body, r.contentType || 'application/octet-stream');
      } catch (e: any) {
        this.logger.warn(`Manual logo URL rehost failed for tenant ${tenantId}: ${e?.message}`);
        throw new HttpException({ code: 'BRANDING_LOGO_URL_FETCH_FAILED', message: `Logo URL fetch failed: ${e?.message}` }, HttpStatus.BAD_REQUEST);
      }
    }

    const record = await this.prisma.client.tenantBranding.upsert({
      where: { tenantId },
      create: {
        tenantId,
        displayName: body.displayName || null,
        tagline: body.tagline || null,
        logoUrl,
        palette: palette as any,
        appearanceMode: appearanceMode ?? null,
        sourceUrl: 'manual://admin',
        scrapedAt: new Date(),
      },
      update: {
        displayName: body.displayName ?? undefined,
        tagline: body.tagline ?? undefined,
        ...(logoUrl ? { logoUrl } : {}),
        palette: palette as any,
        // `undefined` leaves the stored value untouched — the wizard's
        // manual-adopt path never sends this field.
        appearanceMode,
        sourceUrl: 'manual://admin',
        scrapedAt: new Date(),
      },
    });

    await this.prisma.client.auditLog.create({
      data: {
        action: 'ADOPT_BRANDING_MANUAL',
        targetType: 'tenant',
        targetId: tenantId,
        tenantId,
        userId: req.user.id,
        details: JSON.stringify({ displayName: body.displayName, hasLogo: !!logoUrl, primary, appearanceMode }),
      },
    });

    // A separate, greppable row when the appearance policy actually flipped —
    // "changed" is the auditable event, not "was included in a save" (§19.6).
    if (appearanceMode !== undefined && appearanceMode !== priorAppearance) {
      await this.prisma.client.auditLog.create({
        data: {
          action: 'BRANDING_APPEARANCE_MODE_CHANGED',
          targetType: 'tenant',
          targetId: tenantId,
          tenantId,
          userId: req.user.id,
          details: JSON.stringify({ from: priorAppearance, to: appearanceMode }),
        },
      }).catch(() => { /* audit best-effort; the save already succeeded */ });
    }

    return { ok: true, branding: record };
  }

  @Delete('me')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async deleteMine(@Request() req: any) {
    const tenantId = req.user.tenantId;
    await this.prisma.client.tenantBranding.deleteMany({ where: { tenantId } });
    await this.prisma.client.auditLog.create({
      data: {
        action: 'REVERT_BRANDING',
        targetType: 'tenant',
        targetId: tenantId,
        tenantId,
        userId: req.user.id,
        details: '{}',
      },
    });
    return { ok: true };
  }

  // ── AI brand voice (Slice 1b, 2026-06-16) ──────────────────────
  // Narrow update of just TenantBranding.brandVoice — the per-tenant tone
  // every AI copy surface honors. Doesn't touch palette/logo (unlike the
  // heavy /me/manual adopt). Empty string clears it back to null.
  @Post('me/voice')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async setBrandVoice(@Request() req: any, @Body() body: { brandVoice?: string }) {
    const tenantId = req.user.tenantId;
    if (!tenantId) throw new HttpException({ code: 'BRANDING_NO_TENANT_SCOPE', message: 'No tenant scope on session' }, HttpStatus.FORBIDDEN);
    const voice = typeof body?.brandVoice === 'string' ? body.brandVoice.trim().slice(0, 600) : '';
    await this.prisma.client.tenantBranding.upsert({
      where: { tenantId },
      update: { brandVoice: voice || null } as any,
      create: { tenantId, brandVoice: voice || null } as any,
    });
    await this.prisma.client.auditLog.create({
      data: {
        action: 'BRANDING_VOICE_UPDATED',
        targetType: 'tenant',
        targetId: tenantId,
        tenantId,
        userId: req.user.id,
        details: JSON.stringify({ set: !!voice, length: voice.length }),
      },
    }).catch(() => { /* audit best-effort */ });
    return { ok: true, brandVoice: voice || null };
  }

  // ── Application appearance (Settings Command Center, 2026-09-02) ──
  // A NARROW write of just TenantBranding.appearanceMode. Deliberately not
  // routed through /me/manual: that path rebuilds the whole palette from
  // `primaryHex`, so an appearance-only save there would silently re-derive
  // (and could drift) a brand the operator never touched.
  //
  // 'branded' with no stored row is the default state, so it creates nothing.
  @Post('me/appearance')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async setAppearanceMode(@Request() req: any, @Body() body: { appearanceMode?: string }) {
    const tenantId = req.user.tenantId;
    if (!tenantId) throw new HttpException({ code: 'BRANDING_NO_TENANT_SCOPE', message: 'No tenant scope on session' }, HttpStatus.FORBIDDEN);
    if (!isAppearanceMode(body?.appearanceMode)) {
      throw new HttpException(
        { code: 'BRANDING_INVALID_APPEARANCE_MODE', message: "appearanceMode must be 'branded' or 'neutral'" },
        HttpStatus.BAD_REQUEST,
      );
    }
    const next = body.appearanceMode;

    const prior = await this.prisma.client.tenantBranding.findUnique({
      where: { tenantId },
      select: { id: true, appearanceMode: true },
    });
    // NULL is a real stored value meaning 'branded' (see the migration).
    const priorMode = prior?.appearanceMode || 'branded';

    if (!prior && next === 'branded') {
      // Nothing stored and nothing to store — do NOT create a bare branding
      // row just to record the default.
      return { ok: true, appearanceMode: 'branded', changed: false };
    }

    if (prior) {
      await this.prisma.client.tenantBranding.update({
        where: { tenantId },
        data: { appearanceMode: next } as any,
      });
    } else {
      await this.prisma.client.tenantBranding.create({
        data: { tenantId, appearanceMode: next } as any,
      });
    }

    if (priorMode !== next) {
      await this.prisma.client.auditLog.create({
        data: {
          action: 'BRANDING_APPEARANCE_MODE_CHANGED',
          targetType: 'tenant',
          targetId: tenantId,
          tenantId,
          userId: req.user.id,
          details: JSON.stringify({ from: priorMode, to: next }),
        },
      }).catch(() => { /* audit best-effort; the save already succeeded */ });
    }

    return { ok: true, appearanceMode: next, changed: priorMode !== next };
  }

  // ── Palette math only (used by manual tweaker) ──────────────────
  @Post('derive-palette')
  @UseGuards(JwtAuthGuard)
  derive(@Body() body: { primaryHex: string; accentHex?: string }) {
    const p = parseColor(body?.primaryHex || '');
    if (!p) throw new HttpException({ code: 'BRANDING_INVALID_PRIMARY_HEX', message: 'Invalid primaryHex' }, HttpStatus.BAD_REQUEST);
    const a = body.accentHex ? parseColor(body.accentHex) : null;
    return derivePalette(p.hex, a?.hex);
  }

  /**
   * One-click "apply our brand to every template I own."
   *
   * The Canva differentiator. Their Brand Kit only applies per-design
   * — operators have to open every design and re-apply. We re-skin
   * every template in the tenant in one transaction:
   *   - Background: bgColor ← palette.surface (or surfaceAlt) when
   *     unset OR when mode='override'.
   *   - Per-zone defaultConfig: ALL zones get cfg.color, fontFamily
   *     (heading), bold/italic/underline reset to defaults — these
   *     keys flow into the universal scoped <style> override on the
   *     player render so every text descendant inherits the brand.
   *
   * Two modes:
   *   - 'fill-blanks' (default, safe): only set keys that are unset.
   *   - 'override' (bold): force the brand on every zone, replacing
   *     existing colors/fonts. Demo-friendly.
   *
   * System presets are EXCLUDED — those are the gold-standard
   * canonical templates and shouldn't drift per-tenant. Only custom
   * (cloned) templates get re-skinned.
   *
   * Audit-logged with the count of templates touched.
   */
  @Post('apply-to-templates')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async applyBrandToTemplates(
    @Request() req: any,
    @Body() body: { mode?: 'fill-blanks' | 'override' },
  ) {
    const tenantId = req.user.tenantId;
    const userId = req.user.id;
    const mode = body?.mode === 'override' ? 'override' : 'fill-blanks';

    const branding = await this.prisma.client.tenantBranding.findUnique({
      where: { tenantId },
    });
    if (!branding) {
      throw new HttpException({ code: 'BRANDING_NOT_CONFIGURED', message: 'No brand kit configured for this tenant. Paste your school URL on the Brand Kit panel first.' }, HttpStatus.BAD_REQUEST);
    }
    const palette = (branding.palette as any) || {};
    const fontHeading = branding.fontHeading || null;
    const fontBody = branding.fontBody || null;
    const ink = palette.ink || '#0f172a';
    const surface = palette.surface || palette.surfaceAlt || palette.primary || '#ffffff';

    const templates = await this.prisma.client.template.findMany({
      where: { tenantId, isSystem: false },
      include: { zones: true },
    });

    if (templates.length === 0) {
      return { count: 0, mode, message: 'No custom templates to re-skin. System presets are intentionally left alone.' };
    }

    let zonesPatched = 0;

    await this.prisma.client.$transaction(async (tx) => {
      for (const tpl of templates) {
        // Background fill. When the palette has BOTH primary AND
        // accent, paint a primary→accent gradient instead of the flat
        // surface — superintendents who scrape with two strong school
        // colors get the boldest possible "this is us" backdrop.
        // Fallback to flat surface for monochrome palettes.
        // (2026-05-26 audit fix.)
        const bgPatch: any = {};
        if (mode === 'override' || (!tpl.bgColor && !tpl.bgGradient && !tpl.bgImage)) {
          if (palette.primary && palette.accent && palette.primary !== palette.accent) {
            bgPatch.bgGradient = `linear-gradient(135deg, ${palette.primary} 0%, ${palette.accent} 100%)`;
            bgPatch.bgColor = palette.primary; // fallback for clients that ignore bgGradient
          } else {
            bgPatch.bgColor = surface;
            bgPatch.bgGradient = null;
          }
        }
        if (Object.keys(bgPatch).length > 0) {
          await tx.template.update({ where: { id: tpl.id, tenantId }, data: bgPatch });
        }

        // Zone-level brand override — universal text-style keys read
        // by the BuilderZone scoped <style> override, plus accentColor
        // which 60+ widgets across restaurant / retail / sports /
        // fitness packs consume directly. Strict fill-blanks unless
        // operator picked override mode.
        const accent = palette.accent || palette.primary || null;
        for (const z of tpl.zones) {
          const cfg = (() => {
            try { return z.defaultConfig ? JSON.parse(z.defaultConfig as any) : {}; } catch { return {}; }
          })();
          const patch: Record<string, any> = {};
          if (mode === 'override' || cfg.color === undefined) patch.color = ink;
          if ((mode === 'override' || cfg.fontFamily === undefined) && fontHeading) patch.fontFamily = fontHeading;
          // 2026-05-26 audit fix — extend the brand paint to cover
          // accentColor (the most-consumed brand-tint key across the
          // widget library). Without this, "Apply Brand" left every
          // restaurant / retail / sports / fitness widget on its
          // designed accent forever; the operator had to recolor
          // each one manually.
          if (accent && (mode === 'override' || cfg.accentColor === undefined)) {
            patch.accentColor = accent;
          }
          // 2026-06-08 — THE "branding doesn't work" fix. EXTERNAL_HTML signage
          // boards (the entire school / HS / signage gallery) ignore
          // color/fontFamily/accentColor — they render a self-contained iframe
          // that re-skins from `cfg.brand`, which ExternalHtmlWidget forwards as
          // `?brand=` and the baked shim's applyBrand() maps onto its --brand-*
          // CSS vars (BRAND_MAP keys: primary/accent/text/surface/background/
          // muted/fontDisplay/fontBody). Until now Apply-Brand set keys these
          // boards never read, so it did NOTHING visible on any board template.
          // Build the token map from the tenant palette + fonts and stamp it.
          if (z.widgetType === 'EXTERNAL_HTML' && (mode === 'override' || cfg.brand === undefined)) {
            const brandTokens: Record<string, string> = {};
            if (palette.primary) brandTokens.primary = palette.primary;
            if (accent) brandTokens.accent = accent;
            if (ink) brandTokens.text = ink;
            if (surface) brandTokens.surface = surface;
            if (palette.primary || surface) brandTokens.background = palette.primary || surface;
            const mutedVal = palette.muted || palette.ink2 || palette.ink3;
            if (mutedVal) brandTokens.muted = mutedVal;
            if (fontHeading) brandTokens.fontDisplay = fontHeading;
            if (fontBody) brandTokens.fontBody = fontBody;
            if (Object.keys(brandTokens).length > 0) patch.brand = brandTokens;
          }
          // fontBody not currently consumed but kept on the zone so a
          // future "apply body font separately" toggle can pick it up.
          if (Object.keys(patch).length === 0) continue;
          const merged = { ...cfg, ...patch };
          await tx.templateZone.update({ where: { id: z.id }, data: { defaultConfig: JSON.stringify(merged) } });
          zonesPatched += 1;
        }
      }
      // Codex T05: the audit row rides in the SAME transaction as the zone
      // patches — a bulk brand change with no record must not commit.
      await tx.auditLog.create({
        data: {
          action: 'BRANDING_APPLY_TO_TEMPLATES',
          targetType: 'tenant',
          targetId: tenantId,
          tenantId,
          userId,
          details: JSON.stringify({ mode, templateCount: templates.length, zonesPatched }),
        },
      });
    });

    // 2026-05-26 — operator: "it says it applied to 5 templates but i
    // have no idea what templates". Return the list of name+id pairs
    // so the wizard's success toast can show "Applied to: Welcome
    // Board, Cafeteria Menu, Hallway Schedule, ..." with deep-links
    // back to each template's editor.
    const templateList = templates.map((t) => ({
      id: t.id,
      name: t.name || 'Untitled',
    }));

    return {
      count: templates.length,
      zonesPatched,
      mode,
      templates: templateList,
      message: `Applied your brand to ${templates.length} template${templates.length === 1 ? '' : 's'} (${zonesPatched} zones updated).`,
    };
  }

  // ── Public unauthenticated "current branding by slug" for SSR of
  // the login page + public player chrome. We only expose safe fields
  // (no rawSnapshot, no confidenceScores). Useful when the Next.js
  // server needs to paint themed login pages before auth.
  @Get('public/by-slug/:slug')
  async publicBySlug(@Request() req: any) {
    const slug = (req.params?.slug || '').toLowerCase().trim();
    if (!slug || !/^[a-z0-9-]{1,64}$/.test(slug)) {
      throw new HttpException({ code: 'BRANDING_INVALID_SLUG', message: 'Invalid slug' }, HttpStatus.BAD_REQUEST);
    }
    const t = await this.prisma.client.tenant.findUnique({
      where: { slug },
      include: { branding: true },
    });
    if (!t?.branding) return null;
    const { rawSnapshot, confidenceScores, ...safe } = t.branding as any;
    return safe;
  }

  // ──────────────────────────────────────────────────────────────
  // INTERNAL HELPERS
  // ──────────────────────────────────────────────────────────────

  private async runScrape(url: string | undefined, tenantId: string, userId: string): Promise<BrandingPreview> {
    if (!url || typeof url !== 'string') {
      throw new HttpException({ code: 'BRANDING_URL_REQUIRED', message: 'url is required' }, HttpStatus.BAD_REQUEST);
    }
    this.limiter.check(tenantId);

    try {
      const preview = await this.scraper.scrape(url);
      await this.prisma.client.auditLog.create({
        data: {
          action: 'BRANDING_SCRAPE',
          targetType: 'tenant',
          targetId: tenantId,
          tenantId,
          userId,
          details: JSON.stringify({ url, outcome: 'success', confidence: preview.confidence, durationMs: preview.durationMs }),
        },
      }).catch(() => {});
      return preview;
    } catch (e: any) {
      await this.prisma.client.auditLog.create({
        data: {
          action: 'BRANDING_SCRAPE',
          targetType: 'tenant',
          targetId: tenantId,
          tenantId,
          userId,
          details: JSON.stringify({ url, outcome: 'failed', error: e?.name, message: e?.message?.slice(0, 500) }),
        },
      }).catch(() => {});
      this.handleScrapeError(e);
      throw e; // unreachable
    }
  }

  private handleScrapeError(e: any): never {
    if (e instanceof SsrfError) {
      // SDE-01 (2026-08-04) — return the uniform `publicMessage`, never
      // `message`, which names the resolved private IP. This path IS
      // authenticated (runScrape takes a tenantId + userId), so it is the
      // milder sibling of the unauthenticated /proxy leak — but a tenant admin
      // still has no business enumerating our internal network from a branding
      // scrape, and keeping both call sites identical means the next person
      // cannot "fix" one and miss the other.
      throw new HttpException({ message: e.publicMessage, code: 'BRANDING_SSRF' }, HttpStatus.BAD_REQUEST);
    }
    if (e?.name === 'FetchTooLargeError') {
      throw new HttpException({ message: 'Page too large to scrape', code: 'BRANDING_TOO_LARGE' }, HttpStatus.PAYLOAD_TOO_LARGE);
    }
    // 2026-05-25 — Cloudflare / WAF block, detected by the scraper
    // before cheerio sees the challenge HTML. Surface a friendly,
    // actionable error instead of a generic "Scrape failed" so the
    // operator knows their options (try a sub-page, or upload
    // manually). Reported on LAUSD homepage.
    if (e?.name === 'BotProtectionError') {
      throw new HttpException(
        { message: e.message, code: 'BRANDING_BLOCKED' },
        HttpStatus.BAD_GATEWAY,
      );
    }
    if (e instanceof HttpException) throw e;
    this.logger.error(`Unhandled scraper error: ${e?.stack || e?.message || e}`);
    throw new HttpException({ message: 'Scrape failed', code: 'BRANDING_SCRAPE_FAILED' }, HttpStatus.BAD_GATEWAY);
  }

  /**
   * Re-host a remote asset URL into the branding-logos Supabase bucket
   * (task #223 — NOT the general `assets` bucket, which does not allow
   * image/svg+xml; see the LOGO_BUCKET comment in supabase-storage.service.ts).
   * Returns the public Supabase URL. SSRF-protected via safeFetch.
   */
  private async rehostUrl(sourceUrl: string, keyPrefix: string): Promise<string> {
    const r = await safeFetch(sourceUrl, { maxBytes: 2 * 1024 * 1024, timeoutMs: 6000 });
    // Never mirror an error body or a non-image as an asset. dominos.com (and
    // any bot-protected site) returns a 404 / challenge page when we fetch its
    // logo server-side; storing that recreates the broken-<img> bug. Throw so
    // the caller falls through to the next candidate or the "no logo" UX.
    if (r.status < 200 || r.status >= 300) {
      throw new Error(`rehost: ${sourceUrl.slice(0, 80)} returned HTTP ${r.status}`);
    }
    if (!looksLikeImage(r.body, r.contentType)) {
      throw new Error(
        `rehost: ${sourceUrl.slice(0, 80)} is not an image (content-type=${r.contentType || '?'}, ${r.body.length}B)`,
      );
    }
    const ext = extFromContentType(r.contentType) || extFromUrl(sourceUrl) || 'bin';
    const hash = createHash('sha256').update(r.body).digest('hex').slice(0, 12);
    const path = `${keyPrefix}-${hash}.${ext}`;
    return this.storage.uploadLogo(path, r.body, r.contentType || 'application/octet-stream');
  }

  /** Decode a `data:image/...;base64,...` logo (the wizard's "upload your own
   *  logo" escape hatch) and store it in the branding-logos bucket (task #223
   *  — SVG data URLs must land here, not the general `assets` bucket). Shares
   *  the 2MB cap + image-sniff guard; throws on malformed / oversized /
   *  non-image input. */
  private async uploadLogoDataUrl(tenantId: string, dataUrl: string): Promise<string> {
    const m = /^data:(image\/[a-z0-9+.-]+);base64,(.+)$/i.exec(dataUrl || '');
    if (!m) throw new Error('not a base64 image data URL');
    const mimeType = m[1];
    const buf = Buffer.from(m[2], 'base64');
    if (buf.byteLength === 0) throw new Error('empty image');
    if (buf.byteLength > 2 * 1024 * 1024) throw new Error('logo too large (max 2MB)');
    if (!looksLikeImage(buf, mimeType)) throw new Error('decoded bytes are not an image');
    const ext = (mimeType.split('/')[1] || 'png').split('+')[0].replace(/[^a-z0-9]/gi, '') || 'png';
    const hash = createHash('sha256').update(buf).digest('hex').slice(0, 12);
    const path = `branding/${tenantId}/logo-upload-${hash}.${ext}`;
    return this.storage.uploadLogo(path, buf, mimeType);
  }

  private async rehost(content: string, path: string, contentType: string): Promise<string> {
    return this.storage.uploadLogo(path, Buffer.from(content, 'utf-8'), contentType);
  }

  /**
   * Prefer a VECTOR logo over a raster one when the scrape captured a
   * vector — the Domino's bug (task #223): the operator's pinned SVG was
   * rejected (corrupt-in-transit or a text-only wordmark with no shape
   * primitive), so adopt fell straight through to the raster og:image and
   * the crisp scalable wordmark was lost. A logo that renders pixelated on
   * a 4K wall is the most visible "this looks cheap" failure on a signage
   * product.
   *
   * Scans EVERY candidate (not just position #1) for a vector and rehosts
   * it before any raster fallback runs:
   *   1) inline SVG that passes the same isRealSvg shape-primitive gate — we
   *      sanitize it for the inline-render path AND store the raw SVG as the
   *      <img>-served asset (same dual-trust model as the main adopt path).
   *   2) a candidate whose URL is a `.svg` (or `isSvg` flag) — rehostUrl
   *      preserves the `image/svg+xml` content-type, so it stays vector.
   *
   * Returns the rehosted vector logoUrl + (for inline SVGs) the sanitized
   * inline markup, or null when no vector candidate exists. Pure-ish: only
   * touches storage; never persists.
   */
  private async pickVectorLogoCandidate(
    logos: AdoptBody['logos'],
    keyPrefix: string,
    isRealSvg: (s: string | null) => boolean,
    tenantId: string,
  ): Promise<{ logoUrl: string; logoSvgInline: string | null } | null> {
    // Pure selection lives in select-vector-logo.ts (unit-tested in
    // isolation — no NestJS / DOMPurify in the test path). Here we just do
    // the I/O for whatever it picked.
    const choice = selectVectorLogo(logos, isRealSvg);
    if (!choice) return null;

    if (choice.kind === 'inline') {
      try {
        const cleaned = sanitizeLogoSvg(choice.svgInline);
        // Store the RAW SVG (sandboxed via <img>) — preserves <image>,
        // <use>, filters the inline-sanitizer would strip. The sanitized
        // copy goes inline via dangerouslySetInnerHTML.
        const url = await this.rehost(choice.svgInline, `${keyPrefix}/logo.svg`, 'image/svg+xml');
        this.logger.log(`[adopt] preserved vector logo (inline SVG) for tenant ${tenantId}`);
        return { logoUrl: url, logoSvgInline: cleaned };
      } catch (e: any) {
        this.logger.warn(`[adopt] inline-SVG vector rehost failed for tenant ${tenantId}: ${e?.message}`);
        return null;
      }
    }

    // URL-referenced SVG — rehostUrl preserves the image/svg+xml mime.
    try {
      const rehosted = await this.rehostUrl(choice.url, `${keyPrefix}/logo-vec`);
      this.logger.log(`[adopt] preserved vector logo (SVG URL) for tenant ${tenantId}`);
      return { logoUrl: rehosted, logoSvgInline: null };
    } catch (e: any) {
      this.logger.warn(`[adopt] vector-SVG-URL rehost failed for tenant ${tenantId}: ${e?.message}`);
      return null;
    }
  }

  /**
   * Shared helper used by per-template adopt (and reusable for tenant
   * adopt in a future refactor). Takes a scrape preview body, a
   * Supabase storage prefix to scope the rehosted assets, and an
   * optional existing record to fall back to if the new scrape
   * didn't produce a logo. Returns the processed assets ready to
   * persist on whichever model is calling.
   *
   * Same SVG validation + sanitization rules as the global adopt
   * path. Same logo-fallback chain (override → first → next ranked
   * candidate, skipping favicons). Just parameterized.
   */
  private async processBrandingAssets(
    body: AdoptBody,
    keyPrefix: string,
    existing?: { logoUrl?: string | null; logoSvgInline?: string | null } | null,
  ): Promise<{
    logoUrl: string | null;
    logoSvgInline: string | null;
    faviconUrl: string | null;
    palette: any;
  }> {
    let logoUrl: string | null = null;
    let logoSvgInline: string | null = null;
    let faviconUrl: string | null = null;

    const chosenLogo = body.logoOverride?.url ?? body.logos?.[0]?.url ?? null;
    const chosenSvg = body.logoOverride?.svgInline ?? body.logos?.[0]?.svgInline ?? null;

    // SVG must contain at least one shape primitive — otherwise it's
    // probably a decorative text-only element the scraper picked up
    // by mistake. Same rule as the global adopt path.
    const chosenSvgValid = isRealSvg(chosenSvg);

    if (chosenSvg && chosenSvgValid) {
      const cleaned = sanitizeLogoSvg(chosenSvg);
      logoSvgInline = cleaned;
      try {
        // Upload the RAW (un-sanitized) SVG — served via <img> tag,
        // sandboxed by the browser. Sanitized version goes inline
        // via dangerouslySetInnerHTML where DOMPurify must strip
        // scripts. Same dual-storage trust model as the global adopt.
        logoUrl = await this.rehost(chosenSvg, `${keyPrefix}/logo.svg`, 'image/svg+xml');
      } catch (e: any) {
        this.logger.warn(`[brand-kit] inline SVG upload failed for ${keyPrefix}: ${e?.message}`);
      }
    }

    // VECTOR-PRESERVATION (task #223) — same as the global adopt path:
    // prefer a scraped vector logo (inline SVG or `.svg` URL) over a raster
    // before the raster fallback, so a rejected/unpinned vector still keeps
    // its scalability on a per-template brand kit.
    if (!logoUrl) {
      const vector = await this.pickVectorLogoCandidate(body.logos, keyPrefix, isRealSvg, keyPrefix);
      if (vector) {
        logoUrl = vector.logoUrl;
        if (!logoSvgInline && vector.logoSvgInline) logoSvgInline = vector.logoSvgInline;
      }
    }

    if (!logoUrl && chosenLogo) {
      try {
        logoUrl = await this.rehostUrl(chosenLogo, `${keyPrefix}/logo`);
      } catch (e: any) {
        this.logger.warn(`[brand-kit] logo rehost failed for ${keyPrefix}, storing source: ${e?.message}`);
        logoUrl = chosenLogo;
      }
    }

    // Preserve previous logo if the scrape didn't produce a new one.
    if (!logoUrl && existing?.logoUrl) {
      logoUrl = existing.logoUrl;
      if (!logoSvgInline && existing.logoSvgInline) logoSvgInline = existing.logoSvgInline;
    }

    // Fallback chain — try ranked candidates beyond the top one,
    // skipping favicons (.ico) which are too small to use as logos.
    if (!logoUrl && Array.isArray(body.logos)) {
      for (const cand of body.logos.slice(1)) {
        if (!cand?.url) continue;
        if (/\.(ico|icns)(\?|#|$)/i.test(cand.url)) continue;
        try {
          logoUrl = await this.rehostUrl(cand.url, `${keyPrefix}/logo-fb`);
          break;
        } catch { /* try next */ }
      }
    }

    if (body.favicon) {
      try {
        faviconUrl = await this.rehostUrl(body.favicon, `${keyPrefix}/favicon`);
      } catch {
        faviconUrl = body.favicon;
      }
    }

    const finalPrimary = body.palette?.primary ?? '#4f46e5';
    const finalAccent = body.palette?.accent;
    // Re-enforce WCAG contrast after the body.palette spread so a
    // client-supplied yellow doesn't slip past the nudge. P0-6.
    const palette = enforcePaletteContrast({ ...derivePalette(finalPrimary, finalAccent), ...(body.palette || {}) });
    // Logo backdrop (2026-08-25): validate the client round-trip against the
    // enum, same rule as the tenant adopt path.
    const requestedLogoBg = (body.palette as any)?.logoBackground ?? (body as any)?.logoBackground;
    if (isLogoBackground(requestedLogoBg)) (palette as any).logoBackground = requestedLogoBg;
    else delete (palette as any).logoBackground;

    return { logoUrl, logoSvgInline, faviconUrl, palette };
  }
}

/**
 * Re-enforce WCAG contrast on a palette object that may have been
 * spread-overridden by client-supplied body.palette. This guards the
 * adopt path: the client can ship a palette where they manually
 * picked a yellow primary; `derivePalette()` adjusted it, but the
 * spread `{ ...derivePalette(), ...body.palette }` reinstated the
 * raw yellow. Run a final check + tweak + report so what hits the
 * DB always passes 4.5:1 — and the original is preserved in *_raw.
 *
 * Pure function — no controller deps — so it lives outside the class
 * and is reusable by the per-template path too.
 */
// A valid logo SVG must contain at least one shape primitive (path,
// circle, rect, polygon, image, use) and be non-trivial in size —
// otherwise it's probably a decorative text-only element the scraper
// picked up by mistake. Shared by the adopt + preview paths (was two
// identical closures; hoisted 2026-08-05).
function isRealSvg(s: string | null): boolean {
  if (!s || s.length < 200) return false;
  return /<(path|circle|rect|polygon|polyline|ellipse|image|use)\b/i.test(s);
}

function enforcePaletteContrast(palette: any, target: number = 4.5): any {
  if (!palette || typeof palette !== 'object') return palette;
  const out = { ...palette };
  const adjustments: any[] = [];

  for (const key of ['primary', 'accent'] as const) {
    const bg = typeof out[key] === 'string' ? out[key] : null;
    if (!bg) continue;
    const rawKey = `${key}Raw` as const;
    const onKey = `${key}On` as const;
    // Preserve the operator's original choice. If we haven't already
    // stamped a *_raw value, save the incoming color as the raw.
    const raw = typeof out[rawKey] === 'string' ? out[rawKey] : bg;
    const ink = typeof out[onKey] === 'string' ? out[onKey] : bestTextOn(bg);
    const fromRatio = contrastRatio(bg, ink);
    const adjusted = ensureContrast(bg, ink, target);
    const toRatio = contrastRatio(adjusted, ink);
    out[key] = adjusted;
    out[rawKey] = raw;
    out[onKey] = ink;
    // Also keep the canonical inkKey in sync (primaryInk/accentInk).
    if (key === 'primary') out.primaryInk = ink;
    if (key === 'accent') out.accentInk = ink;
    adjustments.push({
      key,
      from: raw,
      to: adjusted,
      ink,
      fromRatio: +fromRatio.toFixed(2),
      toRatio: +toRatio.toFixed(2),
      target,
      adjusted: adjusted.toLowerCase() !== bg.toLowerCase() || adjusted.toLowerCase() !== raw.toLowerCase(),
      capped: toRatio < target,
    });
  }

  // VisionCore hardening (2026-07-21): (re)derive the contrast-guaranteed
  // workhorse shades from the FINAL adjusted primary/accent. These fields
  // are machine-owned derivatives — the client spread may carry stale or
  // hand-mangled values, and the web painter PREFERS persisted values, so
  // what hits the DB must always be consistent with the persisted base.
  for (const key of ['primary', 'accent'] as const) {
    const base = typeof out[key] === 'string' ? out[key] : null;
    if (!base) continue;
    const shades = deriveReadableShades(base);
    out[`${key}Mid`] = shades.mid;
    out[`${key}Strong`] = shades.strong;
    out[`${key}StrongHover`] = shades.strongHover;
    out[`${key}Stronger`] = shades.stronger;
    adjustments.push(...readableShadeAdjustments(key, base, shades));
  }

  const report: ContrastReport = {
    target,
    adjustments,
    // anyAdjusted = "did we move a color the operator picked?" — derived
    // shade rows always differ from a light base by design, so they are
    // excluded (same semantics as derivePalette's report).
    anyAdjusted: adjustments.some((a) => (a.key === 'primary' || a.key === 'accent') && a.adjusted),
    anyCapped: adjustments.some((a) => a.capped),
  };
  out.contrastReport = report;
  return out;
}

/**
 * Sniff whether fetched/decoded bytes are actually an image. The branding
 * pipeline re-hosts remote logo URLs into our bucket; without this guard an
 * upstream 404 page or a Cloudflare bot-challenge body gets stored AS the
 * "logo" and the <img> renders broken forever. (Domino's, 2026-05-31 — the
 * scrape mirrored a 9-byte text/plain "Not Found" as the logo.)
 *
 * Trust the content-type when it says image/*, else fall back to magic-byte
 * sniffing (servers mislabel images as octet-stream) + an <svg>/<?xml> head
 * check for text-based SVGs.
 */
function looksLikeImage(buf: Buffer, contentType?: string | null): boolean {
  if (contentType && /^image\//i.test(contentType)) return true;
  if (!buf || buf.length < 4) return false;
  const b = buf;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true; // PNG
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true; // JPEG
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return true; // GIF
  if (b[0] === 0x42 && b[1] === 0x4d) return true; // BMP
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return true; // WEBP
  if (b[0] === 0x00 && b[1] === 0x00 && (b[2] === 0x01 || b[2] === 0x02) && b[3] === 0x00) return true; // ICO/CUR
  const head = b.toString('utf8', 0, Math.min(b.length, 512)).trim().toLowerCase();
  if (head.startsWith('<?xml') || head.includes('<svg')) return true; // SVG / XML
  return false;
}

function extFromContentType(ct: string): string | null {
  const lower = ct.toLowerCase();
  if (lower.includes('svg')) return 'svg';
  if (lower.includes('png')) return 'png';
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('webp')) return 'webp';
  if (lower.includes('gif')) return 'gif';
  if (lower.includes('x-icon') || lower.includes('vnd.microsoft.icon')) return 'ico';
  return null;
}

function extFromUrl(u: string): string | null {
  const m = u.match(/\.(svg|png|jpe?g|webp|gif|ico)(?:\?|$)/i);
  return m ? m[1].toLowerCase() : null;
}

// Shape of the /adopt body — deliberately loose; the client passes back
// the same preview it received, possibly with user overrides.
type AdoptBody = Partial<BrandingPreview> & {
  logoOverride?: { url?: string; svgInline?: string };
  /** Operator-uploaded logo (data:image/...;base64,...). Wins over any
   *  scraped candidate — the escape hatch for sites that block our scraper. */
  logoDataUrl?: string;
};
