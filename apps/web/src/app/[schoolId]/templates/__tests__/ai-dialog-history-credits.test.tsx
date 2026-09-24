/**
 * The AI dialog's board HISTORY and board CREDITS, end to end through the page (2026-09-23).
 *
 * Greg: "keep a history of the generated templates so we aren't just throwing away tokens, that way
 * they can go back to them and decide later if they want to continue tweaking them" — and "we must
 * cap it and display how many credits they have left … or allow them to buy more generations".
 *
 * The REAL TemplatesPage, with the REAL hooks for everything under test — the history list, the job
 * read that reopens a batch, Keep (create-designer), Regenerate (…/again), the allowance, the pack
 * checkout — over a fake API behind `apiFetch` that answers bodies cut from the producer
 * (tests/fixtures/ai-boards.ts: the history item is the API's own contract item; the reopened
 * batch's result is designerJobResult(<AiService output>); the allowance, packs and refusals are
 * read out of the API source). The operator's paths:
 *
 *   History → the finished batches, newest first (date, brief, N boards, Bound to, Kept as) → Show
 *   more → tap one → the SAME pick grid → Keep stamps that batch, at its own canvas → Regenerate
 *   replays it on the server → Back returns to the list.
 *
 *   The line under Generate: "14 of 20 boards left this month · resets Oct 1" → Buy more → a pack →
 *   Stripe. A batch refused for want of boards: the server's words, Buy more boards, Add your own key.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  apiFetchError,
  boardsCapReachedError,
  designerOutput,
  menuBindingIncompleteError,
  producedResult,
  type ProducedError,
} from '../../../../../tests/fixtures/designer-job';
import {
  CHECKOUT_URL,
  historyBatchResult,
  historyContractItem,
  historyPage,
  historyPlainItem,
  jobView,
  noKeyAllowance,
  ownKeyAllowance,
  platformAllowance,
  type JobViewLike,
  type ProducedAllowance,
  type ProducedHistoryItem,
} from '../../../../../tests/fixtures/ai-boards';

// ── the fake API ────────────────────────────────────────────────────────────────────────────
const server = {
  allowance: platformAllowance() as ProducedAllowance,
  /** GET generate-designer/jobs, by `before` ('' = the first page). */
  pages: new Map<string, ReturnType<typeof historyPage>>(),
  /** GET generate-designer/jobs/:id — the successive answers; the last repeats. No entry → 404. */
  jobs: new Map<string, JobViewLike[]>(),
  log: [] as string[],
  starts: [] as Array<Record<string, unknown>>,
  agains: [] as string[],
  creates: [] as Array<Record<string, unknown>>,
  checkouts: [] as Array<Record<string, unknown>>,
};
const notFound = () =>
  apiFetchError({ code: 'AI_DESIGN_JOB_NOT_FOUND', message: 'That board generation was not found.', status: 404 });
const JOB = /^\/templates\/generate-designer\/jobs\/([^/?]+)(\/again)?$/;
const apiFetch = jest.fn(async (path: string, opts?: { method?: string; body?: string }) => {
  const method = (opts?.method ?? 'GET').toUpperCase();
  const body = opts?.body ? JSON.parse(opts.body) : undefined;
  server.log.push(`${method} ${path}`);
  if (method === 'GET' && path === '/ai/allowance') return server.allowance;
  if (method === 'GET' && path.startsWith('/templates/generate-designer/jobs?')) {
    const before = new URLSearchParams(path.split('?')[1]).get('before') ?? '';
    const page = server.pages.get(before);
    if (!page) throw new Error(`fake API: no history page before=${before}`);
    return page;
  }
  if (method === 'POST' && path === '/templates/generate-designer/jobs') {
    server.starts.push(body);
    return { jobId: 'job-new', status: 'queued' };
  }
  if (method === 'POST' && path === '/templates/create-designer') {
    server.creates.push(body);
    return { id: `tpl-created-${server.creates.length}`, name: body.name };
  }
  if (method === 'POST' && path === '/billing/ai-packs/checkout') {
    server.checkouts.push(body);
    return { url: CHECKOUT_URL };
  }
  const m = JOB.exec(path);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (method === 'POST' && m[2]) {
      server.agains.push(id);
      return { jobId: `${id}-again`, status: 'queued' };
    }
    if (method === 'GET' && !m[2]) {
      const answers = server.jobs.get(id);
      if (!answers) throw notFound();
      return answers.length > 1 ? answers.shift() : answers[0];
    }
  }
  throw new Error(`fake API: unexpected ${method} ${path}`);
});
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string, opts?: { method?: string; body?: string }) => apiFetch(path, opts),
}));
const goToCheckout = jest.fn<boolean, [string]>(() => true);
jest.mock('@/lib/checkout-redirect', () => ({ goToCheckout: (url: string) => goToCheckout(url) }));

