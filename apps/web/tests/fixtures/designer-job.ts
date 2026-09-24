/**
 * AI Designer background-job responses, cut from the PRODUCER (2026-09-23).
 *
 * The four endpoints (apps/api/src/templates/templates.controller.ts):
 *   POST generate-designer/jobs             → 202 `{ jobId: job.id, status: job.status }`
 *   GET  generate-designer/jobs/:id         → `DesignerJobView` (the service's `toDesignerJobView(row)`)
 *   POST generate-designer/jobs/:id/cancel  → `DesignerJobView`
 *   POST generate-designer/jobs/:id/again   → 202 `{ jobId: job.id, status: job.status }`
 *
 * Every piece of a view comes out of the API's own code — never typed from what the page wants:
 *   result   = designerJobResult(<AiService output>)        designer-jobs/designer-job-request.ts
 *   progress = storedProgress(<pipeline DesignerProgress>)  designer-jobs/designer-jobs.service.ts
 *   error    = designerJobErrorFor(<the thrown exception>)  designer-jobs/designer-job-error.ts
 *              (it runs the REAL AllExceptionsFilter), or — for the two failures the stale sweep
 *              writes in SQL — the literal `jsonb_build_object` + arguments read out of the service
 *   view     = toDesignerJobView(<row>)                     designer-jobs/designer-jobs.service.ts
 * and every body is JSON round-tripped, as HTTP delivers it.
 *
 * The AiService output mirrors `AiService.generateDesignerBoardCandidates`'s return (ai.service.ts:
 * `const candidates = built.map((b) => ({ name: baseName, html: b.html, screenWidth: sw,
 * screenHeight: sh, taurusWarnings: b.taurusWarnings, artDirection: b.artDirection, structure:
 * b.structure, … }))` and `return { candidates, batchId, source: resolved.source, usage,
 * ...(posPlan ? { boundTo: … } : {}) }`); each board's html goes through the pipeline's own
 * `sanitizeDesignerHtml`, and the three layouts are `designerStructuresFor(purpose, count)` — the
 * ones the pipeline draws. `designer-job-producer.test.ts` pins those producer lines (drift guard),
 * so a change on the API side turns a web test red instead of leaving this fixture stale.
 *
 * Same computed-path `require` as kept-pos-board.ts: API source never joins the web type program.
 */
import * as fs from 'fs';
import * as path from 'path';

// `DESIGNER_JOB_FIXTURE_API_SRC` points the fixture (and the drift guard) at a COPY of the API
// source — the negative-control hook: mutate a producer line in the copy, watch the guard go red,
// without touching the real API.
export const API_SRC = process.env.DESIGNER_JOB_FIXTURE_API_SRC || path.resolve(__dirname, '../../../api/src');
export const PRODUCER_FILES = {
  controller: path.join(API_SRC, 'templates', 'templates.controller.ts'),
  service: path.join(API_SRC, 'templates', 'designer-jobs', 'designer-jobs.service.ts'),
  request: path.join(API_SRC, 'templates', 'designer-jobs', 'designer-job-request.ts'),
  aiService: path.join(API_SRC, 'ai', 'ai.service.ts'),
};

/* eslint-disable @typescript-eslint/no-require-imports */
function apiModule<T>(rel: string): T {
  return require(path.join(API_SRC, `${rel}.ts`)) as T;
}
/** A class from the API's own @nestjs/common (the exceptions its code throws). */
function nest<T>(name: string): T {
  const common = require(require.resolve('@nestjs/common', { paths: [path.join(API_SRC, 'templates')] }));
  return common[name] as T;
}
/* eslint-enable @typescript-eslint/no-require-imports */

// ── structural copies of the API's shapes (never imported from API source) ───────────────────

