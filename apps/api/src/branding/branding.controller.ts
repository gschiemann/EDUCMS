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

    if (chosenSvg) {
      // XSS defense: strip scripts, event handlers, <foreignObject>, and
      // anything not in DOMPurify's SVG profile BEFORE persisting.
      // Admin "A" can otherwise store <svg onload=...> that fires in
      // admin "B"'s session when they view settings.
      const cleaned = sanitizeLogoSvg(chosenSvg);
      if (cleaned !== chosenSvg) {
        this.logger.warn(
          `Branding SVG sanitized for tenant ${tenantId} — unsafe markup stripped (user ${req.user.id})`,
        );
      }
      logoSvgInline = cleaned;
      try {
        logoUrl = await this.rehost(cleaned, `branding/${tenantId}/logo.svg`, 'image/svg+xml');
      } catch (e: any) {
        this.logger.warn(`Inline SVG logo upload failed, falling back to inline: ${e?.message}`);
      }
    } else if (chosenLogo) {
      try {
        logoUrl = await this.rehostUrl(chosenLogo, `branding/${tenantId}/logo`);
      } catch (e: any) {
        this.logger.warn(`Logo rehost failed, storing source URL directly: ${e?.message}`);
        logoUrl = chosenLogo;
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
