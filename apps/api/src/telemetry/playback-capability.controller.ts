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
 * The GET enforces nothing. Since 2026-10-12 (steps 6/7, owner decision A) it
 * also lists the screen's active DEMOTIONS (files it plays the 1080p copy of
 * because it visibly stuttered on the original), and the POST beside it is
 * the operator's "Try full quality again". The demotion itself is made by the
 * closed loop (playback-demotion.service.ts), never here.
 * Emergency content is never evaluated here.
 *
 * Mounted under /api/v1/screens next to ScreensController / DisplayController;
 * the literal `playback-capability` segment collides with no existing route.
 * Screen-scoped people reach it through the `/screens/:id/**` rule (their own
 * screens only) — user-scope.policy.ts.
 */

import { Controller, Get, HttpCode, NotFoundException, Optional, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AppRole } from '@cms/database';
import {
  declaredMaxShortEdge,
  droppedPercent,
  summarizeScreenPlayback,
  type FilePlaybackVerdict,
  type PlaybackCapability,
  type ScreenPlaybackSummary,
} from '@cms/api-types';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { assertSupportReach } from '../support-access/support-access.context';
import { recordFromRow } from './file-playback';
import { loadPlaybackCapability, PLAYBACK_CLASS_GROUPS_LIMIT, PLAYBACK_FILES_LIMIT } from './playback-capability.loader';
import { PlaybackDemotionService } from './playback-demotion.service';

export { PLAYBACK_CLASS_GROUPS_LIMIT, PLAYBACK_FILES_LIMIT };

/** One active demotion: this screen plays a file's 1080p copy because it visibly stuttered on the original. */
export interface ScreenPlaybackDemotionView {
  id: string;
  sha256: string;
  assetId: string | null;
  /** The asset's name in this location's library, else null. */
  name: string | null;
  since: string;
}

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
  /** Files this screen was moved to the 1080p copy of (owner decision A). Empty for nearly every screen. */
  demotions: ScreenPlaybackDemotionView[];
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
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly demotions?: PlaybackDemotionService,
  ) {}

  /**
   * The screen, if the caller may reach it: the ACTIVE workspace plus its
   * direct, non-archived child locations — a SUPER_ADMIN included (support
   * access governs which workspace that is). 404 otherwise, never 403.
   */
  private async reachableScreen(screenId: string, req: any) {
    const callerTenantId: string | null = req.user?.tenantId || req.user?.schoolId || req.user?.districtId || null;
    if (!callerTenantId) throw new NotFoundException({ code: 'SCREEN_NOT_FOUND', message: 'Screen not found' });
    const children = await this.prisma.client.tenant.findMany({
      where: { parentId: callerTenantId, archivedAt: null },
      select: { id: true },
    });
    const readable = [callerTenantId, ...children.map((c) => c.id)];
    const screen = (await this.prisma.client.screen.findFirst({
      where: { id: screenId, tenantId: { in: readable } },
      select: { id: true, tenantId: true, playerVersionCode: true, displayCapabilities: true },
    })) as { id: string; tenantId: string | null; playerVersionCode: number | null; displayCapabilities: any } | null;
    if (!screen || !screen.tenantId) throw new NotFoundException({ code: 'SCREEN_NOT_FOUND', message: 'Screen not found' });
    await assertSupportReach(req.user, screen.tenantId);
    return screen as { id: string; tenantId: string; playerVersionCode: number | null; displayCapabilities: any };
  }

  /**
   * POST /api/v1/screens/:id/playback-demotions/:demotionId/clear — "Try full
   * quality again" (owner decision A). The screen goes back to the original
   * file under the same seamless rule (downloaded whole and verified before
   * it mounts, swapped at a natural boundary), and its visible-stutter streak
   * starts from zero. Admin roles only; tenant-scoped; audited
   * (VIDEO_PLAYBACK_DEMOTION_CLEARED).
   */
  @Post(':id/playback-demotions/:demotionId/clear')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async clearDemotion(
    @Param('id') screenId: string,
    @Param('demotionId') demotionId: string,
    @Req() req: any,
  ): Promise<{ cleared: true }> {
    const screen = await this.reachableScreen(screenId, req);
    const svc = this.demotions ?? new PlaybackDemotionService(this.prisma);
    await svc.clear({
      tenantId: screen.tenantId,
      screenId: screen.id,
      demotionId: String(demotionId ?? ''),
      userId: req.user?.userId ?? req.user?.id ?? null,
    });
    return { cleared: true };
  }

  @Get(':id/playback-capability')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  async get(@Param('id') screenId: string, @Req() req: any): Promise<ScreenPlaybackCapabilityResponse> {
    // Same reach as the drawer's other per-screen reads (ScreensController).
    const screen = await this.reachableScreen(screenId, req);
    const tenantId = screen.tenantId;

    // Same-model evidence from OTHER screens arrives as SQL aggregates only
    // (playback-capability.loader.ts) — never a foreign row.
    const { capability, rows, capsRow, declared } = await loadPlaybackCapability(this.prisma.client as any, screen);

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
      demotions: await this.demotionViews(screen.id, tenantId),
    };
  }

  /** Active demotions of this screen, named from this location's library. */
  private async demotionViews(screenId: string, tenantId: string): Promise<ScreenPlaybackDemotionView[]> {
    const svc = this.demotions ?? new PlaybackDemotionService(this.prisma);
    const active = await svc.listActive(screenId, tenantId);
    if (active.length === 0) return [];
    const ids = active.map((d) => d.assetId).filter((x): x is string => !!x);
    const assets: Array<{ id: string; originalName: string | null; fileUrl: string }> = ids.length
      ? await this.prisma.client.asset.findMany({
          where: { tenantId, id: { in: ids } },
          select: { id: true, originalName: true, fileUrl: true },
        })
      : [];
    const byId = new Map(assets.map((a) => [a.id, a] as const));
    return active.map((d) => {
      const a = d.assetId ? byId.get(d.assetId) : undefined;
      return {
        id: d.id,
        sha256: d.sourceSha256,
        assetId: a ? a.id : null,
        name: a ? a.originalName || fileNameOf(a.fileUrl) : null,
        since: isoOf(d.createdAt),
      };
    });
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
