/**
 * Publishing is an intent until every targeted decoder has a playable file.
 * A pending rule leaves the previous schedule active, then activates itself
 * from a durable database row after rendition jobs finish. The sweep also
 * resumes work after an API restart.
 */
import { HttpException, HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import type { Asset, Prisma } from '@cms/database';
import { createHash, randomUUID } from 'crypto';
import { extname } from 'path';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { LEASE, LeaderLeaseService, leadThisTick } from '../realtime/leader-lease.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { VideoTranscodeService } from '../storage/video-transcode/video-transcode.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { MediaOptimizationService } from '../storage/media-optimization.service';
import { displaceCompetingActiveSchedules } from './schedule-displacement';

const RESOLUTION = /^\s*(\d+)\s*[x×X*]\s*(\d+)\s*$/;

function isSmallScreen(resolution: string | null | undefined): boolean {
  const match = RESOLUTION.exec(resolution ?? '');
  return !!match && Math.max(Number(match[1]), Number(match[2])) <= 1920 &&
    Math.min(Number(match[1]), Number(match[2])) <= 1080;
}

function primarySize(asset: Pick<Asset, 'processingMeta'>): { width: number; height: number } | null {
  const meta = asset.processingMeta as Record<string, any> | null;
  const dims = meta?.processedDimensions ?? meta?.originalDimensions;
  const width = Number(dims?.w ?? meta?.probe?.codedWidth);
  const height = Number(dims?.h ?? meta?.probe?.codedHeight);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height } : null;
}

/** An unknown video size is prepared first; it must never silently claim fit. */
export function needs1080VideoCopy(asset: Pick<Asset, 'mimeType' | 'processingMeta'>, resolution: string | null | undefined): boolean {
  if (!isSmallScreen(resolution) || !asset.mimeType?.startsWith('video/')) return false;
  const size = primarySize(asset);
  if (size && Math.max(size.width, size.height) <= 1920 && Math.min(size.width, size.height) <= 1080) return false;
  const meta = asset.processingMeta as Record<string, any> | null;
  const rendition = meta?.renditions?.['1080p'];
  return !(typeof rendition?.url === 'string' && /^https:\/\//.test(rendition.url) &&
    typeof rendition?.sha256 === 'string' && /^[0-9a-f]{64}$/.test(rendition.sha256) &&
    Number.isSafeInteger(rendition.size) && rendition.size > 0);
}

export function needs1080ImageCopy(asset: Pick<Asset, 'mimeType' | 'processingMeta'>, resolution: string | null | undefined): boolean {
  if (!isSmallScreen(resolution) || !['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(asset.mimeType?.toLowerCase() ?? '')) return false;
  const size = primarySize(asset);
  if (size && Math.max(size.width, size.height) <= 1920 && Math.min(size.width, size.height) <= 1080) return false;
  const rendition = (asset.processingMeta as Record<string, any> | null)?.renditions?.['1080p'];
  return !(typeof rendition?.url === 'string' && /^https:\/\//.test(rendition.url) &&
    typeof rendition?.sha256 === 'string' && /^[0-9a-f]{64}$/.test(rendition.sha256) &&
    Number.isSafeInteger(rendition.size) && rendition.size > 0);
}

/**
 * The facts about a FILE that decide what a screen may play: its size and its
 * 1080p copy. A fleet copy (PlaylistDistributionService.ensureChildAsset) is a
 * row in the child location that serves the source location's file — same
 * `fileUrl`, no re-upload — so these facts belong to the file, not the row,
 * and the copy may adopt them from the row that owns the file. Nothing else
 * crosses: no poster, no remux history, no grading the child did not run.
 */
export function playbackFacts(meta: unknown): Record<string, unknown> | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const m = meta as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ['originalDimensions', 'processedDimensions', 'probe'] as const) {
    if (m[key] && typeof m[key] === 'object') out[key] = m[key];
  }
  const rendition = (m.renditions as Record<string, unknown> | undefined)?.['1080p'];
  if (rendition && typeof rendition === 'object') out.renditions = { '1080p': rendition };
  return Object.keys(out).length ? out : null;
}