export interface ProducedProgress { stage: string; candidate?: number; of?: number; message?: string; updatedAt: string }
export interface ProducedError { code: string; message: string; status: number }
export interface ProducedBoundTo { providerId: string; providerName: string; itemCount: number }
export interface ProducedBoard {
  name: string;
  html: string;
  screenWidth: number;
  screenHeight: number;
  taurusWarnings: string[];
  artDirection: string;
  structure: string;
}
export interface ProducedOutput {
  candidates: ProducedBoard[];
  batchId: string;
  source: 'tenant' | 'platform';
  usage: { used: number; cap: number; resetAt: string } | null;
  boundTo?: ProducedBoundTo;
}
export interface ProducedResult {
  candidates: ProducedBoard[];
  designer: true;
  batchId: string;
  ai: { source: 'tenant' | 'platform'; usage: { used: number; cap: number; resetAt: string } | null };
  boundTo?: ProducedBoundTo;
}
export type ProducedStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export interface ProducedJobView {
  id: string;
  status: ProducedStatus;
  progress: ProducedProgress | null;
  result?: ProducedResult;
  error?: ProducedError;
  createdAt: string;
  finishedAt: string | null;
}
export interface ProducedStarted { jobId: string; status: ProducedStatus }

type RequestModule = { designerJobResult: (out: ProducedOutput) => unknown };
type ServiceModule = {
  toDesignerJobView: (row: Record<string, unknown>) => unknown;
  storedProgress: (p: { stage: string; candidate?: number; of?: number; message?: string }, now?: Date) => unknown;
  DESIGNER_JOBS_BUSY_CODE: string;
};
type ErrorModule = {
  designerJobErrorFor: (e: unknown, ctx?: { userId?: string | null }) => ProducedError;
  DESIGNER_JOB_STALLED_CODE: string;
  DESIGNER_JOB_EXPIRED_CODE: string;
};
type StructuresModule = { designerStructuresFor: (purpose: string, count?: number) => Array<{ id: string; label: string }> };
type PromptModule = { sanitizeDesignerHtml: (raw: unknown) => { html: string; taurusWarnings: string[] } };
type BindingModule = {
  menuBindingIncomplete: (plan: { providerId: string; providerName: string; connectionId: string; items: unknown[] }, missing: number[]) => unknown;
};

const json = <T>(v: unknown): T => JSON.parse(JSON.stringify(v)) as T;

// ── the AiService answer ────────────────────────────────────────────────────────────────────

/** A board small enough for jsdom (three of them render as srcdoc iframes), valid for the pipeline. */
export function boardHtml(headline = 'Tacos'): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8"><style>.stage{width:1920px;height:1080px}' +
    'h1{font:900 120px/1 sans-serif}</style></head><body><div class="stage">' +
    `<h1 data-field="headline">${headline}</h1><p data-field="subhead">Fresh every day</p></div></body></html>`
  );
}

export interface OutputOptions {
  purpose?: 'menu' | 'offer' | 'event' | 'announcement' | 'welcome';
  count?: number;
  width?: number;
  height?: number;
  /** What `baseName` becomes: `(opts.venueName || prompt).trim().slice(0, 60)`. */
  name?: string;
  batchId?: string;
  source?: 'tenant' | 'platform';
  boundTo?: ProducedBoundTo | null;
}

/** `AiService.generateDesignerBoardCandidates`'s answer, assembled the way that method assembles it. */
export function designerOutput(opts: OutputOptions = {}): ProducedOutput {
  const { sanitizeDesignerHtml } = apiModule<PromptModule>('ai/designer-prompt');
  const { designerStructuresFor } = apiModule<StructuresModule>('ai/designer-structures');
  const width = opts.width ?? 3840;
  const height = opts.height ?? 2160;
  const baseName = (opts.name ?? 'Super Taco').trim().slice(0, 60) || 'AI Designer board';
  const structures = designerStructuresFor(opts.purpose ?? 'menu', opts.count ?? 3);
  const candidates = structures.map((s, i) => {
    const clean = sanitizeDesignerHtml(boardHtml(`Option ${i + 1}`));
    return {
      name: baseName,
      html: clean.html,
      screenWidth: width,
      screenHeight: height,
      taurusWarnings: clean.taurusWarnings,
      artDirection: s.label,
      structure: s.id,
    };
  });
  const source = opts.source ?? 'platform';
  return {
    candidates,
    batchId: opts.batchId ?? '5b0a3c2e-0000-4000-8000-000000000001',
    source,
    usage: source === 'platform' ? { used: 12, cap: 500, resetAt: '2026-10-01T00:00:00.000Z' } : null,
    ...(opts.boundTo ? { boundTo: opts.boundTo } : {}),
  };
}

