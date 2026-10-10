import { HttpException } from '@nestjs/common';
import { createHash } from 'crypto';
import { LicenseService } from '../license/license.service';
import { CustomerConsoleService } from './customer-console.service';
import { OrgSuspensionGate } from './org-suspension.interceptor';
import { FakeDb } from './customer-console.fakedb-spec';
import { parseListQuery, STARTER_EMAIL_DOMAIN } from './customer-console.policy';

/**
 * CustomerConsoleService against an in-memory database that commits / rolls back like a real
 * one (customer-console.fakedb-spec.ts). These prove OUTCOMES — rows written, audit rows with
 * before/after, isolation between customers — not that a mock was called.
 */

const ORG_A = '11111111-1111-4111-8111-111111111111';
const SCHOOL_A1 = '11111111-1111-4111-8111-1111111111a1';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const ORG_CARD = '33333333-3333-4333-8333-333333333333';
const SUPER = '99999999-9999-4999-8999-999999999999';

function setup() {
  const db = new FakeDb();
  db.addTenant({ id: ORG_A, name: 'Acme Schools', slug: 'acme', vertical: 'K12' });
  db.addTenant({ id: SCHOOL_A1, name: 'Acme North', slug: 'acme-north', parentId: ORG_A });
  db.addTenant({ id: ORG_B, name: 'Bravo Gym', slug: 'bravo', vertical: 'GYM' });
  db.addTenant({ id: ORG_CARD, name: 'Card Cafe', slug: 'card-cafe', vertical: 'QSR' });
  db.addLicense({ tenantId: ORG_A, billingMode: 'INVOICE', seatLimit: 5, poNumber: 'PO-77' });
  db.addLicense({ tenantId: ORG_B, billingMode: 'PURCHASE_ORDER', seatLimit: 2 });
  db.addLicense({ tenantId: ORG_CARD, billingMode: 'CARD', tier: 'MONTHLY', stripeSubscriptionId: 'sub_1' });
  db.addScreens(ORG_A, 2);
  db.addScreens(SCHOOL_A1, 4);
  db.addScreens(SCHOOL_A1, 3, false); // pending pairs never count
  db.addScreens(ORG_B, 1);
  const prisma = { client: db.client } as any;
  const auth = {
    hashPassword: jest.fn(async (p: string) => `hash:${p.length}`),
    login: jest.fn(async (user: any, _rm: any, opts: any) => ({ access_token: 'tok', user: { id: user.id, mustSetupCredentials: !!user.mustSetupCredentials }, opts })),
  };
  const license = new LicenseService(prisma);
  const gate = new OrgSuspensionGate(license);
  jest.spyOn(gate, 'invalidate');
  const sampleData = { seedForNewTenant: jest.fn(async () => undefined) };
  const starterBoard = { seedForNewTenant: jest.fn(async () => undefined) };
  const svc = new CustomerConsoleService(prisma, auth as any, license, gate, sampleData as any, starterBoard as any);
  return { db, svc, auth, gate, sampleData, starterBoard };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    const r = (e as HttpException).getResponse?.() as any;
    return { status: (e as HttpException).getStatus?.(), code: r?.code };
  }
  throw new Error('expected a rejection');
};

describe('CustomerConsoleService.list', () => {
  it('lists top-level organisations only, with screens rolled up from their locations', async () => {
    const { svc } = setup();
    const out = await svc.list(parseListQuery({}));
    expect(out.rows.map((r) => r.name)).toEqual(['Acme Schools', 'Bravo Gym', 'Card Cafe']);
    const acme = out.rows.find((r) => r.id === ORG_A)!;
    expect(acme.seatsUsed).toBe(6); // 2 at the org + 4 paired at the school; 3 pending ignored
    expect(acme.locations).toBe(1);
    expect(acme.seatLimit).toBe(5);
    expect(acme.billingMode).toBe('INVOICE');
  });

  it('filters server-side and paginates', async () => {
    const { svc } = setup();
    expect((await svc.list(parseListQuery({ seats: 'over' }))).rows.map((r) => r.id)).toEqual([ORG_A]);
    expect((await svc.list(parseListQuery({ billingMode: 'CARD' }))).rows.map((r) => r.id)).toEqual([ORG_CARD]);
    expect((await svc.list(parseListQuery({ vertical: 'gym' }))).rows.map((r) => r.id)).toEqual([ORG_B]);
    expect((await svc.list(parseListQuery({ q: 'bra' }))).rows.map((r) => r.id)).toEqual([ORG_B]);
    const page2 = await svc.list(parseListQuery({ pageSize: '2', page: '2' }));
    expect(page2).toMatchObject({ total: 3, pages: 2, page: 2 });
    expect(page2.rows).toHaveLength(1);
  });

  it('marks a customer past due when an ARC invoice is overdue, and reports last activity', async () => {
    const { svc, db } = setup();
    db.addInvoice({ tenantId: ORG_B, number: 'ARC-1', amountCents: 5000, status: 'SENT', dueAt: new Date('2026-01-01') });
    db.addAudit(SCHOOL_A1, new Date('2026-09-01T00:00:00Z'));
    const out = await svc.list(parseListQuery({}), new Date('2026-10-10'));
    const bravo = out.rows.find((r) => r.id === ORG_B)!;
    expect(bravo).toMatchObject({ status: 'past_due', openInvoiceCents: 5000, overdueInvoices: 1 });
    expect(out.rows.find((r) => r.id === ORG_A)!.lastActivityAt).toBe('2026-09-01T00:00:00.000Z');
  });
});

