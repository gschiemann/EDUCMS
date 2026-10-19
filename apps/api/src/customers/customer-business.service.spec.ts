import { CustomerBusinessService } from './customer-business.service';
import { CustomerConsoleService } from './customer-console.service';
import { LicenseService } from '../license/license.service';
import { SeatChangeError } from '../billing/stripe.service';
import { FakeDb } from './customer-console.fakedb-spec';

function setup() {
  const db = new FakeDb();
  db.addTenant({ id: 'root', name: 'Root' });
  db.addTenant({ id: 'foreign', name: 'Foreign' });
  db.addTenant({ id: 'location', name: 'Location', parentId: 'root' });
  db.addLicense({
    tenantId: 'root',
    billingMode: 'CARD',
    stripeSubscriptionId: 'sub_test',
  });
  const prisma = { client: db.client } as any;
  const license = new LicenseService(prisma);
  const console = new CustomerConsoleService(
    prisma,
    {} as any,
    license,
    {} as any,
  );
  const support = { assertReach: jest.fn(async () => undefined) };
  const onboarding = {
    createInvite: jest.fn(async () => ({
      acceptUrl: '/invite',
      emailDelivered: false,
    })),
  };
  const api = {
    subscriptions: {
      retrieve: jest.fn(async () => ({
        id: 'sub_test',
        status: 'active',
        default_payment_method: {
          card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 },
        },
      })),
    },
    invoices: {
      createPreview: jest.fn(async () => ({
        amount_due: 12345,
        currency: 'usd',
        next_payment_attempt: 1900000000,
      })),
    },
    paymentMethods: { retrieve: jest.fn() },
  };
  const stripe = {
    getClient: jest.fn(() => api),
    setSeatQuantity: jest.fn(async () => ({ previous: 1, seatLimit: 2 })),
  };
  const storage = {
    upload: jest.fn(async () => 'root/invoice/random.pdf'),
    remove: jest.fn(async () => undefined),
    download: jest.fn(async () => ({ url: 'signed' })),
  };
  const email = {
    sendBillingNotice: jest.fn(async () => 'SENT'),
    isConfigured: jest.fn(() => true),
  };
  const svc = new CustomerBusinessService(
    prisma,
    console,
    license,
    onboarding as any,
    support as any,
    stripe as any,
    storage as any,
    email as any,
  );
  return { svc, db, console, support, onboarding, api, stripe, storage, email };
}
const actor = { id: 'owner', role: 'SUPER_ADMIN', tenantId: 'internal' };

