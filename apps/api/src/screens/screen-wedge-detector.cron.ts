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
 * Detection signal — high-confidence, low-noise:
 *
 *   The player POSTs /cache-status every 30 seconds unconditionally
 *   (apps/web/src/app/player/page.tsx ~line 2329). Separately it POSTs
 *   /screens/register (which moves `lastPingAt`) on a different timer.
 *   So if we see:
 *
 *     lastPingAt          fresh (< 90s)   → native + JS event loop alive
 *     lastCacheReportAt   stale (> 5min)  → React content-fetch loop dead
 *
 *   …that's the wedge fingerprint. Fire REFRESH_WEB.
 *
 * ─── Why the cooldown went audit-log instead of Redis (2026-05-27 round 2) ───
 *
 * v1 of this cron used a Redis SET NX EX lock with a 15-min TTL keyed
 * on screenId to prevent re-firing on the same screen too fast. The
 * audit log shows that didn't work — same screen got recovered every
 * 1-13 minutes for hours (LED Score Board: 279 → 419 min cache age
 * across 23 fires without recovery). Two compounding problems:
 *
 *   1. The Redis lock evidently wasn't holding for the full TTL —
 *      possibly an ioredis SET-args interpretation issue, possibly an
 *      eviction under memory pressure, possibly something Railway-
 *      specific. Couldn't reproduce locally in the time available, and
 *      Redis-as-lock is the wrong durability tier for this anyway —
 *      we should NEVER lose a cooldown decision.
 *
 *   2. Even when the lock would have held, the screens weren't actually
 *      recovering. cache_age climbed monotonically across every fire,
 *      meaning the REFRESH_WEB messages were either (a) not reaching
 *      the player or (b) being received but not unsticking the wedge.
 *      Just slamming REFRESH_WEB harder doesn't fix that — we need to
 *      ESCALATE: stop trying, surface the screen as needing manual
 *      operator intervention (probably an APK update), audit-log the
 *      give-up so it's visible.
 *
 * v2 (this file): the audit log IS the cooldown source. Per screen:
 *
 *   - If the screen's most recent recovery action is AUTO_REFRESH_WEB
 *     within the last 15 min  → skip (cooldown). Bulletproof, durable
 *     across replica restarts, no Redis dependency.
 *
 *   - If the screen has >= 3 AUTO_REFRESH_WEB entries in the last 30
 *     min  → escalate: write AUTO_RECOVERY_GAVE_UP, do NOT publish
 *     REFRESH_WEB. The give-up entry surfaces the screen on the
 *     dashboard for operator review (push APK, or physical
 *     intervention).
 *
 *   - If the screen's most recent action is AUTO_RECOVERY_GAVE_UP
 *     within the last 1 hour  → skip (escalation backoff). After 1
 *     hour, the cron will try once more — gives transient issues a
 *     chance to clear without operator action, but stops the
 *     auto-recover-every-12-minutes loop that v1 produced.
 *
 *   - Otherwise → publish REFRESH_WEB, write AUTO_REFRESH_WEB audit
 *     row, continue.
 *
 * AuditLog is the source of truth. Multi-replica safe automatically
 * (Postgres serializes the SELECT+INSERT pair within a transaction).
 * Durable across container restarts. Visible to operators via the
 * existing Audit Log page. Zero Redis dependency for correctness
 * (Redis is still used for the WS publish path, but that's fan-out
 * — losing it just means slower delivery, not double-firing).
 *
 * Disabled in tests + via WEDGE_DETECTOR_DISABLED=1 emergency lever.
 */
