/**
 * The venue's REAL menu, formatted as the designer's REAL CONTENT block.
 *
 * Greg pasted his restaurant's website into the AI template dialog and asked
 * for a menu board. The boards came back carrying his tenant's TEST price book
 * on a near-empty layout. The API now reads the real menu off that site; this
 * module is the last hop — turning it into the ONE request field that stops
 * auto-grounding, grounds every price against the fact guard, and past 8 rows
 * switches the designer into full-board menu layout.
 *
 * The fixture is producer-cut — see concierge-menu-reference.fixture.ts.
 */
import type { ConciergeReference } from '@cms/api-types';
import { buildMenuContentFromReferences, referenceMenuItemCount, buildMenuContentFromChat } from '../conciergeMenuContent';
import { MENU_REFERENCE, MENU_ROWS } from './concierge-menu-reference.fixture';

describe('buildMenuContentFromReferences', () => {
  it('carries EVERY item and EVERY price — the whole point', () => {
    const content = buildMenuContentFromReferences([MENU_REFERENCE])!;
    expect(content).toBeTruthy();
    for (const [name, price] of MENU_ROWS) {
      expect(content).toContain(name);
      expect(content).toContain(price);
    }
    // One line per row, plus one header line. Nothing sampled, nothing dropped.
    const lines = content.split('\n').filter(Boolean);
    expect(lines).toHaveLength(MENU_ROWS.length + 1);
  });

  it('emits `Section — Item — $price — description` rows the API counts as menu rows', () => {
    const content = buildMenuContentFromReferences([MENU_REFERENCE])!;
    expect(content).toContain('Tacos — Al Pastor — $4.25 — marinated pork, pineapple, cilantro');
    expect(content).toContain('Tacos — Carne Asada — $4.75');          // no description
    expect(content).toContain('Burritos — Super Carnitas — $12.75');
    expect(content).toContain('Drinks — Jamaica — $3');
  });

  it('heads the block with what it is — and that header is NOT itself a row', () => {
    const content = buildMenuContentFromReferences([MENU_REFERENCE])!;
    const header = content.split('\n')[0];
    expect(header).toContain("REAL MENU from the venue's own website (supertaco.example)");
    expect(header).toContain('9 items across 3 sections');
    expect(header).toMatch(/put ALL of them on the board/);
    // The API counts a menu ROW by a currency amount or a " — " split. A header
    // carrying either would inflate the count that decides the layout.
    expect(header).not.toMatch(/[$€£¥₹]\s?\d/);
    expect(header).not.toContain(' — ');
  });

  it('clears the row threshold that switches the designer into menu layout', () => {
    // Mirrors DESIGNER_MENU_LAYOUT_MIN_ROWS (8) in apps/api/src/ai/designer-prompt.ts.
    const content = buildMenuContentFromReferences([MENU_REFERENCE])!;
    const rows = content.split('\n').filter((l) => /[$€£¥₹]\s?\d/.test(l) || l.split(' — ').filter((p) => p.trim()).length >= 2);
    expect(rows.length).toBeGreaterThanOrEqual(8);
  });

  it('returns undefined when no reference carries a menu (so `content` is omitted)', () => {
    const plain = { kind: 'url', label: 'joecoffee.com', summary: 'Brand: Joe Coffee.' } as ConciergeReference;
    expect(buildMenuContentFromReferences([plain])).toBeUndefined();
    expect(buildMenuContentFromReferences([])).toBeUndefined();
    expect(buildMenuContentFromReferences(undefined)).toBeUndefined();
    expect(buildMenuContentFromReferences(null)).toBeUndefined();
  });

  it('merges menus from several references', () => {
    const second = {
      kind: 'url',
      label: 'supertaco-catering.example',
      summary: 'Catering',
      menu: { sections: [{ name: 'Trays', items: [{ name: 'Taco Bar (20)', price: '$180' }] }], itemCount: 1 },
    } as unknown as ConciergeReference;
    const content = buildMenuContentFromReferences([MENU_REFERENCE, second])!;
    expect(content).toContain('Tacos — Al Pastor — $4.25 — marinated pork, pineapple, cilantro');
    expect(content).toContain('Trays — Taco Bar (20) — $180');
    expect(content).toContain('supertaco-catering.example');
  });

  it('stays inside the designer request\'s 8000-char content cap, cutting on a line boundary', () => {
    const huge = {
      kind: 'url',
      label: 'huge.example',
      summary: 's',
      menu: {
        sections: [{
          name: 'Everything',
          items: Array.from({ length: 60 }, (_v, i) => ({
            name: `Item Number ${i} With A Fairly Long Descriptive Name`,
            price: `$${(i + 1) * 3}.50`,
            description: 'a long supporting description that eats characters quickly, on purpose',
          })),
        }],
        itemCount: 60,
      },
    } as unknown as ConciergeReference;
    const content = buildMenuContentFromReferences([huge])!;
    expect(content.length).toBeLessThanOrEqual(8000);
    // A truncated line would leave half a price on the board — the one thing
    // worse than a missing row.
    for (const line of content.split('\n').slice(1)) {
      expect(line).toMatch(/^Everything — Item Number \d+ With A Fairly Long Descriptive Name — \$\d+\.50 — a long supporting description that eats characters quickly, on purpose$/);
    }
  });

  it('skips junk items without producing a half-formed row', () => {
    const junk = {
      kind: 'url', label: 'x', summary: 's',
      menu: { sections: [{ name: 'X', items: [{}, { name: '   ' }, { name: 'Real', price: '$5' }] }], itemCount: 1 },
    } as unknown as ConciergeReference;
    const content = buildMenuContentFromReferences([junk])!;
    expect(content.split('\n').filter(Boolean)).toHaveLength(2); // header + 1 row
    expect(content).toContain('X — Real — $5');
  });

  it('returns undefined for a menu whose sections are all empty or malformed', () => {
    const shapes: unknown[] = [
      { sections: [] },
      { sections: [{ name: 'X', items: [] }] },
      { sections: [{ name: 'X', items: [{}] }] },
      { sections: 'nope' },
      {},
    ];
    for (const menu of shapes) {
      expect(buildMenuContentFromReferences([{ kind: 'url', summary: 's', menu } as unknown as ConciergeReference])).toBeUndefined();
    }
  });
});

