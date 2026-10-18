/**
 * CUSTOMER MANAGEMENT CONSOLE (2026-10-10) — the pure rules.
 *
 * Everything here is a function of its arguments: no Prisma, no Nest, no clock
 * unless one is passed in. The controller/service call these; the specs pin
 * them shape by shape. Keeping the policy pure is what lets the list endpoint
 * filter, sort and paginate hundreds of customers in one place that is tested
 * without a database.
 *
 * VOCABULARY
 *   customer      a top-level organisation (Tenant.parentId IS NULL). Its
 *                 schools / locations are its descendants; their paired
 *                 screens count toward its "screens in use".
 *   license       the organisation's own License row (one per tenant).
 *   billing mode  CARD (Stripe, self-serve) | INVOICE | PURCHASE_ORDER (billed
 *                 by the owner's company, ARC — no card) | COMP (free).
 */

export const BILLING_MODES = ['CARD', 'INVOICE', 'PURCHASE_ORDER', 'COMP'] as const;
export type BillingMode = (typeof BILLING_MODES)[number];

/** Plans an owner can put a customer on from the console (the self-serve catalogue's two paid plans). */
export const CONSOLE_PLANS = ['MONTHLY', 'ANNUAL'] as const;
export type ConsolePlan = (typeof CONSOLE_PLANS)[number];

/** License statuses the console's generic edit may set. SUSPENDED has its own audited endpoint. */
export const EDITABLE_STATUSES = ['ACTIVE', 'PAST_DUE', 'CANCELLED'] as const;

export const INVOICE_STATUSES = ['SENT', 'PAID', 'PAST_DUE', 'VOID'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** What the customer list shows in its Status column (and filters on). */
export const CUSTOMER_STATUSES = ['active', 'trial', 'past_due', 'suspended', 'cancelled'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

/**
 * The starter owner login's placeholder email lives on this domain. `.invalid`
 * is reserved by RFC 2606 — it can never resolve, so nothing ever mails a
 * stranger at it — and the domain is how the console recognises a starter
 * account that has not been claimed and set up yet. First-login setup
 * (POST /auth/complete-setup) replaces it with the person's own address.
 */
export const STARTER_EMAIL_DOMAIN = 'setup.venueos.invalid';

export const MAX_SEATS = 100_000;
/** $100,000 per screen per month is not a price, it is a typo. */
export const MAX_PRICE_CENTS = 10_000_000;
export const MAX_INVOICE_CENTS = 1_000_000_000;
export const MAX_NOTES = 4_000;

export const isBillingMode = (v: unknown): v is BillingMode =>
  typeof v === 'string' && (BILLING_MODES as readonly string[]).includes(v);
export const isInvoiceBilled = (mode: string | null | undefined): boolean =>
  mode === 'INVOICE' || mode === 'PURCHASE_ORDER';

export interface LicenseLike {
  packageName?: string | null;
  packagePriceCents?: number | null;
  pooledSeats?: boolean;
  tier?: string | null;
  status?: string | null;
  billingMode?: string | null;
  seatLimit?: number | null;
  monthlyPriceCents?: number | null;
  stripeSubscriptionId?: string | null;
  renewalDate?: Date | string | null;
  currentPeriodEnd?: Date | string | null;
  expiresAt?: Date | string | null;
  poNumber?: string | null;
  notes?: string | null;
  suspendedAt?: Date | string | null;
  suspendReason?: string | null;
  /** 2026-10-12 — the organisation pays for AI on our keys (the VenueOS + AI plan). */
  aiIncluded?: boolean | null;
}

/** A card subscription Stripe is still billing. Its plan, price and billing mode belong to Stripe. */
export function hasLiveCardSubscription(lic: LicenseLike | null | undefined): boolean {
  return !!lic?.stripeSubscriptionId && lic.status !== 'CANCELLED' && (lic.billingMode ?? 'CARD') === 'CARD';
}

/**
 * Whether the customer's own Billing page may offer Stripe card checkout.
 * No license at all = the self-serve default (card). Only a CARD license keeps
 * checkout; INVOICE / PURCHASE_ORDER are billed by ARC and COMP is free.
 */
export function cardCheckoutAllowed(governing: LicenseLike | null | undefined): boolean {
  if (!governing) return true;
  return (governing.billingMode ?? 'CARD') === 'CARD';
}

/** The renewal date the console shows: the contract date the owner set, else Stripe's period end, else expiry. */
export function renewalDateOf(lic: LicenseLike | null | undefined): Date | null {
  const raw = lic?.renewalDate ?? lic?.currentPeriodEnd ?? lic?.expiresAt ?? null;
  if (!raw) return null;
  const d = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** An invoice that is past due: marked so, or SENT with a due date already behind us. */
export function invoiceIsOverdue(
  inv: { status: string; dueAt?: Date | string | null },
  now: Date,
): boolean {
  if (inv.status === 'PAST_DUE') return true;
  if (inv.status !== 'SENT' || !inv.dueAt) return false;
  const due = inv.dueAt instanceof Date ? inv.dueAt : new Date(inv.dueAt);
  return !Number.isNaN(due.getTime()) && due.getTime() < now.getTime();
}

/**
 * The Status column. Suspension and cancellation are what the license says;
 * past due is the license's PAST_DUE (a card payment failed) OR an ARC invoice
 * that is overdue — the console must surface an unpaid invoice even though it
 * does not (yet) change the license; trial = no license or a pilot/trial tier.
 */
export function customerStatusOf(lic: LicenseLike | null | undefined, hasOverdueInvoice: boolean): CustomerStatus {
  if (lic?.status === 'SUSPENDED') return 'suspended';
  if (lic?.status === 'CANCELLED') return 'cancelled';
  if (lic?.status === 'PAST_DUE' || hasOverdueInvoice) return 'past_due';
  if (!lic || lic.tier === 'PILOT' || lic.tier === 'FREE_TRIAL') return 'trial';
  return 'active';
}

// ─── Input validation ──────────────────────────────────────────────────────

export class PolicyError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
  }
}

function optionalDate(v: unknown, field: string): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string' && !(v instanceof Date)) {
    throw new PolicyError('CUSTOMER_INVALID_DATE', `${field} must be a date.`);
  }
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) throw new PolicyError('CUSTOMER_INVALID_DATE', `${field} must be a date.`);
  return d;
}

