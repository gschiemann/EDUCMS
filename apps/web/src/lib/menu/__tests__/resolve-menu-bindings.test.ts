/**
 * resolve-menu-bindings — the one place a POS binding turns into words on a board.
 *
 * Every rule here is something a screen does in public: a price that is wrong,
 * a "Sold out" the POS never said, or a literal `{{pos.item:…}}` on the glass.
 * The rules are stated in the module header; each block below pins one.
 */
import {
  BINDING_TOKEN_MARK,
  boardLangOf,
  boundText,
  countMenuBindings,
  designerPosPayload,
  GLASS_LABELS,
  glassLabelsFor,
  isBindingToken,
  parseBindingToken,
  parseMenuBindings,
  resolvedBindingText,
  resolveMenuBindings,
  rowNumberOfSlot,
  slotOfField,
  stripBindingTokens,
  type LiveMenuItem,
} from '../resolve-menu-bindings';

const MENU: LiveMenuItem[] = [
  { externalId: 'birria', name: '3 Birria Tacos', price: '$15.25', desc: 'Slow-braised beef, consomé', available: true },
  { externalId: 'asada', name: 'Asada Super Burrito', price: '$17.50', desc: '', available: true },
  { externalId: 'horchata', name: 'Horchata', price: '$3.25', available: false },
];

describe('tokens — read forever, written never, sent never', () => {
  it.each([
    ['{{pos.item:birria.price}}', { externalId: 'birria', field: 'price' }],
    ['{{pos.item:birria.name}}', { externalId: 'birria', field: 'name' }],
    ['{{pos.item:birria.available}}', { externalId: 'birria', field: 'available' }],
    ['{{pos.item:birria.description}}', { externalId: 'birria', field: 'desc' }],
    ['  {{ pos.item:birria.desc }}  ', { externalId: 'birria', field: 'desc' }],
    // A POS id may itself contain dots — the field is after the LAST one.
    ['{{pos.item:loc.42.item.7.price}}', { externalId: 'loc.42.item.7', field: 'price' }],
  ])('%s parses', (token, want) => {
    expect(parseBindingToken(token)).toEqual(want);
  });

  it.each([
    'Birria $15.25',
    '{{pos.item:birria}}',
    '{{pos.item:birria.photo}}',
    '{{pos.item:.price}}',
    `{{pos.item:${'x'.repeat(201)}.price}}`,
    '',
  ])('%p is not a binding', (v) => {
    expect(parseBindingToken(v)).toBeNull();
  });

  it('strips every token value — even a malformed one — and nothing else', () => {
    const overrides = {
      'hero.title': 'Taco Tuesday',
      'hero.price': '{{pos.item:birria.price}}',
      'promo.note': 'broken {{pos.item:oops',
      'footer.text': '',
    };
    const out = stripBindingTokens(overrides);
    expect(out).toEqual({ 'hero.title': 'Taco Tuesday', 'footer.text': '' });
    expect(JSON.stringify(out)).not.toContain(BINDING_TOKEN_MARK);
    expect(overrides['hero.price']).toBe('{{pos.item:birria.price}}'); // input untouched
  });

  it('returns the SAME object when there is nothing to strip (memo-stable)', () => {
    const overrides = { 'hero.title': 'Hi' };
    expect(stripBindingTokens(overrides)).toBe(overrides);
    expect(stripBindingTokens(undefined)).toBeUndefined();
    expect(isBindingToken(42)).toBe(false);
  });
});

describe('parseMenuBindings — both shapes, plus legacy tokens', () => {
  it('reads row slots (the AI board / Super Taco convention)', () => {
    const b = parseMenuBindings({ 'item.0': 'birria', 'combo.2': ' asada ' });
    expect(b.slots).toEqual({ 'item.0': 'birria', 'combo.2': 'asada' });
    expect(b.fields).toEqual({});
  });

  it('reads single-field bindings (the builder control)', () => {
    const b = parseMenuBindings({ 'hero.price': { externalId: 'birria', field: 'price' } });
    expect(b.fields).toEqual({ 'hero.price': { externalId: 'birria', field: 'price' } });
  });

  it('reads a token with no binding entry — a board saved by an older builder', () => {
    const b = parseMenuBindings(undefined, { 'hero.price': '{{pos.item:birria.price}}', 'hero.title': 'Hi' });
    expect(b.fields).toEqual({ 'hero.price': { externalId: 'birria', field: 'price' } });
  });

  it('an explicit entry wins over a stale token for the same field', () => {
    const b = parseMenuBindings(
      { 'hero.price': { externalId: 'asada', field: 'price' } },
      { 'hero.price': '{{pos.item:birria.price}}' },
    );
    expect(b.fields['hero.price'].externalId).toBe('asada');
  });

  it('ignores junk rather than guessing', () => {
    const b = parseMenuBindings({
      '': 'birria',
      'item.1': '',
      'item.2': 42,
      'item.3': { externalId: 'x', field: 'photo' },
      'item.4': { field: 'price' },
      'item.5': null,
    });
    expect(countMenuBindings(b)).toBe(0);
  });
});

