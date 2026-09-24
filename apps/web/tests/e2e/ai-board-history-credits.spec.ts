/**
 * AI board HISTORY + board CREDITS in a real browser (2026-09-23), chromium + webkit.
 *
 * The /templates route against the dev server with every API call intercepted (the harness of
 * ai-designer-job.spec.ts), the bodies cut from the producer (tests/fixtures/ai-boards.ts — the
 * same fixture the jest suites use):
 *
 *   - the line under Generate: "14 of 20 boards left this month · resets Oct 1" → Buy more → the
 *     packs → one tap → the same-tab redirect to Stripe's page (intercepted here);
 *   - History → the finished batches → one reopens in the pick grid → Keep posts batchId +
 *     candidateIndex → Back to the list;
 *   - a batch refused for want of boards: the server's words, Buy more boards, Add your own AI key.
 *
 * `E2E_SHOTS=<dir>` saves a screenshot of each surface (phone width) for a human look.
 *
 *   E2E_BASE=http://localhost:3217 pnpm exec playwright test -c playwright.sandbox.config.ts tests/e2e/ai-board-history-credits.spec.ts
 */
import * as path from 'path';
import { test, expect, type Page, type Route } from '@playwright/test';
import { boardsCapReachedError } from '../fixtures/designer-job';
import {
  CHECKOUT_URL,
  historyBatchResult,
  historyContractItem,
  historyPage,
  historyPlainItem,
  jobView,
  platformAllowance,
  type JobViewLike,
  type ProducedAllowance,
} from '../fixtures/ai-boards';

const SCHOOL_ID = 'e2e-school';
const ORIGIN = process.env.E2E_BASE || 'http://localhost:3000';
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
};
const FAKE_USER = { id: 'u1', email: 'e2e@example.com', role: 'SCHOOL_ADMIN', tenantId: SCHOOL_ID, canTriggerPanic: false };
const KEPT = {
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
};

interface Api {
  allowance: ProducedAllowance;
  historyGets: string[];
  jobs: Map<string, JobViewLike[]>;
  creates: Array<Record<string, unknown>>;
  checkouts: Array<Record<string, unknown>>;
}

function api(): Api {
  return { allowance: platformAllowance(), historyGets: [], jobs: new Map(), creates: [], checkouts: [] };
}

async function shot(page: Page, name: string) {
  const dir = process.env.E2E_SHOTS;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${test.info().project.name}-${name}.png`) });
}

/**
 * A route on the API origin ONLY (`NEXT_PUBLIC_API_URL=http://api.invalid/api/v1` on the dev
 * server). A bare `**\/templates` glob also matches the PAGE (`/e2e-school/templates`) and answers
 * the document with JSON — anchoring to the API origin is the whole point.
 */
const API_ROOT = 'http://api.invalid/api/v1';
const at = (pathPattern: string) => new RegExp(`^${API_ROOT.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}${pathPattern}(\\?.*)?$`);

