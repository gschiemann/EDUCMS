import { readFileSync } from 'fs';
import { join } from 'path';
import {
  EMPTY_ITEMS_HTML,
  collectGroundedFacts,
  enforceGroundedFactsInCopy,
  enforceGroundedFactsInHtml,
  findUngroundedClaims,
  hasUngroundedClaim,
  normalizeAmount,
  parseMenuRowFacts,
  stripUngroundedMoney,
} from './fact-guard';
import { DESIGNER_EXEMPLARS } from './designer-exemplars';

/**
 * THE NO-FABRICATED-FACT LAW (2026-08-25 operator incident).
 *
 * A QSR tenant's 7-turn concierge chat produced a board carrying invented
 * prices — Burger $2.99, Fries $3.00, Shake $5.00, "DEAL · 2 for $6 · All Day".
 * Nobody supplied a single number. These tests pin the rule that a currency
 * amount reaches a screen ONLY when the operator gave it to us.
 */

const NO_FACTS = collectGroundedFacts([]);

describe('normalizeAmount', () => {
  it('normalizes currency-shaped strings to a comparable key', () => {
    expect(normalizeAmount('$4.50')).toBe('4.5');
    expect(normalizeAmount('$6')).toBe('6');
    expect(normalizeAmount('1,299.00')).toBe('1299');
    expect(normalizeAmount('  £12.99 ')).toBe('12.99');
  });
  it('returns null when there is no number at all', () => {
    expect(normalizeAmount('free')).toBeNull();
    expect(normalizeAmount('')).toBeNull();
  });
});

describe('collectGroundedFacts', () => {
  it('harvests every number the operator supplied, however it was written', () => {
    const facts = collectGroundedFacts([
      'Happy hour: draft pours $5, wings 8.50',
      null,
      undefined,
      'two-for-6 combo',
    ]);
    expect(facts.amounts.has('5')).toBe(true);
    expect(facts.amounts.has('8.5')).toBe(true);
    expect(facts.amounts.has('6')).toBe(true);
    expect(facts.amounts.has('2.99')).toBe(false);
  });
});

describe('findUngroundedClaims', () => {
  it('flags a price nobody supplied', () => {
    expect(findUngroundedClaims('Burger $2.99', NO_FACTS)).toEqual(['$2.99']);
  });

  it('does NOT flag a price the operator supplied — in any notation', () => {
    const facts = collectGroundedFacts(['burgers are 2.99, fries 3']);
    expect(findUngroundedClaims('Burger $2.99', facts)).toEqual([]);
    expect(findUngroundedClaims('Fries $3.00', facts)).toEqual([]);
  });

  it('flags a discount claim ("30% off") but leaves innocent numerals alone', () => {
    expect(findUngroundedClaims('30% off everything', NO_FACTS)).toEqual(['30% off']);
    // times, counts, dates, street numbers: NOT money, never touched
    expect(findUngroundedClaims('Doors 6 PM · 12 spots left · 1100 Main St', NO_FACTS)).toEqual([]);
    expect(findUngroundedClaims('Open till 9 tonight', NO_FACTS)).toEqual([]);
  });

  it('flags currency words as well as symbols', () => {
    expect(findUngroundedClaims('Only 5 dollars', NO_FACTS)).toEqual(['5 dollars']);
  });

  it('catches the exact starburst from the incident', () => {
    expect(hasUngroundedClaim('DEAL · 2 for $6 · All Day', NO_FACTS)).toBe(true);
  });
});

describe('stripUngroundedMoney', () => {
  it('removes the invented amount and tidies the wreckage', () => {
    expect(stripUngroundedMoney('$5 Pours Till 7', NO_FACTS)).toBe('Pours Till 7');
    expect(stripUngroundedMoney('New Spicy Chicken — $4.99', NO_FACTS)).toBe('New Spicy Chicken');
  });
  it('leaves a grounded amount untouched', () => {
    const facts = collectGroundedFacts(['pours are $5']);
    expect(stripUngroundedMoney('$5 Pours Till 7', facts)).toBe('$5 Pours Till 7');
  });
  it('is a no-op on copy with no money in it', () => {
    expect(stripUngroundedMoney('Welcome to Riverside', NO_FACTS)).toBe('Welcome to Riverside');
  });
});