describe('no menu → nothing changes (the board keeps its own words)', () => {
  const bindings = parseMenuBindings({ 'item.0': 'birria' }, { 'hero.price': '{{pos.item:asada.price}}' });

  it('a menu that has not loaded (or whose first fetch failed) resolves nothing', () => {
    const r = resolveMenuBindings({ bindings, items: null });
    expect(r).toEqual({ hasMenu: false, rows: [], fields: [] });
    expect(resolvedBindingText(r)).toEqual({});
    expect(designerPosPayload(r)).toEqual({ v: 1, rows: [], fields: [] });
  });

  it('an answer with no POS source behind it resolves nothing either', () => {
    expect(resolveMenuBindings({ bindings, items: [], configured: false }).hasMenu).toBe(false);
  });

  it('but an EMPTY menu from a configured POS is data: every bound row is not available', () => {
    const r = resolveMenuBindings({ bindings, items: [], configured: true });
    expect(r.hasMenu).toBe(true);
    expect(r.rows[0]).toMatchObject({ slot: 'item.0', state: 'missing', text: { price: 'Not available' } });
    expect(r.fields[0]).toMatchObject({ key: 'hero.price', state: 'missing', text: 'Not available' });
  });
});

describe('a bound row follows its item', () => {
  const bindings = parseMenuBindings({ 'item.0': 'birria', 'item.1': 'asada', 'item.2': 'horchata', 'item.3': 'gone' });
  const r = resolveMenuBindings({ bindings, items: MENU, configured: true });
  const row = (slot: string) => r.rows.find((x) => x.slot === slot)!;

  it('available → the live name, price and description', () => {
    expect(row('item.0')).toEqual({
      slot: 'item.0', externalId: 'birria', state: 'live',
      text: { name: '3 Birria Tacos', price: '$15.25', desc: 'Slow-braised beef, consomé' },
    });
  });

  it('an item with no description leaves the row’s own description alone', () => {
    expect(row('item.1').text).toEqual({ name: 'Asada Super Burrito', price: '$17.50' });
  });

  it('sold out ONLY because the menu says available:false — and the price says so', () => {
    expect(row('item.2')).toMatchObject({ state: 'soldout', text: { name: 'Horchata', price: 'Sold out' } });
  });

  it('missing from a menu we did get → not available, the name stays as the board had it', () => {
    expect(row('item.3')).toEqual({ slot: 'item.3', externalId: 'gone', state: 'missing', text: { price: 'Not available' } });
  });

  it('rows come out in natural order (item.10 after item.9)', () => {
    const many = parseMenuBindings({ 'item.10': 'birria', 'item.9': 'birria', 'item.2': 'birria' });
    expect(resolveMenuBindings({ bindings: many, items: MENU }).rows.map((x) => x.slot)).toEqual(['item.2', 'item.9', 'item.10']);
  });

  it('a duplicate id prefers the copy that is available — in either order', () => {
    // An item listed in two menu groups arrives twice under one POS id. Both
    // orders are pinned: "first copy wins" and "last copy wins" each pass one.
    const soldOutCopy = { externalId: 'birria', name: 'Old', price: '$1.00', available: false };
    const bindings = parseMenuBindings({ 'item.0': 'birria' });
    const soldOutFirst = resolveMenuBindings({ bindings, items: [soldOutCopy, ...MENU] });
    expect(soldOutFirst.rows[0]).toMatchObject({ state: 'live', text: { name: '3 Birria Tacos' } });
    const soldOutLast = resolveMenuBindings({ bindings, items: [...MENU, soldOutCopy] });
    expect(soldOutLast.rows[0]).toMatchObject({ state: 'live', text: { name: '3 Birria Tacos' } });
  });
});

