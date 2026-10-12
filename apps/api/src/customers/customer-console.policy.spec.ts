import {
  assertPatchAllowed,
  cardCheckoutAllowed,
  changedFields,
  customerStatusOf,
  filterSortPage,
  invoiceIsOverdue,
  isSuspensionExemptPath,
  licenseDataFromPatch,
  normalizeInvoiceWrite,
  parseCreateCustomer,
  parseInvoice,
  parseLicensePatch,
  parseListQuery,
  PolicyError,
  type CustomerRow,
} from './customer-console.policy';

const policyCode = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as PolicyError).code;
  }
  return null;
};

describe('customer status', () => {
  it.each([
    [null, false, 'trial'],
    [{ tier: 'PILOT', status: 'ACTIVE' }, false, 'trial'],
    [{ tier: 'ANNUAL', status: 'ACTIVE' }, false, 'active'],
    [{ tier: 'ANNUAL', status: 'ACTIVE' }, true, 'past_due'],
    [{ tier: 'ANNUAL', status: 'PAST_DUE' }, false, 'past_due'],
    [{ tier: 'ANNUAL', status: 'SUSPENDED' }, true, 'suspended'],
    [{ tier: 'ANNUAL', status: 'CANCELLED' }, false, 'cancelled'],
  ])('%j overdue=%s → %s', (lic, overdue, expected) => {
    expect(customerStatusOf(lic as any, overdue)).toBe(expected);
  });
});

describe('card checkout', () => {
  it('only CARD (or no license) keeps Stripe checkout', () => {
    expect(cardCheckoutAllowed(null)).toBe(true);
    expect(cardCheckoutAllowed({ billingMode: 'CARD' })).toBe(true);
    expect(cardCheckoutAllowed({ billingMode: 'INVOICE' })).toBe(false);
    expect(cardCheckoutAllowed({ billingMode: 'PURCHASE_ORDER' })).toBe(false);
    expect(cardCheckoutAllowed({ billingMode: 'COMP' })).toBe(false);
  });
});

describe('invoices', () => {
  const now = new Date('2026-10-10T00:00:00Z');
  it('overdue = PAST_DUE, or SENT past its due date', () => {
    expect(invoiceIsOverdue({ status: 'PAST_DUE' }, now)).toBe(true);
    expect(invoiceIsOverdue({ status: 'SENT', dueAt: '2026-10-09' }, now)).toBe(true);
    expect(invoiceIsOverdue({ status: 'SENT', dueAt: '2026-10-11' }, now)).toBe(false);
    expect(invoiceIsOverdue({ status: 'SENT' }, now)).toBe(false);
    expect(invoiceIsOverdue({ status: 'PAID', dueAt: '2026-01-01' }, now)).toBe(false);
    expect(invoiceIsOverdue({ status: 'VOID', dueAt: '2026-01-01' }, now)).toBe(false);
  });

  it('create needs a number and an amount; dates must be in order', () => {
    expect(policyCode(() => parseInvoice({ amountCents: 1 }, 'create'))).toBe('INVOICE_NUMBER_REQUIRED');
    expect(policyCode(() => parseInvoice({ number: 'A' }, 'create'))).toBe('INVOICE_AMOUNT_INVALID');
    expect(policyCode(() => parseInvoice({ number: 'A', amountCents: -5 }, 'create'))).toBe('INVOICE_AMOUNT_INVALID');
    expect(policyCode(() => parseInvoice({ number: 'A', amountCents: 1, status: 'LOST' }, 'create'))).toBe('INVOICE_STATUS_INVALID');
    expect(policyCode(() => parseInvoice({ number: 'A', amountCents: 1, sentAt: '2026-10-10', dueAt: '2026-10-01' }, 'create'))).toBe('INVOICE_DUE_BEFORE_SENT');
    expect(policyCode(() => parseInvoice({}, 'update'))).toBe('CUSTOMER_NOTHING_TO_CHANGE');
  });

  it('PAID stamps a paid date; any other status clears it', () => {
    expect(normalizeInvoiceWrite({ status: 'PAID' }, now).paidAt).toEqual(now);
    expect(normalizeInvoiceWrite({ status: 'SENT' }, now).paidAt).toBeNull();
    expect(normalizeInvoiceWrite({ notes: 'x' }, now).paidAt).toBeUndefined();
  });
});

