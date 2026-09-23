/**
 * Board credits — the unit, the packs and the settlement math (2026-09-23). Pure: no I/O.
 */
import {
  AI_BOARD_PACKS,
  BOARD_COGS_FEATURES,
  BOARD_CREDIT_FEATURES,
  BOARD_PIPELINE_FEATURES,
  addMonthsUtc,
  boardPackById,
  boardPurchaseAvailability,
  boardsCapMessage,
  boardsLeftFor,
  includedBoardsFor,
  monthKey,
  monthStart,
  platformDesignRouteAvailable,
  settleBoardPacks,
  type PackForSettlement,
} from './ai-board-credits';
import { setCatalogState } from './ai-model-catalog';

const d = (iso: string) => new Date(iso);
const pack = (
  id: string,
  boards: number,
  bought: string,
  months = 12,
): PackForSettlement => ({
  id,
  boards,
  createdAt: d(bought),
  expiresAt: addMonthsUtc(d(bought), months),
});
const map = (o: Record<string, number>) => new Map(Object.entries(o));

describe('the unit', () => {
  it('included boards: 5 per paired screen, never below 10', () => {
    expect(includedBoardsFor(0)).toBe(10);
    expect(includedBoardsFor(1)).toBe(10);
    expect(includedBoardsFor(2)).toBe(10);
    expect(includedBoardsFor(3)).toBe(15);
    expect(includedBoardsFor(40)).toBe(200);
    expect(includedBoardsFor(NaN)).toBe(10);
    expect(includedBoardsFor(-4)).toBe(10);
  });

  it('a credit is a board DRAWN for the tenant; the loop that makes it good is never one', () => {
    expect([...BOARD_CREDIT_FEATURES].sort()).toEqual([
      'designer',
      'designer-revise',
    ]);
    for (const internal of [
      'designer-redraw',
      'designer-review',
      'designer-review-revise',
      'designer-brief',
    ]) {
      expect(BOARD_CREDIT_FEATURES).not.toContain(internal);
    }
    // the board pipeline is governed by the board cap, so it leaves the dollar allowance…
    expect(BOARD_PIPELINE_FEATURES).toEqual(
      expect.arrayContaining([
        'designer',
        'designer-revise',
        'designer-redraw',
        'designer-review',
        'designer-review-revise',
      ]),
    );
    // …except the brief read, a fast-tier call with its own endpoint (stays on the dollar allowance)
    expect(BOARD_PIPELINE_FEATURES).not.toContain('designer-brief');
    // our cost per board counts every dollar that went into making boards
    expect(BOARD_COGS_FEATURES).toEqual(
      expect.arrayContaining([...BOARD_PIPELINE_FEATURES, 'designer-brief']),
    );
  });

  it('the packs: known ids, and a bigger pack is never a worse price per board', () => {
    expect(AI_BOARD_PACKS.map((p) => p.id)).toEqual([
      'starter',
      'standard',
      'bulk',
    ]);
    expect(new Set(AI_BOARD_PACKS.map((p) => p.id)).size).toBe(
      AI_BOARD_PACKS.length,
    );
    const perBoard = AI_BOARD_PACKS.map((p) => p.usd / p.boards);
    for (let i = 1; i < perBoard.length; i++)
      expect(perBoard[i]).toBeLessThan(perBoard[i - 1]);
    for (const p of AI_BOARD_PACKS) {
      expect(Number.isInteger(p.boards) && p.boards > 0).toBe(true);
      expect(p.usd).toBeGreaterThan(0);
      expect(Math.round(p.usd * 1_000_000)).toBeLessThan(2 ** 31); // usd_micros is an Int
    }
    expect(boardPackById('standard')).toEqual({
      id: 'standard',
      boards: 30,
      usd: 19,
    });
    expect(boardPackById('STANDARD')).toBeNull();
    expect(boardPackById(undefined)).toBeNull();
    expect(boardPackById({ id: 'bulk' })).toBeNull();
  });

  it('months are UTC calendar months', () => {
    expect(monthKey(d('2026-09-30T23:59:59.999Z'))).toBe('2026-09');
    expect(monthKey(d('2026-10-01T00:00:00.000Z'))).toBe('2026-10');
    expect(monthStart('2026-12', 1).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
    expect(addMonthsUtc(d('2026-09-23T17:05:00.000Z'), 12).toISOString()).toBe(
      '2027-09-23T17:05:00.000Z',
    );
    expect(addMonthsUtc(d('2026-10-15T00:00:00.000Z'), -24).toISOString()).toBe(
      '2024-10-15T00:00:00.000Z',
    );
  });

  it('boards left: the rest of the included, then the packs — never negative', () => {
    expect(boardsLeftFor(10, 3, 0)).toBe(7);
    expect(boardsLeftFor(10, 14, 30)).toBe(30); // the 4 over came out of the packs already (settlement)
    expect(boardsLeftFor(10, 12, 0)).toBe(0);
  });
});

describe('settleBoardPacks — month by month, soonest-expiring pack first', () => {
  const now = d('2026-09-23T12:00:00Z');

  it('no packs → nothing purchased, nothing to settle', () => {
    const s = settleBoardPacks({
      packs: [],
      usedByMonth: map({ '2026-09': 50 }),
      includedByMonth: map({ '2026-09': 10 }),
      now,
    });
    expect(s).toEqual({
      remaining: new Map(),
      purchasedRemaining: 0,
      unfunded: 0,
    });
  });

  it("a pack is drawn on only AFTER the month's included boards are gone", () => {
    const packs = [pack('p1', 30, '2026-09-05T00:00:00Z')];
    expect(
      settleBoardPacks({
        packs,
        usedByMonth: map({ '2026-09': 10 }),
        includedByMonth: map({ '2026-09': 10 }),
        now,
      }).purchasedRemaining,
    ).toBe(30);
    expect(
      settleBoardPacks({
        packs,
        usedByMonth: map({ '2026-09': 14 }),
        includedByMonth: map({ '2026-09': 10 }),
        now,
      }).purchasedRemaining,
    ).toBe(26);
  });

  it('what a pack covered in an EARLIER month stays spent — a new month refills the included, never the pack', () => {
    const packs = [pack('p1', 30, '2026-07-10T00:00:00Z')];
    const s = settleBoardPacks({
      packs,
      usedByMonth: map({ '2026-07': 16, '2026-08': 9, '2026-09': 3 }),
      includedByMonth: map({ '2026-07': 10, '2026-08': 10, '2026-09': 10 }),
      now,
    });
    expect(s.remaining.get('p1')).toBe(24); // July's 6 over; August and September under
    expect(s.purchasedRemaining).toBe(24);
  });

  it('a month with no recorded allowance draws nothing from the packs (benefit of the doubt to the customer)', () => {
    const packs = [pack('p1', 30, '2026-07-10T00:00:00Z')];
    const s = settleBoardPacks({
      packs,
      usedByMonth: map({ '2026-07': 16, '2026-08': 25 }),
      includedByMonth: map({ '2026-07': 10 }), // August never recorded
      now,
    });
    expect(s.remaining.get('p1')).toBe(24);
  });

  it('two packs: the one that expires first is drawn first', () => {
    const packs = [
      pack('late', 30, '2026-09-01T00:00:00Z'),
      pack('early', 10, '2026-03-01T00:00:00Z'),
    ];
    const s = settleBoardPacks({
      packs,
      usedByMonth: map({ '2026-09': 25 }),
      includedByMonth: map({ '2026-09': 10 }),
      now,
    });
    expect(s.remaining.get('early')).toBe(0);
    expect(s.remaining.get('late')).toBe(25);
    expect(s.purchasedRemaining).toBe(25);
  });

  it("an EXPIRED pack's unused boards lapse — only unexpired packs count as purchased-remaining", () => {
    const packs = [
      pack('old', 10, '2025-08-01T00:00:00Z'),
      pack('new', 30, '2026-09-10T00:00:00Z'),
    ];
    const s = settleBoardPacks({
      packs,
      usedByMonth: map({}),
      includedByMonth: map({}),
      now,
    });
    expect(s.remaining.get('old')).toBe(10); // never touched…
    expect(s.purchasedRemaining).toBe(30); // …and not spendable: it expired on 2026-08-01
  });

  it('a pack that expires mid-month still carries the share of that month it covered', () => {
    // 'early' expires 2026-09-15; September used 14 of 10 included → 4 over, drawn from 'early' first.
    const packs = [
      pack('early', 10, '2025-09-15T00:00:00Z'),
      pack('late', 10, '2026-09-01T00:00:00Z'),
    ];
    const s = settleBoardPacks({
      packs,
      usedByMonth: map({ '2026-09': 14 }),
      includedByMonth: map({ '2026-09': 10 }),
      now,
    });
    expect(s.remaining.get('early')).toBe(6); // lapsed with 6 unused
    expect(s.remaining.get('late')).toBe(10); // untouched: the lapsed pack paid for September's 4
    expect(s.purchasedRemaining).toBe(10);
  });

  it('a pack bought AFTER a month ended never pays for that month (a race past the pre-check is reported, not billed)', () => {
    const packs = [pack('p1', 30, '2026-09-02T00:00:00Z')];
    const s = settleBoardPacks({
      packs,
      usedByMonth: map({ '2026-08': 13 }),
      includedByMonth: map({ '2026-08': 10 }),
      now,
    });
    expect(s.remaining.get('p1')).toBe(30);
  });

  it('overage no pack could cover is reported as unfunded', () => {
    const packs = [pack('p1', 3, '2026-09-02T00:00:00Z')];
    const s = settleBoardPacks({
      packs,
      usedByMonth: map({ '2026-09': 15 }),
      includedByMonth: map({ '2026-09': 10 }),
      now,
    });
    expect(s).toMatchObject({ purchasedRemaining: 0, unfunded: 2 });
  });
});

describe('who may buy a pack', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_AI_API_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    setCatalogState({});
  });
  afterAll(() => {
    process.env = saved;
    setCatalogState({});
  });

  it('a board can be drawn on our key only with a DESIGN route — an Anthropic-only deploy has none', () => {
    expect(platformDesignRouteAvailable()).toBe(false);
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    expect(platformDesignRouteAvailable()).toBe(false); // design never falls back to Claude
    process.env.OPENAI_API_KEY = 'sk-openai';
    expect(platformDesignRouteAvailable()).toBe(true);
    delete process.env.OPENAI_API_KEY;
    process.env.GEMINI_API_KEY = 'AIza';
    expect(platformDesignRouteAvailable()).toBe(true);
  });

  it('no platform design key → NO_PLATFORM_KEY (a pack would buy nothing usable), whatever the source says', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    expect(boardPurchaseAvailability('none')).toMatchObject({
      enabled: false,
      reasonCode: 'NO_PLATFORM_KEY',
      reason: 'AI runs on your own key — add it in Settings → AI provider.',
    });
    expect(boardPurchaseAvailability('platform')).toMatchObject({
      enabled: false,
      reasonCode: 'NO_PLATFORM_KEY',
    });
  });

  it('own key → OWN_KEY; Stripe off → STRIPE_NOT_CONFIGURED; both in place → enabled', () => {
    process.env.OPENAI_API_KEY = 'sk-openai';
    expect(boardPurchaseAvailability('tenant')).toMatchObject({
      enabled: false,
      reasonCode: 'OWN_KEY',
    });
    expect(boardPurchaseAvailability('platform')).toMatchObject({
      enabled: false,
      reasonCode: 'STRIPE_NOT_CONFIGURED',
    });
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    expect(boardPurchaseAvailability('platform')).toEqual({ enabled: true });
  });
});

describe('the 402 message', () => {
  const resetAt = '2026-10-01T00:00:00.000Z';
  it('names the numbers and both ways forward', () => {
    expect(
      boardsCapMessage({
        needed: 2,
        left: 1,
        resetAt,
        purchaseEnabled: true,
        kind: 'batch',
      }),
    ).toBe(
      'This batch needs 2 boards; you have 1 left this month (included boards reset October 1). ' +
        'Buy more boards in Settings → Billing, or add your own AI key in Settings → AI provider — you pay your provider directly, with no limit here.',
    );
  });
  it('one board, none left, and no "buy more" when a pack cannot be bought', () => {
    const m = boardsCapMessage({
      needed: 1,
      left: 0,
      resetAt,
      purchaseEnabled: false,
      kind: 'refine',
    });
    expect(m).toContain(
      'This edit needs 1 board; you have none left this month',
    );
    expect(m).not.toContain('Buy more');
    expect(m).toContain('Settings → AI provider');
  });
});
