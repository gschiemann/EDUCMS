import { Body, Controller, Get, Param, Post, Put, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { PrismaService } from '../prisma/prisma.service';
import { LicenseService } from './license.service';

/**
 * Owner-only management endpoints. Used by the /super page in the web app
 * for the operator (= you, gschiemann@sbcglobal.net) to apply licenses,
 * comp seats, and view billing health across every tenant.
 */
@Controller('api/v1/super')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles(AppRole.SUPER_ADMIN)
export class SuperLicenseController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly license: LicenseService,
  ) {}

  /** List every tenant with its license summary + paired-screen count. */
  @Get('tenants')
  async listTenants() {
    const tenants = await this.prisma.client.tenant.findMany({
      select: {
        id: true, name: true, slug: true, vertical: true, parentId: true, createdAt: true,
        license: true,
        _count: { select: { screens: { where: { pairedAt: { not: null } } } } },
      },
      orderBy: [{ vertical: 'asc' }, { name: 'asc' }],
    });
    return tenants.map(t => {
      const seatLimit = t.license?.seatLimit ?? LicenseService.PILOT_SEAT_LIMIT;
      const seatsUsed = t._count.screens;
      return {
        id: t.id, name: t.name, slug: t.slug, vertical: t.vertical, parentId: t.parentId, createdAt: t.createdAt,
        tier: t.license?.tier ?? 'PILOT',
        status: t.license?.status ?? 'ACTIVE',
        billingMode: t.license?.billingMode ?? 'COMP',
        seatLimit, seatsUsed, atLimit: seatsUsed >= seatLimit,
        monthlyPriceCents: t.license?.monthlyPriceCents ?? null,
        expiresAt: t.license?.expiresAt ?? t.license?.currentPeriodEnd ?? null,
        notes: t.license?.notes ?? null,
      };
    });
  }

  /** Create OR update the License row for a tenant. Idempotent upsert. */
  @Post('tenants/:tenantId/license')
  async upsertLicense(
    @Param('tenantId') tenantId: string,
    @Body() body: {
      tier: string;
      seatLimit: number;
      billingMode?: string;
      status?: string;
      monthlyPriceCents?: number | null;
      currentPeriodStart?: string | null;
      currentPeriodEnd?: string | null;
      expiresAt?: string | null;
      notes?: string | null;
    },
  ) {
    if (!body.tier || typeof body.seatLimit !== 'number' || body.seatLimit < 1) {
      throw new HttpException('tier and seatLimit (>=1) required', HttpStatus.BAD_REQUEST);
    }
    const exists = await this.prisma.client.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!exists) throw new HttpException('Tenant not found', HttpStatus.NOT_FOUND);

    const data: any = {
      tier: body.tier,
      seatLimit: body.seatLimit,
      billingMode: body.billingMode ?? 'COMP',
      status: body.status ?? 'ACTIVE',
      monthlyPriceCents: body.monthlyPriceCents ?? null,
      currentPeriodStart: body.currentPeriodStart ? new Date(body.currentPeriodStart) : null,
      currentPeriodEnd: body.currentPeriodEnd ? new Date(body.currentPeriodEnd) : null,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      notes: body.notes ?? null,
    };

    return this.prisma.client.license.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });
  }

  /** Convenience: comp N seats indefinitely (most common SUPER_ADMIN action). */
  @Post('tenants/:tenantId/comp')
  async comp(
    @Param('tenantId') tenantId: string,
    @Body() body: { seatLimit: number; tier?: string; notes?: string | null },
  ) {
    return this.upsertLicense(tenantId, {
      tier: body.tier ?? 'PILOT',
      seatLimit: body.seatLimit,
      billingMode: 'COMP',
      status: 'ACTIVE',
      monthlyPriceCents: 0,
      notes: body.notes ?? `Comp'd by SUPER_ADMIN at ${new Date().toISOString()}`,
    });
  }

  /** Suspend a license (e.g. payment failure). Players still play; new
   *  pairs are blocked. */
  @Put('tenants/:tenantId/license/status')
  async setStatus(
    @Param('tenantId') tenantId: string,
    @Body() body: { status: 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED' },
  ) {
    return this.prisma.client.license.update({
      where: { tenantId },
      data: { status: body.status },
    });
  }
}
