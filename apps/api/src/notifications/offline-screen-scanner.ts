import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Optional } from '@nestjs/common';
import { NotificationsService, type OfflineScanResult } from './notifications.service';
import { LEASE, LeaderLeaseService, leadThisTick } from '../realtime/leader-lease.service';
import { CustomerAlertEmailsService, type CustomerAlertTickResult } from './customer-alerts/customer-alert-emails.service';
import { resolveAlertMode } from './customer-alerts/customer-alert-policy';

/** How often the pipeline summary line is logged (counts only). */
export const PIPELINE_SUMMARY_INTERVAL_MS = 15 * 60_000;

/** One summary window: event counts summed, plus the latest scan's state. */
interface SummaryWindow {
  startedAt: number;
  /** tick() calls, whatever happened in them. */
  scans: number;
  /** Ticks that held the lease and ran the scan. */
  leader: number;
  /** Ticks another replica led. */
  follower: number;
  /** Ticks skipped because the previous one was still running. */
  skipped: number;
  scanFailed: number;
  alertFailed: number;
  opened: number;
  held: number;
  silenced: number;
  recovered: number;
  sends: number;
  platformIncidents: number;
  /** Scans the alert worker stood down for, by gate reason. */
  gated: Record<string, number>;
  /** The latest scan's own counts (state, not events). */
  lastFound: number | null;
  lastAlert: CustomerAlertTickResult | null;
}

function newWindow(startedAt: number): SummaryWindow {
  return {
    startedAt,
    scans: 0,
    leader: 0,
    follower: 0,
    skipped: 0,
    scanFailed: 0,
    alertFailed: 0,
    opened: 0,
    held: 0,
    silenced: 0,
    recovered: 0,
    sends: 0,
    platformIncidents: 0,
    gated: {},
    lastFound: null,
    lastAlert: null,
  };
}

/**
 * HIGH-9 audit fix: NotificationsService.scanOfflineScreens existed with
 * test coverage but was never invoked, so offline-screen alerts never
 * fired. This wires a process-internal 60-second interval that runs the
 * scan; keeps the dep surface flat (no @nestjs/schedule install).
 *
 * 2026-09-02 (efficiency audit P0-4): the scan itself is now
 * TRANSITION-based — it notifies only screens that crossed healthy →
 * offline since the previous tick, so a steady fleet costs one indexed
 * SELECT per tick and zero writes. The 60 s cadence is unchanged: it sets
 * detection latency, and detection latency is now the ONLY thing it costs.
 * See the comment block above `scanOfflineScreens`.
 *
 * 2026-10-24 — PROOF OF LIFE. The customer alert emails ride this tick, and
 * for their first day nothing qualified (every screen in trouble was either
 * silent since before launch or inside its own on/off schedule's OFF
 * window). Both workers log only when something HAPPENS, so a correct,
 * quiet pipeline was indistinguishable from a dead one — and the one line
 * that would have said "running", the "starting" line below, is written in
 * the boot log burst (~600 route-mapping lines in ~150 ms) that trips
 * Railway's 500-lines/s limit and was dropped on the very deployment that
 * was searched. So the scanner now also says:
 *   - ONCE, on its first scan (60 s after boot, after the burst):
 *     "OfflineScreenScanner alive — …" with the alert-email mode and wiring;
 *   - every 15 minutes, counts only (no names, no ids, no addresses):
 *     "[alert-email] pipeline summary (15 min): …" — scans run / led /
 *     followed / failed, what the last scan saw (offline, due, too old,
 *     confirmed, deferred by reason, gate) and what was sent.
 * A missing summary line is itself the signal: the tick has stopped.
 *
 * Configurable via env:
 *   OFFLINE_SCAN_INTERVAL_MS      default 60000  (60s)
 *   OFFLINE_SCAN_THRESHOLD_MIN    default 5      (screens silent >5 min)
 *   OFFLINE_SCAN_MAX_CANDIDATES   default 5000   (bound on the candidate read)
 *   OFFLINE_SCAN_DISABLED         set to "1" to skip (test env, manual ops)
 */
