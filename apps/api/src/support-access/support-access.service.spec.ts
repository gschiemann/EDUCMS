import { HttpException } from '@nestjs/common';
import { SupportAccessService } from './support-access.service';
import { SupportFakeDb } from './support-access.fakedb-spec';

/**
 * SupportAccessService against an in-memory database. These prove OUTCOMES:
 * who can reach what, which rows exist afterwards, which audit rows were
 * written, who was told — never that a mock was called.
 */

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LOC_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const LOC_2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const OTHER_ORG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const INTERNAL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const INTERNAL_LOC = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const HOME = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const NOW = new Date('2026-10-11T12:00:00Z');
const min = (n: number) => new Date(NOW.getTime() + n * 60_000);

const SUPER = { id: 'super-1', userId: 'super-1', email: 'greg@venueos.test', role: 'SUPER_ADMIN', tenantId: HOME };
const OWNER = { id: 'owner-1', userId: 'owner-1', email: 'owner@acme.test', role: 'DISTRICT_ADMIN', tenantId: ORG };
const LOC_ADMIN = { id: 'loc-admin', userId: 'loc-admin', email: 'loc@acme.test', role: 'SCHOOL_ADMIN', tenantId: LOC_1 };
const VIEWER = { id: 'viewer', userId: 'viewer', email: 'v@acme.test', role: 'RESTRICTED_VIEWER', tenantId: ORG };

function setup() {
  const db = new SupportFakeDb();
  db.addTenant({ id: ORG, name: 'Acme', slug: 'acme' });
  db.addTenant({ id: LOC_1, name: 'Acme North', slug: 'acme-north', parentId: ORG });
  db.addTenant({ id: LOC_2, name: 'Acme South', slug: 'acme-south', parentId: ORG });
  db.addTenant({ id: OTHER_ORG, name: 'Bravo', slug: 'bravo' });
  db.addTenant({ id: INTERNAL, name: 'VisionCore', slug: 'visioncore-systems', isInternal: true });
  db.addTenant({ id: INTERNAL_LOC, name: 'VisionCore bench', slug: 'vc-bench', parentId: INTERNAL });
  db.addTenant({ id: HOME, name: 'Home', slug: 'home' });
  db.addUser({ ...SUPER, tenantId: HOME });
  db.addUser({ ...OWNER });
  db.addUser({ ...LOC_ADMIN });
  db.addUser({ ...VIEWER });
  db.addUser({ id: 'starter', tenantId: ORG, role: 'DISTRICT_ADMIN', email: 'owner@setup.venueos.invalid' });
  const email = { sendSupportAccessRequested: jest.fn(async () => 'SENT'), sendSupportAccessBreakGlass: jest.fn(async () => 'SENT') };
  const notifications = { notify: jest.fn(async (i: any) => i) };
  const svc = new SupportAccessService({ client: db.client } as any, email as any, notifications as any);
  return { db, svc, email, notifications };
}

const rejection = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    const r = (e as HttpException).getResponse?.() as any;
    return { status: (e as HttpException).getStatus?.(), code: r?.code ?? r };
  }
  throw new Error('expected a rejection');
};

const actions = (db: SupportFakeDb, tenantId = ORG) => db.audit.filter((a) => a.tenantId === tenantId).map((a) => a.action);