function optionalText(v: unknown, field: string, max: number): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') throw new PolicyError('CUSTOMER_INVALID_TEXT', `${field} must be text.`);
  const t = v.trim();
  if (t.length > max) throw new PolicyError('CUSTOMER_TEXT_TOO_LONG', `${field} is too long (max ${max}).`);
  return t || null;
}

function intIn(v: unknown, field: string, min: number, max: number, code: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new PolicyError(code, `${field} must be a whole number from ${min} to ${max}.`);
  }
  return v;
}

/** The license fields the console may edit, validated. Absent = unchanged. */
export interface LicensePatch {
  packageName?: string | null;
  packagePriceCents?: number | null;
  pooledSeats?: boolean;
  seatLimit?: number;
  monthlyPriceCents?: number | null;
  plan?: ConsolePlan;
  billingMode?: BillingMode;
  status?: (typeof EDITABLE_STATUSES)[number];
  renewalDate?: Date | null;
  poNumber?: string | null;
  notes?: string | null;
  /** 2026-10-12 — AI on our keys for an invoice / PO / comp customer (enterprise AI toggle). */
  aiIncluded?: boolean;
}

export function parseLicensePatch(body: unknown): LicensePatch {
  if (!body || typeof body !== 'object') throw new PolicyError('CUSTOMER_BODY_REQUIRED', 'A request body is required.');
  const b = body as Record<string, unknown>;
  const out: LicensePatch = {};
  if (b.packageName !== undefined) out.packageName = optionalText(b.packageName, 'packageName', 120);
  if (b.packagePriceCents !== undefined) out.packagePriceCents = b.packagePriceCents === null ? null : intIn(b.packagePriceCents, 'packagePriceCents', 0, MAX_INVOICE_CENTS, 'CUSTOMER_PRICE_INVALID');
  if (b.pooledSeats !== undefined) {
    if (typeof b.pooledSeats !== 'boolean') throw new PolicyError('CUSTOMER_POOL_INVALID', 'pooledSeats must be true or false.');
    out.pooledSeats = b.pooledSeats;
  }
  if (b.seatLimit !== undefined) out.seatLimit = intIn(b.seatLimit, 'seatLimit', 0, MAX_SEATS, 'CUSTOMER_SEAT_LIMIT_INVALID');
  if (b.monthlyPriceCents !== undefined) {
    out.monthlyPriceCents =
      b.monthlyPriceCents === null
        ? null
        : intIn(b.monthlyPriceCents, 'monthlyPriceCents', 0, MAX_PRICE_CENTS, 'CUSTOMER_PRICE_INVALID');
  }
  if (b.plan !== undefined) {
    if (!(CONSOLE_PLANS as readonly unknown[]).includes(b.plan)) {
      throw new PolicyError('CUSTOMER_PLAN_INVALID', `plan must be one of: ${CONSOLE_PLANS.join(', ')}.`);
    }
    out.plan = b.plan as ConsolePlan;
  }
  if (b.billingMode !== undefined) {
    if (!isBillingMode(b.billingMode)) {
      throw new PolicyError('CUSTOMER_BILLING_MODE_INVALID', `billingMode must be one of: ${BILLING_MODES.join(', ')}.`);
    }
    out.billingMode = b.billingMode;
  }
  if (b.status !== undefined) {
    if (!(EDITABLE_STATUSES as readonly unknown[]).includes(b.status)) {
      throw new PolicyError(
        'CUSTOMER_STATUS_INVALID',
        `status must be one of: ${EDITABLE_STATUSES.join(', ')}. Use suspend / reactivate to suspend an organisation.`,
      );
    }
    out.status = b.status as LicensePatch['status'];
  }
  const renewal = optionalDate(b.renewalDate, 'renewalDate');
  if (renewal !== undefined) out.renewalDate = renewal;
  const po = optionalText(b.poNumber, 'poNumber', 120);
  if (po !== undefined) out.poNumber = po;
  const notes = optionalText(b.notes, 'notes', MAX_NOTES);
  if (notes !== undefined) out.notes = notes;
  if (b.aiIncluded !== undefined) {
    if (typeof b.aiIncluded !== 'boolean') {
      throw new PolicyError('CUSTOMER_AI_INVALID', 'aiIncluded must be true or false.');
    }
    out.aiIncluded = b.aiIncluded;
  }
  if (Object.keys(out).length === 0) throw new PolicyError('CUSTOMER_NOTHING_TO_CHANGE', 'Nothing to change.');
  return out;
}