describe('CustomerConsoleService.detail', () => {
  it('refuses a location id — a school is not a customer', async () => {
    const { svc } = setup();
    expect(await code(svc.detail(SCHOOL_A1))).toEqual({ status: 400, code: 'CUSTOMER_NOT_TOP_LEVEL' });
  });

  it('returns only THIS customer’s invoices (tenant isolation)', async () => {
    const { svc, db } = setup();
    db.addInvoice({ tenantId: ORG_A, number: 'ARC-A' });
    db.addInvoice({ tenantId: ORG_B, number: 'ARC-B' });
    const d = await svc.detail(ORG_A);
    expect(d.invoices.map((i) => i.number)).toEqual(['ARC-A']);
    expect(d.seatsUsed).toBe(6);
    expect(d.locations).toEqual([expect.objectContaining({ id: SCHOOL_A1, seatsUsed: 4 })]);
  });

  it('404s an unknown customer', async () => {
    const { svc } = setup();
    expect(await code(svc.detail('00000000-0000-4000-8000-000000000000'))).toEqual({ status: 404, code: 'CUSTOMER_NOT_FOUND' });
  });
});

describe('CustomerConsoleService.updateLicense', () => {
  it('writes the license and ONE audit row with before / after / changed', async () => {
    const { svc, db } = setup();
    await svc.updateLicense(ORG_A, { seatLimit: 25, monthlyPriceCents: 1800, renewalDate: '2027-07-01', poNumber: 'PO-99' }, SUPER);
    const lic = db.s.licenses.find((l) => l.tenantId === ORG_A)!;
    expect(lic).toMatchObject({ seatLimit: 25, monthlyPriceCents: 1800, poNumber: 'PO-99' });
    const rows = db.s.audit.filter((a) => a.action === 'CUSTOMER_LICENSE_UPDATED');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenantId: ORG_A, userId: SUPER, targetType: 'License' });
    const d = JSON.parse(rows[0].details);
    expect(d.before).toMatchObject({ seatLimit: 5, poNumber: 'PO-77' });
    expect(d.after).toMatchObject({ seatLimit: 25, poNumber: 'PO-99', renewalDate: '2027-07-01T00:00:00.000Z' });
    expect(d.changed).toEqual(['monthlyPriceCents', 'poNumber', 'renewalDate', 'seatLimit']);
  });

  it('creates a first license for a customer that has none', async () => {
    const { svc, db } = setup();
    db.addTenant({ id: '44444444-4444-4444-8444-444444444444', name: 'New Org' });
    await svc.updateLicense('44444444-4444-4444-8444-444444444444', { seatLimit: 3 }, SUPER);
    expect(db.s.licenses.find((l) => l.tenantId === '44444444-4444-4444-8444-444444444444')).toMatchObject({ seatLimit: 3, billingMode: 'INVOICE' });
    const d = JSON.parse(db.s.audit.at(-1)!.details);
    expect(d.before).toBeNull();
  });

  it('refuses to move a live card subscription off CARD, and changes nothing', async () => {
    const { svc, db } = setup();
    expect(await code(svc.updateLicense(ORG_CARD, { billingMode: 'INVOICE' }, SUPER))).toEqual({ status: 409, code: 'CUSTOMER_CARD_SUBSCRIPTION_ACTIVE' });
    expect(await code(svc.updateLicense(ORG_CARD, { monthlyPriceCents: 100 }, SUPER))).toEqual({ status: 409, code: 'CUSTOMER_STRIPE_MANAGED' });
    expect(db.s.licenses.find((l) => l.tenantId === ORG_CARD)!.billingMode).toBe('CARD');
    expect(db.s.audit).toHaveLength(0);
  });

  it('refuses SUSPENDED through the generic edit (it has its own audited endpoint)', async () => {
    const { svc } = setup();
    expect(await code(svc.updateLicense(ORG_A, { status: 'SUSPENDED' }, SUPER))).toEqual({ status: 400, code: 'CUSTOMER_STATUS_INVALID' });
  });
});

