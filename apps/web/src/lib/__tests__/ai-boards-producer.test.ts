/**
 * DRIFT GUARD for the AI board credit + history fixtures (tests/fixtures/ai-boards.ts, 2026-09-23).
 *
 * Those fixtures read the producer's VALUES out of its source (the packs, the "why no pack" lines,
 * boardsLeftFor, the history contract item) and assemble each envelope in the shape its producer
 * returns it. This file pins those SHAPES in the producer's source — the controllers' routes and
 * return statements, the view interfaces, operatorView's object — so an API change turns a web test
 * red instead of leaving a fixture (and the dashboard reading it) quietly stale.
 *
 * It also pins the two numbers the web's copy borrows from the API: "of 20" in the boards-left line
 * is used + left, which is the 402's own `cap`; and the history keeps a batch for the 90 days the
 * copy promises.
 *
 * Read as TEXT only — no API module is loaded (see the fixture's header).
 */
import * as fs from 'fs';
// Under jest, next-intl is test-mocks/next-intl.tsx: a plain function over the real en.json, not a
// React hook — so it is named for what it is here.
import { useTranslations as enTranslator } from 'next-intl';
import en from '@/i18n/messages/en.json';
import es from '@/i18n/messages/es.json';
import zh from '@/i18n/messages/zh.json';
import {
  AI_BOARDS_PRODUCER_FILES as FILES,
  aiPacksBody,
  historyContractItem,
  historyPage,
  jobView,
  noKeyAllowance,
  ownKeyAllowance,
  packPurchase,
  packsFromSource,
  platformAllowance,
  purchaseReasonsFromSource,
  validMonthsFromSource,
} from '../../../tests/fixtures/ai-boards';
import { boardsLine } from '../ai-boards';
import { DESIGNER_HISTORY_PAGE_SIZE, designerHistoryPath } from '@/hooks/use-api';

const read = (file: string) => fs.readFileSync(file, 'utf8');
const t = enTranslator('aiBoards') as unknown as (key: string, values?: Record<string, string | number>) => string;

/** `export interface <name> { … }` → its field names, in order. */
function interfaceFields(src: string, name: string): string[] {
  const body = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(src)?.[1];
  if (!body) throw new Error(`interface ${name} not found`);
  return Array.from(body.matchAll(/^ {2}(\w+)\??:/gm)).map((m) => m[1]);
}

