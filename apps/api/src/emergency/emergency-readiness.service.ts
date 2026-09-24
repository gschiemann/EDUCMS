import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { withTimeout } from '../health/with-timeout';
import {
  VERTICAL_EMERGENCY_TYPES,
  effectiveEmergencyEnabled,
  emergencyEnablementLocked,
  emergencyVerticalStated,
  normalizeVertical,
} from '@cms/api-types';

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

/**
 * READY / NEEDS_ATTENTION / NOT_CONFIGURED grade a capability that is ON.
 *
 * DISABLED (2026-09-24) means the capability is OFF for this tenant and
 * NOTHING was graded. Resolved by `effectiveEmergencyEnabled`: K-12 is always
 * on; every other vertical is off until an admin turns it on (Settings →
 * Emergency). Before this verdict existed the report graded every tenant as
 * if alerts were on, so a bar, a gym or a print shop that had never opened
 * the emergency settings was told — in red, worst-first, on its dashboard —
 * that it "can't display an emergency alert". Greg: "why are we showing an
 * alert that we cant play emergency content but i havent even enabled it?"
 * DISABLED is not a failure state and no surface may draw it as one.
 */
export type EmergencyReadinessVerdict =
  | 'READY'
  | 'NEEDS_ATTENTION'
  | 'NOT_CONFIGURED'
  | 'DISABLED';

export interface EmergencyReadinessReport {
  verdict: EmergencyReadinessVerdict;
  /** The effective enablement the verdict was graded under (false ⇔ DISABLED). */
  enabled: boolean;
  /**
   * False when the organization never stated an industry (2026-09-24): the
   * grade then assumes a school. The dashboard says so instead of "can't
   * display an emergency alert", and points at Settings → Organization.
   */
  verticalStated: boolean;
  /** True when this vertical may never turn the capability off (K-12). */
  locked: boolean;
  score: number; // 0-100, informational — the verdict is the contract
  items: ReadinessItem[];
  computedAt: string;
}

/** One child school's readiness as the DISTRICT rollup reports it. */
export interface DistrictSchoolReadiness {
  tenantId: string;
  name: string;
  slug: string;
  /** True for the district's own tenant row (the office), false for a child. */
  isSelf: boolean;
  verdict: EmergencyReadinessVerdict;
  /** Effective enablement (see EmergencyReadinessVerdict). false ⇔ DISABLED. */
  enabled: boolean;
  /** False when this location never stated an industry — graded as a school by default. */
  verticalStated: boolean;
  /** K-12 lock: the capability cannot be turned off for this location. */
  locked: boolean;
  /** How many of THIS vertical's required alert types have content wired. */
  contentWired: number;
  /** The vertical's required-type count (6 for K12, 3 for a gym, ...). */
  contentTotal: number;
  /** The anchor type (Lockdown where the vertical has it, else Evacuate). */
  anchorLabel: string;
  anchorWired: boolean;
  /** Back-compat alias of anchorWired (older bundles read this name). */
  lockdownWired: boolean;
  /** Alert types with no content, by label — the fix list, verbatim. */
  missingTypes: string[];
  screensTotal: number;
  screensOnline: number;
}

export interface DistrictReadinessReport {
  /**
   * The delivery-chain verdict, computed ONCE. db / realtime / signer are
   * PLATFORM-global — they are identical for every school in the district,
   * so probing them per-school would be N× the cost for the same answer.
   */
  delivery: ReadinessItem;
  schools: DistrictSchoolReadiness[];
  /**
   * Schools that are ON and not READY — the number the dashboard leads with.
   * A DISABLED school is neither ready nor not-ready; it is not graded.
   */
  notReadyCount: number;
  /** Schools whose capability is off (verdict DISABLED). */
  disabledCount: number;
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
  { field: 'panicEvacuatePlaylistId', label: 'Fire / Evacuate' },
  { field: 'panicWeatherPlaylistId', label: 'Weather' },
  { field: 'panicMedicalPlaylistId', label: 'Medical' },
];

/** Panic-type key → the tenant column + human label it lives behind. */
const TYPE_TO_FIELD: Record<string, { field: string; label: string }> = {
  lockdown: { field: 'panicLockdownPlaylistId', label: 'Lockdown' },
  secure:   { field: 'panicSecurePlaylistId',   label: 'Secure' },
  hold:     { field: 'panicHoldPlaylistId',     label: 'Hold' },
  evacuate: { field: 'panicEvacuatePlaylistId', label: 'Fire / Evacuate' },
  weather:  { field: 'panicWeatherPlaylistId',  label: 'Weather' },
  medical:  { field: 'panicMedicalPlaylistId',  label: 'Medical' },
};

