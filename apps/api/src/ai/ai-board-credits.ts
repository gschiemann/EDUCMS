/**
 * Board credits — how AI board design on OUR key is sold (2026-09-23).
 *
 * Greg (2026-09-23): the $20/screen/month annual plan is ALL-IN, AI beyond what it includes is a paid
 * add-on — "we must cap it and display how many credits they have left … or allow them to buy more
 * generations" — and then: "I need to make profit, not just pass the cost to them."
 *
 * So the unit the customer sees, spends and buys is a BOARD, and it is deliberately NOT a dollar:
 *
 *   * ONE CREDIT = one board the model draws for the tenant on our key — each candidate in a batch
 *     (2 by default), each Regenerate candidate, each "edit with words" refine. What happens inside
 *     the loop to make that board good — the brief read, the redraw of a cut-off or broken draft, the
 *     render, the critique, the review's own revise — is OUR quality cost and never a credit.
 *   * The price of a board never floats with the model. We pay DOLLARS for every call
 *     (`ai_usage_events.cost_micros`, at the catalog price of whichever model served it — that is our
 *     cost of goods and stays exactly as metered); the customer pays BOARDS. When the catalog adopts
 *     a cheaper model the same board costs us less and the margin grows — a pack is never "N × our
 *     cost", which would hand every model price drop to the customer.
 *
 *   included per UTC month   max(BOARDS_FLOOR, BOARDS_PER_SCREEN × paired screens), pooled across the
 *                            organisation (the root of the tenant tree), no rollover
 *   packs                    AI_BOARD_PACKS — a one-off Stripe payment adds `boards` to the
 *                            organisation's balance for 12 months; a pack is drawn on only after the
 *                            month's included boards are gone, soonest-expiring pack first
 *   own key                  unlimited here (their vendor bills them)
 *
 * WHERE USAGE COMES FROM. Counted, never stored twice: a board credit is one `ai_usage_events` row on
 * our key whose feature is in BOARD_CREDIT_FEATURES. The only other state is a pack's purchase row and,
 * per organisation per month, that month's included allowance (its high-water mark,
 * `ai_board_months`) — because a pack is consumed only by boards drawn BEYOND a month's included
 * allowance, and a past month's allowance cannot be recomputed from today's screen count (a district
 * that unpairs screens must never retroactively eat the boards it bought).
 *
 * Everything in this file is pure (no I/O) except the two env/catalog reads at the bottom.
 */
import { getCatalog } from './ai-model-catalog';
import { hasPlatformKey } from './ai-platform-keys';

/** Included boards per paired screen per month. */
export const BOARDS_PER_SCREEN = 5;
/** Included boards per month for an organisation with few (or no) screens — enough to set up. */
export const BOARDS_FLOOR = 10;
/** A pack is good for this many calendar months after purchase. */
export const BOARD_PACK_VALID_MONTHS = 12;

/**
 * The packs, in one place. Prices are Greg's to set — change them HERE and nowhere else (checkout,
 * the operator endpoint and the super-admin margin view all read this list). A purchase records the
 * boards it was sold with and the amount actually paid, so a price change never rewrites anyone's
 * history or balance.
 */
export const AI_BOARD_PACKS: ReadonlyArray<{ readonly id: string; readonly boards: number; readonly usd: number }> = [
  { id: 'starter', boards: 10, usd: 9 },
  { id: 'standard', boards: 30, usd: 19 },
  { id: 'bulk', boards: 100, usd: 49 },
];

export type AiBoardPack = (typeof AI_BOARD_PACKS)[number];

export function boardPackById(id: unknown): AiBoardPack | null {
  return typeof id === 'string' ? (AI_BOARD_PACKS.find((p) => p.id === id) ?? null) : null;
}

/** Stripe Checkout metadata `kind` that marks a session as a board-pack purchase. */
export const AI_BOARD_PACK_KIND = 'ai_board_pack';

/**
 * Ledger features that cost the customer ONE credit per row (on our key):
 *   'designer'         — a candidate board drawn (a batch, or a Regenerate)
 *   'designer-revise'  — an "edit with words" refine of a board (POST /templates/refine-designer)
 */