/**
 * Rules that depend on the CURRENT license, applied after parsing.
 *  - A live Stripe card subscription owns its plan, price and billing mode:
 *    changing them here would be silently overwritten by the next webhook (or,
 *    for billing mode, leave Stripe charging a card for an "invoice" customer).
 *    Cancel the subscription in Stripe first.
 */
export function assertPatchAllowed(current: LicenseLike | null, patch: LicensePatch): void {
  if (!hasLiveCardSubscription(current)) return;
  if (patch.billingMode !== undefined && patch.billingMode !== 'CARD') {
    throw new PolicyError(
      'CUSTOMER_CARD_SUBSCRIPTION_ACTIVE',
      'This customer has a live card subscription in Stripe. Cancel it in Stripe before moving them to invoice, purchase order or comp billing.',
      409,
    );
  }
  if (patch.plan !== undefined || patch.monthlyPriceCents !== undefined || patch.packageName !== undefined || patch.packagePriceCents !== undefined || patch.pooledSeats !== undefined || patch.seatLimit !== undefined) {
    throw new PolicyError(
      'CUSTOMER_STRIPE_MANAGED',
      'Plan and price for a card customer come from their Stripe subscription. Change them in Stripe.',
      409,
    );
  }
  // 2026-10-12 — a card customer's AI comes from the PRICE they pay for (the webhook stamps it):
  // a console toggle would be overwritten by the next subscription event, or hand out AI unpaid.
  if (patch.aiIncluded !== undefined) {
    throw new PolicyError(
      'CUSTOMER_STRIPE_MANAGED',
      'AI for a card customer comes from their plan (VenueOS or VenueOS + AI). They switch it on the Billing page.',
      409,
    );
  }
}

