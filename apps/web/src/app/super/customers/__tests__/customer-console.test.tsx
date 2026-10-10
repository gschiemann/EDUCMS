/**
 * Customer management console (2026-10-10) — the roster and the customer page, rendered for real
 * over a fake API. Proves: owner-only gate, server-side filters reach the query string (no
 * client-side filtering of a full list), no polling, license edit sends the right PATCH, suspend
 * goes through the confirm dialog, invoices only offered for invoice-billed customers, and the
 * one-time owner link is shown with a copy button.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CustomerDetail, CustomerListResponse } from '@/lib/customer-console';
import { formatCents, listQueryString, DEFAULT_FILTERS, parseDollarsToCents, monthlyBillCents, seatTone } from '@/lib/customer-console';

const calls: Array<{ path: string; method: string; body?: any }> = [];
let role = 'SUPER_ADMIN';
const LIST: CustomerListResponse = {
  total: 2, page: 1, pageSize: 25, pages: 1,
  rows: [
    { id: 'c1', name: 'Acme Schools', slug: 'acme', vertical: 'K12', createdAt: '2026-01-01T00:00:00Z', archived: false, plan: 'ANNUAL', billingMode: 'INVOICE', licenseStatus: 'ACTIVE', status: 'past_due', seatLimit: 5, seatsUsed: 6, locations: 2, monthlyPriceCents: 2000, renewalDate: '2027-07-01T00:00:00Z', lastActivityAt: null, openInvoiceCents: 5000, overdueInvoices: 1 },
    { id: 'c2', name: 'Card Cafe', slug: 'card-cafe', vertical: 'QSR', createdAt: '2026-01-01T00:00:00Z', archived: false, plan: 'MONTHLY', billingMode: 'CARD', licenseStatus: 'ACTIVE', status: 'active', seatLimit: 10, seatsUsed: 2, locations: 0, monthlyPriceCents: 2500, renewalDate: null, lastActivityAt: '2026-10-01T00:00:00Z', openInvoiceCents: 0, overdueInvoices: 0 },
  ],
};
const DETAIL: CustomerDetail = {
  id: 'c1', name: 'Acme Schools', slug: 'acme', vertical: 'K12', createdAt: '2026-01-01T00:00:00Z', archived: false, status: 'active', seatsUsed: 6,
  license: { plan: 'ANNUAL', status: 'ACTIVE', billingMode: 'INVOICE', seatLimit: 5, monthlyPriceCents: 2000, renewalDate: null, contractRenewalDate: null, poNumber: 'PO-1', notes: null, suspendedAt: null, suspendReason: null, stripeManaged: false },
  cardCheckout: false, locations: [], admins: [],
  starterLogin: { state: 'pending', createdAt: null, expiresAt: '2026-10-17T00:00:00Z', claimedAt: null, ownerEmail: null },
  invoices: [{ id: 'i1', number: 'ARC-1', amountCents: 12000, currency: 'usd', poNumber: 'PO-1', periodStart: null, periodEnd: null, sentAt: '2026-10-01T00:00:00Z', dueAt: '2026-10-05T00:00:00Z', paidAt: null, status: 'SENT', overdue: true, notes: null }],
  branding: null, activity: [],
};

const apiFetch = jest.fn(async (path: string, opts: any = {}) => {
  calls.push({ path, method: opts.method ?? 'GET', body: opts.body ? JSON.parse(opts.body) : undefined });
  if (path.startsWith('/super/customers?') || path === '/super/customers') return LIST;
  if (path === '/super/customers/c1') return DETAIL;
  if (path === '/super/customers/c1/starter-link') return { url: 'https://app.test/claim-account/TOKEN', expiresAt: '2026-10-17T00:00:00Z' };
  return { ok: true };
});
jest.mock('@/lib/api-client', () => ({ apiFetch: (p: string, o?: any) => apiFetch(p, o) }));
jest.mock('@/lib/store', () => ({ useAppStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'u', role } }) }));
const appConfirm = jest.fn(async () => true);
const appPrompt = jest.fn(async () => 'Unpaid');
jest.mock('@/components/ui/app-dialog', () => ({ appConfirm: (o: any) => appConfirm(o), appPrompt: (o: any) => appPrompt(o) }));
jest.mock('next/navigation', () => ({ useParams: () => ({ id: 'c1' }), useRouter: () => ({ push: jest.fn() }) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));

import CustomersPage from '../page';
import { CustomerView } from '@/components/super/customers/CustomerDetailView';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  calls.length = 0;
  role = 'SUPER_ADMIN';
  jest.useRealTimers();
});
afterEach(cleanup);

describe('pure helpers', () => {
  it('sends only non-default filters', () => {
    expect(listQueryString(DEFAULT_FILTERS)).toBe('');
    expect(listQueryString({ ...DEFAULT_FILTERS, q: 'ac', status: 'suspended', page: 2 })).toBe('?q=ac&status=suspended&page=2');
  });
  it('parses dollars, monthly bill and seat tone', () => {
    expect(parseDollarsToCents('$1,200.50')).toBe(120050);
    expect(parseDollarsToCents('')).toBeNull();
    expect(parseDollarsToCents('12.345')).toBe('invalid');
    expect(monthlyBillCents({ seatsUsed: 3, monthlyPriceCents: 2000, billingMode: 'INVOICE' })).toBe(6000);
    expect(monthlyBillCents({ seatsUsed: 3, monthlyPriceCents: 2000, billingMode: 'COMP' })).toBe(0);
    expect(seatTone(6, 5)).toBe('bad');
    expect(seatTone(5, 5)).toBe('warn');
    expect(formatCents(12000)).toBe('$120.00');
  });
});

describe('/super/customers roster', () => {
  it('is owner-only and makes no request for anyone else', async () => {
    role = 'DISTRICT_ADMIN';
    wrap(<CustomersPage />);
    expect(await screen.findByText('Owner-only area')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('renders rows with screens vs licenses, status, billing, and an overdue note', async () => {
    wrap(<CustomersPage />);
    const rows = await screen.findAllByTestId('customer-row');
    expect(rows).toHaveLength(2);
    const acme = within(rows[0]);
    expect(acme.getByText('Acme Schools')).toHaveAttribute('href', '/super/customers/c1');
    expect(acme.getByText('6 / 5')).toBeInTheDocument();
    expect(acme.getByText('Past due')).toBeInTheDocument();
    expect(acme.getByText('Invoice (ARC)')).toBeInTheDocument();
    expect(acme.getByText('1 overdue invoice')).toBeInTheDocument();
    expect(screen.getByText('2 customers')).toBeInTheDocument();
  });

  it('filters on the SERVER: a filter change is a new query string, not client filtering', async () => {
    wrap(<CustomersPage />);
    await screen.findAllByTestId('customer-row');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'suspended' } });
    await waitFor(() => expect(calls.at(-1)!.path).toBe('/super/customers?status=suspended'));
    fireEvent.change(screen.getByLabelText('Screens / licenses'), { target: { value: 'over' } });
    await waitFor(() => expect(calls.at(-1)!.path).toBe('/super/customers?status=suspended&seats=over'));
  });

  it('debounces search into one request', async () => {
    jest.useFakeTimers();
    wrap(<CustomersPage />);
    await act(async () => { jest.advanceTimersByTime(0); });
    const box = screen.getByPlaceholderText('Search by name or account URL');
    fireEvent.change(box, { target: { value: 'a' } });
    fireEvent.change(box, { target: { value: 'ac' } });
    fireEvent.change(box, { target: { value: 'acm' } });
    await act(async () => { jest.advanceTimersByTime(350); });
    jest.useRealTimers();
    await waitFor(() => expect(calls.filter((c) => c.path.includes('q=')).map((c) => c.path)).toEqual(['/super/customers?q=acm']));
  });

  it('never polls: no new request after a long wait', async () => {
    jest.useFakeTimers();
    wrap(<CustomersPage />);
    await act(async () => { jest.advanceTimersByTime(1000); });
    const n = calls.length;
    await act(async () => { jest.advanceTimersByTime(10 * 60_000); });
    expect(calls.length).toBe(n);
  });
});

describe('customer page', () => {
  it('saves the license with one PATCH carrying the edited fields', async () => {
    wrap(<CustomerView c={DETAIL} />);
    fireEvent.change(screen.getByLabelText('Screen licenses'), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('Price per screen / month (USD)'), { target: { value: '18.50' } });
    fireEvent.change(screen.getByLabelText('PO number'), { target: { value: 'PO-2' } });
    fireEvent.click(screen.getByText('Save changes'));
    await screen.findByText('Saved.');
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.path).toBe('/super/customers/c1/license');
    expect(patch.body).toMatchObject({ seatLimit: 25, monthlyPriceCents: 1850, poNumber: 'PO-2', billingMode: 'INVOICE', plan: 'ANNUAL', status: 'ACTIVE' });
  });

  it('refuses a bad price before calling the API', async () => {
    wrap(<CustomerView c={DETAIL} />);
    fireEvent.change(screen.getByLabelText('Price per screen / month (USD)'), { target: { value: 'twenty' } });
    fireEvent.click(screen.getByText('Save changes'));
    expect(await screen.findByText('Enter a price like 20 or 20.50.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('a Stripe-managed card customer cannot edit plan / price / billing method here', () => {
    wrap(<CustomerView c={{ ...DETAIL, license: { ...DETAIL.license!, billingMode: 'CARD', stripeManaged: true } }} />);
    expect(screen.getByLabelText('Price per screen / month (USD)')).toBeDisabled();
    expect(screen.getByLabelText('Billing method')).toBeDisabled();
    expect(screen.getByLabelText('Plan')).toBeDisabled();
  });

  it('suspends only after the confirm prompt, with the reason', async () => {
    wrap(<CustomerView c={DETAIL} />);
    fireEvent.click(screen.getByRole('button', { name: /Suspend/ }));
    await waitFor(() => expect(calls.some((c) => c.path === '/super/customers/c1/suspend')).toBe(true));
    expect(appPrompt).toHaveBeenCalled();
    expect(calls.find((c) => c.path === '/super/customers/c1/suspend')!.body).toEqual({ reason: 'Unpaid' });
  });

  it('records an invoice and marks one paid', async () => {
    wrap(<CustomerView c={DETAIL} />);
    expect(screen.getByText('Overdue', { exact: false })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Invoice #'), { target: { value: 'ARC-2' } });
    fireEvent.change(screen.getByLabelText('Amount (USD)'), { target: { value: '1200' } });
    fireEvent.click(screen.getByText('Add invoice'));
    await waitFor(() => expect(calls.find((c) => c.path === '/super/customers/c1/invoices')?.body).toMatchObject({ number: 'ARC-2', amountCents: 120000 }));
    fireEvent.click(screen.getByText('Mark paid'));
    await waitFor(() => expect(calls.find((c) => c.path === '/super/customers/c1/invoices/i1')?.body).toEqual({ status: 'PAID' }));
  });

  it('a card customer gets no invoice form', () => {
    wrap(<CustomerView c={{ ...DETAIL, invoices: [], license: { ...DETAIL.license!, billingMode: 'CARD' } }} />);
    expect(screen.queryByText('Add invoice')).toBeNull();
    expect(screen.getByText('Invoices are tracked for customers billed by invoice or purchase order.')).toBeInTheDocument();
  });

  it('creates a new one-time owner link and shows it with a copy button', async () => {
    wrap(<CustomerView c={DETAIL} />);
    fireEvent.click(screen.getByText('Create a new owner link'));
    const box = await screen.findByTestId('one-time-link');
    expect(within(box).getByDisplayValue('https://app.test/claim-account/TOKEN')).toBeInTheDocument();
    expect(within(box).getByText('Copy link')).toBeInTheDocument();
  });
});
