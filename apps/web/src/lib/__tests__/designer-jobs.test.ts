/**
 * lib/designer-jobs.ts — the pure pieces the templates page reads a Designer job through
 * (2026-09-23). Inputs are cut from the API producer (tests/fixtures/designer-job.ts).
 */
import {
  apiFetchError,
  busyError,
  designerOutput,
  menuBindingIncompleteError,
  producedError,
  producedJobView,
  producedResult,
  serviceUnavailable,
  sweepError,
} from '../../../tests/fixtures/designer-job';
import {
  DESIGNER_JOBS_BUSY_CODE,
  PENDING_DESIGNER_JOB_MAX_AGE_MS,
  clearPendingDesignerJob,
  designerBatchFromJob,
  designerJobErrorAsApiError,
  designerJobFailureIsStall,
  designerJobGone,
  designerJobReplayRefused,
  mapDesignerBoards,
  newDesignerJobKey,
  pendingDesignerJobKey,
  readPendingDesignerJob,
  writePendingDesignerJob,
} from '../designer-jobs';

describe('mapDesignerBoards — a finished job’s result → the pick grid', () => {
  it('maps every board the way the synchronous response was mapped', () => {
    const result = producedResult();
    const mapped = mapDesignerBoards(result);
    expect(mapped).toHaveLength(3);
    mapped.forEach((c, i) => {
      const b = result.candidates[i];
      expect(c.name).toBe('Super Taco');
      expect(c._designerHtml).toBe(b.html);
      expect(c.zones).toEqual([
        { name: 'board', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, defaultConfig: { html: b.html } },
      ]);
      expect(c._batchId).toBe(result.batchId);
      expect(c._structure).toBe(b.structure);
      expect(c._artDirection).toBe(b.artDirection);
    });
  });

  it('an empty or missing result maps to no boards', () => {
    expect(mapDesignerBoards(undefined)).toEqual([]);
    expect(mapDesignerBoards({ candidates: [] })).toEqual([]);
  });
});

describe('designerBatchFromJob — the ONE job → boards mapping (the page settles through it; history reuses it)', () => {
  it('a done job → its boards, its job id and its POS binding', () => {
    const result = producedResult(designerOutput({ boundTo: { providerId: 'toast', providerName: 'Toast', itemCount: 9 } }));
    const batch = designerBatchFromJob(producedJobView('job-3', 'done', { result }));
    expect(batch?.jobId).toBe('job-3');
    expect(batch?.boundTo).toEqual({ providerId: 'toast', providerName: 'Toast', itemCount: 9 });
    expect(batch?.candidates).toEqual(mapDesignerBoards(result));
    expect(batch?.candidates.every((c) => c._batchId === result.batchId)).toBe(true);
  });

  it('no binding → null boundTo; any other status → no batch', () => {
    expect(designerBatchFromJob(producedJobView('job-3', 'done', { result: producedResult() }))?.boundTo).toBeNull();
    for (const status of ['queued', 'running', 'failed', 'cancelled'] as const) {
      expect(designerBatchFromJob(producedJobView('job-3', status, { result: producedResult() }))).toBeNull();
    }
    expect(designerBatchFromJob(null)).toBeNull();
  });
});

describe('designerJobErrorAsApiError — the stored envelope reads like the failed request', () => {
  it.each([
    ['MENU_BINDING_INCOMPLETE', () => menuBindingIncompleteError()],
    ['a 503 the pipeline threw', () => producedError(serviceUnavailable('AI could not design a usable board. Try rephrasing your brief.'))],
    ['the stale sweep’s stall', () => sweepError('stalled')],
    ['a non-HTTP crash', () => producedError(new TypeError('boom'))],
  ])('%s', (_name, make) => {
    const env = make();
    const err = designerJobErrorAsApiError(env);
    const fromFetch = apiFetchError(env);
    expect(err.message).toBe(fromFetch.message);
    expect(err.status).toBe(fromFetch.status);
    expect(err.code).toBe(fromFetch.code);
    expect(err.body).toEqual(fromFetch.body);
  });

  it('a job with no envelope still reads as a 500', () => {
    const err = designerJobErrorAsApiError(null);
    expect(err.status).toBe(500);
    expect(err.message).toBe('Generation failed.');
  });
});

