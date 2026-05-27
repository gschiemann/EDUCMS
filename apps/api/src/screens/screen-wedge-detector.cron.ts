import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';

/**
 * ScreenWedgeDetectorCron — fleet-wide auto-recovery for the "alive but
 * not playing" failure mode.
 *
 * 2026-05-27 operator incident: tenant 'dodgers' pushed playlist BNI to
 * screens G43 + M43 at 23:00. M43 downloaded the 4.59 MB MP4 and started
 * playing 1 s later. G43 sat showing the previous content for 85 minutes
 * until the operator clicked "Refresh Web" on the dashboard. Both
 * screens were marked ONLINE the whole time (heartbeat every 13 s, OTA
 * checks every cycle) — the native Android shell was fine, but the
 * React app inside the WebView had frozen its manifest-update loop at
 * 21:46 and never picked up the new playlist assignment.
 *
 * The pre-existing safety nets all FAILED to recover from this state:
 *
 *   - **Native APK watchdog** (MainActivity.watchdogTicker) reloads the
 *     WebView only when JS stops writing `lastSuccessfulLoadAtMs`. But
 *     the wedged-React-tree case has JS event loop still running (other
 *     useEffects keep firing), so the heartbeat keeps refreshing the
 *     watchdog timestamp and the native watchdog never trips. Catches
 *     "JS dead" but not "JS alive but partially wedged."
 *
 *   - **Error boundary self-heal** (apps/web/src/app/player/page.tsx
 *     ~line 1232) reloads on a thrown render error. But the wedge here
 *     was silent — a useEffect cycle stopped progressing without
 *     throwing, so the boundary never saw it.
 *
 *   - **Operator REFRESH_WEB button** (apps/api/src/screens/
 *     screens.controller.ts ~line 2117) is the manual escape hatch the
 *     operator used. Greg's reaction: "is that a bug? it should keep
 *     itself alive right? i wont be infront of customer screens to do
 *     this when somehting doesnt load". Correct. The server should
 *     detect this state and fire REFRESH_WEB automatically — that's
 *     this file.
 *
 * Detection signal — high-confidence, low-noise:
 *
 *   The player POSTs /cache-status every 30 seconds unconditionally
 *   (apps/web/src/app/player/page.tsx ~line 2329 `setInterval(post,
 *   30_000)`). That POST updates `lastCacheReportAt`. So a healthy
 *   player advances that field every 30 s WHETHER OR NOT content
 *   changed — it's a heartbeat for the React tree's
 *   content-fetch loop, distinct from the native shell's heartbeat.
 *
 *   Separately, the player POSTs /screens/register (which moves
 *   `lastPingAt`) on a different timer. So if we see:
 *
 *     lastPingAt          fresh (< 90s)   → native + JS event loop alive
 *     lastCacheReportAt   stale (> 5min)  → React content-fetch loop dead
 *
 *   …the only thing it can be is the exact wedge G43 hit. Fire
 *   REFRESH_WEB.
 *
 *   5-min threshold = 10 missed cache reports. 30s detector cycle.
 *   Worst-case recovery latency from wedge → fix ~5.5 min. Tunable.
 *
 * Per-screen cooldown: 15 min. Reload didn't recover? Don't loop —
 * leave the screen for operator inspection. If a single screen needs
 * recovery more than once per 15 min the bug isn't a cache wedge; it's
 * something we should fix at the root.
 *
 * Multi-replica safety: every API replica runs this cron, but we use a
 * Redis SETNX-with-TTL lock keyed on the screenId before firing. Only
 * one replica wins the lock and publishes; others see the lock and skip.
 * Lock TTL = 15 min (same as cooldown) so a downed publisher doesn't
 * pin the screen out of recovery forever.
 *
 * Disabled in tests + via WEDGE_DETECTOR_DISABLED=1 for emergency
 * lever-pull. Audit log per fire with action='AUTO_REFRESH_WEB' +
 * reason so we can track frequency and tune thresholds.
 */
