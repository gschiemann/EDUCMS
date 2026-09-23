/**
 * buildPosBindingPlan — the server, not the client, decides what a POS-bound AI
 * board shows (2026-09-22). The menu fixture is shaped exactly as
 * MenuService.resolveMenuForLocation returns it (ResolvedMenu: categories in
 * sort order, items with externalId / priceCents / category name).
 */
import {
  buildPosBindingPlan,
  formatPosPlanContent,
  posSectionsOf,
  PosPlanError,
  POS_ROW_CONTRACT_LINE,
  UNCATEGORIZED_SECTION,
} from './pos-binding-plan';
import { countMenuContentRows } from './designer-prompt';
import { conciergePosRowLimit } from '@cms/api-types';

const item = (externalId: string | null, name: string, priceCents: number, category: string | null, description?: string) => ({
  id: `mi-${externalId}`,
  externalId,
  name,
  description: description ?? null,
  priceCents,
  priceOverridden: false,
  imageUrl: null,
  allergens: [],
  tags: [],
  category,
  categoryId: category ? `cat-${category}` : null,
  sortOrder: 0,
  available: true,
  soldOut: false,
});

const MENU = {
  locationTenantId: 'loc-1',
  generatedAt: '2026-09-22T00:00:00.000Z',
  sourceConfigured: true,
  categories: [
    { id: 'cat-Tacos', name: 'Tacos', sortOrder: 0, daypartId: null },
    { id: 'cat-Burritos', name: 'Burritos', sortOrder: 1, daypartId: null },
    { id: 'cat-Drinks', name: 'Drinks', sortOrder: 2, daypartId: null },
  ],
  items: [
    item('t1', '3 Birria Tacos w/ consome', 1450, 'Tacos', 'slow-braised beef'),
    item('t2', 'Fish Taco', 450, 'Tacos'),
    item('b1', 'Asada Super Burrito', 1750, 'Burritos', 'steak — rice — beans'),
    item('b1', 'Asada Super Burrito (dup)', 1750, 'Burritos'), // same POS id twice → first wins
    item(null, 'Hand-typed burrito', 900, 'Burritos'), // nothing to bind to
    item('d0', 'Open-priced agua', 0, 'Drinks'), // $0 = a modifier, not a row
    item('d1', 'Horchata', 325, 'Drinks'),
    item('x1', 'Chips & Salsa', 250, null),
  ],
};

const base = { menu: MENU, providerId: 'toast', providerName: 'Toast', connectionId: 'conn-1', rowLimit: 24 };

describe('posSectionsOf', () => {
  it('lists sections in POS order with bindable items only; uncategorized last', () => {
    expect(posSectionsOf(MENU).map((s) => [s.name, s.items.length])).toEqual([
      ['Tacos', 2],
      ['Burritos', 1],
      ['Drinks', 1],
      [UNCATEGORIZED_SECTION, 1],
    ]);
  });
});

describe('buildPosBindingPlan', () => {
  it('numbers the chosen sections\' items in section order, from the CATALOG', () => {
    const plan = buildPosBindingPlan({ ...base, sections: ['Drinks', 'tacos'] });
    expect(plan.items.map((i) => [i.n, i.externalId, i.name, i.priceText, i.section])).toEqual([
      [0, 't1', '3 Birria Tacos w/ consome', '$14.50', 'Tacos'],
      [1, 't2', 'Fish Taco', '$4.50', 'Tacos'],
      [2, 'd1', 'Horchata', '$3.25', 'Drinks'],
    ]);
    expect(plan.connectionId).toBe('conn-1');
  });

  it('refuses a selection with nothing to show', () => {
    expect(() => buildPosBindingPlan({ ...base, sections: ['Desserts'] })).toThrow(PosPlanError);
    try {
      buildPosBindingPlan({ ...base, sections: [] });
    } catch (e: any) {
      expect(e.code).toBe('POS_SELECTION_EMPTY');
    }
  });

  it('enforces the row limit server-side', () => {
    let err: any;
    try {
      buildPosBindingPlan({ ...base, sections: ['Tacos', 'Burritos', 'Drinks'], rowLimit: 3 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PosPlanError);
    expect(err.code).toBe('MENU_TOO_MANY_ITEMS');
    expect(err.message).toBe("4 items don't fit one screen — choose fewer sections (up to 3 items).");
    expect(err.details).toEqual({ count: 4, rowLimit: 3 });
  });
});

describe('formatPosPlanContent', () => {
  const plan = buildPosBindingPlan({ ...base, sections: ['Tacos', 'Burritos'] });
  const content = formatPosPlanContent(plan);

  it('writes the [item.N] Section — Name — $price — desc rows under section headers', () => {
    expect(content.split('\n')).toEqual([
      'LIVE POS MENU from Toast. 3 items in 2 sections, bound to the venue\'s POS.',
      POS_ROW_CONTRACT_LINE,
      'Tacos:',
      '[item.0] Tacos — 3 Birria Tacos w/ consome — $14.50 — slow-braised beef',
      '[item.1] Tacos — Fish Taco — $4.50',
      'Burritos:',
      // A " — " inside catalog text is flattened so it can never read as a delimiter.
      '[item.2] Burritos — Asada Super Burrito — $17.50 — steak - rice - beans',
    ]);
  });

  it('only the item lines count as menu rows (the header and contract line do not)', () => {
    expect(countMenuContentRows(content)).toBe(3);
  });
});

describe('conciergePosRowLimit', () => {
  it('is 24 at 1080p-class, a modest bump at 4K, fewer on small canvases', () => {
    expect(conciergePosRowLimit(1920, 1080)).toBe(24);
    expect(conciergePosRowLimit(1080, 1920)).toBe(24);
    expect(conciergePosRowLimit(3840, 2160)).toBe(28);
    expect(conciergePosRowLimit(960, 1080)).toBe(16);
    expect(conciergePosRowLimit()).toBe(24);
  });
});
