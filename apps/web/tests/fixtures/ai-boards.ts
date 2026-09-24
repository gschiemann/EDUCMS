/**
 * AI board CREDITS + board HISTORY responses, cut from the PRODUCER (2026-09-23).
 *
 * The endpoints (contracts: docs/research/2026-09-23-codex-parity-wave/06-history-api.md and
 * 07-board-credits-api.md):
 *   GET  /ai/allowance                          AiAllowanceService.operatorView → AiAllowanceView
 *   GET  /billing/ai-packs                      BillingController.aiPacks
 *   POST /billing/ai-packs/checkout             BillingController.aiPackCheckout
 *   GET  /templates/generate-designer/jobs      TemplatesController.listDesignerJobs → DesignerHistoryPage
 *   GET  /templates/generate-designer/jobs/:id  the reopened batch → DesignerJobView
 *
 * NO API MODULE BEHIND THESE ENDPOINTS IS LOADED HERE. Their import graphs reach the model
 * catalog, the platform keys, Prisma and Stripe, and a static path to a runtime package turned web
 * suites red twice this week. The producer's own VALUES are read out of its source as text:
 *   - the packs                 `AI_BOARD_PACKS`              ai/ai-board-credits.ts
 *   - "why no pack" lines       `boardPurchaseAvailability`   ai/ai-board-credits.ts
 *   - how long a pack lasts     `BOARD_PACK_VALID_MONTHS`     ai/ai-board-credits.ts
 *   - boards left               `boardsLeftFor` — its own body, lifted out and run by itself
 *   - the history item          `expectedMainItem` in apps/api/test/designer-jobs-history-harness.ts
 *                               (the item the API's jest specs AND its real-Postgres proof assert),
 *                               its own body run with the harness's own LONG_PROMPT
 * and each envelope is assembled in exactly the shape its producer returns it (operatorView's object,
 * the controller's return statements, toDesignerJobView). src/lib/__tests__/ai-boards-producer.test.ts
 * pins those shapes in the producer's source, so an API change turns a web test red instead of
 * leaving this file quietly stale.
 *
 * A reopened batch's `result` IS built by the producer — `producedResult(designerOutput(…))` from
 * designer-job.ts loads only the modules the API's designer-prompt-purity spec guards
 * (designer-job-request, designer-prompt and what it imports).
 */
import * as fs from 'fs';
import * as path from 'path';
import { API_SRC, designerOutput, exportedFunctionBody, producedResult, type OutputOptions, type ProducedResult } from './designer-job';

export const AI_BOARDS_PRODUCER_FILES = {
  credits: path.join(API_SRC, 'ai', 'ai-board-credits.ts'),
  allowance: path.join(API_SRC, 'ai', 'ai-allowance.service.ts'),
  allowanceController: path.join(API_SRC, 'ai', 'ai-allowance.controller.ts'),
  billingController: path.join(API_SRC, 'billing', 'billing.controller.ts'),
  history: path.join(API_SRC, 'templates', 'designer-jobs', 'designer-job-history.ts'),
  jobsService: path.join(API_SRC, 'templates', 'designer-jobs', 'designer-jobs.service.ts'),
  controller: path.join(API_SRC, 'templates', 'templates.controller.ts'),
  historyHarness: path.resolve(API_SRC, '..', 'test', 'designer-jobs-history-harness.ts'),
};

const read = (file: string) => fs.readFileSync(file, 'utf8');
const json = <T>(v: unknown): T => JSON.parse(JSON.stringify(v)) as T;

// ── what the producer's source says ─────────────────────────────────────────────────────────

export type ProducedReasonCode = 'NO_PLATFORM_KEY' | 'OWN_KEY' | 'STRIPE_NOT_CONFIGURED';
export interface ProducedPack {
  id: string;
  boards: number;
  usd: number;
}

/** `AI_BOARD_PACKS` — the packs, in their order. */
export function packsFromSource(): ProducedPack[] {
  const src = read(AI_BOARDS_PRODUCER_FILES.credits);
  const block = /export const AI_BOARD_PACKS[\s\S]*?= \[([\s\S]*?)\];/.exec(src)?.[1];
  const packs = Array.from((block ?? '').matchAll(/\{\s*id: '([\w-]+)',\s*boards: (\d+),\s*usd: (\d+(?:\.\d+)?)\s*\}/g)).map(
    (m) => ({ id: m[1], boards: Number(m[2]), usd: Number(m[3]) }),
  );
  if (!packs.length) throw new Error('ai-boards fixture: AI_BOARD_PACKS is no longer where this fixture reads it');
  return packs;
}

