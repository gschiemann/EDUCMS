import { Controller, Get, Query, Request, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';

const ADMIN_ROLES = [AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN] as const;

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function clampInt(value: string | undefined, def: number, min: number, max: number): number {
  if (!value) return def;
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return def;
  return Math.min(Math.max(n, min), max);
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

@Controller('api/v1/audit')
@UseGuards(JwtAuthGuard, RbacGuard)
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('recent')
  @RequireRoles(...ADMIN_ROLES)
  async getRecentActivity(@Request() req: any) {
    const tenantId = req.user.tenantId;
    return this.prisma.client.auditLog.findMany({
      where: { tenantId },
      take: 20,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { email: true, role: true } } },
    });
  }

  @Get()
  @RequireRoles(...ADMIN_ROLES)
  async list(
    @Request() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('actorId') actorId?: string,
    @Query('action') action?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ) {
    const tenantId = req.user.tenantId;
    const limit = clampInt(limitStr, 50, 1, 200);
    const offset = clampInt(offsetStr, 0, 0, 100000);

    const where = this.buildWhere(tenantId, { from, to, actorId, action });

    const [items, total] = await Promise.all([
      this.prisma.client.auditLog.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { email: true, role: true } } },
      }),
      this.prisma.client.auditLog.count({ where }),
    ]);

    return { items, total, limit, offset };
  }

  @Get('export')
  @RequireRoles(...ADMIN_ROLES)
  async exportCsv(
    @Request() req: any,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('actorId') actorId?: string,
    @Query('action') action?: string,
  ) {
    const tenantId = req.user.tenantId;
    const where = this.buildWhere(tenantId, { from, to, actorId, action });

    // Hard cap to protect memory in case the caller omits filters.
    const items = await this.prisma.client.auditLog.findMany({
      where,
      take: 10000,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { email: true, role: true } } },
    });

    const header = ['timestamp', 'actorEmail', 'actorRole', 'action', 'targetType', 'targetId', 'details'];
    const lines = [header.join(',')];
    for (const row of items) {
      lines.push(
        [
          row.createdAt.toISOString(),
          row.user?.email ?? '',
          row.user?.role ?? '',
          row.action,
          row.targetType,
          row.targetId ?? '',
          row.details ?? '',
        ]
          .map(csvEscape)
          .join(','),
      );
    }

    const csv = lines.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send(csv);
  }

  private buildWhere(
    tenantId: string,
    filters: { from?: string; to?: string; actorId?: string; action?: string },
  ) {
    const where: any = { tenantId };
    const fromDate = parseDate(filters.from);
    const toDate = parseDate(filters.to);
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = fromDate;
      if (toDate) where.createdAt.lte = toDate;
    }
    if (filters.actorId) where.userId = filters.actorId;
    if (filters.action) where.action = filters.action;
    return where;
  }
}