describe('reach — who may touch what, right now', () => {
  it('a customer organisation with no grant: NO reach, and the switch/gate refusal is 403 SUPPORT_ACCESS_REQUIRED', async () => {
    const { svc } = setup();
    expect((await svc.reach(SUPER, ORG, NOW)).allowed).toBe(false);
    expect((await svc.reach(SUPER, LOC_1, NOW)).allowed).toBe(false);
    const r = await rejection(svc.assertReach(SUPER, ORG, NOW));
    expect(r).toEqual({ status: 403, code: 'SUPPORT_ACCESS_REQUIRED' });
  });

  it('an INTERNAL organisation (and its locations) is always reachable', async () => {
    const { svc } = setup();
    expect(await svc.reach(SUPER, INTERNAL, NOW)).toMatchObject({ allowed: true, basis: 'internal' });
    expect(await svc.reach(SUPER, INTERNAL_LOC, NOW)).toMatchObject({ allowed: true, basis: 'internal' });
  });

  it("the super admin's own HOME tenant is always reachable — the owner can never lock himself out", async () => {
    const { svc } = setup();
    expect(await svc.reach(SUPER, HOME, NOW)).toMatchObject({ allowed: true, basis: 'home' });
    await expect(svc.assertReach(SUPER, HOME, NOW)).resolves.toMatchObject({ basis: 'home' });
  });

  it('assertReach is a no-op for every non-super principal (customers are never gated by this)', async () => {
    const { svc } = setup();
    await expect(svc.assertReach(OWNER, OTHER_ORG, NOW)).resolves.toBeNull();
    await expect(svc.assertReach({ kind: 'device', role: 'SUPER_ADMIN' } as any, ORG, NOW)).resolves.toBeNull();
    await expect(svc.assertReach(null, ORG, NOW)).resolves.toBeNull();
  });

  it('an active whole-org grant reaches the root and every location; a sibling organisation stays closed', async () => {
    const { db, svc } = setup();
    const g = db.addGrant({ tenantId: ORG, status: 'ACTIVE', startsAt: min(-5), expiresAt: min(55) });
    expect(await svc.reach(SUPER, ORG, NOW)).toMatchObject({ allowed: true, basis: 'grant', grantId: g.id });
    expect(await svc.reach(SUPER, LOC_2, NOW)).toMatchObject({ allowed: true, basis: 'grant', grantId: g.id });
    expect((await svc.reach(SUPER, OTHER_ORG, NOW)).allowed).toBe(false);
  });

  it('a LOCATION-scoped grant cannot reach a sibling location or the root', async () => {
    const { db, svc } = setup();
    db.addGrant({ tenantId: ORG, status: 'ACTIVE', scopeTenantIds: [LOC_1], startsAt: min(-5), expiresAt: min(55) });
    expect((await svc.reach(SUPER, LOC_1, NOW)).allowed).toBe(true);
    expect((await svc.reach(SUPER, LOC_2, NOW)).allowed).toBe(false);
    expect((await svc.reach(SUPER, ORG, NOW)).allowed).toBe(false);
  });

  it('EXPIRY (time-mocked): a grant stops working the moment it expires and is stamped EXPIRED with an audit row', async () => {
    const { db, svc } = setup();
    const g = db.addGrant({ tenantId: ORG, status: 'ACTIVE', startsAt: min(-30), expiresAt: min(30) });
    expect((await svc.reach(SUPER, ORG, NOW)).allowed).toBe(true);
    svc.invalidate();
    expect((await svc.reach(SUPER, ORG, min(29))).allowed).toBe(true);
    svc.invalidate();
    expect((await svc.reach(SUPER, ORG, min(30))).allowed).toBe(false);
    expect(db.grants.find((x) => x.id === g.id)!.status).toBe('EXPIRED');
    expect(actions(db)).toEqual(['SUPPORT_ACCESS_EXPIRED']);
    expect(db.audit[0].supportGrantId).toBe(g.id);
  });

  it('REVOKED / DENIED / REQUESTED rows grant nothing', async () => {
    const { db, svc } = setup();
    for (const status of ['REVOKED', 'DENIED', 'REQUESTED']) {
      db.grants = [];
      db.addGrant({ tenantId: ORG, status, startsAt: min(-5), expiresAt: min(55) });
      svc.invalidate();
      expect((await svc.reach(SUPER, ORG, NOW)).allowed).toBe(false);
    }
  });

  it('fails CLOSED when the database cannot answer', async () => {
    const svc = new SupportAccessService({ client: { tenant: { findUnique: async () => { throw new Error('db down'); } } } } as any);
    expect((await svc.reach(SUPER, ORG, NOW)).allowed).toBe(false);
  });

  it('caches per (user, tenant) for a few seconds and invalidate() drops it', async () => {
    const { db, svc } = setup();
    expect((await svc.reach(SUPER, ORG, NOW)).allowed).toBe(false);
    db.addGrant({ tenantId: ORG, status: 'ACTIVE', startsAt: min(-5), expiresAt: min(55) });
    expect((await svc.reach(SUPER, ORG, NOW)).allowed).toBe(false); // cached refusal
    svc.invalidate();
    expect((await svc.reach(SUPER, ORG, NOW)).allowed).toBe(true);
  });
});

