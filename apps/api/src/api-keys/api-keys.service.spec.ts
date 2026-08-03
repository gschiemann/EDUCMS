/**
 * ACC-06 (2026-08-01) — API keys never expired by default.
 *
 * `expiresAt` was nullable and "no expiry" was the path of least resistance in
 * the UI, so the common case was a bearer credential valid FOREVER — pasted
 * into a CI config or a vendor portal and still live long after the
 * integration, or the employee who created it, was gone. Keys now expire by
 * default, with a hard ceiling so "expiry" can't be defeated by asking for
 * the year 9999.
 *
 * Also pins the pre-existing role ceiling (SUPER_ADMIN is not mintable from a
 * tenant surface) — the rule ACC-01 found missing on the SSO side.
 */
import { BadRequestException } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 1);

function makeService() {
  const create = jest.fn(async ({ data }: any) => ({ id: 'key-1', ...data }));
  const auditCreate = jest.fn().mockResolvedValue({});
  const prisma: any = {
    client: {
      $transaction: jest.fn(async (cb: any) =>
        cb({ tenantApiKey: { create }, auditLog: { create: auditCreate } }),
      ),
    },
  };
  return { svc: new ApiKeysService(prisma), create, auditCreate };
}

describe('ApiKeysService.resolveExpiry (ACC-06)', () => {
  it('defaults to 90 days when the operator picks nothing', () => {
    const got = ApiKeysService.resolveExpiry(null, NOW);
    expect(got.getTime()).toBe(NOW + 90 * DAY);
  });

  it('never returns null — a key with no expiry is no longer possible', () => {
    expect(ApiKeysService.resolveExpiry(undefined, NOW)).toBeInstanceOf(Date);
    expect(ApiKeysService.resolveExpiry(null, NOW)).toBeInstanceOf(Date);
  });

  it('honors a shorter operator-chosen expiry', () => {
    const requested = new Date(NOW + 7 * DAY);
    expect(ApiKeysService.resolveExpiry(requested, NOW).getTime()).toBe(requested.getTime());
  });

  it('clamps an absurd expiry to the 365-day ceiling', () => {
    const yr9999 = new Date(Date.UTC(9999, 0, 1));
    expect(ApiKeysService.resolveExpiry(yr9999, NOW).getTime()).toBe(NOW + 365 * DAY);
  });

  it('rejects an expiry that is already in the past', () => {
    expect(() => ApiKeysService.resolveExpiry(new Date(NOW - DAY), NOW)).toThrow(
      BadRequestException,
    );
  });
});

describe('ApiKeysService.mint (ACC-06)', () => {
  it('persists a real expiry even when the caller passes none', async () => {
    const { svc, create } = makeService();
    await svc.mint({ tenantId: 't1', name: 'CI', role: 'CONTRIBUTOR', actorUserId: 'u1' });
    const expiresAt: Date = create.mock.calls[0][0].data.expiresAt;
    expect(expiresAt).toBeInstanceOf(Date);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + ApiKeysService.DEFAULT_EXPIRY_DAYS * DAY + 1000,
    );
  });

  it('records the effective expiry in the audit row (not the requested null)', async () => {
    const { svc, auditCreate } = makeService();
    await svc.mint({ tenantId: 't1', name: 'CI', role: 'CONTRIBUTOR', actorUserId: 'u1' });
    const details = JSON.parse(auditCreate.mock.calls[0][0].data.details);
    expect(details.expiresAt).toBeTruthy();
  });

  it('still refuses to mint a SUPER_ADMIN key (platform-owner role, tenant surface)', async () => {
    const { svc, create } = makeService();
    await expect(
      svc.mint({ tenantId: 't1', name: 'evil', role: 'SUPER_ADMIN', actorUserId: 'u1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });
});