describe('license patch', () => {
  it('validates every field', () => {
    expect(policyCode(() => parseLicensePatch({}))).toBe('CUSTOMER_NOTHING_TO_CHANGE');
    expect(policyCode(() => parseLicensePatch({ seatLimit: -1 }))).toBe('CUSTOMER_SEAT_LIMIT_INVALID');
    expect(policyCode(() => parseLicensePatch({ seatLimit: 1.5 }))).toBe('CUSTOMER_SEAT_LIMIT_INVALID');
    expect(policyCode(() => parseLicensePatch({ monthlyPriceCents: 99_999_999 }))).toBe('CUSTOMER_PRICE_INVALID');
    expect(policyCode(() => parseLicensePatch({ plan: 'WEEKLY' }))).toBe('CUSTOMER_PLAN_INVALID');
    expect(policyCode(() => parseLicensePatch({ billingMode: 'CHEQUE' }))).toBe('CUSTOMER_BILLING_MODE_INVALID');
    expect(policyCode(() => parseLicensePatch({ status: 'SUSPENDED' }))).toBe('CUSTOMER_STATUS_INVALID');
    expect(policyCode(() => parseLicensePatch({ renewalDate: 'not a date' }))).toBe('CUSTOMER_INVALID_DATE');
    expect(parseLicensePatch({ renewalDate: null, poNumber: '  ' })).toEqual({ renewalDate: null, poNumber: null });
  });

  it('plan is stored in tier; COMP zeroes the price', () => {
    expect(licenseDataFromPatch({ plan: 'ANNUAL', seatLimit: 4 })).toEqual({ tier: 'ANNUAL', seatLimit: 4 });
    expect(licenseDataFromPatch({ billingMode: 'COMP' })).toEqual({ billingMode: 'COMP', monthlyPriceCents: 0 });
  });

  it('a live card subscription owns its plan, price and billing mode', () => {
    const live = { billingMode: 'CARD', status: 'ACTIVE', stripeSubscriptionId: 'sub_1' };
    expect(policyCode(() => assertPatchAllowed(live, { billingMode: 'INVOICE' }))).toBe('CUSTOMER_CARD_SUBSCRIPTION_ACTIVE');
    expect(policyCode(() => assertPatchAllowed(live, { plan: 'ANNUAL' }))).toBe('CUSTOMER_STRIPE_MANAGED');
    expect(policyCode(() => assertPatchAllowed(live, { seatLimit: 9, notes: 'x', renewalDate: null }))).toBeNull();
    // A cancelled subscription no longer owns anything.
    expect(policyCode(() => assertPatchAllowed({ ...live, status: 'CANCELLED' }, { billingMode: 'INVOICE' }))).toBeNull();
  });

  it('2026-10-12 — the enterprise AI toggle: a boolean, written to aiIncluded, audited; never on a live card plan', () => {
    expect(parseLicensePatch({ aiIncluded: true })).toEqual({ aiIncluded: true });
    expect(policyCode(() => parseLicensePatch({ aiIncluded: 'yes' }))).toBe('CUSTOMER_AI_INVALID');
    expect(licenseDataFromPatch({ aiIncluded: false })).toEqual({ aiIncluded: false });
    const live = { stripeSubscriptionId: 'sub_1', status: 'ACTIVE', billingMode: 'CARD' };
    // a card customer's AI comes from the price they pay — the console cannot hand it out unpaid
    expect(policyCode(() => assertPatchAllowed(live, { aiIncluded: true }))).toBe('CUSTOMER_STRIPE_MANAGED');
    // invoice / PO / comp: the toggle is the owner's
    expect(policyCode(() => assertPatchAllowed({ billingMode: 'INVOICE', status: 'ACTIVE' }, { aiIncluded: true }))).toBeNull();
    expect(changedFields({ aiIncluded: false }, { aiIncluded: true })).toEqual(['aiIncluded']);
  });

  it('changedFields names exactly what moved', () => {
    expect(changedFields({ a: 1, b: null, c: 'x' }, { a: 2, b: null, c: 'x', d: 1 })).toEqual(['a', 'd']);
    expect(changedFields(null, { a: 1 })).toEqual(['a']);
  });
});

