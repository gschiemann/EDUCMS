/**
 * Customer management console (2026-10-10) — the web side's pure helpers and API shapes.
 * The API is /api/v1/super/customers/* (SUPER_ADMIN only); see
 * apps/api/src/customers/customer-console.policy.ts for the rules these mirror.
 */

export type BillingMode = 'CARD' | 'INVOICE' | 'PURCHASE_ORDER' | 'COMP';
export type CustomerStatus = 'active' | 'trial' | 'past_due' | 'suspended' | 'cancelled';
export type InvoiceStatus = 'SENT' | 'PAID' | 'PAST_DUE' | 'VOID';

export const BILLING_MODES: BillingMode[] = ['INVOICE', 'PURCHASE_ORDER', 'CARD', 'COMP'];
export const CUSTOMER_STATUSES: CustomerStatus[] = ['active', 'trial', 'past_due', 'suspended', 'cancelled'];
export const INVOICE_STATUSES: InvoiceStatus[] = ['SENT', 'PAID', 'PAST_DUE', 'VOID'];
export const PLANS = ['MONTHLY', 'ANNUAL'] as const;
/** The industries a customer can be created in (packages/api-types VERTICALS). */
export const VERTICAL_IDS = ['K12', 'GYM', 'RETAIL', 'CORPORATE', 'QSR', 'FASHION', 'BAR', 'HEALTHCARE', 'HOSPITALITY', 'RESTAURANT', 'SPORTS', 'WORSHIP'];

export interface CustomerRow {
  id: string;
  name: string;
  slug: string;
  vertical: string;
  createdAt: string;
  archived: boolean;
  plan: string | null;
  billingMode: BillingMode | null;
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

export interface CustomerListResponse {
  rows: CustomerRow[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

export interface CustomerInvoiceView {
  id: string;
  number: string;
  amountCents: number;
  currency: string;
  poNumber: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  sentAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  status: InvoiceStatus;
  overdue: boolean;
  notes: string | null;
}

export interface CustomerDetail {
  id: string;
  name: string;
  slug: string;
  vertical: string;
  createdAt: string | null;
  archived: boolean;
  status: CustomerStatus;
  seatsUsed: number;
  license: {
    plan: string;
    status: string;
    billingMode: BillingMode;
    seatLimit: number;
    monthlyPriceCents: number | null;
    renewalDate: string | null;
    contractRenewalDate: string | null;
    poNumber: string | null;
    notes: string | null;
    suspendedAt: string | null;
    suspendReason: string | null;
    stripeManaged: boolean;
  } | null;
  cardCheckout: boolean;
  locations: Array<{ id: string; name: string; slug: string; archived: boolean; seatsUsed: number }>;
  admins: Array<{ id: string; email: string | null; name: string | null; role: string; status: string; awaitingSetup: boolean; atLocation: boolean }>;
  starterLogin: { state: 'pending' | 'claimed' | 'set_up' | 'expired' | null; createdAt: string | null; expiresAt: string | null; claimedAt: string | null; ownerEmail: string | null } | null;
  invoices: CustomerInvoiceView[];
  branding: { displayName: string | null; primary: string | null; accent: string | null; logoUrl: string | null } | null;
  activity: Array<{ id: string; action: string; at: string | null; by: string | null; details: any }>;
}

export interface ListFilters {
  q: string;
  vertical: string;
  billingMode: string;
  status: string;
  plan: string;
  seats: string;
  renewal: string;
  sort: string;
  dir: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export const DEFAULT_FILTERS: ListFilters = {
  q: '', vertical: '', billingMode: '', status: '', plan: '', seats: '', renewal: '', sort: 'name', dir: 'asc', page: 1, pageSize: 25,
};

/** The list endpoint's query string — only non-default values, so URLs and cache keys stay short. */
export function listQueryString(f: ListFilters): string {
  const p = new URLSearchParams();
  const put = (k: string, v: string | number) => {
    const s = String(v).trim();
    if (s && s !== String((DEFAULT_FILTERS as any)[k])) p.set(k, s);
  };
  put('q', f.q);
  put('vertical', f.vertical);
  put('billingMode', f.billingMode);
  put('status', f.status);
  put('plan', f.plan);
  put('seats', f.seats);
  put('renewal', f.renewal);
  put('sort', f.sort);
  put('dir', f.dir);
  put('page', f.page);
  put('pageSize', f.pageSize);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function formatCents(cents: number | null | undefined, locale = 'en-US'): string {
  if (cents == null) return '—';
  return (cents / 100).toLocaleString(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}

/** "$20" / "20.50" / "" → cents. Null for empty, NaN-safe; refuses negatives. */
export function parseDollarsToCents(input: string): number | null | 'invalid' {
  const t = input.replace(/[$,\s]/g, '');
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return 'invalid';
  return Math.round(Number.parseFloat(t) * 100);
}

export function formatDate(iso: string | null | undefined, locale = 'en-US'): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** A date <input> value ("YYYY-MM-DD") from an ISO string, and back. */
export const toDateInput = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');
export const fromDateInput = (v: string) => (v ? `${v}T00:00:00.000Z` : null);

/** Monthly bill shown in the list: screens in use × price per screen. */
export function monthlyBillCents(row: Pick<CustomerRow, 'seatsUsed' | 'monthlyPriceCents' | 'billingMode'>): number | null {
  if (row.billingMode === 'COMP') return 0;
  if (row.monthlyPriceCents == null) return null;
  return row.seatsUsed * row.monthlyPriceCents;
}

export type Tone = 'good' | 'warn' | 'bad' | 'muted' | 'info';
export function statusTone(s: CustomerStatus): Tone {
  switch (s) {
    case 'active': return 'good';
    case 'trial': return 'info';
    case 'past_due': return 'warn';
    case 'suspended': return 'bad';
    default: return 'muted';
  }
}
export function seatTone(used: number, limit: number | null): Tone {
  if (limit == null) return 'muted';
  if (used > limit) return 'bad';
  if (used >= limit) return 'warn';
  return 'good';
}

export const TONE_CLASSES: Record<Tone, string> = {
  good: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  warn: 'bg-amber-50 text-amber-800 border-amber-200',
  bad: 'bg-rose-50 text-rose-800 border-rose-200',
  info: 'bg-sky-50 text-sky-800 border-sky-200',
  muted: 'bg-slate-50 text-slate-600 border-slate-200',
};

export const isInvoiceBilled = (m: string | null | undefined) => m === 'INVOICE' || m === 'PURCHASE_ORDER';
