import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';

export type NotificationKind =
  | 'SCREEN_OFFLINE'
  | 'SYNC_FAILED'
  | 'EMERGENCY_TRIGGERED'
  | 'INVITE_ACCEPTED'
  | 'INFO'
  // Sprint 11 Phase B — cohort outage detection. Fires ONCE per
  // tenant per 5-min bucket when >50% of paired screens drop in
  // <90 s — almost always a WAN cut, ISP issue, or building power
  // event rather than a per-screen problem. We deliberately
  // SUPPRESS the per-screen SCREEN_OFFLINE notifications for the
  // affected tenant during the window so the operator sees one
  // signal, not fifty.
  | 'INFRA_EVENT';

export interface NotifyInput {
  tenantId: string;
  userId?: string | null;
  kind: NotificationKind;
  title: string;
  body?: string;
  link?: string;
  /** Optional dedupe key unique per tenant. Prevents duplicate notifications for the same underlying event. */
  dedupeKey?: string;
}

/** One row handed to the batched `Notification.createMany`. */
interface OfflineNotificationRow {
  tenantId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string;
  dedupeKey: string;
}

/**
 * Cross-restart state for transition-based offline detection. Mirrored to
 * Redis so a redeploy resumes instead of re-firing every offline screen.
 */
export interface OfflineTransitionState {
  v: 1;
  /** Screen ids already known to be offline (notified, or deliberately deferred). */
  offline: string[];
  /** Screen ids whose per-screen row was suppressed by an infra event and is still owed. */
  deferred: string[];
  /** Recent healthy→offline crossings, used for the cohort-outage window. */
  crossings: Array<{ id: string; at: number }>;
}

