/**
 * lib/ai-boards (2026-09-23): the ONE boards-left line every surface shows, the reasons it gives,
 * the pack and purchase lines, the history row text, and the 402 test — fed the producer-shaped
 * bodies of tests/fixtures/ai-boards.ts. Plus lib/checkout-redirect (https only).
 */
import { useTranslations } from 'next-intl';
import {
  historyContractItem,
  historyPlainItem,
  noKeyAllowance,
  ownKeyAllowance,
  packPurchase,
  platformAllowance,
  purchaseReasonsFromSource,
} from '../../../tests/fixtures/ai-boards';
import {
  boardsLine,
  boardsReason,
  boardsResetDay,
  formatUsd,
  historyBrief,
  historyWhen,
  isAiCapError,
  packPurchaseLines,
} from '../ai-boards';
import { goToCheckout } from '../checkout-redirect';

const t = useTranslations('aiBoards') as unknown as (key: string, values?: Record<string, string | number>) => string;

describe('boardsLine — what the dialog, Settings → AI and the Stripe return all say', () => {
  it('our key: "14 of 20 boards left this month · resets Oct 1", Buy more on offer', () => {
    expect(boardsLine(t, 'en', platformAllowance({ included: 20, used: 6 }))).toEqual({
      text: '14 of 20 boards left this month · resets Oct 1',
      note: null,
      canBuy: true,
      out: false,
    });
  });

  it('bought boards count in what is left, and the line says how many of them there are', () => {
    // 50 included, 12 used, 24 bought still unused → 62 left of the 74 this month could draw.
    expect(boardsLine(t, 'en', platformAllowance({ included: 50, used: 12, purchasedRemaining: 24 }))?.text).toBe(
      '62 of 74 boards left · 24 bought · monthly boards reset Oct 1',
    );
    // Past the included boards and into a pack: 10 included, 15 used, 25 of 30 bought left.
    expect(boardsLine(t, 'en', platformAllowance({ included: 10, used: 15, purchasedRemaining: 25 }))?.text).toBe(
      '25 of 40 boards left · 25 bought · monthly boards reset Oct 1',
    );
  });

  it('none left: the line is marked out (the surfaces show it as a warning)', () => {
    const line = boardsLine(t, 'en', platformAllowance({ included: 20, used: 20 }));
    expect(line?.text).toBe('0 of 20 boards left this month · resets Oct 1');
    expect(line?.out).toBe(true);
  });

  it('our key, but no pack can be bought (Stripe not set up): no Buy more — the line says why', () => {
    expect(boardsLine(t, 'en', platformAllowance({ purchase: 'STRIPE_NOT_CONFIGURED' }))).toEqual({
      text: '14 of 20 boards left this month · resets Oct 1',
      note: "Buying more boards isn't set up on this deployment yet.",
      canBuy: false,
      out: false,
    });
  });

  it('their own key: no limit, nothing to buy', () => {
    expect(boardsLine(t, 'en', ownKeyAllowance())).toEqual({
      text: 'Using your own AI key — no board limit',
      note: null,
      canBuy: false,
      out: false,
    });
  });

  it('nobody\'s key: the reason, in the operator\'s words', () => {
    expect(boardsLine(t, 'en', noKeyAllowance())?.text).toBe('AI runs on your own key — add it in Settings → AI provider.');
  });

  it('a degraded answer (the API\'s floor) still reads as a line; no answer reads as nothing', () => {
    expect(boardsLine(t, 'en', platformAllowance({ included: 10, used: 0, degraded: true }))?.text).toBe(
      '10 of 10 boards left this month · resets Oct 1',
    );
    expect(boardsLine(t, 'en', undefined)).toBeNull();
    expect(boardsLine(t, 'en', { ...platformAllowance(), boardsLeft: null })).toBeNull();
  });
});

describe('boardsReason', () => {
  it('translates a code this build knows; falls back to the API\'s own line for one it does not', () => {
    const reasons = purchaseReasonsFromSource();
    expect(boardsReason(t, { code: 'OWN_KEY', text: reasons.OWN_KEY })).toBe(reasons.OWN_KEY);
    expect(boardsReason(t, { code: 'SOMETHING_NEW', text: 'A reason from a newer API.' })).toBe('A reason from a newer API.');
    expect(boardsReason(t, { code: null, text: '  ' })).toBeNull();
    expect(boardsReason(t, null)).toBeNull();
  });
});