/** The License columns a patch writes. `plan` is stored in `tier` (the Stripe webhook writes MONTHLY / ANNUAL there too). */
export function licenseDataFromPatch(patch: LicensePatch): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (patch.packageName !== undefined) data.packageName = patch.packageName;
  if (patch.packagePriceCents !== undefined) data.packagePriceCents = patch.packagePriceCents;
  if (patch.pooledSeats !== undefined) data.pooledSeats = patch.pooledSeats;
  if (patch.seatLimit !== undefined) data.seatLimit = patch.seatLimit;
  if (patch.monthlyPriceCents !== undefined) data.monthlyPriceCents = patch.monthlyPriceCents;
  if (patch.plan !== undefined) data.tier = patch.plan;
  if (patch.billingMode !== undefined) data.billingMode = patch.billingMode;
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.renewalDate !== undefined) data.renewalDate = patch.renewalDate;
  if (patch.poNumber !== undefined) data.poNumber = patch.poNumber;
  if (patch.notes !== undefined) data.notes = patch.notes;
  if (patch.aiIncluded !== undefined) data.aiIncluded = patch.aiIncluded;
  // COMP is free by definition — never leave a price on it that a report could add up.
  if (patch.billingMode === 'COMP') { data.monthlyPriceCents = 0; data.packagePriceCents = null; }
  return data;
}

/** The audited snapshot of a license — the before/after an AuditLog row carries. Never a Stripe id. */
export function licenseSnapshot(lic: LicenseLike | null | undefined): Record<string, unknown> | null {
  if (!lic) return null;
  const iso = (d: Date | string | null | undefined) =>
    d == null ? null : d instanceof Date ? d.toISOString() : new Date(d).toISOString();
  return {
    packageName: lic.packageName ?? null,
    packagePriceCents: lic.packagePriceCents ?? null,
    pooledSeats: lic.pooledSeats === true,
    tier: lic.tier ?? null,
    status: lic.status ?? null,
    billingMode: lic.billingMode ?? null,
    seatLimit: lic.seatLimit ?? null,
    monthlyPriceCents: lic.monthlyPriceCents ?? null,
    renewalDate: iso(lic.renewalDate),
    poNumber: lic.poNumber ?? null,
    notes: lic.notes ?? null,
    suspendedAt: iso(lic.suspendedAt),
    suspendReason: lic.suspendReason ?? null,
    aiIncluded: lic.aiIncluded === true,
  };
}

/** Field names whose value differs between two snapshots — the audit row names exactly what changed. */
export function changedFields(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...keys].filter((k) => JSON.stringify((before ?? {})[k] ?? null) !== JSON.stringify((after ?? {})[k] ?? null)).sort();
}

// ─── Create customer ───────────────────────────────────────────────────────

export interface CreateCustomerInput {
  packageName: string | null;
  packagePriceCents: number | null;
  pooledSeats: boolean;
  name: string;
  slug?: string;
  vertical: string;
  seatLimit: number;
  monthlyPriceCents: number | null;
  plan: ConsolePlan;
  billingMode: BillingMode;
  poNumber: string | null;
  renewalDate: Date | null;
  notes: string | null;
  displayName: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  ownerFirstName: string | null;
  ownerLastName: string | null;
}