/**
 * The alert set THIS tenant's vertical is graded against (2026-08-30 —
 * operator: a GYM was warned it "can't run a lockdown"). K12 keeps the
 * full six; every other vertical is graded ONLY on the types
 * VERTICAL_EMERGENCY_TYPES declares for it (a gym: evacuate + weather +
 * medical). The settings page still OFFERS every type — grading and
 * offering are deliberately different bars: opting into more types must
 * never make a ready tenant read as broken.
 *
 * The ANCHOR is the type the "start here" copy and the missing/warn
 * gate key on: lockdown where the vertical carries it, else the
 * vertical's first declared type (evacuate everywhere today).
 */
/**
 * The enablement facts a verdict is graded under. Pure and shared with the
 * dashboard (`@cms/api-types`), so the API and the UI can never disagree about
 * whether a tenant's alerts are on. NULL in the column means "never stated",
 * which resolves to the vertical's default — that is the whole reason a
 * never-configured gym is OFF rather than "not ready".
 */
function resolveEnablement(
  row:
    | { vertical?: unknown; emergencyEnabled?: boolean | null }
    | null
    | undefined,
): { enabled: boolean; locked: boolean; verticalStated: boolean } {
  const vertical = row?.vertical ?? null;
  const stored =
    typeof row?.emergencyEnabled === 'boolean' ? row.emergencyEnabled : null;
  return {
    enabled: effectiveEmergencyEnabled(vertical, stored),
    locked: emergencyEnablementLocked(vertical),
    verticalStated: emergencyVerticalStated(vertical),
  };
}

