/**
 * The video guarantee's CLOSED LOOP (steps 6/7, 2026-10-12;
 * docs/research/2026-10-11-launch-readiness/02-video-guarantee.md §4.7).
 *
 * Owner decisions (Greg, binding 2026-10-12):
 *   A — a screen that PROVES visible stutter on a fully cached original is
 *       moved, sticky + audited, to that file's validated 1080p copy. An
 *       operator can "Try full quality again" (`clear`).
 *   B — a double-sided unit is never demoted; its stutter is recorded.
 *   C — stutter with no lighter copy keeps playing and alerts ops: an in-app
 *       notification for the location and a platform-owner log line + email,
 *       once per screen × file per day. Never a blank screen.
 *
 * "Visible" (Greg, 2026-10-12): a settled sample played from the verified
 * cache that dropped ≥ 5 % of its frames or froze ≥ 250 ms is BAD; three BAD
 * samples in a row of the same file on the same screen demote; one GOOD sample
 * resets the streak; start-up / short / uncached samples never count
 * (`classifyVisibleStutterSample`, env-tunable — `VIDEO_DEMOTION_*`).
 *
 * Seamless by construction: a demotion only changes WHICH URL the manifest
 * names for that item. The web player never mounts the new URL until the
 * whole file is on disk and hash-verified (rule 17 readiness gate), keeps the
 * original playing meanwhile, and swaps at a natural boundary — an item change
 * or the loop wrap — never mid-play and never with a reload (renditionSwap.ts).
 * No REFRESH_WEB is ever sent from here; the SYNC below only asks the screen
 * to re-read its manifest sooner.
 *
 * Emergency content is never demoted, alerted on or otherwise touched: the
 * shared fail-closed check (`emergencyContentUse`) runs before any action,
 * and a check that cannot run counts as "emergency".
 *
 * `VIDEO_PLAYBACK_DEMOTION`: `on` (default) | `observe` (log what would be
 * demoted) | `off`.
 *
 * Best-effort throughout: the caller (the telemetry POST) wraps `evaluate` in
 * try/catch, so nothing here can turn a healthy report into a 500.
 */
import { HttpException, HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import {
  decideStutterAction,
  playbackDemotionMode,
  visibleStutterThresholds,
  type StutterAction,
  type VisibleSampleClass,
} from '@cms/api-types';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlatformAlertMailer } from '../email/platform-alert-mailer.service';
import { emergencyContentUse } from '../emergency/emergency-content-use';
import { valid1080pRendition } from '../screens/video-rendition';
import { ScreenEventsService } from '../screens/events/screen-events.service';

/** Ops hear about one screen × file at most this often (owner decision C). */
export const STUTTER_ALERT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const VIDEO_PLAYBACK_DEMOTED = 'VIDEO_PLAYBACK_DEMOTED';
export const VIDEO_PLAYBACK_DEMOTION_CLEARED = 'VIDEO_PLAYBACK_DEMOTION_CLEARED';
export const VIDEO_PLAYBACK_STUTTER_UNRESOLVED = 'VIDEO_PLAYBACK_STUTTER_UNRESOLVED';
export const VIDEO_PLAYBACK_STUTTER_TWO_SIDED = 'VIDEO_PLAYBACK_STUTTER_TWO_SIDED';

export interface StutterEvaluationInput {
  screenId: string;
  tenantId: string;
  /** Digest of the file the screen played (the sample's `sha256`). */
  sha256: string;
  fileUrl: string;
  /** The sample's class under the visible-stutter rule, and the streak after it. */
  sampleClass: VisibleSampleClass;
  visibleBadStreak: number;
  /** Videos the unit was decoding at once during this file's evidence. */
  unitConcurrentMax: number;
  /** Settled-aggregate dropped share and samples, for the audit evidence. */
  lastPct: number | null;
  settledSamples: number;
  /**
   * Why the sample was recorded without grading (2026-10-17 sample guard):
   * a page load, engine change, hand-off or player update, or a browser
   * sample of a file the hardware engine owns. Such a sample never acts.
   */
  excludedReason?: string | null;
  now: Date;
}

const fileNameOf = (url: string | null | undefined): string => {
  const raw = typeof url === 'string' ? url.split('?')[0].split('#')[0] : '';
  const last = raw.split('/').filter(Boolean).pop() ?? '';
  try {
    return decodeURIComponent(last) || 'video';
  } catch {
    return last || 'video';
  }
};

