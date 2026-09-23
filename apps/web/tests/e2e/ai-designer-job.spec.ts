/**
 * AI DESIGNER — generation through a background job, in a real browser (2026-09-23), chromium + webkit.
 *
 * The dashboard's Designer no longer awaits the synchronous generate-designer/candidates request
 * (which skips the render → critique → revise loop): it STARTS a job, POLLS it every 2 s while the
 * tab is visible, shows where it is in operator words with a Cancel, and lands the boards in the
 * pick grid. A reload mid-job picks the SAME job back up. This drives the real /templates route
 * against the dev server with every API call intercepted (the builder specs' harness), and the job
 * bodies cut from the API producer (tests/fixtures/designer-job.ts — the same fixture the jest
 * suites use).
 *
 *   E2E_BASE=http://localhost:3100 pnpm exec playwright test -c playwright.sandbox.config.ts tests/e2e/ai-designer-job.spec.ts
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import {
  designerOutput,
  producedJobView,
  producedProgress,
  producedResult,
  producedStarted,
  type ProducedJobView,
} from '../fixtures/designer-job';

const SCHOOL_ID = 'e2e-school';
const ORIGIN = process.env.E2E_BASE || 'http://localhost:3000';
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
};
const FAKE_USER = { id: 'u1', email: 'e2e@example.com', role: 'SCHOOL_ADMIN', tenantId: SCHOOL_ID, canTriggerPanic: false };
const BOUND = { providerId: 'toast', providerName: 'Toast', itemCount: 9 };

interface JobApi {
  starts: Array<Record<string, unknown>>;
  cancels: string[];
  gets: string[];
  /** Successive GET answers per job id; the last one repeats. */
  timeline: Map<string, ProducedJobView[]>;
}

async function installApiMocks(page: Page, api: JobApi) {
  const cors = (route: Route, respond: () => unknown) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' })
      : respond();
  const okJson = (route: Route, body: unknown, status = 200) =>
    cors(route, () => route.fulfill({ status, contentType: 'application/json', headers: CORS_HEADERS, body: JSON.stringify(body) }));
  const empty = (route: Route) => cors(route, () => route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' }));

  // Broadest catch-alls FIRST (Playwright matches last-registered first).
  await page.route(/http:\/\/api\.invalid\/.*/, empty);
  await page.route('**/api/v1/**', empty);
  await page.route('**/auth/me', (route) => okJson(route, FAKE_USER));
  await page.route('**/tenants', (route) => okJson(route, [{ id: SCHOOL_ID, name: 'Super Taco', slug: SCHOOL_ID, vertical: 'RESTAURANT' }]));
  await page.route('**/tenants/accessible', (route) => okJson(route, [{ id: SCHOOL_ID, name: 'Super Taco', slug: SCHOOL_ID }]));
  await page.route('**/templates', (route) => okJson(route, []));
  await page.route('**/templates/usage-summary', (route) => okJson(route, {}));
  await page.route('**/screens', (route) => okJson(route, []));
  await page.route('**/branding/me', (route) => okJson(route, {}));
  await page.route('**/ai/key', (route) => okJson(route, { usage: { source: 'platform', used: 0, cap: 500 } }));
  // The brief-echo read finds nothing to confirm → the page generates straight away.
  await page.route('**/templates/generate-designer/brief', (route) => okJson(route, { brief: null, ai: { source: 'platform' } }));
  // A route that must NEVER be called again from the dashboard.
  await page.route('**/templates/generate-designer/candidates', (route) => okJson(route, { error: true, code: 'E2E_SYNC_CALLED', message: 'sync endpoint called' }, 500));

  // ── the four job routes ──
  await page.route('**/templates/generate-designer/jobs', (route) =>
    cors(route, () => {
      api.starts.push(JSON.parse(route.request().postData() || '{}'));
      return route.fulfill({ status: 202, contentType: 'application/json', headers: CORS_HEADERS, body: JSON.stringify(producedStarted('job-e2e')) });
    }),
  );
  await page.route(/\/templates\/generate-designer\/jobs\/[^/?]+(\?.*)?$/, (route) =>
    cors(route, () => {
      const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() as string);
      api.gets.push(id);
      const tl = api.timeline.get(id);
      if (!tl) return okJson(route, { error: true, code: 'AI_DESIGN_JOB_NOT_FOUND', message: 'That board generation was not found.' }, 404);
      const view = tl.length > 1 ? (tl.shift() as ProducedJobView) : tl[0];
      return okJson(route, view);
    }),
  );
  await page.route(/\/templates\/generate-designer\/jobs\/[^/]+\/cancel$/, (route) =>
    cors(route, () => {
      const parts = new URL(route.request().url()).pathname.split('/');
      const id = decodeURIComponent(parts[parts.length - 2]);
      api.cancels.push(id);
      const cancelled = producedJobView(id, 'cancelled', { progress: producedProgress('drawing', 1, 3) });
      api.timeline.set(id, [cancelled]);
      return okJson(route, cancelled);
    }),
  );
}

