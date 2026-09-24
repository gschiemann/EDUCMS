/**
 * The AI board credit + history hooks (use-api.ts, 2026-09-23) against the routes the API really
 * serves, with the answers cut from the producer (tests/fixtures/ai-boards.ts):
 *
 *   useAiAllowance         GET /ai/allowance — read on mount, re-read when the operator comes BACK
 *                          to the tab (the one hook that opts into that: they may just have paid on
 *                          Stripe's page), never polled
 *   useDesignerJobHistory  GET /templates/generate-designer/jobs?limit=20[&before=…] — a page at a
 *                          time with the last page's `nextBefore`, never polled, never on focus
 *   useAiBoardPacks        GET /billing/ai-packs
 *   useBuyAiBoardPack      POST /billing/ai-packs/checkout { pack } — no global toast (the sheet
 *                          answers inline)
 *   useRefreshAiBoards     re-reads the allowance and the packs — on an event, never a timer
 *
 * Mocking convention as use-designer-jobs.test.tsx: `apiFetch` mocked at `@/lib/api-client`, the
 * REAL hooks inside a real QueryClientProvider, a fake clock for "never polled".
 */
import * as fs from 'fs';
import { useEffect } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  AI_BOARDS_PRODUCER_FILES,
  CHECKOUT_URL,
  aiPacksBody,
  historyContractItem,
  historyPage,
  packPurchase,
  platformAllowance,
} from '../../../tests/fixtures/ai-boards';

interface FetchOpts {
  method?: string;
  body?: string;
}

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string, opts?: FetchOpts) => apiFetch(path, opts),
}));

import {
  useAiAllowance,
  useAiBoardPacks,
  useBuyAiBoardPack,
  useDesignerJobHistory,
  useRefreshAiBoards,
} from '../use-api';

type Hooks = {
  allowance: ReturnType<typeof useAiAllowance>;
  history: ReturnType<typeof useDesignerJobHistory>;
  packs: ReturnType<typeof useAiBoardPacks>;
  buy: ReturnType<typeof useBuyAiBoardPack>;
  refresh: ReturnType<typeof useRefreshAiBoards>;
};

function Inner({ which, expose }: { which: Array<keyof Hooks>; expose: (h: Partial<Hooks>) => void }) {
  const h: Partial<Hooks> = {
    allowance: useAiAllowance({ enabled: which.includes('allowance') }),
    history: useDesignerJobHistory(which.includes('history')),
    packs: useAiBoardPacks({ enabled: which.includes('packs') }),
    buy: useBuyAiBoardPack(),
    refresh: useRefreshAiBoards(),
  };
  useEffect(() => {
    expose(h);
  });
  return null;
}

function mount(which: Array<keyof Hooks>) {
  // The app's own query defaults (components/providers.tsx): 5-min staleTime, NO global focus
  // refetch — so "re-read on return" below is this hook's opt-in, not the library default.
  const qc = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  const hooks = {} as Hooks;
  render(
    <QueryClientProvider client={qc}>
      <Inner which={which} expose={(h) => Object.assign(hooks, h)} />
    </QueryClientProvider>,
  );
  return { qc, hooks };
}

function useFakeClock() {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
}

async function tick(ms = 0) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    for (let i = 0; i < 6; i++) {
      await Promise.resolve();
      jest.advanceTimersByTime(0);
    }
  });
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
}

const calls = () => apiFetch.mock.calls.map(([p, o]) => `${((o as FetchOpts | undefined)?.method ?? 'GET').toUpperCase()} ${p}`);

beforeEach(() => apiFetch.mockReset());
afterEach(() => {
  jest.useRealTimers();
  setVisibility('visible');
});