@Injectable()
export class PlaybackDemotionService {
  private readonly logger = new Logger(PlaybackDemotionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly signer?: WebsocketSignerService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly mailer?: PlatformAlertMailer,
    // Interruption ledger (2026-10-18): a demotion, and the switch back an
    // operator asks for. Optional: hand-built specs record nothing.
    @Optional() private readonly ledger?: ScreenEventsService,
  ) {}

  private get db(): any {
    return this.prisma.client as any;
  }

  /** Ask ONE screen to re-read its manifest now (signed). Never a reload. */
  private async syncScreen(screenId: string): Promise<void> {
    if (!this.signer || !this.redis) return;
    try {
      const signed = this.signer.signMessage('SYNC', { source: 'video_playback_rung', screenId });
      await this.redis.publish(`device:${screenId}`, signed);
    } catch {
      /* the manifest poll converges anyway */
    }
  }

  /**
   * After one sample has been folded: act when the visible-stutter streak has
   * reached the threshold. Returns the action taken (tests, logs).
   */
  async evaluate(input: StutterEvaluationInput): Promise<StutterAction> {
    const th = visibleStutterThresholds(process.env);
    // A demotion is decided only on samples from the engine the screen is
    // supposed to be on, outside any warm-up (2026-10-17). Ingest already
    // classes such a sample `ignored`; this is the second lock.
    if (input.excludedReason) return { kind: 'none', why: 'excluded-sample' };
    // Only a BAD sample can start an action; GOOD/ignored ones only move the streak.
    if (input.sampleClass !== 'bad' || input.visibleBadStreak < th.streak) {
      return { kind: 'none', why: 'below-threshold' };
    }
    const { screenId, tenantId, sha256: sha } = input;

    const screen = await this.db.screen.findFirst({
      where: { id: screenId, tenantId },
      select: { id: true, name: true, faceOfScreenId: true },
    });
    if (!screen) return { kind: 'none', why: 'below-threshold' };
    const faces = screen.faceOfScreenId
      ? 1
      : await this.db.screen.count({ where: { faceOfScreenId: screenId, tenantId } });
    const twoSided = !!screen.faceOfScreenId || faces > 0;

    // Which copy did the screen play? This location's library only.
    let served: 'original' | '1080p' | 'unknown' = 'unknown';
    let asset: any = await this.db.asset.findFirst({
      where: { tenantId, fileHash: sha },
      select: { id: true, originalName: true, fileUrl: true, fileHash: true, fileSize: true, mimeType: true, processingMeta: true },
    });
    if (asset) {
      served = 'original';
    } else {
      const rows = await this.db.$queryRaw`
        SELECT id FROM assets
        WHERE tenant_id = ${tenantId}
          AND lower(processing_meta->'renditions'->'1080p'->>'sha256') = ${sha}
        LIMIT 1`;
      const id = Array.isArray(rows) && rows[0]?.id ? String(rows[0].id) : null;
      if (id) {
        asset = await this.db.asset.findFirst({
          where: { id, tenantId },
          select: { id: true, originalName: true, fileUrl: true, fileHash: true, fileSize: true, mimeType: true, processingMeta: true },
        });
        if (asset) served = '1080p';
      }
    }

    // Emergency content: never touched (fail-closed — an error is "emergency").
    const emergency = asset ? (await emergencyContentUse(this.db, asset.id, asset.fileUrl)) !== null : false;

    const copy = asset ? valid1080pRendition(asset.processingMeta) : null;
    const hasLighterCopy =
      served === 'original' &&
      !!copy &&
      copy.sha256 !== sha &&
      (typeof asset.fileSize !== 'number' || typeof copy.size !== 'number' || copy.size < asset.fileSize);

    const alreadyDemoted = served === 'original'
      ? !!(await this.db.screenPlaybackDemotion.findFirst({
          where: { screenId, tenantId, sourceSha256: sha, clearedAt: null },
          select: { id: true },
        }))
      : false;

    const action = decideStutterAction({
      streak: input.visibleBadStreak,
      threshold: th.streak,
      mode: playbackDemotionMode(process.env),
      emergency,
      twoSided,
      unitConcurrent: Math.max(1, input.unitConcurrentMax || 1),
      served,
      hasLighterCopy,
      alreadyDemoted,
    });

    const fileName: string = asset?.originalName || fileNameOf(asset?.fileUrl ?? input.fileUrl);
    const screenName: string = screen.name || 'A screen';
    const evidence = {
      streak: input.visibleBadStreak,
      lastPct: input.lastPct,
      settledSamples: input.settledSamples,
      unitConcurrentMax: input.unitConcurrentMax,
      thresholds: th,
    };

    if (action.kind === 'demote') {
      const created = await this.createDemotion({ tenantId, screenId, sha, assetId: asset.id, evidence });
      if (created) {
        this.logger.warn(
          `[video-demotion] DEMOTED screen=${screenId} asset=${asset.id} → 1080p copy after ${input.visibleBadStreak} visibly stuttering minutes (last ${input.lastPct ?? '?'}% dropped)`,
        );
        await this.ledger?.record({
          screenId,
          tenantId,
          kind: 'demotion',
          cause: 'visible-stutter',
          source: 'system',
          detail: { assetId: asset.id, from: 'original', to: '1080p', streak: input.visibleBadStreak, lastPct: input.lastPct },
          dedupKey: `demotion:${sha}`,
        });
        await this.syncScreen(screenId);
      }
      return action;
    }
    if (action.kind === 'observe') {
      this.logger.warn(
        `[video-demotion] OBSERVE — would demote screen=${screenId} asset=${asset?.id ?? '?'} to its 1080p copy (VIDEO_PLAYBACK_DEMOTION=observe)`,
      );
      return action;
    }
    if (action.kind === 'record-two-sided' || action.kind === 'alert') {
      if (!(await this.claimAlert(screenId, tenantId, sha, input.now))) return action;
      const reason = action.kind === 'alert' ? action.reason : 'two-sided';
      try {
        await this.db.auditLog.create({
          data: {
            tenantId,
            userId: null,
            action: action.kind === 'alert' ? VIDEO_PLAYBACK_STUTTER_UNRESOLVED : VIDEO_PLAYBACK_STUTTER_TWO_SIDED,
            targetType: 'Screen',
            targetId: screenId,
            details: JSON.stringify({ assetId: asset?.id ?? null, sha256: sha, reason, ...evidence }),
          },
        });
      } catch {
        /* the log line below still records it */
      }
      if (action.kind === 'record-two-sided') {
        // Owner decision B: recorded only — the unit must eventually play any
        // combination natively; no demotion, no poster fallback, no page.
        this.logger.warn(`[video-stutter] two-sided unit screen=${screenId} stutters on ${asset?.id ?? sha.slice(0, 12)} — recorded, not demoted`);
        return action;
      }
      const sentence = action.reason === 'concurrency'
        ? `“${screenName}” stutters on “${fileName}” while it plays more than one video at once. It keeps playing; a lighter copy would not fix this.`
        : `“${screenName}” stutters on “${fileName}” and there is no lighter copy to switch it to. It keeps playing.`;
      this.logger.warn(`[video-stutter] PLATFORM — ${sentence} (tenant=${tenantId} screen=${screenId} reason=${action.reason})`);
      const day = input.now.toISOString().slice(0, 10);
      await this.notifications?.notify({
        tenantId,
        kind: 'INFO',
        title: `Video stutters on ${screenName}`,
        body: sentence,
        link: '/screens',
        dedupeKey: `video-stutter:${screenId}:${sha}:${day}`,
      });
      try {
        await this.mailer?.sendAlert(
          `[VenueOS] Video stutters with no fix — ${screenName}`,
          `${sentence}\n\nTenant: ${tenantId}\nScreen: ${screenId}\nFile digest: ${sha}\nReason: ${action.reason}\nEvidence: ${JSON.stringify(evidence)}`,
          'video-stutter',
        );
      } catch {
        /* mailer never throws by contract; belt and braces */
      }
      return action;
    }
    return action;
  }