async function installApiMocks(page: Page, a: Api) {
  const cors = (route: Route, respond: () => unknown) =>
    route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' }) : respond();
  const okJson = (route: Route, body: unknown, status = 200) =>
    cors(route, () => route.fulfill({ status, contentType: 'application/json', headers: CORS_HEADERS, body: JSON.stringify(body) }));
  const empty = (route: Route) => cors(route, () => route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' }));

  // Broadest catch-all FIRST (Playwright matches last-registered first).
  await page.route(/^http:\/\/api\.invalid\//, empty);
  await page.route(at('/auth/me'), (route) => okJson(route, FAKE_USER));
  await page.route(at('/tenants'), (route) => okJson(route, [{ id: SCHOOL_ID, name: 'Super Taco', slug: SCHOOL_ID, vertical: 'RESTAURANT' }]));
  await page.route(at('/tenants/accessible'), (route) => okJson(route, [{ id: SCHOOL_ID, name: 'Super Taco', slug: SCHOOL_ID }]));
  await page.route(at('/templates'), (route) => okJson(route, [KEPT]));
  await page.route(at('/templates/usage-summary'), (route) => okJson(route, {}));
  await page.route(at('/screens'), (route) => okJson(route, []));
  await page.route(at('/branding/me'), (route) => okJson(route, {}));
  await page.route(at('/ai/key'), (route) => okJson(route, { usage: { source: 'platform', used: 0, cap: 500 } }));
  await page.route(at('/templates/generate-designer/brief'), (route) => okJson(route, { brief: null, ai: { source: 'platform' } }));

  // ── the surfaces under test ──
  await page.route(at('/ai/allowance'), (route) => okJson(route, a.allowance));
  await page.route(at('/templates/generate-designer/jobs'), (route) =>
    cors(route, () => {
      const url = new URL(route.request().url());
      if (route.request().method() === 'POST') {
        return route.fulfill({ status: 202, contentType: 'application/json', headers: CORS_HEADERS, body: JSON.stringify({ jobId: 'job-new', status: 'queued' }) });
      }
      // GET = the history list.
      const before = url.searchParams.get('before') || '';
      a.historyGets.push(before);
      const H1 = historyContractItem({ id: 'job-h1', createdAt: '2026-09-22T09:30:00.000Z', keptTemplateId: 'tpl-kept' });
      const H2 = historyPlainItem({ id: 'job-h2', createdAt: '2026-09-21T16:05:00.000Z', prompt: 'A portrait welcome board for the lobby' });
      return okJson(route, before ? historyPage([]) : historyPage([H1, H2]));
    }),
  );
  await page.route(at('/templates/generate-designer/jobs/[^/?]+'), (route) =>
    cors(route, () => {
      const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() as string);
      const answers = a.jobs.get(id);
      if (!answers) return okJson(route, { error: true, code: 'AI_DESIGN_JOB_NOT_FOUND', message: 'That board generation was not found.' }, 404);
      return okJson(route, answers.length > 1 ? answers.shift() : answers[0]);
    }),
  );
  await page.route(at('/templates/create-designer'), (route) =>
    cors(route, () => {
      const body = JSON.parse(route.request().postData() || '{}');
      a.creates.push(body);
      return okJson(route, { id: `tpl-created-${a.creates.length}`, name: body.name });
    }),
  );
  await page.route(at('/billing/ai-packs/checkout'), (route) =>
    cors(route, () => {
      a.checkouts.push(JSON.parse(route.request().postData() || '{}'));
      return okJson(route, { url: CHECKOUT_URL });
    }),
  );
  // Stripe's hosted page, stood in for: the redirect must land on it.
  await page.route('https://checkout.stripe.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Checkout</title><h1>Stripe Checkout (e2e stand-in)</h1>' }),
  );
}

/** A signed-in SCHOOL_ADMIN tab: the store boots from sessionStorage (ui-store.ts). Unsigned JWT, far exp. */
const b64url = (s: string) => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const FAKE_TOKEN = `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify({ sub: 'u1', exp: 4102444800 }))}.e2e`;

async function openTemplates(page: Page, a: Api, viewport = { width: 1280, height: 900 }) {
  await installApiMocks(page, a);
  await page.addInitScript(
    ({ token, user }: { token: string; user: string }) => {
      try {
        localStorage.setItem('edu_cms_eula_accepted_v1.0', '1');
        sessionStorage.setItem('edu_cms_token', token);
        sessionStorage.setItem('edu_cms_user', user);
      } catch {
        /* ignore */
      }
    },
    { token: FAKE_TOKEN, user: JSON.stringify(FAKE_USER) },
  );
  await page.setViewportSize(viewport);
  await page.goto(`/${SCHOOL_ID}/templates`, { waitUntil: 'domcontentloaded' });
}

async function openDialog(page: Page) {
  await page.getByRole('button', { name: /generate with ai/i }).first().click();
  const dialog = page.getByRole('dialog').first();
  await expect(dialog.getByText('Generate a template with AI')).toBeVisible({ timeout: 60_000 });
  return dialog;
}

