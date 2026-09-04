/**
 * The re-pair signal (2026-09-04).
 *
 * Production symptom this closes: after the device signing key was rotated,
 * 17 screens kept pinging, 0 wrote render proofs, and 0 were marked
 * `REPAIR_REQUIRED` — because both unproven refusals (SEC-001) return before
 * any code that could stamp `Screen.authState`. The fleet UI therefore graded
 * a CREDENTIAL problem as a RENDER fault.
 *
 * What is pinned here:
 *   • the stamp happens at the refusal, through BOTH refusal paths;
 *   • it is ONE state transition — never a row write per refused request
 *     (suppression window + conditional UPDATE);
 *   • it never contradicts a fresh operator re-pair;
 *   • it is best-effort: a failing write never changes the 401.
 */
import { UnauthorizedException } from '@nestjs/common';
import {
  stampRepairRequired,
  resetRepairRequiredStampForTests,
  SCREEN_AUTH_STATE_REPAIR_REQUIRED,
  STAMP_ATTEMPT_DEDUPE_MS,
  RECENT_TRUST_CHANGE_GRACE_MS,
  type RepairStampPrisma,
} from './repair-required-stamp';
import { DeviceIdentityInterceptor } from './device-identity.interceptor';
import { verifyDeviceForScreen } from '../screens/device-auth';
import * as jwt from 'jsonwebtoken';
import { of, lastValueFrom } from 'rxjs';

const DEVICE_SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';

beforeEach(() => resetRepairRequiredStampForTests());
afterEach(() => {
  resetRepairRequiredStampForTests();
  jest.restoreAllMocks();
});

function makePrisma(opts: { count?: number; throws?: boolean } = {}) {
  const updateMany = jest.fn(async () => {
    if (opts.throws) throw new Error('postgres down');
    return { count: opts.count ?? 1 };
  });
  const create = jest.fn(async () => ({ id: 'ev-1' }));
  const prisma: RepairStampPrisma & {
    updateMany: typeof updateMany;
    create: typeof create;
  } = {
    client: { screen: { updateMany }, screenEvent: { create } },
    updateMany,
    create,
  };
  return prisma;
}

