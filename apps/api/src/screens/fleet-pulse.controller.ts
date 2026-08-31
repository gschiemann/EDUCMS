import { Controller, Get, HttpException, HttpStatus, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Fleet pulse read (2026-08-31, design-mock parity) — the recorded
 * online/degraded/offline history the dashboard chart draws. Read-only,
 * tenant-scoped to self + direct non-archived children (the fleet scope).
 * Serves ONLY what the sampler actually observed — a fresh deploy returns a
 * short series and the chart says so, never a fabricated past.
 */
// NOTE: this codebase has NO setGlobalPrefix — every controller carries the
// full 'api/v1/...' path itself. This one first shipped with the bare
// 'screens' path and mounted at /screens/fleet-pulse while the dashboard
// called /api/v1/... → 404 for its whole first day (2026-08-31). The
// controller-prefix spec now guards the whole surface.
@Controller('api/v1/screens')
export class FleetPulseController {
  constructor(private readonly prisma: PrismaService) {}

  @UseGuards(JwtAuthGuard, RbacGuard)
  @Get('fleet-pulse')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async pulse(@Request() req: any, @Query('hours') hoursRaw?: string) {
    const rootId = req.user.tenantId as string;
    if (!rootId) throw new HttpException({ code: 'SCREEN_NO_TENANT_CONTEXT', message: 'No tenant context' }, HttpStatus.BAD_REQUEST);
    const hours = Math.min(Math.max(Number.parseInt(hoursRaw ?? '', 10) || 24, 1), 168);

    const children = await this.prisma.client.tenant.findMany({
      where: { parentId: rootId, archivedAt: null },
      select: { id: true },
    });
    const tenantIds = [rootId, ...children.map((c) => c.id)];

    const rows = await this.prisma.client.fleetSample.findMany({
      where: {
        tenantId: { in: tenantIds },
        createdAt: { gte: new Date(Date.now() - hours * 60 * 60_000) },
      },
      orderBy: { createdAt: 'asc' },
      select: { tenantId: true, online: true, offline: true, notPainting: true, total: true, createdAt: true },
    });

    // Fleet series: sum the per-tenant rows of each sampler tick. Ticks are
    // written in one createMany, so bucketing to the minute regroups them
    // exactly; per-location series feed the table sparklines.
    const fleetBuckets = new Map<number, { ts: number; online: number; offline: number; notPainting: number; total: number }>();
    const locations: Record<string, Array<{ ts: number; online: number; total: number }>> = {};
    for (const r of rows) {
      const ts = Math.floor(new Date(r.createdAt).getTime() / 60_000) * 60_000;
      const b = fleetBuckets.get(ts) ?? { ts, online: 0, offline: 0, notPainting: 0, total: 0 };
      b.online += r.online; b.offline += r.offline; b.notPainting += r.notPainting; b.total += r.total;
      fleetBuckets.set(ts, b);
      (locations[r.tenantId] ??= []).push({ ts, online: r.online, total: r.total });
    }
    return { fleet: [...fleetBuckets.values()].sort((a, b) => a.ts - b.ts), locations };
  }
}
