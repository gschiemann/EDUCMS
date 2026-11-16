/**
 * Panic phones (2026-11-14) — the credential's whole life, through the real
 * controller and the real service, over the two-tenant Prisma double (which
 * really evaluates every `where`). The emergency controller is a recording
 * stub here: what it does with a principal is covered by its own suites
 * (emergency.targeting.spec.ts pins a delegated staffer to their own tenant);
 * what THIS file proves is which principal it is handed, and when it is
 * handed nothing at all.
 */
import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { makeTwoTenantPrisma } from '../../tenant-isolation/two-tenant-prisma';
import { CredentialBodySchema, PanicDeviceController, PanicTriggerBodySchema } from './panic-device.controller';
import { PanicDeviceService } from './panic-device.service';
import { hashPanicCredential } from './panic-device.policy';

const SECRET = 'bff-shared-secret-0123456789';
const NOW = () => Math.floor(Date.now() / 1000);
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const person = (id: string, tenantId: string, extra: Record<string, unknown> = {}) => ({
  id,
  tenantId,
  email: `${id}@school.test`,
  firstName: 'Pat',
  lastName: 'Teacher',
  role: 'CONTRIBUTOR',
  status: 'ACTIVE',
  deletedAt: null,
  canTriggerPanic: true,
  mfaRequired: false,
  mfaTotpVerifiedAt: new Date('2026-10-01T00:00:00Z'),
  ...extra,
});

function world(opts: { origIat?: number } = {}) {
  const prisma = makeTwoTenantPrisma({
    tenant: [
      { id: 't-alpha', name: 'Alpha High', slug: 'alpha', archivedAt: null, mfaEnforced: true, parentId: null },
      { id: 't-beta', name: 'Beta High', slug: 'beta', archivedAt: null, mfaEnforced: true, parentId: null },
    ],
    user: [
      person('u-teacher', 't-alpha'),
      person('u-admin', 't-alpha', { role: 'SCHOOL_ADMIN', canTriggerPanic: false }),
      person('u-viewer', 't-alpha', { role: 'RESTRICTED_VIEWER' }),
      person('u-staff', 't-alpha', { role: 'SUPER_ADMIN' }),
      person('u-nomfa', 't-alpha', { mfaTotpVerifiedAt: null }),
      person('u-beta', 't-beta'),
    ],
    passkey: [],
    panicDevice: [],
    auditLog: [],
  });
  const service = new PanicDeviceService({ client: prisma.client } as any);
  const emergency = {
    triggerEmergency: jest.fn(async (body: any) => ({ success: true, overrideId: 'ovr_1', scope: body.scopeType })),
    targets: jest.fn(async (req: any) => ({ tenantId: req.user.tenantId, groups: [], screens: [] })),
    activeAlerts: jest.fn(async () => ({ alerts: [] })),
  };
  const limiter = { allow: jest.fn(async (_key: string, _limit: number) => true) };
  const jwt = { decode: jest.fn(() => ({ origIat: opts.origIat ?? NOW() - 30 })) };
  const moduleRef = { get: jest.fn(() => emergency) };
  const controller = new PanicDeviceController(service, limiter as any, { client: prisma.client } as any, jwt as any, moduleRef as any);
  const table = (m: string) => (prisma.client as any)[m].findMany({});
  const audits = async (action?: string) =>
    ((await table('auditLog')) as any[]).filter((r) => !action || r.action === action);
  return { prisma, service, emergency, limiter, jwt, controller, table, audits };
}

function req(opts: { user?: any; headers?: Record<string, string | undefined> } = {}) {
  const headers: Record<string, string> = {
    'x-venueos-session-bff': SECRET,
    'x-venueos-panic-client-ip': '203.0.113.9',
    'user-agent': IPHONE,
    authorization: 'Bearer session.jwt',
  };
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    if (v === undefined) delete headers[k];
    else headers[k] = v;
  }
  return { headers, user: opts.user } as any;
}

const sessionOf = (id: string, tenantId = 't-alpha', extra: Record<string, unknown> = {}) => ({
  id,
  userId: id,
  tenantId,
  role: 'CONTRIBUTOR',
  ...extra,
});

async function enrolled(w: ReturnType<typeof world>, id = 'u-teacher') {
  const out = await w.controller.enroll(req({ user: sessionOf(id) }));
  return out.credential as string;
}