describe('referenceMenuItemCount', () => {
  it('reports the tally the extractor stamped on the menu', () => {
    expect(referenceMenuItemCount(MENU_REFERENCE)).toBe(9);
  });

  it('counts the items when the tally is missing, so a found menu still shows', () => {
    const noTally = { kind: 'url', summary: 's', menu: { sections: [{ name: 'X', items: [{ name: 'A' }, { name: 'B' }, {}] }] } } as unknown as ConciergeReference;
    expect(referenceMenuItemCount(noTally)).toBe(2);
  });

  it('is 0 for a reference with no menu', () => {
    expect(referenceMenuItemCount({ kind: 'url', summary: 's' } as ConciergeReference)).toBe(0);
    expect(referenceMenuItemCount(undefined)).toBe(0);
    expect(referenceMenuItemCount(null)).toBe(0);
  });
});

describe('buildMenuContentFromChat — a menu pasted into the chat (2026-09-22)', () => {
  it('needs at least three priced lines — an instruction with a price or two is not a menu', () => {
    expect(buildMenuContentFromChat('make the burrito $12 and the tacos $3')).toBeUndefined();
    expect(buildMenuContentFromChat('Super Burrito $12.99\nAl Pastor $3.25')).toBeUndefined();
    expect(buildMenuContentFromChat('')).toBeUndefined();
    expect(buildMenuContentFromChat(undefined)).toBeUndefined();
  });

  it('keeps every priced line verbatim and short headers that sit above them', () => {
    const out = buildMenuContentFromChat([
      'here is our menu, use all of it.',
      'Burritos',
      'Super Burrito $12.99',
      'Veggie Burrito 10.50',
      'Drinks:',
      'Horchata $3.50',
    ].join('\n'))!;
    const lines = out.split('\n');
    expect(lines[0]).toBe(
      'REAL MENU typed or pasted by the operator in the chat. 3 priced items. ' +
        'Every row below is theirs: put ALL of them on the board, names and prices exactly as written, and invent nothing.',
    );
    expect(lines.slice(1)).toEqual(['Burritos:', 'Super Burrito $12.99', 'Veggie Burrito 10.50', 'Drinks:', 'Horchata $3.50']);
  });

  it('the header carries no currency amount and no em-dash pair (the API counts rows by those)', () => {
    const header = buildMenuContentFromChat('A $1.00\nB $2.00\nC $3.00')!.split('\n')[0];
    expect(header).not.toMatch(/[$€£¥]\s?\d/);
    expect(header).not.toContain(' — ');
  });

  it('stays under the content cap on a huge paste, cutting on a line boundary', () => {
    const paste = Array.from({ length: 400 }, (_, i) => `Item number ${i} with a long descriptive name $${(i % 20) + 1}.99`).join('\n');
    const out = buildMenuContentFromChat(paste)!;
    expect(out.length).toBeLessThanOrEqual(7_500);
    expect(out.endsWith('.99')).toBe(true);
  });
});