export interface OfflineScanResult {
  /** Screens currently matching the offline criteria (the candidate set size). */
  found: number;
  /** Notification rows actually created this scan. */
  notified: number;
  /** INFRA_EVENT rows created this scan. */
  infraEvents: number;
  /** Screens that crossed healthy → offline on this scan. */
  crossings: number;
  /** Screens that crossed offline → healthy on this scan. */
  recovered: number;
  /** True when this scan only seeded the baseline (cold start) and notified nothing. */
  seeded: boolean;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    // @Optional so unit tests (and any context without RealtimeModule) can
    // construct the service with Prisma alone. Without Redis the transition
    // state is process-local: correct, just not restart-durable.
    @Optional() private readonly redis?: RedisService,
  ) {}

  /**
   * Create a notification. If `dedupeKey` is provided and a row already exists
   * with the same (tenantId, dedupeKey), it is returned unchanged (no duplicate).
   */
  async notify(input: NotifyInput) {
    try {
      // Audit fix #11: previously findUnique→create wasn't atomic, so
      // two concurrent emitters with the same dedupeKey could both pass
      // the existence check and the second create would crash on the
      // unique constraint violation. Switch to upsert: the database
      // enforces atomicity and we get the existing row back when it
      // matches. When no dedupeKey is given we keep the plain create
      // (no constraint to upsert against).
      if (input.dedupeKey) {
        return await this.prisma.client.notification.upsert({
          where: {
            tenantId_dedupeKey: { tenantId: input.tenantId, dedupeKey: input.dedupeKey },
          },
          create: {
            tenantId: input.tenantId,
            userId: input.userId ?? null,
            kind: input.kind,
            title: input.title,
            body: input.body ?? null,
            link: input.link ?? null,
            dedupeKey: input.dedupeKey,
          },
          // No-op update preserves the original notification verbatim
          // (matches the prior "return existing" behavior).
          update: {},
        });
      }
      return await this.prisma.client.notification.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId ?? null,
          kind: input.kind,
          title: input.title,
          body: input.body ?? null,
          link: input.link ?? null,
          dedupeKey: null,
        },
      });
    } catch (err: any) {
      // Never let notification failures blow up the calling request.
      this.logger.warn(`[notify] failed: ${err?.message ?? err}`);
      return null;
    }
  }

  /**
   * List notifications visible to a given user:
   * - Direct (userId === user.id)
   * - Tenant-wide (userId === null) for the user's tenant
   */
  async listForUser(params: { tenantId: string; userId: string; limit?: number }) {
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
    return this.prisma.client.notification.findMany({
      where: {
        tenantId: params.tenantId,
        OR: [{ userId: params.userId }, { userId: null }],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async unreadCount(tenantId: string, userId: string): Promise<number> {
    return this.prisma.client.notification.count({
      where: {
        tenantId,
        isRead: false,
        OR: [{ userId }, { userId: null }],
      },
    });
  }

  async markRead(id: string, tenantId: string, userId: string) {
    // Only allow marking notifications the user can see.
    const n = await this.prisma.client.notification.findFirst({
      where: {
        id,
        tenantId,
        OR: [{ userId }, { userId: null }],
      },
    });
    if (!n) return { ok: false as const };
    await this.prisma.client.notification.update({
      where: { id, tenantId },
      data: { isRead: true },
    });
    return { ok: true as const };
  }

  async markAllRead(tenantId: string, userId: string) {
    const res = await this.prisma.client.notification.updateMany({
      where: {
        tenantId,
        isRead: false,
        OR: [{ userId }, { userId: null }],
      },
      data: { isRead: true },
    });
    return { updated: res.count };
  }

  // ───────────────────────────────────────────────────────────────────
  // Offline-screen detection — TRANSITION-BASED (2026-09-02 efficiency
  // remediation, audit P0-4).
  //
  // WHAT WAS WRONG. The scanner woke every 60 s, selected EVERY screen
  // matching the offline criteria (197 rows in production on 2026-09-02),
  // grouped them, looked up every affected tenant, rebuilt ~200-400
  // notification rows and handed them to
  // `Notification.createMany({ skipDuplicates })` — which the database then
  // threw away, because the (tenantId, dedupeKey) unique constraint had
  // already absorbed the identical batch a minute earlier. Only 5-13
  // genuinely new rows were created on a typical day. The dedupe key made
  // the OUTPUT correct and the WORK pointless: ~1,440 scans/day each doing
  // a findMany + a groupBy + a tenant findMany + a ~200-row multi-row INSERT
  // whose rows all conflicted. That INSERT is the repeated
  // `Notification.createMany` slow-query warning in the logs.
  //
  // WHAT IT DOES NOW. The scan reads the same bounded, indexed candidate
  // set and then compares it to the PREVIOUS scan's set:
  //
  //   crossed   = currentOffline \ knownOffline   → notify (exactly once)
  //   recovered = knownOffline \ currentOffline   → clear state
  //   steady    = intersection                    → NOTHING. No group, no
  //                                                 tenant lookup, no INSERT.
  //
  // In steady state a scan costs exactly ONE indexed SELECT and zero
  // writes. The groupBy / tenant.findMany / createMany only run on a tick
  // that actually has a transition to report.
  //
  // RESTART SAFETY. The known-offline set is mirrored to Redis
  // (`notif:offline-state:v1`), read ONCE per process at first scan and
  // written only when it changes (or hourly, to refresh the TTL). A restart
  // therefore resumes the previous state instead of re-firing 197
  // notifications. If there is no state at all (first ever run, expired key,
  // or Redis unavailable) the scan SEEDS from the current set and notifies
  // nothing — deliberately: the alternative is a notification storm on every
  // deploy.
  //
  // MULTI-REPLICA. Each replica keeps its own in-memory view, exactly as
  // each replica previously ran its own full scan. Two replicas that both
  // see the same crossing both build the row; the (tenantId, dedupeKey)
  // unique constraint + `skipDuplicates` collapses them to one — the same
  // guarantee that made the old design's output correct. Redis is a
  // durability mirror, not a lock.
  //
  // NO NEW NOTIFICATION KIND. There is no operator-visible "back online"
  // notification today and this change does not invent one; recovery is an
  // internal state transition (it clears the known-offline mark so the NEXT
  // drop fires exactly once) and is reported in the scan result for logging.
  // ───────────────────────────────────────────────────────────────────

  /** Redis key holding the cross-restart transition state. */
  private static readonly OFFLINE_STATE_KEY = 'notif:offline-state:v1';
  /** TTL on that key. Longer than any plausible deploy gap. */
  private static readonly OFFLINE_STATE_TTL_S = 24 * 60 * 60;
  /** Re-write an UNCHANGED state at most this often (TTL refresh only). */
  private static readonly OFFLINE_STATE_REFRESH_MS = 60 * 60 * 1000;
  /** Hard cap on ids we persist, so a huge fleet can't grow an unbounded key. */
  private static readonly OFFLINE_STATE_MAX_IDS = 20_000;

  /** In-memory transition state. `null` until the first scan resolves it. */
  private offlineState: OfflineTransitionState | null = null;
  /** Single-flight for the one-per-process Redis read. */
  private offlineStateRead: Promise<OfflineTransitionState | null> | null = null;
  /** Epoch-ms of the last Redis write (used for the TTL refresh cadence). */
  private offlineStatePersistedAt = 0;
  /** Fleet sizes carried from the cohort pass into the INFRA_EVENT copy. */
  private readonly lastFleetSize = new Map<string, number>();

  /**
   * Scan screens whose lastPingAt is older than `thresholdMinutes` and create
   * ONE offline notification per screen that JUST CROSSED from healthy to
   * offline (deduped via key, as before).
   *
   * Sprint 11 Phase B — cohort outage detection (behavior preserved). When
   * >= COHORT_PCT of a tenant's paired fleet crosses within COHORT_WINDOW_S
   * (default 50% / 90 s) the drop is treated as an infrastructure event
   * (WAN cut, ISP outage, building power): ONE INFRA_EVENT notification per
   * tenant per 5-min bucket, and the per-screen SCREEN_OFFLINE rows for that
   * tenant are suppressed so the operator sees one signal, not fifty.
   *
   * The cohort window is evaluated over a rolling log of the last
   * COHORT_WINDOW_S seconds of CROSSINGS rather than by re-deriving
   * "recently dropped" from lastPingAt on every scan. That is both cheaper
   * (no work at all when nothing crossed) and the only correct cadence: a
   * fleet-outage aggregation on a fixed 10-minute timer would miss the
   * 90-second cohort window entirely.
   *
   * A crossing suppressed by an infra event is DEFERRED, not dropped: once
   * the tenant is no longer in an infra event, a screen that is still
   * offline gets its per-screen row on a later tick. That reproduces what
   * operators saw before (infra event first, per-screen detail after the
   * cohort window closes) while still firing exactly once per screen.
   *
   * Returns counts so the wrapping scanner can log scan health.
   */
  async scanOfflineScreens(thresholdMinutes = 5): Promise<OfflineScanResult> {
    const COHORT_WINDOW_S = Number(process.env.COHORT_OUTAGE_WINDOW_S) || 90;
    const COHORT_PCT = Number(process.env.COHORT_OUTAGE_PCT) || 0.5;
    const COHORT_MIN_FLEET = Number(process.env.COHORT_OUTAGE_MIN_FLEET) || 3;
    const SCAN_LIMIT = Number(process.env.OFFLINE_SCAN_MAX_CANDIDATES) || 5_000;

    const now = Date.now();
    const offlineCutoff = new Date(now - thresholdMinutes * 60_000);

    // ── THE ONE READ ──────────────────────────────────────────────────
    // Bounded (`take`) and indexed: `status` and `lastPingAt` are both
    // covered by the screens indexes, and archived tenants are excluded at
    // the database rather than filtered in JS. Ordered newest-ping-first so
    // that if the cap ever truncates, the rows we keep are exactly the ones
    // that could still be transitioning; screens offline for hours (the
    // tail) are already in the known set.
    const offlineScreens = await this.prisma.client.screen.findMany({
      where: {
        tenantId: { not: null },
        status: { not: 'REVOKED' },
        lastPingAt: { lt: offlineCutoff },
        tenant: { is: { archivedAt: null } },
      },
      select: { id: true, name: true, tenantId: true, lastPingAt: true },
      orderBy: { lastPingAt: 'desc' },
      take: SCAN_LIMIT,
    });

    const truncated = offlineScreens.length >= SCAN_LIMIT;
    const byId = new Map(offlineScreens.map((s) => [s.id, s]));
    const currentOffline = new Set(offlineScreens.map((s) => s.id));

    const previous = await this.loadOfflineState();

    // ── COLD START ────────────────────────────────────────────────────
    // No prior state (first ever run, expired key, or Redis unavailable):
    // adopt the current set as the baseline and notify NOTHING. Firing for
    // every already-offline screen on every boot is precisely the storm
    // this rewrite exists to remove.
    if (!previous) {
      await this.persistOfflineState(
        { v: 1, offline: Array.from(currentOffline), deferred: [], crossings: [] },
        true,
      );
      return {
        found: offlineScreens.length,
        notified: 0,
        infraEvents: 0,
        crossings: 0,
        recovered: 0,
        seeded: true,
      };
    }

    const known = new Set(previous.offline);
    const crossed = offlineScreens.filter((s) => !known.has(s.id));
    // Recovery is only knowable when the candidate read was NOT truncated —
    // otherwise a screen beyond the cap looks "recovered" and would re-fire
    // the moment it reappears.
    const recovered = truncated
      ? []
      : Array.from(known).filter((id) => !currentOffline.has(id));

    // Rolling crossing log for the cohort window: prior crossings that are
    // still inside the window and still offline, plus this tick's.
    const windowStart = now - COHORT_WINDOW_S * 1000;
    const crossings: Array<{ id: string; at: number }> = [];
    for (const entry of previous.crossings) {
      if (entry.at >= windowStart && currentOffline.has(entry.id)) crossings.push(entry);
    }
    for (const s of crossed) crossings.push({ id: s.id, at: now });

    // Screens whose per-screen row was suppressed by an infra event and is
    // still owed — only while they are still offline.
    const deferred = previous.deferred.filter((id) => currentOffline.has(id));

    // ── COHORT CLASSIFICATION (only when something crossed) ───────────
    const infraEventTenants = new Set<string>();
    const droppedByTenant = new Map<string, Array<{ id: string; name: string }>>();
    if (crossings.length > 0) {
      for (const entry of crossings) {
        const screen = byId.get(entry.id);
        if (!screen?.tenantId) continue;
        const arr = droppedByTenant.get(screen.tenantId) ?? [];
        arr.push({ id: screen.id, name: screen.name });
        droppedByTenant.set(screen.tenantId, arr);
      }
      const cohortTenantIds = Array.from(droppedByTenant.keys());
      const fleetSize = cohortTenantIds.length
        ? await this.fleetSizes(cohortTenantIds)
        : new Map<string, number>();
      for (const [tenantId, dropped] of droppedByTenant.entries()) {
        const total = fleetSize.get(tenantId) ?? 0;
        if (total < COHORT_MIN_FLEET) continue;
        if (dropped.length / total >= COHORT_PCT) infraEventTenants.add(tenantId);
      }
      // Carry the sizes into the INFRA_EVENT copy below.
      for (const [tenantId, total] of fleetSize) this.lastFleetSize.set(tenantId, total);
    }

    // ── WHO GETS A PER-SCREEN ROW THIS TICK ───────────────────────────
    type OfflineCandidate = (typeof offlineScreens)[number];
    const owed: OfflineCandidate[] = [
      ...crossed,
      ...deferred
        .map((id) => byId.get(id))
        .filter((s): s is OfflineCandidate => !!s),
    ];
    const toNotify = owed.filter((s) => !!s.tenantId && !infraEventTenants.has(s.tenantId));
    const stillDeferred = owed
      .filter((s) => !!s.tenantId && infraEventTenants.has(s.tenantId))
      .map((s) => s.id);

    // Tenant name + parent, ONLY for tenants we are about to write for.
    const writeTenantIds = Array.from(
      new Set([...toNotify.map((s) => s.tenantId as string), ...infraEventTenants]),
    );
    const tenantMeta = writeTenantIds.length
      ? await this.tenantMeta(writeTenantIds)
      : new Map<string, { name: string; parentId: string | null }>();

    // Per-screen rows — SHAPE UNCHANGED from the pre-transition scanner
    // (title / body / link / dedupeKey are byte-identical, including the
    // hour bucket derived from lastPingAt and the HQ roll-up copy).
    const offlineRows: OfflineNotificationRow[] = [];
    for (const screen of toNotify) {
      const bucket = Math.floor((screen.lastPingAt?.getTime() ?? now) / (60 * 60 * 1000));
      const since = screen.lastPingAt?.toISOString() ?? 'unknown';
      offlineRows.push({
        tenantId: screen.tenantId as string,
        kind: 'SCREEN_OFFLINE',
        title: `Screen offline: ${screen.name}`,
        body: `No heartbeat since ${since}.`,
        link: `/screens`,
        dedupeKey: `screen-offline:${screen.id}:${bucket}`,
      });
      const meta = tenantMeta.get(screen.tenantId as string);
      if (meta?.parentId) {
        offlineRows.push({
          tenantId: meta.parentId,
          kind: 'SCREEN_OFFLINE',
          title: `${meta.name} · Screen offline: ${screen.name}`,
          body: `${meta.name}: no heartbeat from "${screen.name}" since ${since}.`,
          link: `/screens`,
          dedupeKey: `screen-offline-hq:${screen.id}:${bucket}`,
        });
      }
    }

    let notified = 0;
    if (offlineRows.length) {
      try {
        const res = await this.prisma.client.notification.createMany({
          data: offlineRows,
          skipDuplicates: true,
        });
        notified = res.count;
      } catch (err: any) {
        this.logger.warn(`[scanOfflineScreens] batch notify failed: ${err?.message ?? err}`);
      }
    }

    // ── INFRA_EVENT roll-up (shape unchanged, 5-min dedupe bucket) ────
    let infraEvents = 0;
    const fiveMinBucket = Math.floor(now / (5 * 60_000));
    for (const tenantId of infraEventTenants) {
      const dropped = droppedByTenant.get(tenantId) ?? [];
      const total = this.lastFleetSize.get(tenantId) ?? 0;
      const dedupeKey = `infra-event:${tenantId}:${fiveMinBucket}`;
      const result = await this.notify({
        tenantId,
        kind: 'INFRA_EVENT',
        title: `Possible infrastructure event — ${dropped.length}/${total} screens dropped`,
        body:
          `${dropped.length} screens went offline within ${COHORT_WINDOW_S} s ` +
          `(>${Math.round(COHORT_PCT * 100)}% of fleet). ` +
          `Likely WAN, ISP, or local power event — per-screen alerts suppressed. ` +
          `Affected: ${dropped.slice(0, 5).map((s) => s.name).join(', ')}${dropped.length > 5 ? '…' : ''}.`,
        link: `/screens`,
        dedupeKey,
      });
      if (result) infraEvents++;

      // HQ roll-up — surface the store's infra event to its parent too.
      const meta = tenantMeta.get(tenantId);
      if (meta?.parentId) {
        const hqResult = await this.notify({
          tenantId: meta.parentId,
          kind: 'INFRA_EVENT',
          title: `${meta.name} · Possible infrastructure event — ${dropped.length}/${total} screens dropped`,
          body:
            `${meta.name}: ${dropped.length} screens went offline within ${COHORT_WINDOW_S} s ` +
            `(>${Math.round(COHORT_PCT * 100)}% of that location's fleet). Likely WAN, ISP, or power.`,
          link: `/screens`,
          dedupeKey: `infra-event-hq:${tenantId}:${fiveMinBucket}`,
        });
        if (hqResult) infraEvents++;
      }
    }

    if (infraEventTenants.size > 0) {
      this.logger.log(
        `[cohort-outage] tenants=${infraEventTenants.size} ` +
        `suppressed-per-screen=${stillDeferred.length}`,
      );
    }

    // ── PERSIST THE NEW STATE ─────────────────────────────────────────
    // When the read was truncated we UNION rather than replace, so a screen
    // beyond the cap keeps its "already notified" mark.
    const nextOffline = truncated
      ? Array.from(new Set([...known, ...currentOffline]))
      : Array.from(currentOffline);
    const changed =
      crossed.length > 0 ||
      recovered.length > 0 ||
      stillDeferred.length !== previous.deferred.length ||
      crossings.length !== previous.crossings.length;
    await this.persistOfflineState(
      {
        v: 1,
        offline: nextOffline.slice(0, NotificationsService.OFFLINE_STATE_MAX_IDS),
        deferred: stillDeferred.slice(0, NotificationsService.OFFLINE_STATE_MAX_IDS),
        crossings: crossings.slice(-NotificationsService.OFFLINE_STATE_MAX_IDS),
      },
      changed,
    );

    return {
      found: offlineScreens.length,
      notified,
      infraEvents,
      crossings: crossed.length,
      recovered: recovered.length,
      seeded: false,
    };
  }

  /** Paired, non-revoked fleet size per tenant — only for tenants with a crossing. */
  private async fleetSizes(tenantIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    try {
      const rows = await this.prisma.client.screen.groupBy({
        by: ['tenantId'],
        where: { tenantId: { in: tenantIds }, status: { not: 'REVOKED' } },
        _count: { _all: true },
      });
      for (const row of rows as Array<{ tenantId: string | null; _count?: { _all?: number } }>) {
        if (row.tenantId) out.set(row.tenantId, row._count?._all ?? 0);
      }
    } catch (err: any) {
      this.logger.warn(`[scanOfflineScreens] fleet-size lookup failed: ${err?.message ?? err}`);
    }
    return out;
  }

  /** Tenant name + parentId — only for tenants we are about to write a row for. */
  private async tenantMeta(
    tenantIds: string[],
  ): Promise<Map<string, { name: string; parentId: string | null }>> {
    const out = new Map<string, { name: string; parentId: string | null }>();
    try {
      const rows = await this.prisma.client.tenant.findMany({
        where: { id: { in: tenantIds } },
        select: { id: true, name: true, parentId: true },
      });
      for (const t of rows) out.set(t.id, { name: t.name, parentId: t.parentId ?? null });
    } catch (err: any) {
      this.logger.warn(`[scanOfflineScreens] tenant lookup failed: ${err?.message ?? err}`);
    }
    return out;
  }

  /**
   * Resolve the transition state. Redis is read at most ONCE per process
   * (single-flight); after that the in-memory copy is authoritative and
   * Redis is write-only. Returns null when there is no prior state — the
   * caller then seeds silently.
   */
  private async loadOfflineState(): Promise<OfflineTransitionState | null> {
    if (this.offlineState) return this.offlineState;
    if (!this.offlineStateRead) this.offlineStateRead = this.readOfflineStateFromRedis();
    const loaded = await this.offlineStateRead;
    if (loaded) this.offlineState = loaded;
    return this.offlineState;
  }

  private async readOfflineStateFromRedis(): Promise<OfflineTransitionState | null> {
    const pub = this.redis?.publisher;
    if (!pub) return null;
    try {
      const raw = await pub.get(NotificationsService.OFFLINE_STATE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<OfflineTransitionState>;
      if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.offline)) return null;
      const asStrings = (v: unknown): string[] =>
        Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
      const asCrossings = (v: unknown): Array<{ id: string; at: number }> =>
        Array.isArray(v)
          ? v.filter(
              (x): x is { id: string; at: number } =>
                !!x &&
                typeof (x as { id?: unknown }).id === 'string' &&
                typeof (x as { at?: unknown }).at === 'number',
            )
          : [];
      return {
        v: 1,
        offline: asStrings(parsed.offline),
        deferred: asStrings(parsed.deferred),
        crossings: asCrossings(parsed.crossings),
      };
    } catch (err: any) {
      this.logger.warn(`[scanOfflineScreens] state read failed: ${err?.message ?? err}`);
      return null;
    }
  }

  /**
   * Mirror the state to Redis. Written when it CHANGED, or once an hour to
   * refresh the TTL — so a steady fleet costs zero Redis writes per scan.
   * Best-effort: a Redis failure degrades restart-durability, never the scan.
   */
  private async persistOfflineState(
    next: OfflineTransitionState,
    changed: boolean,
  ): Promise<void> {
    this.offlineState = next;
    const pub = this.redis?.publisher;
    if (!pub) return;
    const now = Date.now();
    if (
      !changed &&
      now - this.offlineStatePersistedAt < NotificationsService.OFFLINE_STATE_REFRESH_MS
    ) {
      return;
    }
    this.offlineStatePersistedAt = now;
    try {
      await pub.set(
        NotificationsService.OFFLINE_STATE_KEY,
        JSON.stringify(next),
        'EX',
        NotificationsService.OFFLINE_STATE_TTL_S,
      );
    } catch (err: any) {
      this.logger.warn(`[scanOfflineScreens] state write failed: ${err?.message ?? err}`);
    }
  }
}