/** The status / code / reason an HttpException carries. */
async function failure(p: Promise<unknown>) {
  try {
    await p;
  } catch (e: any) {
    const body = typeof e?.getResponse === 'function' ? e.getResponse() : {};
    return { status: e?.getStatus?.(), code: body?.code, reason: body?.reason };
  }
  throw new Error('expected a refusal');
}

beforeEach(() => {
  process.env.SESSION_BFF_SECRET = SECRET;
  delete process.env.PANIC_DEVICE_DISABLED;
});
afterAll(() => {
  delete process.env.SESSION_BFF_SECRET;
  delete process.env.PANIC_DEVICE_DISABLED;
});

describe('enrolment — a full, recent sign-in of a person who may send an emergency', () => {
  it('mints one credential; the table holds only its sha256; an immutable row names who, which phone, from where', async () => {
    const w = world();
    const out: any = await w.controller.enroll(req({ user: sessionOf('u-teacher') }));
    expect(out.credential).toMatch(/^pd1\./);
    expect(out.device).toMatchObject({ label: 'iPhone · Safari' });

    const rows: any[] = await w.table('panicDevice');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: 'u-teacher', tenantId: 't-alpha', secretHash: hashPanicCredential(out.credential), createdIp: '203.0.113.9' });
    expect(JSON.stringify(rows)).not.toContain(out.credential);

    const [row] = await w.audits('PANIC_DEVICE_ENROLLED');
    expect(row).toMatchObject({ tenantId: 't-alpha', userId: 'u-teacher', targetType: 'panicDevice', targetId: rows[0].id });
    expect(JSON.parse(row.details)).toMatchObject({ label: 'iPhone · Safari', ip: '203.0.113.9' });
  });

  it('only through the web origin: no SESSION_BFF_SECRET, or the wrong one, is 403 and nothing is minted', async () => {
    const w = world();
    expect(await failure(w.controller.enroll(req({ user: sessionOf('u-teacher'), headers: { 'x-venueos-session-bff': undefined } })))).toMatchObject({ status: 403, code: 'PANIC_DEVICE_UNAVAILABLE' });
    expect(await failure(w.controller.enroll(req({ user: sessionOf('u-teacher'), headers: { 'x-venueos-session-bff': 'wrong-secret-0123456789' } })))).toMatchObject({ status: 403 });
    delete process.env.SESSION_BFF_SECRET;
    expect(await failure(w.controller.enroll(req({ user: sessionOf('u-teacher') })))).toMatchObject({ status: 403, code: 'PANIC_DEVICE_UNAVAILABLE' });
    expect(await w.table('panicDevice')).toHaveLength(0);
  });

  it('needs a PERSON’s session: an API key or a screen credential is refused', async () => {
    const w = world();
    expect(await failure(w.controller.enroll(req({ user: { kind: 'api-key', apiKeyId: 'k1', tenantId: 't-alpha' } })))).toMatchObject({ status: 401 });
    expect(await failure(w.controller.enroll(req({ user: { id: 's1', kind: 'device', tenantId: 't-alpha' } })))).toMatchObject({ status: 401 });
  });

  it('needs a RECENT sign-in — a session restored from a 30-day cookie must sign in again', async () => {
    const w = world({ origIat: NOW() - 20 * 60 });
    expect(await failure(w.controller.enroll(req({ user: sessionOf('u-teacher') })))).toMatchObject({ status: 403, reason: 'stale-login' });
    expect(await w.table('panicDevice')).toHaveLength(0);
  });

  it.each([
    ['a switched-workspace session', 'u-teacher', 't-beta', 'switched-workspace'],
    ['an account that owes a second factor', 'u-nomfa', 't-alpha', 'mfa-required'],
    ['a RESTRICTED_VIEWER, flag or not', 'u-viewer', 't-alpha', 'no-authority'],
    ['a SCHOOL_ADMIN (authority by role, no flag) MAY enrol', 'u-admin', 't-alpha', null],
    ['platform staff', 'u-staff', 't-alpha', 'platform-staff'],
  ])('%s', async (_label, id, sessionTenant, reason) => {
    const w = world();
    const p = w.controller.enroll(req({ user: sessionOf(id, sessionTenant) }));
    if (reason === null) {
      await expect(p).resolves.toMatchObject({ credential: expect.stringMatching(/^pd1\./) });
    } else {
      expect(await failure(p)).toMatchObject({ status: 403, code: 'PANIC_DEVICE_ENROLL_REFUSED', reason });
    }
  });

  it('kill switch: PANIC_DEVICE_DISABLED=1 refuses enrolment', async () => {
    const w = world();
    process.env.PANIC_DEVICE_DISABLED = '1';
    expect(await failure(w.controller.enroll(req({ user: sessionOf('u-teacher') })))).toMatchObject({ status: 403, code: 'PANIC_DEVICE_DISABLED' });
  });
});