function jobApi(): JobApi {
  return { starts: [], cancels: [], gets: [], timeline: new Map() };
}

async function openTemplates(page: Page, api: JobApi, seed?: Record<string, string>) {
  await installApiMocks(page, api);
  await page.addInitScript((entries: Record<string, string>) => {
    try {
      localStorage.setItem('edu_cms_eula_accepted_v1.0', '1');
      for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  }, seed || {});
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${SCHOOL_ID}/templates`, { waitUntil: 'domcontentloaded' });
}

/** Open the dialog, take the guided form's one-screen view, pick the Designer, describe, Generate. */
async function generateWithDesigner(page: Page) {
  await page.getByRole('button', { name: /generate with ai/i }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Generate a template with AI')).toBeVisible({ timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Use the guided form instead' }).click();
  await dialog.getByRole('button', { name: /I know what I want/ }).click();
  await dialog.getByRole('button', { name: /Designer \(HTML\)/ }).click();
  await dialog.getByPlaceholder(/What should it say\?/).fill('A menu board for Super Taco — tacos, burritos and drinks');
  await dialog.getByRole('button', { name: /Generate 3 options/ }).click();
  return dialog;
}

test.describe('AI Designer — a generation is a background job', () => {
  test.setTimeout(180_000);

  test('start → progress in operator words (with Cancel) → the boards in the pick grid, bound badge and all', async ({ page }) => {
    const api = jobApi();
    api.timeline.set('job-e2e', [
      producedJobView('job-e2e', 'queued'),
      producedJobView('job-e2e', 'running', { progress: producedProgress('reviewing', 2, 3) }),
      producedJobView('job-e2e', 'done', { progress: producedProgress('done', undefined, 3), result: producedResult(designerOutput({ boundTo: BOUND })) }),
    ]);
    await openTemplates(page, api);
    const dialog = await generateWithDesigner(page);

    const progress = dialog.getByTestId('designer-job-progress');
    await expect(progress).toBeVisible();
    await expect(progress.getByRole('status')).toHaveText('Looking at option 2…', { timeout: 15_000 });
    await expect(progress.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeDisabled();

    await expect(dialog.getByText('Pick your favorite')).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByTestId('designer-bound-badge')).toHaveText('Bound to Toast · 9 items');
    await expect(dialog.getByText('Rail + cards').first()).toBeVisible();
    await expect(dialog.getByText('Leader rows').first()).toBeVisible();
    await expect(progress).toHaveCount(0);

    expect(api.starts).toHaveLength(1);
    expect(api.starts[0]).toMatchObject({ screenWidth: 3840, screenHeight: 2160, count: 3 });
    expect(String(api.starts[0].idempotencyKey)).toMatch(/^[A-Za-z0-9._:-]{8,100}$/);
    // Finished → no more reads.
    const reads = api.gets.length;
    await page.waitForTimeout(4_500);
    expect(api.gets.length).toBe(reads);
  });

  test('Cancel stops the job and returns to the form, quietly', async ({ page }) => {
    const api = jobApi();
    api.timeline.set('job-e2e', [producedJobView('job-e2e', 'running', { progress: producedProgress('drawing', 1, 3) })]);
    await openTemplates(page, api);
    const dialog = await generateWithDesigner(page);

    const progress = dialog.getByTestId('designer-job-progress');
    await expect(progress.getByRole('status')).toHaveText('Drawing 3 boards…', { timeout: 15_000 });
    await progress.getByRole('button', { name: 'Cancel' }).click();

    await expect(progress).toHaveCount(0, { timeout: 10_000 });
    expect(api.cancels).toEqual(['job-e2e']);
    await expect(dialog.getByRole('button', { name: /Generate 3 options/ })).toBeVisible();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
  });

  test('a reload mid-job reopens the dialog on the SAME job and lands its boards — no second batch', async ({ page }) => {
    const api = jobApi();
    api.timeline.set('job-7', [
      producedJobView('job-7', 'running', { progress: producedProgress('revising', 3, 3) }),
      producedJobView('job-7', 'done', { result: producedResult(designerOutput()) }),
    ]);
    const pending = JSON.stringify({
      jobId: 'job-7',
      ts: Date.now(),
      canvas: { w: 3840, h: 2160 },
      interactive: false,
      brief: null,
      replay: null,
    });
    await openTemplates(page, api, { [`vos:ai:job:${SCHOOL_ID}`]: pending });

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('designer-job-progress').getByRole('status')).toHaveText('Fixing option 3…', { timeout: 60_000 });
    await expect(dialog.getByText('Pick your favorite')).toBeVisible({ timeout: 15_000 });
    expect(api.starts).toHaveLength(0);
  });
});