/** A finished job's `result`: what the synchronous endpoint would have answered. */
export function producedResult(out: ProducedOutput = designerOutput()): ProducedResult {
  const { designerJobResult } = apiModule<RequestModule>('templates/designer-jobs/designer-job-request');
  return json<ProducedResult>(designerJobResult(out));
}

/** What a job's `progress` column holds after the pipeline reports a stage. */
export function producedProgress(stage: string, candidate?: number, of?: number): ProducedProgress {
  const { storedProgress } = apiModule<ServiceModule>('templates/designer-jobs/designer-jobs.service');
  return json<ProducedProgress>(
    storedProgress(
      { stage, ...(candidate !== undefined ? { candidate } : {}), ...(of !== undefined ? { of } : {}) },
      new Date('2026-09-23T18:00:05.000Z'),
    ),
  );
}

// ── failures ────────────────────────────────────────────────────────────────────────────────

/**
 * A thrown error → the envelope a failed job stores (the REAL AllExceptionsFilter decides it).
 * `production` runs the filter as production does, where a non-HTTP error's message is masked.
 */
export function producedError(e: unknown, opts: { production?: boolean } = {}): ProducedError {
  const { designerJobErrorFor } = apiModule<ErrorModule>('templates/designer-jobs/designer-job-error');
  const env = process.env as Record<string, string | undefined>;
  const was = env.NODE_ENV;
  if (opts.production) env.NODE_ENV = 'production';
  try {
    return json<ProducedError>(designerJobErrorFor(e, { userId: 'user-a' }));
  } finally {
    env.NODE_ENV = was;
  }
}

/**
 * The 402 the organisation's used-up AI allowance throws (AiService.capReachedError — private, so
 * its payload is read out of ai.service.ts: the message, the code and the HttpStatus it uses).
 */
export function capReachedError(resetDay = 'October 1'): ProducedError {
  const src = fs.readFileSync(PRODUCER_FILES.aiService, 'utf8');
  const m = /private capReachedError\([^)]*\): HttpException \{[\s\S]*?message:\s*`([^`]*)` \+\s*'([^']*)',\s*code: 'AI_CAP_REACHED',[\s\S]*?HttpStatus\.([A-Z_]+)/.exec(src);
  if (!m) throw new Error('designer-job fixture: AiService.capReachedError is no longer where this fixture reads it');
  const status = nest<Record<string, number>>('HttpStatus')[m[3]];
  const message = m[1].replace(/\$\{resetDay\}/, resetDay) + m[2];
  return producedError(httpException({ message, code: 'AI_CAP_REACHED', cap: 500, used: 500, unit: 'credits', resetAt: '2026-10-01T00:00:00.000Z' }, status));
}

/**
 * The body of `export function <name>(…): string { … }` in a source file — the producer's own code,
 * lifted out so it runs without loading its module (and that module's import graph).
 */
export function exportedFunctionBody(src: string, name: string): string {
  const start = src.indexOf(`export function ${name}(`);
  if (start < 0) throw new Error(`designer-job fixture: ${name} is no longer exported where this fixture reads it`);
  const open = src.indexOf('): string {', start);
  if (open < 0) throw new Error(`designer-job fixture: ${name} no longer returns a string`);
  let i = src.indexOf('{', open);
  const bodyStart = i + 1;
  for (let depth = 0; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(bodyStart, i);
  }
  throw new Error(`designer-job fixture: ${name}'s body never closes`);
}

export interface BoardsCapOptions {
  needed?: number;
  left?: number;
  resetAt?: string;
  purchaseEnabled?: boolean;
  kind?: 'batch' | 'refine';
}

/**
 * The 402 the Designer's BOARD pre-check throws (AiAllowanceService.assertBoardsAvailable,
 * 2026-09-23) — what a batch refused for want of boards fails with. Its message is
 * `boardsCapMessage(…)` from ai/ai-board-credits.ts, a module this fixture must NOT load (its
 * import graph reaches the model catalog and the platform keys), so the function's OWN body is
 * lifted out of the source and run by itself; the code and the HttpStatus are read out of the
 * service; the REAL AllExceptionsFilter turns it into the stored envelope.
 */