// ── the page's other data, staged; the hooks under test are REAL ─────────────────────────────
const TEMPLATES = [
  {
    id: 'tpl-kept',
    name: 'Super Taco Lunch',
    description: '',
    category: 'LOBBY',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    isSystem: false,
    status: 'ACTIVE',
    zones: [],
    createdAt: '2026-09-20T12:05:00.000Z',
    updatedAt: '2026-09-20T12:05:00.000Z',
  },
];
const refine = { reject: null as unknown };
jest.mock('@/hooks/use-api', () => {
  const actual = jest.requireActual('@/hooks/use-api');
  const noopMutation = () => ({ mutateAsync: jest.fn(), isPending: false, mutate: jest.fn() });
  return {
    useTemplates: () => ({ data: TEMPLATES, isLoading: false, isError: false, refetch: jest.fn() }),
    useTemplateUsageSummary: () => ({ data: undefined }),
    useTenantBranding: () => ({ data: null }),
    useCreateTemplate: noopMutation,
    useDeleteTemplate: noopMutation,
    useCreateFromPreset: noopMutation,
    useDuplicateTemplate: noopMutation,
    useUpdateTemplate: noopMutation,
    useUpdateTemplateZones: noopMutation,
    useApplyBrandToTemplates: noopMutation,
    useGenerateTouchTemplate: noopMutation,
    useExportTemplate: noopMutation,
    useImportTemplate: noopMutation,
    useGenerateTouchCandidates: noopMutation,
    useCreateFromCandidate: noopMutation,
    useRefineSignageBoard: noopMutation,
    useRegenerateBoardImage: noopMutation,
    useAssets: () => ({ data: [], isLoading: false }),
    usePlaylists: () => ({ data: [], isLoading: false }),
    useAssetFolders: () => ({ data: [], isLoading: false }),
    useScreens: () => ({ data: [], isLoading: false }),
    // The REAL ones.
    DESIGNER_JOB_POLL_MS: actual.DESIGNER_JOB_POLL_MS,
    useStartDesignerJob: actual.useStartDesignerJob,
    useDesignerJob: actual.useDesignerJob,
    useCancelDesignerJob: actual.useCancelDesignerJob,
    useRegenerateDesignerJob: actual.useRegenerateDesignerJob,
    useCreateDesigner: actual.useCreateDesigner,
    useDesignerJobHistory: actual.useDesignerJobHistory,
    useAiAllowance: actual.useAiAllowance,
    useRefreshAiBoards: actual.useRefreshAiBoards,
    useBuyAiBoardPack: actual.useBuyAiBoardPack,
    useAiBoardPacks: actual.useAiBoardPacks,
  };
});
jest.mock('@/hooks/use-ai-designer', () => ({
  useExtractDesignerBrief: () => ({
    mutate: (_vars: unknown, cb: { onSuccess: (r: { brief: null }) => void }) => cb.onSuccess({ brief: null }),
    mutateAsync: jest.fn(),
    isPending: false,
  }),
  useRefineDesignerBoard: () => ({
    mutateAsync: jest.fn(async () => {
      if (refine.reject) throw refine.reject;
      return { html: '<!doctype html><html><body><h1>Refined</h1>' + 'x'.repeat(300) + '</body></html>' };
    }),
    isPending: false,
  }),
  buildDesignerBriefPayload: () => undefined,
  designerBriefHasSignal: () => false,
}));
jest.mock('sonner', () => {
  const toast = Object.assign(jest.fn(), {
    error: jest.fn(),
    success: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
    message: jest.fn(),
    loading: jest.fn(),
    dismiss: jest.fn(),
    promise: jest.fn(),
  });
  return { toast, Toaster: () => null };
});
jest.mock('@/lib/put-on-screen', () => ({
  usePutOnScreen: () => ({ putOnScreen: jest.fn(), puttingOnScreenId: null }),
}));
jest.mock('next/navigation', () => ({
  useParams: () => ({ schoolId: 'super-taco' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));
jest.mock('@/hooks/use-tenant-copy', () => ({
  useTenantCopy: () => ({
    vertical: 'RESTAURANT',
    orgSingular: 'Location',
    orgPlural: 'Locations',
    templateCategories: [{ key: '', label: 'All' }],
    showSchoolLevelFilter: false,
    roleLabel: (r: string) => r,
  }),
}));
jest.mock('@/store/ui-store', () => ({
  useUIStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ user: { role: 'SCHOOL_ADMIN' }, token: 't' }),
}));
jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));
jest.mock('@/lib/feature-flags', () => ({ isFeatureEnabled: () => true, FLAGS: { TEMPLATE_BUILDER_V2: 'v2' } }));
jest.mock('@/components/ai/AiGenerateButton', () => ({ getAiStatusSource: async () => 'platform' }));
jest.mock('@/components/templates/AiIntakeWizard', () => ({ AiIntakeWizard: () => null }));
jest.mock('@/components/templates/BriefConfirmStrip', () => ({ BriefConfirmStrip: () => null }));
jest.mock('@/components/templates/SignageConcierge', () => ({
  SignageConcierge: ({ onGenerate }: { onGenerate: (a: Record<string, unknown>) => void }) => (
    <button
      type="button"
      onClick={() =>
        onGenerate({
          prompt: 'A menu board for Super Taco — tacos, burritos and drinks.',
          intake: { purpose: 'menu' },
          references: [],
          userNotes: '',
          wantsTouch: false,
        })
      }
    >
      stub-generate
    </button>
  ),
}));

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

