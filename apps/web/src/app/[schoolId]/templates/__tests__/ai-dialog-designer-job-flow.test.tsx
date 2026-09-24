/**
 * The AI Designer generates through a BACKGROUND JOB, end to end through the page (2026-09-23).
 *
 * The synchronous generate-designer/candidates request skips the render → critique → revise loop
 * on purpose (`allowReview: false`) — only a job gets it — so until the dashboard generated through
 * jobs the operator saw none of that quality work. This suite mounts the REAL TemplatesPage with
 * the REAL job hooks (start / poll / cancel / again, use-api.ts) over a fake API behind `apiFetch`,
 * and walks the operator's path:
 *
 *   job created → polled (the stage in operator words, with Cancel) → done → the boards, mapped
 *   exactly as the synchronous answer was (+ the POS "Bound to" badge); Cancel → quietly back;
 *   failed → the SAME inline message + toast the failed request produced; a reload mid-job →
 *   the same job resumed, never a second paid batch; Regenerate → replayed server-side.
 *
 * Every body the fake API answers is cut from the API producer (tests/fixtures/designer-job.ts):
 * `{ jobId, status }` as the controller answers it, `toDesignerJobView` rows whose `result` is
 * `designerJobResult(<AiService output>)`, `storedProgress` stages, and failure envelopes from the
 * real AllExceptionsFilter.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  apiFetchError,
  boardsCapReachedError,
  busyError,
  capReachedError,
  designerOutput,
  menuBindingIncompleteError,
  producedError,
  producedJobView,
  producedProgress,
  producedResult,
  producedStarted,
  serviceUnavailable,
  sweepError,
  type ProducedError,
  type ProducedJobView,
} from '../../../../../tests/fixtures/designer-job';
import { humanizeMutationError } from '@/lib/mutation-error-toast';
import { inertAiBoardsHooks } from './designer-job-hooks.mock';

// ── the fake API: the four job routes, answered from the producer ─────────────────────────────
const server = {
  starts: [] as Array<Record<string, unknown>>,
  gets: [] as string[],
  cancels: [] as string[],
  agains: [] as Array<{ id: string; body: Record<string, unknown> }>,
  /** Per job id, the successive GET answers; the last one repeats. No entry → 404. */
  timeline: new Map<string, ProducedJobView[]>(),
  cancelled: new Set<string>(),
  startReply: (): unknown => producedStarted('job-1'),
  /** The job …/again creates from job `id`. */
  againReply: (id: string): unknown => producedStarted(id === 'job-1' ? 'job-2' : `${id}-again`),
};
const notFound = () =>
  apiFetchError({ code: 'AI_DESIGN_JOB_NOT_FOUND', message: 'That board generation was not found.', status: 404 });
function answerGet(id: string): ProducedJobView {
  server.gets.push(id);
  if (server.cancelled.has(id)) return producedJobView(id, 'cancelled', { progress: producedProgress('drawing', 1, 3) });
  const tl = server.timeline.get(id);
  if (!tl) throw notFound();
  return tl.length > 1 ? (tl.shift() as ProducedJobView) : tl[0];
}
const JOB = /^\/templates\/generate-designer\/jobs\/([^/]+)(\/cancel|\/again)?$/;
const apiFetch = jest.fn(async (path: string, opts?: { method?: string; body?: string }) => {
  const method = (opts?.method ?? 'GET').toUpperCase();
  const body = opts?.body ? JSON.parse(opts.body) : undefined;
  if (method === 'POST' && path === '/templates/generate-designer/jobs') {
    server.starts.push(body);
    const reply = server.startReply();
    if (reply instanceof Error) throw reply;
    return reply;
  }
  const m = JOB.exec(path);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (method === 'GET' && !m[2]) return answerGet(id);
    if (method === 'POST' && m[2] === '/cancel') {
      server.cancels.push(id);
      server.cancelled.add(id);
      return producedJobView(id, 'cancelled', { progress: producedProgress('drawing', 1, 3) });
    }
    if (method === 'POST' && m[2] === '/again') {
      server.agains.push({ id, body });
      return server.againReply(id);
    }
  }
  throw new Error(`fake API: unexpected ${method} ${path}`);
});
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string, opts?: { method?: string; body?: string }) => apiFetch(path, opts),
}));