describe('(A) VenueOS asks → the customer decides', () => {
  it('request: creates a REQUESTED row, audits it, notifies and emails every deciding admin (never a starter placeholder)', async () => {
    const { db, svc, email, notifications } = setup();
    const out = await svc.request(ORG, SUPER, { reason: 'Looping video on lobby screen', durationMinutes: 1440 }, NOW);
    expect(out).toMatchObject({ kind: 'REQUEST', status: 'REQUESTED', active: false, requestedDurationMinutes: 1440, requestedByEmail: SUPER.email });
    expect(actions(db)).toEqual(['SUPPORT_ACCESS_REQUESTED']);
    expect(db.audit[0]).toMatchObject({ userId: SUPER.id, supportGrantId: out.id, targetType: 'SupportAccessGrant' });
    // the owner (DISTRICT_ADMIN on the root) decides; the location SCHOOL_ADMIN, the viewer and the unclaimed starter do not
    const told = notifications.notify.mock.calls.map((c: any[]) => c[0].userId).sort();
    expect(told).toEqual(['owner-1']);
    expect(email.sendSupportAccessRequested).toHaveBeenCalledTimes(1);
    expect(email.sendSupportAccessRequested.mock.calls[0][0]).toMatchObject({ to: OWNER.email, orgName: 'Acme', durationLabel: '1 day' });
    // nothing is reachable yet
    expect((await svc.reach(SUPER, ORG, NOW)).allowed).toBe(false);
  });

  it('request: a reason is mandatory, a location scope must belong to the organisation, and the target must be a ROOT', async () => {
    const { svc } = setup();
    expect((await rejection(svc.request(ORG, SUPER, { durationMinutes: 60 }, NOW))).code).toBe('SUPPORT_ACCESS_REASON_REQUIRED');
    expect((await rejection(svc.request(ORG, SUPER, { reason: 'x', durationMinutes: 60, scopeTenantIds: [OTHER_ORG] }, NOW))).code).toBe('SUPPORT_ACCESS_SCOPE_INVALID');
    expect((await rejection(svc.request(LOC_1, SUPER, { reason: 'x', durationMinutes: 60 }, NOW))).code).toBe('SUPPORT_ACCESS_NOT_AN_ORG');
  });

  it('request: one open request per organisation, and none while access is already active', async () => {
    const { db, svc } = setup();
    await svc.request(ORG, SUPER, { reason: 'x', durationMinutes: 60 }, NOW);
    expect((await rejection(svc.request(ORG, SUPER, { reason: 'y', durationMinutes: 60 }, NOW))).code).toBe('SUPPORT_ACCESS_REQUEST_PENDING');
    db.grants = [];
    db.addGrant({ tenantId: ORG, status: 'ACTIVE', startsAt: min(-5), expiresAt: min(55) });
    svc.invalidate();
    expect((await rejection(svc.request(ORG, SUPER, { reason: 'y', durationMinutes: 60 }, NOW))).code).toBe('SUPPORT_ACCESS_ALREADY_ACTIVE');
  });

  it('approve: becomes ACTIVE from now, the customer may SHORTEN the duration, audit + reach follow', async () => {
    const { db, svc, notifications } = setup();
    const req = await svc.request(ORG, SUPER, { reason: 'x', durationMinutes: 1440 }, NOW);
    const out = await svc.decide(req.id, ORG, OWNER, true, { durationMinutes: 60, note: 'one hour is plenty' }, NOW);
    expect(out).toMatchObject({ status: 'ACTIVE', active: true, decidedByEmail: OWNER.email, note: 'one hour is plenty' });
    expect(new Date(out.expiresAt).toISOString()).toBe(min(60).toISOString());
    expect(actions(db)).toEqual(['SUPPORT_ACCESS_REQUESTED', 'SUPPORT_ACCESS_APPROVED']);
    expect(JSON.parse(db.audit[1].details)).toMatchObject({ requestedDurationMinutes: 1440, durationMinutes: 60 });
    expect(await svc.reach(SUPER, LOC_1, NOW)).toMatchObject({ allowed: true, basis: 'grant', grantId: req.id });
    // VenueOS is told in-app
    expect(notifications.notify.mock.calls.some((c: any[]) => c[0].userId === SUPER.id && /approved/.test(c[0].title))).toBe(true);
  });

  it('approve: a longer duration than requested is clamped to the request', async () => {
    const { svc } = setup();
    const req = await svc.request(ORG, SUPER, { reason: 'x', durationMinutes: 60 }, NOW);
    const out = await svc.decide(req.id, ORG, OWNER, true, { durationMinutes: 10080 }, NOW);
    expect(new Date(out.expiresAt).toISOString()).toBe(min(60).toISOString());
  });

  it('deny: DENIED, audited, no reach; deciding twice is a 409', async () => {
    const { db, svc } = setup();
    const req = await svc.request(ORG, SUPER, { reason: 'x', durationMinutes: 60 }, NOW);
    const out = await svc.decide(req.id, ORG, OWNER, false, { note: 'not now' }, NOW);
    expect(out.status).toBe('DENIED');
    expect(actions(db)).toEqual(['SUPPORT_ACCESS_REQUESTED', 'SUPPORT_ACCESS_DENIED']);
    expect((await svc.reach(SUPER, ORG, NOW)).allowed).toBe(false);
    expect((await rejection(svc.decide(req.id, ORG, OWNER, true, {}, NOW))).code).toBe('SUPPORT_ACCESS_NOT_PENDING');
  });

  it('decide: a request belongs to ONE organisation — another org cannot approve it', async () => {
    const { svc } = setup();
    const req = await svc.request(ORG, SUPER, { reason: 'x', durationMinutes: 60 }, NOW);
    expect((await rejection(svc.decide(req.id, OTHER_ORG, OWNER, true, {}, NOW))).status).toBe(404);
  });
});