export const BOARD_CREDIT_FEATURES: readonly string[] = ['designer', 'designer-revise'];

/**
 * Every ledger feature that is part of MAKING a board — the credit features plus the loop's own work,
 * which is our quality cost ('designer-redraw' = a broken or cut-off draft drawn again,
 * 'designer-review' = the critique, 'designer-review-revise' = the review's own revise). These are
 * governed by the board cap, so they are NOT counted against the dollar allowance the other AI
 * features share — otherwise a customer designing the boards they bought would run Sparkle and the
 * Concierge dry. ('designer-brief' is a fast-tier call with its own endpoint, so it stays on the
 * dollar allowance like every other fast-tier feature.)
 */
export const BOARD_PIPELINE_FEATURES: readonly string[] = [
  ...BOARD_CREDIT_FEATURES,
  'designer-redraw',
  'designer-review',
  'designer-review-revise',
];

/** What our board cost of goods is averaged over (super-admin margin view): the pipeline + its brief. */
export const BOARD_COGS_FEATURES: readonly string[] = [...BOARD_PIPELINE_FEATURES, 'designer-brief'];

/** The month's included boards for an organisation with `screens` paired screens. */
export function includedBoardsFor(screens: number): number {
  const n = Number.isFinite(screens) ? Math.max(0, Math.floor(screens)) : 0;
  return Math.max(BOARDS_FLOOR, BOARDS_PER_SCREEN * n);
}

/** 'YYYY-MM' of a date's UTC month. */
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** First instant (UTC) of the month `key` ('YYYY-MM'), shifted by `plus` months. */
export function monthStart(key: string, plus = 0): Date {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + plus, 1));
}

/** `d` + `months` calendar months, UTC (a 31st rolls into the next month, as Date does). */
export function addMonthsUtc(d: Date, months: number): Date {
  return new Date(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth() + months,
      d.getUTCDate(),
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds(),
    ),
  );
}

export interface PackForSettlement {
  id: string;
  boards: number;
  createdAt: Date;
  expiresAt: Date;
}

export interface PackSettlement {
  /** Boards left on each pack after every month's overage was drawn from the packs. */
  remaining: Map<string, number>;
  /** Σ remaining over the packs that have not expired at `now`. */
  purchasedRemaining: number;
  /** Boards drawn beyond the included allowance that no pack covered (a race past the pre-check). */
  unfunded: number;
}

/**
 * Replay the organisation's months, oldest first, drawing each month's OVERAGE (boards used beyond
 * that month's included allowance) from its packs, soonest-expiring first.
 *
 *   * A pack takes part in month M when it was bought before M ended (for the current month: before
 *     `now`) and had not expired when M began — so a pack that expires mid-month still carries the
 *     share of that month it covered, and its unused rest simply lapses.
 *   * A month with no recorded allowance (no `includedByMonth` entry) draws NOTHING from packs: the
 *     allowance is written by the organisation's first board check of the month, so a missing row
 *     means an overage cannot be proven — and the benefit of that doubt goes to the customer.
 *   * Pure: the caller supplies the counts from the ledger and the allowances from `ai_board_months`.
 */
export function settleBoardPacks(opts: {
  packs: PackForSettlement[];
  usedByMonth: Map<string, number>;
  includedByMonth: Map<string, number>;
  now: Date;
}): PackSettlement {
  const packs = [...opts.packs]
    .filter((p) => p.boards > 0)
    .sort(
      (a, b) =>
        a.expiresAt.getTime() - b.expiresAt.getTime() ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    );
  const remaining = new Map(packs.map((p) => [p.id, p.boards]));
  let unfunded = 0;
  if (packs.length) {
    const current = monthKey(opts.now);
    const first = packs.reduce((min, p) => (p.createdAt < min ? p.createdAt : min), packs[0].createdAt);
    for (let key = monthKey(first); key <= current; key = monthKey(monthStart(key, 1))) {
      const included = opts.includedByMonth.get(key);
      if (included == null) continue;
      let overage = Math.max(0, (opts.usedByMonth.get(key) ?? 0) - included);
      if (!overage) continue;
      const begins = monthStart(key);
      const ends = key === current ? opts.now : monthStart(key, 1);
      for (const p of packs) {
        if (!overage) break;
        if (p.createdAt >= ends || p.expiresAt <= begins) continue;
        const left = remaining.get(p.id) ?? 0;
        const take = Math.min(left, overage);
        remaining.set(p.id, left - take);
        overage -= take;
      }
      unfunded += overage;
    }
  }
  const purchasedRemaining = packs
    .filter((p) => p.expiresAt > opts.now)
    .reduce((sum, p) => sum + (remaining.get(p.id) ?? 0), 0);
  return { remaining, purchasedRemaining, unfunded };
}

