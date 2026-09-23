/**
 * conciergePos — the POS card's pure logic (2026-09-22). The contexts are
 * producer-cut (concierge-pos-context.fixture.ts).
 */
import {
  buildPosSelection,
  canTick,
  connectsByOAuth,
  detectedPosIds,
  looksLikeMenuBoard,
  posCardView,
  preTickSections,
  rowLimitFor,
  tickedItemCount,
} from '../conciergePos';
import { POS_CONTEXT_NONE, POS_CONTEXT_TOAST } from './concierge-pos-context.fixture';

const SECTIONS = POS_CONTEXT_TOAST.connections[0].sections; // Tacos 13, Burritos 8, Drinks 26

describe('looksLikeMenuBoard', () => {
  it('the intake says menu, a reference carries a menu, or the operator\'s words ask for one', () => {
    expect(looksLikeMenuBoard({ intake: { purpose: 'menu' } })).toBe(true);
    expect(looksLikeMenuBoard({ intake: { widgets: ['headline', 'menu'] } })).toBe(true);
    expect(looksLikeMenuBoard({ references: [{ kind: 'url', summary: 's', menu: { sections: [{ name: 'Tacos', items: [{ name: 'Al Pastor' }] }], itemCount: 1 } } as any] })).toBe(true);
    expect(looksLikeMenuBoard({ operatorText: 'a menu board for the counter' })).toBe(true);
    expect(looksLikeMenuBoard({ operatorText: 'show our happy hour prices' })).toBe(true);
    expect(looksLikeMenuBoard({ operatorText: 'un tablero con el menú' })).toBe(true);
    expect(looksLikeMenuBoard({ operatorText: '做一个菜单看板' })).toBe(true);
  });
  it('a welcome board for a taco shop is NOT a menu board', () => {
    expect(looksLikeMenuBoard({ intake: { purpose: 'welcome' }, operatorText: 'welcome board for our taco shop' })).toBe(false);
  });
});

describe('rowLimitFor', () => {
  it('matches the server: 24 at 1080p-class, 28 at 4K', () => {
    expect(rowLimitFor({ w: 1920, h: 1080 })).toBe(24);
    expect(rowLimitFor({ w: 3840, h: 2160 })).toBe(28);
  });
});

describe('preTickSections', () => {
  it('ticks the sections the operator NAMED (singular or plural)', () => {
    expect(preTickSections(SECTIONS, 'just our taco and burrito menu please', 24)).toEqual(['Tacos', 'Burritos']);
  });
  it('named nothing: every section, in POS order, while it still fits one screen — never an oversized one', () => {
    expect(preTickSections(SECTIONS, 'a menu board', 24)).toEqual(['Tacos', 'Burritos']);
    expect(preTickSections(SECTIONS, 'a menu board', 16)).toEqual(['Tacos']);
  });
  it('named a section that cannot fit: nothing is swapped in for it (Drinks, 26, on a 24-row screen)', () => {
    expect(preTickSections(SECTIONS, 'the drinks menu', 24)).toEqual([]);
  });
});

describe('ticking stays within the row limit (the server enforces the same number)', () => {
  it('counts and refuses a section that would overflow', () => {
    expect(tickedItemCount(SECTIONS, ['Tacos', 'Burritos'])).toBe(21);
    expect(canTick(SECTIONS, ['Tacos', 'Burritos'], 'Drinks', 24)).toBe(false);
    expect(canTick(SECTIONS, ['Tacos'], 'Burritos', 24)).toBe(true);
    expect(canTick(SECTIONS, ['Tacos', 'Burritos'], 'Tacos', 24)).toBe(true); // unticking is always allowed
  });
  it('builds the selection only when something is ticked', () => {
    expect(buildPosSelection('conn-chain-toast', ['Tacos'])).toEqual({ connectionId: 'conn-chain-toast', sections: ['Tacos'] });
    expect(buildPosSelection('conn-chain-toast', [])).toBeUndefined();
  });
});

describe('posCardView', () => {
  const base = { enabled: true, isMenu: true, selection: undefined, declined: false };
  it('offers the connected menu', () => {
    expect(posCardView({ ...base, context: POS_CONTEXT_TOAST }).kind).toBe('offer');
  });
  it('asks which POS when nothing is connected — the one their site links to FIRST', () => {
    const refs: any[] = [{ kind: 'url', summary: 's', detectedPos: [{ providerId: 'toast', name: 'Toast', confidence: 0.7 }] }];
    const view = posCardView({ ...base, context: POS_CONTEXT_NONE, references: refs });
    expect(view.kind).toBe('connect');
    if (view.kind === 'connect') {
      expect(view.detected).toEqual(['toast']);
      expect(view.providers[0].providerId).toBe('toast');
    }
  });
  it('says the menu has not synced when the connection has no items yet', () => {
    const unsynced = { ...POS_CONTEXT_TOAST, connections: [{ ...POS_CONTEXT_TOAST.connections[0], itemCount: 0, sections: [] }] };
    expect(posCardView({ ...base, context: unsynced }).kind).toBe('unsynced');
  });
  it('shows the pick once made, and the declined note once declined', () => {
    const view = posCardView({ ...base, context: POS_CONTEXT_TOAST, selection: { connectionId: 'conn-chain-toast', sections: ['Tacos'] } });
    expect(view).toMatchObject({ kind: 'selected', itemCount: 13 });
    expect(posCardView({ ...base, context: POS_CONTEXT_TOAST, declined: true }).kind).toBe('declined');
  });
  it('hidden for a non-menu board, while loading, or when the page did not turn it on', () => {
    expect(posCardView({ ...base, isMenu: false, context: POS_CONTEXT_TOAST }).kind).toBe('hidden');
    expect(posCardView({ ...base, context: undefined }).kind).toBe('hidden');
    expect(posCardView({ ...base, enabled: false, context: POS_CONTEXT_TOAST }).kind).toBe('hidden');
  });
});

describe('connecting', () => {
  it('Square / Clover / Lightspeed open their OAuth in a new tab; Toast and Shopify go to Settings → POS', () => {
    const byId = Object.fromEntries(POS_CONTEXT_NONE.connectable.map((p) => [p.providerId, connectsByOAuth(p)]));
    expect(byId).toEqual({ square: true, toast: false, clover: true, 'lightspeed-retail': true, 'shopify-pos': false });
  });
  it('reads detectedPos off the references', () => {
    expect(detectedPosIds([{ kind: 'url', summary: 's', detectedPos: [{ providerId: 'square', name: 'Square', confidence: 0.6 }] } as any])).toEqual(['square']);
    expect(detectedPosIds([])).toEqual([]);
  });
});