describe('status — who this phone sends as', () => {
  it('answers the person and the phone, never the secret or its hash', async () => {
    const w = world();
    const credential = await enrolled(w);
    const out: any = await w.controller.status({ credential }, req());
    expect(out.user).toMatchObject({ id: 'u-teacher', tenantId: 't-alpha', tenantName: 'Alpha High', canTriggerPanic: true });
    expect(out.device.label).toBe('iPhone · Safari');
    expect(JSON.stringify(out)).not.toContain(credential);
    expect(JSON.stringify(out)).not.toContain(hashPanicCredential(credential));
  });

  it('junk is "unknown", never a 5xx', async () => {
    const w = world();
    expect(await failure(w.controller.status({ credential: 'pd1.nope' }, req()))).toMatchObject({ status: 401, reason: 'unknown' });
  });

  it('a database that cannot answer is 503 — "could not find out", the phone keeps its cookie', async () => {
    const w = world();
    const credential = await enrolled(w);
    (w.prisma.client as any).panicDevice.findUnique = async () => {
      throw new Error('pool timeout');
    };
    expect(await failure(w.controller.status({ credential }, req()))).toMatchObject({ status: 503, code: 'PANIC_DEVICE_CHECK_UNAVAILABLE' });
  });
});

describe('refused — immediately, and for good — when the account changes', () => {
  async function setUser(w: ReturnType<typeof world>, id: string, data: Record<string, unknown>) {
    await (w.prisma.client as any).user.updateMany({ where: { id }, data });
  }

  it.each([
    ['deactivated', { status: 'DISABLED' }, 'account-inactive'],
    ['removed', { deletedAt: new Date() }, 'account-inactive'],
    ['loses the permission', { canTriggerPanic: false }, 'no-authority'],
    ['changes organisation', { tenantId: 't-beta' }, 'tenant-changed'],
  ])('%s → refused, the row revoked, a revoke row written; re-enabling does not bring it back', async (_label, change, reason) => {
    const w = world();
    const credential = await enrolled(w);
    await setUser(w, 'u-teacher', change);
    expect(await failure(w.controller.status({ credential }, req()))).toMatchObject({ status: 401, code: 'PANIC_DEVICE_REFUSED', reason });

    const [row]: any[] = await w.table('panicDevice');
    expect(row.revokedAt).toBeInstanceOf(Date);
    expect(row.revokedReason).toBe(`ineligible:${reason}`);
    const [revoked] = await w.audits('PANIC_DEVICE_REVOKED');
    expect(revoked).toMatchObject({ tenantId: 't-alpha', userId: null, targetId: row.id });

    // Put the account back exactly as it was: the phone stays off.
    await setUser(w, 'u-teacher', { status: 'ACTIVE', deletedAt: null, canTriggerPanic: true, tenantId: 't-alpha' });
    expect(await failure(w.controller.status({ credential }, req()))).toMatchObject({ status: 401, reason: 'revoked' });
  });

  it('an admin revoke is refused on the very next use', async () => {
    const w = world();
    const credential = await enrolled(w);
    const [row]: any[] = await w.table('panicDevice');
    await w.service.revoke({ device: row, byUserId: 'u-admin', reason: 'admin', ip: null });
    expect(await failure(w.controller.status({ credential }, req()))).toMatchObject({ status: 401, reason: 'revoked' });
    expect(await failure(w.controller.trigger({ credential, type: 'lockdown' } as any, req()))).toMatchObject({ status: 401 });
    expect(w.emergency.triggerEmergency).not.toHaveBeenCalled();
  });
});