@Injectable()
export class OfflineScreenScanner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OfflineScreenScanner.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private aliveLogged = false;
  private window: SummaryWindow | null = null;

  /** Clock seam for tests. */
  now: () => number = () => Date.now();

  constructor(
    private readonly notifications: NotificationsService,
    @Optional() private readonly lease?: LeaderLeaseService,
    // 2026-10-23 — customer alert emails ride this tick (and so this lease):
    // they judge "offline ≥ 15 min" from the rows the scan just read.
    @Optional() private readonly alertEmails?: CustomerAlertEmailsService,
  ) {}

  onModuleInit() {
    if (process.env.OFFLINE_SCAN_DISABLED === '1' || process.env.NODE_ENV === 'test') {
      this.logger.log('OfflineScreenScanner disabled (env or test mode)');
      return;
    }
    const intervalMs = Number(process.env.OFFLINE_SCAN_INTERVAL_MS) || 60_000;
    const thresholdMin = Number(process.env.OFFLINE_SCAN_THRESHOLD_MIN) || 5;
    this.logger.log(`OfflineScreenScanner starting (interval=${intervalMs}ms, threshold=${thresholdMin}min)`);
    this.window = newWindow(this.now());
    this.timer = setInterval(() => void this.tick(thresholdMin), intervalMs);
    // Don't keep the Node event loop alive on shutdown.
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(thresholdMin: number) {
    const w = (this.window ??= newWindow(this.now()));
    w.scans++;
    try {
      if (this.running) {
        w.skipped++; // overlap guard
        return;
      }
      // Leader-leased (2026-09-02 multi-replica wave). This is the worker with
      // the worst multi-replica behaviour: transition detection is keyed off a
      // PER-PROCESS healthy→offline baseline, so a second replica both seeds
      // its own baseline (a cold start that swallows one round of crossings)
      // and fires its own notification for every crossing it does see. Sticky
      // leadership matters here — if leadership bounced tick to tick the
      // baseline would re-seed each time and crossings would go unreported.
      const status = await leadThisTick(this.lease, LEASE.OFFLINE_SCREEN_SCAN);
      if (!status.leader) {
        w.follower++;
        this.logAliveOnce(false, null);
        return;
      }
      w.leader++;
      this.running = true;
      try {
        const result = await this.notifications.scanOfflineScreens(thresholdMin);
        w.lastFound = result.found;
        // Log only when something actually happened. A steady fleet with 197
        // long-offline screens used to log every single minute; now silence
        // means "nothing changed", which is the useful signal.
        if (result.seeded) {
          this.logger.log(
            `Offline scan seeded baseline from ${result.found} already-offline ` +
            `screen(s) — no notifications fired (cold start)`,
          );
        } else if (result.crossings > 0 || result.recovered > 0 || result.infraEvents > 0) {
          this.logger.log(
            `Offline scan: found=${result.found} crossings=${result.crossings} ` +
            `recovered=${result.recovered} notified=${result.notified} ` +
            `infraEvents=${result.infraEvents}`,
          );
        }
        // Customer alert emails — after the in-app scan, never able to fail it.
        if (this.alertEmails) {
          try {
            this.recordAlertTick(w, await this.alertEmails.onOfflineScan(result));
          } catch (e: any) {
            w.alertFailed++;
            this.logger.warn(`Customer alert emails tick failed: ${e?.message ?? e}`);
          }
        }
        this.logAliveOnce(true, result);
      } catch (e: any) {
        w.scanFailed++;
        this.logger.warn(`Offline scan failed: ${e?.message ?? e}`);
      } finally {
        this.running = false;
      }
    } finally {
      this.maybeSummarize();
    }
  }

  private recordAlertTick(w: SummaryWindow, t: CustomerAlertTickResult | undefined): void {
    if (!t) return;
    w.lastAlert = t;
    w.opened += t.opened ?? 0;
    w.held += t.held ?? 0;
    w.silenced += t.silenced ?? 0;
    w.recovered += t.recovered ?? 0;
    w.sends += t.sends ?? 0;
    if (t.platformIncident) w.platformIncidents++;
    if (t.gate) w.gated[t.gate] = (w.gated[t.gate] ?? 0) + 1;
  }

  /** The once-per-process proof that the scan runs — logged after the boot burst, so it survives Railway's limiter. */
  private logAliveOnce(leader: boolean, scan: OfflineScanResult | null): void {
    if (this.aliveLogged) return;
    this.aliveLogged = true;
    try {
      const role = leader
        ? `first scan ran as leader (offline=${scan?.found ?? 0})`
        : 'another replica holds the scan lease (this one follows)';
      const ownerMailer = this.alertEmails?.wiring?.().ownerMailer;
      const alerts = !this.alertEmails
        ? '[alert-email] NOT WIRED — no customer alert emails from this process'
        : `[alert-email] mode=${resolveAlertMode()}, owner mailer ${ownerMailer ? 'wired' : 'MISSING'}, ` +
          `PLATFORM_ALERT_EMAILS ${(process.env.PLATFORM_ALERT_EMAILS || '').includes('@') ? 'set' : 'unset (SUPER_ADMIN fallback)'}`;
      this.logger.log(
        `OfflineScreenScanner alive — ${role}; ${alerts}; pipeline summary every ${PIPELINE_SUMMARY_INTERVAL_MS / 60_000} min`,
      );
    } catch {
      /* a log line must never fail the tick */
    }
  }

  /** Every PIPELINE_SUMMARY_INTERVAL_MS: one line, counts only, then a fresh window. */
  private maybeSummarize(): void {
    try {
      const now = this.now();
      const w = this.window;
      if (!w || now - w.startedAt < PIPELINE_SUMMARY_INTERVAL_MS) return;
      const a = w.lastAlert;
      const mode = a?.mode ?? resolveAlertMode();
      const minutes = Math.round((now - w.startedAt) / 60_000);
      const last = a
        ? `offline=${w.lastFound ?? 0} due=${a.offlineDue ?? 0} tooOld=${a.offlineTooOld ?? 0} ` +
          `confirmed=${a.offlineCandidates} noContent=${a.noContentCandidates} gate=${a.gate ?? 'open'} ` +
          `deferred=${JSON.stringify(a.deferred ?? {})}`
        : `offline=${w.lastFound ?? 'n/a'} (${this.alertEmails ? 'alert worker did not run' : 'alert emails not wired'})`;
      this.logger.log(
        `[alert-email] pipeline summary (${minutes} min): mode=${mode} ` +
          `scans=${w.scans} leader=${w.leader} follower=${w.follower} skipped=${w.skipped} ` +
          `scanFailed=${w.scanFailed} alertFailed=${w.alertFailed} | ` +
          `sends=${w.sends} opened=${w.opened} held=${w.held} silenced=${w.silenced} recovered=${w.recovered} ` +
          `platformIncidents=${w.platformIncidents} gated=${JSON.stringify(w.gated)} | last scan: ${last}`,
      );
      this.window = newWindow(now);
    } catch {
      /* a log line must never fail the tick */
    }
  }
}