test.describe('AI boards — what is left, buying more, and the history', () => {
  test.setTimeout(180_000);

  test('phone: "14 of 20 boards left this month · resets Oct 1" under Generate → Buy more → a pack → Stripe', async ({ page }) => {
    const a = api();
    await openTemplates(page, a, { width: 390, height: 844 });
    const dialog = await openDialog(page);
    const line = dialog.getByTestId('ai-boards-left');
    await expect(line).toContainText('14 of 20 boards left this month · resets Oct 1', { timeout: 30_000 });
    await line.scrollIntoViewIfNeeded();
    await shot(page, 'boards-line');

    await line.getByRole('button', { name: 'Buy more' }).click();
    const sheet = page.getByRole('dialog', { name: 'Buy more boards' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: /30 boards/ })).toBeVisible();
    await shot(page, 'buy-sheet');

    await sheet.getByRole('button', { name: /30 boards/ }).click();
    await page.waitForURL(CHECKOUT_URL, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Stripe Checkout (e2e stand-in)' })).toBeVisible();
    expect(a.checkouts).toEqual([{ pack: 'standard' }]);
  });

  test('History → a batch reopens in the pick grid → Keep stamps it → Back to the list', async ({ page }) => {
    const a = api();
    a.jobs.set('job-h1', [jobView('job-h1', 'done', { result: historyBatchResult() })]);
    await openTemplates(page, a, { width: 390, height: 844 });
    const dialog = await openDialog(page);
    await dialog.getByTestId('ai-history-open').click();

    const rows = dialog.getByTestId('designer-history-row');
    await expect(rows).toHaveCount(2, { timeout: 30_000 });
    await expect(rows.nth(0)).toContainText('3 boards');
    await expect(rows.nth(0).getByTestId('designer-bound-badge')).toHaveText('Bound to Toast · 9 items');
    await expect(rows.nth(0).getByTestId('designer-history-kept')).toHaveText('Kept as Super Taco Lunch');
    await expect(rows.nth(1)).toContainText('A portrait welcome board for the lobby');
    await shot(page, 'history');

    await rows.nth(0).click();
    await expect(dialog.getByText('Pick your favorite')).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByTestId('designer-bound-badge')).toHaveText('Bound to Toast · 9 items');
    await shot(page, 'reopened');
    await dialog.getByRole('button', { name: 'Save', exact: true }).nth(1).click();
    await expect.poll(() => a.creates.length, { timeout: 15_000 }).toBe(1);
    expect(a.creates[0]).toMatchObject({ batchId: historyBatchResult().batchId, candidateIndex: 1, screenWidth: 3840, screenHeight: 2160 });

    await dialog.getByRole('button', { name: '← Back' }).click();
    await expect(dialog.getByText('Your generated boards')).toBeVisible();
    await expect(rows).toHaveCount(2);
  });

  test('a batch refused for want of boards: the server’s words, Buy more boards, Add your own AI key', async ({ page }) => {
    const a = api();
    a.allowance = platformAllowance({ included: 20, used: 19 });
    const error = boardsCapReachedError({ needed: 3, left: 1 });
    a.jobs.set('job-new', [{ ...jobView('job-new', 'failed'), error } as JobViewLike]);
    await openTemplates(page, a, { width: 390, height: 844 });
    const dialog = await openDialog(page);
    await dialog.getByRole('button', { name: 'Use the guided form instead' }).click();
    await dialog.getByRole('button', { name: /I know what I want/ }).click();
    await dialog.getByRole('button', { name: /Designer \(HTML\)/ }).click();
    await dialog.getByPlaceholder(/What should it say\?/).fill('A menu board for Super Taco — tacos, burritos and drinks');
    await dialog.getByRole('button', { name: /Generate 3 options/ }).click();

    await expect(dialog.getByRole('alert')).toContainText('This batch needs 3 boards; you have 1 left this month', { timeout: 30_000 });
    const offers = dialog.getByTestId('ai-cap-actions');
    await expect(offers.getByRole('button', { name: 'Buy more boards' })).toBeVisible();
    await expect(offers.getByRole('link', { name: 'Add your own AI key' })).toHaveAttribute('href', `/${SCHOOL_ID}/settings/ai`);
    await shot(page, 'refused');
  });
});
