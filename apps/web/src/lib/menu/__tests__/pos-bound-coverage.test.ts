/**
 * pos-bound-coverage — the builder grades a bound board's rows with the SAME
 * rule the screen paints them with, so what it says and what the glass shows
 * cannot drift.
 */
import { boardRowNames, posBoundCoverage, type BoundMenuItem } from '../pos-bound-coverage';
import { bindingStateOf, resolveMenuBindings, parseMenuBindings } from '../resolve-menu-bindings';
import { keptPosBoardHtml } from '../../../../tests/fixtures/kept-pos-board';

const ITEMS: BoundMenuItem[] = [
  { externalId: 'birria', name: '3 Birria Tacos', price: '$15.25', available: true },
  { externalId: 'horchata', name: 'Horchata', price: '$3.25', available: false },
];
const SLOTS = { 'item.10': 'birria', 'item.2': 'horchata', 'item.1': 'asada' };

describe('posBoundCoverage', () => {
  const cov = posBoundCoverage(SLOTS, ITEMS);

  it('grades every bound row: live, sold out right now, not on the menu', () => {
    expect(cov.rows.map((r) => [r.slot, r.state])).toEqual([
      ['item.1', 'missing'],
      ['item.2', 'soldout'],
      ['item.10', 'live'],
    ]);
    expect(cov.live.map((r) => r.item?.name)).toEqual(['3 Birria Tacos']);
    expect(cov.soldOut.map((r) => r.slot)).toEqual(['item.2']);
    expect(cov.missing.map((r) => r.slot)).toEqual(['item.1']);
    expect(cov.rows.map((r) => r.row)).toEqual(['1', '2', '10']);
  });

  it('is the screen’s own rule — the resolver agrees on every row', () => {
    const screen = resolveMenuBindings({
      bindings: parseMenuBindings(SLOTS),
      items: ITEMS.map((i) => ({ ...i })),
      configured: true,
    });
    for (const r of cov.rows) {
      expect(screen.rows.find((s) => s.slot === r.slot)!.state).toBe(r.state);
      expect(bindingStateOf(r.item)).toBe(r.state);
    }
  });

  it('a duplicate id prefers the copy that is available (as the screen does)', () => {
    const dup = [{ externalId: 'horchata', name: 'Horchata', price: '$3.50', available: true }, ...ITEMS];
    expect(posBoundCoverage({ 'item.0': 'horchata' }, dup).rows[0].state).toBe('live');
  });

  it('no bound rows → nothing to grade', () => {
    expect(posBoundCoverage({}, ITEMS)).toEqual({ rows: [], live: [], soldOut: [], missing: [] });
  });
});

describe('boardRowNames — the words a row keeps when its item leaves the menu', () => {
  it('reads each row’s name off the real kept board', () => {
    expect(boardRowNames(keptPosBoardHtml())).toMatchObject({
      'item.0': '3 Birria Tacos',
      'item.1': 'Asada Super Burrito',
      'item.2': 'Horchata',
    });
  });

  it('never throws on junk', () => {
    expect(boardRowNames('')).toEqual({});
    expect(boardRowNames('<not html')).toEqual({});
  });
});
