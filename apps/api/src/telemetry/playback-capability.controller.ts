/**
 * GET /api/v1/screens/:id/playback-capability — READ-ONLY (2026-10-11, video
 * guarantee step 4; docs/research/2026-10-11-launch-readiness/02-video-guarantee.md).
 *
 * Per screen: does it play video smoothly, stutter, or is it not known yet —
 * for the files it has actually played (`screen_file_playback`, folded from
 * the player's own dropped-frame samples), plus the computed playback
 * capability profile (measured on this screen → measured on the same model →
 * declared by its WebView → class default → unknown; pure, in @cms/api-types).
 *
 * It ENFORCES NOTHING. No publish is refused, no file is swapped, no screen is
 * told anything: steps 5–8 (publish gate, demotion) ship later, deliberately,
 * behind a flag, with the owner's sign-off (Player Reliability rule 12).
 * Emergency content is never evaluated here.
 *
 * Mounted under /api/v1/screens next to ScreensController / DisplayController;
 * the literal `playback-capability` segment collides with no existing route.
 * Screen-scoped people reach it through the `/screens/:id/**` rule (their own
 * screens only) — user-scope.policy.ts.
 */

import { Controller, Get, NotFoundException, Param, Req, UseGuards } from '@nestjs/common';
import { AppRole } from '@cms/database';
import {
  computePlaybackCapability,
  declaredMaxShortEdge,
  droppedPercent,
  playbackDeviceClass,
  summarizeScreenPlayback,
  type CapabilityRecordInput,
  type FilePlaybackVerdict,
  type MediaCapsReport,
  type PlaybackCapability,
  type ScreenPlaybackSummary,
} from '@cms/api-types';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { assertSupportReach } from '../support-access/support-access.context';
import { recordFromRow } from './file-playback';

/** The newest files shown per screen. */
export const PLAYBACK_FILES_LIMIT = 20;
/** Records read from same-model screens to build class evidence (aggregate only). */
export const PLAYBACK_CLASS_RECORDS_LIMIT = 500;

export interface ScreenFilePlaybackView {
  sha256: string;
  /** The asset's name when this location owns it, else the file's last path segment. */
  name: string;
  assetId: string | null;
  /** Which copy of the asset the screen played. Null when the file is not in this location's library. */
  copy: 'original' | '1080p' | null;
  verdict: FilePlaybackVerdict;
  samples: number;
  settledSamples: number;
  /** Settled aggregate, %. Null before any settled sample. */
  droppedPct: number | null;
  worstPct: number | null;
  lastPct: number | null;
  width: number | null;
  height: number | null;
  engine: string | null;
  concurrentMax: number;
  unitConcurrentMax: number;
  firstAt: string;
  lastAt: string;
}

export interface ScreenPlaybackCapabilityResponse {
  screenId: string;
  summary: ScreenPlaybackSummary;
  capability: PlaybackCapability;
  declared: { reportedAt: string; maxShortEdge: 1080 | 2160 | null; webviewMajor: number | null } | null;
  files: ScreenFilePlaybackView[];
}

const fileNameOf = (url: unknown): string => {
  const raw = typeof url === 'string' ? url.split('?')[0].split('#')[0] : '';
  const last = raw.split('/').filter(Boolean).pop() ?? '';
  try {
    return decodeURIComponent(last) || 'video';
  } catch {
    return last || 'video';
  }
};

const isoOf = (d: unknown): string => (d instanceof Date ? d.toISOString() : new Date(String(d)).toISOString());

