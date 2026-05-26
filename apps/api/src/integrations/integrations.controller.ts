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
import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { IntegrationDiscoveryService } from './discovery.service';

const DiscoverFromUrlSchema = z.object({
  url: z.string().url().min(8).max(2_048),
}).passthrough();

const DescribeSchema = z.object({
  text: z.string().min(2).max(2_000),
}).passthrough();

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('api/v1/integrations')
export class IntegrationsController {
  constructor(private readonly svc: IntegrationDiscoveryService) {}

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
    return this.svc.discoverFromUrl(body.url);
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
    return this.svc.discoverFromDescription(body.text);
  }
}