describe('CustomerConsoleService suspend / reactivate', () => {
  it('suspends with a reason, audits before/after, and clears the gate cache', async () => {
    const { svc, db, gate } = setup();
    await svc.setSuspended(ORG_A, true, 'Unpaid since July', SUPER);
    expect(db.s.licenses.find((l) => l.tenantId === ORG_A)).toMatchObject({ status: 'SUSPENDED', suspendReason: 'Unpaid since July' });
    const row = db.s.audit.find((a) => a.action === 'CUSTOMER_SUSPENDED')!;
    const d = JSON.parse(row.details);
    expect(d.before.status).toBe('ACTIVE');
    expect(d.after.status).toBe('SUSPENDED');
    expect(gate.invalidate).toHaveBeenCalled();

    // The whole organisation is suspended — the school under it too.
    expect(await gate.isSuspended(SCHOOL_A1)).toBe(true);
    expect(await gate.isSuspended(ORG_B)).toBe(false);

    await svc.setSuspended(ORG_A, false, null, SUPER);
    expect(db.s.licenses.find((l) => l.tenantId === ORG_A)).toMatchObject({ status: 'ACTIVE', suspendedAt: null, suspendReason: null });
    expect(db.s.audit.map((a) => a.action)).toEqual(['CUSTOMER_SUSPENDED', 'CUSTOMER_REACTIVATED']);
  });

  it('refuses double-suspend, reactivating an active customer, and suspending with no license', async () => {
    const { svc, db } = setup();
    expect(await code(svc.setSuspended(ORG_A, false, null, SUPER))).toEqual({ status: 409, code: 'CUSTOMER_NOT_SUSPENDED' });
    await svc.setSuspended(ORG_A, true, null, SUPER);
    expect(await code(svc.setSuspended(ORG_A, true, null, SUPER))).toEqual({ status: 409, code: 'CUSTOMER_ALREADY_SUSPENDED' });
    db.addTenant({ id: '55555555-5555-4555-8555-555555555555', name: 'No License' });
    expect(await code(svc.setSuspended('55555555-5555-4555-8555-555555555555', true, null, SUPER))).toEqual({ status: 409, code: 'CUSTOMER_NO_LICENSE' });
  });

  it('a suspended organisation pairs no new screens — at a location under it too', async () => {
    const { svc, db } = setup();
    await svc.setSuspended(ORG_A, true, null, SUPER);
    const license = new LicenseService({ client: db.client } as any);
    expect(await code(license.assertSeatAvailable(SCHOOL_A1))).toEqual({ status: 402, code: 'ORG_SUSPENDED' });
    await expect(license.assertSeatAvailable(ORG_B)).resolves.toBeUndefined();
  });
});

describe('CustomerConsoleService invoices', () => {
  it('records an invoice for an invoice-billed customer, defaulting the PO and sent date, with an audit row', async () => {
    const { svc, db } = setup();
    const now = new Date('2026-10-10T12:00:00Z');
    const inv = await svc.createInvoice(ORG_A, { number: 'ARC-1001', amountCents: 50000, dueAt: '2026-11-09' }, SUPER, now);
    expect(inv).toMatchObject({ number: 'ARC-1001', status: 'SENT', poNumber: 'PO-77', sentAt: now.toISOString() });
    const row = db.s.audit.find((a) => a.action === 'CUSTOMER_INVOICE_CREATED')!;
    expect(row).toMatchObject({ tenantId: ORG_A, userId: SUPER });
    expect(JSON.parse(row.details)).toMatchObject({ before: null, after: { number: 'ARC-1001', amountCents: 50000 } });
  });

  it('refuses invoices for a CARD or COMP customer', async () => {
    const { svc } = setup();
    expect(await code(svc.createInvoice(ORG_CARD, { number: 'X-1', amountCents: 1 }, SUPER))).toEqual({ status: 409, code: 'CUSTOMER_NOT_INVOICE_BILLED' });
  });

  it('refuses a duplicate invoice number and rolls back (no audit row survives)', async () => {
    const { svc, db } = setup();
    await svc.createInvoice(ORG_A, { number: 'ARC-1', amountCents: 1 }, SUPER);
    expect(await code(svc.createInvoice(ORG_B, { number: 'ARC-1', amountCents: 1 }, SUPER))).toEqual({ status: 409, code: 'INVOICE_NUMBER_TAKEN' });
    expect(db.s.audit.filter((a) => a.action === 'CUSTOMER_INVOICE_CREATED')).toHaveLength(1);
  });

  it('marks paid (stamping the paid date) with before/after; another customer’s invoice is a 404', async () => {
    const { svc, db } = setup();
    const inv = await svc.createInvoice(ORG_A, { number: 'ARC-2', amountCents: 900 }, SUPER);
    const now = new Date('2026-10-12T00:00:00Z');
    const paid = await svc.updateInvoice(ORG_A, inv.id, { status: 'PAID' }, SUPER, now);
    expect(paid).toMatchObject({ status: 'PAID', paidAt: now.toISOString() });
    const d = JSON.parse(db.s.audit.find((a) => a.action === 'CUSTOMER_INVOICE_UPDATED')!.details);
    expect(d.changed).toEqual(['paidAt', 'status']);
    expect(d.before.status).toBe('SENT');

    // TENANT ISOLATION: ORG_B's URL cannot touch ORG_A's invoice.
    expect(await code(svc.updateInvoice(ORG_B, inv.id, { status: 'VOID' }, SUPER))).toEqual({ status: 404, code: 'INVOICE_NOT_FOUND' });
    expect(db.s.invoices.find((i) => i.id === inv.id)!.status).toBe('PAID');
  });
});

