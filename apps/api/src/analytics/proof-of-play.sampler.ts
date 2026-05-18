import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * ProofOfPlaySampler — proof-of-play analytics.
 *
 * Every ~10 minutes it snapshots what every ONLINE screen is
 * effectively showing: for each online screen we resolve the active
 * schedule (the highest-priority schedule whose date window contains
 * "now", screen-pinned beating group-pinned on a tie) and write one
 * PlaybackSample row { tenantId, screenId, playlistId }.
 *
 * The dashboard aggregates these into display-time reports — "playlist
 * X was live on N screens for M hours; sponsor asset A had M hours of
 * display." Each sample represents one interval (default 10 min) of
 * that playlist being live on that screen.
 *
 * This is a SAMPLING design (not a per-frame player beacon): it needs
 * ZERO player-side changes and never touches the load-bearing manifest
 * or render path. Accuracy is interval-grained — the industry norm for
 * proof-of-display reporting.
 *
 * Fully isolated + best-effort: any failure here (a pool blip, or even
 * a missing playback_samples table before the migration is applied) is
 * caught and logged — nothing else in the API is affected.
 *
 * Env:
 *   PROOF_OF_PLAY_SAMPLE_INTERVAL_MS  default 600000 (10 min)
 *   PROOF_OF_PLAY_DISABLED            set to "1" to skip (test / ops)
 *
 * v1 LIMITATION: a schedule's day-of-week / time-of-day window is not
 * yet applied here — only its date window (startTime/endTime) and
 * isActive flag. An always-on estimate is used; day/time refinement is
 * a tracked follow-up.
 */
@Injectable()
export class ProofOfPlaySampler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProofOfPlaySampler.name);
  private timer: NodeJS.Timeout | null = null;
  private firstRun: NodeJS.Timeout | null = null;
  private running = false;

  /** A screen counts as "online" if it pinged within this window. */
  private readonly ONLINE_WINDOW_MS = 6 * 60_000;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (process.env.PROOF_OF_PLAY_DISABLED === '1' || process.env.NODE_ENV === 'test') {
      this.logger.log('ProofOfPlaySampler disabled (env or test mode)');
      return;
    }
    const intervalMs = Number(process.env.PROOF_OF_PLAY_SAMPLE_INTERVAL_MS) || 600_000;
    this.logger.log(`ProofOfPlaySampler starting (interval=${intervalMs}ms)`);
    this.timer = setInterval(() => void this.tick(), intervalMs);
    // First pass ~30s after boot — long enough for the DB pool to
    // warm, then a deploy starts sampling right away instead of
    // losing a whole interval (and the feature is testable in seconds
    // once the migration is applied).
    this.firstRun = setTimeout(() => void this.tick(), 30_000);
    // Don't keep the Node event loop alive on shutdown.
    this.timer.unref?.();
    this.firstRun.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.firstRun) {
      clearTimeout(this.firstRun);
      this.firstRun = null;
    }
  }

  /** One sampling pass — snapshot every online screen's active playlist. */
  private async tick() {
    if (this.running) return; // overlap guard
    this.running = true;
    try {
      const now = new Date();
      const onlineSince = new Date(now.getTime() - this.ONLINE_WINDOW_MS);

      // Two queries total, then resolve in memory — cheap at fleet scale.
      const [screens, schedules] = await Promise.all([
        this.prisma.client.screen.findMany({
          where: {
            tenantId: { not: null },
            pairedAt: { not: null },
            lastPingAt: { gte: onlineSince },
          },
          select: { id: true, tenantId: true, screenGroupId: true },
        }),
        this.prisma.client.schedule.findMany({
          where: {
            isActive: true,
            startTime: { lte: now },
            OR: [{ endTime: null }, { endTime: { gte: now } }],
          },
          select: {
            tenantId: true,
            playlistId: true,
            screenId: true,
            screenGroupId: true,
            priority: true,
          },
        }),
      ]);

      if (screens.length === 0 || schedules.length === 0) return;

      // Resolve each online screen's effective playlist — the
      // highest-priority schedule targeting the screen directly or via
      // its group. Screens with no active schedule are simply skipped.
      const rows: Array<{ tenantId: string; screenId: string; playlistId: string }> = [];
      for (const screen of screens) {
        if (!screen.tenantId) continue;
        let best: { playlistId: string; rank: number } | null = null;
        for (const s of schedules) {
          if (s.tenantId !== screen.tenantId) continue;
          const matchesScreen = !!s.screenId && s.screenId === screen.id;
          const matchesGroup =
            !!s.screenGroupId &&
            !!screen.screenGroupId &&
            s.screenGroupId === screen.screenGroupId;
          if (!matchesScreen && !matchesGroup) continue;
          // A schedule pinned to the screen itself outranks a group
          // schedule at equal priority.
          const rank = s.priority * 2 + (matchesScreen ? 1 : 0);
          if (!best || rank > best.rank) {
            best = { playlistId: s.playlistId, rank };
          }
        }
        if (best) {
          rows.push({
            tenantId: screen.tenantId,
            screenId: screen.id,
            playlistId: best.playlistId,
          });
        }
      }

      if (rows.length > 0) {
        await (this.prisma.client as any).playbackSample.createMany({
          data: rows.map((r) => ({ ...r, sampledAt: now })),
        });
        this.logger.log(`proof-of-play: wrote ${rows.length} playback sample(s)`);
      }
    } catch (e: any) {
      // Best-effort — a missing table (migration not yet applied) or a
      // pool blip must never crash the API. Log and move on.
      this.logger.warn(`proof-of-play sampling failed: ${e?.message ?? e}`);
    } finally {
      this.running = false;
    }
  }
}
