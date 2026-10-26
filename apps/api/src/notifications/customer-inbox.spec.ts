/**
 * The customer's bell (2026-10-24). The fixture IS the owner's own bell on the
 * day he photographed it: 31 unread on "VisionCore Systems" — 19 daily
 * SCREEN_PUSH_DEAD rows, 11 SCREEN_OFFLINE rows for one Media Player (one per
 * outage since 09-23, the last one still open) and one for a phone-browser
 * test screen silent since Aug 6. The customer reading is ONE.
 */
import { buildCustomerInbox, infraSiteOf, infraWasPlatformWide, offlineScreenIdOf } from './customer-inbox';
import { ScreenAttentionService } from './screen-attention/screen-attention.service';

const NOW = Date.parse('2026-10-24T22:00:00Z');
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const T = 'visioncore';
const PLAYER = 'mp-1';
const TEST1 = 'test-1';

function row(over: Record<string, unknown>) {
  return {
    tenantId: T,
    userId: null,
    body: null,
    link: '/screens',
    isRead: false,
    ...over,
  };
}

function fixture() {
  const rows: any[] = [];
  // The open outage (newest) and ten older ones for the same screen.
  const outages = [
    '2026-10-23T05:49:57Z', '2026-10-14T15:32:23Z', '2026-10-13T16:12:49Z', '2026-10-09T18:20:12Z',
    '2026-10-09T17:07:12Z', '2026-10-09T15:24:12Z', '2026-09-29T06:04:47Z', '2026-09-27T04:02:25Z',
    '2026-09-25T04:27:50Z', '2026-09-24T22:04:41Z', '2026-09-23T17:31:27Z',
  ];
  outages.forEach((at, i) =>
    rows.push(row({
      id: `off-${i}`, kind: 'SCREEN_OFFLINE', title: 'Screen offline: Venue-OS Media Player',
      body: 'No heartbeat since 2026-10-23T05:44:20.468Z.', createdAt: new Date(at),
      dedupeKey: `screen-offline:${PLAYER}:${497981 - i}`,
    })),
  );
  rows.push(row({
    id: 'off-test1', kind: 'SCREEN_OFFLINE', title: 'Screen offline: Test 1',
    body: 'No heartbeat since 2026-08-06T19:03:58.372Z.', createdAt: new Date('2026-08-06T19:09:53Z'),
    dedupeKey: `screen-offline:${TEST1}:496123`,
  }));
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

function prismaWith(rows: any[], screens: any[], extra: { infraAround?: any[]; tenants?: any[] } = {}) {
  const notification = {
    findMany: jest.fn(async (args: any) => {
      if (args?.where?.kind === 'INFRA_EVENT') return extra.infraAround ?? [];
      const notIn: string[] = args?.where?.kind?.notIn ?? [];
      return rows.filter((r) => !notIn.includes(r.kind));
    }),
  };
  const screen = {
    findMany: jest.fn(async (args: any) => {
      const ids: string[] | undefined = args?.where?.id?.in;
      const tenants: string[] | undefined = args?.where?.tenantId?.in;
      return screens.filter((s) => (!ids || ids.includes(s.id)) && (!tenants || tenants.includes(s.tenantId)));
    }),
  };
  const tenant = {
    findMany: jest.fn(async (args: any) => {
      if (args?.where?.parentId) return [];
      const ids: string[] = args?.where?.id?.in ?? [];
      return (extra.tenants ?? []).filter((t) => ids.includes(t.id));
    }),
  };
  return { client: { notification, screen, tenant } };
}

const screens = [
  { id: PLAYER, name: 'Venue-OS Media Player', tenantId: T, lastPingAt: new Date('2026-10-23T05:44:20Z'), hardwareModel: 'generic-android', osInfo: 'Android', playerVersion: '1.1.42-field.1', status: 'ONLINE' },
  { id: TEST1, name: 'Test 1', tenantId: T, lastPingAt: new Date('2026-08-06T19:10:58Z'), hardwareModel: 'web', osInfo: 'iOS', playerVersion: null, status: 'ONLINE' },
];

/** Facts say nothing intended (no schedule, last power command POWER_ON). */
function attentionWithNoExcuses() {
  const alerts: any = {
    loadTenants: jest.fn(async () => new Map()),
    loadFacts: jest.fn(async (problems: Array<{ screenId: string }>) => {
      const m = new Map();
      for (const p of problems) {
        m.set(p.screenId, {
          facts: {
            id: p.screenId, status: 'OFFLINE', tenantId: T, pairedAt: new Date(NOW - 60 * DAY),
            lastPingAt: new Date('2026-10-23T05:44:20Z'), nativeRuntimeReport: null, nativeRuntimeReportAt: null,
            credentialEpochRotatedAt: null, lastOtaAt: null, lastOtaState: null, forceApkUpdatePendingAt: null,
            forceApkUpdateHold: null, displayWindows: [], otaWindow: null,
            lastPowerCommand: { state: 'on', at: new Date('2026-10-09T15:40:00Z') }, lastMaintenanceAt: null,
          },
        });
      }
      return m;
    }),
  };
  return new ScreenAttentionService({ client: {} } as any, alerts);
}

describe('customer bell — the owner\'s 31', () => {
  it('31 unread become 1: the screen that really is offline', async () => {
    const rows = fixture();
    // The 19 push-dead rows exist too; the owner-only filter keeps them out of the query.
    for (let i = 0; i < 19; i++) {
      rows.push(row({ id: `pd-${i}`, kind: 'SCREEN_PUSH_DEAD', title: 'Venue-OS Media Player: realtime down AND content unproven — needs attention now', createdAt: new Date(NOW - i * DAY), dedupeKey: `screen-push-dead:${PLAYER}:${20748 - i}` }));
    }
    const prisma = prismaWith(rows, screens);
    const out = await buildCustomerInbox({ prisma, attention: attentionWithNoExcuses(), nowMs: NOW }, { tenantId: T, userId: 'pablo', limit: 20 });

    // The query itself excludes the owner-only kind.
    expect(prisma.client.notification.findMany.mock.calls[0][0].where.kind).toEqual({ notIn: ['SCREEN_PUSH_DEAD'] });
    expect(out.items.some((n: any) => n.kind === 'SCREEN_PUSH_DEAD')).toBe(false);

    // One row per screen: the newest outage for the Media Player, and Test 1's.
    expect(out.items.map((n: any) => n.id)).toEqual(['off-0', 'off-test1']);
    expect(out.unreadCount).toBe(1);

    const player = out.items[0] as any;
    expect(player.isRead).toBe(false);
    expect(player.health).toMatchObject({ state: 'offline', screenName: 'Venue-OS Media Player', lastSeenAt: '2026-10-23T05:44:20.000Z' });

    const test1 = out.items[1] as any;
    expect(test1.isRead).toBe(true); // projected — the database row is untouched
    expect(test1.health).toMatchObject({ state: 'dormant', reason: 'not-seen-30-days' });
  });

  it('a screen that came back online leaves nothing unread', async () => {
    const back = [{ ...screens[0], lastPingAt: new Date(NOW - 10_000) }, screens[1]];
    const out = await buildCustomerInbox({ prisma: prismaWith(fixture(), back), attention: attentionWithNoExcuses(), nowMs: NOW }, { tenantId: T, userId: 'pablo' });
    expect(out.unreadCount).toBe(0);
    expect((out.items[0] as any).health.state).toBe('back-online');
  });

  it('a screen that is off on schedule is not unread', async () => {
    const attention = new ScreenAttentionService({ client: {} } as any, {
      loadTenants: async () => new Map(),
      loadFacts: async () => new Map([[PLAYER, { facts: { lastPowerCommand: { state: 'off', at: new Date(NOW - DAY) }, displayWindows: [], otaWindow: null, nativeRuntimeReportAt: null } }]]),
    } as any);
    const out = await buildCustomerInbox({ prisma: prismaWith(fixture(), screens), attention, nowMs: NOW }, { tenantId: T, userId: 'pablo' });
    expect(out.unreadCount).toBe(0);
    expect((out.items[0] as any).health).toMatchObject({ state: 'resting', reason: 'remote-power-off' });
  });

  it('a removed screen\'s old offline row is history', async () => {
    const out = await buildCustomerInbox({ prisma: prismaWith(fixture(), [screens[1]]), attention: attentionWithNoExcuses(), nowMs: NOW }, { tenantId: T, userId: 'pablo' });
    expect((out.items[0] as any).health.state).toBe('removed');
    expect(out.unreadCount).toBe(0);
  });

  it('without the attention service an offline screen still reads as offline (never hidden)', async () => {
    const out = await buildCustomerInbox({ prisma: prismaWith(fixture(), screens), attention: null, nowMs: NOW }, { tenantId: T, userId: 'pablo' });
    // The Media Player still counts; Test 1 is dormant from its own row alone.
    expect(out.unreadCount).toBe(1);
    expect((out.items[0] as any).health.state).toBe('offline');
    expect((out.items[1] as any).health.state).toBe('dormant');
  });

  it('reviews, help requests and other rows are untouched', async () => {
    const rows = [row({ id: 'r1', kind: 'INFO', title: 'New submission awaiting your review', createdAt: new Date(NOW - 40 * DAY), dedupeKey: 'sub-create-1-u' })];
    const out = await buildCustomerInbox({ prisma: prismaWith(rows, []), attention: null, nowMs: NOW }, { tenantId: T, userId: 'pablo' });
    expect(out.unreadCount).toBe(1);
    expect((out.items[0] as any).health).toBeUndefined();
  });
});

describe('customer bell — site-wide drops', () => {
  const infra = (id: string, tenantId: string, at: number) =>
    row({ id, tenantId, kind: 'INFRA_EVENT', title: 'Possible infrastructure event — 3/3 screens dropped', createdAt: new Date(at), dedupeKey: `infra-event:${tenantId}:${Math.floor(at / (5 * MIN))}` });

  it('a drop that hit three organisations at once was ours: hidden', async () => {
    const at = NOW - 60 * MIN;
    const around = [
      { tenantId: T, createdAt: new Date(at) },
      { tenantId: 'org-b', createdAt: new Date(at + 20_000) },
      { tenantId: 'org-c', createdAt: new Date(at - 40_000) },
    ];
    const out = await buildCustomerInbox(
      { prisma: prismaWith([infra('i1', T, at)], [], { infraAround: around, tenants: [] }), attention: null, nowMs: NOW },
      { tenantId: T, userId: 'pablo' },
    );
    expect(out.items).toHaveLength(0);
    expect(out.unreadCount).toBe(0);
  });

  it('one organisation\'s own drop stays, and counts while its screens are down', async () => {
    const at = NOW - 60 * MIN;
    const down = [{ id: 's9', name: 'Lobby', tenantId: T, lastPingAt: new Date(at - MIN), hardwareModel: 'generic-android', osInfo: 'Android', playerVersion: '1.1.54', status: 'ONLINE' }];
    // Five schools of ONE district at the same moment is that district's outage.
    const around = ['school-1', 'school-2', 'school-3'].map((id) => ({ tenantId: id, createdAt: new Date(at) }));
    const tenants = ['school-1', 'school-2', 'school-3'].map((id) => ({ id, parentId: 'district' }));
    const out = await buildCustomerInbox(
      { prisma: prismaWith([infra('i2', T, at)], down, { infraAround: [{ tenantId: T, createdAt: new Date(at) }, ...around], tenants: [...tenants, { id: T, parentId: 'district' }] }), attention: null, nowMs: NOW },
      { tenantId: T, userId: 'pablo' },
    );
    expect(out.items).toHaveLength(1);
    expect((out.items[0] as any).health.state).toBe('offline');
    expect(out.unreadCount).toBe(1);
  });

  it('the platform rule is the alert emails\' (≥ 3 organisations within 5 minutes)', () => {
    const at = NOW;
    const rootOf = (id: string) => id;
    expect(infraWasPlatformWide(at, [{ tenantId: 'a', createdAt: new Date(at) }, { tenantId: 'b', createdAt: new Date(at) }], rootOf)).toBe(false);
    expect(infraWasPlatformWide(at, [
      { tenantId: 'a', createdAt: new Date(at) },
      { tenantId: 'b', createdAt: new Date(at + 4 * MIN) },
      { tenantId: 'c', createdAt: new Date(at - 4 * MIN) },
    ], rootOf)).toBe(true);
    expect(infraWasPlatformWide(at, [
      { tenantId: 'a', createdAt: new Date(at) },
      { tenantId: 'b', createdAt: new Date(at + 4 * MIN) },
      { tenantId: 'c', createdAt: new Date(at - 6 * MIN) },
    ], rootOf)).toBe(false);
  });
});

describe('dedupe key parsing', () => {
  it('reads the screen and the site out of the keys the scanner writes', () => {
    expect(offlineScreenIdOf('screen-offline:abc:123')).toBe('abc');
    expect(offlineScreenIdOf('screen-offline-hq:abc:123')).toBe('abc');
    expect(offlineScreenIdOf('touch-help:abc:1')).toBeNull();
    expect(infraSiteOf('infra-event:t1:9')).toEqual({ siteTenantId: 't1', rollup: false });
    expect(infraSiteOf('infra-event-hq:child:9')).toEqual({ siteTenantId: 'child', rollup: true });
    expect(infraSiteOf(null)).toBeNull();
  });
});
