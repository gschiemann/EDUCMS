import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AppRole } from '@cms/database';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { isCsrfExempt } from '../security/csrf.middleware';
import { SuperCustomersController } from './super-customers.controller';
import { CustomerClaimController } from './customer-claim.controller';
import { CustomerBillingController } from './customer-billing.controller';
import { BillingController } from '../billing/billing.controller';

/**
 * ROLE CHECKS for the customer console, enforced on the SERVER:
 *   - every /super/customers route is behind JwtAuthGuard + RbacGuard with SUPER_ADMIN only;
 *   - the real RbacGuard refuses every other role (a customer's own DISTRICT_ADMIN included);
 *   - the public claim routes take no session, and only the claim POST is CSRF-exempt;
 *   - the customer-facing /billing/account is the caller's own organisation only.
 * Plus the server half of "invoice customers never see Stripe checkout".
 */

const ROUTES = ['list', 'create', 'detail', 'updateLicense', 'suspend', 'reactivate', 'createInvoice', 'updateInvoice', 'starterLink'] as const;

function rbacFor(handler: (...a: any[]) => any, role: string) {
  const guard = new RbacGuard(new Reflector());
  const ctx: any = {
    getHandler: () => handler,
    getClass: () => SuperCustomersController,
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u', role, tenantId: 't' }, params: {}, query: {}, body: {} }) }),
  };
  return () => guard.canActivate(ctx);
}

describe('SuperCustomersController — SUPER_ADMIN only', () => {
  it('declares JwtAuthGuard + RbacGuard and SUPER_ADMIN at the class', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, SuperCustomersController);
    expect(guards).toEqual([JwtAuthGuard, RbacGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, SuperCustomersController)).toEqual([AppRole.SUPER_ADMIN]);
  });

  it.each(ROUTES)('%s: no method-level role override widens access', (name) => {
    const handler = (SuperCustomersController.prototype as any)[name];
    expect(typeof handler).toBe('function');
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
  });

  it.each([AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR, AppRole.RESTRICTED_VIEWER])(
    'the real RbacGuard refuses %s on every route',
    (role) => {
      for (const name of ROUTES) {
        const handler = (SuperCustomersController.prototype as any)[name];
        expect(rbacFor(handler, role)).toThrow(ForbiddenException);
      }
    },
  );

  it('the real RbacGuard admits SUPER_ADMIN', () => {
    for (const name of ROUTES) {
      expect(rbacFor((SuperCustomersController.prototype as any)[name], AppRole.SUPER_ADMIN)()).toBe(true);
    }
  });

  it('passes the authenticated SUPER_ADMIN as the audit actor', async () => {
    const svc = { updateLicense: jest.fn(async () => ({ ok: true })), setSuspended: jest.fn(async () => ({ ok: true })) };
    const c = new SuperCustomersController(svc as any);
    await c.updateLicense('id-1', { seatLimit: 3 }, { user: { userId: 'super-1' } });
    await c.suspend('id-1', { reason: 'late' }, { user: { id: 'super-1' } });
    expect(svc.updateLicense).toHaveBeenCalledWith('id-1', { seatLimit: 3 }, 'super-1');
    expect(svc.setSuspended).toHaveBeenCalledWith('id-1', true, 'late', 'super-1');
  });
});

describe('CustomerClaimController — public, single-purpose', () => {
  it('carries no session guard (the token is the credential)', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CustomerClaimController)).toBeUndefined();
  });

  it('only the claim POST is CSRF-exempt — not other customer or super routes', () => {
    expect(isCsrfExempt('POST', '/api/v1/customer-claims/abc_DEF-123/claim')).toBe(true);
    expect(isCsrfExempt('POST', '/api/v1/customer-claims/abc/claim/extra')).toBe(false);
    expect(isCsrfExempt('POST', '/api/v1/super/customers')).toBe(false);
    expect(isCsrfExempt('PATCH', '/api/v1/super/customers/x/license')).toBe(false);
  });
});

describe('GET /billing/account — the caller’s own organisation only', () => {
  it('reads req.user.tenantId and nothing from the request', async () => {
    const svc = { billingAccount: jest.fn(async () => ({})) };
    const c = new CustomerBillingController(svc as any);
    await c.account({ user: { tenantId: 'school-1' }, query: { tenantId: 'evil' }, params: { id: 'evil' } });
    expect(svc.billingAccount).toHaveBeenCalledWith('school-1');
    expect(Reflect.getMetadata(GUARDS_METADATA, CustomerBillingController)).toEqual([JwtAuthGuard, RbacGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, CustomerBillingController.prototype.account)).toEqual([
      AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN,
    ]);
  });
});

describe('BillingController — invoice-billed customers never get a Stripe checkout', () => {
  const build = (billingMode: string | null) => {
    const stripe = {
      enabled: () => true,
      checkoutForTenant: jest.fn(async () => ({ url: 'https://checkout.stripe.com/x' })),
      checkoutBoardPack: jest.fn(async () => ({ url: 'https://checkout.stripe.com/pack' })),
    };
    const license = {
      orgAccount: jest.fn(async () => ({ rootTenantId: 'org', suspended: false, governing: billingMode ? { billingMode } : null })),
    };
    const prisma = { client: { tenant: { findUnique: async () => ({ slug: 'acme' }) } } };
    const allowance = {
      purchaseAvailabilityFor: jest.fn(async () => ({ enabled: true })),
      orgTenantIdFor: jest.fn(async () => 'org'),
    };
    const c = new BillingController(stripe as any, license as any, prisma as any, allowance as any);
    const req = { user: { tenantId: 'school-1', tenantSlug: 'acme' }, headers: { origin: 'https://app.test' }, protocol: 'https' };
    return { c, stripe, req, allowance };
  };
  const status = async (p: Promise<unknown>) => {
    try {
      await p;
      return null;
    } catch (e: any) {
      return { status: e.getStatus(), code: e.getResponse().code };
    }
  };

  it.each(['INVOICE', 'PURCHASE_ORDER', 'COMP'])('%s: subscription checkout is refused (409 BILLING_NOT_CARD) and Stripe is never called', async (mode) => {
    const { c, stripe, req } = build(mode);
    expect(await status(c.checkout(req, { billingPeriod: 'annual' }))).toEqual({ status: 409, code: 'BILLING_NOT_CARD' });
    expect(stripe.checkoutForTenant).not.toHaveBeenCalled();
  });

  it.each(['CARD', null])('%s: the existing Stripe flow is untouched', async (mode) => {
    const { c, stripe, req } = build(mode);
    await expect(c.checkout(req, { billingPeriod: 'monthly' })).resolves.toEqual({ url: 'https://checkout.stripe.com/x' });
    expect(stripe.checkoutForTenant).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'school-1', period: 'monthly' }));
  });

  it.each(['INVOICE', 'PURCHASE_ORDER'])('%s: AI board pack card checkout is refused too', async (mode) => {
    const { c, stripe, req } = build(mode);
    expect(await status(c.aiPackCheckout(req, { pack: 'starter' }))).toEqual({ status: 409, code: 'BILLING_NOT_CARD' });
    expect(stripe.checkoutBoardPack).not.toHaveBeenCalled();
  });

  it('a comp’d customer may still buy an AI board pack', async () => {
    const { c, allowance, req } = build('COMP');
    await c.aiPackCheckout(req, { pack: 'starter' });
    expect(allowance.purchaseAvailabilityFor).toHaveBeenCalled();
  });
});
