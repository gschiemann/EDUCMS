import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { withTimeout } from '../health/with-timeout';

/**
 * EmergencyReadinessService — the "am I actually ready for a drill?"
 * computation (2026-08-24, trust-first UX program wave 4).
 *
 * READ-ONLY BY DESIGN. This service touches NOTHING in the trigger /
 * all-clear / audit path — it only observes state that already exists
 * (tenant playlist wiring, screen liveness + cache freshness, staff
 * capability flags, the last real exercise in the AuditLog, and the same
 * delivery-chain probes GET /health/emergency-path runs) and folds it into
 * one honest report a school office manager can read. The competitive gap
 * it closes: emergency vendors' own users say it's "difficult having
 * confidence in your alert setup" — this card IS that confidence, computed.
 *
 * Never cache this: an operator opening the emergency page deserves the
 * live truth, and the query cost is 5 small tenant-scoped queries + 3
 * sub-second probes.
 */

export type ReadinessStatus = 'ok' | 'warn' | 'missing';

export interface ReadinessItem {
  key: 'content' | 'delivery' | 'screens' | 'staff' | 'exercise';
  status: ReadinessStatus;
  label: string;
  /** One plain-English sentence of the observed state. */
  detail: string;
  /** One plain-English sentence of what to do about it (empty when ok). */
  fixHint: string;
}

export interface EmergencyReadinessReport {
  verdict: 'READY' | 'NEEDS_ATTENTION' | 'NOT_CONFIGURED';
  score: number; // 0-100, informational — the verdict is the contract
  items: ReadinessItem[];
  computedAt: string;
}

// Mirrors the fleet's own liveness convention (screens.controller.ts
// STALE_MS): a screen pinging within 35s is ONLINE.
const ONLINE_WITHIN_MS = 35 * 1000;
// Mirrors the wedge-detector convention: a content-fetch loop that hasn't
// reported its cache within 5 minutes is considered stuck.
const CACHE_FRESH_WITHIN_MS = 5 * 60 * 1000;
// A lockdown drill cadence schools actually follow; older than this reads
// as "you haven't exercised the system in a while", never as broken.
const EXERCISE_WARN_AFTER_DAYS = 90;

const PANIC_TYPES: Array<{ field: string; label: string }> = [
  { field: 'panicLockdownPlaylistId', label: 'Lockdown' },
  { field: 'panicSecurePlaylistId', label: 'Secure' },
  { field: 'panicHoldPlaylistId', label: 'Hold' },
  { field: 'panicEvacuatePlaylistId', label: 'Evacuate' },
  { field: 'panicWeatherPlaylistId', label: 'Weather' },
  { field: 'panicMedicalPlaylistId', label: 'Medical' },
];