  /** Once per screen × file per day (owner decision C) — an atomic claim on the evidence row. */
  private async claimAlert(screenId: string, tenantId: string, sha: string, now: Date): Promise<boolean> {
    try {
      const claimed = await this.db.screenFilePlayback.updateMany({
        where: {
          screenId,
          tenantId,
          fileSha256: sha,
          OR: [{ stutterAlertedAt: null }, { stutterAlertedAt: { lt: new Date(now.getTime() - STUTTER_ALERT_INTERVAL_MS) } }],
        },
        data: { stutterAlertedAt: now },
      });
      return (claimed?.count ?? 0) > 0;
    } catch {
      return false;
    }
  }

  /** The demotion row + its audit row, atomically. False when one is already active (sticky). */
  private async createDemotion(args: { tenantId: string; screenId: string; sha: string; assetId: string; evidence: Record<string, unknown> }): Promise<boolean> {
    try {
      await this.prisma.client.$transaction(async (tx: any) => {
        const row = await tx.screenPlaybackDemotion.create({
          data: {
            tenantId: args.tenantId,
            screenId: args.screenId,
            sourceSha256: args.sha,
            assetId: args.assetId,
            fromRung: 'native',
            toRung: '1080p',
            reason: 'visible-stutter',
            evidence: args.evidence as any,
          },
          select: { id: true },
        });
        await tx.auditLog.create({
          data: {
            tenantId: args.tenantId,
            userId: null,
            action: VIDEO_PLAYBACK_DEMOTED,
            targetType: 'Screen',
            targetId: args.screenId,
            details: JSON.stringify({ demotionId: row.id, assetId: args.assetId, sha256: args.sha, from: 'native', to: '1080p', ...args.evidence }),
          },
        });
      });
      return true;
    } catch (err: any) {
      // P2002: the partial unique index — a demotion is already active.
      if (err?.code !== 'P2002') this.logger.warn(`[video-demotion] could not record a demotion for ${args.screenId}: ${err?.message ?? err}`);
      return false;
    }
  }

