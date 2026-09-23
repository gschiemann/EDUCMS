/**
 * DRIFT GUARD for the AI Designer job fixtures (tests/fixtures/designer-job.ts, 2026-09-23).
 *
 * The web's job tests are fed bodies built by the API's own code (designerJobResult,
 * toDesignerJobView, storedProgress, designerJobErrorFor). Two things around those functions are
 * NOT code the fixture can call, so this file pins them in the producer's source instead — the
 * binding rule for a fixture (memory: "a fixture must be cut from the PRODUCER"): if the API
 * changes one of these, a web test goes red instead of a fixture going quietly stale.
 *
 *   1. The controller: the four routes the hooks call, and what each returns (start / again
 *      answer `{ jobId: job.id, status: job.status }`; read / cancel answer the service's view).
 *   2. AiService.generateDesignerBoardCandidates's return — the object `designerOutput()` mirrors.
 *   3. The stages the pipeline can report — every one must have operator copy on the web.
 */
import * as fs from 'fs';
import { useTranslations } from 'next-intl';
import {
  API_SRC,
  PRODUCER_FILES,
  busyError,
  designerOutput,
  producedJobView,
  producedProgress,
  producedResult,
  producedStarted,
  sweepError,
} from '../../../tests/fixtures/designer-job';
import { designerJobStageMessage } from '../designer-jobs';

const read = (file: string) => fs.readFileSync(file, 'utf8');

