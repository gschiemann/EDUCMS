/**
 * The four AI Designer job hooks, faked for the templates-page suites (2026-09-23).
 *
 * The dashboard's Designer generates through a background job now (start → poll → done), never
 * the synchronous generate-designer/candidates request these suites were written against. This
 * keeps their shape: a started job answers `done` on its first read, so "Generate" still lands on
 * the pick grid, and `starts` holds each request body exactly where `designerCalls` did.
 *
 * Every body is cut from the API producer (tests/fixtures/designer-job.ts) — the `{ jobId, status }`
 * the controller answers and the `toDesignerJobView` of a finished row whose `result` is
 * `designerJobResult(<AiService output>)`. The real hooks (polling, cancel, again) are exercised
 * with a mocked `apiFetch` in ai-dialog-designer-job-flow.test.tsx and use-designer-jobs.test.tsx.
 */
import {
  designerOutput,
  producedJobView,
  producedResult,
  producedStarted,
  type ProducedJobView,
  type ProducedResult,
} from '../../../../../tests/fixtures/designer-job';

export interface FakeDesignerJobs {
  /** Every body POSTed to generate-designer/jobs — what used to be the synchronous request. */
  starts: Array<Record<string, unknown>>;
  /** Every job id Regenerate replayed server-side (…/jobs/:id/again). */
  agains: string[];
  /** GET …/jobs/:id, by id. */
  views: Map<string, ProducedJobView>;
  /** The `result` of the next job to finish. */
  nextResult: () => ProducedResult;
  /** Make …/again refuse (a pruned job's 404, a stale request's 422). */
  againError: unknown;
  /** Jobs created so far — ids run job-1, job-2, … and restart at every reset(). */
  seq: number;
  reset(): void;
}

export function fakeDesignerJobs(): FakeDesignerJobs {
  const jobs: FakeDesignerJobs = {
    starts: [],
    agains: [],
    views: new Map(),
    nextResult: () => producedResult(designerOutput()),
    againError: null,
    seq: 0,
    reset() {
      jobs.starts.length = 0;
      jobs.agains.length = 0;
      jobs.views.clear();
      jobs.nextResult = () => producedResult(designerOutput());
      jobs.againError = null;
      jobs.seq = 0;
    },
  };
  return jobs;
}

/** The hooks, answering from `jobs`. Spread into a suite's `jest.mock('@/hooks/use-api', …)`. */
export function designerJobHookMocks(jobs: FakeDesignerJobs) {
  const finishNext = () => {
    jobs.seq += 1;
    const id = `job-${jobs.seq}`;
    jobs.views.set(id, producedJobView(id, 'done', { result: jobs.nextResult() }));
    return producedStarted(id);
  };
  return {
    useStartDesignerJob: () => ({
      mutateAsync: async (vars: Record<string, unknown>) => {
        jobs.starts.push(vars);
        return finishNext();
      },
      mutate: jest.fn(),
      isPending: false,
    }),
    useDesignerJob: (id: string | null | undefined) => ({ data: id ? jobs.views.get(id) : undefined, error: null }),
    useCancelDesignerJob: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
    useRegenerateDesignerJob: () => ({
      mutateAsync: async ({ jobId }: { jobId: string }) => {
        jobs.agains.push(jobId);
        if (jobs.againError) throw jobs.againError;
        return finishNext();
      },
      mutate: jest.fn(),
      isPending: false,
    }),
  };
}

/** For suites that never generate: the hooks exist and do nothing. */
export const inertDesignerJobHooks = {
  useStartDesignerJob: () => ({ mutateAsync: jest.fn(), mutate: jest.fn(), isPending: false }),
  useDesignerJob: () => ({ data: undefined, error: null }),
  useCancelDesignerJob: () => ({ mutateAsync: jest.fn(), mutate: jest.fn(), isPending: false }),
  useRegenerateDesignerJob: () => ({ mutateAsync: jest.fn(), mutate: jest.fn(), isPending: false }),
};
