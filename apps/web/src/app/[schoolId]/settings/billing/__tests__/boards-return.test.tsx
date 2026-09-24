/**
 * Back from buying AI boards on Stripe's page (2026-09-23).
 *
 * BillingController.aiPackCheckout sends the buyer back to `/{slug}/settings/billing?boards=success`
 * (or `?boards=cancelled`) — pinned in ai-boards-producer.test.ts. The page says what happened, next
 * to the boards-left line itself, read fresh; and because Stripe's webhook credits the pack a few
 * seconds after the redirect, it reads the allowance ONCE more shortly after — a single point-in-time
 * check, never a poll. Without the flag the billing page reads no allowance at all.
 *
 * The REAL page and the REAL allowance hook over a fake API answering producer-cut bodies.
 */
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { platformAllowance, type ProducedAllowance } from '../../../../../../tests/fixtures/ai-boards';

const server = { allowance: platformAllowance() as ProducedAllowance, log: [] as string[] };
const apiFetch = jest.fn(async (path: string) => {
  server.log.push(path);
  if (path === '/ai/allowance') return server.allowance;
  if (path === '/license/current') return null;
  if (path === '/license/tiers') return [];
  if (path === '/billing/invoices') return { stripeEnabled: true, invoices: [] };
  if (path === '/billing/status') return { stripeEnabled: true };
  throw new Error(`fake API: unexpected GET ${path}`);
});
jest.mock('@/lib/api-client', () => ({ apiFetch: (path: string) => apiFetch(path) }));
jest.mock('@/hooks/use-api', () => {
  const actual = jest.requireActual('@/hooks/use-api');
  return { ...actual, useTenant: () => ({ data: { name: 'Super Taco' } }) };
});
jest.mock('@/components/settings/shell/SettingsPageFrame', () => ({
  SettingsPageFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('next/navigation', () => ({ useParams: () => ({ schoolId: 'super-taco' }) }));
jest.mock('@/components/ui/app-dialog', () => ({ appAlert: jest.fn() }));

import BillingPage from '../page';

async function tick(ms = 0) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
      jest.advanceTimersByTime(0);
    }
  });
}

function renderAt(search: string) {
  window.history.replaceState({}, '', `/super-taco/settings/billing${search}`);
  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false, retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <BillingPage />
    </QueryClientProvider>,
  );
}

const allowanceReads = () => server.log.filter((p) => p === '/ai/allowance').length;

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
  apiFetch.mockClear();
  server.allowance = platformAllowance();
  server.log = [];
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
  window.history.replaceState({}, '', '/');
});

it('?boards=success: says the payment went through, shows the boards left, and reads them ONCE more after the webhook has had time', async () => {
  renderAt('?boards=success');
  await tick();
  await tick();
  const banner = screen.getByTestId('boards-returned');
  expect(banner).toHaveTextContent('Payment received. Your boards are added as soon as Stripe confirms the payment — usually within a minute.');
  expect(screen.getByTestId('ai-boards-left')).toHaveTextContent('14 of 20 boards left this month · resets Oct 1');
  expect(allowanceReads()).toBe(1);

  // The webhook lands: 30 boards bought.
  server.allowance = platformAllowance({ included: 20, used: 6, purchasedRemaining: 30 });
  await tick(5_000);
  await tick();
  expect(allowanceReads()).toBe(2);
  expect(screen.getByTestId('ai-boards-left')).toHaveTextContent('44 of 50 boards left · 30 bought · monthly boards reset Oct 1');

  // One point-in-time re-check — never a poll.
  await tick(10 * 60_000);
  expect(allowanceReads()).toBe(2);
});

it('?boards=cancelled: says nothing was charged, and reads no allowance', async () => {
  renderAt('?boards=cancelled');
  await tick();
  await tick(10_000);
  expect(screen.getByTestId('boards-returned')).toHaveTextContent("Checkout was cancelled — you weren't charged.");
  expect(screen.queryByTestId('ai-boards-left')).toBeNull();
  expect(allowanceReads()).toBe(0);
});

it('no ?boards: the billing page is exactly what it was — no banner, no allowance read', async () => {
  renderAt('');
  await tick();
  await tick(10_000);
  expect(screen.queryByTestId('boards-returned')).toBeNull();
  expect(allowanceReads()).toBe(0);
});
