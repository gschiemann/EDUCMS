/**
 * Customer console (2026-10-10): an organisation billed by invoice / PO (through ARC) or comp'd
 * sees "billed by invoice" and NO card checkout on its own Billing page; a CARD customer's page is
 * unchanged. The REAL page over a fake API.
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const TIERS = [
  { id: 'MONTHLY', name: 'Monthly', blurb: '', monthlyPriceCents: 2500, annualPriceCents: null, features: [], recommended: false },
  { id: 'ANNUAL', name: 'Annual', blurb: '', monthlyPriceCents: null, annualPriceCents: 24000, features: [], recommended: true },
];
let account: any = null;
const apiFetch = jest.fn(async (path: string) => {
  if (path === '/license/current') return { tier: 'ANNUAL', seatLimit: 10, seatsUsed: 3, status: 'ACTIVE', isPilot: false };
  if (path === '/license/tiers') return TIERS;
  if (path === '/billing/invoices') return { stripeEnabled: true, invoices: [] };
  if (path === '/billing/status') return { stripeEnabled: true };
  if (path === '/billing/account') return account;
  if (path === '/ai/allowance') return null;
  throw new Error(`fake API: unexpected GET ${path}`);
});
jest.mock('@/lib/api-client', () => ({ apiFetch: (path: string) => apiFetch(path) }));
jest.mock('@/hooks/use-api', () => {
  const actual = jest.requireActual('@/hooks/use-api');
  return { ...actual, useTenant: () => ({ data: { name: 'Acme' } }) };
});
jest.mock('@/components/settings/shell/SettingsPageFrame', () => ({
  SettingsPageFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('next/navigation', () => ({ useParams: () => ({ schoolId: 'acme' }) }));
jest.mock('@/components/ui/app-dialog', () => ({ appAlert: jest.fn() }));

import BillingPage from '../page';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><BillingPage /></QueryClientProvider>);
}
afterEach(cleanup);

it('INVOICE: says billed by invoice, shows PO + ARC invoices, and offers no card checkout', async () => {
  account = {
    billingMode: 'INVOICE', cardCheckout: false, invoiceBilled: true, comp: false, poNumber: 'PO-77', renewalDate: '2027-07-01T00:00:00Z',
    invoices: [{ number: 'ARC-1001', amountCents: 50000, currency: 'usd', sentAt: '2026-10-01T00:00:00Z', dueAt: '2026-10-31T00:00:00Z', paidAt: null, status: 'SENT', overdue: false }],
  };
  renderPage();
  expect(await screen.findByText('Billed by invoice')).toBeInTheDocument();
  expect(screen.getByText('PO-77')).toBeInTheDocument();
  expect(screen.getByText('ARC-1001')).toBeInTheDocument();
  expect(screen.queryByText(/Choose Monthly|Choose Annual/)).toBeNull();
  expect(screen.queryByText('Manage billing')).toBeNull();
});

it('COMP: complimentary, no checkout', async () => {
  account = { billingMode: 'COMP', cardCheckout: false, invoiceBilled: false, comp: true, poNumber: null, renewalDate: null, invoices: [] };
  renderPage();
  expect(await screen.findByText('Complimentary account')).toBeInTheDocument();
  expect(screen.queryByText(/Choose Monthly|Choose Annual/)).toBeNull();
});

it('CARD: the existing Stripe checkout is still offered', async () => {
  account = { billingMode: 'CARD', cardCheckout: true, invoiceBilled: false, comp: false, poNumber: null, renewalDate: null, invoices: [] };
  renderPage();
  expect(await screen.findByText('Choose Monthly')).toBeInTheDocument();
  expect(screen.queryByTestId('offline-billing')).toBeNull();
});
