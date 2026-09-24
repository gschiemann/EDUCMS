/**
 * The AI board credit surfaces (2026-09-23), with the REAL hooks over a mocked `apiFetch` answering
 * producer-cut bodies (tests/fixtures/ai-boards.ts):
 *
 *   AiBoardsLeft    the one line — our key (+ Buy more only when a pack can be bought), their key,
 *                   nobody's key; nothing until the answer is in
 *   BuyBoardsSheet  the packs (boards + price) → POST /billing/ai-packs/checkout { pack } → the
 *                   same-tab redirect to Stripe; a refusal or a failure is said inline
 *   AiCapActions    what a refused (402) generation offers
 *   AiBoardsCard    Settings → AI: the line, Buy more, and the packs bought
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  CHECKOUT_URL,
  aiPacksBody,
  checkoutRefused,
  noKeyAllowance,
  ownKeyAllowance,
  packPurchase,
  platformAllowance,
  type ProducedAllowance,
} from '../../../../tests/fixtures/ai-boards';

interface FetchOpts {
  method?: string;
  body?: string;
}
const server = {
  allowance: platformAllowance() as ProducedAllowance,
  packs: aiPacksBody(),
  checkout: (): unknown => ({ url: CHECKOUT_URL }),
  posts: [] as Array<{ path: string; body: unknown }>,
};
const apiFetch = jest.fn(async (path: string, opts?: FetchOpts) => {
  const method = (opts?.method ?? 'GET').toUpperCase();
  if (method === 'GET' && path === '/ai/allowance') return server.allowance;
  if (method === 'GET' && path === '/billing/ai-packs') return server.packs;
  if (method === 'POST' && path === '/billing/ai-packs/checkout') {
    server.posts.push({ path, body: JSON.parse(opts?.body ?? '{}') });
    const reply = server.checkout();
    if (reply instanceof Error) throw reply;
    return reply;
  }
  throw new Error(`fake API: unexpected ${method} ${path}`);
});
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string, opts?: FetchOpts) => apiFetch(path, opts),
}));
const goToCheckout = jest.fn<boolean, [string]>(() => true);
jest.mock('@/lib/checkout-redirect', () => ({
  goToCheckout: (url: string) => goToCheckout(url),
}));

import { AiBoardsLeft, AiCapActions } from '../AiBoardsLeft';
import { BuyBoardsSheet } from '../BuyBoardsSheet';
import { AiBoardsCard } from '@/components/settings/AiBoardsCard';

function renderWith(node: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  apiFetch.mockClear();
  goToCheckout.mockClear();
  server.allowance = platformAllowance();
  server.packs = aiPacksBody();
  server.checkout = () => ({ url: CHECKOUT_URL });
  server.posts = [];
});

describe('AiBoardsLeft — one line, the same everywhere', () => {
  it('our key: "14 of 20 boards left this month · resets Oct 1" with Buy more', async () => {
    const onBuy = jest.fn();
    renderWith(<AiBoardsLeft onBuy={onBuy} />);
    const line = await screen.findByTestId('ai-boards-left');
    expect(line).toHaveTextContent('14 of 20 boards left this month · resets Oct 1');
    fireEvent.click(within(line).getByRole('button', { name: 'Buy more' }));
    expect(onBuy).toHaveBeenCalledTimes(1);
  });

  it('a surface with no pack sheet never offers Buy more', async () => {
    renderWith(<AiBoardsLeft />);
    const line = await screen.findByTestId('ai-boards-left');
    expect(within(line).queryByRole('button')).toBeNull();
  });

  it('no pack can be bought (Stripe not set up): the line says why, and offers nothing', async () => {
    server.allowance = platformAllowance({ purchase: 'STRIPE_NOT_CONFIGURED' });
    renderWith(<AiBoardsLeft onBuy={jest.fn()} />);
    const line = await screen.findByTestId('ai-boards-left');
    expect(line).toHaveTextContent("14 of 20 boards left this month · resets Oct 1 Buying more boards isn't set up on this deployment yet.");
    expect(within(line).queryByRole('button')).toBeNull();
  });

  it('their own key: no limit, nothing to buy', async () => {
    server.allowance = ownKeyAllowance();
    renderWith(<AiBoardsLeft onBuy={jest.fn()} />);
    expect(await screen.findByTestId('ai-boards-left')).toHaveTextContent('Using your own AI key — no board limit');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('nobody\'s key: where to add one', async () => {
    server.allowance = noKeyAllowance();
    renderWith(<AiBoardsLeft onBuy={jest.fn()} />);
    expect(await screen.findByTestId('ai-boards-left')).toHaveTextContent('AI runs on your own key — add it in Settings → AI provider.');
  });

  it('nothing at all until the API answers (it never stands in front of Generate)', async () => {
    let answer: (v: unknown) => void = () => {};
    apiFetch.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    renderWith(<AiBoardsLeft onBuy={jest.fn()} />);
    expect(screen.queryByTestId('ai-boards-left')).toBeNull();
    await act(async () => answer(platformAllowance()));
    expect(await screen.findByTestId('ai-boards-left')).toBeInTheDocument();
  });
});

describe('BuyBoardsSheet — one tap to Stripe', () => {
  async function openSheet() {
    const onClose = jest.fn();
    // The packs the opener already holds (GET /ai/allowance → packs) — the sheet reads nothing itself.
    renderWith(<BuyBoardsSheet packs={platformAllowance().packs} onClose={onClose} />);
    const sheet = await screen.findByRole('dialog', { name: 'Buy more boards' });
    await within(sheet).findByRole('button', { name: /30 boards/ });
    return { sheet, onClose };
  }

  it('lists the packs from the allowance — boards and price, nothing else to choose', async () => {
    const { sheet } = await openSheet();
    expect(apiFetch).not.toHaveBeenCalled(); // the opener's allowance, not a second read
    const rows = within(sheet)
      .getAllByRole('button')
      .filter((b) => /boards/.test(b.textContent ?? ''))
      .map((b) => b.textContent);
    expect(rows).toEqual(['10 boards$9', '30 boards$19', '100 boards$49']);
  });

  it('a tap asks for a checkout session for THAT pack and sends the browser to Stripe', async () => {
    const { sheet } = await openSheet();
    fireEvent.click(within(sheet).getByRole('button', { name: /30 boards/ }));
    await waitFor(() => expect(goToCheckout).toHaveBeenCalledWith(CHECKOUT_URL));
    expect(server.posts).toEqual([{ path: '/billing/ai-packs/checkout', body: { pack: 'standard' } }]);
    // The page is leaving: the row says so and nothing can be tapped twice.
    expect(within(sheet).getByRole('button', { name: /Opening checkout…/ })).toBeDisabled();
    expect(within(sheet).getByRole('button', { name: /100 boards/ })).toBeDisabled();
  });

  it.each([
    ['Stripe not set up', 'STRIPE_NOT_CONFIGURED' as const, "Buying more boards isn't set up on this deployment yet."],
    ['their own key', 'OWN_KEY' as const, 'Your boards run on your own AI key, with no limit here — there is nothing to buy.'],
  ])('the API refusing (%s) is said in the sheet; no redirect', async (_name, code, line) => {
    server.checkout = () => checkoutRefused(code);
    const { sheet } = await openSheet();
    fireEvent.click(within(sheet).getByRole('button', { name: /10 boards/ }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(line);
    expect(goToCheckout).not.toHaveBeenCalled();
    expect(within(sheet).getByRole('button', { name: /10 boards/ })).not.toBeDisabled();
  });

  it('a failed request (Stripe down: 502) says so and lets the operator try again', async () => {
    server.checkout = () => Object.assign(new Error('Stripe is not reachable.'), { status: 502, code: 'BILLING_CHECKOUT_FAILED' });
    const { sheet } = await openSheet();
    fireEvent.click(within(sheet).getByRole('button', { name: /100 boards/ }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent("Couldn't open checkout. Try again.");
    expect(goToCheckout).not.toHaveBeenCalled();
  });

  it('Close and Escape close it', async () => {
    const { sheet, onClose } = await openSheet();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('AiCapActions — what a refused generation offers', () => {
  it('Buy more boards (when a pack can be bought) and Add your own AI key', () => {
    const onBuy = jest.fn();
    renderWith(<AiCapActions canBuy onBuy={onBuy} keyHref="/super-taco/settings/ai" />);
    fireEvent.click(screen.getByRole('button', { name: 'Buy more boards' }));
    expect(onBuy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Add your own AI key' })).toHaveAttribute('href', '/super-taco/settings/ai');
  });

  it('only the key, when no pack is for sale', () => {
    renderWith(<AiCapActions canBuy={false} onBuy={jest.fn()} keyHref="/super-taco/settings/ai" />);
    expect(screen.queryByRole('button', { name: 'Buy more boards' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Add your own AI key' })).toBeInTheDocument();
  });
});

describe('AiBoardsCard — Settings → AI', () => {
  it('the line, Buy more, and every pack bought with what is left of it', async () => {
    server.allowance = platformAllowance({ included: 20, used: 20, purchasedRemaining: 24 });
    server.packs = aiPacksBody({
      purchases: [
        packPurchase({ id: 'p2', pack: 'standard', remaining: 24 }),
        packPurchase({ id: 'p1', pack: 'starter', remaining: 0, purchasedAt: '2026-08-02T15:00:00.000Z', expiresAt: '2027-08-02T15:00:00.000Z' }),
      ],
    });
    renderWith(<AiBoardsCard />);
    const card = await screen.findByTestId('ai-boards-card');
    expect(await within(card).findByTestId('ai-boards-left')).toHaveTextContent('24 of 44 boards left · 24 bought · monthly boards reset Oct 1');
    const rows = await within(card).findAllByTestId('ai-pack-purchase');
    expect(rows.map((r) => r.querySelector('p')?.textContent)).toEqual(['30 boards · $19', '10 boards · $9']);
    expect(rows[0]).toHaveTextContent('24 left · good until');
    expect(rows[1]).toHaveTextContent('all used');

    fireEvent.click(within(card).getByRole('button', { name: 'Buy more' }));
    expect(await screen.findByRole('dialog', { name: 'Buy more boards' })).toBeInTheDocument();
  });

  it('nothing bought yet, and buying is possible: says so next to Buy more', async () => {
    renderWith(<AiBoardsCard />);
    const card = await screen.findByTestId('ai-boards-card');
    expect(await within(card).findByText('No boards bought yet.')).toBeInTheDocument();
  });

  it('their own key and nothing bought: just the one line — no purchase list', async () => {
    server.allowance = ownKeyAllowance();
    server.packs = aiPacksBody({ purchase: 'OWN_KEY' });
    renderWith(<AiBoardsCard />);
    const card = await screen.findByTestId('ai-boards-card');
    expect(await within(card).findByTestId('ai-boards-left')).toHaveTextContent('Using your own AI key — no board limit');
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/billing/ai-packs', undefined));
    expect(within(card).queryByText('Bought boards')).toBeNull();
    expect(within(card).queryByText('No boards bought yet.')).toBeNull();
  });
});