// ── ENGINE PATH (art-director copy → menu/grid rows) ────────────────────────
describe('enforceGroundedFactsInCopy', () => {
  it('a brief with NO menu data yields NO priced rows', () => {
    const { copy, dropped } = enforceGroundedFactsInCopy(
      {
        headline: 'Lunch, Handled',
        items: [
          { label: 'Burger', value: '$2.99', detail: 'Griddled, melty, craveable' },
          { label: 'Fries', value: '$3.00', detail: 'Golden · sea salt' },
          { label: 'Shake', value: '$5.00' },
        ],
      },
      NO_FACTS,
    );
    expect(copy.items).toEqual([]);
    expect(dropped.sort()).toEqual(['$2.99', '$3.00', '$5.00']);
  });

  it('keeps every row whose price the operator actually gave us', () => {
    const facts = collectGroundedFacts(['Burger 2.99, Fries 3.00, Shake 5']);
    const { copy, dropped } = enforceGroundedFactsInCopy(
      {
        headline: 'Lunch, Handled',
        items: [
          { label: 'Burger', value: '$2.99' },
          { label: 'Fries', value: '$3.00' },
          { label: 'Shake', value: '$5.00' },
        ],
      },
      facts,
    );
    expect(copy.items).toHaveLength(3);
    expect(dropped).toEqual([]);
  });

  it('drops only the rows it cannot vouch for', () => {
    const facts = collectGroundedFacts(['the cortado is $4.50']);
    const { copy } = enforceGroundedFactsInCopy(
      {
        headline: 'Coffee',
        items: [{ label: 'Cortado', value: '$4.50' }, { label: 'Pour Over', value: '$5.00' }],
      },
      facts,
    );
    expect(copy.items).toEqual([{ label: 'Cortado', value: '$4.50' }]);
  });

  it('drops an optional field carrying an invented offer, keeps unpriced copy', () => {
    const { copy, dropped } = enforceGroundedFactsInCopy(
      { kicker: 'DEAL', headline: 'Lunch Rush', body: '2 for $6 all day', cta: 'Order at the counter' },
      NO_FACTS,
    );
    expect(copy.body).toBeUndefined();
    expect(copy.kicker).toBe('DEAL');
    expect(copy.cta).toBe('Order at the counter');
    expect(copy.headline).toBe('Lunch Rush');
    expect(dropped).toEqual(['$6']);
  });

  it('strips an invented price out of the REQUIRED headline rather than shipping it', () => {
    const { copy } = enforceGroundedFactsInCopy({ headline: '$5 Pours Till 7' }, NO_FACTS);
    expect(copy.headline).toBe('Pours Till 7');
  });

  it('empties a headline that was nothing BUT an invented price', () => {
    const { copy } = enforceGroundedFactsInCopy({ headline: '$4.99' }, NO_FACTS);
    expect(copy.headline).toBe('');
  });

  it('is a pure no-op when nothing is ungrounded (zero risk to good boards)', () => {
    const input = { headline: 'Welcome', items: [{ label: 'Yoga', detail: '6 PM' }] };
    const { copy, dropped } = enforceGroundedFactsInCopy(input, NO_FACTS);
    expect(dropped).toEqual([]);
    expect(copy.headline).toBe('Welcome');
    expect(copy.items).toEqual(input.items);
  });
});