describe('boardsResetDay — named in UTC', () => {
  it('the first instant of next UTC month is "Oct 1" in any zone (a US zone would say Sep 30 locally)', () => {
    expect(boardsResetDay('2026-10-01T00:00:00.000Z', 'en')).toBe('Oct 1');
    expect(boardsResetDay('2027-01-01T00:00:00.000Z', 'en')).toBe('Jan 1');
    expect(boardsResetDay('not a date', 'en')).toBe('');
  });
});

describe('packs and purchases', () => {
  it('prices: whole dollars carry no cents', () => {
    expect(formatUsd(19, 'en')).toBe('$19');
    expect(formatUsd(9.5, 'en')).toBe('$9.50');
  });

  it('a pack still being drawn, one used up, one expired', () => {
    const day = (iso: string) => new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso));
    const active = packPurchase({ pack: 'standard', remaining: 24 });
    expect(packPurchaseLines(t, 'en', active)).toEqual({
      title: '30 boards · $19',
      detail: `Bought ${day(active.purchasedAt)} · 24 left · good until ${day(active.expiresAt)}`,
    });
    const usedUp = packPurchase({ pack: 'starter', remaining: 0 });
    expect(packPurchaseLines(t, 'en', usedUp)).toEqual({ title: '10 boards · $9', detail: `Bought ${day(usedUp.purchasedAt)} · all used` });
    const expired = packPurchase({ pack: 'bulk', remaining: 0, expired: true, expiresAt: '2026-08-01T00:00:00.000Z' });
    expect(packPurchaseLines(t, 'en', expired).detail).toBe(`Bought ${day(expired.purchasedAt)} · expired ${day(expired.expiresAt)}`);
  });
});

describe('the history row', () => {
  it('the brief is the prompt\'s first line (the API keeps 140 characters of it)', () => {
    const item = historyContractItem({ id: 'job-h1' });
    expect(historyBrief(item)).toBe(item.prompt);
    expect(historyBrief({ prompt: 'A taco menu board\n\nOperator\'s exact words from the chat — …', venueName: 'Super Taco' })).toBe(
      'A taco menu board',
    );
  });

  it('no prompt → the venue\'s name → nothing (the row then says "Untitled batch")', () => {
    expect(historyBrief(historyPlainItem({ id: 'job-h2', prompt: '  \n ', venueName: 'Super Taco' }))).toBe('Super Taco');
    expect(historyBrief(historyPlainItem({ id: 'job-h3', prompt: '', venueName: null }))).toBe('');
  });

  it('when: date and time in the viewer\'s zone', () => {
    const iso = '2026-09-20T12:03:00.000Z';
    const expected = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
    expect(historyWhen(iso, 'en')).toBe(expected);
    expect(historyWhen('', 'en')).toBe('');
  });
});

describe('isAiCapError — the one 402 every AI surface uses', () => {
  it.each([
    [{ code: 'AI_CAP_REACHED', status: 402 }, true],
    [{ status: 402 }, true],
    [{ code: 'AI_CAP_REACHED' }, true],
    [{ code: 'AI_DESIGN_JOBS_BUSY', status: 429 }, false],
    [{ code: 'MENU_BINDING_INCOMPLETE', status: 422 }, false],
    [null, false],
  ])('%j → %s', (e, expected) => {
    expect(isAiCapError(e)).toBe(expected);
  });
});

describe('goToCheckout — the same-tab redirect, to an https page only', () => {
  // jsdom cannot navigate: the navigation is handed a recorder.
  it('sends the browser to Stripe\'s page', () => {
    const navigate = jest.fn();
    expect(goToCheckout('https://checkout.stripe.com/c/pay/cs_test_a1', navigate)).toBe(true);
    expect(navigate).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_a1');
  });

  it.each(['http://checkout.stripe.com/c/pay/x', 'javascript:alert(1)', 'not a url', ''])('refuses %j', (url) => {
    const navigate = jest.fn();
    expect(goToCheckout(url, navigate)).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