/** Boards the organisation can still draw this month: the rest of the included, then the packs. */
export function boardsLeftFor(included: number, used: number, purchasedRemaining: number): number {
  return Math.max(0, included - used) + Math.max(0, purchasedRemaining);
}

/**
 * Can a board be drawn on OUR key at all? Exactly the dispatcher's own truth (`AiService.routeFor(…,
 * 'design')`): the first design route whose vendor we hold a key for. With none, a pack would buy
 * nothing usable, so none may be sold.
 */
export function platformDesignRouteAvailable(): boolean {
  return getCatalog().routeForJob('design', hasPlatformKey) !== null;
}

/** Stripe is configured on this deploy (the same test as StripeService.enabled()). */
export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

/**
 * Whose key draws a tenant's boards: 'tenant' = its own (or its organisation's) key — unlimited
 * here; 'platform' = ours; 'none' = neither (no key of its own and no design route on ours — the
 * state production is in while it holds no platform AI key at all).
 */
export type BoardSource = 'platform' | 'tenant' | 'none';

export type BoardPurchaseAvailability =
  | { enabled: true }
  | { enabled: false; reasonCode: 'NO_PLATFORM_KEY' | 'OWN_KEY' | 'STRIPE_NOT_CONFIGURED'; reason: string };

/**
 * May a pack be bought? Only when a board could actually be drawn on it: our key must have a design
 * route (a pack bought with none would buy nothing usable), the buyer must be on our key (on its own
 * key it is unlimited here — nothing to buy), and Stripe must be configured. The allowance endpoint's
 * `purchaseEnabled` and the checkout endpoint answer from this one function.
 */
export function boardPurchaseAvailability(source: BoardSource): BoardPurchaseAvailability {
  if (source === 'none' || !platformDesignRouteAvailable()) {
    return { enabled: false, reasonCode: 'NO_PLATFORM_KEY', reason: 'AI runs on your own key — add it in Settings → AI provider.' };
  }
  if (source === 'tenant') {
    return {
      enabled: false,
      reasonCode: 'OWN_KEY',
      reason: 'Your boards run on your own AI key, with no limit here — there is nothing to buy.',
    };
  }
  if (!stripeConfigured()) {
    return { enabled: false, reasonCode: 'STRIPE_NOT_CONFIGURED', reason: "Buying more boards isn't set up on this deployment yet." };
  }
  return { enabled: true };
}

/**
 * The operator-facing 402 when a batch (or a refine) does not fit: the numbers, when the included
 * boards come back, and the ways forward — buying more only when a pack can actually be bought.
 */
export function boardsCapMessage(o: {
  needed: number;
  left: number;
  resetAt: string;
  purchaseEnabled: boolean;
  kind: 'batch' | 'refine';
}): string {
  const what = o.kind === 'refine' ? 'This edit' : 'This batch';
  const needs = `${what} needs ${o.needed} ${o.needed === 1 ? 'board' : 'boards'}`;
  const have = o.left <= 0 ? 'you have none left this month' : `you have ${o.left} left this month`;
  const resetDay = new Date(o.resetAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
  const ways = o.purchaseEnabled
    ? 'Buy more boards in Settings → Billing, or add your own AI key in Settings → AI provider — you pay your provider directly, with no limit here.'
    : 'Add your own AI key in Settings → AI provider to keep going — you pay your provider directly, with no limit here.';
  return `${needs}; ${have} (included boards reset ${resetDay}). ${ways}`;
}
