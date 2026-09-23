/**
 * The AI Designer job hooks (use-api.ts, 2026-09-23): the routes the API really serves (read out
 * of the controller, never retyped), the poll cadence the mobile-perf standard allows (every 2 s
 * while queued/running AND visible; once on return to the tab; never for a finished job), and no
 * retry for an id that is gone. Every answer is cut from the producer (tests/fixtures/designer-job).
 *
 * Mocking convention matches use-refine-designer-board.test.tsx: `apiFetch` mocked at
 * `@/lib/api-client`, the REAL hooks inside a real QueryClientProvider.
 */
import * as fs from 'fs';
import { useEffect } from 'react';
import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  PRODUCER_FILES,
  apiFetchError,
  jobNotFoundError,
  producedJobView,
  producedProgress,
  producedResult,
  producedStarted,
} from '../../../tests/fixtures/designer-job';

interface FetchOpts {
  method?: string;
  body?: string;
}

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string, opts?: FetchOpts) => apiFetch(path, opts),
}));

import {
  DESIGNER_JOB_POLL_MS,
  useCancelDesignerJob,
  useDesignerJob,
  useRegenerateDesignerJob,
  useStartDesignerJob,
} from '../use-api';

/** Handler name → "VERB /templates/<route>" as the controller declares it (API_URL ends in /api/v1). */
const ROUTES: Record<string, string> = (() => {
  const src = fs.readFileSync(PRODUCER_FILES.controller, 'utf8');
  const base = /@Controller\('api\/v1\/([^']+)'\)/.exec(src)?.[1];
  const out: Record<string, string> = {};
  for (const m of Array.from(src.matchAll(/@(Post|Get)\('(generate-designer\/jobs[^']*)'\)[\s\S]*?async (\w+)\(/g))) {
    out[m[3]] = `${m[1].toUpperCase()} /${base}/${m[2]}`;
  }
  return out;
})();
const route = (handler: string, id = '') => ROUTES[handler].replace(':id', id);
const called = (i: number) => {
  const [path, opts] = apiFetch.mock.calls[i] as [string, FetchOpts | undefined];
  return `${(opts?.method ?? 'GET').toUpperCase()} ${path}`;
};

type Hooks = {
  start: ReturnType<typeof useStartDesignerJob>;
  job: ReturnType<typeof useDesignerJob>;
  cancel: ReturnType<typeof useCancelDesignerJob>;
  again: ReturnType<typeof useRegenerateDesignerJob>;
};

/** Renders the four REAL hooks and hands their latest results to `expose` after every commit. */
function Inner({ id, expose }: { id: string | null; expose: (h: Hooks) => void }) {
  const h: Hooks = {
    start: useStartDesignerJob(),
    job: useDesignerJob(id),
    cancel: useCancelDesignerJob(),
    again: useRegenerateDesignerJob(),
  };
  useEffect(() => {
    expose(h);
  });
  return null;
}

function mount(jobId: string | null) {
  // Queries keep the hook's OWN retry rule (that is under test); mutations never retry here.
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const hooks = {} as Hooks;
  const expose = (h: Hooks) => Object.assign(hooks, h);
  render(
    <QueryClientProvider client={qc}>
      <Inner id={jobId} expose={expose} />
    </QueryClientProvider>,
  );
  return { qc, hooks };
}

/**
 * Fake the clock (setTimeout / setInterval / Date) but NOT microtasks: React's act() queues a
 * microtask to check it was awaited, and a faked queueMicrotask runs that check inside the scope.
 */
function useFakeClock() {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
}

/** Advance fake time and let react-query's setTimeout(0) notifications + the fetch promises land. */
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
  // Bubbles like the real event: react-query's focusManager listens on window.
  document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
}

beforeEach(() => {
  apiFetch.mockReset();
});
afterEach(() => {
  jest.useRealTimers();
  setVisibility('visible');
});

it('the controller serves the four routes the hooks call (drift guard)', () => {
  expect(ROUTES).toEqual({
    startDesignerJob: 'POST /templates/generate-designer/jobs',
    getDesignerJob: 'GET /templates/generate-designer/jobs/:id',
    cancelDesignerJob: 'POST /templates/generate-designer/jobs/:id/cancel',
    againDesignerJob: 'POST /templates/generate-designer/jobs/:id/again',
    // The AI board history list (2ced15e7) — served, not yet called by any hook here.
    listDesignerJobs: 'GET /templates/generate-designer/jobs',
  });
});

it('start: POSTs the generate body + its idempotency key to the jobs route; resolves with the 202 body', async () => {
  apiFetch.mockResolvedValue(producedStarted('job-1'));
  const { hooks } = mount(null);
  let started: unknown;
  await act(async () => {
    started = await hooks.start.mutateAsync({ prompt: 'A taco menu', screenWidth: 3840, screenHeight: 2160, count: 3, idempotencyKey: 'key-12345678' });
  });
  expect(called(0)).toBe(route('startDesignerJob'));
  expect(JSON.parse((apiFetch.mock.calls[0][1] as FetchOpts).body!)).toEqual({
    prompt: 'A taco menu',
    screenWidth: 3840,
    screenHeight: 2160,
    count: 3,
    idempotencyKey: 'key-12345678',
  });
  expect(started).toEqual({ jobId: 'job-1', status: 'queued' });
});

