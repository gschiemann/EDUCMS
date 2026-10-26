import { Test } from '@nestjs/testing';
import { ScreenAttentionService } from './screen-attention.service';
import { ScreenAttentionController } from './screen-attention.controller';
import { NotificationsController } from '../notifications.controller';
import { NotificationsService } from '../notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RbacGuard } from '../../auth/rbac.guard';

const NOW = Date.parse('2026-10-24T22:00:00Z');
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const screens = [
  { id: 'online', name: 'Front desk', tenantId: 't1', status: 'ONLINE', location: null, lastPingAt: new Date(NOW - 10_000), hardwareModel: 'generic-android', osInfo: 'Android', playerVersion: '1.1.54', screenGroup: { name: 'Lobby' } },
  { id: 'down-new', name: 'Cafe', tenantId: 't1', status: 'ONLINE', location: null, lastPingAt: new Date(NOW - 20 * MIN), hardwareModel: 'generic-android', osInfo: 'Android', playerVersion: '1.1.54', screenGroup: null },
  { id: 'down-old', name: 'Gym', tenantId: 't1', status: 'ONLINE', location: 'East wing', lastPingAt: new Date(NOW - 3 * DAY), hardwareModel: 'generic-android', osInfo: 'Android', playerVersion: '1.1.54', screenGroup: null },
  { id: 'off', name: 'Hall', tenantId: 't1', status: 'ONLINE', location: null, lastPingAt: new Date(NOW - 2 * 60 * MIN), hardwareModel: 'generic-android', osInfo: 'Android', playerVersion: '1.1.54', screenGroup: null },
  { id: 'test', name: 'Test 1', tenantId: 't1', status: 'ONLINE', location: null, lastPingAt: new Date('2026-08-06T19:10:58Z'), hardwareModel: 'web', osInfo: 'iOS', playerVersion: null, screenGroup: { name: 'Web App' } },
];

function service(loadFacts?: (...a: any[]) => any) {
  const prisma: any = { client: { screen: { findMany: jest.fn(async () => screens) } } };
  const alerts: any = {
    loadTenants: jest.fn(async () => new Map()),
    loadFacts: jest.fn(
      loadFacts ??
        (async (problems: Array<{ screenId: string }>) =>
          new Map(
            problems.map((p) => [
              p.screenId,
              { facts: { lastPowerCommand: p.screenId === 'off' ? { state: 'off', at: new Date(NOW - 3 * 60 * MIN) } : null, displayWindows: [], otaWindow: null, nativeRuntimeReportAt: null } },
            ]),
          )),
    ),
  };
  return { svc: new ScreenAttentionService(prisma, alerts), prisma, alerts };
}

describe('ScreenAttentionService.forScope', () => {
  it('sorts offline screens into down / resting / dormant; online screens are not listed', async () => {
    const { svc, prisma, alerts } = service();
    const out = await svc.forScope({ tenantId: 't1' }, NOW);
    expect(out.down.map((s) => s.id)).toEqual(['down-old', 'down-new']); // longest silent first
    expect(out.resting).toEqual([expect.objectContaining({ id: 'off', reason: 'remote-power-off' })]);
    expect(out.dormant).toEqual([expect.objectContaining({ id: 'test', reason: 'not-seen-30-days', groupName: 'Web App' })]);
    // Same scope as the list, never revoked / pending screens.
    expect(prisma.client.screen.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: 't1', status: { notIn: ['REVOKED', 'PENDING'] } });
    // Facts are read only for offline screens that are not already dormant.
    const asked = alerts.loadFacts.mock.calls[0][0].map((p: any) => p.screenId).sort();
    expect(asked).toEqual(['down-new', 'down-old', 'off']);
  });

  it('a facts read that fails shows the screen as DOWN', async () => {
    const { svc } = service(async () => {
      throw new Error('db blip');
    });
    const out = await svc.forScope({ tenantId: 't1' }, NOW);
    expect(out.down.map((s) => s.id).sort()).toEqual(['down-new', 'down-old', 'off']);
    expect(out.dormant.map((s) => s.id)).toEqual(['test']);
  });

  it('caches a verdict for 20 s per scope', async () => {
    const { svc, alerts } = service();
    await svc.forScope({ tenantId: 't1' }, NOW);
    await svc.forScope({ tenantId: 't1' }, NOW + 5_000);
    expect(alerts.loadFacts).toHaveBeenCalledTimes(1);
    await svc.forScope({ tenantId: 't1' }, NOW + 25_000);
    expect(alerts.loadFacts).toHaveBeenCalledTimes(2);
  });
});