export function boardsCapReachedError(o: BoardsCapOptions = {}): ProducedError {
  const credits = fs.readFileSync(path.join(API_SRC, 'ai', 'ai-board-credits.ts'), 'utf8');
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const boardsCapMessage = new Function('o', exportedFunctionBody(credits, 'boardsCapMessage')) as (
    opts: Required<BoardsCapOptions>,
  ) => string;
  const message = boardsCapMessage({
    needed: 3,
    left: 1,
    resetAt: '2026-10-01T00:00:00.000Z',
    purchaseEnabled: true,
    kind: 'batch',
    ...o,
  });
  const svc = fs.readFileSync(path.join(API_SRC, 'ai', 'ai-allowance.service.ts'), 'utf8');
  const m = /async assertBoardsAvailable\([\s\S]*?message: boardsCapMessage\([\s\S]*?code: 'AI_CAP_REACHED',[\s\S]*?HttpStatus\.([A-Z_]+)/.exec(svc);
  if (!m) throw new Error('designer-job fixture: assertBoardsAvailable no longer throws where this fixture reads it');
  const status = nest<Record<string, number>>('HttpStatus')[m[1]];
  return producedError(httpException({ message, code: 'AI_CAP_REACHED', unit: 'boards' }, status));
}

/** The POS-bound pipeline's own "N items don't fit one screen" (designer-pos-binding.ts). */
export function menuBindingIncompleteError(items = 21, missing: number[] = [18, 19, 20]): ProducedError {
  const { menuBindingIncomplete } = apiModule<BindingModule>('ai/designer-pos-binding');
  const plan = {
    providerId: 'toast',
    providerName: 'Toast',
    connectionId: 'conn-toast',
    items: Array.from({ length: items }, (_v, n) => ({
      n,
      externalId: `item-${n}`,
      name: `Item ${n}`,
      priceCents: 500,
      priceText: '$5.00',
      section: 'Tacos',
    })),
  };
  return producedError(menuBindingIncomplete(plan, missing));
}

/** An HttpException built by the API's own @nestjs/common — for a payload a spec names by hand. */
export function httpException(payload: Record<string, unknown>, status: number): unknown {
  const HttpException = nest<new (p: unknown, s: number) => unknown>('HttpException');
  return new HttpException(payload, status);
}

/** A `ServiceUnavailableException(message)` — the pipeline's "could not design a usable board". */
export function serviceUnavailable(message: string): unknown {
  const ServiceUnavailableException = nest<new (m: string) => unknown>('ServiceUnavailableException');
  return new ServiceUnavailableException(message);
}

/**
 * The envelope the stale sweep writes for a job whose worker died twice (`stalled`) or that no
 * worker ever claimed (`expired`). It is built in SQL, so it is read out of the service source:
 * `jsonb_build_object('code', $2::text, 'message', $3::text, 'status', <n>)` followed, in the
 * argument list, by `<CODE_CONSTANT>, '<message>'`.
 */
export function sweepError(which: 'stalled' | 'expired'): ProducedError {
  const errors = apiModule<ErrorModule>('templates/designer-jobs/designer-job-error');
  const constant = which === 'stalled' ? 'DESIGNER_JOB_STALLED_CODE' : 'DESIGNER_JOB_EXPIRED_CODE';
  const code = which === 'stalled' ? errors.DESIGNER_JOB_STALLED_CODE : errors.DESIGNER_JOB_EXPIRED_CODE;
  const src = fs.readFileSync(PRODUCER_FILES.service, 'utf8');
  const re = new RegExp(
    "jsonb_build_object\\('code', \\$2::text, 'message', \\$3::text, 'status', (\\d+)\\)[^`]*`,[^;]*?" +
      constant +
      ",\\s*'([^']+)'",
  );
  const m = re.exec(src);
  if (!m) throw new Error(`designer-job fixture: the stale sweep's ${which} envelope is no longer where this fixture reads it`);
  return { code, message: m[2], status: Number(m[1]) };
}

// ── views ───────────────────────────────────────────────────────────────────────────────────

export interface ViewOptions {
  progress?: ProducedProgress | null;
  result?: ProducedResult;
  error?: ProducedError;
  createdAt?: string;
  finishedAt?: string | null;
}

/** `GET …/jobs/:id` (and `…/cancel`) for a row in this state. */
export function producedJobView(id: string, status: ProducedStatus, opts: ViewOptions = {}): ProducedJobView {
  const { toDesignerJobView } = apiModule<ServiceModule>('templates/designer-jobs/designer-jobs.service');
  const finished = status === 'done' || status === 'failed' || status === 'cancelled';
  const row = {
    id,
    status,
    progress: opts.progress === undefined ? null : opts.progress,
    // A row carries every column; the view shows `result` only when done, `error` only when failed.
    result: opts.result ?? null,
    error: opts.error ?? null,
    createdAt: new Date(opts.createdAt ?? '2026-09-23T18:00:00.000Z'),
    finishedAt:
      opts.finishedAt === null ? null : finished ? new Date(opts.finishedAt ?? '2026-09-23T18:02:00.000Z') : null,
  };
  return json<ProducedJobView>(toDesignerJobView(row));
}

/** `POST …/jobs` and `POST …/jobs/:id/again` answer the created job as `{ jobId: job.id, status: job.status }`. */
export function producedStarted(id: string): ProducedStarted {
  const view = producedJobView(id, 'queued');
  return { jobId: view.id, status: view.status };
}

/** The 429 `POST …/jobs` answers when the account already has two generations running. */
export function busyError(): ProducedError {
  const { DESIGNER_JOBS_BUSY_CODE } = apiModule<ServiceModule>('templates/designer-jobs/designer-jobs.service');
  const src = fs.readFileSync(PRODUCER_FILES.service, 'utf8');
  // create(): `throw new HttpException({ code: DESIGNER_JOBS_BUSY_CODE, message: '…' }, HttpStatus.TOO_MANY_REQUESTS)`
  const m = /code: DESIGNER_JOBS_BUSY_CODE,\s*message:\s*'([^']+)',\s*\},\s*HttpStatus\.([A-Z_]+)/.exec(src);
  if (!m) throw new Error('designer-job fixture: the busy (429) payload is no longer where this fixture reads it');
  const status = nest<Record<string, number>>('HttpStatus')[m[2]];
  return producedError(httpException({ code: DESIGNER_JOBS_BUSY_CODE, message: m[1] }, status));
}

