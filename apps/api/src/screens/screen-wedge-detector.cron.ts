import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { LEASE, LeaderLeaseService, leadThisTick } from '../realtime/leader-lease.service';
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

  /** The web runtime is dead-or-lying if last_rendered_at is older than
   *  this. Render-proof POSTs every 30 s while playing and every 5 min
   *  idle, so 10 min = at least two missed idle proofs. This catches the
   *  failure class cache-staleness alone missed for 1.1.6: a player whose
   *  auth died keeps its cache loop OFF and its proofs REJECTED (401), so
   *  lastRenderedAt goes stale while lastPingAt stays fresh — G43 sat that
   *  way, "ONLINE" and content-dead, for 37 hours. (2026-08-30, audit P0-6) */
  private static readonly RENDER_STALE_MS = 10 * 60_000;

  /** How many AUTO_REFRESH_WEB fires in this window trigger escalation.
   *
   *  ⚠️ TIMER MATH (2026-08-30, audit P0-6): with a 15-min per-screen
   *  cooldown, three fires land at ~t+0 / t+15 / t+30 — so a 30-min window
   *  could NEVER hold all three once sweep jitter (60 s cadence + variable
   *  processing) pushed the third evaluation past t+30, and the live fleet
   *  proved it: 230 AUTO_REFRESH_WEB rows in 7 days, zero
   *  AUTO_RECOVERY_GAVE_UP. The window must be ≥ (THRESHOLD-1)×COOLDOWN
   *  plus generous slack; 50 min gives the t+0 fire 20 min of headroom at
   *  the t+30 evaluation. */
  private static readonly ESCALATION_WINDOW_MS = 50 * 60_000;
  private static readonly ESCALATION_THRESHOLD = 3;

  /** After we've given up on a screen, wait this long before trying
   *  again. Gives transient issues (server downtime, network blip) a
   *  chance to clear without operator intervention, but stops the
   *  every-12-min spam loop v1 produced. */
  private static readonly GIVE_UP_BACKOFF_MS = 60 * 60_000;

  /** Push-channel liveness (2026-07-31 poll-only-dongle incident).
   *  lastPushConnectedAt is refreshed at least every ~60s while a WS/SSE
   *  channel lives; older than this = no live push channel, so a
   *  REFRESH_WEB can never arrive and firing it is pure noise (the
   *  fire→fire→fire→give-up→1h→repeat loop this screen produced all
   *  afternoon). */
  private static readonly PUSH_STALE_MS = 10 * 60_000;

  /** A screen with lastPushConnectedAt=null might just predate the column
   *  (fleet reconnects stamp it within minutes of the feature deploying).
   *  Only treat null as push-dead once the screen has been paired long
   *  enough that "never connected" is the only remaining explanation. */
  private static readonly PUSH_UNKNOWN_GRACE_MS = 24 * 60 * 60_000;

  /** Re-flag a push-dead screen at most this often. */
  private static readonly PUSH_DEAD_REFLAG_MS = 24 * 60 * 60_000;

  /** Fleet Command retention (2026-08-31) — see sweepRetention(). Runs on
   *  the existing sweep cadence, self-throttled to hourly. */
  private static readonly RETENTION_SWEEP_MS = 60 * 60_000;
  private static readonly EVENT_RETENTION_MS = 30 * 24 * 60 * 60_000;
  private static readonly DEPLOYMENT_RETENTION_MS = 90 * 24 * 60 * 60_000;

  /** Last retention pass (per replica). 0 = never, so the first sweep after
   *  boot prunes; that is cheap and keeps a restarting replica honest. */
  private lastRetentionSweepMs = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly signer: WebsocketSignerService,
    private readonly redis: RedisService,
    @Optional() private readonly lease?: LeaderLeaseService,
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
    // Leader-leased (2026-09-02 multi-replica wave). Two replicas sweeping
    // means two REFRESH_WEB reboots at the same wedged screen inside one
    // cooldown, and — worse — it corrupts the escalation arithmetic that
    // CLAUDE.md player-rule 8 makes binding: "N fires in a window" is counted
    // from AUTO_REFRESH_WEB rows, so doubling the fires halves the effective
    // window and a screen reaches give-up in half the intended time. The
    // retention sweep inside this pass is likewise a single-sweeper job.
    const status = await leadThisTick(this.lease, LEASE.SCREEN_WEDGE_DETECTOR);
    if (!status.leader) {
      return { scanned: 0, recovered: 0, cooldownSkipped: 0, backoffSkipped: 0, escalated: 0 };
    }

    const now = Date.now();
    const pingFreshCutoff = new Date(now - ScreenWedgeDetectorCron.PING_FRESH_MS);
    const cacheStaleCutoff = new Date(now - ScreenWedgeDetectorCron.CACHE_REPORT_STALE_MS);
    const renderStaleCutoff = new Date(now - ScreenWedgeDetectorCron.RENDER_STALE_MS);

    // Fleet Command retention (2026-08-31). Deliberately BEFORE the Stage-1
    // early return below: a healthy fleet has zero wedge candidates, which is
    // exactly when the tables still need pruning — hanging this off the end
    // of the sweep would mean it never ran on the fleets that need it least
    // and most predictably. Self-throttled to hourly; never throws.
    await this.sweepRetention(now);

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
        // Bounded on BOTH sides (2026-08-15): the Walnut Creek demo seeder
        // FUTURE-DATES lastPingAt (~a month ahead) so demo screens read as
        // ONLINE in the dashboard. An open-ended `gte` therefore counted 34
        // fake screens as "freshly pinging" forever, and this cron kept
        // evaluating them as wedge candidates — REFRESH_WEB pushes into the
        // void plus audit-log noise on every sweep. A ping from the future
        // is by definition not a real heartbeat.
        lastPingAt: { gte: pingFreshCutoff, lte: new Date(now) },
        OR: [
          { lastCacheReportAt: { lt: cacheStaleCutoff } },
          {
            AND: [
              { lastCacheReportAt: null },
              { pairedAt: { lt: cacheStaleCutoff } },
            ],
          },
          // 2026-08-30 (audit P0-6) — RENDER truth, not just cache-loop
          // truth. An auth-dead player's cache loop can look alive-ish
          // while its render proofs are 401-rejected server-side; and the
          // inverse (cache loop wedged, renderer painting) already fired.
          // Either staleness now qualifies the screen for recovery.
          { lastRenderedAt: { lt: renderStaleCutoff } },
          {
            AND: [
              { lastRenderedAt: null },
              { pairedAt: { lt: renderStaleCutoff } },
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
        lastRenderedAt: true,
        pairedAt: true,
        lastPushConnectedAt: true,
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
        // Push-dead re-flag dedupe needs to see day-old flag rows too.
        ScreenWedgeDetectorCron.PUSH_DEAD_REFLAG_MS,
      ),
    );
    const recentActions = await this.prisma.client.auditLog.findMany({
      where: {
        targetId: { in: candidateIds },
        action: { in: ['AUTO_REFRESH_WEB', 'AUTO_RECOVERY_GAVE_UP', 'AUTO_RECOVERY_PUSH_DEAD'] },
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

    let pushDeadFlagged = 0;
    for (const screen of candidates) {
      const history = historyByScreen.get(screen.id) ?? [];
      // Push-channel liveness: a REFRESH_WEB rides WS/SSE — if the screen
      // has no live push channel it CANNOT arrive, so retrying is noise.
      // The 2026-07-31 dongle burned fire→fire→fire→give-up cycles all
      // afternoon this way. null = unknown (column may predate the
      // screen's next reconnect) → only counts as dead after the grace
      // window; a fresh stamp always means live.
      const pushDead = screen.lastPushConnectedAt
        ? now - screen.lastPushConnectedAt.getTime() > ScreenWedgeDetectorCron.PUSH_STALE_MS
        : !!screen.pairedAt && now - screen.pairedAt.getTime() > ScreenWedgeDetectorCron.PUSH_UNKNOWN_GRACE_MS;
      const decision = this.decide(now, history, pushDead);

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

      if (decision.action === 'push-dead-flagged') {
        // Already flagged within PUSH_DEAD_REFLAG_MS — stay quiet.
        continue;
      }

      if (decision.action === 'push-dead') {
        // No live push channel → a PUSHED REFRESH_WEB can't arrive. But a
        // push-dead screen still POLLS its manifest — so since 2026-08-30
        // the recovery command also rides the manifest as a durable
        // `refreshRequestedAt` (value-identity ack, see screens.controller).
        // Set it here (once per daily flag cycle), then flag as before.
        try {
          await this.prisma.client.screen.update({
            // Tenant-scoped (TEN-001): the candidate row came from a
            // tenant-filtered query, and the update re-asserts ownership so
            // a racing re-tenant/unpair can never make this write cross a
            // tenant boundary.
            where: { id: screen.id, tenantId: screen.tenantId! },
            data: { pendingRefreshAt: new Date() } as any,
            select: { id: true },
          });
        } catch (e) {
          this.logger.warn(`[wedge-detector] pendingRefreshAt write failed: ${(e as Error).message}`);
        }
        await this.recordAutoRefreshEvent(screen.id, screen.tenantId!, 'push-dead');
        const lastPush = screen.lastPushConnectedAt?.toISOString() ?? null;
        this.logger.warn(
          `[wedge-detector] screen=${screen.name} (id=${screen.id.slice(0, 8)}) is wedged but has NO live ` +
            `push channel (lastPushConnectedAt=${lastPush ?? 'never'}) — flagging as push-dead instead of ` +
            `firing REFRESH_WEB it cannot receive. Screen still plays via HTTP polling.`,
        );
        try {
          await this.prisma.client.auditLog.create({
            data: {
              action: 'AUTO_RECOVERY_PUSH_DEAD',
              targetType: 'screen',
              targetId: screen.id,
              tenantId: screen.tenantId!,
              userId: null,
              details: JSON.stringify({
                scope: 'screen',
                screenName: screen.name,
                lastPushConnectedAt: lastPush,
                reason:
                  'Screen is wedged (stale cache reports) but has no live WS/SSE channel, so a ' +
                  'REFRESH_WEB push cannot reach it. Content still updates via HTTP polling. ' +
                  'Likely a network blocking wss:// and event-streams, or a WebView/APK issue — ' +
                  'needs on-site or network attention.',
              }),
            },
          });
        } catch (e) {
          this.logger.warn(`[wedge-detector] push-dead audit log failed: ${(e as Error).message}`);
        }
        try {
          // Direct create with the (tenantId, dedupeKey) unique — a repeat
          // within the same day-bucket violates the constraint and is
          // swallowed, mirroring NotificationsService dedupe semantics.
          const dayBucket = Math.floor(now / ScreenWedgeDetectorCron.PUSH_DEAD_REFLAG_MS);
          // Deepest-audit §7 (2026-08-30): "still plays via polling" is a
          // CLAIM, and this branch fires precisely when content telemetry
          // is stale — the live fleet had screens wearing this reassurance
          // with render proof 17-44 HOURS old. Say "running on polling"
          // ONLY when a fresh render proof independently backs it;
          // otherwise say the honest thing: content correctness unproven,
          // act now.
          const renderFresh =
            screen.lastRenderedAt &&
            now - screen.lastRenderedAt.getTime() < ScreenWedgeDetectorCron.RENDER_STALE_MS;
          await this.prisma.client.notification.create({
            data: {
              tenantId: screen.tenantId!,
              kind: 'SCREEN_PUSH_DEAD',
              title: renderFresh
                ? `${screen.name}: realtime channel down — running on polling`
                : `${screen.name}: realtime down AND content unproven — needs attention now`,
              body: renderFresh
                ? 'This screen cannot receive instant commands (refresh, immediate emergency delivery). ' +
                  'Its render proof is current, so it is still playing and updates via its regular polling ' +
                  '(5–10s), including emergencies. Usual cause: the venue network blocks WebSocket/streaming connections.'
                : 'This screen cannot receive instant commands AND has not proven a painted frame recently — ' +
                  'what it is showing right now is unverified. A durable refresh command has been queued via its ' +
                  'manifest; if it does not recover within minutes, it needs on-site or network attention today, ' +
                  'not a daily reminder.',
              dedupeKey: `screen-push-dead:${screen.id}:${dayBucket}`,
            },
          });
        } catch {
          /* duplicate within the day-bucket or transient DB issue — fine */
        }
        pushDeadFlagged++;
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

      // 2026-08-30 (audit P0-6 item 8) — DUAL-PATH DELIVERY. The push is
      // instant when the channel is alive; the durable manifest flag
      // (`pendingRefreshAt` → `refreshRequestedAt`, value-identity ack)
      // reaches the screen on its next poll even when push delivery
      // silently fails — the exact hole G43 proved on 2026-08-28, when a
      // REFRESH_WEB was audited at 9:54 AM against a push channel that had
      // been dead for over an hour and the command evaporated.
      let durableSet = false;
      try {
        await this.prisma.client.screen.update({
          // Tenant-scoped (TEN-001) — same reasoning as the push-dead write.
          where: { id: screen.id, tenantId: screen.tenantId! },
          data: { pendingRefreshAt: new Date() } as any,
          select: { id: true },
        });
        durableSet = true;
      } catch (e) {
        this.logger.warn(
          `[wedge-detector ${corrId}] pendingRefreshAt write failed: ${(e as Error).message}`,
        );
      }
      await this.recordAutoRefreshEvent(screen.id, screen.tenantId!, 'wedge', corrId);

      let publishOk = false;
      try {
        await this.redis.publish(`tenant:${screen.tenantId}`, signed);
        publishOk = true;
      } catch (e) {
        this.logger.warn(
          `[wedge-detector ${corrId}] redis publish failed for screen=${screen.id}: ${(e as Error).message}`,
        );
        // Continue to audit-log even on publish failure — the durable
        // manifest path above is the delivery guarantee now; the audit row
        // records both channels' outcomes honestly.
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
              // Honest delivery evidence (2026-08-30): this row used to
              // mean only "we tried". Now it records which channels the
              // command actually left on.
              publishOk,
              durableSet,
            }),
          },
        });
      } catch (e) {
        this.logger.warn(`[wedge-detector] audit log failed: ${(e as Error).message}`);
      }

      recovered++;
    }

    if (recovered > 0 || escalated > 0 || cooldownSkipped > 0 || backoffSkipped > 0 || pushDeadFlagged > 0) {
      this.logger.log(
        `[wedge-detector] swept ${candidates.length} candidate(s): ` +
          `${recovered} recovered, ${escalated} escalated (gave up), ` +
          `${cooldownSkipped} in cooldown, ${backoffSkipped} in give-up backoff, ` +
          `${pushDeadFlagged} flagged push-dead`,
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
   * Per-screen timeline row for a system-initiated durable refresh
   * (2026-08-31, Fleet Command Phase 2). Written at BOTH sites that stamp
   * `pendingRefreshAt`: the push-dead branch (the push channel is gone, so
   * the manifest ride is the only delivery) and the fire branch (dual-path).
   *
   * Purely additive bookkeeping — best-effort by construction, because the
   * recovery command has already been issued by the time this runs and a
   * failed timeline row must never change a recovery outcome.
   */
  private async recordAutoRefreshEvent(
    screenId: string,
    tenantId: string,
    reason: 'wedge' | 'push-dead',
    corrId?: string,
  ): Promise<void> {
    try {
      await this.prisma.client.screenEvent.create({
        data: {
          screenId,
          tenantId,
          kind: 'auto-refresh-requested',
          detail: { reason, ...(corrId ? { corrId } : {}) },
        },
      });
    } catch (e) {
      this.logger.warn(`[wedge-detector] screen event write failed: ${(e as Error).message}`);
    }
  }

  /**
   * Retention for the Fleet Command tables (2026-08-31).
   *
   * Both are append-only and grow with fleet size × time, and nothing else
   * prunes them — a per-screen event stream left unbounded is exactly the
   * "accumulating state with no monitor" class that produced the
   * playback_samples bill. Rides the existing sweep rather than a second
   * timer, self-throttled to at most once an hour per replica (a duplicate
   * sweep from another replica just deletes nothing).
   *
   * Windows: events 30 d (the timeline is a debugging aid for a live
   * screen, not an audit record — AuditLog remains the forensic store and
   * is untouched), deployments 90 d (a quarter of push history).
   */
  private async sweepRetention(nowMs: number): Promise<void> {
    if (nowMs - this.lastRetentionSweepMs < ScreenWedgeDetectorCron.RETENTION_SWEEP_MS) return;
    this.lastRetentionSweepMs = nowMs;
    try {
      const events = await this.prisma.client.screenEvent.deleteMany({
        where: { createdAt: { lt: new Date(nowMs - ScreenWedgeDetectorCron.EVENT_RETENTION_MS) } },
      });
      const deployments = await this.prisma.client.deployment.deleteMany({
        where: {
          createdAt: { lt: new Date(nowMs - ScreenWedgeDetectorCron.DEPLOYMENT_RETENTION_MS) },
        },
      });
      if (events.count > 0 || deployments.count > 0) {
        this.logger.log(
          `[wedge-detector] retention: pruned ${events.count} screen event(s), ` +
            `${deployments.count} deployment(s)`,
        );
      }
    } catch (e) {
      this.logger.warn(`[wedge-detector] retention sweep failed: ${(e as Error).message}`);
    }
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
    pushDead = false,
  ): {
    action: 'fire' | 'cooldown' | 'backoff' | 'escalate' | 'push-dead' | 'push-dead-flagged';
    fireCountInWindow: number;
  } {
    const cooldownStart = nowMs - ScreenWedgeDetectorCron.RECOVERY_COOLDOWN_MS;
    const escalationWindowStart = nowMs - ScreenWedgeDetectorCron.ESCALATION_WINDOW_MS;
    const giveUpBackoffStart = nowMs - ScreenWedgeDetectorCron.GIVE_UP_BACKOFF_MS;
    const pushDeadReflagStart = nowMs - ScreenWedgeDetectorCron.PUSH_DEAD_REFLAG_MS;

    let fireCountInWindow = 0;
    let mostRecentFire: Date | null = null;
    let mostRecentGiveUp: Date | null = null;
    let mostRecentPushDeadFlag: Date | null = null;

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
      if (row.action === 'AUTO_RECOVERY_PUSH_DEAD' && tsMs >= pushDeadReflagStart) {
        if (!mostRecentPushDeadFlag || tsMs > mostRecentPushDeadFlag.getTime()) {
          mostRecentPushDeadFlag = row.createdAt;
        }
      }
    }

    // Push-dead trumps everything (2026-07-31): a REFRESH_WEB rides the
    // push channel — with no live channel it cannot arrive, so firing,
    // cooling down, and escalating are all noise. Flag once per
    // PUSH_DEAD_REFLAG_MS, then stay quiet.
    if (pushDead) {
      return {
        action: mostRecentPushDeadFlag ? 'push-dead-flagged' : 'push-dead',
        fireCountInWindow,
      };
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