describe('kill switch — subtractive: refuses, never revokes', () => {
  it('set: every use is 403 PANIC_DEVICE_DISABLED and the row is untouched; unset: the phone works again', async () => {
    const w = world();
    const credential = await enrolled(w);
    process.env.PANIC_DEVICE_DISABLED = 'true';
    expect(await failure(w.controller.status({ credential }, req()))).toMatchObject({ status: 403, code: 'PANIC_DEVICE_DISABLED' });
    expect(await failure(w.controller.trigger({ credential, type: 'lockdown' } as any, req()))).toMatchObject({ status: 403, code: 'PANIC_DEVICE_DISABLED' });
    expect(w.emergency.triggerEmergency).not.toHaveBeenCalled();
    const [row]: any[] = await w.table('panicDevice');
    expect(row.revokedAt ?? null).toBeNull();

    delete process.env.PANIC_DEVICE_DISABLED;
    await expect(w.controller.status({ credential }, req())).resolves.toMatchObject({ user: { id: 'u-teacher' } });
  });

  it('turning a phone off still works while the switch is set', async () => {
    const w = world();
    const credential = await enrolled(w);
    process.env.PANIC_DEVICE_DISABLED = '1';
    await expect(w.controller.revoke({ credential }, req())).resolves.toEqual({ revoked: true });
  });
});

describe('trigger — what the emergency controller is handed', () => {
  it('All screens = the phone’s own organisation, as the person, marked as this phone; one USED row', async () => {
    const w = world();
    const credential = await enrolled(w);
    const out: any = await w.controller.trigger({ credential, type: 'lockdown' } as any, req());
    expect(out).toMatchObject({ success: true, overrideId: 'ovr_1' });
    expect(w.emergency.triggerEmergency).toHaveBeenCalledTimes(1);
    const [body, inner] = w.emergency.triggerEmergency.mock.calls[0] as any[];
    expect(body).toEqual({ scopeType: 'tenant', scopeId: 't-alpha', overridePayload: { severity: 'CRITICAL', type: 'lockdown' } });
    const [row]: any[] = await w.table('panicDevice');
    expect(inner.user).toMatchObject({
      id: 'u-teacher',
      tenantId: 't-alpha',
      role: 'CONTRIBUTOR',
      canTriggerPanic: true,
      kind: 'panic-device',
      panicDeviceId: row.id,
      panicDeviceIp: '203.0.113.9',
    });
    const [used] = await w.audits('PANIC_DEVICE_USED');
    expect(used).toMatchObject({ tenantId: 't-alpha', userId: 'u-teacher', targetId: row.id });
    expect(JSON.parse(used.details)).toMatchObject({ outcome: 'sent', overrideId: 'ovr_1', type: 'lockdown', isDrill: false, ip: '203.0.113.9' });
  });

  it('a DRILL and one group pass through exactly; the drill flag is the only extra key', async () => {
    const w = world();
    const credential = await enrolled(w);
    await w.controller.trigger({ credential, type: 'weather', isDrill: true, target: { scopeType: 'group', scopeId: 'g-1' } } as any, req());
    expect(w.emergency.triggerEmergency.mock.calls[0][0]).toEqual({
      scopeType: 'group',
      scopeId: 'g-1',
      overridePayload: { severity: 'CRITICAL', type: 'weather', isDrill: true },
    });
  });

  it('the body cannot carry a playlist, a media URL, a text, an expiry or an all-clear id — only type, drill, target', () => {
    const credential = 'pd1.' + 'a'.repeat(43);
    expect(PanicTriggerBodySchema.safeParse({ credential, type: 'lockdown' }).success).toBe(true);
    for (const extra of [{ playlistId: 'p' }, { mediaUrl: 'https://x.test/a.png' }, { textBlob: 'x' }, { expiresAt: 1 }, { overrideId: 'ovr' }, { scopeId: 't-beta' }]) {
      expect(PanicTriggerBodySchema.safeParse({ credential, type: 'lockdown', ...extra }).success).toBe(false);
    }
    expect(PanicTriggerBodySchema.safeParse({ credential, type: 'lockdown', isDrill: false }).success).toBe(false);
    expect(PanicTriggerBodySchema.safeParse({ credential, type: 'all-clear' }).success).toBe(false);
    expect(CredentialBodySchema.safeParse({ credential, extra: 1 }).success).toBe(false);
  });

  it('a refusal from the trigger itself (e.g. a target in another organisation) is passed on, and the phone’s row says NOT sent', async () => {
    const w = world();
    const credential = await enrolled(w);
    w.emergency.triggerEmergency.mockRejectedValueOnce(new ForbiddenException('You do not have permission to trigger emergency actions for this scope.'));
    expect(await failure(w.controller.trigger({ credential, type: 'lockdown', target: { scopeType: 'group', scopeId: 'g-beta' } } as any, req()))).toMatchObject({ status: 403 });
    const [used] = await w.audits('PANIC_DEVICE_USED');
    expect(JSON.parse(used.details)).toMatchObject({ outcome: 'not-sent', status: 403 });
  });

  it('a revoked phone pressing the button: nothing is sent, and a REFUSED row records the attempt', async () => {
    const w = world();
    const credential = await enrolled(w);
    await w.controller.revoke({ credential }, req());
    expect(await failure(w.controller.trigger({ credential, type: 'lockdown' } as any, req()))).toMatchObject({ status: 401, reason: 'revoked' });
    expect(w.emergency.triggerEmergency).not.toHaveBeenCalled();
    const [refused] = await w.audits('PANIC_DEVICE_REFUSED');
    expect(JSON.parse(refused.details)).toMatchObject({ reason: 'revoked', ip: '203.0.113.9' });
  });

  it('the reads go through with the same confined principal', async () => {
    const w = world();
    const credential = await enrolled(w);
    await expect(w.controller.targets({ credential }, req())).resolves.toMatchObject({ tenantId: 't-alpha' });
    await w.controller.active({ credential }, req());
    expect((w.emergency.activeAlerts.mock.calls[0] as any[])[0].user).toMatchObject({ tenantId: 't-alpha', kind: 'panic-device' });
  });
});

