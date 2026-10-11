/**
 * Settings → Billing for a self-serve customer (2026-10-11): the status card
 * says where they stand and offers the one next step; back from Stripe it says
 * "You're all set"; an invoice customer never sees any of it. The REAL page
 * over a fake API.
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const TIERS = [
  { id: 'FREE_TRIAL', name: 'Free trial', blurb: '', monthlyPriceCents: 0, annualPriceCents: 0, features: [], recommended: false },
  { id: 'MONTHLY', name: 'Monthly', blurb: '', monthlyPriceCents: 2500, annualPriceCents: null, features: [], recommended: false },
  { id: 'ANNUAL', name: 'Annual', blurb: '', monthlyPriceCents: 2000, annualPriceCents: 24000, features: [], recommended: true },
];
let summary: any = null;
let account: any = null;
let license: any = null;
const apiFetch = jest.fn(async (path: string) => {
  if (path === '/license/current') return license;
  if (path === '/license/tiers') return TIERS;
  if (path === '/billing/invoices') return { stripeEnabled: true, invoices: [] };
  if (path === '/billing/status') return { stripeEnabled: true };
  if (path === '/billing/account') return account;
  if (path === '/billing/summary') return summary;
  if (path === '/ai/allowance') return null;
  throw new Error(`fake API: unexpected GET ${path}`);
});
jest.mock('@/lib/api-client', () => ({ apiFetch: (path: string) => apiFetch(path) }));
jest.mock('@/hooks/use-api', () => {
  const actual = jest.requireActual('@/hooks/use-api');
  return { ...actual, useTenant: () => ({ data: { name: 'Taco Town' } }) };
});
jest.mock('@/components/settings/shell/SettingsPageFrame', () => ({
  SettingsPageFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('next/navigation', () => ({ useParams: () => ({ schoolId: 'taco' }), usePathname: () => '/taco/settings/billing' }));
jest.mock('@/components/ui/app-dialog', () => ({ appAlert: jest.fn() }));

import BillingPage from '../page';

const card = { billingMode: 'CARD', cardCheckout: true, invoiceBilled: false, comp: false, poNumber: null, renewalDate: null, invoices: [] };
const base = { billingReady: true, canManage: true, canCheckout: true, seatsUsed: 2, seatLimit: 3, prices: { monthlyCents: 2500, annualCents: 24000 } };
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

function renderPage(search = '') {
  window.history.replaceState(null, '', `/taco/settings/billing${search}`);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><BillingPage /></QueryClientProvider>);
}
afterEach(cleanup);

it('trial: days left, screens used, Add payment — and the plan card says no charge, not "$0.00"', async () => {
  account = card;
  license = { tier: 'FREE_TRIAL', tierName: 'Free trial', seatLimit: 3, seatsUsed: 2, status: 'ACTIVE', isPilot: false, monthlyPriceCents: 0 };
  summary = { ...base, state: 'trial', daysLeft: 12, trialEndsAt: inDays(12) };
  renderPage();
  expect(await screen.findByTestId('billing-status-trial')).toHaveTextContent('12 days left in your free trial');
  expect(screen.getByTestId('billing-status-trial')).toHaveTextContent('2 of 3 screens in use');
  expect(screen.getByTestId('billing-add-payment')).toBeInTheDocument();
  expect(await screen.findByText('No charge during your free trial.')).toBeInTheDocument();
  // A trial is not a paid plan → no "Manage billing" (Stripe portal) button yet.
  expect(screen.queryByText('Manage billing')).toBeNull();
});

it('back from Stripe during the trial: "You\'re all set" with the date billing starts', async () => {
  account = card;
  license = { tier: 'ANNUAL', tierName: 'Annual', seatLimit: 2, seatsUsed: 2, status: 'ACTIVE', isPilot: false, monthlyPriceCents: 2000 };
  summary = { ...base, state: 'trial_card', cardOnFile: true, canCheckout: false, daysLeft: 9, trialEndsAt: inDays(9), period: 'annual' };
  renderPage('?checkout=success');
  expect(await screen.findByTestId('billing-all-set')).toHaveTextContent("You're all set");
  expect(screen.getByTestId('billing-all-set')).toHaveTextContent('you keep every trial day');
});

it('past due: Update card is the one action', async () => {
  account = card;
  license = { tier: 'MONTHLY', tierName: 'Monthly', seatLimit: 3, seatsUsed: 3, status: 'PAST_DUE', isPilot: false, monthlyPriceCents: 2500 };
  summary = { ...base, state: 'past_due', cardOnFile: true, canCheckout: false };
  renderPage();
  expect(await screen.findByTestId('billing-update-card')).toHaveTextContent('Update card');
});

it('INVOICE customer: no trial / card status card at all', async () => {
  account = { ...card, billingMode: 'INVOICE', cardCheckout: false, invoiceBilled: true };
  license = { tier: 'ANNUAL', seatLimit: 50, seatsUsed: 3, status: 'ACTIVE', isPilot: false };
  summary = { ...base, state: 'offline', canCheckout: false };
  renderPage();
  expect(await screen.findByText('Billed by invoice')).toBeInTheDocument();
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/billing/account'));
  expect(screen.queryByTestId('billing-status-card')).toBeNull();
  expect(screen.queryByTestId('billing-add-payment')).toBeNull();
});
