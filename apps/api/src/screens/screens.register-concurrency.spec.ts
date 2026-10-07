import * as jwt from 'jsonwebtoken';
import { ScreensController, _registerFpCooldown } from './screens.controller';
import { revokeScreenCredentials } from './device-credentials';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

const SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';
const SCREEN = 'concurrent-screen';
const FP = 'concurrent-fingerprint';
const tokenAt = (ep: number, extra: Record<string, unknown> = {}) =>
  jwt.sign({ sub: SCREEN, kind: 'device', ep, ...extra }, SECRET, { expiresIn: '180d' });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

/**
 * Models READ COMMITTED row locks, not a global transaction mutex: only the
 * SELECT FOR UPDATE acquires the transaction's lock. Without that statement,
 * wrapping the handler in a transaction alone still fails these tests.
 * Initial fingerprint reads are barriered so every caller observes the SAME
 * old row. No sleeps or scheduler-dependent races.
 */
function setup(readers = 1, overrides: Record<string, unknown> = {}) {
  const state: any = {
    id: SCREEN, deviceFingerprint: FP, tenantId: 'tenant-concurrent',
    pairingCode: null, name: 'Concurrent screen', status: 'ONLINE',
    authState: 'PROVEN', credentialEpoch: 5,
    credentialEpochRotatedAt: new Date(Date.now() - 120_000),
    credentialRevokedAt: null, resolution: null, osInfo: null,
    browserInfo: null, userAgent: null, ...overrides,
  };
  const audit: any[] = [];
  let tail = Promise.resolve();
  const acquire = async () => {
    const previous = tail;
    const release = deferred();
    tail = release.promise;
    await previous;
    return release.resolve;
  };
  const allRead = deferred();
  let reads = 0;
  let afterSnapshot: (() => Promise<void>) | undefined;
  let rotationError: Error | undefined;
  const update = async ({ data }: any) => {
    const { credentialEpoch, ...rest } = data;
    if (credentialEpoch?.increment && rotationError) throw rotationError;
    Object.assign(state, rest);
    if (credentialEpoch?.increment) state.credentialEpoch += credentialEpoch.increment;
    return { ...state };
  };
  const auditLog = { create: jest.fn(async ({ data }: any) => { audit.push(data); return data; }) };
  const screenEvent = { create: jest.fn(async () => ({})) };
  const client: any = {
    screen: {
      findUnique: jest.fn(async () => {
        const snapshot = { ...state };
        reads += 1;
        if (reads === readers) allRead.resolve();
        await allRead.promise;
        await afterSnapshot?.();
        return snapshot;
      }),
      update: jest.fn(async (args: any) => {
        const release = await acquire();
        try { return await update(args); } finally { release(); }
      }),
    },
    auditLog,
    screenEvent,
    $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) => {
      let release: (() => void) | undefined;
      let before: any;
      let auditCount = 0;
      const tx = {
        $queryRaw: jest.fn(async (sql: TemplateStringsArray, id: string, tenantId: string) => {
          if (!sql.join('').includes('FOR UPDATE')) throw new Error('Expected row lock');
          release = await acquire();
          before = { ...state };
          auditCount = audit.length;
          return state.id === id && state.tenantId === tenantId ? [{ id: state.id }] : [];
        }),
        screen: { findUnique: jest.fn(async () => ({ ...state })), update: jest.fn(update) },
        auditLog,
        screenEvent,
      };
      try {
        return await fn(tx);
      } catch (error) {
        if (before) {
          for (const key of Object.keys(state)) delete state[key];
          Object.assign(state, before);
          audit.splice(auditCount);
        }
        throw error;
      } finally { release?.(); }
    }),
  };
  const prisma = { client };
  const controller = new ScreensController(prisma as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  const register = (token: string) => controller.register(
    { deviceFingerprint: FP, priorDeviceToken: token },
    { headers: {}, socket: { remoteAddress: '127.0.0.1' } } as any,
  );
  return {
    state, audit, prisma, register,
    afterSnapshot: (fn: () => Promise<void>) => { afterSnapshot = fn; },
    failRotation: () => { rotationError = new Error('rotation write failed'); },
  };
}

beforeEach(() => { _registerFpCooldown.clear(); });