describe('create customer input', () => {
  const ok = { name: 'Acme', vertical: 'gym', seatLimit: 10 };
  const isVertical = (v: string) => ['K12', 'GYM'].includes(v);
  it('defaults to annual, invoice-billed', () => {
    expect(parseCreateCustomer(ok, isVertical)).toMatchObject({ vertical: 'GYM', plan: 'ANNUAL', billingMode: 'INVOICE', monthlyPriceCents: null });
  });
  it('refuses a missing name, bad vertical, bad colour, bad slug', () => {
    expect(policyCode(() => parseCreateCustomer({ ...ok, name: '  ' }, isVertical))).toBe('CUSTOMER_NAME_REQUIRED');
    expect(policyCode(() => parseCreateCustomer({ ...ok, vertical: 'MOON' }, isVertical))).toBe('CUSTOMER_VERTICAL_INVALID');
    expect(policyCode(() => parseCreateCustomer({ ...ok, primaryColor: 'red' }, isVertical))).toBe('CUSTOMER_COLOR_INVALID');
    expect(policyCode(() => parseCreateCustomer({ ...ok, slug: '!!!' }, isVertical))).toBe('CUSTOMER_SLUG_INVALID');
  });
  it('COMP is free whatever price was typed', () => {
    expect(parseCreateCustomer({ ...ok, billingMode: 'COMP', monthlyPriceCents: 2500 }, isVertical).monthlyPriceCents).toBe(0);
  });
});

describe('list query + filter/sort/page', () => {
  const row = (over: Partial<CustomerRow>): CustomerRow => ({
    id: 'x', name: 'x', slug: 'x', vertical: 'K12', createdAt: '2026-01-01T00:00:00Z', archived: false, plan: 'ANNUAL',
    billingMode: 'INVOICE', licenseStatus: 'ACTIVE', status: 'active', seatLimit: 10, seatsUsed: 1, locations: 0,
    monthlyPriceCents: 2000, renewalDate: null, lastActivityAt: null, openInvoiceCents: 0, overdueInvoices: 0, ...over,
  });
  const now = new Date('2026-10-10T00:00:00Z');
  const rows = [
    row({ id: 'a', name: 'Alpha', renewalDate: '2026-10-20T00:00:00Z', seatsUsed: 12 }),
    row({ id: 'b', name: 'Bravo', renewalDate: '2026-09-01T00:00:00Z', billingMode: null, seatLimit: null }),
    row({ id: 'c', name: 'Charlie', renewalDate: '2027-06-01T00:00:00Z', status: 'suspended' }),
    row({ id: 'd', name: 'Delta', archived: true }),
  ];

  it('clamps paging and ignores junk', () => {
    expect(parseListQuery({ page: '-3', pageSize: '5000', sort: 'DROP TABLE', status: 'nope' })).toMatchObject({ page: 1, pageSize: 100, sort: 'name', status: null });
  });

  it('filters renewal windows, seats, billing NONE, status; hides archived', () => {
    const ids = (raw: Record<string, string>) => filterSortPage(rows, parseListQuery(raw), now).rows.map((r) => r.id);
    expect(ids({})).toEqual(['a', 'b', 'c']);
    expect(ids({ includeArchived: '1' })).toEqual(['a', 'b', 'c', 'd']);
    expect(ids({ renewal: 'due30' })).toEqual(['a']);
    expect(ids({ renewal: 'overdue' })).toEqual(['b']);
    expect(ids({ seats: 'over' })).toEqual(['a']);
    expect(ids({ billingMode: 'NONE' })).toEqual(['b']);
    expect(ids({ status: 'suspended' })).toEqual(['c']);
  });

  it('sorts with empty values last in either direction', () => {
    const ids = (raw: Record<string, string>) => filterSortPage([...rows, row({ id: 'e', name: 'Echo' })], parseListQuery(raw), now).rows.map((r) => r.id);
    expect(ids({ sort: 'renewal' })).toEqual(['b', 'a', 'c', 'e']);
    expect(ids({ sort: 'renewal', dir: 'desc' })).toEqual(['c', 'a', 'b', 'e']);
    expect(ids({ sort: 'seats', dir: 'desc' })[0]).toBe('a');
  });
});

describe('suspension exemptions', () => {
  it.each([
    ['/api/v1/emergency/trigger', true],
    ['/api/v1/emergency', true],
    ['/api/v1/emergency/screens/abc/override', true],
    ['/api/v1/panic-content/lockdown', true],
    ['/api/v1/auth/logout', true],
    ['/api/v1/auth/complete-setup', true],
    ['/api/v1/users/me', true],
    ['/api/v1/users/me?x=1', true],
    ['/api/v1/license/current', true],
    ['/api/v1/health', true],
    ['/api/v1/users', false],
    ['/api/v1/playlists', false],
    ['/api/v1/emergencyx', false],
    ['/api/v1/billing/checkout', false],
  ])('%s → %s', (path, exempt) => {
    expect(isSuspensionExemptPath(path)).toBe(exempt);
  });
});
