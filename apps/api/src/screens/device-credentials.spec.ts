/**
 * Regression tests for the device-credential revocation WRITER (DT-01).
 *
 * The finding: `Screen.status='REVOKED'` was read in eight places and
 * written in ZERO, `jwt_revoked_list` had no device writer and a 30-day
 * Redis TTL against a year-long token, and deleting the Screen row (losing
 * its schedules and history) was the only kill switch that worked.
 */

import { revokeScreenCredentials, rotateScreenCredentialEpoch } from './device-credentials';
import { invalidateDeviceCredentialCache, verifyDeviceForScreen } from './device-auth';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_n: string, o?: { devFallback?: string }) => o?.devFallback ?? 'test_secret',
}));

function makeDeps(updated: any = { id: 's1', credentialEpoch: 1 }) {
  return {
    prisma: {
      client: {
        screen: { update: jest.fn().mockResolvedValue(updated) },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      },
    } as any,
    redis: {
      sadd: jest.fn().mockResolvedValue(1),
      mirrorRevokedTokenDurable: jest.fn().mockResolvedValue(undefined),
    },
  };
}

beforeEach(() => invalidateDeviceCredentialCache());

describe('revokeScreenCredentials', () => {
  it('bumps the credential epoch — retiring EVERY token ever minted for the screen', async () => {
    // The whole point of keying revocation on the screen rather than on a
    // token string: an operator revoking a dumpstered screen is not holding
    // its token, and a self-renewing credential mints a new string every
    // cycle. A denylist can reach neither.
    const deps = makeDeps();
    const res = await revokeScreenCredentials(deps, { screenId: 's1', reason: 'admin_revoke' });
    const call = deps.prisma.client.screen.update.mock.calls[0][0];
    expect(call.data.credentialEpoch).toEqual({ increment: 1 });
    expect(call.data.credentialEpochRotatedAt).toBeInstanceOf(Date);
    expect(res.credentialEpoch).toBe(1);
  });

  it('writes status=REVOKED for an operator revoke — the state nothing ever wrote', async () => {
    const deps = makeDeps();
    await revokeScreenCredentials(deps, {
      screenId: 's1',
      reason: 'admin_revoke',
      markRevokedStatus: true,
    });
    const call = deps.prisma.client.screen.update.mock.calls[0][0];
    expect(call.data.status).toBe('REVOKED');
    expect(call.data.credentialRevokedAt).toBeInstanceOf(Date);
  });

  it('does NOT write REVOKED for an unpair — the screen is meant to come back', async () => {
    const deps = makeDeps();
    await revokeScreenCredentials(deps, { screenId: 's1', reason: 'device_unpair' });
    const call = deps.prisma.client.screen.update.mock.calls[0][0];
    expect(call.data.status).toBeUndefined();
    // …but the credential is retired all the same.
    expect(call.data.credentialEpoch).toEqual({ increment: 1 });
  });

  it('mirrors a presented token into the DURABLE store (expiry from the JWT `exp`, not 30 days)', async () => {
    const deps = makeDeps();
    await revokeScreenCredentials(deps, {
      screenId: 's1',
      reason: 'device_unpair',
      presentedToken: 'the.raw.token',
    });
    expect(deps.redis.mirrorRevokedTokenDurable).toHaveBeenCalledWith('the.raw.token');
  });

  it('writes an immutable AuditLog row for every revocation', async () => {
    const deps = makeDeps();
    await revokeScreenCredentials(deps, {
      screenId: 's1',
      reason: 'admin_revoke',
      markRevokedStatus: true,
      tenantId: 't1',
      userId: 'u1',
    });
    const row = deps.prisma.client.auditLog.create.mock.calls[0][0].data;
    expect(row.action).toBe('SCREEN_CREDENTIAL_REVOKED');
    expect(row.tenantId).toBe('t1');
    expect(row.userId).toBe('u1');
    expect(JSON.parse(row.details).reason).toBe('admin_revoke');
  });

  it('never lets a best-effort leg fail the revocation', async () => {
    // The epoch bump is the only write allowed to fail the caller. A Redis
    // blip or an audit-table hiccup must not leave a compromised screen
    // holding a live credential because the bookkeeping errored.
    const deps = makeDeps();
    deps.redis.mirrorRevokedTokenDurable.mockRejectedValue(new Error('redis down'));
    deps.prisma.client.auditLog.create.mockRejectedValue(new Error('audit down'));
    await expect(
      revokeScreenCredentials(deps, {
        screenId: 's1',
        reason: 'admin_revoke',
        presentedToken: 'tok',
      }),
    ).resolves.toMatchObject({ credentialEpoch: 1 });
  });

  it('a revoked credential is refused by the verifier on the next request', async () => {
    // End-to-end of the DT-01 loop: write → read.
    const row = {
      id: 's1',
      tenantId: 't1',
      screenGroupId: null,
      status: 'REVOKED',
      credentialEpoch: 1,
      credentialEpochRotatedAt: new Date(),
    };
    const prisma = { client: { screen: { findUnique: jest.fn().mockResolvedValue(row) } } } as any;
    const jwt = require('jsonwebtoken');
    const tok = jwt.sign(
      { sub: 's1', kind: 'device', ep: 0 },
      'dev_only_device_jwt_secret_CHANGE_ME',
      { expiresIn: '180d' },
    );
    const res = await verifyDeviceForScreen(
      { prisma },
      { headers: { authorization: `Bearer ${tok}` } } as any,
      's1',
    );
    expect(res).toMatchObject({ ok: false, reason: 'screen_revoked' });
  });
});

describe('rotateScreenCredentialEpoch (DT-02)', () => {
  it('advances the epoch without the REVOKED semantics or an audit row', async () => {
    const deps = makeDeps({ credentialEpoch: 9 });
    const next = await rotateScreenCredentialEpoch(deps, 's1');
    expect(next).toBe(9);
    const call = deps.prisma.client.screen.update.mock.calls[0][0];
    expect(call.data.credentialEpoch).toEqual({ increment: 1 });
    expect(call.data.status).toBeUndefined();
    expect(deps.prisma.client.auditLog.create).not.toHaveBeenCalled();
  });
});