function requiredTypesFor(rawVertical: unknown): {
  required: Array<{ field: string; label: string }>;
  anchor: { field: string; label: string };
} {
  const vertical = normalizeVertical(rawVertical);
  const keys = VERTICAL_EMERGENCY_TYPES[vertical] ?? VERTICAL_EMERGENCY_TYPES.K12;
  const required = keys.map((k) => TYPE_TO_FIELD[k]).filter(Boolean);
  const anchor = keys.includes('lockdown') ? TYPE_TO_FIELD.lockdown : TYPE_TO_FIELD[keys[0]] ?? TYPE_TO_FIELD.evacuate;
  return { required, anchor };
}

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
      select: {
        vertical: true,
        emergencyEnabled: true,
        ...Object.fromEntries(PANIC_TYPES.map((t) => [t.field, true])),
      } as any,
    });
    // OFF is not "not ready" — it is not graded at all. Answer before any
    // probe runs: a tenant with alerts off owes the operator no checklist, and
    // the readiness endpoints must never manufacture one (see the verdict doc).
    const enablement = resolveEnablement(
      tenant as {
        vertical?: unknown;
        emergencyEnabled?: boolean | null;
      } | null,
    );
    if (!enablement.enabled) {
      return {
        verdict: 'DISABLED',
        enabled: false,
        locked: enablement.locked,
        verticalStated: enablement.verticalStated,
        score: 0,
        items: [],
        computedAt: new Date(now).toISOString(),
      };
    }
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
    // runs (db reachability, realtime fan-out, message signer). Extracted to
    // probeDelivery() so the DISTRICT rollup can run them ONCE for the whole
    // district instead of once per school; the behavior here is unchanged.
    const deliveryItem = await this.probeDelivery();

    const items: ReadinessItem[] = [];

    // 1. CONTENT — which of the six alert types have a playlist wired.
    const tenantRow = (tenant || {}) as Record<string, unknown>;
    // Graded against THIS vertical's required set — never K12's six.
    const { required, anchor } = requiredTypesFor(tenantRow['vertical']);
    const wired = required.filter((t) => !!tenantRow[t.field]);
    const missingTypes = required.filter((t) => !tenantRow[t.field]).map((t) => t.label);
    const anchorWired = !!tenantRow[anchor.field];
    items.push({
      key: 'content',
      status: wired.length === required.length ? 'ok' : anchorWired ? 'warn' : 'missing',
      label: 'Alert content wired',
      // 2026-09-21 (launch re-audit B1): this used to say a trigger "would push
      // nothing to your screens". False, in the direction that makes an
      // operator UNDER-estimate a panic press: the manifest's bulletproof
      // fallback (screens.controller.ts, `DEFAULT_EMERGENCY`) locks every
      // screen to a plain red full-canvas board carrying a generic
      // "<TYPE> PROTOCOL ACTIVE" message whenever no content is wired.
      detail:
        wired.length === 0
          ? 'No alert type has content yet — a trigger still locks every screen to a plain red alert with a generic message, not one of yours.'
          : `${wired.length} of ${required.length} alert types have content.`,
      fixHint:
        wired.length === required.length
          ? ''
          : anchorWired
            ? `Assign content below for: ${missingTypes.join(', ')}.`
            : `Start with ${anchor.label} — assign its playlist or asset below.`,
    });

    // 2. DELIVERY — db + realtime + signer (probed above, once).
    items.push(deliveryItem);

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

    return {
      verdict,
      enabled: true,
      locked: enablement.locked,
      verticalStated: enablement.verticalStated,
      score,
      items,
      computedAt: new Date(now).toISOString(),
    };
  }

  /**
   * DISTRICT rollup — "which of my schools could NOT run a lockdown right
   * now?", answered in a FIXED number of queries no matter how many schools
   * the district has (2026-08-24, district command-center wave).
   *
   * ── WHAT THIS VERDICT INCLUDES ──────────────────────────────────────
   *   • CONTENT  — per school, which of the six alert types have a playlist
   *                wired. ONE findMany over the district's own row + its
   *                direct children, selecting only the six panic id columns.
   *   • SCREENS  — per school, total paired and currently-online. TWO
   *                groupBy queries (total, online) over the same tenant-id
   *                set — never one query per school.
   *   • DELIVERY — db reachability + realtime fan-out + message signer.
   *                PLATFORM-global, so probed exactly ONCE and returned at
   *                the district level; it is the same answer for every
   *                school and probing per-school would be N× the cost.
   *
   * ── WHAT IT DELIBERATELY DOES *NOT* INCLUDE ─────────────────────────
   *   • STAFF ("who can trigger") and EXERCISE ("last drill") — both are
   *     per-school reads over `users` / `audit_logs` that have no cheap
   *     grouped form here, and neither answers "can this school display an
   *     alert right now". They stay on the school's OWN readiness card
   *     (GET /emergency/readiness after switching into that school), which
   *     is one tap away from every scorecard row.
   *   • The screens signal is ONLINE-only — the single-school card's extra
   *     "confirmed fetching content" (cache-freshness) refinement is not
   *     recomputed here. A school reading READY in the district rollup can
   *     still read NEEDS_ATTENTION on its own card for that reason; the
   *     district number is deliberately the coarser, cheaper one.
   *
   * ── QUERY COST ──────────────────────────────────────────────────────
   *   3 DB queries + 1 `SELECT 1` probe + 1 Redis PING + 1 in-process
   *   signature. FLAT in school count: a 40-school district costs exactly
   *   what a 3-school district costs. This matters — the pool is
   *   connection_limit=10, and a 5-queries-per-school fan-out would put a
   *   40-school district at 200 queries per dashboard open.
   *
   * READ-ONLY, like every other line in this file. Archived children are
   * excluded, matching `GET /screens/fleet` and the emergency fan-out walk.
   */
  async computeDistrict(rootTenantId: string): Promise<DistrictReadinessReport> {
    const now = Date.now();
    const onlineCutoff = new Date(now - ONLINE_WITHIN_MS);

    // 1 query — the district's own row plus its direct, non-archived
    // children, selecting ONLY what the verdict needs.
    const tenants = await this.prisma.client.tenant.findMany({
      where: {
        OR: [{ id: rootTenantId }, { parentId: rootTenantId, archivedAt: null }],
      },
      select: {
        id: true,
        name: true,
        slug: true,
        vertical: true,
        emergencyEnabled: true,
        ...(Object.fromEntries(PANIC_TYPES.map((t) => [t.field, true])) as Record<string, true>),
      } as any,
      orderBy: { name: 'asc' },
    });
    const tenantIds = tenants.map((t: any) => t.id as string);

    // 2 queries — screens per school. groupBy, never a per-school count().
    const [totalRows, onlineRows] = await Promise.all([
      this.prisma.client.screen.groupBy({
        by: ['tenantId'],
        where: { tenantId: { in: tenantIds } },
        _count: { _all: true },
      }),
      this.prisma.client.screen.groupBy({
        by: ['tenantId'],
        where: { tenantId: { in: tenantIds }, lastPingAt: { gte: onlineCutoff } },
        _count: { _all: true },
      }),
    ]);
    const totalByTenant = new Map<string, number>(
      totalRows.map((r: any) => [r.tenantId as string, r._count._all as number]),
    );
    const onlineByTenant = new Map<string, number>(
      onlineRows.map((r: any) => [r.tenantId as string, r._count._all as number]),
    );

    // 1 probe set — shared by every school (see the header note).
    const delivery = await this.probeDelivery();

    const schools: DistrictSchoolReadiness[] = tenants.map((row: any) => {
      const enablement = resolveEnablement(row);
      // Per-vertical grading (2026-08-30): a gym is graded on evacuate +
      // weather + medical, never on K12's lockdown set.
      const { required, anchor } = requiredTypesFor(row.vertical);
      const wired = required.filter((t) => !!row[t.field]);
      const missingTypes = required.filter((t) => !row[t.field]).map((t) => t.label);
      const anchorWired = !!row[anchor.field];
      const contentStatus: ReadinessStatus =
        wired.length === required.length ? 'ok' : anchorWired ? 'warn' : 'missing';

      const screensTotal = totalByTenant.get(row.id as string) ?? 0;
      const screensOnline = onlineByTenant.get(row.id as string) ?? 0;
      // Mirrors compute()'s screens rule MINUS the cache-freshness leg.
      const screensStatus: ReadinessStatus =
        screensTotal === 0 ? 'missing'
        : screensOnline === 0 ? 'missing'
        : screensOnline < screensTotal ? 'warn'
        : 'ok';

      // Verdict precedence, mirroring compute():
      //   - content missing (no lockdown content at all) is NOT_CONFIGURED;
      //   - a BROKEN delivery chain (db/signer down) is a platform fault that
      //     makes every school genuinely un-alertable, so it forces
      //     NOT_CONFIGURED district-wide;
      //   - a delivery WARN (Redis in polling fallback) does NOT downgrade
      //     any school — the alert still lands, just via the ~20s HTTP
      //     backstop. Letting it repaint 40 rows amber would drown the
      //     per-school signal this rollup exists to surface, so it is
      //     reported once at the district level instead.
      //   - a location whose capability is OFF is DISABLED: nothing above
      //     applies to it, and it must not surface as a gap anywhere. Wiring
      //     facts still ride along (they are true), but the fix list is empty
      //     because there is nothing to fix until someone turns alerts on.
      const verdict: EmergencyReadinessVerdict = !enablement.enabled
        ? 'DISABLED'
        : contentStatus === 'missing' || delivery.status === 'missing'
          ? 'NOT_CONFIGURED'
          : contentStatus !== 'ok' || screensStatus !== 'ok'
            ? 'NEEDS_ATTENTION'
            : 'READY';

      return {
        tenantId: row.id as string,
        name: row.name as string,
        slug: row.slug as string,
        isSelf: (row.id as string) === rootTenantId,
        verdict,
        enabled: enablement.enabled,
        locked: enablement.locked,
        verticalStated: enablement.verticalStated,
        contentWired: wired.length,
        contentTotal: required.length,
        anchorLabel: anchor.label,
        anchorWired,
        lockdownWired: anchorWired,
        missingTypes: verdict === 'DISABLED' ? [] : missingTypes,
        screensTotal,
        screensOnline,
      };
    });

    return {
      delivery,
      schools,
      notReadyCount: schools.filter(
        (s) => s.verdict !== 'READY' && s.verdict !== 'DISABLED',
      ).length,
      disabledCount: schools.filter((s) => s.verdict === 'DISABLED').length,
      computedAt: new Date(now).toISOString(),
    };
  }

  /**
   * The three delivery-chain probes GET /health/emergency-path runs, folded
   * into the readiness item both compute() and computeDistrict() report.
   *
   * Redis in fallback is WARN, not MISSING: the HTTP-polling backstop still
   * delivers a lockdown, just slower — the copy says exactly that.
   */
  private async probeDelivery(): Promise<ReadinessItem> {
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

    const deliveryStatus: ReadinessStatus =
      !dbOk || !signerOk ? 'missing' : redisState === 'ok' ? 'ok' : 'warn';
    return {
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
    };
  }
}