describe('(B) the customer invites VenueOS in', () => {
  it('invite: ACTIVE at once, scoped if asked, audited, VenueOS told', async () => {
    const { db, svc, notifications } = setup();
    const out = await svc.invite(ORG, OWNER, { durationMinutes: 10080, note: 'please check the menu board', scopeTenantIds: [LOC_2] }, NOW);
    expect(out).toMatchObject({ kind: 'INVITE', status: 'ACTIVE', active: true, scopeTenantIds: [LOC_2], decidedByEmail: OWNER.email });
    expect(new Date(out.expiresAt).toISOString()).toBe(min(10080).toISOString());
    expect(actions(db)).toEqual(['SUPPORT_ACCESS_INVITED']);
    expect((await svc.reach(SUPER, LOC_2, NOW)).allowed).toBe(true);
    expect((await svc.reach(SUPER, LOC_1, NOW)).allowed).toBe(false);
    expect(notifications.notify.mock.calls.some((c: any[]) => c[0].userId === SUPER.id)).toBe(true);
  });

  it('invite: refused while access is already active (end it first)', async () => {
    const { svc } = setup();
    await svc.invite(ORG, OWNER, { durationMinutes: 60 }, NOW);
    expect((await rejection(svc.invite(ORG, OWNER, { durationMinutes: 60 }, NOW))).code).toBe('SUPPORT_ACCESS_ALREADY_ACTIVE');
  });
});

describe('revoke — either side, any time', () => {
  it('the customer ends an active grant: REVOKED, audited, reach gone immediately', async () => {
    const { db, svc } = setup();
    const g = await svc.invite(ORG, OWNER, { durationMinutes: 1440 }, NOW);
    expect((await svc.reach(SUPER, ORG, NOW)).allowed).toBe(true);
    const out = await svc.revoke(g.id, ORG, OWNER, 'customer', { note: 'done' }, min(5));
    expect(out).toMatchObject({ status: 'REVOKED', active: false, revokedByEmail: OWNER.email });
    expect(actions(db)).toEqual(['SUPPORT_ACCESS_INVITED', 'SUPPORT_ACCESS_REVOKED']);
    expect((await svc.reach(SUPER, ORG, min(5))).allowed).toBe(false);
  });

  it('VenueOS ends its own access: the customer admins are told; withdrawing an open request is DENIED+WITHDRAWN', async () => {
    const { db, svc, notifications } = setup();
    const g = await svc.invite(ORG, OWNER, { durationMinutes: 1440 }, NOW);
    notifications.notify.mockClear();
    await svc.revoke(g.id, ORG, SUPER, 'venueos', {}, min(1));
    expect(notifications.notify.mock.calls.some((c: any[]) => c[0].userId === OWNER.id && /ended/.test(c[0].title))).toBe(true);
    const req = await svc.request(ORG, SUPER, { reason: 'x', durationMinutes: 60 }, min(2));
    const out = await svc.revoke(req.id, ORG, SUPER, 'venueos', {}, min(3));
    expect(out.status).toBe('DENIED');
    expect(actions(db)).toContain('SUPPORT_ACCESS_WITHDRAWN');
    expect((await rejection(svc.revoke(req.id, ORG, SUPER, 'venueos', {}, min(4)))).code).toBe('SUPPORT_ACCESS_NOT_ACTIVE');
  });
});

