/**
 * Self-serve trial → paid (2026-10-11): the dashboard trial line, the Add
 * payment sheet and the pairing dialog's inline fix — the REAL components over
 * a fake API. Card entry is never on our pages: the sheet only ever POSTs
 * /billing/checkout and follows Stripe's URL.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let summary: any = null;
const calls: Array<{ path: string; init?: any }> = [];
const apiFetch = jest.fn(async (path: string, init?: any) => {
  calls.push({ path, init });
  if (path === '/billing/summary') return summary;
  if (path === '/billing/checkout') return { url: 'https://checkout.stripe.test/s' };
  if (path === '/billing/portal') return { url: 'https://portal.stripe.test/p' };
  if (path === '/billing/seats') return { ok: true, seatLimit: 4 };
  throw new Error(`fake API: unexpected ${path}`);
});
jest.mock('@/lib/api-client', () => ({ apiFetch: (path: string, init?: any) => apiFetch(path, init) }));
jest.mock('next/navigation', () => ({ useParams: () => ({ schoolId: 'taco' }), usePathname: () => '/taco/dashboard' }));

import { TrialStatusBar } from '../TrialStatusBar';
import { SeatLimitNotice } from '../SeatLimitNotice';

const base = {
  billingReady: true,
  canManage: true,
  canCheckout: true,
  seatsUsed: 2,
  seatLimit: 3,
  prices: { monthlyCents: 2500, annualCents: 24000 },
};
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const hrefSetter = jest.fn();
// jsdom cannot navigate; observe the hand-off to Stripe instead.
jest.mock('../billing-summary', () => ({
  ...jest.requireActual('../billing-summary'),
  goTo: (url: string) => hrefSetter(url),
}));
beforeEach(() => {
  calls.length = 0;
  hrefSetter.mockReset();
  try { window.localStorage.clear(); } catch { /* */ }
});
afterEach(cleanup);