@Injectable()
export class EmergencyReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly wsSigner: WebsocketSignerService,
  ) {}

  async compute(tenantId: string): Promise<EmergencyReadinessReport> {
    const now = Date.now();
    const onlineCutoff = new Date(now - ONLINE_WITHIN_MS);
    const cacheCutoff = new Date(now - CACHE_FRESH_WITHIN_MS);

    // Sequential on purpose — 5 tiny queries on a connection_limit=10 pool
    // beats a burst, and this endpoint is operator-paced (page open), not hot.
    const tenant = await this.prisma.client.tenant.findFirst({
      where: { id: tenantId },
      select: Object.fromEntries(PANIC_TYPES.map((t) => [t.field, true])) as any,
    });
    const totalScreens = await this.prisma.client.screen.count({ where: { tenantId } });
    const onlineScreens = await this.prisma.client.screen.count({
      where: { tenantId, lastPingAt: { gte: onlineCutoff } },
    });
    const cacheFreshScreens = await this.prisma.client.screen.count({
      where: { tenantId, lastPingAt: { gte: onlineCutoff }, lastCacheReportAt: { gte: cacheCutoff } },
    });
    const triggerCapableStaff = await this.prisma.client.user.count({
      where: {
        tenantId,
        OR: [
          { canTriggerPanic: true },
          { role: { in: ['DISTRICT_ADMIN', 'SCHOOL_ADMIN'] } },
        ],
      },
    });
    const lastTrigger = await this.prisma.client.auditLog.findFirst({
      where: { tenantId, action: 'TRIGGER_EMERGENCY' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    // ── Delivery-chain probes — the same three GET /health/emergency-path
    // runs (db reachability, realtime fan-out, message signer). Redis in
    // fallback is WARN, not MISSING: the HTTP-polling backstop still
    // delivers a lockdown, just slower — the copy says exactly that.
    let dbOk = false;
    try {
      await withTimeout(this.prisma.client.$queryRaw`SELECT 1`, 1500);
      dbOk = true;
    } catch { /* stays false */ }
    let redisState: 'ok' | 'fallback' | 'fail' = 'fallback';
    const pub = this.redis.publisher;
    if (pub && pub.status === 'ready') {
      try {
        const pong = await withTimeout(pub.ping(), 500);
        redisState = pong === 'PONG' ? 'ok' : 'fail';
      } catch { redisState = 'fail'; }
    }
    let signerOk = false;
    try {
      signerOk = !!this.wsSigner.signMessage('readiness.probe', { probe: true }).signature;
    } catch { /* stays false */ }

    const items: ReadinessItem[] = [];

    // 1. CONTENT — which of the six alert types have a playlist wired.
    const tenantRow = (tenant || {}) as Record<string, unknown>;
    const wired = PANIC_TYPES.filter((t) => !!tenantRow[t.field]);
    const missingTypes = PANIC_TYPES.filter((t) => !tenantRow[t.field]).map((t) => t.label);
    const lockdownWired = !!tenantRow['panicLockdownPlaylistId'];
    items.push({
      key: 'content',
      status: wired.length === PANIC_TYPES.length ? 'ok' : lockdownWired ? 'warn' : 'missing',
      label: 'Alert content wired',
      detail:
        wired.length === 0
          ? 'No alert type has content yet — a trigger would push nothing to your screens.'
          : `${wired.length} of ${PANIC_TYPES.length} alert types have content.`,
      fixHint:
        wired.length === PANIC_TYPES.length
          ? ''
          : lockdownWired
            ? `Assign content below for: ${missingTypes.join(', ')}.`
            : 'Start with Lockdown — assign its playlist or asset below.',
    });

    // 2. DELIVERY — db + realtime + signer.
    const deliveryStatus: ReadinessStatus =
      !dbOk || !signerOk ? 'missing' : redisState === 'ok' ? 'ok' : 'warn';
    items.push({
      key: 'delivery',
      status: deliveryStatus,
      label: 'Delivery chain',
      detail: !dbOk
        ? 'Database unreachable — triggers cannot be recorded or fanned out.'
        : !signerOk
          ? 'Message signer failed — screens would reject the alert.'
          : redisState === 'ok'
            ? 'Realtime push, polling backstop, and message signing all healthy.'
            : 'Realtime push is in fallback — alerts still deliver via polling, within ~20 seconds instead of instantly.',
      fixHint: deliveryStatus === 'ok' ? '' : deliveryStatus === 'warn'
        ? 'No action needed from you; platform is monitoring the realtime channel.'
        : 'Contact support — this is a platform fault, not your configuration.',
    });

    // 3. SCREENS — reachable AND their content loop alive.
    const screensStatus: ReadinessStatus =
      totalScreens === 0 ? 'missing'
      : onlineScreens === 0 ? 'missing'
      : onlineScreens < totalScreens || cacheFreshScreens < onlineScreens ? 'warn'
      : 'ok';
    items.push({
      key: 'screens',
      status: screensStatus,
      label: 'Screens ready to display',
      detail:
        totalScreens === 0
          ? 'No screens paired yet.'
          : `${onlineScreens} of ${totalScreens} screens online; ${cacheFreshScreens} confirmed fetching content.`,
      fixHint:
        screensStatus === 'ok' ? ''
        : totalScreens === 0 ? 'Pair a screen — an alert with no screens reaches no one.'
        : 'Check the offline screens on the Screens page; an offline screen shows its cached alert content only.',
    });

    // 4. STAFF — someone must be able to pull the trigger.
    items.push({
      key: 'staff',
      status: triggerCapableStaff >= 2 ? 'ok' : triggerCapableStaff === 1 ? 'warn' : 'missing',
      label: 'People who can trigger',
      detail: `${triggerCapableStaff} ${triggerCapableStaff === 1 ? 'person' : 'people'} can trigger an alert.`,
      fixHint:
        triggerCapableStaff >= 2 ? ''
        : triggerCapableStaff === 1 ? 'One person is a single point of failure — grant a second trusted staff member panic access in Team settings.'
        : 'Nobody can trigger an alert — grant panic access in Team settings.',
    });

    // 5. EXERCISE — when the system last actually fired (drill or real).
    const daysSince = lastTrigger
      ? Math.floor((now - new Date(lastTrigger.createdAt).getTime()) / 86_400_000)
      : null;
    items.push({
      key: 'exercise',
      status: daysSince === null ? 'warn' : daysSince <= EXERCISE_WARN_AFTER_DAYS ? 'ok' : 'warn',
      label: 'Last exercised',
      detail:
        daysSince === null
          ? 'This system has never been triggered — not even as a test.'
          : daysSince === 0
            ? 'Triggered today.'
            : `Last triggered ${daysSince} day${daysSince === 1 ? '' : 's'} ago.`,
      fixHint:
        daysSince !== null && daysSince <= EXERCISE_WARN_AFTER_DAYS
          ? ''
          : 'Run a test alert during a maintenance window so the first real use is never the first use.',
    });

    // Verdict: content + delivery are the life-safety-critical pair.
    const critical = items.filter((i) => i.key === 'content' || i.key === 'delivery');
    const verdict: EmergencyReadinessReport['verdict'] =
      critical.some((i) => i.status === 'missing')
        ? 'NOT_CONFIGURED'
        : items.some((i) => i.status !== 'ok')
          ? 'NEEDS_ATTENTION'
          : 'READY';
    const score = Math.round(
      (items.reduce((n, i) => n + (i.status === 'ok' ? 1 : i.status === 'warn' ? 0.5 : 0), 0) /
        items.length) * 100,
    );

    return { verdict, score, items, computedAt: new Date(now).toISOString() };
  }
}