@Controller('api/v1/screens')
export class PlaybackCapabilityController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id/playback-capability')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  async get(@Param('id') screenId: string, @Req() req: any): Promise<ScreenPlaybackCapabilityResponse> {
    const isSuper = req.user?.role === AppRole.SUPER_ADMIN;
    const callerTenantId: string | null = req.user?.tenantId || req.user?.schoolId || req.user?.districtId || null;
    if (!isSuper && !callerTenantId) throw new NotFoundException({ code: 'SCREEN_NOT_FOUND', message: 'Screen not found' });

    const screen = (await this.prisma.client.screen.findFirst({
      where: isSuper ? { id: screenId } : { id: screenId, tenantId: callerTenantId as string },
      select: { id: true, tenantId: true, playerVersionCode: true, displayCapabilities: true },
    })) as { id: string; tenantId: string | null; playerVersionCode: number | null; displayCapabilities: any } | null;
    if (!screen || !screen.tenantId) throw new NotFoundException({ code: 'SCREEN_NOT_FOUND', message: 'Screen not found' });
    await assertSupportReach(req.user, screen.tenantId);
    const tenantId = screen.tenantId;

    const db = this.prisma.client as any;
    const rows: any[] = await db.screenFilePlayback.findMany({
      where: { screenId: screen.id, tenantId },
      orderBy: { lastAt: 'desc' },
      take: PLAYBACK_FILES_LIMIT,
    });
    const capsRow = await db.screenMediaCapabilities.findFirst({ where: { screenId: screen.id } });
    const declared = (capsRow?.report ?? null) as MediaCapsReport | null;

    const deviceClass: string | null =
      rows.find((r) => typeof r.deviceClass === 'string' && r.deviceClass)?.deviceClass ??
      playbackDeviceClass(screen.displayCapabilities?.build ?? null);

    // Evidence from OTHER screens of the same model, in any location. Only an
    // aggregate leaves this function (a size, a concurrency, a screen count) —
    // never a screen, file, name or tenant from another location.
    const classRows: any[] = deviceClass
      ? await db.screenFilePlayback.findMany({
          where: { deviceClass, screenId: { not: screen.id }, verdict: { in: ['smooth', 'stuttering'] } },
          select: { screenId: true, width: true, height: true, verdict: true, unitConcurrentMax: true, lastAt: true, playerVersionCode: true, webviewMajor: true },
          orderBy: { lastAt: 'desc' },
          take: PLAYBACK_CLASS_RECORDS_LIMIT,
        })
      : [];

    const toInput = (r: any): CapabilityRecordInput => ({
      screenId: r.screenId,
      width: r.width ?? null,
      height: r.height ?? null,
      verdict: r.verdict,
      unitConcurrentMax: Number(r.unitConcurrentMax ?? 1) || 1,
      lastAt: r.lastAt,
      playerVersionCode: r.playerVersionCode ?? null,
      webviewMajor: r.webviewMajor ?? null,
    });
    const currentWebview: number | null = rows[0]?.webviewMajor ?? capsRow?.webviewMajor ?? null;
    const capability = computePlaybackCapability({
      deviceClass,
      screenRecords: rows.map(toInput),
      classRecords: classRows.map(toInput),
      declared,
      current: { playerVersionCode: screen.playerVersionCode ?? null, webviewMajor: currentWebview },
    });

    const names = await this.resolveFiles(tenantId, rows.map((r) => String(r.fileSha256)));
    const files: ScreenFilePlaybackView[] = rows.map((r) => {
      const rec = recordFromRow(r);
      const hit = names.get(String(r.fileSha256));
      return {
        sha256: String(r.fileSha256),
        name: hit?.name ?? fileNameOf(r.fileUrl),
        assetId: hit?.assetId ?? null,
        copy: hit?.copy ?? null,
        verdict: rec.verdict,
        samples: rec.samples,
        settledSamples: rec.settledSamples,
        droppedPct: rec.settledSamples > 0 ? droppedPercent(rec.frames, rec.dropped) : null,
        worstPct: rec.worstPct,
        lastPct: rec.lastPct,
        width: rec.width,
        height: rec.height,
        engine: rec.engine,
        concurrentMax: rec.concurrentMax,
        unitConcurrentMax: rec.unitConcurrentMax,
        firstAt: isoOf(r.firstAt),
        lastAt: isoOf(r.lastAt),
      };
    });

    return {
      screenId: screen.id,
      summary: summarizeScreenPlayback(files.map((f) => f.verdict)),
      capability,
      declared: capsRow
        ? { reportedAt: isoOf(capsRow.reportedAt), maxShortEdge: declaredMaxShortEdge(declared), webviewMajor: capsRow.webviewMajor ?? null }
        : null,
      files,
    };
  }

  /** Digest → this location's asset (original file or its 1080p copy). Tenant-scoped both ways. */
  private async resolveFiles(
    tenantId: string,
    shas: string[],
  ): Promise<Map<string, { assetId: string; name: string; copy: 'original' | '1080p' }>> {
    const out = new Map<string, { assetId: string; name: string; copy: 'original' | '1080p' }>();
    if (shas.length === 0) return out;
    const originals: any[] = await this.prisma.client.asset.findMany({
      where: { tenantId, fileHash: { in: shas } },
      select: { id: true, originalName: true, fileUrl: true, fileHash: true },
    });
    for (const a of originals) {
      if (a.fileHash) out.set(String(a.fileHash).toLowerCase(), { assetId: a.id, name: a.originalName || fileNameOf(a.fileUrl), copy: 'original' });
    }
    const missing = shas.filter((s) => !out.has(s));
    if (missing.length === 0) return out;
    const renditions = await this.prisma.client.$queryRaw<Array<{ id: string; originalName: string | null; fileUrl: string; sha: string }>>`
      SELECT id, original_name AS "originalName", file_url AS "fileUrl",
             lower(processing_meta->'renditions'->'1080p'->>'sha256') AS sha
      FROM assets
      WHERE tenant_id = ${tenantId}
        AND lower(processing_meta->'renditions'->'1080p'->>'sha256') = ANY(${missing})`;
    for (const a of renditions) {
      if (a.sha && !out.has(a.sha)) out.set(a.sha, { assetId: a.id, name: a.originalName || fileNameOf(a.fileUrl), copy: '1080p' });
    }
    return out;
  }
}