import { DESIGNER_JOB_POLL_MS } from '@/hooks/use-api';
import TemplatesPage from '../page';

// ── harness ──────────────────────────────────────────────────────────────────────────────────
function renderPage() {
  // The app's own query defaults (components/providers.tsx).
  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <TemplatesPage />
    </QueryClientProvider>,
  );
}

async function tick(ms = 0) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
      jest.advanceTimersByTime(0);
    }
  });
}

async function openDialog() {
  renderPage();
  fireEvent.click(screen.getAllByRole('button', { name: /generate .*ai|with ai/i })[0]);
  await tick();
  expect(screen.getByText('Generate a template with AI')).toBeInTheDocument();
  await tick();
}

async function openHistory() {
  await openDialog();
  fireEvent.click(screen.getByTestId('ai-history-open'));
  await tick();
  await tick();
}

const rows = () => screen.queryAllByTestId('designer-history-row');
const boardsLine = () => screen.queryByTestId('ai-boards-left');
const count = (line: string) => server.log.filter((l) => l === line).length;
const when = (iso: string) =>
  new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

const H1 = historyContractItem({ id: 'job-h1', createdAt: '2026-09-22T09:30:00.000Z', keptTemplateId: 'tpl-kept' });
const H2: ProducedHistoryItem = {
  ...historyPlainItem({ id: 'job-h2', createdAt: '2026-09-21T16:05:00.000Z', prompt: 'A portrait welcome board for the lobby\n\nOperator’s exact words…', venueName: 'Super Taco' }),
  keptTemplateId: 'tpl-deleted', // a keep whose template was deleted since
};
const H0 = historyPlainItem({ id: 'job-h0', createdAt: '2026-09-19T08:00:00.000Z', prompt: 'Happy hour promo' });

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
  localStorage.clear();
  apiFetch.mockClear();
  goToCheckout.mockClear();
  server.allowance = platformAllowance();
  server.pages = new Map([
    ['', historyPage([H1, H2], H2.createdAt)],
    [H2.createdAt, historyPage([H0])],
  ]);
  server.jobs = new Map<string, JobViewLike[]>([
    ['job-h1', [jobView('job-h1', 'done', { result: historyBatchResult() })]],
    ['job-h2', [jobView('job-h2', 'done', { result: producedResult(designerOutput({ batchId: 'batch-h2', width: 2160, height: 3840, purpose: 'welcome' })) })]],
  ]);
  server.log = [];
  server.starts = [];
  server.agains = [];
  server.creates = [];
  server.checkouts = [];
  refine.reject = null;
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