describe('customer business boundaries', () => {
  it('uses masked provider truth for payment and never estimates from local contract', async () => {
    const { svc, api } = setup();
    const summary = await svc.paymentSummary('root');
    expect(summary).toMatchObject({
      state: 'available',
      card: { last4: '4242', brand: 'visa' },
      nextPayment: { amountCents: 12345, currency: 'usd' },
    });
    expect(api.invoices.createPreview).toHaveBeenCalledWith({
      subscription: 'sub_test',
    });
    expect(JSON.stringify(summary)).not.toContain('sub_test');
  });
  it('provider unavailable is explicit and not an empty success', async () => {
    const { svc, api } = setup();
    api.subscriptions.retrieve.mockRejectedValueOnce(new Error('offline'));
    expect(await svc.paymentSummary('root')).toMatchObject({
      state: 'unavailable',
      nextPayment: null,
      card: null,
    });
    api.invoices.createPreview.mockRejectedValueOnce(new Error('offline'));
    expect(await svc.paymentSummary('root')).toMatchObject({
      state: 'unavailable',
      nextPayment: null,
      card: { last4: '4242' },
    });
  });
  it('invoice accounts and unsubscribed accounts never call Stripe', async () => {
    const { svc, db, stripe } = setup();
    db.s.licenses[0].billingMode = 'INVOICE';
    expect(await svc.paymentSummary('root')).toMatchObject({
      state: 'not_applicable',
    });
    db.s.licenses[0].billingMode = 'CARD';
    db.s.licenses[0].stripeSubscriptionId = null;
    expect(await svc.paymentSummary('root')).toMatchObject({
      state: 'not_subscribed',
    });
    expect(stripe.getClient).not.toHaveBeenCalled();
  });
  it('cannot invite into another organization and consent failure prevents creating any invite', async () => {
    const { svc, onboarding, support } = setup();
    await expect(
      svc.invite(
        'root',
        { email: 'a@example.test', tenantId: 'foreign' },
        actor,
      ),
    ).rejects.toMatchObject({ status: 404 });
    support.assertReach.mockRejectedValueOnce(new Error('consent required'));
    await expect(
      svc.invite('root', { email: 'a@example.test' }, actor),
    ).rejects.toThrow('consent required');
    expect(onboarding.createInvite).not.toHaveBeenCalled();
  });
  it('delegates valid invitations to existing lifecycle with fixed admin role', async () => {
    const { svc, onboarding } = setup();
    await svc.invite(
      'root',
      { email: 'a@example.test', tenantId: 'location', role: 'SUPER_ADMIN' },
      actor,
    );
    expect(onboarding.createInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'SCHOOL_ADMIN',
        tenantId: 'location',
        inviterId: 'owner',
      }),
    );
  });
  it('cannot change a card subscription without consent and explicit proration acknowledgment', async () => {
    const { svc, stripe, support } = setup();
    await expect(
      svc.cardSeats('root', { quantity: 2 }, actor),
    ).rejects.toMatchObject({ status: 400 });
    expect(stripe.setSeatQuantity).not.toHaveBeenCalled();
    support.assertReach.mockRejectedValueOnce(new Error('consent required'));
    await expect(
      svc.cardSeats('root', { quantity: 2, confirmProration: true }, actor),
    ).rejects.toThrow('consent required');
    await expect(
      svc.cardSeats('root', { quantity: 2, confirmProration: true }, actor),
    ).resolves.toMatchObject({ seatLimit: 2, proration: 'next_invoice' });
  });
  it('refuses foreign invoice upload before storage is touched', async () => {
    const { svc, db, storage } = setup();
    const inv = db.addInvoice({ tenantId: 'foreign', number: 'INV' });
    await expect(
      svc.uploadPdf('root', inv.id, undefined, null),
    ).rejects.toMatchObject({ status: 404 });
    expect(storage.upload).not.toHaveBeenCalled();
  });
  it('uses saved invoice amount for document even if current contract changed', async () => {
    const { svc, db } = setup();
    const inv = db.addInvoice({
      tenantId: 'root',
      number: 'INV',
      amountCents: 100,
    });
    db.s.licenses[0].packagePriceCents = 999999;
    const document = await svc.invoiceDocument('root', inv.id);
    expect(document.seller.name).toBe('VenueOS');
    expect(document.lines[0]).toMatchObject({
      totalCents: 100,
      descriptionCode: 'subscription',
    });
  });
  it('emails only the existing gated starter link and reports unverified delivery honestly', async () => {
    const { svc, console, email } = setup();
    jest.spyOn(console, 'issueStarterLink').mockResolvedValueOnce({
      url: 'https://app.test/claim/single-use',
      expiresAt: '2030-01-01',
    });
    email.sendBillingNotice.mockResolvedValueOnce('SENT_UNVERIFIED');
    expect(
      await svc.emailStarterLink('root', { email: 'a@example.test' }, actor),
    ).toMatchObject({
      emailDelivered: false,
      url: 'https://app.test/claim/single-use',
    });
    expect(console.issueStarterLink).toHaveBeenCalledWith(
      'root',
      'owner',
      actor,
    );
  });
  it('refuses branding and location content changes without support consent', async () => {
    const { svc, support, db } = setup();
    support.assertReach.mockRejectedValue(new Error('consent required'));
    await expect(
      svc.updateBranding('root', { displayName: 'Changed' }, actor),
    ).rejects.toThrow('consent required');
    await expect(
      svc.createLocation('root', { name: 'Changed' }, actor),
    ).rejects.toThrow('consent required');
    expect(db.s.branding).toHaveLength(0);
    expect(db.s.tenants).toHaveLength(3);
  });
  it('cannot add a location under another customer even with a support grant', async () => {
    const { svc, db } = setup();
    await expect(
      svc.createLocation(
        'root',
        { name: 'Changed', parentId: 'foreign' },
        actor,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(db.s.tenants).toHaveLength(3);
    expect(db.s.audit).toHaveLength(0);
  });
  it('never emails a starter credential when the existing consent gate refuses it', async () => {
    const { svc, console, email } = setup();
    jest
      .spyOn(console, 'issueStarterLink')
      .mockRejectedValue(new Error('consent required'));
    await expect(
      svc.emailStarterLink('root', { email: 'a@example.test' }, actor),
    ).rejects.toThrow('consent required');
    expect(email.sendBillingNotice).not.toHaveBeenCalled();
  });
  it('preserves domain errors and hides provider error details on card quantity updates', async () => {
    const { svc, stripe } = setup();
    stripe.setSeatQuantity.mockRejectedValueOnce(
      new SeatChangeError('BILLING_SEATS_INVALID', 'Choose a valid quantity.'),
    );
    await expect(
      svc.cardSeats('root', { quantity: -1, confirmProration: true }, actor),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'BILLING_SEATS_INVALID' },
    });
    stripe.setSeatQuantity.mockRejectedValueOnce(
      new Error('provider secret details'),
    );
    await expect(
      svc.cardSeats('root', { quantity: 2, confirmProration: true }, actor),
    ).rejects.toMatchObject({
      status: 502,
      response: { code: 'CUSTOMER_CARD_CHANGE_FAILED' },
    });
    expect(stripe.setSeatQuantity).toHaveBeenCalledWith({
      tenantId: 'root',
      quantity: 2,
      actorUserId: 'owner',
    });
  });
  it('never exposes extra card fields returned by the provider', async () => {
    const { svc, api } = setup();
    api.subscriptions.retrieve.mockResolvedValueOnce({
      id: 'sub_test',
      status: 'active',
      cancel_at_period_end: true,
      default_payment_method: {
        card: {
          brand: 'visa',
          last4: '4242',
          exp_month: 12,
          exp_year: 2030,
          number: 'secret-card-number',
          cvc: 'secret-cvc',
        },
      },
    } as any);
    const result = await svc.paymentSummary('root');
    expect(result).toMatchObject({ state: 'available', nextPayment: null });
    expect(result.card).toEqual({
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2030,
    });
    expect(api.invoices.createPreview).not.toHaveBeenCalled();
  });
  it('confines customer downloads to their authenticated organization', async () => {
    const { svc, db, storage } = setup();
    const foreign = db.addInvoice({
      tenantId: 'foreign',
      number: 'FOREIGN',
      pdfStoragePath: 'foreign/path.pdf',
    });
    await expect(
      svc.ownDownloadPdf('location', foreign.id, null),
    ).rejects.toMatchObject({ status: 404 });
    expect(storage.download).not.toHaveBeenCalled();
    const own = db.addInvoice({
      tenantId: 'root',
      number: 'OWN',
      pdfStoragePath: 'root/path.pdf',
      pdfFileName: 'own.pdf',
    });
    await svc.ownDownloadPdf('location', own.id, null);
    expect(storage.download).toHaveBeenCalledWith(
      'root/path.pdf',
      'root',
      own.id,
      'own.pdf',
    );
    expect(db.s.audit).toEqual([
      expect.objectContaining({
        tenantId: 'root',
        action: 'CUSTOMER_INVOICE_PDF_DOWNLOADED',
        targetId: own.id,
      }),
    ]);
  });
  it('fails closed when audit persistence fails before signing a download', async () => {
    const { svc, db, storage } = setup();
    const own = db.addInvoice({
      tenantId: 'root',
      number: 'OWN',
      pdfStoragePath: 'root/path.pdf',
    });
    jest
      .spyOn(svc as any, 'audit')
      .mockRejectedValue(new Error('audit unavailable'));
    await expect(svc.downloadPdf('root', own.id, null)).rejects.toThrow(
      'audit unavailable',
    );
    expect(storage.download).not.toHaveBeenCalled();
  });
  it('rolls back an attachment on audit failure and removes only the new object', async () => {
    const { svc, db, storage } = setup();
    const invoice = db.addInvoice({
      tenantId: 'root',
      number: 'OWN',
      pdfStoragePath: 'old/path.pdf',
    });
    const file = {
      originalname: 'i.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from(
        '%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n',
      ),
    } as Express.Multer.File;
    jest
      .spyOn(svc as any, 'audit')
      .mockRejectedValue(new Error('audit unavailable'));
    await expect(svc.uploadPdf('root', invoice.id, file, null)).rejects.toThrow(
      'audit unavailable',
    );
    expect(db.s.invoices[0].pdfStoragePath).toBe('old/path.pdf');
    expect(storage.remove).toHaveBeenCalledWith('root/invoice/random.pdf');
    expect(storage.remove).not.toHaveBeenCalledWith('old/path.pdf');
  });
  it('commits an attachment and audit together before retiring the previous object', async () => {
    const { svc, db, storage } = setup();
    const invoice = db.addInvoice({
      tenantId: 'root',
      number: 'OWN',
      pdfStoragePath: 'old/path.pdf',
    });
    const file = {
      originalname: 'i.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from(
        '%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n',
      ),
    } as Express.Multer.File;
    await svc.uploadPdf('root', invoice.id, file, null);
    expect(db.s.invoices[0].pdfStoragePath).toBe('root/invoice/random.pdf');
    expect(db.s.audit).toEqual([
      expect.objectContaining({
        action: 'CUSTOMER_INVOICE_PDF_ATTACHED',
        targetId: invoice.id,
      }),
    ]);
    expect(storage.remove).toHaveBeenCalledWith('old/path.pdf');
  });
});