// ── the page's other data: staged, as in the sibling suites; the job hooks are REAL ─────────────
jest.mock('@/hooks/use-api', () => {
  const actual = jest.requireActual('@/hooks/use-api');
  const noopMutation = () => ({ mutateAsync: jest.fn(), isPending: false, mutate: jest.fn() });
  return {
    useTemplates: () => ({ data: [], isLoading: false, isError: false, refetch: jest.fn() }),
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
    useCreateDesigner: noopMutation,
    useRegenerateBoardImage: noopMutation,
    useAssets: () => ({ data: [], isLoading: false }),
    usePlaylists: () => ({ data: [], isLoading: false }),
    useAssetFolders: () => ({ data: [], isLoading: false }),
    useScreens: () => ({ data: [], isLoading: false }),
    // The REAL ones: polling cadence, cancel writing the cache, …/again.
    DESIGNER_JOB_POLL_MS: actual.DESIGNER_JOB_POLL_MS,
    useStartDesignerJob: actual.useStartDesignerJob,
    useDesignerJob: actual.useDesignerJob,
    useCancelDesignerJob: actual.useCancelDesignerJob,
    useRegenerateDesignerJob: actual.useRegenerateDesignerJob,
    // 2026-09-23 — the board history + board credits (their real hooks run in
    // ai-dialog-history-credits.test.tsx): inert here.
    ...inertAiBoardsHooks,
  };
});

jest.mock('@/hooks/use-ai-designer', () => ({
  // No brief signal: the page generates straight from the Concierge (the confirm strip is its own
  // surface) — the generating state then fills the dialog.
  useExtractDesignerBrief: () => ({
    mutate: (_vars: unknown, cb: { onSuccess: (r: { brief: null }) => void }) => cb.onSuccess({ brief: null }),
    mutateAsync: jest.fn(),
    isPending: false,
  }),
  useRefineDesignerBoard: () => ({ mutateAsync: jest.fn(), isPending: false }),
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
          intake: { purpose: 'menu', theme: 'Bold', widgets: ['headline', 'menu', 'logo'] },
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

class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

// Imported only after every mock above is in place (use-api's factory runs on first import).
import { DESIGNER_JOB_POLL_MS } from '@/hooks/use-api';
import TemplatesPage from '../page';

const toastError = () => (jest.requireMock('sonner') as { toast: { error: jest.Mock } }).toast.error;

// ── harness ──────────────────────────────────────────────────────────────────────────────────
function renderPage() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TemplatesPage />
    </QueryClientProvider>,
  );
}

/** Advance the fake clock, letting fetch promises and react-query's setTimeout(0) notices land. */
async function tick(ms = 0) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
      jest.advanceTimersByTime(0);
    }
  });
}

async function openAndGenerate() {
  renderPage();
  fireEvent.click(screen.getAllByRole('button', { name: /generate .*ai|with ai/i })[0]);
  await screen.findByText('Generate a template with AI');
  fireEvent.click(screen.getByRole('button', { name: 'stub-generate' }));
  // The start request, then the job's first read (a job can already be done by then).
  await tick();
  await tick();
}

const progress = () => screen.queryByTestId('designer-job-progress');
const stageLine = () => within(screen.getByTestId('designer-job-progress')).getByRole('status').textContent;
const cache = (key: string) => JSON.parse(localStorage.getItem(key) || 'null');
const LAST_BATCH = 'vos:ai:lastbatch:super-taco';
const PENDING = 'vos:ai:job:super-taco';
const BOUND = { providerId: 'toast', providerName: 'Toast', itemCount: 9 };

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
  localStorage.clear();
  apiFetch.mockClear();
  toastError().mockClear();
  server.starts.length = 0;
  server.gets.length = 0;
  server.cancels.length = 0;
  server.agains.length = 0;
  server.timeline.clear();
  server.cancelled.clear();
  server.startReply = () => producedStarted('job-1');
  server.againReply = (id: string) => producedStarted(id === 'job-1' ? 'job-2' : `${id}-again`);
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────────────────────

