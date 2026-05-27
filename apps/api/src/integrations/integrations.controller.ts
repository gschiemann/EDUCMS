/**
 * IntegrationsController — public surface of the AI Integration
 * Concierge (per CLAUDE.md vision section).
 *
 * Two endpoints:
 *   POST /api/v1/integrations/discover   — body { url: string }
 *   POST /api/v1/integrations/describe   — body { text: string }
 *
 * Both return a ranked list of provider candidates the operator
 * might want to wire up. The concierge UI displays each with a
 * confidence chip + blurb + Connect / Skip CTAs.
 *
 * RBAC: ADMIN+ + CONTRIBUTOR. We don't expose this to
 * RESTRICTED_VIEWER since clicking "Connect" mutates tenant config.
 *
 * Rate limit: 20/hr per tenant. Discovery is cheap (one HTTP fetch
 * + cheerio parse) but defense-in-depth — a forged URL list could
 * otherwise be turned into a low-rate SSRF probe scanner.
 *
 * 2026-05-26 — Recreated after parallel-agent contention wiped the
 * file twice. Now isolated under `apps/api/src/integrations/` which
 * no other agent touches.
 */
import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { IntegrationDiscoveryService } from './discovery.service';
import { HardwareRecommenderService } from './hardware-recommender.service';
import { PrismaService } from '../prisma/prisma.service';

const DiscoverFromUrlSchema = z.object({
  url: z.string().url().min(8).max(2_048),
}).passthrough();

const DescribeSchema = z.object({
  text: z.string().min(2).max(2_000),
}).passthrough();

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('api/v1/integrations')
export class IntegrationsController {
  constructor(
    private readonly svc: IntegrationDiscoveryService,
    private readonly hardware: HardwareRecommenderService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Look up the calling user's tenant vertical so we can attach a
   * hardware recommendation to the discovery output. Returns null when
   * the tenant has no recorded vertical yet.
   */
  private async tenantVertical(req: any): Promise<string | null> {
    const tenantId: string | undefined = req?.user?.tenantId;
    if (!tenantId) return null;
    try {
      const tenant = await this.prisma.client.tenant.findUnique({
        where: { id: tenantId },
        select: { vertical: true },
      });
      return tenant?.vertical || null;
    } catch {
      return null;
    }
  }

  @Post('discover')
  @Throttle({ default: { ttl: 60_000 * 60, limit: 20 } })
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  async discover(
    @Request() req: any,
    @Body(new ZodValidationPipe(DiscoverFromUrlSchema)) body: { url: string },
  ) {
    const result = await this.svc.discoverFromUrl(body.url);
    const vertical = await this.tenantVertical(req);
    const recommendedHardware = this.hardware.recommend(vertical);
    return { ...result, recommendedHardware };
  }

  @Post('describe')
  @Throttle({ default: { ttl: 60_000 * 60, limit: 30 } })
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  async describe(
    @Request() req: any,
    @Body(new ZodValidationPipe(DescribeSchema)) body: { text: string },
  ) {
    const result = await this.svc.discoverFromDescription(body.text);
    const vertical = await this.tenantVertical(req);
    const recommendedHardware = this.hardware.recommend(vertical);
    return { ...result, recommendedHardware };
  }

  /**
   * GET /api/v1/integrations/hardware/recommend?vertical=SPORTS
   *
   * Returns the recommended hardware for a vertical (or the caller's
   * tenant vertical when the query param is omitted). Used by the
   * pair-screen "What hardware?" picker + the per-vertical onboarding
   * wizard's "Recommended hardware" step.
   *
   * Returns `null` when the vertical has no recommendation yet — the UI
   * uses that to fall through to the manual picker without a pinned
   * suggestion.
   */
  @Get('hardware/recommend')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
    AppRole.RESTRICTED_VIEWER,
  )
  async recommendHardware(
    @Request() req: any,
    @Query('vertical') vertical?: string,
  ) {
    const v = vertical || (await this.tenantVertical(req));
    return {
      vertical: v,
      recommendation: this.hardware.recommend(v),
    };
  }

  /**
   * GET /api/v1/integrations/hardware/catalog
   *
   * Full hardware catalog — used by the pair-screen picker so the list
   * of supported models stays in sync with `packages/api-types/src/
   * hardware.ts` without the frontend hard-coding it.
   */
  @Get('hardware/catalog')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
    AppRole.RESTRICTED_VIEWER,
  )
  catalogHardware() {
    return { catalog: this.hardware.catalog() };
  }
}