/** `boardPurchaseAvailability`'s line for each reason a pack cannot be bought. */
export function purchaseReasonsFromSource(): Record<ProducedReasonCode, string> {
  const src = read(AI_BOARDS_PRODUCER_FILES.credits);
  const body = exportedFunctionBody(src, 'boardPurchaseAvailability');
  const out: Partial<Record<ProducedReasonCode, string>> = {};
  for (const m of Array.from(body.matchAll(/reasonCode: '(\w+)',\s*reason:\s*(['"])((?:(?!\2).)*)\2/g))) {
    out[m[1] as ProducedReasonCode] = m[3];
  }
  for (const code of ['NO_PLATFORM_KEY', 'OWN_KEY', 'STRIPE_NOT_CONFIGURED'] as const) {
    if (!out[code]) throw new Error(`ai-boards fixture: boardPurchaseAvailability no longer answers ${code} where this fixture reads it`);
  }
  return out as Record<ProducedReasonCode, string>;
}

/** `BOARD_PACK_VALID_MONTHS`. */
export function validMonthsFromSource(): number {
  const m = /export const BOARD_PACK_VALID_MONTHS = (\d+);/.exec(read(AI_BOARDS_PRODUCER_FILES.credits));
  if (!m) throw new Error('ai-boards fixture: BOARD_PACK_VALID_MONTHS is no longer where this fixture reads it');
  return Number(m[1]);
}

/** `boardsLeftFor(included, used, purchasedRemaining)` — its own body, run by itself. */
export function boardsLeftFromSource(included: number, used: number, purchasedRemaining: number): number {
  const body = exportedFunctionBody(read(AI_BOARDS_PRODUCER_FILES.credits), 'boardsLeftFor');
  const fn = new Function('included', 'used', 'purchasedRemaining', body) as (a: number, b: number, c: number) => number;
  return fn(included, used, purchasedRemaining);
}

// ── GET /ai/allowance ───────────────────────────────────────────────────────────────────────

export interface ProducedAllowance {
  source: 'platform' | 'tenant' | 'none';
  unlimited: boolean;
  boardsIncluded: number | null;
  boardsUsed: number | null;
  boardsPurchasedRemaining: number | null;
  boardsLeft: number | null;
  resetAt: string;
  screens: number | null;
  packs: ProducedPack[];
  purchaseEnabled: boolean;
  reason?: string;
  reasonCode?: ProducedReasonCode;
  degraded?: true;
}

export const RESET_AT = '2026-10-01T00:00:00.000Z';

export interface PlatformAllowanceOptions {
  included?: number;
  used?: number;
  purchasedRemaining?: number;
  screens?: number;
  /** A pack can be bought (default), or Stripe is not set up on this deploy. */
  purchase?: 'enabled' | 'STRIPE_NOT_CONFIGURED';
  degraded?: boolean;
  resetAt?: string;
}

/**
 * Our key — operatorView's platform return: `{ source, unlimited: false, boardsIncluded: b.included,
 * boardsUsed: b.used, boardsPurchasedRemaining: b.purchasedRemaining, boardsLeft: b.left, resetAt,
 * screens, packs, purchaseEnabled, ...blocked, ...degraded }`. The default is Greg's example: 14 of
 * 20 left.
 */
export function platformAllowance(o: PlatformAllowanceOptions = {}): ProducedAllowance {
  const included = o.included ?? 20;
  const used = o.used ?? 6;
  const purchasedRemaining = o.purchasedRemaining ?? 0;
  const enabled = (o.purchase ?? 'enabled') === 'enabled';
  const reasons = purchaseReasonsFromSource();
  return json({
    source: 'platform',
    unlimited: false,
    boardsIncluded: included,
    boardsUsed: used,
    boardsPurchasedRemaining: purchasedRemaining,
    boardsLeft: boardsLeftFromSource(included, used, purchasedRemaining),
    resetAt: o.resetAt ?? RESET_AT,
    screens: o.screens ?? 4,
    packs: packsFromSource(),
    purchaseEnabled: enabled,
    ...(enabled ? {} : { reason: reasons.STRIPE_NOT_CONFIGURED, reasonCode: 'STRIPE_NOT_CONFIGURED' }),
    ...(o.degraded ? { degraded: true } : {}),
  });
}

/** Their own key (or their organisation's) — operatorView's non-platform return, `unlimited: true`. */
export function ownKeyAllowance(): ProducedAllowance {
  return notOnOurKey('tenant', 'OWN_KEY');
}

/** Nobody's key: no key of their own and no design route on ours — production today. */
export function noKeyAllowance(): ProducedAllowance {
  return notOnOurKey('none', 'NO_PLATFORM_KEY');
}

function notOnOurKey(source: 'tenant' | 'none', code: ProducedReasonCode): ProducedAllowance {
  return json({
    source,
    unlimited: source === 'tenant',
    boardsIncluded: null,
    boardsUsed: null,
    boardsPurchasedRemaining: null,
    boardsLeft: null,
    resetAt: RESET_AT,
    screens: null,
    packs: packsFromSource(),
    purchaseEnabled: false,
    reason: purchaseReasonsFromSource()[code],
    reasonCode: code,
  });
}

// ── GET /billing/ai-packs, POST /billing/ai-packs/checkout ──────────────────────────────────

/** One bought pack — `BoardPackBalance`. */
export interface ProducedPurchase {
  id: string;
  pack: string;
  boards: number;
  remaining: number;
  usd: number;
  purchasedAt: string;
  expiresAt: string;
  expired: boolean;
}

export function packPurchase(o: Partial<ProducedPurchase> = {}): ProducedPurchase {
  const pack = packsFromSource().find((p) => p.id === (o.pack ?? 'standard')) ?? packsFromSource()[0];
  return json({
    id: o.id ?? 'purchase-1',
    pack: pack.id,
    boards: o.boards ?? pack.boards,
    remaining: o.remaining ?? pack.boards,
    usd: o.usd ?? pack.usd,
    purchasedAt: o.purchasedAt ?? '2026-09-23T15:00:00.000Z',
    expiresAt: o.expiresAt ?? '2027-09-23T15:00:00.000Z',
    expired: o.expired ?? false,
  });
}

/** `aiPacks()`: `{ enabled, ...(enabled ? {} : { reason: code, message }), packs, validMonths, purchases }`. */
export function aiPacksBody(o: { purchase?: 'enabled' | ProducedReasonCode; purchases?: ProducedPurchase[] } = {}) {
  const purchase = o.purchase ?? 'enabled';
  const enabled = purchase === 'enabled';
  return json<{
    enabled: boolean;
    reason?: ProducedReasonCode;
    message?: string;
    packs: ProducedPack[];
    validMonths: number;
    purchases: ProducedPurchase[];
  }>({
    enabled,
    ...(enabled ? {} : { reason: purchase, message: purchaseReasonsFromSource()[purchase as ProducedReasonCode] }),
    packs: packsFromSource(),
    validMonths: validMonthsFromSource(),
    purchases: o.purchases ?? [],
  });
}

/** A Stripe-hosted Checkout session URL — what `stripe.checkoutBoardPack` returns as `{ url }`. */
export const CHECKOUT_URL = 'https://checkout.stripe.com/c/pay/cs_test_a1B2c3D4e5';

/** `aiPackCheckout()` refusing: `{ enabled: false, reason: availability.reasonCode, message: availability.reason }`. */
export function checkoutRefused(code: ProducedReasonCode) {
  return { enabled: false as const, reason: code, message: purchaseReasonsFromSource()[code] };
}

// ── the board history ───────────────────────────────────────────────────────────────────────

export interface ProducedHistoryItem {
  id: string;
  createdAt: string;
  finishedAt: string | null;
  prompt: string;
  venueName: string | null;
  canvas: { w: number; h: number };
  candidateCount: number;
  candidates: Array<{ index: number; name: string; structure: string | null; artDirection: string | null; review?: { score: number | null; revised: boolean } }>;
  boundTo?: { providerId: string; providerName: string; itemCount: number };
  keptTemplateId?: string;
  source: 'tenant' | 'platform' | null;
}

/** The harness's LONG_PROMPT: its concatenated string literals. */
export function harnessLongPrompt(): string {
  const decl = /export const LONG_PROMPT =([\s\S]*?);\n/.exec(read(AI_BOARDS_PRODUCER_FILES.historyHarness))?.[1];
  const parts = Array.from((decl ?? '').matchAll(/'([^']*)'/g)).map((m) => m[1]);
  if (!parts.length) throw new Error('ai-boards fixture: the history harness LONG_PROMPT is no longer where this fixture reads it');
  return parts.join('');
}

/**
 * THE CONTRACT ITEM: `expectedMainItem(at)` — the list item the API asserts for a done job holding
 * its producer-cut request + result (a Toast-bound Super Taco menu, three boards, two reviewed).
 */
export function historyContractItem(at: {
  id: string;
  createdAt?: string;
  finishedAt?: string | null;
  keptTemplateId?: string;
}): ProducedHistoryItem {
  const body = exportedFunctionBody(read(AI_BOARDS_PRODUCER_FILES.historyHarness), 'expectedMainItem');
  const fn = new Function('at', 'LONG_PROMPT', body) as (a: unknown, p: string) => ProducedHistoryItem;
  return json(
    fn(
      {
        id: at.id,
        createdAt: at.createdAt ?? '2026-09-20T12:00:00.000Z',
        finishedAt: at.finishedAt === undefined ? '2026-09-20T12:03:00.000Z' : at.finishedAt,
        ...(at.keptTemplateId ? { keptTemplateId: at.keptTemplateId } : {}),
      },
      harnessLongPrompt(),
    ),
  );
}

/** The same item as a batch with no POS binding and nothing kept (`toDesignerHistoryItem` omits both). */
export function historyPlainItem(at: { id: string; createdAt?: string; prompt?: string; venueName?: string | null }): ProducedHistoryItem {
  const item = historyContractItem({ id: at.id, createdAt: at.createdAt });
  delete item.boundTo;
  delete item.keptTemplateId;
  if (at.prompt !== undefined) item.prompt = at.prompt;
  if (at.venueName !== undefined) item.venueName = at.venueName;
  return item;
}

/** `listDesignerJobs` → `{ items, ...(older page ? { nextBefore } : {}) }`. */
export function historyPage(items: ProducedHistoryItem[], nextBefore?: string) {
  return json<{ items: ProducedHistoryItem[]; nextBefore?: string }>({ items, ...(nextBefore ? { nextBefore } : {}) });
}

// ── a job, as GET …/jobs/:id answers it ─────────────────────────────────────────────────────

export interface JobViewLike {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  progress: { stage: string; updatedAt: string; candidate?: number; of?: number } | null;
  result?: ProducedResult;
  createdAt: string;
  finishedAt: string | null;
}

/**
 * `toDesignerJobView(row)`: `{ id, status, progress, ...(done ? { result } : {}), createdAt,
 * finishedAt }` — the shape is pinned in the producer test. `result` for a done job is the producer's.
 */
export function jobView(
  id: string,
  status: JobViewLike['status'],
  o: { result?: ProducedResult; stage?: string; candidate?: number; of?: number } = {},
): JobViewLike {
  const finished = status === 'done' || status === 'failed' || status === 'cancelled';
  const progress =
    status === 'queued'
      ? null
      : {
          stage: o.stage ?? (status === 'done' ? 'done' : 'drawing'),
          updatedAt: '2026-09-20T12:02:00.000Z',
          ...(o.candidate !== undefined ? { candidate: o.candidate } : {}),
          of: o.of ?? 3,
        };
  return json({
    id,
    status,
    progress,
    ...(status === 'done' ? { result: o.result ?? producedResult(designerOutput()) } : {}),
    createdAt: '2026-09-20T12:00:00.000Z',
    finishedAt: finished ? '2026-09-20T12:03:00.000Z' : null,
  });
}

/** The contract item's batch, as the reopen reads it: three boards, bound to Toast, its own batchId. */
export function historyBatchResult(o: OutputOptions = {}): ProducedResult {
  return producedResult(
    designerOutput({
      batchId: 'batch-h1',
      boundTo: { providerId: 'toast', providerName: 'Toast', itemCount: 9 },
      ...o,
    }),
  );
}