describe('break-glass — the incident path', () => {
  it('≤ 60 minutes, mandatory reason, audited, every deciding admin emailed and notified at once', async () => {
    const { db, svc, email, notifications } = setup();
    expect((await rejection(svc.breakGlass(ORG, SUPER, {}, NOW))).code).toBe('SUPPORT_ACCESS_REASON_REQUIRED');
    const out = await svc.breakGlass(ORG, SUPER, { reason: 'Lockdown stuck on 40 screens, nobody answers', durationMinutes: 1440 }, NOW);
    expect(out).toMatchObject({ kind: 'BREAK_GLASS', status: 'ACTIVE', active: true, requestedDurationMinutes: 60 });
    expect(new Date(out.expiresAt).toISOString()).toBe(min(60).toISOString());
    expect(actions(db)).toEqual(['SUPPORT_ACCESS_BREAK_GLASS']);
    expect(email.sendSupportAccessBreakGlass).toHaveBeenCalledTimes(1);
    expect(email.sendSupportAccessBreakGlass.mock.calls[0][0]).toMatchObject({ to: OWNER.email, reason: expect.stringContaining('Lockdown') });
    expect(notifications.notify.mock.calls.some((c: any[]) => c[0].userId === OWNER.id && /emergency/i.test(c[0].title))).toBe(true);
    expect((await svc.reach(SUPER, ORG, NOW)).allowed).toBe(true);
    expect((await svc.reach(SUPER, ORG, min(60))).allowed).toBe(false);
  });

  it('break-glass is refused while any access is already active', async () => {
    const { svc } = setup();
    await svc.invite(ORG, OWNER, { durationMinutes: 60 }, NOW);
    expect((await rejection(svc.breakGlass(ORG, SUPER, { reason: 'x' }, NOW))).code).toBe('SUPPORT_ACCESS_ALREADY_ACTIVE');
  });
});

describe('who decides, and what the customer sees', () => {
  it('isOrgAdmin: DISTRICT_ADMIN anywhere in the org, SCHOOL_ADMIN only on the root; nobody from another org', async () => {
    const { svc } = setup();
    expect(await svc.isOrgAdmin(OWNER, ORG)).toBe(true);
    expect(await svc.isOrgAdmin({ ...OWNER, tenantId: LOC_1 }, ORG)).toBe(true);
    expect(await svc.isOrgAdmin(LOC_ADMIN, ORG)).toBe(false);
    expect(await svc.isOrgAdmin({ ...LOC_ADMIN, tenantId: ORG }, ORG)).toBe(true);
    expect(await svc.isOrgAdmin(VIEWER, ORG)).toBe(false);
    expect(await svc.isOrgAdmin({ ...OWNER, tenantId: OTHER_ORG }, ORG)).toBe(false);
  });

  it('listForOrg: the active grant, open requests, history and the locations a scope can name', async () => {
    const { svc } = setup();
    const req = await svc.request(ORG, SUPER, { reason: 'x', durationMinutes: 60 }, NOW);
    let state = await svc.listForOrg(ORG, NOW);
    expect(state.active).toBeNull();
    expect(state.pending.map((g: any) => g.id)).toEqual([req.id]);
    expect(state.locations.map((l: any) => l.id).sort()).toEqual([LOC_1, LOC_2].sort());
    await svc.decide(req.id, ORG, OWNER, true, {}, NOW);
    state = await svc.listForOrg(ORG, min(1));
    expect(state.active?.id).toBe(req.id);
    expect(state.pending).toEqual([]);
    expect(state.history.map((g: any) => g.status)).toEqual(['ACTIVE']);
  });

  it('recordAction: one SUPPORT_ACCESS_ACTION row per mutation, attributed to the grant', async () => {
    const { db, svc } = setup();
    await svc.recordAction('grant-9', ORG, SUPER, 'DELETE', '/api/v1/playlists/abc?x=1');
    expect(db.audit[0]).toMatchObject({ action: 'SUPPORT_ACCESS_ACTION', tenantId: ORG, userId: SUPER.id, supportGrantId: 'grant-9' });
    expect(JSON.parse(db.audit[0].details)).toEqual({ method: 'DELETE', path: '/api/v1/playlists/abc' });
  });

  it('reachableBasisBulk: the switcher gets one answer per tenant in two queries', async () => {
    const { db, svc } = setup();
    db.addGrant({ tenantId: ORG, status: 'ACTIVE', scopeTenantIds: [LOC_1], startsAt: min(-5), expiresAt: min(55) });
    const rows = db.tenants.map((t) => ({ id: t.id, parentId: t.parentId, isInternal: t.isInternal }));
    const out = await svc.reachableBasisBulk(SUPER, rows, NOW);
    expect(out.get(INTERNAL)).toBe('internal');
    expect(out.get(INTERNAL_LOC)).toBe('internal');
    expect(out.get(HOME)).toBe('home');
    expect(out.get(LOC_1)).toBe('grant');
    expect(out.get(LOC_2)).toBeNull();
    expect(out.get(ORG)).toBeNull();
    expect(out.get(OTHER_ORG)).toBeNull();
  });
});