// ── DESIGNER PATH (raw model-authored HTML) ─────────────────────────────────
describe('enforceGroundedFactsInHtml', () => {
  const row = (name: string, price: string) =>
    `<div class="row"><div class="nm" data-field="item.0.name">${name}<span class="sub">tasty</span></div><div class="dots"></div><div class="pr" data-field="item.0.price">${price}</div></div>`;

  const board = (rows: string) =>
    `<!doctype html><html><head><style>.pr{color:#f00}</style></head><body><div class="stage">` +
    `<h1 data-field="headline">Lunch, Handled</h1><div class="fit" data-fit-col>${rows}</div>` +
    `<div class="foot">Open 11a-9p</div></div></body></html>`;

  it('a brief with no menu data produces a board with NO priced rows', () => {
    const html = board(row('Burger', '$2.99') + row('Fries', '$3.00') + row('Shake', '$5.00'));
    const res = enforceGroundedFactsInHtml(html, NO_FACTS);
    expect(res.html).not.toContain('$2.99');
    expect(res.html).not.toContain('$3.00');
    expect(res.html).not.toContain('$5.00');
    expect(res.html).not.toContain('Burger');
    expect(res.html).not.toContain('Fries');
    expect(res.removedNodes).toBe(3);
    expect(res.dropped.sort()).toEqual(['$2.99', '$3.00', '$5.00']);
  });

  it('leaves the rest of the board intact and structurally whole', () => {
    const html = board(row('Burger', '$2.99'));
    const res = enforceGroundedFactsInHtml(html, NO_FACTS);
    expect(res.html).toContain('Lunch, Handled');
    expect(res.html).toContain('Open 11a-9p');
    expect(res.html).toContain('<div class="stage">');
    expect(res.html).toContain('</body></html>');
    expect(res.html).toContain('<style>.pr{color:#f00}</style>');
  });

  it('leaves an explicit empty state when the list is emptied', () => {
    const html = board(row('Burger', '$2.99') + row('Fries', '$3.00'));
    const res = enforceGroundedFactsInHtml(html, NO_FACTS);
    expect(res.html).toContain(EMPTY_ITEMS_HTML);
    expect(res.html).toContain('Add your items and prices');
  });

  it('does NOT leave an empty state when real rows survive', () => {
    const facts = collectGroundedFacts(['burger 2.99']);
    const html = board(row('Burger', '$2.99') + row('Fries', '$3.00'));
    const res = enforceGroundedFactsInHtml(html, facts);
    expect(res.html).toContain('$2.99');
    expect(res.html).not.toContain('$3.00');
    expect(res.html).not.toContain('Add your items and prices');
  });

  it('removes the whole fabricated DEAL starburst, not just its number', () => {
    const html =
      '<!doctype html><html><body><div class="stage"><h1>Lunch</h1>' +
      '<div class="badge"><div class="lbl">DEAL</div><div class="num">2 for $6</div><div class="unit">All Day</div></div>' +
      '</div></body></html>';
    const res = enforceGroundedFactsInHtml(html, NO_FACTS);
    expect(res.html).not.toContain('$6');
    expect(res.html).not.toContain('DEAL');
    expect(res.html).not.toContain('All Day');
    expect(res.html).toContain('<h1>Lunch</h1>');
  });

  it('NEVER removes the stage, body, or html even if a price sits directly on them', () => {
    const html = '<!doctype html><html><body><div class="stage">$2.99</div></body></html>';
    const res = enforceGroundedFactsInHtml(html, NO_FACTS);
    expect(res.html).toContain('<body>');
    expect(res.html).toContain('class="stage"');
  });

  it('is a byte-for-byte no-op when every number is grounded', () => {
    const facts = collectGroundedFacts(['burger 2.99 fries 3.00']);
    const html = board(row('Burger', '$2.99') + row('Fries', '$3.00'));
    expect(enforceGroundedFactsInHtml(html, facts).html).toBe(html);
  });

  it('is a byte-for-byte no-op on a board with no money on it at all', () => {
    const html = board('<div class="row"><div class="nm">Yoga</div><div class="pr">6 PM</div></div>');
    expect(enforceGroundedFactsInHtml(html, NO_FACTS).html).toBe(html);
  });

  it.each(DESIGNER_EXEMPLARS.map((e) => [e.id, e.html] as const))(
    'strips every price out of the reference board %s when nothing is grounded',
    (_id, html) => {
      // The Designer shows the model priced boards — placeholder prices
      // ($0.00), but prices on a menu all the same. If the model copied one,
      // with no grounded facts not one of its prices may survive.
      expect(html).toMatch(/\$\d/); // the reference really is priced
      const res = enforceGroundedFactsInHtml(html, NO_FACTS);
      expect(res.html).not.toMatch(/\$\d/);
      expect(res.html).toContain('VENUE NAME'); // the wordmark survives
      expect(res.removedNodes).toBeGreaterThan(0);
    },
  );

  it('survives malformed markup without corrupting the document', () => {
    const html = '<div class="stage"><div class="row"><span>Burger</span><span>$2.99</span></div>';
    const res = enforceGroundedFactsInHtml(html, NO_FACTS);
    expect(res.html).not.toContain('$2.99');
    expect(res.html).toContain('class="stage"');
  });
});

