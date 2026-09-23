/**
 * menu-binding — the SERVER decides which POS item each row of an AI board is
 * (2026-09-22, Greg: "ensures the template is created with perfect integrations
 * into those systems").
 *
 * FIXTURES:
 *   • super-taco-burritos.board.html — the Super Taco "Burritos & More" wall
 *     exactly as GPT-6 Sol (via Codex) authored it, scripts stripped the way
 *     sanitizeDesignerHtml strips them. A CARD layout: category, photo slot,
 *     name, description, price strip — the layout AI menu boards now aim at.
 *     It carries Codex's own `data-seed` names, which must NOT survive: a
 *     binding never comes from the page.
 *   • DESIGNER_EXEMPLAR — the ROW layout every AI board is taught (the
 *     description is NESTED inside the name element).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { bindMenuRows, readMenuBindings, setTagAttrs, validateBoundBoard, type BindingPlan } from './menu-binding';
import { sanitizeDesignerHtml } from './designer-prompt';
import { DESIGNER_EXEMPLARS } from './designer-exemplars';
import { collectGroundedFacts, enforceGroundedFactsInHtml } from './fact-guard';
import { buildPosBindingPlan, formatPosPlanContent } from './pos-binding-plan';

const CARDS = sanitizeDesignerHtml(
  readFileSync(join(__dirname, '__fixtures__', 'super-taco-burritos.board.html'), 'utf8'),
).html;

function plan(rows: Array<[string, string, number]>, over: Partial<BindingPlan> = {}): BindingPlan {
  return {
    providerId: 'toast',
    providerName: 'Toast',
    connectionId: 'conn-toast-1',
    items: rows.map(([externalId, name, cents], n) => ({
      n,
      externalId,
      name,
      priceCents: cents,
      priceText: `$${(cents / 100).toFixed(2)}`,
      section: 'Burritos',
    })),
    ...over,
  };
}

/** The catalog the six cards should show — deliberately NOT the board's own text. */
const TOAST_SIX = plan([
  ['toast-guid-a', 'Asada Super Burrito', 1795],
  ['toast-guid-b', 'Grilled Chicken Super Burrito', 1595],
  ['toast-guid-c', 'Steak California Burrito', 1850],
  ['toast-guid-d', 'Shredded Chicken Super Nachos', 1925],
  ['toast-guid-e', 'Steak Quesadilla', 825],
  ['toast-guid-f', 'Agua Fresca (Large)', 575],
]);

