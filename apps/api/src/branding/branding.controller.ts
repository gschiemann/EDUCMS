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
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { SupabaseStorageService } from '../storage/supabase-storage.service';

import { BrandingScraperService, BrandingPreview } from './branding-scraper.service';
import { BrandingRateLimiter } from './branding-rate-limiter';
import { safeFetch, SsrfError } from './safe-fetch';
import { derivePalette, parseColor } from './color-utils';
import { sanitizeLogoSvg } from './sanitize-svg';

import { createHash } from 'crypto';

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
    if (!body?.url) throw new HttpException('url is required', HttpStatus.BAD_REQUEST);
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
    if (!body) throw new HttpException('body required', HttpStatus.BAD_REQUEST);

    // Re-host the logo + favicon to Supabase so we never hotlink.
    let logoUrl: string | null = null;
    let logoSvgInline: string | null = null;
    let faviconUrl: string | null = null;
    let ogImageUrl: string | null = null;

    const chosenLogo = body.logoOverride?.url ?? body.logos?.[0]?.url ?? null;
    const chosenSvg = body.logoOverride?.svgInline ?? body.logos?.[0]?.svgInline ?? null;

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
    const isRealSvg = (s: string | null): boolean => {
      if (!s || s.length < 200) return false;
      return /<(path|circle|rect|polygon|polyline|ellipse|image|use)\b/i.test(s);
    };
    const chosenSvgValid = isRealSvg(chosenSvg);
    if (chosenSvg && !chosenSvgValid) {
      this.logger.warn(
        `Branding SVG rejected for tenant ${tenantId} — no shape primitives (len=${chosenSvg.length}). Falling back to logoUrl.`,
      );
    }

    if (chosenSvg && chosenSvgValid) {
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
    // Also try the raster logoUrl as a fallback OR primary (when the
    // SVG was rejected). If logoUrl is already set from the SVG branch,
    // skip — the SVG wins.
    if (!logoUrl && chosenLogo) {
      try {
        logoUrl = await this.rehostUrl(chosenLogo, `branding/${tenantId}/logo`);
      } catch (e: any) {
        this.logger.warn(`Logo rehost failed, storing source URL directly: ${e?.message}`);
        logoUrl = chosenLogo;
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
        }
      } catch { /* best-effort */ }
    }

    // If the SVG was rejected AND we had other logo candidates, try
    // them in score order. The client's logoOverride may have pinned
    // the bad one — fall back to the next best candidate on the server
    // so branding still succeeds without a re-scrape.
    if (!logoUrl && Array.isArray(body.logos)) {
      for (const cand of body.logos.slice(1)) {
        if (!cand?.url) continue;
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
    // in case they tweaked it after the scrape.
    const finalPrimary = body.palette?.primary ?? '#4f46e5';
    const finalAccent = body.palette?.accent;
    const palette = { ...derivePalette(finalPrimary, finalAccent), ...(body.palette || {}) };

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
        fontHeading: body.fonts?.heading?.googleFont ?? body.fonts?.heading?.family ?? null,
        fontBody: body.fonts?.body?.googleFont ?? body.fonts?.body?.family ?? null,
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
        fontHeading: body.fonts?.heading?.googleFont ?? body.fonts?.heading?.family ?? null,
        fontBody: body.fonts?.body?.googleFont ?? body.fonts?.body?.family ?? null,
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

    return { ok: true, branding: record };
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
    },
  ) {
    const tenantId = req.user.tenantId;
    if (!tenantId) throw new HttpException('No tenant scope on session', HttpStatus.FORBIDDEN);

    // Palette — derive from primary (+ optional accent) the same way
    // the scraper-adopt path does, so themes look consistent.
    const primary = parseColor(body?.primaryHex || '#4f46e5')?.hex || '#4f46e5';
    const accent = body?.accentHex ? (parseColor(body.accentHex)?.hex || null) : null;
    const palette = derivePalette(primary, accent || undefined);

    let logoUrl: string | null = null;

    // (1) Uploaded file — data URL. Decode, rehost to Supabase.
    if (body.logoDataUrl && /^data:image\/[a-z+.-]+;base64,/.test(body.logoDataUrl)) {
      try {
        const match = body.logoDataUrl.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/)!;
        const mimeType = match[1];
        const b64 = match[2];
        const buf = Buffer.from(b64, 'base64');
        if (buf.byteLength > 2 * 1024 * 1024) {
          throw new HttpException('Logo too large (max 2MB)', HttpStatus.BAD_REQUEST);
        }
        const ext = mimeType.split('/')[1].split('+')[0].replace(/[^a-z0-9]/gi, '') || 'png';
        const hash = createHash('sha256').update(buf).digest('hex').slice(0, 12);
        const path = `branding/${tenantId}/manual-${hash}.${ext}`;
        logoUrl = await this.storage.upload(path, buf, mimeType);
      } catch (e: any) {
        this.logger.warn(`Manual logo upload failed for tenant ${tenantId}: ${e?.message}`);
        throw new HttpException(`Logo upload failed: ${e?.message}`, HttpStatus.BAD_REQUEST);
      }
    } else if (body.logoUrl) {
      // (2) Pasted URL — rehost so we don't hotlink.
      try {
        const r = await safeFetch(body.logoUrl, { maxBytes: 2 * 1024 * 1024, timeoutMs: 8000 });
        const ext = (r.contentType || '').split('/')[1]?.split(';')[0]?.replace(/[^a-z0-9]/gi, '') || 'png';
        if (/\.(ico|icns)(\?|#|$)/i.test(body.logoUrl)) {
          throw new Error('favicon URLs are too small to use as logos — paste a full-size image URL');
        }
        const hash = createHash('sha256').update(r.body).digest('hex').slice(0, 12);
        const path = `branding/${tenantId}/manual-${hash}.${ext}`;
        logoUrl = await this.storage.upload(path, r.body, r.contentType || 'application/octet-stream');
      } catch (e: any) {
        this.logger.warn(`Manual logo URL rehost failed for tenant ${tenantId}: ${e?.message}`);
        throw new HttpException(`Logo URL fetch failed: ${e?.message}`, HttpStatus.BAD_REQUEST);
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
        sourceUrl: 'manual://admin',
        scrapedAt: new Date(),
      },
      update: {
        displayName: body.displayName ?? undefined,
        tagline: body.tagline ?? undefined,
        ...(logoUrl ? { logoUrl } : {}),
        palette: palette as any,
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
        details: JSON.stringify({ displayName: body.displayName, hasLogo: !!logoUrl, primary }),
      },
    });

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

  // ── Palette math only (used by manual tweaker) ──────────────────
  @Post('derive-palette')
  @UseGuards(JwtAuthGuard)
  derive(@Body() body: { primaryHex: string; accentHex?: string }) {
    const p = parseColor(body?.primaryHex || '');
    if (!p) throw new HttpException('Invalid primaryHex', HttpStatus.BAD_REQUEST);
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
      throw new HttpException(
        'No brand kit configured for this tenant. Paste your school URL on the Brand Kit panel first.',
        HttpStatus.BAD_REQUEST,
      );
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
        // Background fill
        const bgPatch: any = {};
        if (mode === 'override' || (!tpl.bgColor && !tpl.bgGradient && !tpl.bgImage)) {
          bgPatch.bgColor = surface;
          bgPatch.bgGradient = null;
        }
        if (Object.keys(bgPatch).length > 0) {
          await tx.template.update({ where: { id: tpl.id }, data: bgPatch });
        }

        // Zone-level brand override — universal text-style keys read
        // by the BuilderZone scoped <style> override.
        for (const z of tpl.zones) {
          const cfg = (() => {
            try { return z.defaultConfig ? JSON.parse(z.defaultConfig as any) : {}; } catch { return {}; }
          })();
          const patch: Record<string, any> = {};
          if (mode === 'override' || cfg.color === undefined) patch.color = ink;
          if ((mode === 'override' || cfg.fontFamily === undefined) && fontHeading) patch.fontFamily = fontHeading;
          // fontBody not currently consumed but kept on the zone so a
          // future "apply body font separately" toggle can pick it up.
          if (Object.keys(patch).length === 0) continue;
          const merged = { ...cfg, ...patch };
          await tx.templateZone.update({ where: { id: z.id }, data: { defaultConfig: JSON.stringify(merged) } });
          zonesPatched += 1;
        }
      }
    });

    await this.prisma.client.auditLog.create({
      data: {
        action: 'BRANDING_APPLY_TO_TEMPLATES',
        targetType: 'tenant',
        targetId: tenantId,
        tenantId,
        userId,
        details: JSON.stringify({ mode, templateCount: templates.length, zonesPatched }),
      },
    }).catch(() => {});

    return {
      count: templates.length,
      zonesPatched,
      mode,
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
      throw new HttpException('Invalid slug', HttpStatus.BAD_REQUEST);
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
      throw new HttpException('url is required', HttpStatus.BAD_REQUEST);
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
      throw new HttpException({ message: e.message, code: 'BRANDING_SSRF' }, HttpStatus.BAD_REQUEST);
    }
    if (e?.name === 'FetchTooLargeError') {
      throw new HttpException({ message: 'Page too large to scrape', code: 'BRANDING_TOO_LARGE' }, HttpStatus.PAYLOAD_TOO_LARGE);
    }
    if (e instanceof HttpException) throw e;
    this.logger.error(`Unhandled scraper error: ${e?.stack || e?.message || e}`);
    throw new HttpException({ message: 'Scrape failed', code: 'BRANDING_SCRAPE_FAILED' }, HttpStatus.BAD_GATEWAY);
  }

  /**
   * Re-host a remote asset URL into our Supabase bucket. Returns the
   * public Supabase URL. SSRF-protected via safeFetch.
   */
  private async rehostUrl(sourceUrl: string, keyPrefix: string): Promise<string> {
    const r = await safeFetch(sourceUrl, { maxBytes: 2 * 1024 * 1024, timeoutMs: 6000 });
    const ext = extFromContentType(r.contentType) || extFromUrl(sourceUrl) || 'bin';
    const hash = createHash('sha256').update(r.body).digest('hex').slice(0, 12);
    const path = `${keyPrefix}-${hash}.${ext}`;
    return this.storage.upload(path, r.body, r.contentType || 'application/octet-stream');
  }

  private async rehost(content: string, path: string, contentType: string): Promise<string> {
    return this.storage.upload(path, Buffer.from(content, 'utf-8'), contentType);
  }
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
};
