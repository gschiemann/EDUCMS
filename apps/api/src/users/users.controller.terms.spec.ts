/**
 * POST /users/me/terms — the End User License Agreement, accepted on the
 * person's ACCOUNT (2026-10-24, launch QA S2).
 *
 * Acceptance used to live only in one browser's localStorage, so the API had
 * no record of who accepted which version when. These pin the record:
 *   - it is written on the CALLER's own row (no id in the route) together
 *     with an immutable TERMS_ACCEPTED row — version, time, address, how;
 *   - only the CURRENT version can be accepted;
 *   - it is idempotent: the first acceptance of a version stands, a repeat
 *     writes nothing;
 *   - a machine identity cannot accept anything;
 *   - GET /users/me says which version is current and what is on file.
 */
import { BadRequestException } from '@nestjs/common';
import { EULA_VERSION, AcceptTermsInputSchema } from '@cms/api-types';
import { UsersController } from './users.controller';
import { ZodValidationPipe } from '../security/zod-validation.pipe';

function makeController(row: Record<string, unknown> | null) {
  const tx = {
    user: { update: jest.fn(async ({ data }: any) => ({ ...row, ...data })) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const prisma: any = {
    client: {
      user: { findUnique: jest.fn(async () => row) },
      tenant: { findUnique: jest.fn(async () => ({ vertical: 'K12', name: 'Springfield', slug: 'springfield' })) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    },
  };
  const ctrl = new UsersController(
    prisma,
    { markUserTokensInvalid: jest.fn() } as any,
    { revokeAllForUser: jest.fn() } as any,
    { isConfigured: () => false } as any,
  );
  return { ctrl, prisma, tx };
}

const req = (over: Record<string, unknown> = {}) => ({
  user: { id: 'u1', userId: 'u1', tenantId: 't1', role: 'CONTRIBUTOR', ...over },
  headers: { 'user-agent': 'jest-agent/1.0' },
  ip: '203.0.113.5',
});

describe('POST /users/me/terms', () => {
  it('records the current version on the caller’s own row, with a TERMS_ACCEPTED audit row', async () => {
    const { ctrl, tx } = makeController({ id: 'u1', tenantId: 't1', termsAcceptedVersion: null, termsAcceptedAt: null });
    const res: any = await ctrl.acceptTerms(req() as any, { version: EULA_VERSION, method: 'prompt' });

    expect(res).toMatchObject({ version: EULA_VERSION, recorded: true });
    expect(res.acceptedAt).toBeInstanceOf(Date);
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { termsAcceptedVersion: EULA_VERSION, termsAcceptedAt: expect.any(Date) },
    });
    const audit = (tx.auditLog.create.mock.calls[0] as any)[0].data;
    expect(audit).toMatchObject({ tenantId: 't1', userId: 'u1', action: 'TERMS_ACCEPTED', targetType: 'User', targetId: 'u1' });
    expect(JSON.parse(audit.details)).toMatchObject({
      document: 'eula', version: EULA_VERSION, method: 'prompt', previousVersion: null, ua: 'jest-agent/1.0',
    });
  });

  it('a tick from the sign-in form is recorded as such', async () => {
    const { ctrl, tx } = makeController({ id: 'u1', tenantId: 't1', termsAcceptedVersion: null, termsAcceptedAt: null });
    await ctrl.acceptTerms(req() as any, { version: EULA_VERSION, method: 'sign-in' });
    expect(JSON.parse((tx.auditLog.create.mock.calls[0] as any)[0].data.details).method).toBe('sign-in');
  });

  it('is idempotent — the first acceptance stands and a repeat writes nothing', async () => {
    const first = new Date('2026-10-24T09:00:00Z');
    const { ctrl, tx } = makeController({ id: 'u1', tenantId: 't1', termsAcceptedVersion: EULA_VERSION, termsAcceptedAt: first });
    const res: any = await ctrl.acceptTerms(req() as any, { version: EULA_VERSION });
    expect(res).toEqual({ version: EULA_VERSION, acceptedAt: first, recorded: false });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('an older acceptance is upgraded to the current version, naming the old one', async () => {
    const { ctrl, tx } = makeController({ id: 'u1', tenantId: 't1', termsAcceptedVersion: '0.9', termsAcceptedAt: new Date('2026-01-01') });
    await ctrl.acceptTerms(req() as any, { version: EULA_VERSION });
    expect(JSON.parse((tx.auditLog.create.mock.calls[0] as any)[0].data.details).previousVersion).toBe('0.9');
  });

  it('refuses a version nobody is shown', async () => {
    const { ctrl, tx } = makeController({ id: 'u1', tenantId: 't1', termsAcceptedVersion: null, termsAcceptedAt: null });
    await expect(ctrl.acceptTerms(req() as any, { version: '9.9' })).rejects.toMatchObject({
      response: { code: 'TERMS_VERSION_UNKNOWN', currentVersion: EULA_VERSION },
    });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('a machine identity accepts nothing', async () => {
    const { ctrl, tx } = makeController({ id: 'u1', tenantId: 't1' });
    await expect(ctrl.acceptTerms(req({ kind: 'api-key' }) as any, { version: EULA_VERSION })).rejects.toMatchObject({
      response: { code: 'TERMS_NOT_APPLICABLE' },
    });
    await expect(ctrl.acceptTerms(req({ kind: 'device' }) as any, { version: EULA_VERSION })).rejects.toMatchObject({
      response: { code: 'TERMS_NOT_APPLICABLE' },
    });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('the body is strict — no smuggling another user id', () => {
    const pipe = new ZodValidationPipe(AcceptTermsInputSchema);
    expect(() => pipe.transform({ version: EULA_VERSION, userId: 'someone-else' }, { type: 'body' } as any)).toThrow(BadRequestException);
    expect(pipe.transform({ version: EULA_VERSION }, { type: 'body' } as any)).toEqual({ version: EULA_VERSION });
  });
});

describe('GET /users/me — the EULA facts the dashboard reads', () => {
  it('says which version is current and what is on file, plus the password-only setup flag', async () => {
    const { ctrl, prisma } = makeController({
      id: 'u1', email: 'pat@school.example', role: 'CONTRIBUTOR', tenantId: 't1',
      termsAcceptedVersion: null, termsAcceptedAt: null, setupPasswordOnly: true, mustSetupCredentials: true,
    });
    const me: any = await ctrl.getMe(req() as any);
    expect(me).toMatchObject({
      termsCurrentVersion: EULA_VERSION,
      termsAcceptedVersion: null,
      setupPasswordOnly: true,
    });
    const select = prisma.client.user.findUnique.mock.calls[0][0].select;
    expect(select).toMatchObject({ setupPasswordOnly: true, termsAcceptedVersion: true, termsAcceptedAt: true });
  });
});