describe('the controller the hooks talk to', () => {
  const src = read(PRODUCER_FILES.controller);

  it('serves the four job routes under /api/v1/templates, with the verbs the hooks use', () => {
    expect(src).toMatch(/@Controller\('api\/v1\/templates'\)\s*@UseGuards\(JwtAuthGuard, RbacGuard\)\s*export class TemplatesController/);
    const routes = Array.from(src.matchAll(/@(Post|Get)\('(generate-designer\/jobs[^']*)'\)/g)).map((m) => `${m[1].toUpperCase()} ${m[2]}`);
    expect(routes).toEqual([
      'POST generate-designer/jobs',
      'GET generate-designer/jobs/:id',
      'POST generate-designer/jobs/:id/cancel',
      'POST generate-designer/jobs/:id/again',
      // 2026-09-23 (2ced15e7) — the AI board HISTORY list; no job hook calls it yet (the history
      // UI is a separate piece). This guard went red the moment it landed, as it should.
      'GET generate-designer/jobs',
    ]);
  });

  it('start and again answer { jobId: job.id, status: job.status } — what producedStarted() builds', () => {
    expect(src.match(/return \{ jobId: job\.id, status: job\.status \};/g)).toHaveLength(2);
    expect(producedStarted('job-1')).toEqual({ jobId: 'job-1', status: 'queued' });
  });

  it('read and cancel answer the service view as-is (toDesignerJobView — what producedJobView() builds)', () => {
    expect(src).toMatch(/async getDesignerJob\([\s\S]*?\): Promise<DesignerJobView> \{\s*const job = await this\.designerJobsOrThrow\(\)\.get\(req\.user\.tenantId, id\);\s*if \(!job\) throw this\.designerJobNotFound\(\);\s*return job;/);
    expect(src).toMatch(/async cancelDesignerJob\([\s\S]*?\): Promise<DesignerJobView> \{\s*const job = await this\.designerJobsOrThrow\(\)\.cancel\(req\.user\.tenantId, id\);\s*if \(!job\) throw this\.designerJobNotFound\(\);\s*return job;/);
    const service = read(PRODUCER_FILES.service);
    expect(service).toMatch(/async get\(tenantId: string, jobId: string\): Promise<DesignerJobView \| null> \{[\s\S]*?return row \? toDesignerJobView\(row\) : null;/);
  });

  it('a job that is not this account’s is a 404 AI_DESIGN_JOB_NOT_FOUND (what the page reads as "gone")', () => {
    expect(src).toMatch(/new NotFoundException\(\{ code: 'AI_DESIGN_JOB_NOT_FOUND'/);
  });
});

describe('the AiService answer designerOutput() mirrors', () => {
  const src = read(PRODUCER_FILES.aiService);

  it('builds each candidate as { name: baseName, html, screenWidth, screenHeight, taurusWarnings, artDirection, structure }', () => {
    expect(src).toMatch(
      /const candidates = built\.map\(\(b\) => \(\{\s*name: baseName,\s*html: b\.html,\s*screenWidth: sw,\s*screenHeight: sh,\s*taurusWarnings: b\.taurusWarnings,\s*artDirection: b\.artDirection,\s*structure: b\.structure,/,
    );
    const board = designerOutput().candidates[0];
    expect(Object.keys(board).sort()).toEqual(['artDirection', 'html', 'name', 'screenHeight', 'screenWidth', 'structure', 'taurusWarnings']);
  });

  it('returns { candidates, batchId, source, usage } plus boundTo only when POS-bound', () => {
    expect(src).toMatch(
      /return \{\s*candidates,\s*batchId,\s*source: resolved\.source,\s*usage,\s*\.\.\.\(posPlan \? \{ boundTo: \{ providerId: posPlan\.providerId, providerName: posPlan\.providerName, itemCount: posPlan\.items\.length \} \} : \{\}\),\s*\};/,
    );
    expect(Object.keys(designerOutput()).sort()).toEqual(['batchId', 'candidates', 'source', 'usage']);
    const bound = designerOutput({ boundTo: { providerId: 'toast', providerName: 'Toast', itemCount: 9 } });
    expect(bound.boundTo).toEqual({ providerId: 'toast', providerName: 'Toast', itemCount: 9 });
  });

  it('the layouts are the ones the pipeline draws, labelled the way it labels them', () => {
    expect(src).toMatch(/artDirection: structures\[i\]\?\.label \|\| `option-\$\{i \+ 1\}`, structure: structures\[i\]\?\.id \|\| `option-\$\{i \+ 1\}`/);
    expect(designerOutput().candidates.map((c) => [c.structure, c.artDirection])).toEqual([
      ['rail-cards', 'Rail + cards'],
      ['hero-cards', 'Hero + cards'],
      ['leader-rows', 'Leader rows'],
    ]);
  });
});

describe('what the fixture hands the web (built by the producer)', () => {
  it('a finished job carries exactly the synchronous response, fit engine baked in', () => {
    const result = producedResult(designerOutput({ boundTo: { providerId: 'toast', providerName: 'Toast', itemCount: 9 } }));
    expect(result.designer).toBe(true);
    expect(result.batchId).toBe('5b0a3c2e-0000-4000-8000-000000000001');
    expect(result.ai).toEqual({ source: 'platform', usage: { used: 12, cap: 500, resetAt: '2026-10-01T00:00:00.000Z' } });
    expect(result.boundTo).toEqual({ providerId: 'toast', providerName: 'Toast', itemCount: 9 });
    // designerJobResult bakes the layout engine into every board (injectDesignerLayoutEngine).
    for (const c of result.candidates) expect(c.html.length).toBeGreaterThan(designerOutput().candidates[0].html.length);
  });

  it('a view shows result only when done and error only when failed', () => {
    const result = producedResult();
    const done = producedJobView('j1', 'done', { result, progress: producedProgress('done', undefined, 3) });
    expect(done.result).toEqual(result);
    expect(done.error).toBeUndefined();
    expect(done.finishedAt).toBe('2026-09-23T18:02:00.000Z');
    const running = producedJobView('j1', 'running', { result, progress: producedProgress('reviewing', 2, 3) });
    expect(running.result).toBeUndefined();
    expect(running.finishedAt).toBeNull();
    expect(running.progress).toEqual({ stage: 'reviewing', candidate: 2, of: 3, updatedAt: '2026-09-23T18:00:05.000Z' });
    const failed = producedJobView('j1', 'failed', { error: sweepError('stalled') });
    expect(failed.error).toEqual({ code: 'AI_DESIGN_JOB_STALLED', message: 'The board generation stopped unexpectedly twice. Try again.', status: 503 });
  });

  it('the stale sweep’s two envelopes and the 429 are read out of the service source', () => {
    expect(sweepError('expired')).toEqual({ code: 'AI_DESIGN_JOB_EXPIRED', message: 'The board generation never started. Try again.', status: 503 });
    const busy = busyError();
    expect(busy.status).toBe(429);
    expect(busy.code).toBe('AI_DESIGN_JOBS_BUSY');
    expect(busy.message).toMatch(/already being designed/);
  });
});

describe('every stage the pipeline reports has operator copy', () => {
  const hooksSrc = read(`${API_SRC}/ai/designer-generation-hooks.ts`);
  const union = /export type DesignerStage =([\s\S]*?);/.exec(hooksSrc)?.[1] ?? '';
  const stages = Array.from(union.matchAll(/'([a-z]+)'/g)).map((m) => m[1]);
  const t = useTranslations('aiBoards') as unknown as (key: string, values?: Record<string, string | number>) => string;
  const fallback = 'Designing your boards…';

  it('reads the stage union from the API (drawing / binding / rendering / reviewing / revising / done)', () => {
    expect(stages).toEqual(['drawing', 'binding', 'rendering', 'reviewing', 'revising', 'done']);
  });

  it.each([
    [producedProgress('drawing', 2, 3), 'Drawing 3 boards…'],
    [producedProgress('drawing', 1, 1), 'Drawing 1 board…'],
    [producedProgress('binding', 2, 3), 'Checking the details…'],
    [producedProgress('rendering', 2, 3), 'Previewing option 2…'],
    [producedProgress('reviewing', 2, 3), 'Looking at option 2…'],
    [producedProgress('revising', 2, 3), 'Fixing option 2…'],
    [producedProgress('done', 1, 3), 'Option 1 is ready…'],
    [producedProgress('done', undefined, 3), 'Finishing up…'],
  ])('%j → %s', (progress, line) => {
    expect(designerJobStageMessage(t, { status: 'running', progress })).toBe(line);
  });

  it('no stage the pipeline emits falls through to the generic line', () => {
    for (const stage of stages) {
      expect(designerJobStageMessage(t, { status: 'running', progress: producedProgress(stage, 2, 3) })).not.toBe(fallback);
      expect(designerJobStageMessage(t, { status: 'running', progress: producedProgress(stage, undefined, 3) })).not.toBe(fallback);
    }
  });
});
