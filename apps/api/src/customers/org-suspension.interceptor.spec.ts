import { ForbiddenException } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { OrgSuspensionGate, OrgSuspensionInterceptor } from './org-suspension.interceptor';

/**
 * The suspended-organisation gate. What it must never do matters more than what it does:
 * screens (device principals) and emergency routes are never gated.
 */
function harness(suspendedTenants: string[], opts: { throws?: boolean } = {}) {
  const license = {
    orgAccount: jest.fn(async (tenantId: string) => {
      if (opts.throws) throw new Error('db down');
      return { rootTenantId: tenantId, governing: null, suspended: suspendedTenants.includes(tenantId) };
    }),
  };
  const gate = new OrgSuspensionGate(license as any);
  const interceptor = new OrgSuspensionInterceptor(gate);
  const run = async (user: any, url: string) => {
    const handled = jest.fn(() => of('ok'));
    const ctx: any = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => ({ user, originalUrl: url }) }) };
    try {
      const out = await lastValueFrom(interceptor.intercept(ctx, { handle: handled } as any));
      return { out, handled: handled.mock.calls.length };
    } catch (e) {
      return { error: e, code: ((e as ForbiddenException).getResponse() as any)?.code, handled: handled.mock.calls.length };
    }
  };
  return { run, license, gate };
}

const person = (tenantId: string, role = 'DISTRICT_ADMIN') => ({ id: 'u1', userId: 'u1', role, tenantId });

describe('OrgSuspensionInterceptor', () => {
  it('blocks a signed-in person of a suspended organisation with 403 ORG_SUSPENDED', async () => {
    const { run } = harness(['org-s']);
    const r = await run(person('org-s'), '/api/v1/playlists');
    expect(r.code).toBe('ORG_SUSPENDED');
    expect(r.handled).toBe(0);
  });

  it('blocks the organisation’s API keys too', async () => {
    const { run } = harness(['org-s']);
    expect((await run({ kind: 'api-key', role: 'SCHOOL_ADMIN', tenantId: 'org-s' }, '/api/v1/assets')).code).toBe('ORG_SUSPENDED');
  });

  it('NEVER gates a screen (device principal) — content keeps playing', async () => {
    const { run, license } = harness(['org-s']);
    const r = await run({ kind: 'device', tenantId: 'org-s', id: 'scr' }, '/api/v1/screens/scr/manifest');
    expect(r.out).toBe('ok');
    expect(license.orgAccount).not.toHaveBeenCalled();
  });

  it.each(['/api/v1/emergency/trigger', '/api/v1/emergency/abc/all-clear', '/api/v1/panic-content/lockdown', '/api/v1/users/me', '/api/v1/auth/logout'])(
    'NEVER gates %s — emergencies and sign-out still work',
    async (url) => {
      const { run } = harness(['org-s']);
      expect((await run(person('org-s'), url)).out).toBe('ok');
    },
  );

  it('never gates a SUPER_ADMIN, an unauthenticated route, or an active organisation', async () => {
    const { run } = harness(['org-s']);
    expect((await run(person('org-s', 'SUPER_ADMIN'), '/api/v1/playlists')).out).toBe('ok');
    expect((await run(undefined, '/api/v1/signup')).out).toBe('ok');
    expect((await run(person('org-ok'), '/api/v1/playlists')).out).toBe('ok');
  });

  it('caches the answer per tenant and fails OPEN if the lookup breaks', async () => {
    const cached = harness(['org-s']);
    await cached.run(person('org-s'), '/api/v1/a');
    await cached.run(person('org-s'), '/api/v1/b');
    expect(cached.license.orgAccount).toHaveBeenCalledTimes(1);
    cached.gate.invalidate();
    await cached.run(person('org-s'), '/api/v1/c');
    expect(cached.license.orgAccount).toHaveBeenCalledTimes(2);

    const broken = harness(['org-s'], { throws: true });
    expect((await broken.run(person('org-s'), '/api/v1/playlists')).out).toBe('ok');
  });
});