it('poll: every 2 s while queued/running, then never again once the job lands', async () => {
  useFakeClock();
  const answers = [
    producedJobView('job-1', 'queued'),
    producedJobView('job-1', 'running', { progress: producedProgress('drawing', 1, 3) }),
    producedJobView('job-1', 'running', { progress: producedProgress('reviewing', 2, 3) }),
    producedJobView('job-1', 'done', { progress: producedProgress('done', undefined, 3), result: producedResult() }),
  ];
  let n = 0;
  apiFetch.mockImplementation(async () => answers[Math.min(n++, answers.length - 1)]);
  const { hooks } = mount('job-1');
  await tick();
  expect(apiFetch).toHaveBeenCalledTimes(1);
  expect(called(0)).toBe(route('getDesignerJob', 'job-1'));
  expect(hooks.job.data?.status).toBe('queued');

  await tick(DESIGNER_JOB_POLL_MS - 1);
  expect(apiFetch).toHaveBeenCalledTimes(1); // not before 2 s
  await tick(1);
  expect(apiFetch).toHaveBeenCalledTimes(2);
  expect(hooks.job.data?.progress?.stage).toBe('drawing');
  await tick(DESIGNER_JOB_POLL_MS);
  expect(hooks.job.data?.progress).toEqual(producedProgress('reviewing', 2, 3));
  await tick(DESIGNER_JOB_POLL_MS);
  expect(apiFetch).toHaveBeenCalledTimes(4);
  expect(hooks.job.data?.status).toBe('done');
  expect(hooks.job.data?.result?.candidates).toHaveLength(3);

  await tick(10 * DESIGNER_JOB_POLL_MS);
  expect(apiFetch).toHaveBeenCalledTimes(4); // a finished job (~120 KB a board) is never re-downloaded
});

it('poll: a hidden tab does not poll; coming back refetches an ACTIVE job once, a finished one never', async () => {
  useFakeClock();
  let status: 'running' | 'done' = 'running';
  apiFetch.mockImplementation(async () =>
    status === 'running'
      ? producedJobView('job-1', 'running', { progress: producedProgress('drawing', 1, 3) })
      : producedJobView('job-1', 'done', { result: producedResult() }),
  );
  mount('job-1');
  await tick();
  expect(apiFetch).toHaveBeenCalledTimes(1);

  setVisibility('hidden');
  await tick(5 * DESIGNER_JOB_POLL_MS);
  expect(apiFetch).toHaveBeenCalledTimes(1); // refetchIntervalInBackground stays false

  setVisibility('visible');
  await tick();
  expect(apiFetch).toHaveBeenCalledTimes(2); // the app switch back refetches the running job at once

  status = 'done';
  await tick(DESIGNER_JOB_POLL_MS);
  expect(apiFetch).toHaveBeenCalledTimes(3);
  setVisibility('hidden');
  setVisibility('visible');
  await tick(5 * DESIGNER_JOB_POLL_MS);
  expect(apiFetch).toHaveBeenCalledTimes(3);
});

it.each([
  ['404 (pruned / another account’s id)', () => jobNotFoundError()],
  ['403 (a session that may not read it)', () => ({ code: 'FORBIDDEN', message: 'Insufficient role', status: 403 })],
])('poll: an id that is gone — %s — is asked ONCE: no retry, no poll', async (_name, envelope) => {
  useFakeClock();
  apiFetch.mockRejectedValue(apiFetchError(envelope()));
  const gone = mount('job-gone');
  await tick();
  await tick(10 * DESIGNER_JOB_POLL_MS);
  expect(apiFetch).toHaveBeenCalledTimes(1);
  expect((gone.hooks.job.error as { status?: number } | null)?.status).toBe(envelope().status);
});

it('poll: a 5xx or a network blip is retried — the job is still running on the server', async () => {
  useFakeClock();
  apiFetch.mockRejectedValue(apiFetchError({ code: 'INTERNAL_ERROR', message: 'Internal server error', status: 500 }));
  mount('job-blip');
  await tick();
  await tick(1_000); // react-query's first retry delay
  expect(apiFetch.mock.calls.length).toBeGreaterThanOrEqual(2);
});

it('cancel: POSTs the cancel route and writes the answer into the job’s query (the page settles from it)', async () => {
  apiFetch.mockImplementation(async (path: string) =>
    path.endsWith('/cancel')
      ? producedJobView('job-1', 'cancelled', { progress: producedProgress('drawing', 1, 3) })
      : producedJobView('job-1', 'running', { progress: producedProgress('drawing', 1, 3) }),
  );
  const { qc, hooks } = mount('job-1');
  await act(async () => {
    await hooks.cancel.mutateAsync('job-1');
  });
  expect(apiFetch.mock.calls.map((_c, i) => called(i))).toContain(route('cancelDesignerJob', 'job-1'));
  expect((qc.getQueryData(['designer-job', 'job-1']) as { status?: string } | undefined)?.status).toBe('cancelled');
});

it('again: POSTs the replay route with only a fresh idempotency key, and raises no global toast itself', async () => {
  apiFetch.mockResolvedValue(producedStarted('job-2'));
  const { qc, hooks } = mount(null);
  let started: unknown;
  await act(async () => {
    started = await hooks.again.mutateAsync({ jobId: 'job-1', idempotencyKey: 'key-abcdefgh' });
  });
  expect(called(0)).toBe(route('againDesignerJob', 'job-1'));
  expect(JSON.parse((apiFetch.mock.calls[0][1] as FetchOpts).body!)).toEqual({ idempotencyKey: 'key-abcdefgh' });
  expect(started).toEqual({ jobId: 'job-2', status: 'queued' });
  // The page answers every failure itself (a 404/422 falls back to a local replay quietly).
  expect(qc.getMutationCache().getAll().pop()?.options.meta).toEqual({ suppressGlobalError: true });
});

it('ids are URL-encoded into the path', async () => {
  apiFetch.mockResolvedValue(producedJobView('a/b', 'queued'));
  mount('a/b');
  await act(async () => {
    await Promise.resolve();
  });
  expect(called(0)).toBe(route('getDesignerJob', 'a%2Fb'));
});
