/**
 * AuthController — login-attempt audit trail (P0-4, 2026-05-28).
 *
 * Before this, `POST /auth/login` wrote NO AuditLog row on success OR
 * failure — only logout was audited. Failed-login forensics (credential
 * stuffing: when, from which IP, against which account) existed only as
 * the throttler counter + stdout, neither of which survives a restart or
 * is queryable per-account. These tests pin the new behavior.
 */
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { SYSTEM_TENANT_ID } from '../security/system-tenant';

function makeReq(overrides: Partial<any> = {}): any {
  return {
    ip: '203.0.113.9',
    headers: { 'user-agent': 'jest-agent/1.0', ...(overrides.headers ?? {}) },
    ...overrides,
  };
}

function setup(opts: {
  validUser?: any;
  tenantIdForEmail?: string | null;
  loginResult?: any;
} = {}) {
  const auditCreate = jest.fn().mockResolvedValue({});
  const tenantUpsert = jest.fn().mockResolvedValue({});
  const authService = {
    validateUser: jest.fn().mockResolvedValue(opts.validUser ?? null),
    tenantIdForEmail: jest.fn().mockResolvedValue(opts.tenantIdForEmail ?? null),
    login: jest.fn().mockResolvedValue(opts.loginResult ?? { access_token: 't', user: {} }),
  };
  const redisService = { publisher: null };
  const prisma = {
    client: { auditLog: { create: auditCreate }, tenant: { upsert: tenantUpsert } },
  };
  const controller = new AuthController(
    authService as any,
    redisService as any,
    prisma as any,
  );
  return { controller, authService, auditCreate, tenantUpsert };
}