describe('Nest wiring', () => {
  it('the attention controller and the bell resolve their dependencies (the alert facts are optional)', async () => {
    const allow = { canActivate: () => true };
    const mod = await Test.createTestingModule({
      controllers: [ScreenAttentionController, NotificationsController],
      providers: [ScreenAttentionService, NotificationsService, { provide: PrismaService, useValue: { client: {} } }],
    })
      .overrideGuard(JwtAuthGuard).useValue(allow)
      .overrideGuard(RbacGuard).useValue(allow)
      .compile();
    expect(mod.get(ScreenAttentionController)).toBeInstanceOf(ScreenAttentionController);
    expect(mod.get(NotificationsController)).toBeInstanceOf(NotificationsController);
    expect((mod.get(NotificationsController) as any).attention).toBeInstanceOf(ScreenAttentionService);
  });
});

describe('GET /screens/attention', () => {
  it('reads the caller\'s tenant only', async () => {
    const forScope = jest.fn(async () => ({ generatedAt: '', down: [], resting: [], dormant: [] }));
    const c = new ScreenAttentionController({ forScope } as any);
    await c.attentionList({ user: { tenantId: 't1', role: 'SCHOOL_ADMIN' } });
    expect(forScope).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1' }));
  });

  it('refuses a request with no tenant', async () => {
    const c = new ScreenAttentionController({ forScope: jest.fn() } as any);
    await expect(c.attentionList({ user: {} })).rejects.toThrow();
  });
});

describe('GET /notifications — whose bell', () => {
  const rawItems = [
    { id: 'a', kind: 'SCREEN_PUSH_DEAD', isRead: false },
    { id: 'b', kind: 'INFO', isRead: false },
  ];
  function controller(customerRows: any[] | Error) {
    const service: any = {
      listForUser: jest.fn(async () => rawItems),
      unreadCount: jest.fn(async () => 2),
    };
    const notification = {
      findMany: jest.fn(async () => {
        if (customerRows instanceof Error) throw customerRows;
        return customerRows;
      }),
    };
    const prisma: any = { client: { notification, tenant: { findMany: jest.fn(async () => []) }, screen: { findMany: jest.fn(async () => []) } } };
    return { c: new NotificationsController(service, prisma), service, notification };
  }

  it('a customer reads the customer inbox', async () => {
    const { c, service } = controller([{ id: 'b', kind: 'INFO', isRead: false, createdAt: new Date(), dedupeKey: null }]);
    const out: any = await c.list({ user: { id: 'u1', tenantId: 't1', role: 'SCHOOL_ADMIN' } }, '20');
    expect(out.unreadCount).toBe(1);
    expect(service.listForUser).not.toHaveBeenCalled();
  });

  it('?audience=owner is the raw table — for a SUPER_ADMIN only', async () => {
    const { c, service } = controller([]);
    const owner: any = await c.list({ user: { id: 'o', tenantId: 't1', role: 'SUPER_ADMIN' } }, '20', 'owner');
    expect(owner).toEqual({ items: rawItems, unreadCount: 2 });
    service.listForUser.mockClear();
    await c.list({ user: { id: 'u1', tenantId: 't1', role: 'DISTRICT_ADMIN' } }, '20', 'owner');
    expect(service.listForUser).not.toHaveBeenCalled();
  });

  it('the bell never 500s: a failed customer read falls back to raw minus owner-only kinds', async () => {
    const { c } = controller(new Error('boom'));
    const out: any = await c.list({ user: { id: 'u1', tenantId: 't1', role: 'SCHOOL_ADMIN' } }, '20');
    expect(out.items.map((n: any) => n.id)).toEqual(['b']);
    expect(out.unreadCount).toBe(1);
  });
});
