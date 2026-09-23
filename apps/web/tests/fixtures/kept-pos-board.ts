/**
 * A KEPT POS-bound AI board, cut from the PRODUCER (POS-A, 2026-09-23).
 *
 * Shared by src/lib/__tests__/ai-board-live-menu.test.tsx (jest) and
 * tests/e2e/pos-bound-board.spec.ts (Playwright): the Super Taco fixture run
 * through the API's own code, step for step —
 *   GENERATE  sanitizeDesignerHtml → bindMenuRows (finishDesignerBoard's binder)
 *             → injectDesignerLayoutEngine (generate-designer/candidates)
 *   KEEP      create-designer: sanitizeDesignerHtml → bindMenuRows with the
 *             verified plan, strays kept (bindingsForSave) → injectDesignerEditShim
 *             → injectDesignerLayoutEngine
 * — plus the zone config keep saves beside it.
 *
 * The API modules are loaded with a COMPUTED-path `require`, on purpose: the
 * web tsconfig type-checks every test file and everything it imports at the
 * web's ES2017 target, and API source is not written for that (the Next build
 * failed on designer-prompt.ts's `/s` regex flag). At runtime jest (ts-jest)
 * and Playwright both transpile the required .ts files, so this is still the
 * real producer — it just never joins the web type program.
 */
import * as fs from 'fs';
import * as path from 'path';

const API_AI = path.resolve(__dirname, '../../../api/src/ai');

/* eslint-disable @typescript-eslint/no-require-imports */
function apiModule<T>(name: string): T {
  return require(path.join(API_AI, `${name}.ts`)) as T;
}
/* eslint-enable @typescript-eslint/no-require-imports */

/** Structurally the API's BindingPlan (apps/api/src/ai/menu-binding.ts). */
export interface KeptBoardPlan {
  providerId: string;
  providerName: string;
  connectionId: string;
  items: Array<{ n: number; externalId: string; name: string; priceCents: number; priceText: string; section: string; description?: string | null }>;
}

export const POS_PLAN: KeptBoardPlan = {
  providerId: 'toast',
  providerName: 'Toast',
  connectionId: 'conn-toast',
  items: [
    { n: 0, externalId: 'birria', name: '3 Birria Tacos', priceCents: 1525, priceText: '$15.25', section: 'Tacos' },
    { n: 1, externalId: 'asada', name: 'Asada Super Burrito', priceCents: 1750, priceText: '$17.50', section: 'Burritos' },
    { n: 2, externalId: 'horchata', name: 'Horchata', priceCents: 325, priceText: '$3.25', section: 'Drinks' },
  ],
};

export function keptPosBoardHtml(plan: KeptBoardPlan = POS_PLAN, width = 3840, height = 2160): string {
  type Bind = { bindMenuRows: (html: string, plan: KeptBoardPlan, opts?: { removeStrays?: boolean }) => { html: string } };
  type Shim = {
    injectDesignerEditShim: (html: string) => string;
    injectDesignerLayoutEngine: (html: string, w?: number, h?: number) => string;
  };
  type Sanitize = { sanitizeDesignerHtml: (raw: unknown) => { html: string } };
  const { bindMenuRows } = apiModule<Bind>('menu-binding');
  const { injectDesignerEditShim, injectDesignerLayoutEngine } = apiModule<Shim>('designer-edit-shim');
  const { sanitizeDesignerHtml } = apiModule<Sanitize>('designer-prompt');
  const fixture = fs.readFileSync(path.join(API_AI, '__fixtures__', 'super-taco-burritos.board.html'), 'utf8');

  const bound = bindMenuRows(sanitizeDesignerHtml(fixture).html, plan).html;
  const candidate = injectDesignerLayoutEngine(bound, width, height);
  const rebound = bindMenuRows(sanitizeDesignerHtml(candidate).html, plan, { removeStrays: false }).html;
  return injectDesignerLayoutEngine(injectDesignerEditShim(rebound), width, height);
}

/** The zone config create-designer saves for a POS-bound AI board (+ any extra keys). */
export function keptPosZoneConfig(extra: Record<string, unknown> = {}, plan: KeptBoardPlan = POS_PLAN): Record<string, unknown> {
  const posItemBindings: Record<string, string> = {};
  for (const it of plan.items) posItemBindings[`item.${it.n}`] = it.externalId;
  return {
    html: keptPosBoardHtml(plan),
    posSync: true,
    dataSource: 'POS',
    posProvider: plan.providerId,
    posConnectionId: plan.connectionId,
    posItemBindings,
    ...extra,
  };
}