describe('AuthController — login audit (P0-4)', () => {
  it('writes an AUTH_LOGIN_FAILED row (attributed to the real account tenant) on bad password', async () => {
    // Email maps to a real user → we know the tenant → row must persist.
    const { controller, auditCreate } = setup({ validUser: null, tenantIdForEmail: 'tenant-7' });

    await expect(
      controller.login({ email: 'victim@school.edu', password: 'wrong' } as any, makeReq()),
    ).rejects.toThrow(UnauthorizedException);

    expect(auditCreate).toHaveBeenCalledTimes(1);
    const arg = auditCreate.mock.calls[0][0];
    expect(arg.data.action).toBe('AUTH_LOGIN_FAILED');
    expect(arg.data.tenantId).toBe('tenant-7');
    // Actor is unknown (failed login) — identified via emailHash, not userId.
    expect(arg.data.userId).toBeNull();
    expect(arg.data.targetType).toBe('User');
    const details = JSON.parse(arg.data.details);
    expect(details.ip).toBe('203.0.113.9');
    expect(details.ua).toBe('jest-agent/1.0');
    // PII is hashed, never stored in cleartext.
    expect(details.emailHash).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(arg.data)).not.toContain('victim@school.edu');
  });

  it('writes an AUTH_LOGIN_FAILED row attributed to the SYSTEM sentinel tenant for an unknown account', async () => {
    // Email maps to no user → no natural tenant. §16 fix: instead of
    // dropping the row (recon invisible in the durable trail), attribute
    // it to the dedicated sentinel tenant, flagged unknownAccount:true so
    // it never pollutes a real tenant's trail. The sentinel tenant row is
    // ensured (idempotent upsert) before the FK insert.
    const { controller, auditCreate, tenantUpsert } = setup({
      validUser: null,
      tenantIdForEmail: null,
    });

    await expect(
      controller.login({ email: 'ghost@nowhere.test', password: 'x' } as any, makeReq()),
    ).rejects.toThrow(UnauthorizedException);

    // Sentinel tenant ensured idempotently before the insert.
    expect(tenantUpsert).toHaveBeenCalledTimes(1);
    expect(tenantUpsert.mock.calls[0][0].where.id).toBe(SYSTEM_TENANT_ID);

    // Durable row now written (was previously dropped).
    expect(auditCreate).toHaveBeenCalledTimes(1);
    const arg = auditCreate.mock.calls[0][0];
    expect(arg.data.action).toBe('AUTH_LOGIN_FAILED');
    expect(arg.data.tenantId).toBe(SYSTEM_TENANT_ID);
    expect(arg.data.userId).toBeNull();
    const details = JSON.parse(arg.data.details);
    expect(details.unknownAccount).toBe(true);
    expect(details.emailHash).toMatch(/^[0-9a-f]{16}$/);
    // PII never stored in cleartext.
    expect(JSON.stringify(arg.data)).not.toContain('ghost@nowhere.test');
  });

  it('only ensures the sentinel tenant once per process (one-shot guard)', async () => {
    const { controller, tenantUpsert } = setup({ validUser: null, tenantIdForEmail: null });

    await expect(
      controller.login({ email: 'a@nowhere.test', password: 'x' } as any, makeReq()),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      controller.login({ email: 'b@nowhere.test', password: 'x' } as any, makeReq()),
    ).rejects.toThrow(UnauthorizedException);

    // Upserted on the first unknown-email failure only; skipped thereafter.
    expect(tenantUpsert).toHaveBeenCalledTimes(1);
  });

  it('does NOT touch the sentinel tenant when the failed account maps to a real tenant', async () => {
    const { controller, auditCreate, tenantUpsert } = setup({
      validUser: null,
      tenantIdForEmail: 'tenant-7',
    });

    await expect(
      controller.login({ email: 'victim@school.edu', password: 'wrong' } as any, makeReq()),
    ).rejects.toThrow(UnauthorizedException);

    expect(tenantUpsert).not.toHaveBeenCalled();
    const details = JSON.parse(auditCreate.mock.calls[0][0].data.details);
    expect(details.unknownAccount).toBe(false);
  });

  it('writes an AUTH_LOGIN_SUCCESS row on a successful credential check', async () => {
    const user = { id: 'u1', email: 'admin@school.edu', tenantId: 'tenant-7' };
    const { controller, auditCreate } = setup({
      validUser: user,
      loginResult: { access_token: 'jwt', user: { id: 'u1' } },
    });

    const res = await controller.login(
      { email: 'admin@school.edu', password: 'right' } as any,
      makeReq(),
    );
    expect((res as any).access_token).toBe('jwt');

    expect(auditCreate).toHaveBeenCalledTimes(1);
    const arg = auditCreate.mock.calls[0][0];
    expect(arg.data.action).toBe('AUTH_LOGIN_SUCCESS');
    expect(arg.data.tenantId).toBe('tenant-7');
    expect(JSON.parse(arg.data.details).mfaRequired).toBe(false);
  });

  it('records mfaRequired=true when login returns an MFA challenge envelope', async () => {
    const user = { id: 'u1', email: 'admin@school.edu', tenantId: 'tenant-7' };
    const { controller, auditCreate } = setup({
      validUser: user,
      loginResult: { mfaRequired: true, mfaToken: 'chal' },
    });

    await controller.login({ email: 'admin@school.edu', password: 'right' } as any, makeReq());

    const arg = auditCreate.mock.calls[0][0];
    expect(arg.data.action).toBe('AUTH_LOGIN_SUCCESS');
    expect(JSON.parse(arg.data.details).mfaRequired).toBe(true);
  });

  it('never lets a broken audit write fail the login (success path)', async () => {
    const user = { id: 'u1', email: 'admin@school.edu', tenantId: 'tenant-7' };
    const { controller, auditCreate } = setup({ validUser: user });
    auditCreate.mockRejectedValueOnce(new Error('db down'));

    // Must still resolve — audit is best-effort.
    await expect(
      controller.login({ email: 'admin@school.edu', password: 'right' } as any, makeReq()),
    ).resolves.toBeDefined();
  });

  it('prefers the x-forwarded-for client IP when present', async () => {
    const { controller, auditCreate } = setup({ validUser: null, tenantIdForEmail: 'tenant-7' });
    const req = makeReq({ headers: { 'user-agent': 'ua', 'x-forwarded-for': '198.51.100.4, 10.0.0.1' } });

    await expect(
      controller.login({ email: 'v@school.edu', password: 'x' } as any, req),
    ).rejects.toThrow(UnauthorizedException);

    const details = JSON.parse(auditCreate.mock.calls[0][0].data.details);
    expect(details.ip).toBe('198.51.100.4');
  });
});