// ── the board history ─────────────────────────────────────────────────────────────────────────
describe('History — the batches already paid for', () => {
  it('lists the finished batches newest first: when, the brief, how many boards, Bound to, Kept as — and pages with Show more', async () => {
    await openHistory();
    expect(screen.getByText('Your generated boards')).toBeInTheDocument();
    expect(count('GET /templates/generate-designer/jobs?limit=20')).toBe(1);

    const [r1, r2] = rows();
    expect(rows()).toHaveLength(2);
    expect(r1).toHaveTextContent(when(H1.createdAt));
    expect(r1).toHaveTextContent('3 boards');
    expect(r1).toHaveTextContent(H1.prompt); // the brief (the API's first 140 characters)
    expect(within(r1).getByTestId('designer-bound-badge')).toHaveTextContent('Bound to Toast · 9 items');
    expect(within(r1).getByTestId('designer-history-kept')).toHaveTextContent('Kept as Super Taco Lunch');
    // Row 2: only its brief's first line; no POS; its kept template was deleted — nothing said.
    expect(r2).toHaveTextContent('A portrait welcome board for the lobby');
    expect(r2).not.toHaveTextContent('Operator’s exact words');
    expect(within(r2).queryByTestId('designer-bound-badge')).toBeNull();
    expect(within(r2).queryByTestId('designer-history-kept')).toBeNull();
    // No board is rendered in the list (phones): the pick grid renders them when one is opened.
    expect(document.querySelectorAll('iframe')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await tick();
    await tick();
    expect(server.log).toContain(`GET /templates/generate-designer/jobs?limit=20&before=${encodeURIComponent(H2.createdAt)}`);
    expect(rows().map((r) => r.textContent)).toEqual([
      expect.stringContaining(H1.prompt),
      expect.stringContaining('A portrait welcome board'),
      expect.stringContaining('Happy hour promo'),
    ]);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();

    // Never polled.
    const reads = server.log.filter((l) => l.startsWith('GET /templates/generate-designer/jobs?')).length;
    await tick(10 * 60_000);
    expect(server.log.filter((l) => l.startsWith('GET /templates/generate-designer/jobs?')).length).toBe(reads);
  });

  it('a row reopens its batch in the SAME pick grid — and Keep stamps that batch, at the batch\'s own canvas', async () => {
    await openHistory();
    fireEvent.click(rows()[0]);
    await tick();
    await tick();
    expect(count('GET /templates/generate-designer/jobs/job-h1')).toBe(1);
    expect(screen.getByText('Pick your favorite')).toBeInTheDocument();
    for (const label of ['Rail + cards', 'Hero + cards', 'Leader rows']) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.getByTestId('designer-bound-badge')).toHaveTextContent('Bound to Toast · 9 items');

    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[1]);
    await tick();
    await tick();
    const result = historyBatchResult();
    expect(server.creates).toEqual([
      expect.objectContaining({
        name: 'Super Taco',
        screenWidth: 3840,
        screenHeight: 2160,
        batchId: result.batchId, // create-designer stamps keptTemplateId on THIS job
        candidateIndex: 1,
        artDirection: result.candidates[1].artDirection,
      }),
    ]);
    expect(server.creates[0].htmlBase64).toBe(Buffer.from(result.candidates[1].html, 'utf8').toString('base64'));
    expect(screen.getAllByText('Saved').length).toBeGreaterThan(0);
    // A done job is read once and never polled.
    await tick(10 * DESIGNER_JOB_POLL_MS);
    expect(count('GET /templates/generate-designer/jobs/job-h1')).toBe(1);
  });

  it('a batch drawn for a portrait screen is kept at its own size, whatever the dialog was set to', async () => {
    await openHistory();
    fireEvent.click(rows()[1]);
    await tick();
    await tick();
    expect(screen.getByText('Pick your favorite')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);
    await tick();
    await tick();
    expect(server.creates[0]).toMatchObject({ screenWidth: 2160, screenHeight: 3840, batchId: 'batch-h2', candidateIndex: 0 });
  });

  it('Regenerate on a reopened batch replays it on the server (…/again) — nothing re-sent from the page', async () => {
    server.jobs.set('job-h1-again', [
      jobView('job-h1-again', 'running', { stage: 'drawing', candidate: 1 }),
      jobView('job-h1-again', 'done', { result: historyBatchResult({ batchId: 'batch-h1b' }) }),
    ]);
    await openHistory();
    fireEvent.click(rows()[0]);
    await tick();
    await tick();
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));
    await tick();
    await tick();
    expect(server.agains).toEqual(['job-h1']);
    expect(server.starts).toHaveLength(0);
    await tick(DESIGNER_JOB_POLL_MS);
    expect(screen.getByText('Pick your favorite')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);
    await tick();
    await tick();
    expect(server.creates[0]).toMatchObject({ batchId: 'batch-h1b' }); // the NEW batch
  });

  it('Edit with words works on a reopened board, unchanged', async () => {
    await openHistory();
    fireEvent.click(rows()[0]);
    await tick();
    await tick();
    fireEvent.click(screen.getAllByRole('button', { name: /tweak/i })[0]);
    fireEvent.change(screen.getByPlaceholderText(/darker theme/), { target: { value: 'bigger prices' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await tick();
    await tick();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByPlaceholderText(/darker theme/)).toBeNull(); // applied: the tweak box closed
  });

  it('Back from a reopened batch returns to the list; Back from the list returns to where the operator was', async () => {
    await openHistory();
    fireEvent.click(rows()[0]);
    await tick();
    await tick();
    fireEvent.click(screen.getByRole('button', { name: '← Back' }));
    await tick();
    await tick();
    expect(screen.getByText('Your generated boards')).toBeInTheDocument();
    expect(rows()).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '← Back' }));
    await tick();
    expect(screen.getByText('Generate a template with AI')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'stub-generate' })).toBeInTheDocument();
  });

  it('nothing yet: says so in plain words', async () => {
    server.pages = new Map([['', historyPage([])]]);
    await openHistory();
    expect(screen.getByText(/Nothing here yet\. Every batch you generate is kept here for 90 days/)).toBeInTheDocument();
    expect(rows()).toHaveLength(0);
  });

  it('a batch that can no longer be opened (gone: 404) says so on the list, and the list stays', async () => {
    server.jobs.delete('job-h1');
    await openHistory();
    fireEvent.click(rows()[0]);
    await tick();
    await tick();
    expect(screen.getByRole('alert')).toHaveTextContent("That batch couldn't be opened. Try again.");
    expect(rows()).toHaveLength(2);
    expect(rows()[0]).not.toBeDisabled();
    await tick(10 * DESIGNER_JOB_POLL_MS);
    expect(count('GET /templates/generate-designer/jobs/job-h1')).toBe(1); // asked once, not polled
  });
});