it('the routes the hooks call are the ones the controllers serve (drift guard)', () => {
  const templates = fs.readFileSync(AI_BOARDS_PRODUCER_FILES.controller, 'utf8');
  expect(templates).toMatch(/@Controller\('api\/v1\/templates'\)/);
  expect(templates).toMatch(/@Get\('generate-designer\/jobs'\)[\s\S]*?async listDesignerJobs\(/);
  expect(fs.readFileSync(AI_BOARDS_PRODUCER_FILES.allowanceController, 'utf8')).toMatch(
    /@Controller\('api\/v1\/ai'\)[\s\S]*?@Get\('allowance'\)/,
  );
  const billing = fs.readFileSync(AI_BOARDS_PRODUCER_FILES.billingController, 'utf8');
  expect(billing).toMatch(/@Controller\('api\/v1\/billing'\)[\s\S]*?@Get\('ai-packs'\)[\s\S]*?@Post\('ai-packs\/checkout'\)/);
});

describe('useAiAllowance', () => {
  it('reads GET /ai/allowance when it mounts, and never polls it', async () => {
    useFakeClock();
    apiFetch.mockResolvedValue(platformAllowance());
    const { hooks } = mount(['allowance']);
    await tick();
    expect(calls()).toEqual(['GET /ai/allowance']);
    expect(hooks.allowance.data?.boardsLeft).toBe(14);
    await tick(30 * 60_000);
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('coming BACK to the tab re-reads it (the pack just paid for on Stripe\'s page) — this hook only', async () => {
    useFakeClock();
    let left = 14;
    apiFetch.mockImplementation(async (path: string) =>
      path === '/ai/allowance' ? platformAllowance({ included: 20, used: 20 - left }) : historyPage([]),
    );
    const { hooks } = mount(['allowance', 'history']);
    await tick();
    expect(calls().sort()).toEqual(['GET /ai/allowance', 'GET /templates/generate-designer/jobs?limit=20']);

    left = 44; // the webhook credited a pack while the operator was away
    setVisibility('hidden');
    await tick(60_000);
    expect(apiFetch).toHaveBeenCalledTimes(2); // nothing while hidden
    setVisibility('visible');
    await tick();
    // The allowance is read again; the history (and everything else) is not.
    expect(calls().filter((c) => c === 'GET /ai/allowance')).toHaveLength(2);
    expect(calls().filter((c) => c.startsWith('GET /templates/'))).toHaveLength(1);
    expect(hooks.allowance.data?.boardsLeft).toBe(44);
  });

  it('a failed read is retried once, then left alone (the line just does not show)', async () => {
    useFakeClock();
    apiFetch.mockRejectedValue(Object.assign(new Error('Internal server error'), { status: 500 }));
    const { hooks } = mount(['allowance']);
    await tick();
    await tick(5_000);
    await tick(30_000);
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(hooks.allowance.data).toBeUndefined();
  });
});

describe('useDesignerJobHistory', () => {
  it('pages newest-first with the last page\'s nextBefore — passed back verbatim — and stops at the last page', async () => {
    const first = historyPage(
      [historyContractItem({ id: 'job-3', createdAt: '2026-09-22T10:00:00.000Z' }), historyContractItem({ id: 'job-2', createdAt: '2026-09-21T10:00:00.000Z' })],
      '2026-09-21T10:00:00.000Z',
    );
    const second = historyPage([historyContractItem({ id: 'job-1', createdAt: '2026-09-20T10:00:00.000Z' })]);
    apiFetch.mockImplementation(async (path: string) => (path.includes('before=') ? second : first));
    const { hooks } = mount(['history']);
    await waitFor(() => expect(hooks.history.hasNextPage).toBe(true));
    expect(calls()).toEqual(['GET /templates/generate-designer/jobs?limit=20']);
    await act(async () => {
      await hooks.history.fetchNextPage();
    });
    expect(calls()[1]).toBe('GET /templates/generate-designer/jobs?limit=20&before=2026-09-21T10%3A00%3A00.000Z');
    await waitFor(() =>
      expect(hooks.history.data?.pages.flatMap((p) => p.items.map((i) => i.id))).toEqual(['job-3', 'job-2', 'job-1']),
    );
    expect(hooks.history.hasNextPage).toBe(false);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('is read only while its list is open (enabled), and never polled', async () => {
    useFakeClock();
    apiFetch.mockResolvedValue(historyPage([]));
    mount([]);
    await tick(60_000);
    expect(apiFetch).not.toHaveBeenCalled();
    mount(['history']);
    await tick();
    await tick(30 * 60_000);
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});

describe('packs', () => {
  it('useAiBoardPacks reads GET /billing/ai-packs', async () => {
    apiFetch.mockResolvedValue(aiPacksBody({ purchases: [packPurchase({ remaining: 24 })] }));
    const { hooks } = mount(['packs']);
    await waitFor(() => expect(hooks.packs.data?.purchases[0].remaining).toBe(24));
    expect(calls()).toEqual(['GET /billing/ai-packs']);
  });

  it('useBuyAiBoardPack POSTs { pack } to the checkout route, answers the Stripe URL, and raises no global toast', async () => {
    apiFetch.mockResolvedValue({ url: CHECKOUT_URL });
    const { qc, hooks } = mount([]);
    let res: unknown;
    await act(async () => {
      res = await hooks.buy.mutateAsync({ pack: 'standard' });
    });
    expect(calls()).toEqual(['POST /billing/ai-packs/checkout']);
    expect(JSON.parse((apiFetch.mock.calls[0][1] as FetchOpts).body!)).toEqual({ pack: 'standard' });
    expect(res).toEqual({ url: CHECKOUT_URL });
    expect(qc.getMutationCache().getAll().pop()?.options.meta).toEqual({ suppressGlobalError: true });
  });

  it('useRefreshAiBoards re-reads the allowance and the packs — the history is not touched', async () => {
    apiFetch.mockImplementation(async (path: string) =>
      path === '/ai/allowance' ? platformAllowance() : path === '/billing/ai-packs' ? aiPacksBody() : historyPage([]),
    );
    const { hooks } = mount(['allowance', 'packs', 'history']);
    await waitFor(() => expect(hooks.packs.data).toBeDefined());
    await waitFor(() => expect(hooks.allowance.data).toBeDefined());
    await waitFor(() => expect(hooks.history.data).toBeDefined());
    expect(calls().sort()).toEqual(['GET /ai/allowance', 'GET /billing/ai-packs', 'GET /templates/generate-designer/jobs?limit=20']);
    act(() => {
      hooks.refresh();
    });
    await waitFor(() => expect(calls().filter((c) => c === 'GET /ai/allowance')).toHaveLength(2));
    await waitFor(() => expect(calls().filter((c) => c === 'GET /billing/ai-packs')).toHaveLength(2));
    expect(calls().filter((c) => c.startsWith('GET /templates/'))).toHaveLength(1);
  });
});