  /** The active demotions of one screen (tenant-scoped), newest first. */
  async listActive(screenId: string, tenantId: string): Promise<Array<{ id: string; sourceSha256: string; assetId: string | null; createdAt: Date }>> {
    try {
      return await this.db.screenPlaybackDemotion.findMany({
        where: { screenId, tenantId, clearedAt: null },
        select: { id: true, sourceSha256: true, assetId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    } catch {
      return [];
    }
  }

  /**
   * "Try full quality again": clear one active demotion. The screen goes back
   * to the original under the same seamless rule (downloaded whole, verified,
   * swapped at a boundary), and the visible-stutter streak starts from zero,
   * so three fresh BAD minutes are needed to demote again. Audited.
   */
  async clear(args: { tenantId: string; screenId: string; demotionId: string; userId: string | null }): Promise<{ cleared: true; sourceSha256: string }> {
    const row = await this.db.screenPlaybackDemotion.findFirst({
      where: { id: args.demotionId, screenId: args.screenId, tenantId: args.tenantId, clearedAt: null },
      select: { id: true, sourceSha256: true, assetId: true },
    });
    if (!row) throw new HttpException({ code: 'PLAYBACK_DEMOTION_NOT_FOUND', message: 'Nothing to undo for this screen.' }, HttpStatus.NOT_FOUND);
    const now = new Date();
    const done = await this.prisma.client.$transaction(async (tx: any) => {
      const upd = await tx.screenPlaybackDemotion.updateMany({
        where: { id: row.id, screenId: args.screenId, tenantId: args.tenantId, clearedAt: null },
        data: { clearedAt: now, clearedByUserId: args.userId },
      });
      if (!upd.count) return false;
      await tx.screenFilePlayback.updateMany({
        where: { screenId: args.screenId, tenantId: args.tenantId, fileSha256: row.sourceSha256 },
        data: { visibleBadStreak: 0, consecutiveBad: 0, stutterAlertedAt: null },
      });
      await tx.auditLog.create({
        data: {
          tenantId: args.tenantId,
          userId: args.userId,
          action: VIDEO_PLAYBACK_DEMOTION_CLEARED,
          targetType: 'Screen',
          targetId: args.screenId,
          details: JSON.stringify({ demotionId: row.id, assetId: row.assetId, sha256: row.sourceSha256 }),
        },
      });
      return true;
    });
    if (!done) throw new HttpException({ code: 'PLAYBACK_DEMOTION_NOT_FOUND', message: 'Nothing to undo for this screen.' }, HttpStatus.NOT_FOUND);
    // The manifest names the original again; the screen swaps back at a
    // natural boundary once the file is on disk (renditionSwap.ts).
    await this.ledger?.record({
      screenId: args.screenId,
      tenantId: args.tenantId,
      kind: 'rendition-swap',
      cause: 'demotion-cleared',
      source: 'operator',
      detail: { demotionId: row.id, assetId: row.assetId, from: '1080p', to: 'original' },
      dedupKey: `rendition-swap:${row.id}`,
    });
    await this.syncScreen(args.screenId);
    return { cleared: true, sourceSha256: row.sourceSha256 };
  }
}