const HEX = /^#[0-9a-f]{6}$/i;

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function parseCreateCustomer(body: unknown, isVertical: (v: string) => boolean): CreateCustomerInput {
  if (!body || typeof body !== 'object') throw new PolicyError('CUSTOMER_BODY_REQUIRED', 'A request body is required.');
  const b = body as Record<string, unknown>;
  const name = optionalText(b.name, 'name', 120);
  if (!name) throw new PolicyError('CUSTOMER_NAME_REQUIRED', 'Organization name is required.');
  const vertical = typeof b.vertical === 'string' ? b.vertical.toUpperCase() : '';
  if (!isVertical(vertical)) throw new PolicyError('CUSTOMER_VERTICAL_INVALID', 'Choose an industry.');
  const slugRaw = optionalText(b.slug, 'slug', 60);
  const slug = slugRaw ? slugify(slugRaw) : undefined;
  if (slugRaw && !slug) throw new PolicyError('CUSTOMER_SLUG_INVALID', 'The account URL needs letters or numbers.');
  const seatLimit = intIn(b.seatLimit, 'seatLimit', 0, MAX_SEATS, 'CUSTOMER_SEAT_LIMIT_INVALID');
  const billingMode = b.billingMode === undefined ? 'INVOICE' : b.billingMode;
  if (!isBillingMode(billingMode)) {
    throw new PolicyError('CUSTOMER_BILLING_MODE_INVALID', `billingMode must be one of: ${BILLING_MODES.join(', ')}.`);
  }
  const plan = b.plan === undefined ? 'ANNUAL' : b.plan;
  if (!(CONSOLE_PLANS as readonly unknown[]).includes(plan)) {
    throw new PolicyError('CUSTOMER_PLAN_INVALID', `plan must be one of: ${CONSOLE_PLANS.join(', ')}.`);
  }
  let monthlyPriceCents: number | null =
    b.monthlyPriceCents === undefined || b.monthlyPriceCents === null
      ? null
      : intIn(b.monthlyPriceCents, 'monthlyPriceCents', 0, MAX_PRICE_CENTS, 'CUSTOMER_PRICE_INVALID');
  if (billingMode === 'COMP') monthlyPriceCents = 0;
  const color = (v: unknown, field: string): string | null => {
    const t = optionalText(v, field, 7);
    if (!t) return null;
    if (!HEX.test(t)) throw new PolicyError('CUSTOMER_COLOR_INVALID', `${field} must be a #rrggbb color.`);
    return t.toLowerCase();
  };
  const packageName = optionalText(b.packageName, 'packageName', 120) ?? null;
  const packagePriceCents = b.packagePriceCents == null || billingMode === 'COMP' ? null : intIn(b.packagePriceCents, 'packagePriceCents', 0, MAX_INVOICE_CENTS, 'CUSTOMER_PRICE_INVALID');
  if (b.pooledSeats !== undefined && typeof b.pooledSeats !== 'boolean') throw new PolicyError('CUSTOMER_POOL_INVALID', 'pooledSeats must be true or false.');
  if (b.pooledSeats && billingMode === 'CARD') throw new PolicyError('CUSTOMER_POOL_BILLING_INVALID', 'Corporate pools require invoice, purchase order, or complimentary billing.');
  return {
    packageName, packagePriceCents, pooledSeats: b.pooledSeats === true,
    name,
    slug,
    vertical,
    seatLimit,
    monthlyPriceCents,
    plan: plan as ConsolePlan,
    billingMode,
    poNumber: optionalText(b.poNumber, 'poNumber', 120) ?? null,
    renewalDate: optionalDate(b.renewalDate, 'renewalDate') ?? null,
    notes: optionalText(b.notes, 'notes', MAX_NOTES) ?? null,
    displayName: optionalText(b.displayName, 'displayName', 120) ?? null,
    primaryColor: color(b.primaryColor, 'primaryColor'),
    accentColor: color(b.accentColor, 'accentColor'),
    ownerFirstName: optionalText(b.ownerFirstName, 'ownerFirstName', 80) ?? null,
    ownerLastName: optionalText(b.ownerLastName, 'ownerLastName', 80) ?? null,
  };
}

// ─── Invoices ──────────────────────────────────────────────────────────────

export interface InvoiceInput {
  number?: string;
  amountCents?: number;
  poNumber?: string | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  sentAt?: Date | null;
  dueAt?: Date | null;
  paidAt?: Date | null;
  status?: InvoiceStatus;
  notes?: string | null;
}