/** Read `new <ExceptionClass>({ code: '<code>', message: '<message>' })` out of the controller. */
function controllerException(code: string): ProducedError {
  const src = fs.readFileSync(PRODUCER_FILES.controller, 'utf8');
  const m = new RegExp(`new (\\w+Exception)\\(\\{\\s*code: '${code}',\\s*message: '([^']+)'`).exec(src);
  if (!m) throw new Error(`designer-job fixture: the controller no longer throws ${code} where this fixture reads it`);
  const Exception = nest<new (payload: unknown) => unknown>(m[1]);
  return producedError(new Exception({ code, message: m[2] }));
}

/** GET / cancel / again of an id that is not this account's (or was pruned): the controller's 404. */
export function jobNotFoundError(): ProducedError {
  return controllerException('AI_DESIGN_JOB_NOT_FOUND');
}

/** …/again of a job whose stored request no longer validates: the controller's 422. */
export function jobRequestInvalidError(): ProducedError {
  return controllerException('AI_DESIGN_JOB_REQUEST_INVALID');
}

/**
 * An `apiFetch` error for a failed response carrying this envelope — what the page's hooks reject
 * with (api-client.ts: `new Error(body.message)` + `status`, `code`, `body`). The filter's body is
 * `{ error: true, code, message }`.
 */
export function apiFetchError(env: ProducedError): Error & { status: number; code: string; body: unknown } {
  const err = new Error(env.message) as Error & { status: number; code: string; body: unknown };
  err.status = env.status;
  err.code = env.code;
  err.body = { error: true, code: env.code, message: env.message };
  return err;
}
