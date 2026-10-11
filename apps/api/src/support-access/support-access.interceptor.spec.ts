import { ForbiddenException } from '@nestjs/common';
import { Observable, lastValueFrom } from 'rxjs';
import { currentAuditActor } from '../audit/audit-actor';
import { SupportAccessInterceptor } from './support-access.interceptor';
import { assertSupportReach, currentSupportAccessFrame, hasSupportReach } from './support-access.context';
import { SupportAccessService } from './support-access.service';

/**
 * The workspace gate. What it must never do matters as much as what it does:
 * customers, screens and API keys are never touched; exempt routes pass; and
 * under a grant every audit row written by the handler is attributed.
 */
function harness(reach: Record<string, { allowed: boolean; basis: any; grantId: string | null }>) {
  const service: any = {
    reach: jest.fn(async (_u: any, tenantId: string) => reach[tenantId] ?? { allowed: false, basis: null, grantId: null, rootTenantId: null }),
    recordAction: jest.fn(async () => undefined),
    assertReach: jest.fn(async (u: any, t: string) => {
      const d = reach[t];
      if (!d?.allowed) throw SupportAccessService.refusal();
      return d;
    }),
  };
  const interceptor = new SupportAccessInterceptor(service);
  const run = async (user: any, url: string, method = 'GET', inside?: () => Promise<unknown>) => {
    const handled = jest.fn(
      () =>
        new Observable((sub) => {
          Promise.resolve()
            .then(() => (inside ? inside() : 'ok'))
            .then((v) => {
              sub.next(v);
              sub.complete();
            }, (e) => sub.error(e));
        }),
    );
    const ctx: any = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => ({ user, originalUrl: url, method }) }) };
    try {
      const out = await lastValueFrom(interceptor.intercept(ctx, { handle: handled } as any));
      return { out, handled: handled.mock.calls.length };
    } catch (e) {
      const res = (e as ForbiddenException).getResponse?.() as any;
      return { error: e, code: res?.code ?? res, status: (e as any).getStatus?.(), handled: handled.mock.calls.length };
    }
  };
  return { run, service };
}

const superAdmin = (tenantId: string) => ({ id: 'super-1', userId: 'super-1', role: 'SUPER_ADMIN', tenantId });
const CUSTOMER = 'org-customer';
const INTERNAL = 'org-internal';
const GRANTED = 'org-granted';
const REACH = {
  [INTERNAL]: { allowed: true, basis: 'internal', grantId: null },
  [GRANTED]: { allowed: true, basis: 'grant', grantId: 'grant-1' },
};

