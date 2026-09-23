/**
 * The matcher has exactly one job: say what the SCREEN will do. If it
 * disagrees with the board's own `applyMenu()` it is worse than nothing,
 * because the operator would believe it.
 *
 * So the first test does not assert my normalization — it extracts the
 * REAL `norm()` out of a shipped board and runs both over the same
 * inputs. If someone edits either side, this fails.
 */
import fs from 'fs';
import path from 'path';
import {
  normalizeMenuName, boardMenuRows, matchMenuToBoard, isMenuDrivenBoard, isNameLeaf,
} from '../menu-matching';

const BOARD = path.resolve(
  __dirname, '..', '..', '..', '..', 'public/templates/signage/qsr/02-counter-menu.html',
);

/** Pull the board's own norm() out of its baked applyMenu and eval it. */
function boardNorm(): (s: unknown) => string {
  const html = fs.readFileSync(BOARD, 'utf8');
  const m = html.match(/function norm\(s\)\{[\s\S]*?\}(?=function)/);
  if (!m) throw new Error('could not find norm() in the shipped board — did applyMenu change?');
  // eslint-disable-next-line no-new-func
  return new Function(`${m[0]}; return norm;`)() as (s: unknown) => string;
}

describe('our normalization is the board’s normalization', () => {
  const SAMPLES = [
    'burger', 'BURGER', ' Burger ', 'Double-Bacon Burger', 'Mac & Cheese',
    'Fish  &  Chips', "Chef's Special", 'Café Latte', '12" Pizza', 'Kids’ Meal',
    'SHAKE (Large)', 'fries — large', '', '   ', 'A1 Sauce', 'Soda/Pop',
  ];
  it.each(SAMPLES)('normalizes %p identically to the shipped board', (s) => {
    expect(normalizeMenuName(s)).toBe(boardNorm()(s));
  });

  it('matches the board on non-string input too', () => {
    const n = boardNorm();
    for (const v of [null, undefined, 42, true]) {
      expect(normalizeMenuName(v)).toBe(n(v as unknown));
    }
  });
});

describe('which board rows take a live price', () => {
  const fields = [
    { key: 'item.0.name', defaultText: 'Burger' },
    { key: 'item.0.price', defaultText: '$8.00' },
    { key: 'item.1.name', defaultText: 'Fries' },
    { key: 'item.1.price', defaultText: '$3.00' },
    // NOT a menu row by intent — but the board does not know that either.
    { key: 'brand.name', defaultText: 'The Diner' },
    { key: 'item.2.n', defaultText: 'Shake' },       // short leaf, still a name
  ];

  it('finds every group with a name leaf — including ones that are not menu rows', () => {
    // `applyMenu` groups EVERY [data-field] by its prefix and accepts any
    // group with a name leaf, so `brand.name` is a candidate on the real
    // board too. Filtering it out here would make this report disagree
    // with the screen, which is the one thing it must never do: a
    // "brand.name" that happens to match a catalog item really would take
    // a live price. Faithful beats tidy.
    const rows = boardMenuRows(fields);
    expect(rows.map((r) => r.group)).toEqual(['item.0', 'item.1', 'brand', 'item.2']);
  });

  it('honors both name leaves the board honors', () => {
    expect(isNameLeaf('name')).toBe(true);
    expect(isNameLeaf('n')).toBe(true);
    expect(isNameLeaf('title')).toBe(false);
  });

  it('matches on what the board DISPLAYS — an override changes the join', () => {
    // The board looks up its own rendered text, so renaming a row in the
    // editor repoints which catalog item it takes.
    const rows = boardMenuRows(fields, { 'item.0.name': 'Cheeseburger' });
    expect(rows[0].displayName).toBe('Cheeseburger');
    expect(matchMenuToBoard(rows, ['Burger']).matched).toHaveLength(0);
    expect(matchMenuToBoard(rows, ['Cheeseburger']).matched).toHaveLength(1);
  });

  it('skips a row whose name has been blanked', () => {
    expect(boardMenuRows(fields, { 'item.0.name': '' }).map((r) => r.group))
      .toEqual(['item.1', 'brand', 'item.2']);
  });
});