export function parseInvoice(body: unknown, mode: 'create' | 'update'): InvoiceInput {
  if (!body || typeof body !== 'object') throw new PolicyError('CUSTOMER_BODY_REQUIRED', 'A request body is required.');
  const b = body as Record<string, unknown>;
  const out: InvoiceInput = {};
  const number = optionalText(b.number, 'number', 60);
  if (number !== undefined) {
    if (!number) throw new PolicyError('INVOICE_NUMBER_REQUIRED', 'Invoice number is required.');
    out.number = number;
  }
  if (b.amountCents !== undefined) {
    out.amountCents = intIn(b.amountCents, 'amountCents', 0, MAX_INVOICE_CENTS, 'INVOICE_AMOUNT_INVALID');
  }
  if (b.status !== undefined) {
    if (!(INVOICE_STATUSES as readonly unknown[]).includes(b.status)) {
      throw new PolicyError('INVOICE_STATUS_INVALID', `status must be one of: ${INVOICE_STATUSES.join(', ')}.`);
    }
    out.status = b.status as InvoiceStatus;
  }
  const po = optionalText(b.poNumber, 'poNumber', 120);
  if (po !== undefined) out.poNumber = po;
  const notes = optionalText(b.notes, 'notes', MAX_NOTES);
  if (notes !== undefined) out.notes = notes;
  for (const f of ['periodStart', 'periodEnd', 'sentAt', 'dueAt', 'paidAt'] as const) {
    const d = optionalDate(b[f], f);
    if (d !== undefined) out[f] = d;
  }
  if (mode === 'create') {
    if (!out.number) throw new PolicyError('INVOICE_NUMBER_REQUIRED', 'Invoice number is required.');
    if (out.amountCents === undefined) throw new PolicyError('INVOICE_AMOUNT_INVALID', 'Amount is required.');
  } else if (Object.keys(out).length === 0) {
    throw new PolicyError('CUSTOMER_NOTHING_TO_CHANGE', 'Nothing to change.');
  }
  if (out.dueAt && out.sentAt && out.dueAt.getTime() < out.sentAt.getTime()) {
    throw new PolicyError('INVOICE_DUE_BEFORE_SENT', 'The due date cannot be before the sent date.');
  }
  return out;
}

/** Marking an invoice PAID without a paid date stamps today; any other status clears a stale paid date. */
export function normalizeInvoiceWrite(input: InvoiceInput, now: Date): InvoiceInput {
  const out = { ...input };
  if (out.status === 'PAID' && out.paidAt == null) out.paidAt = now;
  if (out.status !== undefined && out.status !== 'PAID' && out.paidAt === undefined) out.paidAt = null;
  return out;
}

// ─── List: filter / sort / paginate ────────────────────────────────────────

export interface CustomerRow {
  id: string;
  name: string;
  slug: string;
  vertical: string;
  createdAt: string;
  archived: boolean;
  plan: string | null;
  billingMode: string | null;
  licenseStatus: string | null;
  status: CustomerStatus;
  seatLimit: number | null;
  seatsUsed: number;
  locations: number;
  monthlyPriceCents: number | null;
  renewalDate: string | null;
  lastActivityAt: string | null;
  openInvoiceCents: number;
  overdueInvoices: number;
}

export interface ListQuery {
  q: string;
  vertical: string | null;
  billingMode: string | null; // a mode, or NONE (no license)
  status: CustomerStatus | null;
  plan: string | null;
  seats: 'over' | 'full' | null;
  renewal: 'due30' | 'overdue' | null;
  sort: 'name' | 'renewal' | 'seats' | 'lastActivity' | 'created';
  dir: 'asc' | 'desc';
  page: number;
  pageSize: number;
  includeArchived: boolean;
}

const SORTS = ['name', 'renewal', 'seats', 'lastActivity', 'created'] as const;