it('a generation is ONE job: started once, polled while it runs — the stage in operator words, with Cancel — then its boards land in the pick grid exactly as the synchronous answer did', async () => {
  const result = producedResult(designerOutput({ boundTo: BOUND }));
  server.timeline.set('job-1', [
    producedJobView('job-1', 'queued'),
    producedJobView('job-1', 'running', { progress: producedProgress('drawing', 1, 3) }),
    producedJobView('job-1', 'running', { progress: producedProgress('reviewing', 2, 3) }),
    producedJobView('job-1', 'running', { progress: producedProgress('revising', 2, 3) }),
    producedJobView('job-1', 'done', { progress: producedProgress('done', undefined, 3), result }),
  ]);
  await openAndGenerate();

  // Started ONCE, with the generate body and an idempotency key the API accepts.
  expect(server.starts).toHaveLength(1);
  expect(server.starts[0]).toMatchObject({
    prompt: expect.stringContaining('Super Taco'),
    screenWidth: 3840,
    screenHeight: 2160,
    vertical: 'restaurant',
    count: 2,
    purpose: 'menu',
  });
  expect(server.starts[0].idempotencyKey).toMatch(/^[A-Za-z0-9._:-]{8,100}$/);
  expect(apiFetch.mock.calls.some(([p]) => p === '/templates/generate-designer/candidates')).toBe(false); // never the sync endpoint

  // queued → drawing → looking → fixing, one poll every 2 s.
  expect(stageLine()).toBe('Getting started…');
  const cancel = within(progress()!).getByRole('button', { name: 'Cancel' });
  expect(cancel).not.toBeDisabled();
  expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled(); // Cancel is the way out
  await tick(DESIGNER_JOB_POLL_MS);
  expect(stageLine()).toBe('Drawing 3 boards…');
  await tick(DESIGNER_JOB_POLL_MS);
  expect(stageLine()).toBe('Looking at option 2…');
  // Esc must not close the dialog under a running job (it did: the handler read a stale isPending).
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.getByText('Generate a template with AI')).toBeInTheDocument();
  await tick(DESIGNER_JOB_POLL_MS);
  expect(stageLine()).toBe('Fixing option 2…');
  await tick(DESIGNER_JOB_POLL_MS);

  // Done → the pick grid, the POS badge, and the batch cache — as the sync answer produced them.
  expect(screen.getByText('Pick your favorite')).toBeInTheDocument();
  expect(progress()).toBeNull();
  expect(screen.getAllByText('Rail + cards').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Hero + cards').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Leader rows').length).toBeGreaterThan(0);
  expect(screen.getByTestId('designer-bound-badge')).toHaveTextContent('Bound to Toast · 9 items');
  const batch = cache(LAST_BATCH);
  expect(batch.jobId).toBe('job-1');
  expect(batch.boundTo).toEqual(BOUND);
  expect(batch.canvas).toEqual({ w: 3840, h: 2160 });
  expect(batch.candidates).toHaveLength(3);
  batch.candidates.forEach((c: Record<string, unknown>, i: number) => {
    expect(c._designerHtml).toBe(result.candidates[i].html);
    expect(c._batchId).toBe(result.batchId);
    expect(c._structure).toBe(result.candidates[i].structure);
  });
  expect(localStorage.getItem(PENDING)).toBeNull();

  // A finished job is never polled again.
  const polls = server.gets.length;
  expect(polls).toBe(5);
  await tick(10 * DESIGNER_JOB_POLL_MS);
  expect(server.gets.length).toBe(polls);
});

it('Cancel stops the job and returns quietly to where the operator was — no error, no toast, no more polling', async () => {
  server.timeline.set('job-1', [producedJobView('job-1', 'running', { progress: producedProgress('drawing', 1, 3) })]);
  await openAndGenerate();
  await tick(DESIGNER_JOB_POLL_MS);
  expect(stageLine()).toBe('Drawing 3 boards…');
  expect(localStorage.getItem(PENDING)).not.toBeNull();

  fireEvent.click(within(progress()!).getByRole('button', { name: 'Cancel' }));
  await tick();
  expect(server.cancels).toEqual(['job-1']);
  expect(progress()).toBeNull();
  // Back at the Concierge (the confirm step had nothing to confirm).
  expect(screen.getByRole('button', { name: 'stub-generate' })).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(toastError()).not.toHaveBeenCalled();
  expect(localStorage.getItem(PENDING)).toBeNull();
  const polls = server.gets.length;
  await tick(10 * DESIGNER_JOB_POLL_MS);
  expect(server.gets.length).toBe(polls);
});