describe('GET /ai/allowance', () => {
  const controller = read(FILES.allowanceController);
  const service = read(FILES.allowance);

  it('is served at /api/v1/ai/allowance to every role that can open the AI dialog, from the session tenant', () => {
    expect(controller).toMatch(/@Controller\('api\/v1\/ai'\)/);
    expect(controller).toMatch(
      /@Get\('allowance'\)\s*@RequireRoles\(\s*AppRole\.SUPER_ADMIN,\s*AppRole\.DISTRICT_ADMIN,\s*AppRole\.SCHOOL_ADMIN,\s*AppRole\.CONTRIBUTOR,?\s*\)/,
    );
    expect(controller).toMatch(/return this\.allowance\.operatorView\(req\.user\.tenantId, \{/);
  });

  it('answers AiAllowanceView — the fields the fixture builds and the web type reads', () => {
    expect(interfaceFields(service, 'AiAllowanceView')).toEqual([
      'source',
      'unlimited',
      'boardsIncluded',
      'boardsUsed',
      'boardsPurchasedRemaining',
      'boardsLeft',
      'resetAt',
      'screens',
      'packs',
      'purchaseEnabled',
      'reason',
      'reasonCode',
      'degraded',
      'boardCostUsdTrailing',
    ]);
    const fields = new Set(interfaceFields(service, 'AiAllowanceView'));
    for (const body of [platformAllowance(), platformAllowance({ purchase: 'STRIPE_NOT_CONFIGURED', degraded: true }), ownKeyAllowance(), noKeyAllowance()]) {
      for (const key of Object.keys(body)) expect(fields.has(key)).toBe(true);
    }
  });

  it('operatorView assembles it the way the fixture does (counts from the board snapshot; the reason only when no pack is for sale)', () => {
    const view = /async operatorView\([\s\S]*?\n {2}\}/.exec(service)?.[0] ?? '';
    expect(view).toMatch(/const blocked = purchase\.enabled \? \{\} : \{ reason: purchase\.reason, reasonCode: purchase\.reasonCode \};/);
    expect(view).toMatch(/if \(source !== 'platform'\) \{[\s\S]*?unlimited: source === 'tenant',[\s\S]*?boardsLeft: null,[\s\S]*?purchaseEnabled: false,\s*\.\.\.blocked,/);
    expect(view).toMatch(
      /boardsIncluded: b\.included,\s*boardsUsed: b\.used,\s*boardsPurchasedRemaining: b\.purchasedRemaining,\s*boardsLeft: b\.left,\s*resetAt: b\.resetAt,\s*screens: b\.screens,\s*packs,\s*purchaseEnabled: purchase\.enabled,\s*\.\.\.blocked,/,
    );
    expect(view).toMatch(/const packs = AI_BOARD_PACKS\.map\(\(\{ id, boards, usd \}\) => \(\{ id, boards, usd \}\)\);/);
    // …and `b.left` is boardsLeftFor(…), the function the fixture lifts and runs.
    expect(service).toMatch(/left: boardsLeftFor\(included, used, settled\.purchasedRemaining\),/);
  });

  it('"14 of 20" — the line\'s "of" is used + left, which is exactly the 402\'s own cap', () => {
    expect(service).toMatch(/async assertBoardsAvailable\([\s\S]*?used: b\.used,\s*cap: b\.used \+ b\.left,/);
    const a = platformAllowance({ included: 20, used: 6 });
    expect(a.boardsLeft).toBe(14);
    expect(boardsLine(t, 'en', a)?.text).toBe('14 of 20 boards left this month · resets Oct 1');
  });

  it('the packs are AI_BOARD_PACKS, and each "why no pack" line is the API\'s own', () => {
    expect(packsFromSource()).toEqual([
      { id: 'starter', boards: 10, usd: 9 },
      { id: 'standard', boards: 30, usd: 19 },
      { id: 'bulk', boards: 100, usd: 49 },
    ]);
    const reasons = purchaseReasonsFromSource();
    // English operators read exactly what the API would say; es/zh carry the same meaning.
    for (const code of ['NO_PLATFORM_KEY', 'OWN_KEY', 'STRIPE_NOT_CONFIGURED'] as const) {
      expect(en.aiBoards.credits.reasons[code]).toBe(reasons[code]);
      expect(es.aiBoards.credits.reasons[code]).toBeTruthy();
      expect(zh.aiBoards.credits.reasons[code]).toBeTruthy();
    }
    expect(read(FILES.allowance)).toMatch(/export type BoardSource|type BoardSource/);
    expect(read(FILES.credits)).toMatch(/export type BoardSource = 'platform' \| 'tenant' \| 'none';/);
  });
});

describe('GET /billing/ai-packs and POST /billing/ai-packs/checkout', () => {
  const billing = read(FILES.billingController);

  it('are served under /api/v1/billing to the billing roles', () => {
    expect(billing).toMatch(/@Controller\('api\/v1\/billing'\)/);
    expect(billing).toMatch(/@Get\('ai-packs'\)\s*@RequireRoles\(\.\.\.BILLING_ROLES\)\s*async aiPacks\(/);
    expect(billing).toMatch(/@Post\('ai-packs\/checkout'\)\s*@RequireRoles\(\.\.\.BILLING_ROLES\)\s*async aiPackCheckout\(@Request\(\) req: any, @Body\(\) body: \{ pack\?: unknown \}\)/);
    expect(billing).toMatch(/const BILLING_ROLES = \[\s*AppRole\.SUPER_ADMIN,\s*AppRole\.DISTRICT_ADMIN,\s*AppRole\.SCHOOL_ADMIN,\s*\] as const;/);
  });

  it('ai-packs answers { enabled, (reason + message when not), packs, validMonths, purchases } — the fixture\'s shape', () => {
    expect(billing).toMatch(
      /return \{\s*enabled: availability\.enabled,\s*\.\.\.\(availability\.enabled \? \{\} : \{ reason: availability\.reasonCode, message: availability\.reason \}\),\s*packs: AI_BOARD_PACKS\.map\(\(\{ id, boards: n, usd \}\) => \(\{ id, boards: n, usd \}\)\),\s*validMonths: BOARD_PACK_VALID_MONTHS,\s*purchases: boards\.packs,\s*\};/,
    );
    expect(Object.keys(aiPacksBody())).toEqual(['enabled', 'packs', 'validMonths', 'purchases']);
    expect(Object.keys(aiPacksBody({ purchase: 'OWN_KEY' }))).toEqual(['enabled', 'reason', 'message', 'packs', 'validMonths', 'purchases']);
    expect(validMonthsFromSource()).toBe(12);
    expect(interfaceFields(read(FILES.allowance), 'BoardPackBalance')).toEqual(Object.keys(packPurchase()));
  });

  it('checkout reads { pack }, answers { url } or { enabled: false, reason, message }, and returns the buyer to Settings → Billing with ?boards=', () => {
    const fn = /async aiPackCheckout\([\s\S]*?\n {2}\}/.exec(billing)?.[0] ?? '';
    expect(fn).toMatch(/return \{ enabled: false, reason: availability\.reasonCode, message: availability\.reason \};/);
    expect(fn).toMatch(/const pack = boardPackById\(body\?\.pack\);/);
    expect(fn).toMatch(/successUrl: `\$\{base\}\?boards=success`,\s*cancelUrl: `\$\{base\}\?boards=cancelled`,/);
    expect(billing).toMatch(/return `\$\{origin\}\/\$\{slug \|\| req\.user\?\.tenantId \|\| ''\}\/settings\/billing`/);
    // stripe.checkoutBoardPack returns `{ url: session.url }`.
    const stripe = read(FILES.billingController.replace('billing.controller.ts', 'stripe.service.ts'));
    expect(stripe).toMatch(/async checkoutBoardPack\([\s\S]*?\): Promise<\{ url: string \}> \{[\s\S]*?return \{ url: session\.url \};/);
  });
});

describe('GET /templates/generate-designer/jobs — the board history', () => {
  const history = read(FILES.history);
  const controller = read(FILES.controller);

  it('is served under /api/v1/templates with ?limit & ?before, and answers DesignerHistoryPage', () => {
    expect(controller).toMatch(/@Controller\('api\/v1\/templates'\)/);
    expect(controller).toMatch(
      /@Get\('generate-designer\/jobs'\)[\s\S]*?async listDesignerJobs\([\s\S]*?\): Promise<DesignerHistoryPage> \{\s*return this\.designerJobsOrThrow\(\)\.history\(req\.user\.tenantId, \{\s*limit: query\?\.limit,\s*before: query\?\.before \? new Date\(query\.before\) : null,/,
    );
    expect(history).toMatch(/limit: z\.union\(\[z\.string\(\)\.max\(12\), z\.number\(\)\]\)\.optional\(\),\s*before: z\.string\(\)\.trim\(\)\.datetime\(\{ offset: true \}\)\.optional\(\),/);
    expect(interfaceFields(history, 'DesignerHistoryPage')).toEqual(['items', 'nextBefore']);
    expect(designerHistoryPath()).toBe('/templates/generate-designer/jobs?limit=20');
    expect(designerHistoryPath('2026-09-20T12:00:00.000+02:00')).toBe(
      '/templates/generate-designer/jobs?limit=20&before=2026-09-20T12%3A00%3A00.000%2B02%3A00',
    );
    const max = Number(/export const DESIGNER_HISTORY_PAGE_MAX = (\d+);/.exec(history)?.[1]);
    expect(DESIGNER_HISTORY_PAGE_SIZE).toBeLessThanOrEqual(max);
  });

  it('an item has exactly the fields of DesignerHistoryItem — the harness\'s contract item fills them all', () => {
    const fields = interfaceFields(history, 'DesignerHistoryItem');
    expect(fields).toEqual([
      'id',
      'createdAt',
      'finishedAt',
      'prompt',
      'venueName',
      'canvas',
      'candidateCount',
      'candidates',
      'boundTo',
      'keptTemplateId',
      'source',
    ]);
    const item = historyContractItem({ id: 'job-h1', keptTemplateId: 'tpl-kept' });
    expect(Object.keys(item).sort()).toEqual([...fields].sort());
    expect(item.prompt).toHaveLength(140);
    expect(item.boundTo).toEqual({ providerId: 'toast', providerName: 'Toast', itemCount: 9 });
    expect(Object.keys(historyPage([item], '2026-09-20T12:00:00.000Z'))).toEqual(['items', 'nextBefore']);
    expect(Object.keys(historyPage([item]))).toEqual(['items']);
  });

  it('a finished batch is kept for the 90 days the copy promises', () => {
    expect(read(FILES.jobsService)).toMatch(/export const DESIGNER_HISTORY_DAYS = 90;/);
    for (const cat of [en, es, zh]) {
      expect(cat.aiBoards.history.subtitle).toContain('90');
      expect(cat.aiBoards.history.empty).toContain('90');
    }
  });

  it('a reopened job reads as toDesignerJobView builds it: { id, status, progress, result (done only), createdAt, finishedAt }', () => {
    const svc = read(FILES.jobsService);
    expect(svc).toMatch(
      /export function toDesignerJobView\(row: ViewRow\): DesignerJobView \{[\s\S]*?return \{\s*id: row\.id,\s*status,\s*progress: [^\n]*\n\s*\.\.\.\(status === 'done' && row\.result \? \{ result: row\.result as DesignerJobResult \} : \{\}\),\s*\.\.\.\(status === 'failed' && row\.error \? \{ error: row\.error as DesignerJobError \} : \{\}\),\s*createdAt: iso\(row\.createdAt\) as string,\s*finishedAt: iso\(row\.finishedAt\),\s*\};/,
    );
    expect(Object.keys(jobView('job-h1', 'done'))).toEqual(['id', 'status', 'progress', 'result', 'createdAt', 'finishedAt']);
    expect(Object.keys(jobView('job-h1', 'running'))).toEqual(['id', 'status', 'progress', 'createdAt', 'finishedAt']);
  });
});