// ── the boards left ───────────────────────────────────────────────────────────────────────────
describe('The boards left — one line under Generate', () => {
  it('"14 of 20 boards left this month · resets Oct 1" → Buy more → a pack → Stripe', async () => {
    await openDialog();
    expect(boardsLine()).toHaveTextContent('14 of 20 boards left this month · resets Oct 1');
    fireEvent.click(within(boardsLine()!).getByRole('button', { name: 'Buy more' }));
    await tick();
    const sheet = screen.getByRole('dialog', { name: 'Buy more boards' });
    expect(count('GET /ai/allowance')).toBe(1); // the sheet shows the packs the line already has
    fireEvent.click(within(sheet).getByRole('button', { name: /30 boards/ }));
    await tick();
    await tick();
    expect(server.checkouts).toEqual([{ pack: 'standard' }]);
    expect(goToCheckout).toHaveBeenCalledWith(CHECKOUT_URL);
  });

  it('Escape closes the pack sheet, not the dialog under it', async () => {
    await openDialog();
    fireEvent.click(within(boardsLine()!).getByRole('button', { name: 'Buy more' }));
    await tick();
    expect(screen.getByRole('dialog', { name: 'Buy more boards' })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await tick();
    expect(screen.queryByRole('dialog', { name: 'Buy more boards' })).toBeNull();
    expect(screen.getByText('Generate a template with AI')).toBeInTheDocument();
  });

  it.each([
    ['their own key', () => ownKeyAllowance(), 'Using your own AI key — no board limit'],
    ['nobody\'s key', () => noKeyAllowance(), 'AI runs on your own key — add it in Settings → AI provider.'],
    ['Stripe not set up', () => platformAllowance({ purchase: 'STRIPE_NOT_CONFIGURED' }), "14 of 20 boards left this month · resets Oct 1 Buying more boards isn't set up on this deployment yet."],
  ])('%s: the line says so, and there is nothing to buy', async (_name, allowance, text) => {
    server.allowance = allowance();
    await openDialog();
    expect(boardsLine()).toHaveTextContent(text);
    expect(within(boardsLine()!).queryByRole('button')).toBeNull();
  });

  it('read when the dialog opens and again when a batch lands — never polled', async () => {
    server.jobs.set('job-new', [
      jobView('job-new', 'running', { stage: 'drawing', candidate: 1 }),
      jobView('job-new', 'done', { result: producedResult(designerOutput({ batchId: 'batch-new' })) }),
    ]);
    await openDialog();
    expect(count('GET /ai/allowance')).toBe(1);
    await tick(10 * 60_000);
    expect(count('GET /ai/allowance')).toBe(1);

    server.allowance = platformAllowance({ included: 20, used: 9 });
    fireEvent.click(screen.getByRole('button', { name: 'stub-generate' }));
    await tick();
    await tick();
    await tick(DESIGNER_JOB_POLL_MS);
    expect(screen.getByText('Pick your favorite')).toBeInTheDocument();
    await tick();
    expect(count('GET /ai/allowance')).toBe(2);
    expect(boardsLine()).toHaveTextContent('11 of 20 boards left this month · resets Oct 1');
  });
});

// ── a generation refused for want of boards ───────────────────────────────────────────────────
describe('A generation refused for want of boards (the 402)', () => {
  function failWith(error: ProducedError) {
    server.jobs.set('job-new', [
      jobView('job-new', 'running', { stage: 'drawing', candidate: 1 }),
      { ...jobView('job-new', 'failed'), error } as JobViewLike,
    ]);
  }

  it('shows the server\'s own words — they name the numbers — with Buy more boards and Add your own AI key', async () => {
    const error = boardsCapReachedError({ needed: 3, left: 1 });
    failWith(error);
    server.allowance = platformAllowance({ included: 20, used: 19 });
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'stub-generate' }));
    await tick();
    await tick();
    await tick(DESIGNER_JOB_POLL_MS);
    expect(screen.getByRole('alert')).toHaveTextContent(error.message);
    expect(error.message).toMatch(/^This batch needs 3 boards; you have 1 left this month \(included boards reset October 1\)\./);
    const offers = screen.getByTestId('ai-cap-actions');
    expect(within(offers).getByRole('link', { name: 'Add your own AI key' })).toHaveAttribute('href', '/super-taco/settings/ai');
    fireEvent.click(within(offers).getByRole('button', { name: 'Buy more boards' }));
    await tick();
    expect(screen.getByRole('dialog', { name: 'Buy more boards' })).toBeInTheDocument();
    // The line under Generate was re-read when the job settled.
    expect(count('GET /ai/allowance')).toBe(2);
  });

  it('no pack for sale: only Add your own AI key', async () => {
    failWith(boardsCapReachedError({ needed: 3, left: 0, purchaseEnabled: false }));
    server.allowance = platformAllowance({ included: 20, used: 20, purchase: 'STRIPE_NOT_CONFIGURED' });
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'stub-generate' }));
    await tick();
    await tick();
    await tick(DESIGNER_JOB_POLL_MS);
    const offers = screen.getByTestId('ai-cap-actions');
    expect(within(offers).queryByRole('button', { name: 'Buy more boards' })).toBeNull();
    expect(within(offers).getByRole('link', { name: 'Add your own AI key' })).toBeInTheDocument();
  });

  it('an edit with words refused the same way offers the same ways forward', async () => {
    const env = boardsCapReachedError({ needed: 1, left: 0, kind: 'refine' });
    refine.reject = apiFetchError(env);
    await openHistory();
    fireEvent.click(rows()[0]);
    await tick();
    await tick();
    fireEvent.click(screen.getAllByRole('button', { name: /tweak/i })[0]);
    fireEvent.change(screen.getByPlaceholderText(/darker theme/), { target: { value: 'bigger prices' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await tick();
    await tick();
    expect(screen.getByRole('alert')).toHaveTextContent(env.message);
    expect(env.message).toMatch(/^This edit needs 1 board; you have none left this month/);
    expect(within(screen.getByTestId('ai-cap-actions')).getByRole('button', { name: 'Buy more boards' })).toBeInTheDocument();
  });

  it('any other failure offers nothing of the sort', async () => {
    failWith(menuBindingIncompleteError(21, [18, 19, 20]));
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'stub-generate' }));
    await tick();
    await tick();
    await tick(DESIGNER_JOB_POLL_MS);
    expect(screen.getByRole('alert')).toHaveTextContent("21 items don't fit one screen");
    expect(screen.queryByTestId('ai-cap-actions')).toBeNull();
  });
});
