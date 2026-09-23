import {
  EMPTY_ITEMS_HTML,
  collectGroundedFacts,
  enforceGroundedFactsInCopy,
  enforceGroundedFactsInHtml,
  findUngroundedClaims,
  hasUngroundedClaim,
  normalizeAmount,
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
