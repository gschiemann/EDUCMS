/**
 * CustomerAlertEmailsService end to end against an in-memory world
 * (2026-10-23): recipients, grouping, confirmation, recovery, dedupe across a
 * restart, rate limit + digest, flap, shadow mode, kill switch, and every
 * platform-level stand-down (restart, degraded, platform incident).
 */
import { CustomerAlertEmailsService } from './customer-alert-emails.service';
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
    auditLog: { findMany: jest.fn(async ({ where }: any) => auditLogs.filter((a) => where.targetId.in.includes(a.targetId))) },
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
    .map((s) => ({ id: s.id, name: s.name, tenantId: s.tenantId, lastPingAt: s.lastPingAt }));
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

  it('remote power-off: deferred, never emailed while it stands', async () => {
    const { svc, email } = build(w);
    w.auditLogs.push({ targetId: 'lobby', action: 'SCREEN_DISPLAY_CONTROL', details: JSON.stringify({ requested: 'POWER_OFF' }), createdAt: new Date(w.clock.now) });
    const res = await dropAndScan(svc);
    expect(res.deferred).toEqual({ 'remote-power-off': 1 });
    expect(email.sendCustomerAlert).not.toHaveBeenCalled();
  });

  it('on/off schedule OFF window: deferred', async () => {
    const { svc, email } = build(w);
    w.displaySchedules.push({ id: 'ds', screenId: null, screenGroupId: null, daysOfWeek: [1, 2, 3, 4, 5], onTime: '07:00', offTime: '09:00', timezone: 'America/Chicago', isActive: true });
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