// ─────────────────────────────────────────────────────────────────────────
describe('stampRepairRequired', () => {
  it('flips the verdict and records the credential-timeline row', async () => {
    const prisma = makePrisma({ count: 1 });
    await expect(
      stampRepairRequired(prisma, 'screen-1', { trigger: 't', tenantId: 'tenant-1' }),
    ).resolves.toBe('stamped');

    expect(prisma.updateMany).toHaveBeenCalledTimes(1);
    const args = prisma.updateMany.mock.calls[0][0];
    expect(args.data.authState).toBe(SCREEN_AUTH_STATE_REPAIR_REQUIRED);
    expect(args.data.authStateChangedAt).toBeInstanceOf(Date);
    expect(prisma.create).toHaveBeenCalledTimes(1);
    expect(prisma.create.mock.calls[0][0].data).toMatchObject({
      screenId: 'screen-1',
      tenantId: 'tenant-1',
      kind: 'repair-required',
    });
  });

  it('writes only the columns the manifest hot cache treats as telemetry', async () => {
    // Guard against the 25 GB/mo egress regression: any column outside
    // SCREEN_TELEMETRY_ONLY_FIELDS would bust every cached manifest.
    const prisma = makePrisma({ count: 1 });
    await stampRepairRequired(prisma, 'screen-1', { trigger: 't' });
    expect(Object.keys(prisma.updateMany.mock.calls[0][0].data).sort()).toEqual([
      'authState',
      'authStateChangedAt',
    ]);
  });

  it('is ONE statement per screen per suppression window, not one per request', async () => {
    const prisma = makePrisma({ count: 1 });
    const t0 = 1_000_000;
    for (let i = 0; i < 25; i++) {
      await stampRepairRequired(prisma, 'screen-1', { trigger: 't', now: t0 + i * 1_000 });
    }
    expect(prisma.updateMany).toHaveBeenCalledTimes(1);

    // Past the window, exactly one more.
    await stampRepairRequired(prisma, 'screen-1', {
      trigger: 't',
      now: t0 + STAMP_ATTEMPT_DEDUPE_MS + 1,
    });
    expect(prisma.updateMany).toHaveBeenCalledTimes(2);
  });

  it('suppresses per SCREEN, so one noisy screen never mutes another', async () => {
    const prisma = makePrisma({ count: 1 });
    await stampRepairRequired(prisma, 'screen-1', { trigger: 't' });
    await stampRepairRequired(prisma, 'screen-2', { trigger: 't' });
    expect(prisma.updateMany).toHaveBeenCalledTimes(2);
  });

  it('an already-REPAIR_REQUIRED screen costs count:0 and reports unchanged', async () => {
    const prisma = makePrisma({ count: 0 });
    await expect(stampRepairRequired(prisma, 'screen-1', { trigger: 't' })).resolves.toBe(
      'unchanged',
    );
    expect(prisma.create).not.toHaveBeenCalled();
  });

  it('the UPDATE refuses to contradict a trust verdict written recently', async () => {
    const prisma = makePrisma({ count: 1 });
    const now = 5_000_000;
    await stampRepairRequired(prisma, 'screen-1', { trigger: 't', now });
    const where = prisma.updateMany.mock.calls[0][0].where as {
      AND: Array<{ OR: Array<{ authStateChangedAt: { lt: Date } | null }> }>;
    };
    const cutoff = where.AND[0].OR.find(
      (c): c is { authStateChangedAt: { lt: Date } } =>
        !!c.authStateChangedAt && 'lt' in c.authStateChangedAt,
    );
    expect(cutoff?.authStateChangedAt.lt.getTime()).toBe(now - RECENT_TRUST_CHANGE_GRACE_MS);
  });

  it('matches NULL authState rows explicitly (the whole pre-column fleet)', async () => {
    const prisma = makePrisma({ count: 1 });
    await stampRepairRequired(prisma, 'screen-1', { trigger: 't' });
    const where = prisma.updateMany.mock.calls[0][0].where as {
      OR: Array<Record<string, unknown>>;
    };
    expect(where.OR).toContainEqual({ authState: null });
  });

  it('never throws when the write fails — the caller still 401s', async () => {
    const prisma = makePrisma({ throws: true });
    await expect(stampRepairRequired(prisma, 'screen-1', { trigger: 't' })).resolves.toBe(
      'failed',
    );
  });

  it('is a no-op without a screen id or without a Prisma surface', async () => {
    await expect(stampRepairRequired(makePrisma(), '', { trigger: 't' })).resolves.toBe(
      'unavailable',
    );
    await expect(
      stampRepairRequired({ client: { screen: {} } }, 'screen-1', { trigger: 't' }),
    ).resolves.toBe('unavailable');
  });

  it('skips the timeline row when the tenant is unknown (ScreenEvent needs one)', async () => {
    const prisma = makePrisma({ count: 1 });
    await expect(stampRepairRequired(prisma, 'screen-1', { trigger: 't' })).resolves.toBe(
      'stamped',
    );
    expect(prisma.create).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('verifyDeviceForScreen — the unproven refusal records the verdict', () => {
  function req(token: string) {
    return {
      headers: { authorization: `Bearer ${token}` },
      params: { id: 'screen-1' },
    } as never;
  }

  function prismaWithScreen(updateMany: jest.Mock) {
    return {
      client: {
        screen: {
          findUnique: jest.fn(async () => ({
            id: 'screen-1',
            tenantId: 'tenant-1',
            screenGroupId: null,
            status: 'ONLINE',
            credentialEpoch: 0,
            credentialEpochRotatedAt: null,
          })),
          updateMany,
        },
      },
    };
  }

  it('a bootstrap credential is refused AND the screen is marked REPAIR_REQUIRED', async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const token = jwt.sign(
      { sub: 'screen-1', kind: 'device', tenantId: 'tenant-1', unproven: true },
      DEVICE_SECRET,
      { expiresIn: '1h' },
    );

    const res = await verifyDeviceForScreen(
      { prisma: prismaWithScreen(updateMany) as never },
      req(token),
      'screen-1',
    );

    expect(res.ok).toBe(false);
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('a PROVEN credential is accepted and stamps nothing', async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const token = jwt.sign(
      { sub: 'screen-1', kind: 'device', tenantId: 'tenant-1' },
      DEVICE_SECRET,
      { expiresIn: '1h' },
    );

    const res = await verifyDeviceForScreen(
      { prisma: prismaWithScreen(updateMany) as never },
      req(token),
      'screen-1',
    );

    expect(res.ok).toBe(true);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('DeviceIdentityInterceptor — the unproven WRITE refusal records it too', () => {
  function makeInterceptor(updateMany: jest.Mock, create: jest.Mock) {
    const prisma = {
      client: {
        screen: {
          findUnique: jest.fn(async () => ({
            id: 'screen-1',
            tenantId: 'tenant-1',
            screenGroupId: null,
            status: 'ONLINE',
            credentialEpoch: 0,
            credentialEpochRotatedAt: null,
          })),
          updateMany,
        },
        screenEvent: { create },
      },
    };
    return new DeviceIdentityInterceptor(prisma as never);
  }

  function ctx(method: string, token: string) {
    const request = {
      method,
      headers: { authorization: `Bearer ${token}` },
      user: { kind: 'device', sub: 'screen-1' },
    };
    return {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request }),
    } as never;
  }

  const next = { handle: () => of('handler-ran') } as never;

  const unprovenToken = jwt.sign(
    { sub: 'screen-1', kind: 'device', tenantId: 'tenant-1', unproven: true },
    DEVICE_SECRET,
    { expiresIn: '1h' },
  );

  it('refuses the write and stamps REPAIR_REQUIRED with the live tenant', async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const create = jest.fn(async () => ({ id: 'ev' }));
    const interceptor = makeInterceptor(updateMany, create);

    await expect(
      lastValueFrom(interceptor.intercept(ctx('POST', unprovenToken), next)),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data.tenantId).toBe('tenant-1');
  });

  it('an unproven READ is still served and stamps nothing here (the manifest backstop)', async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const create = jest.fn(async () => ({ id: 'ev' }));
    const interceptor = makeInterceptor(updateMany, create);

    await expect(
      lastValueFrom(interceptor.intercept(ctx('GET', unprovenToken), next)),
    ).resolves.toBe('handler-ran');

    expect(updateMany).not.toHaveBeenCalled();
  });
});