/** A rule an activation door is about to switch on. */
export interface RuleTarget {
  id: string;
  screenId: string | null;
  screenGroupId: string | null;
}

@Injectable()
export class MediaPublicationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaPublicationService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private sweeping = false;
  private lastLegacyBackfillAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: VideoTranscodeService,
    private readonly redis: RedisService,
    private readonly signer: WebsocketSignerService,
    private readonly storage: SupabaseStorageService,
    private readonly mediaOpt: MediaOptimizationService,
    @Optional() private readonly lease?: LeaderLeaseService,
  ) {}

  /**
   * The tenant whose folder holds this file: every server-generated upload
   * path starts with the uploading tenant's id, and a fleet copy points at the
   * SOURCE tenant's path verbatim. Null for anything that is not our storage.
   */
  private fileOwner(fileUrl: string): { path: string; owner: string } | null {
    const path = this.storage.extractPath(fileUrl);
    const owner = path?.split('/')[0];
    return path && owner ? { path, owner } : null;
  }

  /**
   * A fleet copy adopts the file owner's playback facts (`playbackFacts`) before
   * anything is queued for it. Without this a copy of a 1080p video reads as
   * "unknown size", is sent to an encoder that rightly answers `already-optimal`
   * with no copy to make, and the rule is stamped failed; and a copy of a 4K
   * video whose owner already carries a 1080p rendition would be encoded a
   * second time per location. Owner → copy only, guarded by the copy's own
   * fileUrl; a copy's metadata is never written back to the owner.
   */
  private async adoptOwnerPlaybackFacts(tenantId: string, asset: Asset): Promise<Asset> {
    const file = this.fileOwner(asset.fileUrl);
    if (!file || file.owner === tenantId) return asset;
    const source = await this.prisma.client.asset.findFirst({
      where: { tenantId: file.owner, fileUrl: asset.fileUrl },
      select: { processingMeta: true },
    });
    const facts = playbackFacts(source?.processingMeta);
    if (!facts) return asset;
    const own = asset.processingMeta && typeof asset.processingMeta === 'object' && !Array.isArray(asset.processingMeta)
      ? asset.processingMeta as Record<string, unknown> : {};
    const merged = { ...own, ...facts };
    const updated = await this.prisma.client.asset.updateMany({
      where: { id: asset.id, tenantId, fileUrl: asset.fileUrl },
      data: { processingMeta: merged as Prisma.InputJsonObject },
    });
    return updated.count ? { ...asset, processingMeta: merged as Prisma.JsonValue } : asset;
  }

  private async ensureImageCopy(tenantId: string, asset: Asset): Promise<void> {
    const file = this.fileOwner(asset.fileUrl);
    if (!file || this.storage.publicUrlForPath(file.path) !== asset.fileUrl) {
      throw new Error('This image cannot be optimized for the selected screen. Publishing was not started.');
    }
    if (file.owner !== tenantId) {
      // A file outside this tenant's folder is readable here ONLY when it is a
      // fleet copy: the owner's own row must still serve exactly this URL
      // (that is how ensureChildAsset built the copy). The 1080p copy is then
      // written under THIS tenant's folder, never the owner's.
      const shared = await this.prisma.client.asset.findFirst({
        where: { tenantId: file.owner, fileUrl: asset.fileUrl },
        select: { id: true },
      });
      if (!shared) throw new Error('This image cannot be optimized for the selected screen. Publishing was not started.');
    }
    const path = file.path;
    const source = await this.storage.download(path);
    if (!source) throw new Error('The image could not be downloaded for optimization. Publishing was not started.');
    const actual = await sharp(source).metadata();
    if (actual.width && actual.height && Math.max(actual.width, actual.height) <= 1920 &&
        Math.min(actual.width, actual.height) <= 1080) return;
    const result = await this.mediaOpt.optimizeImageForUpload(source, asset.mimeType, extname(path), 1920, 1080);
    if (!result.optimized || !result.processedDimensions ||
        Math.max(result.processedDimensions.w, result.processedDimensions.h) > 1920 ||
        Math.min(result.processedDimensions.w, result.processedDimensions.h) > 1080) {
      throw new Error('The 1080p image copy could not be prepared. Publishing was not started.');
    }
    const outputPath = `${tenantId}/optimized/renditions/${randomUUID()}${result.ext}`;
    const sha256 = createHash('sha256').update(result.buffer).digest('hex');
    try {
      await this.storage.upload(outputPath, result.buffer, result.mimeType);
      const rendition = {
        url: this.storage.publicUrlForPath(outputPath), sha256, size: result.buffer.length,
        width: result.processedDimensions.w, height: result.processedDimensions.h,
      };
      await this.prisma.client.$transaction(async (tx) => {
        const updated = await tx.asset.updateMany({
          where: { id: asset.id, tenantId, fileUrl: asset.fileUrl,
            playlistItems: { none: { playlist: { isProtected: true } } } },
          data: { processingMeta: {
            ...(asset.processingMeta && typeof asset.processingMeta === 'object' && !Array.isArray(asset.processingMeta)
              ? asset.processingMeta as Record<string, any> : {}),
            renditions: { ...((asset.processingMeta as Record<string, any> | null)?.renditions ?? {}), '1080p': rendition },
          } as Prisma.InputJsonObject },
        });
        if (!updated.count) throw new Error('The image changed during optimization. Publishing was not started.');
        await tx.auditLog.create({ data: {
          tenantId, userId: null, action: 'IMAGE_PLAYBACK_RENDITION_CREATED',
          targetType: 'Asset', targetId: asset.id,
          details: JSON.stringify({ size: rendition.size, width: rendition.width, height: rendition.height }),
        } });
      });
    } catch (error) {
      await this.storage.delete(outputPath).catch(() => undefined);
      throw error;
    }
  }

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.sweep(), 15_000);
    this.timer.unref?.();
    void this.sweep();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** A finished rendition should reach an already-playing legacy schedule now, not at the next 15-minute scan. */
  renditionReady(): void {
    this.lastLegacyBackfillAt = 0;
    void this.sweep();
  }

  /** Queue only the assets that selected screens cannot decode at native size. */
  async prepare(tenantId: string, playlistId: string, screenId?: string | null, groupId?: string | null): Promise<boolean> {
    const [playlist, screens] = await Promise.all([
      this.prisma.client.playlist.findFirst({
        where: { id: playlistId, tenantId },
        include: { items: { include: { asset: true } } },
      }),
      this.prisma.client.screen.findMany({
        where: { tenantId, OR: [
          ...(screenId ? [{ id: screenId }] : []),
          ...(groupId ? [{ screenGroupId: groupId }] : []),
        ] },
        select: { resolution: true },
      }),
    ]);
    if (!playlist || screens.length === 0) return false;
    const needsImage = (asset: Asset) => screens.some((screen) => needs1080ImageCopy(asset, screen.resolution));
    const needsVideo = (asset: Asset) => screens.some((screen) => needs1080VideoCopy(asset, screen.resolution));
    // Each asset once, however many times the playlist repeats it.
    const assets = new Map(playlist.items.map((i) => [i.asset.id, i.asset] as const));
    const waiting: Asset[] = [];
    for (let asset of assets.values()) {
      if (!needsImage(asset) && !needsVideo(asset)) continue;
      asset = await this.adoptOwnerPlaybackFacts(tenantId, asset);
      if (needsImage(asset)) {
        try {
          await this.ensureImageCopy(tenantId, asset);
        } catch (error) {
          this.logger.warn(`Image playback preparation failed for ${asset.id}: ${(error as Error).message}`);
          throw new HttpException({ code: 'IMAGE_PLAYBACK_COPY_FAILED',
            message: 'The 1080p image copy could not be prepared. The previous content remains on screen; please retry publishing.' },
          HttpStatus.SERVICE_UNAVAILABLE);
        }
      }
      if (needsVideo(asset)) waiting.push(asset);
    }
    for (const asset of waiting) {
      const queued = await this.jobs.enqueueForRendition({
        tenantId, assetId: asset.id, sourceUrl: asset.fileUrl, sourceBytes: asset.fileSize,
      });
      if (!queued) throw new HttpException({ code: 'VIDEO_PLAYBACK_COPY_QUEUE_FAILED',
        message: 'The 1080p video copy could not be queued. The previous content remains on screen; please retry publishing.' },
      HttpStatus.SERVICE_UNAVAILABLE);
    }
    return waiting.length > 0;
  }

  /**
   * The rules an activation door is about to switch on, answered one by one:
   * the ids that must wait for a playback copy. Every path that makes a
   * Schedule row active goes through this (or `prepare`) first — the
   * "Play everywhere" button, the per-screen switch and the fleet publish
   * used to switch rules straight on, which is how a paused 1080p screen was
   * handed the 4K original again (2026-09-26).
   */
  async prepareRules(tenantId: string, playlistId: string, rules: RuleTarget[]): Promise<Set<string>> {
    const waiting = new Set<string>();
    for (const rule of rules) {
      if (await this.prepare(tenantId, playlistId, rule.screenId, rule.screenGroupId)) waiting.add(rule.id);
    }
    return waiting;
  }

  /** Recheck every item and target; never activate on a failed/incomplete copy. */
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      // Multi-replica (2026-09-26): one sweeper. Every write below is
      // claim-guarded (updateMany on pendingMedia / pendingRefreshAt), so a
      // second replica would be safe but wasteful — it would scan the same
      // rows every 15 s and re-queue the same rendition jobs. A replica that
      // cannot reach Redis leads, degraded, per the standing rule.
      const lease = await leadThisTick(this.lease, LEASE.MEDIA_PUBLICATION_SWEEP);
      if (!lease.leader) return;
      // A row already stamped with an error is inert: only a fresh publish (a
      // new row) may go live for that playlist. Re-selecting stamped rows every
      // tick let 50 platform-wide failures crowd every newer rule out of this
      // `take` forever (review finding P1-6), and a stale row that activated
      // months later would displace whatever the operator published since.
      const pending = await this.prisma.client.schedule.findMany({
        where: { pendingMedia: true, isActive: false, pendingMediaError: null },
        take: 50,
        orderBy: { startTime: 'asc' },
        include: {
          playlist: { include: { items: { include: { asset: true } } } },
          screen: { select: { resolution: true } },
          screenGroup: { include: { screens: { select: { resolution: true } } } },
        },
      });
      for (const rule of pending) {
        const targetResolutions = rule.screen
          ? [rule.screen.resolution] : rule.screenGroup?.screens.map((s) => s.resolution) ?? [];
        const waiting = rule.playlist.items.map((i) => i.asset).filter((asset) =>
          targetResolutions.some((r) => needs1080VideoCopy(asset, r)));
        if (waiting.length) {
          const jobs = await this.prisma.client.videoTranscodeJob.findMany({
            where: { tenantId: rule.tenantId, assetId: { in: waiting.map((asset) => asset.id) } },
            select: { assetId: true, status: true, reason: true },
          });
          const failed = jobs.find((job) => ['failed', 'skipped', 'done'].includes(job.status));
          if (failed && !rule.pendingMediaError) {
            await this.prisma.client.schedule.updateMany({
              where: { id: rule.id, tenantId: rule.tenantId, pendingMedia: true },
              data: { pendingMediaError: 'A playback copy could not be prepared. Retry publishing this playlist.' },
            });
          }
          continue;
        }
        const activated = await this.prisma.client.$transaction(async (tx) => {
          const claim = await tx.schedule.updateMany({
            where: { id: rule.id, tenantId: rule.tenantId, pendingMedia: true, isActive: false },
            data: { pendingMedia: false, pendingMediaError: null },
          });
          if (!claim.count) return false;
          if (rule.mode !== 'append') {
            await displaceCompetingActiveSchedules(tx, {
              tenantId: rule.tenantId,
              screenId: rule.screenId,
              screenGroupId: rule.screenGroupId,
              incoming: {
                daysOfWeek: rule.daysOfWeek,
                timeStart: rule.timeStart,
                timeEnd: rule.timeEnd,
                priority: rule.priority,
              },
            });
          }
          await tx.schedule.update({ where: { id: rule.id, tenantId: rule.tenantId }, data: { isActive: true } });
          await tx.auditLog.create({
            data: {
              tenantId: rule.tenantId,
              userId: null,
              action: 'SCHEDULE_MEDIA_READY_PUBLISHED',
              targetType: 'Schedule',
              targetId: rule.id,
              details: JSON.stringify({ playlistId: rule.playlistId, screenId: rule.screenId, screenGroupId: rule.screenGroupId }),
            },
          });
          return true;
        });
        if (activated) {
          const signed = this.signer.signMessage('SYNC', { source: 'media_ready' });
          await this.redis.publish(`tenant:${rule.tenantId}`, signed);
        }
      }
      if (Date.now() - this.lastLegacyBackfillAt < 15 * 60_000) return;
      this.lastLegacyBackfillAt = Date.now();
      // An older live schedule may predate renditions. Queue its playback
      // copy without interrupting the current content; the manifest switches
      // URL as soon as the rendition is ready.
      const active = await this.prisma.client.schedule.findMany({
        where: { isActive: true, pendingMedia: false },
        take: 100,
        orderBy: { startTime: 'desc' },
        include: {
          playlist: { include: { items: { include: { asset: true } } } },
          screen: { select: { id: true, resolution: true, lastVideoReport: true, lastVideoReportAt: true, pendingRefreshAt: true } },
          screenGroup: { include: { screens: { select: { id: true, resolution: true, lastVideoReport: true, lastVideoReportAt: true, pendingRefreshAt: true } } } },
        },
      });
      for (const rule of active) {
        const targets = rule.screen ? [rule.screen] : rule.screenGroup?.screens ?? [];
        const targetResolutions = targets.map((s) => s.resolution);
        for (const asset of rule.playlist.items.map((i) => i.asset)) {
          if (targetResolutions.some((r) => needs1080VideoCopy(asset, r))) {
            const existing = await this.prisma.client.videoTranscodeJob.findFirst({
              where: { tenantId: rule.tenantId, assetId: asset.id },
              select: { status: true, reason: true },
            });
            // A completed legacy transcode is the only terminal job to upgrade.
            // A failed/unsupported attempt must not loop forever every sweep.
            if (!existing || (existing.status === 'done' && existing.reason !== 'rendition-created')) {
              await this.jobs.enqueueForRendition({
                tenantId: rule.tenantId, assetId: asset.id,
                sourceUrl: asset.fileUrl, sourceBytes: asset.fileSize,
              });
            }
            continue;
          }
          if (!asset.mimeType?.startsWith('video/') ||
              !(asset.processingMeta as Record<string, any> | null)?.renditions?.['1080p']) continue;
          for (const screen of targets) {
            const report = screen.lastVideoReport as Record<string, any> | null;
            // Only the screen that is demonstrably still decoding this 4K source
            // needs a reload. A new player applies the manifest URL itself.
            if (!isSmallScreen(screen.resolution) || screen.pendingRefreshAt ||
                report?.url !== asset.fileUrl ||
                !screen.lastVideoReportAt ||
                Date.now() - new Date(screen.lastVideoReportAt).getTime() > 2 * 60_000) continue;
            const value = new Date();
            const refreshed = await this.prisma.client.$transaction(async (tx) => {
              const claimed = await tx.screen.updateMany({
                where: { id: screen.id, tenantId: rule.tenantId, pendingRefreshAt: null },
                data: { pendingRefreshAt: value },
              });
              if (!claimed.count) return false;
              await tx.auditLog.create({ data: {
                tenantId: rule.tenantId, userId: null, action: 'AUTO_MEDIA_RENDITION_REFRESH',
                targetType: 'Screen', targetId: screen.id,
                details: JSON.stringify({ assetId: asset.id, playlistId: rule.playlistId, refreshRequestedAt: value.toISOString() }),
              } });
              return true;
            });
            if (refreshed) {
              const signed = this.signer.signMessage('REFRESH_WEB', {
                scope: 'screen', scopeId: screen.id, tenantId: rule.tenantId,
                jitterMs: 0, source: 'media_rendition_ready',
              });
              await this.redis.publish(`tenant:${rule.tenantId}`, signed);
            }
          }
        }
      }
    } catch (error) {
      this.logger.warn(`Pending media publication sweep failed: ${(error as Error).message}`);
    } finally {
      this.sweeping = false;
    }
  }
}