describe('CustomerConsoleService.createCustomer + the single-use owner link', () => {
  const body = {
    name: 'Riverside Unified',
    vertical: 'k12',
    seatLimit: 40,
    monthlyPriceCents: 2000,
    plan: 'ANNUAL',
    billingMode: 'PURCHASE_ORDER',
    poNumber: 'PO-2026-14',
    renewalDate: '2027-08-01',
    primaryColor: '#1d4ed8',
    displayName: 'Riverside Signage',
    ownerFirstName: 'Pat',
  };

  it('creates the organisation, license, branding, a starter owner held to setup, and a hashed single-use link', async () => {
    const { svc, db, sampleData, starterBoard } = setup();
    const out = await svc.createCustomer(body, SUPER);
    expect(out.slug).toBe('riverside-unified');
    const tenant = db.s.tenants.find((t) => t.id === out.id)!;
    expect(tenant).toMatchObject({ name: 'Riverside Unified', vertical: 'K12', parentId: null });
    expect(db.s.licenses.find((l) => l.tenantId === out.id)).toMatchObject({
      tier: 'ANNUAL', billingMode: 'PURCHASE_ORDER', seatLimit: 40, monthlyPriceCents: 2000, poNumber: 'PO-2026-14', status: 'ACTIVE',
    });
    expect(db.s.branding.find((b) => b.tenantId === out.id)).toMatchObject({ displayName: 'Riverside Signage' });

    const owner = db.s.users.find((u) => u.tenantId === out.id)!;
    expect(owner).toMatchObject({ role: 'DISTRICT_ADMIN', status: 'INVITED', mustSetupCredentials: true, mfaRequired: true, firstName: 'Pat' });
    expect(owner.email.endsWith(`@${STARTER_EMAIL_DOMAIN}`)).toBe(true);

    const token = out.starterLink.url.split('/claim-account/')[1];
    expect(token.length).toBeGreaterThanOrEqual(40);
    const invite = db.s.invites.find((i) => i.userId === owner.id)!;
    expect(invite.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    // The token itself is stored nowhere and logged nowhere.
    expect(JSON.stringify(db.s)).not.toContain(token);

    const audit = db.s.audit.find((a) => a.action === 'CUSTOMER_CREATED')!;
    expect(audit).toMatchObject({ tenantId: out.id, userId: SUPER });
    expect(JSON.parse(audit.details).license.after).toMatchObject({ seatLimit: 40, billingMode: 'PURCHASE_ORDER' });
    expect(sampleData.seedForNewTenant).toHaveBeenCalledWith(out.id, owner.id, 'K12');
    expect(starterBoard.seedForNewTenant).toHaveBeenCalledWith(out.id, owner.id, 'K12', 'Riverside Unified');
  });

  it('refuses a taken or reserved account URL', async () => {
    const { svc } = setup();
    expect(await code(svc.createCustomer({ ...body, slug: 'acme' }, SUPER))).toEqual({ status: 409, code: 'CUSTOMER_SLUG_TAKEN' });
    expect(await code(svc.createCustomer({ ...body, slug: 'super' }, SUPER))).toEqual({ status: 409, code: 'CUSTOMER_SLUG_TAKEN' });
  });

  it('claims ONCE: signs in through first-login setup, then the link is spent', async () => {
    const { svc, db, auth } = setup();
    const out = await svc.createCustomer(body, SUPER);
    const token = out.starterLink.url.split('/claim-account/')[1];
    await expect(svc.claimPreview(token)).resolves.toMatchObject({ organizationName: 'Riverside Unified' });

    const session: any = await svc.claim(token);
    expect(session.access_token).toBe('tok');
    expect(session.user.mustSetupCredentials).toBe(true); // the dashboard renders CredentialSetupGate
    expect(auth.login.mock.calls[0][2]).toEqual({ skipPolicyGate: true });
    expect(db.s.audit.some((a) => a.action === 'CUSTOMER_STARTER_LINK_CLAIMED')).toBe(true);

    expect(await code(svc.claim(token))).toEqual({ status: 400, code: 'CLAIM_LINK_INVALID' });
    expect(await code(svc.claimPreview(token))).toEqual({ status: 410, code: 'CLAIM_LINK_USED' });
  });

  it('a link is dead once the owner has finished setup, and an ordinary staff invite token is never a claim link', async () => {
    const { svc, db } = setup();
    const out = await svc.createCustomer(body, SUPER);
    const token = out.starterLink.url.split('/claim-account/')[1];
    db.s.users.find((u) => u.tenantId === out.id)!.mustSetupCredentials = false;
    expect(await code(svc.claim(token))).toEqual({ status: 400, code: 'CLAIM_LINK_INVALID' });

    db.s.invites.push({ id: 'inv-staff', tenantId: ORG_A, email: 'teacher@acme.org', tokenHash: createHash('sha256').update('staff-token').digest('hex'), userId: null, acceptedAt: null, expiresAt: new Date(Date.now() + 1e6), createdAt: new Date() });
    expect(await code(svc.claimPreview('staff-token'))).toEqual({ status: 404, code: 'CLAIM_LINK_INVALID' });
    expect(await code(svc.claim('staff-token'))).toEqual({ status: 400, code: 'CLAIM_LINK_INVALID' });
  });

  it('re-issuing a link kills the previous one', async () => {
    const { svc, db } = setup();
    const out = await svc.createCustomer(body, SUPER);
    const first = out.starterLink.url.split('/claim-account/')[1];
    const again = await svc.issueStarterLink(out.id, SUPER);
    const second = again.url.split('/claim-account/')[1];
    expect(second).not.toBe(first);
    expect(await code(svc.claim(first))).toEqual({ status: 400, code: 'CLAIM_LINK_INVALID' });
    await expect(svc.claim(second)).resolves.toMatchObject({ access_token: 'tok' });
    expect(db.s.users.filter((u) => u.tenantId === out.id)).toHaveLength(1);
    expect(db.s.audit.find((a) => a.action === 'CUSTOMER_STARTER_LINK_ISSUED')).toMatchObject({ tenantId: out.id, userId: SUPER });
  });

  it('an expired link cannot be claimed', async () => {
    const { svc, db } = setup();
    const out = await svc.createCustomer(body, SUPER);
    const token = out.starterLink.url.split('/claim-account/')[1];
    db.s.invites.forEach((i) => (i.expiresAt = new Date(Date.now() - 1000)));
    expect(await code(svc.claimPreview(token))).toEqual({ status: 410, code: 'CLAIM_LINK_EXPIRED' });
    expect(await code(svc.claim(token))).toEqual({ status: 400, code: 'CLAIM_LINK_INVALID' });
  });
});

describe('CustomerConsoleService.billingAccount (the customer’s own Billing page)', () => {
  it('a school inside an invoice-billed district is invoice-billed: no card checkout, the district’s invoices', async () => {
    const { svc, db } = setup();
    db.addInvoice({ tenantId: ORG_A, number: 'ARC-A1', amountCents: 1234 });
    db.addInvoice({ tenantId: ORG_A, number: 'ARC-A0', status: 'VOID' });
    db.addInvoice({ tenantId: ORG_B, number: 'ARC-B1' });
    const acct = await svc.billingAccount(SCHOOL_A1);
    expect(acct).toMatchObject({ billingMode: 'INVOICE', cardCheckout: false, invoiceBilled: true, poNumber: 'PO-77' });
    expect(acct.invoices.map((i) => i.number)).toEqual(['ARC-A1']);
  });

  it('a card customer keeps checkout and sees no ledger', async () => {
    const { svc } = setup();
    await expect(svc.billingAccount(ORG_CARD)).resolves.toMatchObject({ cardCheckout: true, invoiceBilled: false, invoices: [] });
  });
});