describe('bindMenuRows — a real card board', () => {
  const res = bindMenuRows(CARDS, TOAST_SIX);

  it('finds every card by its own fields (no data-menu-row on the board) and stamps it', () => {
    expect(res.bound).toEqual([0, 1, 2, 3, 4, 5]);
    expect(res.missing).toEqual([]);
    // The CARD carries the binding — the article, not the name or the price strip.
    expect(res.html).toMatch(/<article class="dish"[^>]*data-menu-row="0"[^>]*data-pos-item="toast-guid-a"[^>]*data-seed="Asada Super Burrito"/);
    expect(res.html).toMatch(/<article class="dish"[^>]*data-menu-row="5"[^>]*data-pos-item="toast-guid-f"/);
    expect(res.html.match(/data-pos-item="/g)).toHaveLength(6);
  });

  it('rewrites every name and price to the CATALOG\'s values', () => {
    for (const p of ['$17.95', '$15.95', '$18.50', '$19.25', '$8.25', '$5.75']) expect(res.html).toContain(`>${p}<`);
    for (const stale of ['$17.50', '$15.50', '$18.00', '$19.00', '$7.75', '$5.35']) expect(res.html).not.toContain(stale);
    expect(res.html).toContain('data-field="item.5.name" data-fit data-fit-min="50">Agua Fresca (Large)<');
    expect(res.html).not.toContain('>Large Agua Fresca<');
  });

  it('replaces the page\'s own data-seed names — a binding never comes from the board', () => {
    expect(res.html).not.toContain('data-seed="Agua Fresca Large"');
    expect(res.html).toContain('data-seed="Agua Fresca (Large)"');
  });

  it('stamps the connection on <body> and reads every binding back in Codex\'s slot-map shape', () => {
    expect(res.html).toMatch(/<body[^>]*data-pos-connection="conn-toast-1"[^>]*data-pos-provider="toast"/);
    expect(readMenuBindings(res.html)).toEqual({
      connectionId: 'conn-toast-1',
      providerId: 'toast',
      slots: {
        'item.0': 'toast-guid-a',
        'item.1': 'toast-guid-b',
        'item.2': 'toast-guid-c',
        'item.3': 'toast-guid-d',
        'item.4': 'toast-guid-e',
        'item.5': 'toast-guid-f',
      },
    });
  });

  it('leaves everything else byte-identical (descriptions, photo slots, rail, footer)', () => {
    expect(res.html).toContain('Steak, rice, beans and all the fixings.');
    expect(res.html).toContain('data-imgslot="item.3.image"');
    expect(res.html).toContain('Big flavor for every appetite.');
    expect(res.html).toContain('data-field="footer.right" data-fit data-fit-min="50">Supertacomex.com<');
    // Only the six cards' opening tags, their names/prices and <body> changed.
    const strip = (h: string) =>
      h.replace(/<article[^>]*>/g, '<article>').replace(/<body[^>]*>/g, '<body>').replace(/data-field="item\.\d\.(name|price)"[^>]*>[^<]*</g, '');
    expect(strip(res.html)).toBe(strip(CARDS));
  });

  it('survives the price guard: the catalog prices are grounded by the plan content, row by row', () => {
    const content = formatPosPlanContent(TOAST_SIX);
    const guarded = enforceGroundedFactsInHtml(res.html, collectGroundedFacts([content], { menuContent: content }));
    expect(guarded.html).toBe(res.html);
    expect(validateBoundBoard(guarded.html, TOAST_SIX)).toEqual({ ok: true, missing: [] });
  });
});

describe('bindMenuRows — every compiled menu reference board (the layouts the model is taught)', () => {
  const ROWS: Array<[string, string, number]> = [
    ['sq-1', 'Cortado', 450],
    ['sq-2', 'Flat White', 500],
    ['sq-3', 'Pour Over', 525],
    ['sq-4', 'Brown Sugar Oat Latte', 575],
    ['sq-5', 'Nitro Cold Brew (16oz)', 550],
    ['sq-6', 'Matcha Latte', 600],
  ];
  const MENU_BOARDS = DESIGNER_EXEMPLARS.filter((e) => e.purposes.includes('menu') && e.priced);

  it('there are menu reference boards to bind (landscape + portrait)', () => {
    expect(MENU_BOARDS.length).toBeGreaterThanOrEqual(4);
    expect(new Set(MENU_BOARDS.map((e) => e.orientation))).toEqual(new Set(['landscape', 'portrait']));
  });

  it.each(MENU_BOARDS.map((e) => [e.id, e] as const))('%s: every row binds to its catalog item, and the bound board validates', (_id, ex) => {
    const p = plan(ROWS.slice(0, ex.itemCount), { providerId: 'square', providerName: 'Square', connectionId: 'conn-sq' });
    const res = bindMenuRows(ex.html, p);
    expect(res.bound).toEqual(p.items.map((it) => it.n));
    expect(res.html).toMatch(/data-menu-row="0"[^>]*data-pos-item="sq-1"/);
    // The placeholder names and zeroed prices are gone; the catalog's are on the glass.
    expect(res.html).toContain('Cortado');
    expect(res.html).not.toContain('Menu Item One');
    expect(validateBoundBoard(res.html, p)).toEqual({ ok: true, missing: [] });
  });
});

describe('bindMenuRows — explicit rows, strays, and ids from the page', () => {
  const board = (rows: string) =>
    `<!doctype html><html><body data-pos-connection="evil-conn"><div class="stage"><h1 data-field="headline">Menu</h1><ul class="list">${rows}</ul></div></body></html>`;
  const li = (attrs: string, n: number, name: string, price: string) =>
    `<li${attrs}><span data-field="item.${n}.name">${name}</span><b data-field="item.${n}.price">${price}</b></li>`;
  const THREE = plan([
    ['id-0', 'Tacos', 350],
    ['id-1', 'Burrito', 900],
    ['id-2', 'Horchata', 325],
  ]);

  it('uses the model\'s data-menu-row when it holds one row\'s fields', () => {
    const html = board(li(' data-menu-row="0"', 0, 'Tacos', '$3.50') + li(' data-menu-row="1"', 1, 'Burrito', '$9.00') + li(' data-menu-row="2"', 2, 'Horchata', '$3.25'));
    const res = bindMenuRows(html, THREE);
    expect(res.bound).toEqual([0, 1, 2]);
    expect(res.html).toContain('<li data-menu-row="1" data-pos-item="id-1" data-seed="Burrito">');
  });

  it('ignores a data-menu-row that spans several rows and binds each row by its fields', () => {
    const html = board(`<div class="col" data-menu-row="0">${li('', 0, 'Tacos', '$3.50')}${li('', 1, 'Burrito', '$9.00')}</div>${li('', 2, 'Horchata', '$3.25')}`);
    const res = bindMenuRows(html, THREE);
    expect(res.bound).toEqual([0, 1, 2]);
    expect(res.html).toContain('<div class="col">');
    expect(res.html).toContain('<li data-menu-row="0" data-pos-item="id-0" data-seed="Tacos">');
  });

  it('takes an UNKNOWN row number and a DUPLICATE row off the board', () => {
    const html = board(
      li('', 0, 'Tacos', '$3.50') + li('', 1, 'Burrito', '$9.00') + li('', 2, 'Horchata', '$3.25') +
      li('', 7, 'Churros', '$4.00') + li('', 1, 'Burrito again', '$9.00'),
    );
    const res = bindMenuRows(html, THREE);
    expect(res.removedStrays).toBe(2);
    expect(res.html).not.toContain('Churros');
    expect(res.html).not.toContain('Burrito again');
    expect(res.html.match(/data-field="item\.1\.name"/g)).toHaveLength(1);
    expect(res.bound).toEqual([0, 1, 2]);
  });

  it('"Edit with words" mode unbinds strays instead of deleting them', () => {
    const html = board(li('', 0, 'Tacos', '$3.50') + li(' data-pos-item="id-1"', 5, 'Agua de Jamaica', '$3.00'));
    const res = bindMenuRows(html, THREE, { removeStrays: false });
    expect(res.html).toContain('Agua de Jamaica');
    expect(res.html).not.toContain('data-pos-item="id-1"');
    expect(res.missing).toEqual([1, 2]);
  });

  it('never takes an id from the model: its data-pos-item values are replaced or stripped', () => {
    const html = board(
      li(' data-pos-item="tenant-b-guid" data-seed="Something"', 0, 'Tacos', '$3.50') +
      li('', 1, 'Burrito', '$9.00') +
      li('', 2, 'Horchata', '$3.25'),
    ).replace('<h1 data-field="headline">', '<h1 data-field="headline" data-pos-item="another-tenant">');
    const res = bindMenuRows(html, THREE);
    expect(res.html).not.toContain('tenant-b-guid');
    expect(res.html).not.toContain('another-tenant');
    expect(res.html).not.toContain('evil-conn');
    expect(readMenuBindings(res.html)).toEqual({
      connectionId: 'conn-toast-1',
      providerId: 'toast',
      slots: { 'item.0': 'id-0', 'item.1': 'id-1', 'item.2': 'id-2' },
    });
  });

  it('reports a planned row the board never drew as missing, and validation fails for it', () => {
    const html = board(li('', 0, 'Tacos', '$3.50') + li('', 2, 'Horchata', '$3.25'));
    const res = bindMenuRows(html, THREE);
    expect(res.missing).toEqual([1]);
    expect(validateBoundBoard(res.html, THREE)).toEqual({ ok: false, missing: [1] });
  });

  it('binds a row the model split into columns (name and price as siblings) without deleting its price', () => {
    const split =
      '<!doctype html><html><body><div class="stage"><div class="names">' +
      '<p data-field="item.0.name">Tacos</p><p data-field="item.1.name">Burrito</p><p data-field="item.2.name">Horchata</p>' +
      '</div><div class="prices"><p data-field="item.0.price">$3.50</p><p data-field="item.1.price">$9.00</p><p data-field="item.2.price">$3.25</p></div></div></body></html>';
    const res = bindMenuRows(split, THREE);
    expect(res.removedStrays).toBe(0);
    expect(res.bound).toEqual([0, 1, 2]);
    expect(res.html).toContain('<p data-field="item.1.name" data-menu-row="1" data-pos-item="id-1" data-seed="Burrito">Burrito</p>');
    expect(res.html).toContain('data-field="item.2.price">$3.25<');
    expect(validateBoundBoard(res.html, THREE).ok).toBe(true);
  });

  it('validation catches a bound row whose price the guard later removed', () => {
    const html = board(li('', 0, 'Tacos', '$3.50') + li('', 1, 'Burrito', '$9.00') + li('', 2, 'Horchata', '$3.25'));
    const bound = bindMenuRows(html, THREE).html;
    const priceless = bound.replace('data-field="item.2.price">$3.25', 'data-field="item.2.price">');
    expect(validateBoundBoard(priceless, THREE)).toEqual({ ok: false, missing: [2] });
  });
});

describe('setTagAttrs', () => {
  it('replaces an attribute, removes a null one, and never touches a longer name', () => {
    expect(setTagAttrs('<li data-seed="x" data-seed-extra="y" class="a">', { 'data-seed': 'Taco "Loco"', 'data-menu-row': null }))
      .toBe('<li data-seed-extra="y" class="a" data-seed="Taco &quot;Loco&quot;">');
    expect(setTagAttrs('<img src="a.png"/>', { 'data-x': '1' })).toBe('<img src="a.png" data-x="1"/>');
  });
});

describe('the model never receives an id', () => {
  it('the plan content carries row numbers, names and prices — no externalId', () => {
    const p = buildPosBindingPlan({
      menu: {
        categories: [{ id: 'c1', name: 'Tacos' }],
        items: [{ externalId: 'SECRET-GUID-123', name: 'Fish Taco', priceCents: 450, category: 'Tacos', description: 'beer battered' }],
      },
      sections: ['Tacos'],
      providerId: 'toast',
      providerName: 'Toast',
      connectionId: 'conn-SECRET',
      rowLimit: 24,
    });
    const content = formatPosPlanContent(p);
    expect(content).toContain('[item.0] Tacos — Fish Taco — $4.50 — beer battered');
    expect(content).not.toContain('SECRET');
  });
});
