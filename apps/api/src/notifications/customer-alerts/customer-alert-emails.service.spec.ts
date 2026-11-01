/**
 * CustomerAlertEmailsService end to end against an in-memory world
 * (2026-10-23): recipients, grouping, confirmation, recovery, dedupe across a
 * restart, rate limit + digest, flap, shadow mode, kill switch, and every
 * platform-level stand-down (restart, degraded, platform incident).
 */
import { CustomerAlertEmailsService, type CustomerAlertTickResult } from './customer-alert-emails.service';
import { reportPlatformComponent, resetPlatformDegradationForTests } from '../../health/platform-degradation';

const MIN = 60_000;
const T0 = Date.parse('2026-10-21T15:00:00Z');

type Row = Record<string, any>;

function makeWorld() {
  const tenants = new Map<string, Row>();
  const users: Row[] = [];
  const screens = new Map<string, Row>();
  const incidents: Row[] = [];
  const sends: Row[] = [];
  const schedules: Row[] = [];
  const displaySchedules: Row[] = [];
  const auditLogs: Row[] = [];
  const screenEvents: Row[] = [];
  let seq = 0;

  const inList = (v: any, c: any) => (c && typeof c === 'object' && 'in' in c ? c.in.includes(v) : c === undefined || v === c);
  const userMatch = (u: Row, w: Row) =>
    inList(u.tenantId, w.tenantId) &&
    inList(u.role, w.role) &&
    (w.status === undefined || u.status === w.status) &&
    (w.deletedAt === undefined || u.deletedAt == null) &&
    (w.alertEmailsEnabled === undefined || u.alertEmailsEnabled === w.alertEmailsEnabled) &&
    (w.mustSetupCredentials === undefined || !!u.mustSetupCredentials === w.mustSetupCredentials) &&
    (w.emailVerificationPending === undefined || !!u.emailVerificationPending === w.emailVerificationPending);

  const incidentMatch = (i: Row, w: Row): boolean => {
    if (w.OR) return w.OR.some((o: Row) => incidentMatch(i, o));
    if (w.open !== undefined && i.open !== w.open) return false;
    if (w.state !== undefined && i.state !== w.state) return false;
    if (w.kind !== undefined && i.kind !== w.kind) return false;
    if (w.screenId && !inList(i.screenId, w.screenId)) return false;
    if (w.closedAt?.lt && !(i.closedAt && i.closedAt < w.closedAt.lt)) return false;
    return true;
  };

  const client: Row = {
    tenant: { findMany: jest.fn(async ({ where }: any) => [...tenants.values()].filter((t) => where.id.in.includes(t.id))) },
    user: { findMany: jest.fn(async ({ where }: any) => users.filter((u) => userMatch(u, where))) },
    license: { findMany: jest.fn(async () => []) },
    screen: {
      findMany: jest.fn(async ({ where }: any) => {
        if (where.id?.in) return [...screens.values()].filter((s) => where.id.in.includes(s.id));
        // The no-content query: pinging, proof-capable, proof < 48 h, stale or "Content unavailable".
        const now = where.lastPingAt.lte.getTime() - MIN;
        return [...screens.values()].filter(
          (s) =>
            s.tenantId &&
            s.status !== 'REVOKED' &&
            s.lastPingAt &&
            s.lastPingAt >= where.lastPingAt.gte &&
            s.lastRenderedAt &&
            s.lastRenderedAt.getTime() >= now - 48 * 60 * MIN &&
            (s.lastRenderedAt.getTime() < now - 5 * MIN || String(s.lastRenderedHash ?? '').startsWith('idle:content-unavailable')),
        );
      }),
      count: jest.fn(async () => [...screens.values()].length),
    },
    screenAlertIncident: {
      findMany: jest.fn(async ({ where }: any) => incidents.filter((i) => incidentMatch(i, where)).map((i) => ({ ...i }))),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const k = where.screenId_kind;
        const ex = incidents.find((i) => i.screenId === k.screenId && i.kind === k.kind);
        if (ex) Object.assign(ex, update);
        else incidents.push({ id: `inc-${++seq}`, lastEmailedAt: null, emailedMode: null, ...create });
        return {};
      }),
      update: jest.fn(async ({ where, data }: any) => {
        Object.assign(incidents.find((i) => i.id === where.id)!, data);
        return {};
      }),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
    customerAlertSend: {
      create: jest.fn(async ({ data }: any) => {
        sends.push({ ...data, createdAt: new Date(clock.now) });
        return {};
      }),
      count: jest.fn(
        async ({ where }: any) =>
          sends.filter(
            (s) => s.orgId === where.orgId && s.createdAt >= where.createdAt.gte && s.recipientCount > 0 && s.kind !== 'PLATFORM_INCIDENT',
          ).length,
      ),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
    schedule: {
      findMany: jest.fn(async ({ where }: any) => {
        const web = JSON.stringify(where).includes('playlist');
        return schedules.filter((s) => !!s.web === web || (!web && true)).filter((s) => (web ? !!s.web : true));
      }),
    },
    displaySchedule: { findMany: jest.fn(async () => displaySchedules) },
    auditLog: {
      // Newest first, like the real `orderBy: { createdAt: 'desc' }`.
      findMany: jest.fn(async ({ where }: any) =>
        auditLogs.filter((a) => where.targetId.in.includes(a.targetId)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      ),
    },
    screenEvent: { findMany: jest.fn(async ({ where }: any) => screenEvents.filter((e) => where.screenId.in.includes(e.screenId))) },
  };
  const clock = { now: T0 };
  return { client, tenants, users, screens, incidents, sends, schedules, displaySchedules, auditLogs, screenEvents, clock };
}

type World = ReturnType<typeof makeWorld>;

function seed(w: World) {
  const t = (id: string, name: string, parentId: string | null = null, extra: Row = {}) =>
    w.tenants.set(id, { id, name, slug: id, parentId, archivedAt: null, otaWindowStart: null, otaWindowEnd: null, otaWindowTimezone: null, ...extra });
  t('district', 'Springfield District');
  t('lincoln', 'Lincoln Elementary', 'district');
  t('adams', 'Adams Middle', 'district');
  t('acme', 'Acme Corp');
  t('globex', 'Globex');
  t('initech', 'Initech');
  const u = (id: string, tenantId: string, role: string, extra: Row = {}) =>
    w.users.push({
      id,
      tenantId,
      role,
      email: `${id}@example.org`,
      status: 'ACTIVE',
      deletedAt: null,
      alertEmailsEnabled: true,
      alertEmailLocale: null,
      mustSetupCredentials: false,
      emailVerificationPending: false,
      ...extra,
    });
  u('principal', 'lincoln', 'SCHOOL_ADMIN');
  u('superintendent', 'district', 'DISTRICT_ADMIN', { alertEmailLocale: 'es' });
  u('optedout', 'lincoln', 'SCHOOL_ADMIN', { alertEmailsEnabled: false });
  u('teacher', 'lincoln', 'CONTRIBUTOR');
  u('adams-admin', 'adams', 'SCHOOL_ADMIN');
  u('placeholder', 'lincoln', 'SCHOOL_ADMIN', { mustSetupCredentials: true });
  u('gone', 'lincoln', 'SCHOOL_ADMIN', { deletedAt: new Date(T0) });
  u('acme-admin', 'acme', 'SCHOOL_ADMIN');
  u('globex-admin', 'globex', 'SCHOOL_ADMIN');
  u('initech-admin', 'initech', 'SCHOOL_ADMIN');
}

function screen(w: World, id: string, tenantId: string, over: Row = {}) {
  w.screens.set(id, {
    id,
    name: id,
    tenantId,
    status: 'ONLINE',
    pairedAt: new Date(T0 - 30 * 24 * 60 * MIN),
    lastPingAt: new Date(w.clock.now - 30_000),
    screenGroupId: null,
    faceOfScreenId: null,
    lastRenderedAt: new Date(w.clock.now - 30_000),
    lastRenderedHash: 'abc',
    authState: 'PROVEN',
    nativeRuntimeReport: null,
    nativeRuntimeReportAt: null,
    credentialEpochRotatedAt: new Date(T0 - 3 * 24 * 60 * MIN),
    lastOtaAt: null,
    lastOtaState: null,
    forceApkUpdatePendingAt: null,
    forceApkUpdateHold: null,
    lastVideoReport: null,
    lastVideoReportAt: null,
    ...over,
  });
}

/** Silence a screen: its last ping (and proof) stop at `at`. */
const goOffline = (w: World, id: string, at: number) => Object.assign(w.screens.get(id)!, { lastPingAt: new Date(at), lastRenderedAt: new Date(at) });
const comeBack = (w: World, id: string) =>
  Object.assign(w.screens.get(id)!, { lastPingAt: new Date(w.clock.now - 10_000), lastRenderedAt: new Date(w.clock.now - 10_000) });

/** What the offline scanner hands the service: every screen silent > 5 min. */
function scanOf(w: World) {
  const offline = [...w.screens.values()]
    .filter((s) => s.tenantId && s.status !== 'REVOKED' && s.lastPingAt && w.clock.now - s.lastPingAt.getTime() > 5 * MIN)
    .map((s) => ({ id: s.id, name: s.name, tenantId: s.tenantId, lastPingAt: s.lastPingAt, screenGroupId: s.screenGroupId, faceOfScreenId: s.faceOfScreenId }));
  return { found: offline.length, notified: 0, infraEvents: 0, crossings: 0, recovered: 0, seeded: false, offline, truncated: false, infraEventTenantIds: [] };
}

function build(w: World) {
  const email = { isConfigured: () => true, sendCustomerAlert: jest.fn(async () => 'SENT') };
  const mailer = { sendAlert: jest.fn(async () => undefined) };
  const svc = new CustomerAlertEmailsService({ client: w.client } as any, email as any, mailer as any);
  svc.now = () => w.clock.now;
  svc.uptimeMs = () => 60 * MIN;
  return { svc, email, mailer };
}

/** Advance the clock one scan and run it. */
async function scan(w: World, svc: CustomerAlertEmailsService, stepMin = 1) {
  w.clock.now += stepMin * MIN;
  return svc.onOfflineScan(scanOf(w) as any);
}

const ENV = { ...process.env };
let w: World;
beforeEach(() => {
  process.env = { ...ENV, CUSTOMER_ALERT_EMAILS_MODE: 'on', APP_PUBLIC_URL: 'https://app.venueos.test' };
  delete process.env.CUSTOMER_ALERT_EMAILS_DISABLED;
  delete process.env.CUSTOMER_ALERT_EMAILS_PER_HOUR;
  resetPlatformDegradationForTests();
  w = makeWorld();
  seed(w);
});
afterAll(() => {
  process.env = ENV;
});

const sentTo = (email: any) => email.sendCustomerAlert.mock.calls.map((c: any[]) => c[0].to).sort();
const subjects = (email: any) => [...new Set(email.sendCustomerAlert.mock.calls.map((c: any[]) => c[0].subject))];

describe('recipients', () => {
  it('the location’s admins + the parent organisation’s admins; never opted-out, non-admin, placeholder or deleted accounts', async () => {
    const { svc } = build(w);
    const tenants = await svc.loadTenants(['lincoln']);
    const r = await svc.recipientsFor(['lincoln'], tenants);
    expect(r.map((x) => x.id).sort()).toEqual(['principal', 'superintendent']);
    expect(r.find((x) => x.id === 'superintendent')!.locale).toBe('es');
    expect(r.find((x) => x.id === 'principal')!.locale).toBe('en');
  });
  it('a sibling location’s admin is not a recipient', async () => {
    const { svc } = build(w);
    const r = await svc.recipientsFor(['lincoln'], await svc.loadTenants(['lincoln']));
    expect(r.map((x) => x.id)).not.toContain('adams-admin');
  });
});

describe('offline ≥ 15 min, two scans, one email per site-wide drop', () => {
  it('nothing before 15 min; nothing on the first due scan; ONE email listing all 3 screens on the second', async () => {
    const { svc, email } = build(w);
    for (const id of ['lobby', 'gym', 'office']) screen(w, id, 'lincoln');
    const dropAt = w.clock.now;
    // office went quiet a minute later: it is not due on its own yet, but it rides in the same email.
    for (const id of ['lobby', 'gym', 'office']) goOffline(w, id, dropAt + (id === 'office' ? MIN : 0));
    w.clock.now = dropAt + 14 * MIN;
    await scan(w, svc, 0);
    expect(email.sendCustomerAlert).not.toHaveBeenCalled();
    await scan(w, svc); // 15 min — due, first time seen due
    expect(email.sendCustomerAlert).not.toHaveBeenCalled();
    await scan(w, svc); // 16 min — confirmed
    expect(sentTo(email)).toEqual(['principal@example.org', 'superintendent@example.org']);
    const principal = email.sendCustomerAlert.mock.calls.find((c: any[]) => c[0].to === 'principal@example.org')[0];
    expect(principal.subject).toBe('VenueOS: 3 screens offline at Lincoln Elementary');
    expect(principal.body).toContain('lobby — offline for 16 minutes');
    expect(principal.body).toContain('office — offline for 15 minutes');
    expect(principal.body).toContain('Manage alert emails: https://app.venueos.test/lincoln/account#alert-emails');
    const sup = email.sendCustomerAlert.mock.calls.find((c: any[]) => c[0].to === 'superintendent@example.org')[0];
    expect(sup.subject).toBe('VenueOS: 3 pantallas sin conexión en Lincoln Elementary');
    expect(w.sends).toEqual([expect.objectContaining({ orgId: 'district', kind: 'OFFLINE', mode: 'on', itemCount: 3, recipientCount: 2 })]);
  });

  it('dedupe across a RESTART: a new process does not email the same incident again', async () => {
    const a = build(w);
    screen(w, 'lobby', 'lincoln');
    goOffline(w, 'lobby', w.clock.now);
    w.clock.now += 15 * MIN;
    await scan(w, a.svc, 0);
    await scan(w, a.svc);
    expect(a.email.sendCustomerAlert).toHaveBeenCalledTimes(2);
    const b = build(w); // the "restarted" process: same database, fresh memory
    for (let i = 0; i < 5; i++) await scan(w, b.svc);
    expect(b.email.sendCustomerAlert).not.toHaveBeenCalled();
  });

  it('back online: only after the recovery held 5 min, and only for screens we emailed about', async () => {
    const { svc, email } = build(w);
    screen(w, 'lobby', 'lincoln');
    goOffline(w, 'lobby', w.clock.now);
    w.clock.now += 15 * MIN;
    await scan(w, svc, 0);
    await scan(w, svc);
    email.sendCustomerAlert.mockClear();
    comeBack(w, 'lobby');
    await scan(w, svc, 0); // recovery clock starts
    for (let i = 0; i < 4; i++) {
      comeBack(w, 'lobby');
      await scan(w, svc);
    }
    expect(email.sendCustomerAlert).not.toHaveBeenCalled();
    comeBack(w, 'lobby');
    await scan(w, svc); // 5 min held
    expect(subjects(email)).toEqual(['VenueOS: lobby is back online at Lincoln Elementary', 'VenueOS: lobby volvió a estar en línea en Lincoln Elementary']);
  });

  it('a screen that came back BEFORE it was emailed gets nothing at all', async () => {
    const { svc, email } = build(w);
    screen(w, 'lobby', 'lincoln');
    goOffline(w, 'lobby', w.clock.now);
    w.clock.now += 15 * MIN;
    await scan(w, svc, 0); // due once, not confirmed
    comeBack(w, 'lobby');
    for (let i = 0; i < 10; i++) {
      comeBack(w, 'lobby');
      await scan(w, svc);
    }
    expect(email.sendCustomerAlert).not.toHaveBeenCalled();
  });

  it('flap: offline → back → offline again within 6 h = ONE offline email', async () => {
    const { svc, email } = build(w);
    screen(w, 'lobby', 'lincoln');
    const cycle = async () => {
      goOffline(w, 'lobby', w.clock.now);
      w.clock.now += 15 * MIN;
      await scan(w, svc, 0);
      await scan(w, svc);
      comeBack(w, 'lobby');
      for (let i = 0; i < 7; i++) {
        comeBack(w, 'lobby');
        await scan(w, svc);
      }
    };
    await cycle();
    await cycle();
    await cycle();
    const offline = email.sendCustomerAlert.mock.calls.filter((c: any[]) => c[0].to === 'principal@example.org' && /offline at/.test(c[0].subject));
    expect(offline).toHaveLength(1);
    // …and the silenced repeats get no "back online" either: exactly one.
    const back = email.sendCustomerAlert.mock.calls.filter((c: any[]) => c[0].to === 'principal@example.org' && /back online/.test(c[0].subject));
    expect(back).toHaveLength(1);
  });
});

describe('rate limit: 6 per organisation per hour, then ONE digest', () => {
  it('7 locations drop → 6 emails, the 7th is held, then one digest once the hour rolls', async () => {
    process.env.CUSTOMER_ALERT_EMAILS_MODE = 'on';
    const { svc, email } = build(w);
    const locs = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'];
    for (const l of locs) {
      w.tenants.set(l, { id: l, name: `School ${l}`, slug: l, parentId: 'district', archivedAt: null });
      screen(w, `${l}-tv`, l);
      goOffline(w, `${l}-tv`, w.clock.now);
    }
    w.clock.now += 15 * MIN;
    await scan(w, svc, 0);
    await scan(w, svc);
    const supCalls = () => email.sendCustomerAlert.mock.calls.filter((c: any[]) => c[0].to === 'superintendent@example.org');
    expect(supCalls()).toHaveLength(6);
    expect(w.incidents.filter((i) => i.state === 'HELD')).toHaveLength(1);
    // Nothing more inside the hour…
    for (let i = 0; i < 30; i++) await scan(w, svc);
    expect(supCalls()).toHaveLength(6);
    // …then the hour rolls and ONE digest goes out.
    for (let i = 0; i < 31; i++) await scan(w, svc);
    expect(supCalls()).toHaveLength(7);
    expect(supCalls()[6][0].subject).toMatch(/^VenueOS: 1 novedades de pantallas en Springfield District$/);
    expect(w.incidents.filter((i) => i.state === 'HELD')).toHaveLength(0);
  });
});

describe('false-positive rails', () => {
  async function dropAndScan(svc: CustomerAlertEmailsService, id = 'lobby', tenant = 'lincoln') {
    screen(w, id, tenant);
    goOffline(w, id, w.clock.now);
    w.clock.now += 15 * MIN;
    await scan(w, svc, 0);
    return scan(w, svc);
  }

  it('SHADOW (the default): no customer email; the owner gets "[shadow] would have sent to N admins at <org>: <subject>"', async () => {
    delete process.env.CUSTOMER_ALERT_EMAILS_MODE;
    const { svc, email, mailer } = build(w);
    await dropAndScan(svc);
    expect(email.sendCustomerAlert).not.toHaveBeenCalled();
    expect(mailer.sendAlert).toHaveBeenCalledTimes(1);
    expect(mailer.sendAlert.mock.calls[0][0]).toBe(
      '[shadow] would have sent to 2 admins at Springfield District: VenueOS: lobby is offline at Lincoln Elementary',
    );
    expect(w.sends[0]).toMatchObject({ mode: 'shadow', recipientCount: 2 });
  });

  it('kill switch CUSTOMER_ALERT_EMAILS_DISABLED=1: nothing sent, nothing written', async () => {
    process.env.CUSTOMER_ALERT_EMAILS_DISABLED = '1';
    const { svc, email, mailer } = build(w);
    const res = await dropAndScan(svc);
    expect(res.mode).toBe('off');
    expect(email.sendCustomerAlert).not.toHaveBeenCalled();
    expect(mailer.sendAlert).not.toHaveBeenCalled();
    expect(w.incidents).toHaveLength(0);
  });

  it('API restart: nothing within 15 min of boot', async () => {
    const { svc, email } = build(w);
    svc.uptimeMs = () => 5 * MIN;
    const res = await dropAndScan(svc);
    expect(res.gate).toBe('api-restart');
    expect(email.sendCustomerAlert).not.toHaveBeenCalled();
  });

  it('platform degraded (a watchdog reports unhealthy): nothing', async () => {
    reportPlatformComponent('storage', 'degraded', w.clock.now + 15 * MIN);
    const { svc, email } = build(w);
    const res = await dropAndScan(svc);
    expect(res.gate).toBe('platform-degraded');
    expect(email.sendCustomerAlert).not.toHaveBeenCalled();
  });

  it('PLATFORM INCIDENT: 3 organisations drop together → no customer email, ONE platform alert, those screens never emailed', async () => {
    const { svc, email, mailer } = build(w);
    for (const [id, t] of [['lobby', 'lincoln'], ['acme-tv', 'acme'], ['globex-tv', 'globex']]) {
      screen(w, id, t);
      goOffline(w, id, w.clock.now);
    }
    w.clock.now += 15 * MIN;
    await scan(w, svc, 0);
    const res = await scan(w, svc);
    expect(res.platformIncident).toBe(true);
    expect(email.sendCustomerAlert).not.toHaveBeenCalled();
    expect(mailer.sendAlert).toHaveBeenCalledTimes(1);
    expect(mailer.sendAlert.mock.calls[0][0]).toMatch(/Possible platform incident — 3 screens in 3 organisations/);
    expect(w.incidents.map((i) => i.state)).toEqual(['SILENT', 'SILENT', 'SILENT']);
    // The quiet window holds, and after it the same screens are still never emailed.
    for (let i = 0; i < 40; i++) await scan(w, svc);
    expect(email.sendCustomerAlert).not.toHaveBeenCalled();
    expect(mailer.sendAlert).toHaveBeenCalledTimes(1);
  });

  it('PLATFORM INCIDENT is seen by the FIRST screen to become due (the others are offline but not due yet)', async () => {
    const { svc, email, mailer } = build(w);
    screen(w, 'lobby', 'lincoln');
    goOffline(w, 'lobby', w.clock.now);
    for (const [id, t] of [['acme-tv', 'acme'], ['globex-tv', 'globex']]) {
      screen(w, id, t);
      goOffline(w, id, w.clock.now + 3 * MIN);
    }
    w.clock.now += 15 * MIN;
    await scan(w, svc, 0);
    const res = await scan(w, svc); // lobby confirmed; acme/globex only 13 min down
    expect(res.platformIncident).toBe(true);
    expect(email.sendCustomerAlert).not.toHaveBeenCalled();
    expect(mailer.sendAlert).toHaveBeenCalledTimes(1);
  });

  it('an on/off schedule that switches 3 organisations off at the same minute is NOT a platform incident (and nobody is emailed)', async () => {
    const { svc, email, mailer } = build(w);
    for (const tenantId of ['lincoln', 'acme', 'globex']) {
      w.displaySchedules.push({ id: `ds-${tenantId}`, tenantId, screenId: null, screenGroupId: null, daysOfWeek: [1, 2, 3, 4, 5], onTime: '07:00', offTime: '09:00', timezone: 'America/Chicago', isActive: true });
    }
    for (const [id, t] of [['lobby', 'lincoln'], ['acme-tv', 'acme'], ['globex-tv', 'globex']]) {
      screen(w, id, t);
      goOffline(w, id, w.clock.now);
    }
    w.clock.now += 15 * MIN;
    await scan(w, svc, 0);
    const res = await scan(w, svc);
    expect(res.platformIncident).toBe(false);
    expect(res.deferred).toEqual({ 'display-schedule-off': 3 });
    expect(email.sendCustomerAlert).not.toHaveBeenCalled();
    expect(mailer.sendAlert).not.toHaveBeenCalled();
    expect(w.incidents).toHaveLength(0);
  });

  it('remote power-off: deferred, never emailed while it stands', async () => {
    const { svc, email } = build(w);
    w.auditLogs.push({ targetId: 'lobby', action: 'SCREEN_DISPLAY_CONTROL', details: JSON.stringify({ requested: 'POWER_OFF' }), createdAt: new Date(w.clock.now) });
    const res = await dropAndScan(svc);
    expect(res.deferred).toEqual({ 'remote-power-off': 1 });
    expect(email.sendCustomerAlert).not.toHaveBeenCalled();
  });

  it('on/off schedule OFF window: deferred', async () => {
    const { svc, email } = build(w);
    w.displaySchedules.push({ id: 'ds', tenantId: 'lincoln', screenId: null, screenGroupId: null, daysOfWeek: [1, 2, 3, 4, 5], onTime: '07:00', offTime: '09:00', timezone: 'America/Chicago', isActive: true });
    const res = await dropAndScan(svc);
    expect(res.deferred).toEqual({ 'display-schedule-off': 1 });
    expect(email.sendCustomerAlert).not.toHaveBeenCalled();
  });

  it('a reboot / player update just happened: deferred', async () => {
    const { svc, email } = build(w);
    w.screenEvents.push({ screenId: 'lobby', createdAt: new Date(w.clock.now + 10 * MIN) });
    const res = await dropAndScan(svc);
    expect(res.deferred).toEqual({ maintenance: 1 });
    expect(email.sendCustomerAlert).not.toHaveBeenCalled();
  });

  it('a just-installed screen (paired < 2 h before it went quiet): deferred', async () => {
    const { svc, email } = build(w);
    screen(w, 'lobby', 'lincoln', { pairedAt: new Date(w.clock.now - 30 * MIN) });
    goOffline(w, 'lobby', w.clock.now);
    w.clock.now += 15 * MIN;
    await scan(w, svc, 0);
    const res = await scan(w, svc);
    expect(res.deferred).toEqual({ 'just-installed': 1 });
    expect(email.sendCustomerAlert).not.toHaveBeenCalled();
  });
});

describe('the restart quiet holds CUSTOMER emails only — never the owner’s platform-incident alert (2026-10-23)', () => {
  const threeOrgs: Array<[string, string]> = [['lobby', 'lincoln'], ['acme-tv', 'acme'], ['globex-tv', 'globex']];
  const subjectsTo = (mailer: any) => mailer.sendAlert.mock.calls.map((c: any[]) => c[0]);

  it('an outage that begins AT a restart: the owner hears once the screens are due; no customer email', async () => {
    const { svc, email, mailer } = build(w);
    const bootAt = w.clock.now;
    svc.uptimeMs = () => w.clock.now - bootAt;
    for (const [id, t] of threeOrgs) {
      screen(w, id, t);
      goOffline(w, id, bootAt + MIN);
    }
    for (let i = 0; i < 20; i++) await scan(w, svc);
    expect(subjectsTo(mailer)).toEqual([expect.stringMatching(/Possible platform incident — 3 screens in 3 organisations/)]);
    expect(email.sendCustomerAlert).not.toHaveBeenCalled();
    expect(w.incidents.map((i) => i.state)).toEqual(['SILENT', 'SILENT', 'SILENT']);
  });

  it('a SECOND restart inside the quiet (a fix deploy, a crash) no longer mutes it', async () => {
    const a = build(w);
    const firstBoot = w.clock.now;
    a.svc.uptimeMs = () => w.clock.now - firstBoot;
    for (const [id, t] of threeOrgs) {
      screen(w, id, t);
      goOffline(w, id, firstBoot + MIN);
    }
    for (let i = 0; i < 9; i++) await scan(w, a.svc);
    // Ten minutes in, the API restarts again: a fresh process, a fresh quiet.
    const b = build(w);
    const secondBoot = w.clock.now + MIN;
    b.svc.uptimeMs = () => w.clock.now - secondBoot;
    const results: CustomerAlertTickResult[] = [];
    for (let i = 0; i < 10; i++) results.push(await scan(w, b.svc));
    // Every one of those scans was inside the second process's quiet…
    expect(results.map((r) => r.gate).every((g) => g === 'api-restart' || g === 'platform-incident')).toBe(true);
    // …and the owner still heard, 16 minutes after the screens went dark.
    expect(subjectsTo(b.mailer)).toEqual([expect.stringMatching(/Possible platform incident — 3 screens in 3 organisations/)]);
    expect(results.find((r) => r.platformIncident)).toMatchObject({ gate: 'platform-incident' });
    expect(a.email.sendCustomerAlert).not.toHaveBeenCalled();
    expect(b.email.sendCustomerAlert).not.toHaveBeenCalled();
  });

  it('after the quiet, a customer email still needs two scans of its own (unchanged)', async () => {
    const { svc, email, mailer } = build(w);
    let uptime = 5 * MIN;
    svc.uptimeMs = () => uptime;
    screen(w, 'lobby', 'lincoln');
    goOffline(w, 'lobby', w.clock.now);
    w.clock.now += 15 * MIN;
    await scan(w, svc, 0);
    await scan(w, svc);
    await scan(w, svc); // due and "confirmed" inside the quiet — one organisation, so no incident
    expect(email.sendCustomerAlert).not.toHaveBeenCalled();
    expect(mailer.sendAlert).not.toHaveBeenCalled();
    uptime = 16 * MIN;
    expect((await scan(w, svc)).sends).toBe(0); // first open scan: confirmation starts over
    expect(email.sendCustomerAlert).not.toHaveBeenCalled();
    await scan(w, svc);
    expect(sentTo(email)).toEqual(['principal@example.org', 'superintendent@example.org']);
  });

  it('a degraded platform inside the restart quiet still holds everything', async () => {
    const { svc, mailer } = build(w);
    svc.uptimeMs = () => 5 * MIN;
    reportPlatformComponent('platform', 'critical', w.clock.now + 15 * MIN);
    for (const [id, t] of threeOrgs) {
      screen(w, id, t);
      goOffline(w, id, w.clock.now);
    }
    w.clock.now += 15 * MIN;
    await scan(w, svc, 0);
    const res = await scan(w, svc);
    expect(res.gate).toBe('api-restart');
    expect(mailer.sendAlert).not.toHaveBeenCalled();
    expect(w.incidents).toHaveLength(0);
  });
});

describe('online but not showing content', () => {
  function blank(id: string, over: Row = {}) {
    screen(w, id, 'lincoln', { lastRenderedAt: new Date(w.clock.now - 21 * MIN), ...over });
  }
  const keepPinging = (id: string) => Object.assign(w.screens.get(id)!, { lastPingAt: new Date(w.clock.now - 10_000) });

  it('content assigned + stale proof ≥ 20 min on two scans → one email; content back for 5 min → "showing content again"', async () => {
    const { svc, email } = build(w);
    w.schedules.push({ tenantId: 'lincoln', screenId: 'lobby', screenGroupId: null });
    blank('lobby');
    await scan(w, svc, 0);
    keepPinging('lobby');
    await scan(w, svc);
    expect(subjects(email)).toContain('VenueOS: lobby is on but not showing content at Lincoln Elementary');
    email.sendCustomerAlert.mockClear();
    for (let i = 0; i < 6; i++) {
      comeBack(w, 'lobby');
      await scan(w, svc);
    }
    expect(subjects(email)).toContain('VenueOS: lobby is showing content again at Lincoln Elementary');
  });

  it('no content assigned → never', async () => {
    const { svc, email } = build(w);
    blank('lobby');
    for (let i = 0; i < 5; i++) {
      keepPinging('lobby');
      await scan(w, svc);
    }
    expect(email.sendCustomerAlert).not.toHaveBeenCalled();
  });

  it('an older player that never posts render proof → never graded blank', async () => {
    const { svc, email } = build(w);
    w.schedules.push({ tenantId: 'lincoln', screenId: 'lobby', screenGroupId: null });
    blank('lobby', { lastRenderedAt: null });
    for (let i = 0; i < 5; i++) {
      keepPinging('lobby');
      await scan(w, svc);
    }
    expect(email.sendCustomerAlert).not.toHaveBeenCalled();
  });

  it('a web-page screen (no render proof by design) → never', async () => {
    const { svc, email } = build(w);
    w.schedules.push({ tenantId: 'lincoln', screenId: 'lobby', screenGroupId: null });
    w.schedules.push({ tenantId: 'lincoln', screenId: 'lobby', screenGroupId: null, web: true });
    blank('lobby');
    for (let i = 0; i < 5; i++) {
      keepPinging('lobby');
      await scan(w, svc);
    }
    expect(email.sendCustomerAlert).not.toHaveBeenCalled();
  });

  it('"Content unavailable" counts only after 20 min of it', async () => {
    const { svc, email } = build(w);
    w.schedules.push({ tenantId: 'lincoln', screenId: 'lobby', screenGroupId: null });
    screen(w, 'lobby', 'lincoln', { lastRenderedHash: 'idle:content-unavailable' });
    for (let i = 0; i < 19; i++) {
      comeBack(w, 'lobby');
      await scan(w, svc);
    }
    expect(email.sendCustomerAlert).not.toHaveBeenCalled();
    for (let i = 0; i < 3; i++) {
      comeBack(w, 'lobby');
      await scan(w, svc);
    }
    const principal = email.sendCustomerAlert.mock.calls.find((c: any[]) => c[0].to === 'principal@example.org')[0];
    expect(principal.body).toContain('showing "Content unavailable"');
  });
});

describe('2026-10-24 production replay — why the first day produced no email, and that one is produced when due', () => {
  // The facts, read (read-only) from production on 2026-10-24:
  //   - "Venue-OS Media Player" (VisionCore): last heartbeat 2026-10-23
  //     05:44:20Z, 12 h 20 min before this feature went live (18:05Z). The
  //     20:46Z quoted for it is `manager_version_at` — the Manager APK's
  //     anonymous update check — not a heartbeat. Two more screens went quiet
  //     in the same minute (05:43–05:44Z).
  //   - "G24" (Brookfield): silent from 2026-10-24 08:32:59Z = Saturday
  //     01:32 PDT; its group's on/off schedule is Mon–Fri 07:00–18:00
  //     America/Los_Angeles. The only screen that went dark long enough
  //     after go-live (SAR55 was back within 10 min).
  // Acme stands in for each organisation (one admin).
  const LIVE = Date.parse('2026-10-23T18:05:00Z');
  const weekdaySchedule = {
    id: 'brookfield-weekday',
    tenantId: 'acme',
    screenId: null,
    screenGroupId: 'grp-weekday',
    daysOfWeek: [1, 2, 3, 4, 5],
    onTime: '07:00',
    offTime: '18:00',
    timezone: 'America/Los_Angeles',
    isActive: true,
  };
  beforeEach(() => {
    delete process.env.CUSTOMER_ALERT_EMAILS_MODE; // shadow, as in production
  });

  it('silent since 12 h before go-live: counted as the long-dead tail on every scan, never emailed', async () => {
    const { svc, mailer } = build(w);
    w.clock.now = LIVE;
    screen(w, 'media-player', 'acme');
    goOffline(w, 'media-player', Date.parse('2026-10-23T05:44:20Z'));
    let res!: CustomerAlertTickResult;
    for (let i = 0; i < 60; i++) res = await scan(w, svc);
    expect(res).toMatchObject({ mode: 'shadow', offlineTooOld: 1, offlineDue: 0, offlineCandidates: 0, sends: 0 });
    expect(mailer.sendAlert).not.toHaveBeenCalled();
    expect(w.incidents).toHaveLength(0);
    expect(w.sends).toHaveLength(0);
  });

  it('G24: dark at 01:32 on a Saturday, inside its own schedule’s OFF window → due, deferred on every scan, never emailed that Saturday', async () => {
    const { svc, mailer } = build(w);
    w.displaySchedules.push(weekdaySchedule);
    const dark = Date.parse('2026-10-24T08:32:59Z');
    w.clock.now = dark - 10 * MIN;
    screen(w, 'g24', 'acme', { screenGroupId: 'grp-weekday' });
    goOffline(w, 'g24', dark);
    w.clock.now = dark + 15 * MIN;
    await scan(w, svc, 0);
    const confirmed = await scan(w, svc);
    expect(confirmed).toMatchObject({ offlineDue: 1, offlineCandidates: 1, deferred: { 'display-schedule-off': 1 }, sends: 0 });
    for (let i = 0; i < 75; i++) await scan(w, svc, 5); // the next 6 h 15 min
    expect(mailer.sendAlert).not.toHaveBeenCalled();
    expect(w.incidents).toHaveLength(0);
    const later = await scan(w, svc);
    expect(later).toMatchObject({ offlineDue: 0, offlineTooOld: 1 });
  });

  it('control: the same screen dark at 10:32 on a Monday (schedule ON) → the owner gets the shadow email on the second due scan', async () => {
    const { svc, email, mailer } = build(w);
    w.displaySchedules.push(weekdaySchedule);
    const dark = Date.parse('2026-10-26T17:32:59Z');
    w.clock.now = dark - 10 * MIN;
    screen(w, 'g24', 'acme', { screenGroupId: 'grp-weekday' });
    goOffline(w, 'g24', dark);
    w.clock.now = dark + 15 * MIN;
    await scan(w, svc, 0);
    expect(mailer.sendAlert).not.toHaveBeenCalled();
    const res = await scan(w, svc);
    expect(res).toMatchObject({ offlineDue: 1, opened: 1, sends: 1 });
    expect(res.deferred).toEqual({});
    expect(email.sendCustomerAlert).not.toHaveBeenCalled();
    expect(mailer.sendAlert).toHaveBeenCalledTimes(1);
    const [subject, , kind] = mailer.sendAlert.mock.calls[0] as unknown as [string, string, string];
    expect(subject).toBe('[shadow] would have sent to 1 admins at Acme Corp: VenueOS: g24 is offline at Acme Corp');
    expect(kind).toBe('ALERT_SHADOW_OFFLINE');
    expect(w.sends).toEqual([expect.objectContaining({ orgId: 'acme', kind: 'OFFLINE', mode: 'shadow', recipientCount: 1 })]);
  });
});

describe('emergency record copy', () => {
  it('one email per admin, the location names, no person named', async () => {
    const { svc, email } = build(w);
    const n = await svc.sendEmergencyRecord({ event: 'TRIGGERED', overrideId: 'o1', alertType: 'LOCKDOWN', isDrill: false, tenantIds: ['lincoln'], screenCount: 12 });
    expect(n).toBe(1);
    expect(sentTo(email)).toEqual(['principal@example.org', 'superintendent@example.org']);
    const p = email.sendCustomerAlert.mock.calls.find((c: any[]) => c[0].to === 'principal@example.org')[0];
    expect(p.subject).toBe('VenueOS: Lockdown alert sent to Lincoln Elementary');
    expect(p.body).toContain('A Lockdown alert was sent to Lincoln Elementary (12 screens).');
    expect(p.kind).toBe('ALERT_EMERGENCY');
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 2026-10-25 — the owner's two new rules, end to end (shadow: owner only).
// ═════════════════════════════════════════════════════════════════════════

const PDT = (iso: string) => Date.parse(`${iso}-07:00`);
/** An on/off schedule row as production stores it (Brookfield's groups: 07:00–18:00 Los Angeles). */
const onOff = (tenantId: string, screenGroupId: string, daysOfWeek: number[]) => ({
  id: `ds-${screenGroupId}`,
  tenantId,
  screenId: null,
  screenGroupId,
  daysOfWeek,
  onTime: '07:00',
  offTime: '18:00',
  timezone: 'America/Los_Angeles',
  isActive: true,
});
const WEEKDAYS = [1, 2, 3, 4, 5];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
/** Scan at an exact moment (the clock is set, not advanced). */
async function scanAt(w: World, svc: CustomerAlertEmailsService, atMs: number) {
  w.clock.now = atMs;
  return svc.onOfflineScan(scanOf(w) as any);
}

describe('Rule 1 — "didn’t come back on at its scheduled on time" (2026-10-25)', () => {
  beforeEach(() => {
    delete process.env.CUSTOMER_ALERT_EMAILS_MODE; // shadow, as in production
  });

  it('G24 (production replay): dark Saturday 01:32 → nothing all weekend → ONE shadow email at Monday 07:16, never repeated', async () => {
    const { svc, mailer } = build(w);
    w.displaySchedules.push(onOff('acme', 'grp-weekday', WEEKDAYS));
    const dark = PDT('2026-10-24T01:32:59');
    w.clock.now = dark - 10 * MIN;
    screen(w, 'g24', 'acme', { screenGroupId: 'grp-weekday' });
    goOffline(w, 'g24', dark);
    // Saturday, Sunday and early Monday, every 30 minutes: meant to be off.
    for (let t = dark + 15 * MIN; t < PDT('2026-10-26T06:30:00'); t += 30 * MIN) await scanAt(w, svc, t);
    expect(mailer.sendAlert).not.toHaveBeenCalled();

    expect(await scanAt(w, svc, PDT('2026-10-26T07:14:00'))).toMatchObject({ offlineDue: 0 });
    expect(await scanAt(w, svc, PDT('2026-10-26T07:15:00'))).toMatchObject({ offlineDue: 1, offlineMissedOnTime: 1, sends: 0 });
    const res = await scanAt(w, svc, PDT('2026-10-26T07:16:00'));
    expect(res).toMatchObject({ offlineMissedOnTime: 1, opened: 1, sends: 1 });
    expect(res.deferred).toEqual({});
    expect(mailer.sendAlert).toHaveBeenCalledTimes(1);
    const [subject, body, kind] = mailer.sendAlert.mock.calls[0] as unknown as [string, string, string];
    expect(subject).toBe("[shadow] would have sent to 1 admins at Acme Corp: VenueOS: g24 at Acme Corp didn't come back on at 7:00 AM");
    expect(body).toContain("g24 — didn't come back on at 7:00 AM, its scheduled on time");
    expect(kind).toBe('ALERT_SHADOW_OFFLINE');
    expect(w.incidents).toEqual([
      expect.objectContaining({
        screenId: 'g24',
        kind: 'OFFLINE',
        state: 'EMAILED',
        reason: 'missed-on-time',
        startedAt: new Date(PDT('2026-10-26T07:00:00')),
      }),
    ]);

    // Still dark: not later on Monday, not at Tuesday's switch-on.
    for (let t = PDT('2026-10-26T07:17:00'); t < PDT('2026-10-26T09:00:00'); t += 10 * MIN) await scanAt(w, svc, t);
    for (let t = PDT('2026-10-27T07:10:00'); t < PDT('2026-10-27T07:40:00'); t += MIN) await scanAt(w, svc, t);
    expect(mailer.sendAlert).toHaveBeenCalledTimes(1);
  });

  it('…and it comes back: "back online" once the recovery has held 5 minutes', async () => {
    const { svc, mailer } = build(w);
    w.displaySchedules.push(onOff('acme', 'grp-daily', EVERY_DAY));
    w.clock.now = PDT('2026-10-25T22:00:00');
    screen(w, 'lobby-tv', 'acme', { screenGroupId: 'grp-daily' });
    goOffline(w, 'lobby-tv', PDT('2026-10-25T23:00:00'));
    for (const hhmm of ['07:15', '07:16']) await scanAt(w, svc, PDT(`2026-10-26T${hhmm}:00`));
    expect(mailer.sendAlert).toHaveBeenCalledTimes(1);
    for (let t = PDT('2026-10-26T07:40:00'); t <= PDT('2026-10-26T07:47:00'); t += MIN) {
      w.clock.now = t;
      comeBack(w, 'lobby-tv');
      await scanAt(w, svc, t);
    }
    expect(mailer.sendAlert).toHaveBeenCalledTimes(2);
    expect((mailer.sendAlert.mock.calls[1] as unknown as string[])[0]).toBe(
      '[shadow] would have sent to 1 admins at Acme Corp: VenueOS: lobby-tv is back online at Acme Corp',
    );
  });

  it('a screen dark for a WEEK in a scheduled group → never, morning after morning', async () => {
    const { svc, mailer } = build(w);
    w.displaySchedules.push(onOff('acme', 'grp-daily', EVERY_DAY));
    w.clock.now = PDT('2026-10-19T09:00:00');
    screen(w, 'old-tv', 'acme', { screenGroupId: 'grp-daily' });
    goOffline(w, 'old-tv', PDT('2026-10-19T10:00:00'));
    let res!: CustomerAlertTickResult;
    for (const day of ['2026-10-26', '2026-10-27', '2026-10-28']) {
      for (let t = PDT(`${day}T06:50:00`); t < PDT(`${day}T07:40:00`); t += MIN) res = await scanAt(w, svc, t);
    }
    expect(mailer.sendAlert).not.toHaveBeenCalled();
    expect(res).toMatchObject({ offlineDue: 0, offlineMissedOnTime: 0, offlineTooOld: 1 });
  });

  it('three organisations each with ONE screen that did not come on at 7:00 → three emails, not a "platform incident"', async () => {
    const { svc, mailer } = build(w);
    for (const [t, g] of [['acme', 'grp-a'], ['globex', 'grp-g'], ['initech', 'grp-i']]) {
      w.displaySchedules.push(onOff(t, g, EVERY_DAY));
      w.clock.now = PDT('2026-10-25T20:00:00');
      screen(w, `${t}-tv`, t, { screenGroupId: g });
      goOffline(w, `${t}-tv`, PDT('2026-10-26T02:00:00'));
    }
    await scanAt(w, svc, PDT('2026-10-26T07:15:00'));
    const res = await scanAt(w, svc, PDT('2026-10-26T07:16:00'));
    expect(res.platformIncident).toBe(false);
    expect(res.sends).toBe(3);
    expect(mailer.sendAlert).toHaveBeenCalledTimes(3);
  });

  it('…but if always-on screens really DROPPED at that minute too, it is still our incident (silenced, one owner alert)', async () => {
    const { svc, mailer } = build(w);
    for (const [t, g] of [['acme', 'grp-a'], ['globex', 'grp-g']]) {
      w.displaySchedules.push(onOff(t, g, EVERY_DAY));
      w.clock.now = PDT('2026-10-25T20:00:00');
      screen(w, `${t}-tv`, t, { screenGroupId: g });
      goOffline(w, `${t}-tv`, PDT('2026-10-26T02:00:00'));
    }
    w.clock.now = PDT('2026-10-26T06:00:00');
    screen(w, 'initech-tv', 'initech'); // no schedule: it really went quiet at 06:59
    goOffline(w, 'initech-tv', PDT('2026-10-26T06:59:00'));
    await scanAt(w, svc, PDT('2026-10-26T07:15:00'));
    const res = await scanAt(w, svc, PDT('2026-10-26T07:16:00'));
    expect(res.platformIncident).toBe(true);
    expect(mailer.sendAlert).toHaveBeenCalledTimes(1);
    expect((mailer.sendAlert.mock.calls[0] as unknown as string[])[0]).toMatch(/Possible platform incident/);
  });
});

describe('Rule 2 — a remote power-off excuses only while the screen is really off by it (2026-10-25)', () => {
  beforeEach(() => {
    delete process.env.CUSTOMER_ALERT_EMAILS_MODE;
  });
  /** An audit row exactly as `DisplayService` writes it. */
  const control = (targetId: string, requested: string, at: string, outcome = 'dispatched') =>
    w.auditLogs.push({
      targetId,
      action: 'SCREEN_DISPLAY_CONTROL',
      details: JSON.stringify({ requested, outcome, delivered: outcome === 'dispatched', actionId: `${targetId}-${at}` }),
      createdAt: new Date(at),
    });

  it('M43 + L55VEC (production replay): their 10-11/12 POWER_OFF rows, awake and painting since → NOT excused; a drop is emailed', async () => {
    const { svc, mailer } = build(w);
    w.displaySchedules.push(onOff('acme', 'grp-m43', EVERY_DAY), onOff('acme', 'grp-l55', EVERY_DAY));
    w.clock.now = PDT('2026-10-22T09:00:00');
    screen(w, 'M43', 'acme', { screenGroupId: 'grp-m43' });
    screen(w, 'L55VEC', 'acme', { screenGroupId: 'grp-l55' });
    control('M43', 'POWER_OFF', '2026-10-11T18:31:00Z');
    control('L55VEC', 'POWER_OFF', '2026-10-11T18:14:00Z', 'refused');
    for (const at of ['2026-10-11T18:23:00Z', '2026-10-11T18:58:00Z', '2026-10-12T00:08:00Z', '2026-10-12T00:38:00Z']) control('L55VEC', 'POWER_OFF', at);

    const tenants = await svc.loadTenants(['acme']);
    const facts = await svc.loadFacts([{ screenId: 'M43', tenantId: 'acme' }, { screenId: 'L55VEC', tenantId: 'acme' }], tenants, w.clock.now);
    expect(facts.get('M43')!.facts.lastPowerCommand).toBeNull();
    expect(facts.get('L55VEC')!.facts.lastPowerCommand).toBeNull();

    // Both drop at 10:00 on a Thursday (schedule ON): the owner hears about both.
    goOffline(w, 'M43', PDT('2026-10-22T10:00:00'));
    goOffline(w, 'L55VEC', PDT('2026-10-22T10:00:00'));
    await scanAt(w, svc, PDT('2026-10-22T10:15:00'));
    const res = await scanAt(w, svc, PDT('2026-10-22T10:16:00'));
    expect(res.deferred).toEqual({});
    expect(mailer.sendAlert).toHaveBeenCalledTimes(1);
    expect((mailer.sendAlert.mock.calls[0] as unknown as string[])[0]).toBe(
      '[shadow] would have sent to 1 admins at Acme Corp: VenueOS: 2 screens offline at Acme Corp',
    );
  });

  it('a REFUSED power-off never excuses', async () => {
    const { svc, mailer } = build(w);
    w.clock.now = PDT('2026-10-22T09:00:00');
    screen(w, 'lobby', 'lincoln');
    control('lobby', 'POWER_OFF', new Date(PDT('2026-10-22T09:30:00')).toISOString(), 'refused');
    goOffline(w, 'lobby', PDT('2026-10-22T09:31:00'));
    await scanAt(w, svc, PDT('2026-10-22T09:46:00'));
    const res = await scanAt(w, svc, PDT('2026-10-22T09:47:00'));
    expect(res.deferred).toEqual({});
    expect(mailer.sendAlert).toHaveBeenCalledTimes(1);
  });

  it('a real, ACCEPTED power-off with no wake since → still excused (the panel’s own record says it is dark)', async () => {
    const { svc, mailer } = build(w);
    w.clock.now = PDT('2026-10-22T09:00:00');
    const at = PDT('2026-10-22T09:30:00');
    screen(w, 'lobby', 'lincoln', {
      nativeRuntimeReportAt: new Date(at + 20 * MIN),
      nativeRuntimeReport: {
        schema: 1,
        interactive: true,
        foreground: true,
        standbySinceMs: null,
        elapsedRealtimeMs: 1000,
        powerOnAck: null,
        sleep: { blank: 'vendor-backlight', last: { m: 'vendor-backlight', o: 'off', at: at + 4_000 } },
      },
    });
    control('lobby', 'POWER_OFF', new Date(at).toISOString());
    goOffline(w, 'lobby', at + 40 * MIN); // the mains went off later that evening
    await scanAt(w, svc, at + 55 * MIN);
    const res = await scanAt(w, svc, at + 56 * MIN);
    expect(res.deferred).toEqual({ 'remote-power-off': 1 });
    expect(mailer.sendAlert).not.toHaveBeenCalled();
  });
});


describe('2026-10-31 accuracy pass: production row shapes', () => {
  const H = 60 * MIN;
  const prevSpell = (id: string, tenantId: string, startedAt: number, hours: number) =>
    w.incidents.push({
      id: `prev-${id}`,
      screenId: id,
      tenantId,
      kind: 'OFFLINE',
      open: false,
      state: 'CLOSED',
      reason: null,
      emailedMode: 'on',
      screenName: id,
      startedAt: new Date(startedAt),
      closedAt: new Date(startedAt + hours * H),
      recoveringSince: null,
      lastEmailedAt: new Date(startedAt + 16 * MIN),
    });

  it('a screen that goes dark at its usual evening hour (yesterday: 13 h dark) is silent, recorded, and gets NO "back online" note', async () => {
    const { svc, email } = build(w);
    screen(w, 'lobby', 'lincoln');
    prevSpell('lobby', 'lincoln', w.clock.now - 24 * H, 13);
    goOffline(w, 'lobby', w.clock.now);
    w.clock.now += 15 * MIN;
    await scan(w, svc, 0);
    const res = await scan(w, svc);
    expect(res.deferred).toEqual({ 'daily-pattern': 1 });
    expect(res.silenced).toBe(1);
    expect(email.sendCustomerAlert).not.toHaveBeenCalled();
    const row = w.incidents.find((i) => i.screenId === 'lobby')!;
    expect(row).toEqual(expect.objectContaining({ open: true, state: 'SILENT', reason: `daily-pattern:${13 * H}`, emailedMode: null }));
    await scan(w, svc);
    expect(email.sendCustomerAlert).not.toHaveBeenCalled();
    for (let i = 0; i < 7; i++) {
      comeBack(w, 'lobby');
      await scan(w, svc);
    }
    expect(email.sendCustomerAlert).not.toHaveBeenCalled();
    expect(w.incidents.find((i) => i.screenId === 'lobby')!.open).toBe(false);
  });

  it('a nightly screen that never returns: silent until 60 min past its learned return, then exactly ONE offline email', async () => {
    const { svc, email } = build(w);
    screen(w, 'lobby', 'lincoln');
    const drop = w.clock.now;
    prevSpell('lobby', 'lincoln', drop - 24 * H, 13);
    goOffline(w, 'lobby', drop);
    await scan(w, svc, 15);
    await scan(w, svc);
    expect(email.sendCustomerAlert).not.toHaveBeenCalled();
    for (const at of [drop + 6 * H, drop + 13 * H + 59 * MIN]) {
      await scanAt(w, svc, at);
      await scanAt(w, svc, at + MIN - 1_000);
    }
    expect(email.sendCustomerAlert).not.toHaveBeenCalled();
    await scanAt(w, svc, drop + 14 * H + 2 * MIN);
    await scanAt(w, svc, drop + 14 * H + 3 * MIN);
    expect(subjects(email)).toContain('VenueOS: lobby is offline at Lincoln Elementary');
    expect(w.sends).toHaveLength(1);
    const sent = email.sendCustomerAlert.mock.calls.length;
    await scanAt(w, svc, drop + 15 * H);
    await scanAt(w, svc, drop + 16 * H);
    expect(email.sendCustomerAlert.mock.calls.length).toBe(sent);
  });

  it('control: the same screen dropping at a DIFFERENT hour than its last spell is emailed', async () => {
    const { svc, email } = build(w);
    screen(w, 'lobby', 'lincoln');
    prevSpell('lobby', 'lincoln', w.clock.now - 24 * H - 5 * H, 13);
    goOffline(w, 'lobby', w.clock.now);
    w.clock.now += 15 * MIN;
    await scan(w, svc, 0);
    await scan(w, svc);
    expect(subjects(email)).toContain('VenueOS: lobby is offline at Lincoln Elementary');
  });

  it('an update installed 20 min before the screen went quiet (the relaunch killed the app) is deferred as maintenance, not an outage', async () => {
    const { svc, email } = build(w);
    screen(w, 'lobby', 'lincoln');
    const dropAt = w.clock.now;
    w.screenEvents.push({ screenId: 'lobby', createdAt: new Date(dropAt - 20 * MIN) });
    goOffline(w, 'lobby', dropAt);
    w.clock.now = dropAt + 15 * MIN;
    await scan(w, svc, 0);
    const res = await scan(w, svc);
    expect(res.deferred).toEqual({ maintenance: 1 });
    expect(email.sendCustomerAlert).not.toHaveBeenCalled();
  });

  it('control: no maintenance evidence, the same drop is emailed', async () => {
    const { svc, email } = build(w);
    screen(w, 'lobby', 'lincoln');
    goOffline(w, 'lobby', w.clock.now);
    w.clock.now += 15 * MIN;
    await scan(w, svc, 0);
    await scan(w, svc);
    expect(email.sendCustomerAlert).toHaveBeenCalled();
  });

  describe('picture proof stopped on 3+ screens of one organisation within seconds', () => {
    const blankAt = (id: string, ageMin: number, secOffset: number) =>
      screen(w, id, 'lincoln', { lastRenderedAt: new Date(w.clock.now - ageMin * MIN + secOffset * 1000) });
    const keepPinging = () => w.screens.forEach((s) => Object.assign(s, { lastPingAt: new Date(w.clock.now - 10_000) }));

    it('is silenced as one shared cause and never emailed', async () => {
      const { svc, email } = build(w);
      for (const id of ['a', 'b', 'c', 'd']) w.schedules.push({ tenantId: 'lincoln', screenId: id, screenGroupId: null });
      ['a', 'b', 'c', 'd'].forEach((id, i) => blankAt(id, 21, i * 4));
      await scan(w, svc, 0);
      keepPinging();
      const res = await scan(w, svc);
      expect(res.silenced).toBe(4);
      expect(res.deferred['shared-proof-stall']).toBe(4);
      expect(email.sendCustomerAlert).not.toHaveBeenCalled();
      expect(w.incidents.filter((i) => i.reason === 'shared-proof-stall')).toHaveLength(4);
    });

    it('control: the same three screens whose proof stopped minutes apart ARE emailed', async () => {
      const { svc, email } = build(w);
      for (const id of ['a', 'b', 'c']) w.schedules.push({ tenantId: 'lincoln', screenId: id, screenGroupId: null });
      blankAt('a', 30, 0);
      blankAt('b', 26, 0);
      blankAt('c', 22, 0);
      await scan(w, svc, 0);
      keepPinging();
      await scan(w, svc);
      expect(email.sendCustomerAlert).toHaveBeenCalled();
    });
  });
});
