/**
 * The customer's bell (2026-10-24) — what `GET /api/v1/notifications` answers
 * a customer with, and the unread count on the bell and the phone's Home tab.
 *
 * The owner's own bell read 31. Every one of them was a row the scanner wrote
 * honestly, and almost none was something to act on:
 *   - 19 × SCREEN_PUSH_DEAD — "realtime down AND content unproven — needs
 *     attention now", once a day for the same screen since September. A
 *     VenueOS health signal, not a customer's task: owner-only now
 *     (`OWNER_ONLY_NOTIFICATION_KINDS`).
 *   - 11 × SCREEN_OFFLINE for ONE screen — one row per outage since 09-23;
 *     ten of those outages ended weeks ago. Only the NEWEST row per screen is
 *     listed now, and it counts as unread only while that screen is still
 *     DOWN (not back online, not off on purpose, not 30+ days silent).
 *   - 1 × SCREEN_OFFLINE for a phone-browser test screen silent since Aug 6.
 * After: 1 — the screen that really is offline.
 *
 * The same reading applies to the site-wide drop (INFRA_EVENT): one row per
 * location, unread only while screens there are still down, and HIDDEN when
 * the drop was ours — the same moment hit three or more organisations (the
 * customer alert emails' platform-incident rule: on 2026-10-23 a credential
 * rotation produced this notification in 53 organisations at 05:49Z).
 *
 * NOTHING IS DELETED OR MARKED. This is a projection of the rows: a resolved
 * row is returned with `isRead: true` (there is nothing left to read) and a
 * `health` note saying why, the database row is untouched, and the owner reads
 * the raw table with `?audience=owner`.
 */
import {
  OWNER_ONLY_NOTIFICATION_KINDS,
} from '@cms/api-types';
import { ALERT_RULES } from './customer-alerts/customer-alert-policy';
import { ScreenAttentionService } from './screen-attention/screen-attention.service';
import { classifyOfflineScreen, type AttentionVerdict } from './screen-attention/screen-attention-policy';

const DAY = 24 * 60 * 60 * 1000;

/** How many recent rows the inbox reads to supersede and count. */
export const INBOX_WINDOW = 400;
/** A screen-health row older than this never counts as unread (it is history). */
export const HEALTH_UNREAD_MAX_AGE_MS = 30 * DAY;

export type HealthState = 'offline' | 'back-online' | 'resting' | 'dormant' | 'removed';

/** What a screen-health notification is about RIGHT NOW. */
export interface NotificationHealth {
  state: HealthState;
  /** resting / dormant reason (`screen-attention-policy.ts`). */
  reason: string | null;
  screenId: string | null;
  screenName: string | null;
  lastSeenAt: string | null;
}

export interface InboxRow {
  id: string;
  tenantId: string;
  userId: string | null;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  isRead: boolean;
  dedupeKey: string | null;
  createdAt: Date;
  [extra: string]: unknown;
}

/** `screen-offline:<screenId>:<bucket>` / `screen-offline-hq:<screenId>:<bucket>`. */
export function offlineScreenIdOf(dedupeKey: string | null | undefined): string | null {
  const m = /^screen-offline(?:-hq)?:([^:]+):/.exec(String(dedupeKey ?? ''));
  return m ? m[1] : null;
}

/** `infra-event:<tenantId>:<bucket>` (the site itself) / `infra-event-hq:<childTenantId>:<bucket>`. */
export function infraSiteOf(dedupeKey: string | null | undefined): { siteTenantId: string; rollup: boolean } | null {
  const m = /^infra-event(-hq)?:([^:]+):/.exec(String(dedupeKey ?? ''));
  return m ? { siteTenantId: m[2], rollup: !!m[1] } : null;
}

function stateOf(v: AttentionVerdict | undefined): HealthState {
  if (!v || v.bucket === 'down') return 'offline';
  return v.bucket === 'resting' ? 'resting' : 'dormant';
}

/**
 * Was the INFRA_EVENT at `atMs` part of a PLATFORM incident? `around` is every
 * site-level INFRA_EVENT (any organisation) near it; `rootOf` maps a tenant to
 * its organisation. Mirrors `platformClusterAround`'s organisation rule.
 */
