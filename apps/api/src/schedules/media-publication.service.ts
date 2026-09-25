/**
 * Publishing is an intent until every targeted decoder has a playable file.
 * A pending rule leaves the previous schedule active, then activates itself
 * from a durable database row after rendition jobs finish. The sweep also
 * resumes work after an API restart.
 */
import { HttpException, HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Asset, Prisma } from '@cms/database';
import { createHash, randomUUID } from 'crypto';
import { extname } from 'path';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
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
  ) {}

  private async ensureImageCopy(tenantId: string, asset: Asset): Promise<void> {
    const path = this.storage.extractPath(asset.fileUrl);
    if (!path?.startsWith(`${tenantId}/`) || this.storage.publicUrlForPath(path) !== asset.fileUrl) {
      throw new Error('This image cannot be optimized for the selected screen. Publishing was not started.');
    }
    const source = await this.storage.download(path);
    if (!source) throw new Error('The image could not be downloaded for optimization. Publishing was not started.');
    const actual = await sharp(source).metadata();
    if (actual.width && actual.height && Math.max(actual.width, actual.height) <= 1920 &&
        Math.min(actual.width, actual.height) <= 1080) return;
    const result = await this.mediaOpt.optimizeImageForUpload(source, asset.mimeType, extname(path), 1920);
    if (!result.optimized || !result.processedDimensions ||
        Math.max(result.processedDimensions.w, result.processedDimensions.h) > 1920) {
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
    const seenImages = new Set<string>();
    for (const asset of playlist.items.map((i) => i.asset)) {
      if (seenImages.has(asset.id)) continue;
      seenImages.add(asset.id);
      if (screens.some((screen) => needs1080ImageCopy(asset, screen.resolution))) {
        try {
          await this.ensureImageCopy(tenantId, asset);
        } catch (error) {
          this.logger.warn(`Image playback preparation failed for ${asset.id}: ${(error as Error).message}`);
          throw new HttpException({ code: 'IMAGE_PLAYBACK_COPY_FAILED',
            message: 'The 1080p image copy could not be prepared. The previous content remains on screen; please retry publishing.' },
          HttpStatus.SERVICE_UNAVAILABLE);
        }
      }
    }
    const waiting = playlist.items.map((i) => i.asset).filter((asset) =>
      screens.some((screen) => needs1080VideoCopy(asset, screen.resolution)),
    );
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

  /** Recheck every item and target; never activate on a failed/incomplete copy. */
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const pending = await this.prisma.client.schedule.findMany({
        where: { pendingMedia: true, isActive: false },
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