describe('a single bound field', () => {
  const labels = GLASS_LABELS.en;
  it.each([
    ['name', 'live', '3 Birria Tacos'],
    ['price', 'live', '$15.25'],
    ['desc', 'live', 'Slow-braised beef, consomé'],
    ['available', 'live', ''],
    ['name', 'soldout', '3 Birria Tacos'],
    ['price', 'soldout', 'Sold out'],
    ['available', 'soldout', 'Sold out'],
    ['name', 'missing', null],
    ['desc', 'missing', null],
    ['price', 'missing', 'Not available'],
    ['available', 'missing', 'Not available'],
  ] as const)('%s while %s → %p', (field, state, want) => {
    const item = state === 'missing' ? undefined : MENU[0];
    expect(boundText(field, state, item, labels)).toBe(want);
  });
});

describe('what each kind of board is sent', () => {
  it('a board with its own shim gets flat field text; a field binding beats its row', () => {
    const bindings = parseMenuBindings(
      { 'item.0': 'birria', 'item.0.price': { externalId: 'horchata', field: 'price' } },
    );
    const text = resolvedBindingText(resolveMenuBindings({ bindings, items: MENU }));
    expect(text).toEqual({
      'item.0.name': '3 Birria Tacos',
      'item.0.price': 'Sold out',
      'item.0.desc': 'Slow-braised beef, consomé',
    });
  });

  it('a field whose value is "keep the board’s words" removes the row’s value for it', () => {
    const bindings = parseMenuBindings({ 'item.0': 'birria', 'item.0.name': { externalId: 'gone', field: 'name' } });
    expect(resolvedBindingText(resolveMenuBindings({ bindings, items: MENU }))).not.toHaveProperty('item.0.name');
  });

  it('an AI board gets rows keyed to the data-menu-row the server stamped', () => {
    const bindings = parseMenuBindings(
      { 'item.0': 'birria', 'item.1': 'horchata', 'hero.price': { externalId: 'asada', field: 'price' } },
    );
    expect(designerPosPayload(resolveMenuBindings({ bindings, items: MENU }))).toEqual({
      v: 1,
      rows: [
        { slot: 'item.0', row: '0', s: 'live', t: { name: '3 Birria Tacos', price: '$15.25', desc: 'Slow-braised beef, consomé' } },
        { slot: 'item.1', row: '1', s: 'soldout', t: { name: 'Horchata', price: 'Sold out' } },
      ],
      fields: [{ key: 'hero.price', t: '$17.50' }],
    });
  });

  it('nothing a board is sent ever carries a token', () => {
    const bindings = parseMenuBindings({ 'item.0': 'birria' }, { 'hero.price': '{{pos.item:asada.price}}' });
    for (const items of [null, [], MENU]) {
      const r = resolveMenuBindings({ bindings, items });
      expect(JSON.stringify(resolvedBindingText(r))).not.toContain(BINDING_TOKEN_MARK);
      expect(JSON.stringify(designerPosPayload(r))).not.toContain(BINDING_TOKEN_MARK);
    }
  });
});

describe('on-glass words follow the board’s language', () => {
  it.each([
    ['es-MX', 'Agotado'],
    ['es', 'Agotado'],
    ['zh-CN', '已售罄'],
    ['en-US', 'Sold out'],
    [null, 'Sold out'],
    ['fr', 'Sold out'],
  ])('%p → %p', (lang, soldOut) => {
    expect(glassLabelsFor(lang).soldOut).toBe(soldOut);
  });

  it('reads the board’s own <html lang>', () => {
    expect(boardLangOf('<!doctype html><html lang="es-MX"><head>')).toBe('es-MX');
    expect(boardLangOf("<html class='x' lang='zh'>")).toBe('zh');
    expect(boardLangOf('<html><head>')).toBeNull();
  });

  it('a Spanish board’s sold-out price says Agotado', () => {
    const r = resolveMenuBindings({ bindings: parseMenuBindings({ 'item.0': 'horchata' }), items: MENU, labels: glassLabelsFor('es') });
    expect(r.rows[0].text.price).toBe('Agotado');
  });
});

describe('slot helpers', () => {
  it('knows which row a field belongs to', () => {
    expect(slotOfField('item.3.price')).toEqual({ slot: 'item.3', leaf: 'price' });
    expect(slotOfField('item.3.category')).toBeNull();
    expect(slotOfField('price')).toBeNull();
    expect(rowNumberOfSlot('item.12')).toBe('12');
    expect(rowNumberOfSlot('combo.1')).toBeNull();
  });
});