export function infraWasPlatformWide(
  atMs: number,
  around: ReadonlyArray<{ tenantId: string; createdAt: Date }>,
  rootOf: (tenantId: string) => string,
): boolean {
  const w = ALERT_RULES.PLATFORM_CLUSTER_MS;
  const orgs = new Set<string>();
  for (const r of around) {
    if (Math.abs(r.createdAt.getTime() - atMs) <= w) orgs.add(rootOf(r.tenantId));
  }
  return orgs.size >= ALERT_RULES.PLATFORM_MIN_ORGS;
}

export async function buildCustomerInbox(
  deps: { prisma: any; attention?: ScreenAttentionService | null; nowMs?: number },
  params: { tenantId: string; userId: string; limit?: number },
): Promise<{ items: Array<InboxRow & { health?: NotificationHealth }>; unreadCount: number }> {
  const nowMs = deps.nowMs ?? Date.now();
  const c = deps.prisma.client;
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);

  const rows = (await c.notification.findMany({
    where: {
      tenantId: params.tenantId,
      OR: [{ userId: params.userId }, { userId: null }],
      kind: { notIn: [...OWNER_ONLY_NOTIFICATION_KINDS] },
    },
    orderBy: { createdAt: 'desc' },
    take: INBOX_WINDOW,
  })) as InboxRow[];

  // ── Supersede: the newest row per screen / per site is the one that speaks.
  const seenScreen = new Set<string>();
  const seenSite = new Set<string>();
  const visible: InboxRow[] = [];
  for (const r of rows) {
    if (r.kind === 'SCREEN_OFFLINE') {
      const sid = offlineScreenIdOf(r.dedupeKey);
      if (sid) {
        if (seenScreen.has(sid)) continue;
        seenScreen.add(sid);
      }
    } else if (r.kind === 'INFRA_EVENT') {
      const site = infraSiteOf(r.dedupeKey);
      if (site) {
        if (seenSite.has(site.siteTenantId)) continue;
        seenSite.add(site.siteTenantId);
      }
    }
    visible.push(r);
  }

  // ── The scope a parent's roll-up rows can name (self + direct children).
  let readable: string[] = [params.tenantId];
  try {
    const kids = await c.tenant.findMany({
      where: { parentId: params.tenantId, archivedAt: null },
      select: { id: true },
    });
    readable = [params.tenantId, ...kids.map((k: { id: string }) => k.id)];
  } catch {
    /* children unknown → roll-up rows read as "removed"; never fatal */
  }

  // ── Platform-wide drops are ours, not the customer's: hide them.
  const infraRows = visible.filter((r) => r.kind === 'INFRA_EVENT');
  const hidden = new Set<string>();
  if (infraRows.length > 0) {
    try {
      const times = infraRows.map((r) => r.createdAt.getTime());
      const w = ALERT_RULES.PLATFORM_CLUSTER_MS;
      // ten-ok: an aggregate COUNT of organisations hit at the same moment —
      // only tenantId + time are read, nothing of another tenant is returned.
      const around = (await c.notification.findMany({
        where: {
          kind: 'INFRA_EVENT',
          dedupeKey: { startsWith: 'infra-event:' },
          createdAt: { gte: new Date(Math.min(...times) - w), lte: new Date(Math.max(...times) + w) },
        },
        select: { tenantId: true, createdAt: true },
        take: 2_000,
      })) as Array<{ tenantId: string; createdAt: Date }>;
      const tenantIds = [...new Set(around.map((a) => a.tenantId))];
      const parents = new Map<string, string | null>();
      if (tenantIds.length) {
        const ts = await c.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, parentId: true } });
        for (const t of ts) parents.set(t.id, t.parentId ?? null);
      }
      const rootOf = (id: string) => parents.get(id) ?? id;
      for (const r of infraRows) {
        if (infraWasPlatformWide(r.createdAt.getTime(), around, rootOf)) hidden.add(r.id);
      }
    } catch {
      /* the check could not run: show the row (never hide a real outage on a failed read) */
    }
  }
  const shown = visible.filter((r) => !hidden.has(r.id));

  // ── What each screen-health row's screen is doing now.
  const screenIds = [...new Set(shown.filter((r) => r.kind === 'SCREEN_OFFLINE').map((r) => offlineScreenIdOf(r.dedupeKey)).filter((x): x is string => !!x))];
  const siteIds = [...new Set(shown.filter((r) => r.kind === 'INFRA_EVENT').map((r) => infraSiteOf(r.dedupeKey)?.siteTenantId).filter((x): x is string => !!x))];
  type ScreenRow = { id: string; name: string; tenantId: string | null; lastPingAt: Date | null; hardwareModel: string | null; osInfo: string | null; playerVersion: string | null; status: string };
  const select = { id: true, name: true, tenantId: true, lastPingAt: true, hardwareModel: true, osInfo: true, playerVersion: true, status: true };
  let screens: ScreenRow[] = [];
  let siteScreens: ScreenRow[] = [];
  try {
    [screens, siteScreens] = await Promise.all([
      screenIds.length
        ? c.screen.findMany({ where: { id: { in: screenIds }, tenantId: { in: readable } }, select })
        : Promise.resolve([]),
      siteIds.length
        ? c.screen.findMany({
            where: { tenantId: { in: siteIds.filter((s) => readable.includes(s)) }, status: { notIn: ['REVOKED', 'PENDING'] } },
            select,
            take: 5_000,
          })
        : Promise.resolve([]),
    ]);
  } catch {
    screens = [];
    siteScreens = [];
  }
  const byId = new Map(screens.map((s) => [s.id, s]));
  const offline = [...screens, ...siteScreens].filter(
    (s, i, all) => !ScreenAttentionService.isAlive(s.lastPingAt, nowMs) && all.findIndex((x) => x.id === s.id) === i,
  );
  // Without the service (or if it fails) the row alone still decides dormant;
  // nothing is ever judged "off on purpose" without its facts.
  const rowOnly = () => new Map(offline.map((s) => [s.id, classifyOfflineScreen(s, null, nowMs)] as const));
  let verdicts: Map<string, AttentionVerdict> = rowOnly();
  if (offline.length && deps.attention) {
    try {
      verdicts = await deps.attention.classify(offline, nowMs);
    } catch {
      verdicts = rowOnly();
    }
  }
  const siteDown = new Set<string>();
  for (const s of siteScreens) {
    if (!ScreenAttentionService.isAlive(s.lastPingAt, nowMs) && stateOf(verdicts.get(s.id)) === 'offline' && s.tenantId) {
      siteDown.add(s.tenantId);
    }
  }

  const items = shown.map((r) => {
    if (r.kind !== 'SCREEN_OFFLINE' && r.kind !== 'INFRA_EVENT') return r;
    const tooOld = nowMs - r.createdAt.getTime() > HEALTH_UNREAD_MAX_AGE_MS;
    let health: NotificationHealth;
    if (r.kind === 'SCREEN_OFFLINE') {
      const sid = offlineScreenIdOf(r.dedupeKey);
      const s = sid ? byId.get(sid) : undefined;
      if (!s) {
        health = { state: 'removed', reason: null, screenId: sid, screenName: null, lastSeenAt: null };
      } else {
        const alive = ScreenAttentionService.isAlive(s.lastPingAt, nowMs);
        const v = verdicts.get(s.id);
        health = {
          state: alive ? 'back-online' : stateOf(v),
          reason: !alive && v && v.bucket !== 'down' ? v.reason : null,
          screenId: s.id,
          screenName: s.name,
          lastSeenAt: s.lastPingAt ? s.lastPingAt.toISOString() : null,
        };
      }
    } else {
      const site = infraSiteOf(r.dedupeKey);
      health = {
        state: site && siteDown.has(site.siteTenantId) ? 'offline' : 'back-online',
        reason: null,
        screenId: null,
        screenName: null,
        lastSeenAt: null,
      };
    }
    const needsYou = health.state === 'offline' && !tooOld;
    return { ...r, isRead: r.isRead || !needsYou, health };
  });

  const unreadCount = items.filter((r) => !r.isRead).length;
  return { items: items.slice(0, limit), unreadCount };
}