describe('a job that fails says exactly what the failed request said', () => {
  it.each<[string, () => ProducedError, string | ((env: ProducedError) => string)]>([
    ['a POS menu too long for one screen (MENU_BINDING_INCOMPLETE)', () => menuBindingIncompleteError(21, [18, 19, 20]), "21 items don't fit one screen — choose fewer sections."],
    // 2026-09-23 — a 402 shows the SERVER's words (they say when it resets, and for boards how
    // many were needed and are left), with Buy more / Add your own key right under them.
    ['the included AI used up (402)', () => capReachedError(), (env) => env.message],
    ['no boards left for this batch (402, boards)', () => boardsCapReachedError({ needed: 3, left: 1 }), (env) => env.message],
    ['a 503 from the pipeline', () => producedError(serviceUnavailable('AI could not design a usable board. Try rephrasing your brief.')), 'AI could not design a usable board. Try rephrasing your brief.'],
    ['a crash (production masks it)', () => producedError(new TypeError('boom'), { production: true }), 'Generation failed. Try rephrasing or try again later.'],
    ['a worker that died twice (the stale sweep)', () => sweepError('stalled'), 'This generation stopped before it finished. Try again.'],
    ['a job no worker ever claimed', () => sweepError('expired'), 'This generation stopped before it finished. Try again.'],
  ])('%s', async (_name, envelope, inline) => {
    const error = envelope();
    server.timeline.set('job-1', [
      producedJobView('job-1', 'running', { progress: producedProgress('drawing', 1, 3) }),
      producedJobView('job-1', 'failed', { progress: producedProgress('drawing', 1, 3), error }),
    ]);
    await openAndGenerate();
    await tick(DESIGNER_JOB_POLL_MS);

    expect(screen.getByRole('alert')).toHaveTextContent(typeof inline === 'function' ? inline(error) : inline);
    // A refusal for want of boards / included AI (the 402) offers the ways forward under it; no
    // other failure does. (Buy more needs a pack for sale — the allowance is inert here.)
    if (error.status === 402) {
      const offers = screen.getByTestId('ai-cap-actions');
      expect(within(offers).getByRole('link', { name: 'Add your own AI key' })).toHaveAttribute('href', '/super-taco/settings/ai');
      expect(within(offers).queryByRole('button', { name: 'Buy more boards' })).toBeNull();
    } else {
      expect(screen.queryByTestId('ai-cap-actions')).toBeNull();
    }
    expect(progress()).toBeNull();
    // …and the same toast every failed mutation raises (the synchronous request raised it).
    expect(toastError()).toHaveBeenCalledTimes(1);
    expect(toastError()).toHaveBeenCalledWith(humanizeMutationError(apiFetchError(error)), { id: 'mutation-error', duration: 7000 });
    expect(localStorage.getItem(PENDING)).toBeNull();
    expect(cache(LAST_BATCH)).toBeNull(); // a failed job never costs the previous batch — there was none
  });

  it('two generations already running: the start is refused with the jobs’ own words, not "this hour’s limit"', async () => {
    server.startReply = () => apiFetchError(busyError());
    await openAndGenerate();
    expect(screen.getByRole('alert')).toHaveTextContent('Two generations are already running for this account. Try again when one finishes.');
    expect(progress()).toBeNull();
    expect(server.gets).toHaveLength(0);
  });
});

it('a reload mid-job picks the SAME job back up — the dialog reopens on its progress, no second batch is started, and its boards land', async () => {
  const replay = { prompt: 'A menu board for Super Taco', intakeFields: { purpose: 'menu' }, forceDesigner: true, designerExtras: { venueName: 'Super Taco' } };
  localStorage.setItem(
    PENDING,
    JSON.stringify({ jobId: 'job-7', ts: Date.now() - 90_000, canvas: { w: 2160, h: 3840 }, interactive: false, brief: null, replay }),
  );
  server.timeline.set('job-7', [
    producedJobView('job-7', 'running', { progress: producedProgress('reviewing', 3, 3) }),
    producedJobView('job-7', 'done', { progress: producedProgress('done', undefined, 3), result: producedResult(designerOutput({ width: 2160, height: 3840 })) }),
  ]);
  renderPage();
  await tick();
  await tick();

  expect(screen.getByText('Generate a template with AI')).toBeInTheDocument(); // opened by itself
  expect(stageLine()).toBe('Looking at option 3…');
  expect(server.starts).toHaveLength(0); // never a second paid batch
  expect(server.gets).toEqual(['job-7']);

  await tick(DESIGNER_JOB_POLL_MS);
  expect(screen.getByText('Pick your favorite')).toBeInTheDocument();
  const batch = cache(LAST_BATCH);
  expect(batch.jobId).toBe('job-7');
  expect(batch.canvas).toEqual({ w: 2160, h: 3840 }); // the job's canvas, not the default
  expect(batch.replay.designerExtras.venueName).toBe('Super Taco'); // how it was made, for Regenerate
  expect(localStorage.getItem(PENDING)).toBeNull();
});