describe('TrialStatusBar', () => {
  it('trial: "12 days left · Add payment" → sheet with Annual pre-selected, the saving, trial days kept → Stripe', async () => {
    summary = { ...base, state: 'trial', daysLeft: 12, trialEndsAt: inDays(12) };
    renderWithClient(<TrialStatusBar />);
    expect(await screen.findByText('12 days left in your free trial')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('trial-bar-add-payment'));
    const dialog = await screen.findByTestId('add-payment-dialog');
    expect(dialog).toHaveTextContent('Save $60 per screen');
    expect(screen.getByTestId('add-payment-total')).toHaveTextContent('2 screens × $240 = $480 per year');
    expect(screen.getByTestId('add-payment-total')).toHaveTextContent("You won't be charged until");
    fireEvent.click(screen.getByRole('radio', { name: /Monthly/ }));
    expect(screen.getByTestId('add-payment-total')).toHaveTextContent('2 screens × $25 = $50 per month');
    await act(async () => {
      fireEvent.click(screen.getByTestId('add-payment-continue'));
    });
    await waitFor(() => expect(hrefSetter).toHaveBeenCalledWith('https://checkout.stripe.test/s'));
    const co = calls.find((c) => c.path === '/billing/checkout')!;
    expect(JSON.parse(co.init.body)).toEqual({ billingPeriod: 'monthly' });
  });

  it('a quiet trial can be hidden until tomorrow; the last days cannot', async () => {
    summary = { ...base, state: 'trial', daysLeft: 9, trialEndsAt: inDays(9) };
    renderWithClient(<TrialStatusBar />);
    fireEvent.click(await screen.findByRole('button', { name: 'Hide until tomorrow' }));
    expect(screen.queryByTestId('trial-status-bar')).toBeNull();
    cleanup();
    summary = { ...base, state: 'trial', daysLeft: 1, trialEndsAt: inDays(1) };
    renderWithClient(<TrialStatusBar />);
    expect(await screen.findByTestId('trial-status-bar')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hide until tomorrow' })).toBeNull();
  });

  it('a contributor is told to ask an admin — no button', async () => {
    summary = { ...base, canManage: false, canCheckout: false, state: 'trial', daysLeft: 5, trialEndsAt: inDays(5) };
    renderWithClient(<TrialStatusBar />);
    expect(await screen.findByText('Ask an admin to add payment.')).toBeInTheDocument();
    expect(screen.queryByTestId('trial-bar-add-payment')).toBeNull();
  });

  it('trial ended: says screens keep playing; past due: Update card opens the Stripe portal', async () => {
    summary = { ...base, state: 'trial_ended', daysLeft: 0, trialEndsAt: inDays(-1), graceEndsAt: inDays(6) };
    renderWithClient(<TrialStatusBar />);
    expect(await screen.findByTestId('trial-status-bar')).toHaveTextContent('your screens keep playing');
    cleanup();
    summary = { ...base, state: 'past_due', cardOnFile: true };
    renderWithClient(<TrialStatusBar />);
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Update card' }));
    });
    await waitFor(() => expect(hrefSetter).toHaveBeenCalledWith('https://portal.stripe.test/p'));
  });

  it('nothing for paying, invoice-billed or legacy pilot customers', async () => {
    for (const state of ['active', 'trial_card', 'offline', 'none']) {
      summary = { ...base, state };
      const { container, unmount } = renderWithClient(<TrialStatusBar />);
      await waitFor(() => expect(calls.some((c) => c.path === '/billing/summary')).toBe(true));
      expect(container.querySelector('[data-testid="trial-status-bar"]')).toBeNull();
      unmount();
      calls.length = 0;
    }
  });

  it('billing not set up on this deploy: the sheet says so instead of a dead checkout', async () => {
    summary = { ...base, billingReady: false, canCheckout: false, state: 'trial', daysLeft: 2, trialEndsAt: inDays(2) };
    renderWithClient(<TrialStatusBar />);
    expect(await screen.findByTestId('trial-status-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('trial-bar-add-payment')).toBeNull();
    expect(screen.getByText('Details')).toBeInTheDocument();
  });
});

describe('SeatLimitNotice (pairing dialog)', () => {
  it('a full card plan: "Add 1 screen ($25/month) and pair" adds the seat, then retries the pair', async () => {
    summary = { ...base, state: 'active', period: 'monthly', cardOnFile: true };
    const retry = jest.fn();
    renderWithClient(
      <SeatLimitNotice
        error={{ code: 'LICENSE_EXHAUSTED', body: { canAddSeat: true, seatLimit: 3, perScreenMonthlyCents: 2500 } }}
        onRetry={retry}
      />,
    );
    expect(await screen.findByText('Your plan covers 3 screens')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(await screen.findByTestId('seat-add-and-pair'));
    });
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
    const seats = calls.find((c) => c.path === '/billing/seats')!;
    expect(JSON.parse(seats.init.body)).toEqual({ add: 1 });
  });

  it('trial full or ended: Add payment (no dead end)', async () => {
    summary = { ...base, state: 'trial_ended', daysLeft: 0, trialEndsAt: inDays(-1) };
    renderWithClient(<SeatLimitNotice error={{ code: 'TRIAL_ENDED' }} onRetry={jest.fn()} />);
    expect(await screen.findByText('Your free trial has ended')).toBeInTheDocument();
    fireEvent.click(await screen.findByTestId('seat-add-payment'));
    expect(await screen.findByTestId('add-payment-dialog')).toBeInTheDocument();
  });

  it('any other pairing error is left to the caller', () => {
    summary = { ...base, state: 'active' };
    const { container } = renderWithClient(<SeatLimitNotice error={{ code: 'SCREEN_PAIRING_CODE_INVALID' }} onRetry={jest.fn()} />);
    expect(container.innerHTML).toBe('');
  });
});