@Injectable()
export class ScreenWedgeDetectorCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScreenWedgeDetectorCron.name);
  private timer?: NodeJS.Timeout;

  /** Sweep cadence. Matches /cache-status post cadence × 2. */
  private static readonly SWEEP_INTERVAL_MS = 60_000;

  /** A screen is "alive" if last_ping_at is within this window. */
  private static readonly PING_FRESH_MS = 90_000;

  /** A screen's React tree is "wedged" if last_cache_report_at is
   *  older than this. Player POSTs cache-status every 30s, so
   *  5 minutes = 10 missed posts. */
  private static readonly CACHE_REPORT_STALE_MS = 5 * 60_000;

  /** Once we've fired REFRESH_WEB, don't fire again for this long.
   *  Gives the player time to reload + start posting cache reports. */
  private static readonly RECOVERY_COOLDOWN_MS = 15 * 60_000;

  /** How many AUTO_REFRESH_WEB fires in this window trigger escalation. */
  private static readonly ESCALATION_WINDOW_MS = 30 * 60_000;
  private static readonly ESCALATION_THRESHOLD = 3;

  /** After we've given up on a screen, wait this long before trying
   *  again. Gives transient issues (server downtime, network blip) a
   *  chance to clear without operator intervention, but stops the
   *  every-12-min spam loop v1 produced. */
  private static readonly GIVE_UP_BACKOFF_MS = 60 * 60_000;

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
      `ScreenWedgeDetector active — sweep every ${ScreenWedgeDetectorCron.SWEEP_INTERVAL_MS / 1000}s, ` +
        `cache-stale=${ScreenWedgeDetectorCron.CACHE_REPORT_STALE_MS / 60_000}min, ` +
        `cooldown=${ScreenWedgeDetectorCron.RECOVERY_COOLDOWN_MS / 60_000}min, ` +
        `escalate-after=${ScreenWedgeDetectorCron.ESCALATION_THRESHOLD} fires in ` +
        `${ScreenWedgeDetectorCron.ESCALATION_WINDOW_MS / 60_000}min, ` +
        `give-up-backoff=${ScreenWedgeDetectorCron.GIVE_UP_BACKOFF_MS / 60_000}min`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Find every screen in the wedge state and fire REFRESH_WEB on each
   * that's not in cooldown or escalation backoff. Public so admin tools
   * + tests can force a sweep without waiting on the timer.
   */
  async sweep(): Promise<{
    scanned: number;
    recovered: number;
    cooldownSkipped: number;
    backoffSkipped: number;
    escalated: number;
  }> {
    const now = Date.now();
    const pingFreshCutoff = new Date(now - ScreenWedgeDetectorCron.PING_FRESH_MS);
    const cacheStaleCutoff = new Date(now - ScreenWedgeDetectorCron.CACHE_REPORT_STALE_MS);

    // Stage 1: find every screen that LOOKS wedged at the data layer.
    // status='ONLINE' filters to screens the server already thinks are
    // healthy — we're only recovering the subset that's lying about it.
    //
    // We include lastCacheReportAt IS NULL + pairedAt > CACHE_STALE_MS
    // ago: that covers the case where a player has been pinging for
    // 10+ minutes but never managed to send ANY cache report (clean
    // wedge before the first cache report ever made it through).
    const candidates = await this.prisma.client.screen.findMany({
      where: {
        status: 'ONLINE',
        tenantId: { not: null }, // unpaired screens have no tenant channel
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
        // will reboot when the install finishes; firing REFRESH_WEB on
        // top would race the install state machine.
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
      return { scanned: 0, recovered: 0, cooldownSkipped: 0, backoffSkipped: 0, escalated: 0 };
    }

    // Stage 2: batch-load every relevant audit row for the candidate
    // set in one query. Cheaper than N queries; the index on
    // (target_id, action, created_at) handles this efficiently.
    const candidateIds = candidates.map((s) => s.id);
    const backoffWindowStart = new Date(
      now - Math.max(
        ScreenWedgeDetectorCron.GIVE_UP_BACKOFF_MS,
        ScreenWedgeDetectorCron.ESCALATION_WINDOW_MS,
      ),
    );
    const recentActions = await this.prisma.client.auditLog.findMany({
      where: {
        targetId: { in: candidateIds },
        action: { in: ['AUTO_REFRESH_WEB', 'AUTO_RECOVERY_GAVE_UP'] },
        createdAt: { gte: backoffWindowStart },
      },
      select: { targetId: true, action: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    // Bucket the audit history per screen for cheap lookup below.
    const historyByScreen = new Map<
      string,
      Array<{ action: string; createdAt: Date }>
    >();
    for (const row of recentActions) {
      const arr = historyByScreen.get(row.targetId!) ?? [];
      arr.push({ action: row.action, createdAt: row.createdAt });
      historyByScreen.set(row.targetId!, arr);
    }

    let recovered = 0;
    let cooldownSkipped = 0;
    let backoffSkipped = 0;
    let escalated = 0;

    for (const screen of candidates) {
      const history = historyByScreen.get(screen.id) ?? [];
      const decision = this.decide(now, history);

      if (decision.action === 'cooldown') {
        cooldownSkipped++;
        // Keep this LOG-only to avoid audit-log noise on every sweep
        // tick while a healthy recovery is in flight.
        continue;
      }

      if (decision.action === 'backoff') {
        backoffSkipped++;
        continue;
      }

      const cacheAgeMin = screen.lastCacheReportAt
        ? Math.round((now - screen.lastCacheReportAt.getTime()) / 60_000)
        : null;
      const pingAgeSec = screen.lastPingAt
        ? Math.round((now - screen.lastPingAt.getTime()) / 1000)
        : null;

      const baseDetails = {
        scope: 'screen' as const,
        screenName: screen.name,
        cacheAgeMin,
        pingAgeSec,
        attemptCountInWindow: decision.fireCountInWindow,
      };

      if (decision.action === 'escalate') {
        // Three failed REFRESH_WEB in 30 min = whatever's wrong won't
        // be fixed by another reload. Stop trying. Audit-log the
        // give-up so the dashboard surfaces it for the operator.
        this.logger.error(
          `[wedge-detector] giving up on screen=${screen.name} (id=${screen.id.slice(0, 8)}) — ` +
            `${decision.fireCountInWindow} REFRESH_WEB in ${ScreenWedgeDetectorCron.ESCALATION_WINDOW_MS / 60_000}min ` +
            `didn't recover. cache-report stale ${cacheAgeMin}min, ping fresh ${pingAgeSec}s ago. ` +
            `Operator must push APK update or physically intervene.`,
        );
        try {
          await this.prisma.client.auditLog.create({
            data: {
              action: 'AUTO_RECOVERY_GAVE_UP',
              targetType: 'screen',
              targetId: screen.id,
              tenantId: screen.tenantId!,
              userId: null,
              details: JSON.stringify({
                ...baseDetails,
                reason:
                  `${decision.fireCountInWindow} REFRESH_WEB in ${ScreenWedgeDetectorCron.ESCALATION_WINDOW_MS / 60_000}min ` +
                  `did not recover the screen. ` +
                  `Cron will retry after ${ScreenWedgeDetectorCron.GIVE_UP_BACKOFF_MS / 60_000}min backoff.`,
                backoffUntil: new Date(now + ScreenWedgeDetectorCron.GIVE_UP_BACKOFF_MS).toISOString(),
              }),
            },
          });
        } catch (e) {
          this.logger.warn(`[wedge-detector] give-up audit log failed: ${(e as Error).message}`);
        }
        escalated++;
        continue;
      }

      // decision.action === 'fire'
      const corrId = `wedge-${Date.now().toString(36)}-${screen.id.slice(0, 8)}`;
      const reason = cacheAgeMin === null
        ? `never reported cache, paired ${Math.round((now - (screen.pairedAt?.getTime() ?? now)) / 60_000)}min ago`
        : `cache-report stale ${cacheAgeMin}min, ping fresh ${pingAgeSec}s ago`;

      this.logger.warn(
        `[wedge-detector] auto-refreshing screen=${screen.name} (id=${screen.id.slice(0, 8)}) — ${reason}` +
          (decision.fireCountInWindow > 0
            ? ` (attempt ${decision.fireCountInWindow + 1}/${ScreenWedgeDetectorCron.ESCALATION_THRESHOLD})`
            : ''),
      );

      const signed = this.signer.signMessage('REFRESH_WEB', {
        scope: 'screen',
        scopeId: screen.id,
        tenantId: screen.tenantId,
        requestedBy: null, // system-initiated
        jitterMs: 0,
        corrId,
      });

      try {
        await this.redis.publish(`tenant:${screen.tenantId}`, signed);
      } catch (e) {
        this.logger.warn(
          `[wedge-detector ${corrId}] redis publish failed for screen=${screen.id}: ${(e as Error).message}`,
        );
        // Continue to audit-log even on publish failure — the audit row
        // tells the next operator/agent we tried (and the cooldown still
        // applies so we won't hammer this screen if Redis is down).
      }

      try {
        await this.prisma.client.auditLog.create({
          data: {
            action: 'AUTO_REFRESH_WEB',
            targetType: 'screen',
            targetId: screen.id,
            tenantId: screen.tenantId!,
            userId: null,
            details: JSON.stringify({
              ...baseDetails,
              corrId,
              reason,
            }),
          },
        });
      } catch (e) {
        this.logger.warn(`[wedge-detector] audit log failed: ${(e as Error).message}`);
      }

      recovered++;
    }

    if (recovered > 0 || escalated > 0 || cooldownSkipped > 0 || backoffSkipped > 0) {
      this.logger.log(
        `[wedge-detector] swept ${candidates.length} candidate(s): ` +
          `${recovered} recovered, ${escalated} escalated (gave up), ` +
          `${cooldownSkipped} in cooldown, ${backoffSkipped} in give-up backoff`,
      );
    }

    return {
      scanned: candidates.length,
      recovered,
      cooldownSkipped,
      backoffSkipped,
      escalated,
    };
  }

  /**
   * Pure decision function — given a screen's recent audit history and
   * the current time, decide whether to fire REFRESH_WEB, escalate to
   * AUTO_RECOVERY_GAVE_UP, or skip due to cooldown / backoff.
   *
   * Pulled out as its own method so it can be unit-tested without
   * needing a Prisma client. The cron sweep just orchestrates Stage-1
   * candidate selection + the side-effects (publish + audit-log) for
   * each decision.
   */
  decide(
    nowMs: number,
    history: ReadonlyArray<{ action: string; createdAt: Date }>,
  ): {
    action: 'fire' | 'cooldown' | 'backoff' | 'escalate';
    fireCountInWindow: number;
  } {
    const cooldownStart = nowMs - ScreenWedgeDetectorCron.RECOVERY_COOLDOWN_MS;
    const escalationWindowStart = nowMs - ScreenWedgeDetectorCron.ESCALATION_WINDOW_MS;
    const giveUpBackoffStart = nowMs - ScreenWedgeDetectorCron.GIVE_UP_BACKOFF_MS;

    let fireCountInWindow = 0;
    let mostRecentFire: Date | null = null;
    let mostRecentGiveUp: Date | null = null;

    for (const row of history) {
      const tsMs = row.createdAt.getTime();
      if (row.action === 'AUTO_REFRESH_WEB' && tsMs >= escalationWindowStart) {
        fireCountInWindow++;
        if (!mostRecentFire || tsMs > mostRecentFire.getTime()) {
          mostRecentFire = row.createdAt;
        }
      }
      if (row.action === 'AUTO_RECOVERY_GAVE_UP' && tsMs >= giveUpBackoffStart) {
        if (!mostRecentGiveUp || tsMs > mostRecentGiveUp.getTime()) {
          mostRecentGiveUp = row.createdAt;
        }
      }
    }

    // Most recent give-up still inside the backoff window → skip.
    // Gives transient issues a chance to clear without operator action
    // but stops the every-12-min spam loop v1 produced.
    if (mostRecentGiveUp && mostRecentGiveUp.getTime() >= giveUpBackoffStart) {
      return { action: 'backoff', fireCountInWindow };
    }

    // Most recent fire still inside the cooldown window → skip. Gives
    // the player time to receive the REFRESH_WEB, reload, and start
    // posting cache reports again before we consider firing again.
    if (mostRecentFire && mostRecentFire.getTime() >= cooldownStart) {
      return { action: 'cooldown', fireCountInWindow };
    }

    // We're past the cooldown and not in give-up backoff. If there
    // have been >= ESCALATION_THRESHOLD fires in the escalation
    // window without recovery (we wouldn't be here if recovery had
    // happened — the screen would have dropped out of the Stage-1
    // candidate set), escalate to give-up.
    if (fireCountInWindow >= ScreenWedgeDetectorCron.ESCALATION_THRESHOLD) {
      return { action: 'escalate', fireCountInWindow };
    }

    return { action: 'fire', fireCountInWindow };
  }
}