it.each([
  ['cancelled on another device', (id: string) => { server.cancelled.add(id); }],
  // No row for it at all: the fake API answers the controller's 404.
  ['gone (404 — pruned, or another account’s id)', (id: string) => { server.timeline.delete(id); }],
])('a resumed job that was %s closes the dialog it opened, quietly', async (_name, arrange) => {
  localStorage.setItem(
    PENDING,
    JSON.stringify({ jobId: 'job-9', ts: Date.now() - 60_000, canvas: { w: 3840, h: 2160 }, interactive: false, brief: null, replay: null }),
  );
  arrange('job-9');
  renderPage();
  await tick();
  await tick();
  expect(screen.queryByText('Generate a template with AI')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(toastError()).not.toHaveBeenCalled();
  expect(localStorage.getItem(PENDING)).toBeNull();
  expect(server.gets).toEqual(['job-9']); // asked once, not polled
  await tick(5 * DESIGNER_JOB_POLL_MS);
  expect(server.gets).toEqual(['job-9']);
});

it('a pending record older than a day is not resumed', async () => {
  localStorage.setItem(
    PENDING,
    JSON.stringify({ jobId: 'job-old', ts: Date.now() - 25 * 60 * 60_000, canvas: { w: 3840, h: 2160 }, interactive: false, brief: null, replay: null }),
  );
  renderPage();
  await tick();
  expect(screen.queryByText('Generate a template with AI')).toBeNull();
  expect(server.gets).toHaveLength(0);
  expect(localStorage.getItem(PENDING)).toBeNull();
});

it('Regenerate replays the batch’s job on the server (…/again) and lands the new batch — its progress right above the button', async () => {
  server.timeline.set('job-1', [producedJobView('job-1', 'done', { result: producedResult(designerOutput({ batchId: 'batch-1' })) })]);
  server.timeline.set('job-2', [
    producedJobView('job-2', 'running', { progress: producedProgress('drawing', 1, 3) }),
    producedJobView('job-2', 'done', { result: producedResult(designerOutput({ batchId: 'batch-2' })) }),
  ]);
  await openAndGenerate();
  expect(screen.getByText('Pick your favorite')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));
  await tick();
  await tick();
  expect(server.agains).toHaveLength(1);
  expect(server.agains[0].id).toBe('job-1');
  expect(Object.keys(server.agains[0].body)).toEqual(['idempotencyKey']); // nothing else re-sent
  expect(server.starts).toHaveLength(1); // no new request from the page
  expect(stageLine()).toBe('Drawing 3 boards…');
  expect(screen.getByRole('button', { name: /← Back/ })).toBeDisabled(); // mid-job, Cancel is the way out

  await tick(DESIGNER_JOB_POLL_MS);
  expect(progress()).toBeNull();
  const batch = cache(LAST_BATCH);
  expect(batch.jobId).toBe('job-2');
  expect(batch.candidates[0]._batchId).toBe('batch-2');
});

it('a gone job is not a spinner forever: a 404 mid-poll settles the dialog back', async () => {
  server.timeline.set('job-1', [producedJobView('job-1', 'running', { progress: producedProgress('drawing', 1, 3) })]);
  await openAndGenerate();
  await waitFor(() => expect(stageLine()).toBe('Drawing 3 boards…'));
  server.timeline.delete('job-1'); // the row is gone
  await tick(DESIGNER_JOB_POLL_MS);
  expect(progress()).toBeNull();
  expect(screen.getByRole('button', { name: 'stub-generate' })).toBeInTheDocument();
  expect(localStorage.getItem(PENDING)).toBeNull();
});
