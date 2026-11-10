import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AppRole } from '@cms/database';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { csvEscape } from '../audit/audit.controller';
import { parsePlayLogQuery } from './play-log.policy';

/**
 * GET /api/v1/analytics/play-log — what a screen showed, or where a file
 * played, over a time range (2026-11-09, player stability gap 7).
 *
 *   ?screenId=… and/or ?assetId=…   (one is required)
 *   ?from=…&to=…                    ISO time or epoch ms; default last 24 h, max 31 days
 *   ?limit=…                        JSON default 1,000, max 5,000
 *   ?format=csv                     CSV download, up to 50,000 rows
 *
 * Tenant-scoped: every query constrains `tenantId` to the caller's tenant, and
 * the names joined onto the rows are read inside that tenant too — a device id
 * that does not belong to the caller's tenant resolves to nothing. Same role
 * set as the proof-of-play report. CSV cells go through the audit export's
 * formula-injection escape.
 */
@Controller('api/v1/analytics')
@UseGuards(JwtAuthGuard, RbacGuard)
export class PlayLogReadController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('play-log')
  @RequireRoles(
    AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR, AppRole.RESTRICTED_VIEWER,
  )
  async read(
    @Request() req: any,
    @Res({ passthrough: true }) res: Response,
    @Query('screenId') screenId?: string,
    @Query('assetId') assetId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('format') format?: string,
  ) {
    const q = parsePlayLogQuery({ screenId, assetId, from, to, limit, format }, Date.now());
    if (!q.ok) throw new BadRequestException({ code: q.code, message: q.message });
    const tenantId: string = req.user.tenantId;

    const where: Record<string, unknown> = {
      tenantId,
      startedAt: { gte: q.from, lt: q.to },
    };
    if (q.screenId) where.screenId = q.screenId;
    if (q.assetId) where.assetId = q.assetId;

    const rows = await this.prisma.client.playLogEntry.findMany({
      where: where as any,
      orderBy: { startedAt: 'asc' },
      take: q.limit + 1,
      select: {
        screenId: true, startedAt: true, playlistItemId: true, playlistId: true,
        assetId: true, shownMs: true, completed: true,
      },
    });
    const truncated = rows.length > q.limit;
    const page = truncated ? rows.slice(0, q.limit) : rows;

    const screenIds = [...new Set(page.map((r) => r.screenId))];
    const assetIds = [...new Set(page.map((r) => r.assetId).filter((a): a is string => !!a))];
    const playlistIds = [...new Set(page.map((r) => r.playlistId))];
    type Named = { id: string; name: string | null };
    const [screens, assets, playlists]: [Named[], Array<{ id: string; originalName: string | null }>, Named[]] =
      await Promise.all([
        screenIds.length
          ? this.prisma.client.screen.findMany({ where: { id: { in: screenIds }, tenantId }, select: { id: true, name: true } })
          : Promise.resolve([]),
        assetIds.length
          ? this.prisma.client.asset.findMany({ where: { id: { in: assetIds }, tenantId }, select: { id: true, originalName: true } })
          : Promise.resolve([]),
        playlistIds.length
          ? this.prisma.client.playlist.findMany({ where: { id: { in: playlistIds }, tenantId }, select: { id: true, name: true } })
          : Promise.resolve([]),
      ]);
    const screenName = new Map<string, string | null>(screens.map((s) => [s.id, s.name]));
    const assetName = new Map<string, string | null>(assets.map((a) => [a.id, a.originalName]));
    const playlistName = new Map<string, string | null>(playlists.map((p) => [p.id, p.name]));

    const items = page.map((r) => ({
      screenId: r.screenId,
      screenName: screenName.get(r.screenId) ?? null,
      startedAt: r.startedAt.toISOString(),
      shownMs: r.shownMs,
      completed: r.completed,
      playlistId: r.playlistId,
      playlistName: playlistName.get(r.playlistId) ?? null,
      playlistItemId: r.playlistItemId,
      assetId: r.assetId,
      assetName: r.assetId ? assetName.get(r.assetId) ?? null : null,
    }));

    if (!q.csv) {
      return { from: q.from.toISOString(), to: q.to.toISOString(), truncated, items };
    }

    const header = ['startedAt', 'shownSeconds', 'completed', 'screenId', 'screenName', 'playlistId', 'playlistName', 'playlistItemId', 'assetId', 'assetName'];
    const lines = [header.join(',')];
    for (const i of items) {
      lines.push(
        [i.startedAt, (i.shownMs / 1000).toFixed(1), i.completed, i.screenId, i.screenName, i.playlistId, i.playlistName, i.playlistItemId, i.assetId, i.assetName]
          .map(csvEscape)
          .join(','),
      );
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="play-log-${q.from.toISOString().slice(0, 10)}.csv"`);
    if (truncated) res.setHeader('X-Play-Log-Truncated', '1');
    return lines.join('\n');
  }
}