// ── 2026-09-22: card layouts, sample menus, the $3.00 coincidence ─────────
//
// Reproduced by running the real guard on a real card board (research report
// docs/research/2026-09-22-ai-designer-rework/02, section 4): an invented price
// took only the card's price STRIP, leaving "Carne Asada Burrito" standing with
// no price and no empty state; and "Street Tacos $3.00" survived because a price
// book row said "fries — $3.00".
//
// FIXTURE PROVENANCE: super-taco-burritos.board.html is the Super Taco
// "Burritos & More" wall exactly as GPT-6 Sol (via Codex) authored it, scripts
// stripped the way sanitizeDesignerHtml strips them — the card layout AI boards
// are now asked to match.
describe('enforceGroundedFactsInHtml — whole items, sample slots, row prices (2026-09-22)', () => {
  const CARDS = readFileSync(join(__dirname, '__fixtures__', 'super-taco-burritos.board.html'), 'utf8');
  const CARD_PRICES = ['$17.50', '$15.50', '$18.00', '$19.00', '$7.75', '$5.35'];
  const CARD_NAMES = ['Asada Super Burrito', 'Grilled Chicken Super Burrito', 'Steak California Burrito', 'Shredded Chicken Super Nachos', 'Steak Quesadilla', 'Large Agua Fresca'];

  it('an invented price on a CARD takes the whole card — never a price-less orphan', () => {
    const res = enforceGroundedFactsInHtml(CARDS, NO_FACTS);
    for (const p of CARD_PRICES) expect(res.html).not.toContain(p);
    // The whole item goes: its name, description and category with it.
    for (const n of CARD_NAMES) expect(res.html).not.toContain(`>${n}<`);
    expect(res.html).not.toContain('Steak, rice, beans and all the fixings.');
    expect(res.html).not.toContain('data-field="item.0.category"');
    expect(res.removedNodes).toBe(6);
    // …and the emptied grid says so instead of becoming a dead panel.
    expect(res.html).toContain(EMPTY_ITEMS_HTML);
    // Nothing outside the cards is touched.
    expect(res.html).toContain('data-field="menu.title"');
    expect(res.html).toContain('Big flavor for every appetite.');
    expect(res.html).toContain('data-field="footer.right"');
  });

  it('keeps every card whose price was supplied, drops only the others (no empty state)', () => {
    const facts = collectGroundedFacts(['17.50 15.50 18.00 19.00']);
    const res = enforceGroundedFactsInHtml(CARDS, facts);
    expect(res.removedNodes).toBe(2);
    for (const p of CARD_PRICES.slice(0, 4)) expect(res.html).toContain(p);
    expect(res.html).not.toContain('Steak Quesadilla');
    expect(res.html).not.toContain('Large Agua Fresca');
    expect(res.html).toContain('Asada Super Burrito');
    expect(res.html).not.toContain('Add your items and prices');
  });

  it('NEGATIVE CONTROL: the old row walk stops at the price strip on this very board', () => {
    // What the guard did before: climb to the first ancestor with ≥2 children.
    // On a card that is `.dish-bottom` (price + number), so the name survived.
    const priceAt = CARDS.indexOf('data-field="item.0.price"');
    const strip = CARDS.lastIndexOf('<div class="dish-bottom">', priceAt);
    const article = CARDS.lastIndexOf('<article', priceAt);
    expect(strip).toBeGreaterThan(article); // the strip is INSIDE the card, not the card
    const res = enforceGroundedFactsInHtml(CARDS, NO_FACTS);
    expect(res.html).not.toContain('<div class="dish-bottom">');
    expect(res.html).not.toContain('Asada Super Burrito'); // would survive under the old walk
  });

  describe('sample-menu mode', () => {
    const slotBoard = (prices: string[]) =>
      '<!doctype html><html><body><div class="stage"><h1 data-field="headline">Mexican Favorites</h1><div class="grid">' +
      prices
        .map(
          (p, i) =>
            `<div class="card"><h3 data-field="item.${i}.name">Dish ${i}</h3><p data-field="item.${i}.desc">Classic.</p>` +
            `<span class="price" data-field="item.${i}.price"${p === '$ —' ? ' data-vos-sample-price="1"' : ''}>${p}</span></div>`,
        )
        .join('') +
      '</div><div class="badge"><b>DEAL</b><i>2 for $6</i></div></div></body></html>';

    it('an invented price inside a price SLOT becomes the empty slot — the name stays', () => {
      const html = slotBoard(['$ —', '$11.99', '$ —', '$8.49']);
      const res = enforceGroundedFactsInHtml(html, NO_FACTS);
      expect(res.html).not.toContain('$11.99');
      expect(res.html).not.toContain('$8.49');
      for (let i = 0; i < 4; i++) expect(res.html).toContain(`Dish ${i}`);
      expect(res.slottedPrices).toBe(2);
      // Every price field is now a designed empty slot, marked as one.
      expect(res.html.match(/data-vos-sample-price="1"/g)?.length).toBe(4);
      expect(res.html.match(/>\$ —</g)?.length).toBe(4);
    });

    it('a made-up DEAL outside a price field is still removed outright', () => {
      const res = enforceGroundedFactsInHtml(slotBoard(['$ —', '$ —']), NO_FACTS);
      expect(res.html).not.toContain('2 for $6');
      expect(res.html).not.toContain('DEAL');
      expect(res.html).toContain('Dish 1');
    });

    it('opts.sampleSlots turns an invented price into a slot even before the board declares one', () => {
      const html = slotBoard(['$9.99']);
      const res = enforceGroundedFactsInHtml(html, NO_FACTS, { sampleSlots: true });
      expect(res.html).toContain('data-field="item.0.price" data-vos-sample-price="1">$ —</span>');
      expect(res.html).toContain('Dish 0');
      expect(res.removedNodes).toBe(1); // the made-up DEAL badge — never the card
    });

    it('NEGATIVE CONTROL: without sample mode the same invented price takes the whole card', () => {
      const res = enforceGroundedFactsInHtml(slotBoard(['$9.99']), NO_FACTS);
      expect(res.html).not.toContain('Dish 0');
      expect(res.html).not.toContain('$ —');
    });
  });

  describe('a price is checked against ITS OWN row', () => {
    const rowBoard = (rows: Array<[string, string]>) =>
      '<!doctype html><html><body><div class="stage"><div class="col">' +
      rows
        .map(([name, price], i) => `<div class="row"><span data-field="item.${i}.name">${name}</span><span data-field="item.${i}.price">${price}</span></div>`)
        .join('') +
      '</div></div></body></html>';

    it('the $3.00 coincidence: an invented "Street Tacos $3.00" beside a price book "fries — $3.00" is caught', () => {
      const content = 'burger — $2.99\nfries — $3.00\nshake — $5.00';
      const facts = collectGroundedFacts(['create a menu board using standard Mexican food items'], { menuContent: content });
      const res = enforceGroundedFactsInHtml(rowBoard([['Street Tacos', '$3.00'], ['Fries', '$3.00']]), facts);
      expect(res.html).not.toContain('Street Tacos');
      expect(res.html).toContain('Fries');
      expect(res.html).toContain('$3.00'); // fries keeps its real price
    });

    it('NEGATIVE CONTROL: with only the global number set, the coincidence survives', () => {
      const facts = collectGroundedFacts(['burger — $2.99\nfries — $3.00\nshake — $5.00']);
      const res = enforceGroundedFactsInHtml(rowBoard([['Street Tacos', '$3.00']]), facts);
      expect(res.html).toContain('Street Tacos');
    });

    it('a real item wearing ANOTHER item\'s price is caught ("Fries $5.00" when fries are $3.00)', () => {
      const facts = collectGroundedFacts([], { menuContent: 'Sides — Fries — $3.00\nShakes — Shake — $5.00\nMains — Burger — $2.99' });
      const res = enforceGroundedFactsInHtml(rowBoard([['Fries', '$5.00'], ['Shake', '$5.00']]), facts);
      expect(res.html).not.toContain('Fries');
      expect(res.html).toContain('Shake');
    });

    it('a shortened or reworded name still grounds its own price (never drops a real price)', () => {
      const facts = collectGroundedFacts([], {
        menuContent: 'Tacos — 3 Birria Tacos w/ consome — $14.50 — slow-braised beef\nSides — Crispy Fries — $3.00\nDrinks — Horchata — $3.25',
      });
      const html = rowBoard([['Birria Tacos', '$14.50'], ['French Fries', '$3.00'], ['Horchata', '$3.25']]);
      expect(enforceGroundedFactsInHtml(html, facts).html).toBe(html);
    });

    it('numbered rows ([item.N], a POS plan): the number decides — a price moved between rows is dropped', () => {
      const content = [
        'LIVE POS MENU from Toast. 2 items in 1 section, bound to the venue\'s POS.',
        'Tacos:',
        '[item.0] Tacos — Street Taco — $3.50',
        '[item.1] Tacos — Fish Taco — $3.00',
      ].join('\n');
      const facts = collectGroundedFacts([content], { menuContent: content });
      const swapped = rowBoard([['Street Taco', '$3.00'], ['Fish Taco', '$3.00']]);
      const res = enforceGroundedFactsInHtml(swapped, facts);
      expect(res.html).not.toContain('Street Taco');
      expect(res.html).toContain('Fish Taco');
      // …a row number the plan never had is an invented row, whatever its price.
      const invented = rowBoard([['Street Taco', '$3.50'], ['Fish Taco', '$3.00'], ['Churros', '$3.50']]);
      const res2 = enforceGroundedFactsInHtml(invented, facts);
      expect(res2.html).toContain('Street Taco');
      expect(res2.html).not.toContain('Churros');
    });

    it('a misnumbered but TRUE row survives (the name names a planned row with that price)', () => {
      const content = '[item.0] Tacos — Street Taco — $3.50\n[item.1] Tacos — Fish Taco — $3.00';
      const facts = collectGroundedFacts([content], { menuContent: content });
      const html = rowBoard([['Fish Taco', '$3.00'], ['Street Taco', '$3.50']]);
      expect(enforceGroundedFactsInHtml(html, facts).html).toBe(html);
    });

    it('parses every producer\'s row shape and never mistakes a number in a name for its price', () => {
      const rows = parseMenuRowFacts([
        'REAL MENU from the venue\'s own website (x.com). 4 items across 2 sections.',
        '[item.3] Tacos — 3 Birria Tacos w/ consome — $14.50 — slow-braised beef',
        'Tacos — Al Pastor — $4.25 — marinated pork',
        'Burrito — $9.00',
        'Asada Burrito 12.99',
        'Drinks:',
      ].join('\n'));
      expect(rows).toHaveLength(4);
      expect(rows[0]).toEqual({ n: 3, nameKey: '3 birria tacos w consome', amounts: new Set(['14.5']) });
      expect(rows[1].nameKey).toBe('al pastor');
      expect(rows[2]).toEqual({ n: null, nameKey: 'burrito', amounts: new Set(['9']) });
      expect(rows[3]).toEqual({ n: null, nameKey: 'asada burrito', amounts: new Set(['12.99']) });
    });

    it('is still a byte-for-byte no-op on a grounded board', () => {
      const content = '[item.0] Tacos — Street Taco — $3.50\n[item.1] Tacos — Fish Taco — $3.00';
      const facts = collectGroundedFacts([content], { menuContent: content });
      const html = rowBoard([['Street Taco', '$3.50'], ['Fish Taco', '$3.00']]);
      expect(enforceGroundedFactsInHtml(html, facts).html).toBe(html);
    });
  });
});
