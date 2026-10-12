/**
 * The VenueOS + AI plan in the dashboard (2026-10-12) — the REAL components over a fake API:
 *
 *   AiBoardsLeft     without the AI plan: the upsell line + ONE "Add AI" link to Settings → Billing
 *   AiImagesLeft     "N of M AI images left this month" on our key; nothing on the tenant's own key
 *   AiPlanUpsell     the card every refused AI surface shows: Add AI ($5) + Connect my own AI key (free)
 *   AiPlanCard       Settings → Billing → AI: on / off / trial / invoice, and the one switch
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const server: { allowance: any; summary: any; posts: Array<{ path: string; body: any }> } = {
  allowance: null,
  summary: null,
  posts: [],
};
const apiFetch = jest.fn(async (path: string, opts?: { method?: string; body?: string }) => {
  const method = (opts?.method ?? 'GET').toUpperCase();
  if (method === 'GET' && path === '/ai/allowance') return server.allowance;
  if (method === 'GET' && path === '/billing/summary') return server.summary;
  if (method === 'POST' && path === '/billing/ai-plan') {
    const body = JSON.parse(opts?.body ?? '{}');
    server.posts.push({ path, body });
    return { ok: true, aiIncluded: body.ai, changed: true };
  }
  throw new Error(`fake API: unexpected ${method} ${path}`);
});
jest.mock('@/lib/api-client', () => ({ apiFetch: (path: string, opts?: any) => apiFetch(path, opts) }));
jest.mock('next/navigation', () => ({ useParams: () => ({ schoolId: 'taco' }), usePathname: () => '/taco/settings/billing' }));
const confirms: any[] = [];
jest.mock('@/components/ui/app-dialog', () => ({
  appConfirm: async (opts: any) => (confirms.push(opts), true),
  appAlert: async () => true,
}));

import { AiBoardsLeft, AiImagesLeft } from '../AiBoardsLeft';
import { AiPlanUpsell } from '../AiPlanUpsell';
import { AiPlanCard } from '@/components/billing/AiPlanCard';

function renderWith(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

const platform = (over: Record<string, unknown> = {}) => ({
  source: 'platform',
  unlimited: false,
  boardsIncluded: 30,
  boardsUsed: 4,
  boardsPurchasedRemaining: 0,
  boardsLeft: 26,
  resetAt: '2026-11-01T00:00:00.000Z',
  screens: 3,
  packs: [],
  purchaseEnabled: true,
  plan: 'ai',
  period: 'month',
  imagesIncluded: 60,
  imagesUsed: 5,
  imagesLeft: 55,
  aiAddonMonthlyCents: 500,
  ...over,
});
const planRequired = () => ({
  source: 'none',
  unlimited: false,
  boardsIncluded: null,
  boardsUsed: null,
  boardsPurchasedRemaining: null,
  boardsLeft: null,
  resetAt: '2026-11-01T00:00:00.000Z',
  screens: null,
  packs: [],
  purchaseEnabled: false,
  reasonCode: 'AI_PLAN_REQUIRED',
  reason: 'AI is part of the VenueOS + AI plan…',
  plan: 'none',
  period: 'month',
  imagesIncluded: null,
  imagesUsed: null,
  imagesLeft: null,
  aiAddonMonthlyCents: 500,
});
const summaryBase = {
  billingReady: true,
  canManage: true,
  seatsUsed: 3,
  seatLimit: 3,
  prices: { monthlyCents: 2000, annualCents: 20000 },
  aiPrices: { monthlyCents: 2500, annualCents: 25000 },
  aiAddonMonthlyCents: 500,
};

beforeEach(() => {
  apiFetch.mockClear();
  server.allowance = platform();
  server.summary = null;
  server.posts = [];
  confirms.length = 0;
});

describe('AiBoardsLeft / AiImagesLeft', () => {
  it('without the AI plan: the upsell line and ONE "Add AI" link to the billing plans — never "Buy more"', async () => {
    server.allowance = planRequired();
    renderWith(<AiBoardsLeft onBuy={jest.fn()} />);
    const line = await screen.findByTestId('ai-boards-left');
    expect(line).toHaveTextContent('Add VenueOS AI for $5/screen/month — or connect your own AI key for free (Settings → AI).');
    expect(screen.getByTestId('ai-plan-upsell-add')).toHaveAttribute('href', '/taco/settings/billing#bill-plans');
    expect(screen.queryByRole('button', { name: 'Buy more' })).toBeNull();
  });

  it('on the AI plan: "X of Y AI images left this month"', async () => {
    renderWith(<AiImagesLeft />);
    expect(await screen.findByTestId('ai-images-left')).toHaveTextContent('55 of 60 AI images left this month · resets Nov 1');
  });

  it('a trial: images and boards are counted for the whole trial', async () => {
    server.allowance = platform({ plan: 'trial', period: 'trial', boardsIncluded: 10, boardsUsed: 2, boardsLeft: 8, imagesIncluded: 10, imagesUsed: 0, imagesLeft: 10, purchaseEnabled: false, reasonCode: 'TRIAL' });
    renderWith(
      <>
        <AiBoardsLeft />
        <AiImagesLeft />
      </>,
    );
    expect(await screen.findByTestId('ai-boards-left')).toHaveTextContent('8 of 10 AI boards left in your free trial');
    expect(await screen.findByTestId('ai-images-left')).toHaveTextContent('10 of 10 AI images left in your free trial');
  });

  it('their own key: no image count at all', async () => {
    server.allowance = { ...platform(), source: 'tenant', unlimited: true, imagesLeft: null };
    renderWith(<AiImagesLeft />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(screen.queryByTestId('ai-images-left')).toBeNull();
  });
});

describe('AiPlanUpsell', () => {
  it('names the add-on and both ways forward', () => {
    renderWith(<AiPlanUpsell addonCents={500} />);
    const card = screen.getByTestId('ai-plan-upsell');
    expect(card).toHaveTextContent("AI isn't on your plan");
    expect(card).toHaveTextContent('Add AI ($5/screen/month)');
    expect(screen.getByTestId('ai-plan-upsell-add')).toHaveAttribute('href', '/taco/settings/billing#bill-plans');
    expect(screen.getByTestId('ai-plan-upsell-own-key')).toHaveAttribute('href', '/taco/settings/ai');
  });
});

describe('AiPlanCard — Settings → Billing → AI', () => {
  it('a card plan without AI: "Add AI" → confirm naming the price → POST /billing/ai-plan { ai: true }', async () => {
    server.summary = { ...summaryBase, state: 'active', cardOnFile: true, aiIncluded: false, aiPlan: 'none' };
    renderWith(<AiPlanCard />);
    const card = await screen.findByTestId('ai-plan-card');
    expect(card).toHaveAttribute('data-plan', 'none');
    expect(card).toHaveTextContent("AI isn't on your plan");
    await act(async () => {
      fireEvent.click(screen.getByTestId('ai-plan-add'));
    });
    await waitFor(() => expect(server.posts).toEqual([{ path: '/billing/ai-plan', body: { ai: true } }]));
    expect(confirms[0].message).toContain('$5 per screen a month');
  });

  it('a card plan WITH AI: on, the counts, and "Turn off AI"', async () => {
    server.summary = { ...summaryBase, state: 'active', cardOnFile: true, aiIncluded: true, aiPlan: 'ai' };
    renderWith(<AiPlanCard />);
    const card = await screen.findByTestId('ai-plan-card');
    expect(card).toHaveTextContent('AI is on your plan');
    expect(await screen.findByTestId('ai-images-left')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByTestId('ai-plan-turn-off'));
    });
    await waitFor(() => expect(server.posts).toEqual([{ path: '/billing/ai-plan', body: { ai: false } }]));
  });

  it('a free trial: AI is included, nothing to switch', async () => {
    server.summary = { ...summaryBase, state: 'trial', aiPlan: 'trial', aiIncluded: false };
    server.allowance = platform({ plan: 'trial', period: 'trial' });
    renderWith(<AiPlanCard />);
    const card = await screen.findByTestId('ai-plan-card');
    expect(card).toHaveTextContent('AI is included in your free trial');
    expect(screen.queryByTestId('ai-plan-add')).toBeNull();
    expect(screen.queryByTestId('ai-plan-turn-off')).toBeNull();
  });

  it('invoice-billed: the account manager adds AI — no card switch', async () => {
    server.summary = { ...summaryBase, state: 'offline', aiPlan: 'none', aiIncluded: false };
    renderWith(<AiPlanCard />);
    const card = await screen.findByTestId('ai-plan-card');
    expect(card).toHaveTextContent('Contact your VenueOS account manager to add AI.');
    expect(screen.queryByTestId('ai-plan-add')).toBeNull();
  });

  it('a contributor sees the state but never the switch', async () => {
    server.summary = { ...summaryBase, canManage: false, state: 'active', cardOnFile: true, aiIncluded: false, aiPlan: 'none' };
    renderWith(<AiPlanCard />);
    await screen.findByTestId('ai-plan-card');
    expect(screen.queryByTestId('ai-plan-add')).toBeNull();
  });
});