describe('SupportAccessInterceptor — the workspace gate', () => {
  it('a SUPER_ADMIN whose session is stamped with a customer org and no grant → 403 SUPPORT_ACCESS_REQUIRED, handler never runs', async () => {
    const { run } = harness(REACH);
    for (const url of ['/api/v1/playlists', '/api/v1/screens', '/api/v1/assets', '/api/v1/schedules', '/api/v1/users', '/api/v1/audit', '/api/v1/emergency/trigger', '/api/v1/tenants/me', '/api/v1/branding/me', '/api/v1/notifications']) {
      const r = await run(superAdmin(CUSTOMER), url);
      expect(r.code).toBe('SUPPORT_ACCESS_REQUIRED');
      expect(r.status).toBe(403);
      expect(r.handled).toBe(0);
    }
  });

  it('the same super admin inside an internal org, or under a grant, goes through', async () => {
    const { run } = harness(REACH);
    expect((await run(superAdmin(INTERNAL), '/api/v1/playlists')).out).toBe('ok');
    expect((await run(superAdmin(GRANTED), '/api/v1/playlists')).out).toBe('ok');
  });

  it('exempt routes (console metadata, platform ops, auth, the switcher) never consult the grant', async () => {
    const { run, service } = harness(REACH);
    for (const url of ['/api/v1/super/customers', '/api/v1/super/customers/x/support-access/request', '/api/v1/auth/logout', '/api/v1/users/me', '/api/v1/tenants/accessible', '/api/v1/tenants/switch', '/api/v1/health', '/api/v1/license/me', '/api/v1/support-access']) {
      expect((await run(superAdmin(CUSTOMER), url)).out).toBe('ok');
    }
    expect(service.reach).not.toHaveBeenCalled();
  });

  it('NEVER touches a customer admin, a screen (device principal), an API key or an anonymous request', async () => {
    const { run, service } = harness(REACH);
    expect((await run({ id: 'u', role: 'DISTRICT_ADMIN', tenantId: CUSTOMER }, '/api/v1/playlists')).out).toBe('ok');
    expect((await run({ kind: 'device', tenantId: CUSTOMER, id: 'scr' }, '/api/v1/screens/scr/manifest')).out).toBe('ok');
    expect((await run({ kind: 'api-key', role: 'SUPER_ADMIN', tenantId: CUSTOMER }, '/api/v1/playlists')).out).toBe('ok');
    expect((await run(undefined, '/api/v1/signup')).out).toBe('ok');
    expect(service.reach).not.toHaveBeenCalled();
    expect(currentSupportAccessFrame()).toBeNull();
  });

  it('under a GRANT the handler runs inside an audit frame carrying the grant id, and a mutation is recorded', async () => {
    const { run, service } = harness(REACH);
    const seen: any[] = [];
    const r = await run(superAdmin(GRANTED), '/api/v1/playlists/abc', 'DELETE', async () => {
      seen.push(currentAuditActor(), currentSupportAccessFrame()?.workspace);
      return 'deleted';
    });
    expect(r.out).toBe('deleted');
    expect(seen[0]).toEqual({ userId: 'super-1', apiKeyId: null, supportGrantId: 'grant-1' });
    expect(seen[1]).toMatchObject({ basis: 'grant', grantId: 'grant-1' });
    expect(service.recordAction).toHaveBeenCalledWith('grant-1', GRANTED, expect.objectContaining({ id: 'super-1' }), 'DELETE', '/api/v1/playlists/abc');
  });

  it('a READ under a grant is attributed but not recorded as an action; internal orgs carry no grant id', async () => {
    const { run, service } = harness(REACH);
    let actor: any = 'unset';
    await run(superAdmin(GRANTED), '/api/v1/playlists', 'GET', async () => { actor = currentAuditActor(); return 'ok'; });
    expect(actor?.supportGrantId).toBe('grant-1');
    expect(service.recordAction).not.toHaveBeenCalled();
    await run(superAdmin(INTERNAL), '/api/v1/playlists', 'POST', async () => { actor = currentAuditActor(); return 'ok'; });
    expect(actor).toBeNull();
    expect(service.recordAction).not.toHaveBeenCalled();
  });

  it('the frame stays scoped to the request: nothing leaks after the handler completes', async () => {
    const { run } = harness(REACH);
    await run(superAdmin(GRANTED), '/api/v1/playlists');
    expect(currentSupportAccessFrame()).toBeNull();
    expect(currentAuditActor()).toBeNull();
  });

  describe('assertSupportReach — the cross-tenant half, read from the frame', () => {
    it('outside a frame it is a no-op (unit harnesses that build controllers by hand)', async () => {
      await expect(assertSupportReach(superAdmin(INTERNAL), CUSTOMER)).resolves.toBeUndefined();
      expect(await hasSupportReach(superAdmin(INTERNAL), CUSTOMER)).toBe(true);
    });

    it('inside a frame a SUPER_ADMIN naming an unreachable tenant is refused; a reachable one passes', async () => {
      const { run } = harness(REACH);
      const r = await run(superAdmin(INTERNAL), '/api/v1/emergency/trigger', 'POST', async () => {
        await assertSupportReach(superAdmin(INTERNAL), GRANTED); // ok
        expect(await hasSupportReach(superAdmin(INTERNAL), CUSTOMER)).toBe(false);
        await assertSupportReach(superAdmin(INTERNAL), CUSTOMER); // throws
        return 'unreachable';
      });
      expect(r.code).toBe('SUPPORT_ACCESS_REQUIRED');
    });

    it('inside a frame it still ignores customers, screens and API keys', async () => {
      const { run } = harness(REACH);
      const r = await run(superAdmin(INTERNAL), '/api/v1/x', 'POST', async () => {
        await assertSupportReach({ role: 'DISTRICT_ADMIN', tenantId: CUSTOMER }, CUSTOMER);
        await assertSupportReach({ kind: 'device', role: 'SUPER_ADMIN' } as any, CUSTOMER);
        await assertSupportReach(superAdmin(INTERNAL), null);
        return 'ok';
      });
      expect(r.out).toBe('ok');
    });
  });
});