it('overlapping renewals rotate once and every response carries the same acceptable epoch', async () => {
  const t = setup(3);
  const responses = await Promise.all([t.register(tokenAt(5)), t.register(tokenAt(5)), t.register(tokenAt(5))]);
  expect(t.state.credentialEpoch).toBe(6);
  expect(responses.map((r) => (jwt.decode(r.deviceToken!) as any).ep)).toEqual([6, 6, 6]);
  expect(responses.every((r) => !r.requiresRePair)).toBe(true);
  const decisions = t.audit.map((a) => JSON.parse(a.details));
  expect(decisions.map((a) => a.priorTokenStatus).sort()).toEqual(['valid', 'valid-grace', 'valid-grace']);
  expect(decisions.map((a) => a.observedCredentialEpoch)).toEqual([5, 6, 6]);
  expect(decisions.every((a) => a.presentedCredentialEpoch === 5 && a.presentedCredentialUnproven === false)).toBe(true);
});

it('a revoke committed after lookup cannot be overwritten by a pending renewal', async () => {
  const t = setup();
  t.afterSnapshot(async () => {
    await revokeScreenCredentials({ prisma: t.prisma }, {
      screenId: SCREEN, tenantId: t.state.tenantId, reason: 'admin_revoke', markRevokedStatus: true,
    });
  });
  await expect(t.register(tokenAt(5))).rejects.toMatchObject({
    response: expect.objectContaining({ code: 'SCREEN_CREDENTIAL_REVOKED' }),
  });
  expect(t.state.status).toBe('REVOKED');
  expect(t.state.credentialEpoch).toBe(6);
  expect(t.audit.some((a) => a.action === 'SCREEN_TOKEN_RENEWED')).toBe(false);
});

it('concurrent uses of an operator restoration consume its pre-pair token only once', async () => {
  const t = setup(2, { credentialEpochRotatedAt: new Date() });
  const token = tokenAt(4, { unproven: true, aud: 'venueos:device-bootstrap' });
  const responses = await Promise.all([t.register(token), t.register(token)]);
  expect(t.state.credentialEpoch).toBe(6);
  expect(responses.filter((r) => !r.requiresRePair)).toHaveLength(1);
  expect(responses.filter((r) => r.requiresRePair)).toHaveLength(1);
  expect(t.audit.map((a) => JSON.parse(a.details).presentedCredentialUnproven)).toEqual([true, true]);
});

it('a tenant reassignment after lookup cannot mint a credential from the old tenant snapshot', async () => {
  const t = setup();
  t.afterSnapshot(async () => {
    await t.prisma.client.screen.update({ where: { id: SCREEN }, data: { tenantId: 'other-tenant', credentialEpoch: { increment: 1 } } });
  });
  await expect(t.register(tokenAt(5))).rejects.toMatchObject({
    response: expect.objectContaining({ code: 'SCREEN_REGISTRATION_CHANGED' }),
  });
  expect(t.audit.some((a) => a.action === 'SCREEN_TOKEN_RENEWED')).toBe(false);
});

it('does not mint from the old snapshot when rotation fails; the trust write rolls back', async () => {
  const t = setup(1, { authState: 'REPAIR_REQUIRED' });
  t.failRotation();
  await expect(t.register(tokenAt(5))).rejects.toThrow('rotation write failed');
  expect(t.state.credentialEpoch).toBe(5);
  expect(t.state.authState).toBe('REPAIR_REQUIRED');
  expect(t.audit).toHaveLength(0);
});

it('does not issue an unaudited credential when the immutable audit write fails', async () => {
  const t = setup();
  t.prisma.client.auditLog.create.mockRejectedValueOnce(new Error('audit write failed'));
  await expect(t.register(tokenAt(5))).rejects.toThrow('audit write failed');
  expect(t.state.credentialEpoch).toBe(5);
  expect(t.audit).toHaveLength(0);
});

it('keeps timeline insertion best-effort after the credential and immutable audit commit', async () => {
  const t = setup(1, { authState: 'REPAIR_REQUIRED' });
  t.prisma.client.screenEvent.create.mockRejectedValueOnce(new Error('timeline write failed'));
  const response = await t.register(tokenAt(5));
  expect(response.requiresRePair).toBeUndefined();
  expect(t.state.credentialEpoch).toBe(6);
  expect(t.audit.map((a) => a.action)).toEqual(['SCREEN_TOKEN_RENEWED']);
});

it('does not report decoded-but-unverified expired claims as verified audit evidence', async () => {
  const t = setup();
  const expired = jwt.sign({ sub: SCREEN, kind: 'device', ep: 5 }, SECRET, { expiresIn: -1 });
  const res = await t.register(expired);
  expect(res.requiresRePair).toBe(true);
  expect(JSON.parse(t.audit[0].details)).toMatchObject({
    priorTokenStatus: 'expired', presentedCredentialEpoch: null,
    presentedCredentialUnproven: null, observedCredentialEpoch: 5,
  });
  expect(t.audit[0].details).not.toContain(expired);
});