describe('turning a phone off from the phone', () => {
  it('revokes it, writes the row (by the person, reason self), and is idempotent', async () => {
    const w = world();
    const credential = await enrolled(w);
    await expect(w.controller.revoke({ credential }, req())).resolves.toEqual({ revoked: true });
    await expect(w.controller.revoke({ credential }, req())).resolves.toEqual({ revoked: false });
    const rows = await w.audits('PANIC_DEVICE_REVOKED');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: 'u-teacher' });
    expect(JSON.parse(rows[0].details)).toMatchObject({ reason: 'self' });
  });
});

describe('rate limits — keyed on the phone and on its REAL address, never on the API-observed one', () => {
  it('uses the forwarded address before the lookup and the device after', async () => {
    const w = world();
    const credential = await enrolled(w);
    w.limiter.allow.mockClear();
    await w.controller.status({ credential }, req());
    const [row]: any[] = await w.table('panicDevice');
    expect(w.limiter.allow.mock.calls.map((c) => c[0])).toEqual(['status:ip:203.0.113.9', `status:dev:${row.id}`]);
  });

  it('with no forwarded address there is NO address key — never a fallback that would collapse every school onto one bucket', async () => {
    const w = world();
    const credential = await enrolled(w);
    w.limiter.allow.mockClear();
    await w.controller.status({ credential }, req({ headers: { 'x-venueos-panic-client-ip': undefined } }));
    expect(w.limiter.allow.mock.calls.map((c) => c[0]).some((k) => k.includes(':ip:'))).toBe(false);
  });

  it('a junk forwarded value is ignored, not used as a key', async () => {
    const w = world();
    const credential = await enrolled(w);
    w.limiter.allow.mockClear();
    await w.controller.status({ credential }, req({ headers: { 'x-venueos-panic-client-ip': '<script>' } }));
    expect(w.limiter.allow.mock.calls.map((c) => c[0]).some((k) => k.includes(':ip:'))).toBe(false);
  });

  it('over the limit: 429 — and the trigger is never reached', async () => {
    const w = world();
    const credential = await enrolled(w);
    w.limiter.allow.mockResolvedValue(false);
    expect(await failure(w.controller.trigger({ credential, type: 'lockdown' } as any, req()))).toMatchObject({ status: 429, code: 'PANIC_DEVICE_RATE_LIMITED' });
    expect(w.emergency.triggerEmergency).not.toHaveBeenCalled();
  });
});