describe('both directions of failure are reported', () => {
  const rows = boardMenuRows([
    { key: 'item.0.name', defaultText: 'Burger' },
    { key: 'item.1.name', defaultText: 'Fries' },
    { key: 'item.2.name', defaultText: 'Onion Rings' },
  ]);

  it('a board row with no catalog item keeps its typed price — and is named', () => {
    const r = matchMenuToBoard(rows, ['burger', 'FRIES', 'shake']);
    expect(r.matched.map((m) => m.displayName)).toEqual(['Burger', 'Fries']);
    expect(r.boardOnly.map((b) => b.displayName)).toEqual(['Onion Rings']);
  });

  it('a catalog item no board shows is the operator’s edit going nowhere', () => {
    const r = matchMenuToBoard(rows, ['burger', 'fries', 'shake']);
    expect(r.catalogOnly).toEqual(['shake']);
  });

  it('case and punctuation do not decide it', () => {
    const r = matchMenuToBoard(
      boardMenuRows([{ key: 'i.0.name', defaultText: 'Mac & Cheese' }]),
      ['mac and cheese'],
    );
    // "&" and "and" are genuinely different after normalization — the
    // board would not match these either, and saying otherwise would lie.
    expect(r.matched).toHaveLength(0);
    expect(r.boardOnly).toHaveLength(1);
  });

  it('duplicate catalog names collapse to one, as the board’s index does', () => {
    const r = matchMenuToBoard(rows, ['Burger', 'burger']);
    expect(r.matched).toHaveLength(1);
    expect(r.catalogOnly).toEqual([]);
  });
});

describe('which boards the live menu feeds', () => {
  it.each([
    ['/templates/signage/qsr/02-counter-menu.html', true],
    ['/templates/signage/bar/03-taps.html', true],
    ['/templates/signage/menus-pos/x.html', true],
    ['/templates/hs/varsity.html', false],
  ])('%s → %s', (url, expected) => {
    expect(isMenuDrivenBoard({ url })).toBe(expected);
  });

  // 2026-09-23 (POS-A) — this used to say "an explicit flag turns any board
  // into a menu board". It does not: a flag cannot give a board a runtime that
  // reads the menu. Such a board reaches the POS only through explicit
  // bindings, which the name-join does not describe.
  it('a "Driven by POS" flag does NOT make a board without a menu runtime name-match', () => {
    expect(isMenuDrivenBoard({ url: '/templates/hs/varsity.html', posSync: true })).toBe(false);
    expect(isMenuDrivenBoard({ url: '/templates/hs/varsity.html', dataSource: 'POS' })).toBe(false);
    expect(isMenuDrivenBoard({ url: '/templates/signage/qsr/redesign-counter-v1-the-pass.html', posSync: true })).toBe(false);
    expect(isMenuDrivenBoard({ posSync: true })).toBe(false); // an inline AI board
  });
});

describe('the one-click fix aims itself', () => {
  const { nameSimilarity, planRowFills } = jest.requireActual('../menu-matching');

  it('an obvious pair beats an alphabetically earlier one', () => {
    const rows = boardMenuRows([
      { key: 'item.0.name', defaultText: 'Onion Rings' },
      { key: 'item.1.name', defaultText: 'Milk Shake' },
    ]);
    const plan = planRowFills(rows, ['Apple Pie', 'onion ring', 'milkshake']);
    const byRow = Object.fromEntries(plan.map((p: { fieldKey: string; to: string }) => [p.fieldKey, p.to]));
    expect(byRow['item.0.name']).toBe('onion ring');
  });

  it('writes the name field of the row it is fixing', () => {
    const rows = boardMenuRows([{ key: 'item.4.name', defaultText: 'Burgers' }]);
    const plan = planRowFills(rows, ['Burger']);
    expect(plan).toEqual([{ fieldKey: 'item.4.name', from: 'Burgers', to: 'Burger' }]);
  });

  it('leaves unrelated things alone rather than pairing spares', () => {
    const rows = boardMenuRows([{ key: 'item.0.name', defaultText: 'Espresso' }]);
    expect(planRowFills(rows, ['Onion Rings'])).toEqual([]);
  });

  it('never reuses a row or an item', () => {
    const rows = boardMenuRows([
      { key: 'a.0.name', defaultText: 'Burger' },
      { key: 'a.1.name', defaultText: 'Burger' },
    ]);
    const plan = planRowFills(rows, ['burger']);
    expect(plan).toHaveLength(1);
  });

  it('a plan actually closes the gap it was built from', () => {
    const rows = boardMenuRows([
      { key: 'i.0.name', defaultText: 'Fries' },
      { key: 'i.1.name', defaultText: 'Onion Rings' },
    ]);
    const catalog = ['French Fries', 'onion ring'];
    const before = matchMenuToBoard(rows, catalog);
    expect(before.matched).toHaveLength(0);

    const plan = planRowFills(before.boardOnly, before.catalogOnly);
    const overrides = Object.fromEntries(plan.map((p: { fieldKey: string; to: string }) => [p.fieldKey, p.to]));
    const after = matchMenuToBoard(
      boardMenuRows([
        { key: 'i.0.name', defaultText: 'Fries' },
        { key: 'i.1.name', defaultText: 'Onion Rings' },
      ], overrides),
      catalog,
    );
    expect(after.matched).toHaveLength(2);
    expect(after.boardOnly).toHaveLength(0);
  });

  it('identical names score 1, unrelated score 0', () => {
    expect(nameSimilarity('Burger', 'burger')).toBe(1);
    expect(nameSimilarity('Burger', 'Espresso')).toBe(0);
  });
});