describe('how a job ends without boards', () => {
  it('gone: 404 (pruned / another account), 403, 401 — never a network error or a 5xx', () => {
    expect(designerJobGone({ status: 404, code: 'AI_DESIGN_JOB_NOT_FOUND' })).toBe(true);
    expect(designerJobGone({ status: 403 })).toBe(true);
    expect(designerJobGone({ status: 401 })).toBe(true);
    expect(designerJobGone({ status: 500 })).toBe(false);
    expect(designerJobGone({ status: 503 })).toBe(false);
    expect(designerJobGone(new Error("Can't reach the server"))).toBe(false);
    expect(designerJobGone(null)).toBe(false);
  });

  it('stall: the two failures the server gives up on by itself', () => {
    expect(designerJobFailureIsStall(sweepError('stalled'))).toBe(true);
    expect(designerJobFailureIsStall(sweepError('expired'))).toBe(true);
    expect(designerJobFailureIsStall(menuBindingIncompleteError())).toBe(false);
    expect(designerJobFailureIsStall(undefined)).toBe(false);
  });

  it('replay refused: …/again answered 404 or 422 — anything else is a real error', () => {
    expect(designerJobReplayRefused({ status: 404, code: 'AI_DESIGN_JOB_NOT_FOUND' })).toBe(true);
    expect(designerJobReplayRefused({ status: 422, code: 'AI_DESIGN_JOB_REQUEST_INVALID' })).toBe(true);
    expect(designerJobReplayRefused(apiFetchError(busyError()))).toBe(false);
    expect(designerJobReplayRefused({ status: 503 })).toBe(false);
  });

  it('the busy code is the one the service throws', () => {
    expect(busyError().code).toBe(DESIGNER_JOBS_BUSY_CODE);
  });
});

describe('newDesignerJobKey', () => {
  it('passes the API’s idempotency-key rule and is fresh every time', () => {
    const a = newDesignerJobKey();
    const b = newDesignerJobKey();
    // DesignerJobIdempotencyKeySchema: z.string().min(8).max(100).regex(/^[A-Za-z0-9._:-]+$/)
    for (const k of [a, b]) expect(k).toMatch(/^[A-Za-z0-9._:-]{8,100}$/);
    expect(a).not.toBe(b);
  });
});

describe('the pending-job cache', () => {
  const key = pendingDesignerJobKey('riot');
  const record = (ts: number) => ({
    jobId: 'job-1',
    ts,
    canvas: { w: 3840, h: 2160 },
    interactive: false,
    brief: null,
    replay: { prompt: 'menu' },
  });
  beforeEach(() => localStorage.clear());

  it('is keyed per school', () => {
    expect(key).toBe('vos:ai:job:riot');
    expect(pendingDesignerJobKey(undefined)).toBe('vos:ai:job:x');
  });

  it('round-trips a running job', () => {
    const now = Date.now();
    writePendingDesignerJob(key, record(now));
    expect(readPendingDesignerJob(key, now + 60_000)).toEqual(record(now));
  });

  it('still resumes an hour later — the boards of a batch that finished while iOS had the tab discarded', () => {
    const now = Date.now();
    writePendingDesignerJob(key, record(now));
    expect(readPendingDesignerJob(key, now + 60 * 60_000)?.jobId).toBe('job-1');
    expect(readPendingDesignerJob(key, now + PENDING_DESIGNER_JOB_MAX_AGE_MS - 1)?.jobId).toBe('job-1');
  });

  it('forgets a record past the window, and a malformed one', () => {
    const now = Date.now();
    writePendingDesignerJob(key, record(now));
    expect(readPendingDesignerJob(key, now + PENDING_DESIGNER_JOB_MAX_AGE_MS + 1)).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
    localStorage.setItem(key, JSON.stringify({ jobId: 'job-2' }));
    expect(readPendingDesignerJob(key)).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('clears', () => {
    writePendingDesignerJob(key, record(Date.now()));
    clearPendingDesignerJob(key);
    expect(localStorage.getItem(key)).toBeNull();
  });
});

it('designerOutput defaults to a platform batch with usage (the producer’s shape)', () => {
  expect(designerOutput().usage).toEqual({ used: 12, cap: 500, resetAt: '2026-10-01T00:00:00.000Z' });
  expect(designerOutput({ source: 'tenant' }).usage).toBeNull();
});