export function parseListQuery(raw: Record<string, unknown>): ListQuery {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const int = (v: unknown, dflt: number, min: number, max: number) => {
    const n = Number.parseInt(str(v), 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
  };
  const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
    (allowed as readonly string[]).includes(str(v)) ? (str(v) as T) : null;
  return {
    q: str(raw.q).slice(0, 120).toLowerCase(),
    vertical: str(raw.vertical).toUpperCase() || null,
    billingMode: oneOf(str(raw.billingMode).toUpperCase(), [...BILLING_MODES, 'NONE'] as const),
    status: oneOf(raw.status, CUSTOMER_STATUSES),
    plan: str(raw.plan).toUpperCase() || null,
    seats: oneOf(raw.seats, ['over', 'full'] as const),
    renewal: oneOf(raw.renewal, ['due30', 'overdue'] as const),
    sort: oneOf(raw.sort, SORTS) ?? 'name',
    dir: str(raw.dir) === 'desc' ? 'desc' : 'asc',
    page: int(raw.page, 1, 1, 100_000),
    pageSize: int(raw.pageSize, 25, 1, 100),
    includeArchived: str(raw.includeArchived) === '1' || str(raw.includeArchived) === 'true',
  };
}

export function filterSortPage(rows: CustomerRow[], q: ListQuery, now: Date) {
  const in30 = now.getTime() + 30 * 24 * 60 * 60 * 1000;
  const filtered = rows.filter((r) => {
    if (!q.includeArchived && r.archived) return false;
    if (q.q && !`${r.name} ${r.slug}`.toLowerCase().includes(q.q)) return false;
    if (q.vertical && r.vertical !== q.vertical) return false;
    if (q.billingMode) {
      if (q.billingMode === 'NONE' ? r.billingMode !== null : r.billingMode !== q.billingMode) return false;
    }
    if (q.status && r.status !== q.status) return false;
    if (q.plan && (r.plan ?? '') !== q.plan) return false;
    if (q.seats) {
      if (r.seatLimit == null) return false;
      if (q.seats === 'over' && !(r.seatsUsed > r.seatLimit)) return false;
      if (q.seats === 'full' && !(r.seatsUsed >= r.seatLimit)) return false;
    }
    if (q.renewal) {
      const t = r.renewalDate ? new Date(r.renewalDate).getTime() : null;
      if (t == null) return false;
      if (q.renewal === 'overdue' && !(t < now.getTime())) return false;
      if (q.renewal === 'due30' && !(t >= now.getTime() && t <= in30)) return false;
    }
    return true;
  });
  const key = (r: CustomerRow): string | number | null => {
    switch (q.sort) {
      case 'renewal': return r.renewalDate ? new Date(r.renewalDate).getTime() : null;
      case 'seats': return r.seatsUsed;
      case 'lastActivity': return r.lastActivityAt ? new Date(r.lastActivityAt).getTime() : null;
      case 'created': return new Date(r.createdAt).getTime();
      default: return r.name.toLowerCase();
    }
  };
  const sign = q.dir === 'desc' ? -1 : 1;
  filtered.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    // Rows with no value (no renewal date, never active) always sink to the bottom, either direction.
    if (ka == null && kb == null) return a.name.localeCompare(b.name);
    if (ka == null) return 1;
    if (kb == null) return -1;
    if (ka < kb) return -1 * sign;
    if (ka > kb) return 1 * sign;
    return a.name.localeCompare(b.name);
  });
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / q.pageSize));
  const page = Math.min(q.page, pages);
  const start = (page - 1) * q.pageSize;
  return { rows: filtered.slice(start, start + q.pageSize), total, page, pageSize: q.pageSize, pages };
}

// ─── Suspension gate ───────────────────────────────────────────────────────

/**
 * Routes a person in a SUSPENDED organisation can still reach. Life safety and
 * the ability to sign out / see why are never behind a billing state:
 *   - every emergency + panic-content route (trigger, all-clear, status, the
 *     /panic page's own reads) — a lockdown must fire whatever the invoice says;
 *   - /auth/* (sign out, refresh, first-login setup) and /users/me (who am I —
 *     the panic page reads it to decide whether to show the button);
 *   - health, CSRF, and the two license reads the suspended screen shows.
 * Screens are never gated at all: device principals skip the gate entirely.
 */
const SUSPENSION_EXEMPT_PREFIXES = [
  '/api/v1/emergency',
  '/api/v1/panic-content',
  '/api/v1/auth',
  '/api/v1/health',
  '/api/v1/security/csrf',
];
const SUSPENSION_EXEMPT_EXACT = ['/api/v1/users/me', '/api/v1/license/me', '/api/v1/license/current'];

export function isSuspensionExemptPath(path: string): boolean {
  const p = (path || '').split('?')[0].replace(/\/+$/, '') || '/';
  if (SUSPENSION_EXEMPT_EXACT.includes(p)) return true;
  return SUSPENSION_EXEMPT_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}