@Injectable()
export class ScreenWedgeDetectorCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScreenWedgeDetectorCron.name);
  private timer?: NodeJS.Timeout;

  /** Sweep cadence. Matches /cache-status post cadence × 2 — fast
   *  enough to catch a wedge within ~5.5 min, slow enough that the
   *  DB scan is trivial overhead. */
  private static readonly SWEEP_INTERVAL_MS = 60_000;

  /** A screen is "alive" if last_ping_at is within this window. */
  private static readonly PING_FRESH_MS = 90_000;

  /** A screen's React tree is "wedged" if last_cache_report_at is
   *  older than this. Player POSTs cache-status every 30s, so
   *  5 minutes = 10 missed posts. Very high signal. */
  private static readonly CACHE_REPORT_STALE_MS = 5 * 60_000;

  /** Per-screen recovery cooldown. If REFRESH_WEB doesn't unstick the
   *  screen, we don't keep hammering it — leave it for operator
   *  inspection. */
  private static readonly RECOVERY_COOLDOWN_MS = 15 * 60_000;

  /** Lock TTL in Redis for cross-replica coordination. Same as the
   *  per-screen cooldown — one replica wins the lock and fires; others
   *  skip silently. If the winning replica dies mid-publish, the lock
   *  auto-expires and the next sweep retries. */
  private static readonly LOCK_TTL_SEC = 15 * 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly signer: WebsocketSignerService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    if (process.env.WEDGE_DETECTOR_DISABLED === '1') {
      this.logger.warn('ScreenWedgeDetector disabled via env (WEDGE_DETECTOR_DISABLED=1)');
      return;
    }
    this.timer = setInterval(() => {
      void this.sweep().catch((e) => {
        this.logger.warn(`sweep failed: ${(e as Error).message}`);
      });
    }, ScreenWedgeDetectorCron.SWEEP_INTERVAL_MS);
    this.logger.log(
      `ScreenWedgeDetector active — sweeping every ${ScreenWedgeDetectorCron.SWEEP_INTERVAL_MS / 1000}s ` +
        `(ping<${ScreenWedgeDetectorCron.PING_FRESH_MS / 1000}s, cache>${ScreenWedgeDetectorCron.CACHE_REPORT_STALE_MS / 60_000}min)`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Find every screen in the wedge state and fire REFRESH_WEB on each.
   * Exported as a method so an admin endpoint or test can force a
   * sweep without waiting on the timer.
   */
  async sweep(): Promise<{ scanned: number; recovered: number; skipped: number }> {
    const now = Date.now();
    const pingFreshCutoff = new Date(now - ScreenWedgeDetectorCron.PING_FRESH_MS);
    const cacheStaleCutoff = new Date(now - ScreenWedgeDetectorCron.CACHE_REPORT_STALE_MS);

    // Find candidates. status='ONLINE' filters to screens the server
    // already thinks are healthy — we're only recovering the subset
    // that's lying about it.
    //
    // We deliberately INCLUDE screens where lastCacheReportAt IS NULL
    // and lastPingAt is fresh + paired_at is > CACHE_REPORT_STALE_MS
    // ago. That covers the case where a player has been pinging for
    // 10+ minutes but never managed to send ANY cache report — same
    // wedge, just the cleaner variant where the wedge happened before
    // the first cache report ever made it through.
    const candidates = await this.prisma.client.screen.findMany({
      where: {
        status: 'ONLINE',
        tenantId: { not: null }, // unpaired screens have no tenant to publish into
        lastPingAt: { gte: pingFreshCutoff },
        OR: [
          { lastCacheReportAt: { lt: cacheStaleCutoff } },
          {
            AND: [
              { lastCacheReportAt: null },
              { pairedAt: { lt: cacheStaleCutoff } },
            ],
          },
        ],
        // Don't compete with an in-flight OTA. force_apk_update_pending_at
        // means the operator just clicked "Push APK update" — the player
        // will reboot on its own when the install finishes; firing
        // REFRESH_WEB on top of that would race the install state machine.
        forceApkUpdatePendingAt: null,
      },
      select: {
        id: true,
        name: true,
        tenantId: true,
        lastPingAt: true,
        lastCacheReportAt: true,
        pairedAt: true,
      },
    });

    if (candidates.length === 0) {
      return { scanned: 0, recovered: 0, skipped: 0 };
    }

    let recovered = 0;
    let skipped = 0;

    for (const screen of candidates) {
      // Multi-replica lock via ioredis SET NX EX. Only the replica
      // that wins this lands the publish; others skip silently. TTL
      // matches the per-screen cooldown so a screen can't be auto-
      // recovered twice within the window even across replicas. If
      // Redis isn't connected we degrade to "publish anyway" — at
      // worst two replicas fan out the same REFRESH_WEB and the
      // player handles dedup by corrId.
      const lockKey = `wedge-recovery:${screen.id}`;
      let won = false;
      const pub = this.redis.publisher;
      if (pub) {
        try {
          const result = await pub.set(
            lockKey,
            '1',
            'EX',
            ScreenWedgeDetectorCron.LOCK_TTL_SEC,
            'NX',
          );
          won = result === 'OK';
        } catch (e) {
          this.logger.warn(
            `redis SET NX failed for screen=${screen.id} (degraded mode, publishing anyway): ${(e as Error).message}`,
          );
          won = true;
        }
      } else {
        // No Redis at all (boot phase or REDIS_URL unset). Single-
        // replica deploys hit this path normally — there's no other
        // replica to coordinate with so just proceed.
        won = true;
      }
      if (!won) {
        skipped++;
        continue;
      }

      const cacheAgeMin = screen.lastCacheReportAt
        ? Math.round((now - screen.lastCacheReportAt.getTime()) / 60_000)
        : null;
      const pingAgeSec = screen.lastPingAt
        ? Math.round((now - screen.lastPingAt.getTime()) / 1000)
        : null;

      const corrId = `wedge-${Date.now().toString(36)}-${screen.id.slice(0, 8)}`;
      const reason = cacheAgeMin === null
        ? `never reported cache, paired ${Math.round((now - (screen.pairedAt?.getTime() ?? now)) / 60_000)}min ago`
        : `cache-report stale ${cacheAgeMin}min, ping fresh ${pingAgeSec}s ago`;

      this.logger.warn(
        `[wedge-detector] auto-refreshing screen=${screen.name} (id=${screen.id.slice(0, 8)}) — ${reason}`,
      );

      const signed = this.signer.signMessage('REFRESH_WEB', {
        scope: 'screen',
        scopeId: screen.id,
        tenantId: screen.tenantId,
        requestedBy: null, // system-initiated
        jitterMs: 0,       // single screen, no fleet jitter needed
        corrId,
      });

      try {
        await this.redis.publish(`tenant:${screen.tenantId}`, signed);
      } catch (e) {
        this.logger.warn(
          `[wedge-detector ${corrId}] redis publish failed for screen=${screen.id}: ${(e as Error).message}`,
        );
        // Continue to audit-log even on publish failure — the audit
        // row tells the next operator/agent we tried.
      }

      try {
        await this.prisma.client.auditLog.create({
          data: {
            action: 'AUTO_REFRESH_WEB',
            targetType: 'screen',
            targetId: screen.id,
            tenantId: screen.tenantId!,
            userId: null, // system-initiated, no actor
            details: JSON.stringify({
              scope: 'screen',
              screenName: screen.name,
              corrId,
              reason,
              cacheAgeMin,
              pingAgeSec,
            }),
          },
        });
      } catch (e) {
        this.logger.warn(`[wedge-detector] audit log failed: ${(e as Error).message}`);
      }

      recovered++;
    }

    if (recovered > 0 || skipped > 0) {
      this.logger.log(
        `[wedge-detector] swept ${candidates.length} candidate(s): ${recovered} recovered, ${skipped} skipped (locked by another replica)`,
      );
    }

    return { scanned: candidates.length, recovered, skipped };
  }
}
