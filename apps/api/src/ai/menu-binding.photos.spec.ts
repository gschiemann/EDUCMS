/**
 * menu-binding — ITEM PHOTOS on a POS-bound board (2026-09-23).
 *
 * A generation plan says which photo each row may show (`plan.itemPhotos`): OUR
 * copy of the POS's own photo of that dish, or none. The binder then holds every
 * card to it — a swapped or invented `src` is replaced by the row's own photo or
 * removed, the slot stays (keyed `item.<row>.photo`), and a row with no photo
 * never borrows one. The logo, the hero and anything outside the menu are not
 * menu photos and are never touched. Keep / "Edit with words" plans carry no
 * `itemPhotos`, so images stay exactly as drawn.
 *
 * FIXTURES:
 *   • super-taco-burritos.board.html — the Super Taco wall GPT-6 Sol drew for
 *     Codex (scripts stripped as sanitizeDesignerHtml strips them): six cards,
 *     each with a DIV photo frame `data-imgslot="item.N.image"` holding a "✹"
 *     glyph the board hides via `.dish-photo[data-has-image="true"] span`. The
 *     reference boards the model is shown use the same frame.
 *   • A board written to the row contract the POS-bound directive now asks
 *     for — `<img data-imgslot="item.N.photo" src="…">` in each card — with
 *     every way a model gets it wrong.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { bindMenuRows, validateBoundBoard, type BindingPlan } from './menu-binding';
import { sanitizeDesignerHtml } from './designer-prompt';
import { finishDesignerBoard } from './designer-pos-binding';
import { collectGroundedFacts } from './fact-guard';
import { formatPosPlanContent } from './pos-binding-plan';

const CARDS = sanitizeDesignerHtml(readFileSync(join(__dirname, '__fixtures__', 'super-taco-burritos.board.html'), 'utf8')).html;

const OUR = (n: number) => `https://sb.example/storage/v1/object/public/assets/ai-designer/t1/item-${'a'.repeat(15)}${n}.jpg`;
const LOGO = 'https://sb.example/storage/v1/object/public/assets/ai-designer/t1/logo-0123456789abcdef.png';
const HERO = 'https://sb.example/storage/v1/object/public/assets/ai-designer/t1/photo-0123456789abcdef.jpg';

function plan(rows: Array<[string, string, number, string | null]>, itemPhotos: boolean | undefined): BindingPlan {
  return {
    providerId: 'toast',
    providerName: 'Toast',
    connectionId: 'conn-toast-1',
    items: rows.map(([externalId, name, cents, imageUrl], n) => ({
      n,
      externalId,
      name,
      priceCents: cents,
      priceText: `$${(cents / 100).toFixed(2)}`,
      section: 'Burritos',
      ...(imageUrl ? { imageUrl } : {}),
    })),
    ...(itemPhotos === undefined ? {} : { itemPhotos }),
  };
}

/** The opening tag of the element carrying `attr` (first match). */
function tagWith(html: string, attr: string): string {
  const at = html.indexOf(attr);
  if (at < 0) return '';
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
}

// ── The real card board ──────────────────────────────────────────────────
describe('item photos on the Super Taco card board (div frames)', () => {
  const SIX: Array<[string, string, number]> = [
    ['toast-a', 'Asada Super Burrito', 1795],
    ['toast-b', 'Grilled Chicken Super Burrito', 1595],
    ['toast-c', 'Steak California Burrito', 1850],
    ['toast-d', 'Shredded Chicken Super Nachos', 1925],
    ['toast-e', 'Steak Quesadilla', 825],
    ['toast-f', 'Agua Fresca (Large)', 575],
  ];
  const withPhotos = plan(SIX.map(([id, name, c], n) => [id, name, c, n === 0 || n === 2 ? OUR(n) : null]), true);
  const res = bindMenuRows(CARDS, withPhotos);

  it('a row WITH a photo: its frame shows OUR copy as a cover background and says it has an image', () => {
    for (const n of [0, 2]) {
      const frame = tagWith(res.html, `data-imgslot="item.${n}.photo"`);
      expect(frame).toMatch(/^<div class="dish-photo"/);
      expect(frame).toContain(`background-image:url('${OUR(n)}')`);
      expect(frame).toContain('background-size:cover');
      expect(frame).toContain(`data-img="item.${n}.photo"`);
      expect(frame).toContain('data-has-image="true"');
    }
  });

  it('a row WITHOUT one keeps its frame (the slot stays, the glyph shows) and borrows nothing', () => {
    for (const n of [1, 3, 4, 5]) {
      const frame = tagWith(res.html, `data-imgslot="item.${n}.photo"`);
      expect(frame).toMatch(/^<div class="dish-photo"/);
      expect(frame).not.toMatch(/background-image|data-has-image|style=/);
    }
    // Only the two photos in the plan appear, once each.
    for (const n of [1, 3, 4, 5]) expect(res.html).not.toContain(OUR(n));
    expect(res.html.split(OUR(0)).length - 1).toBe(1);
    expect(res.html.split(OUR(2)).length - 1).toBe(1);
    expect(res.html).not.toContain('data-imgslot="item.0.image"');
  });

  it('the logo and the rail photo are not menu photos — byte-identical', () => {
    for (const key of ['data-imgslot="brand.logo"', 'data-imgslot="rail.image"']) {
      expect(tagWith(res.html, key)).toBe(tagWith(CARDS, key));
    }
  });

  it('the board is still fully bound, every row priced from the catalog', () => {
    expect(res.bound).toEqual([0, 1, 2, 3, 4, 5]);
    expect(validateBoundBoard(res.html, withPhotos)).toEqual({ ok: true, missing: [] });
  });

  it('negative control: a keep / revise plan (no itemPhotos) leaves every frame exactly as drawn', () => {
    const keep = bindMenuRows(CARDS, plan(SIX.map(([id, name, c], n) => [id, name, c, n === 0 ? OUR(n) : null]), undefined));
    for (let n = 0; n < 6; n++) {
      expect(tagWith(keep.html, `data-imgslot="item.${n}.image"`)).toBe(tagWith(CARDS, `data-imgslot="item.${n}.image"`));
    }
    expect(keep.html).not.toContain(OUR(0));
  });
});

// ── The contract board, with every mistake a model makes ─────────────────
describe('item photos on a board written to the row contract (<img> frames)', () => {
  const card = (n: number, name: string, price: string, media: string) =>
    `<article class="card" data-menu-row="${n}">${media}<span class="nm" data-field="item.${n}.name">${name}</span><span class="pr" data-field="item.${n}.price">${price}</span></article>`;
  const BOARD =
    '<!doctype html><html><head><style>.stage{width:1920px;height:1080px;position:relative}.card img{width:300px;height:200px;object-fit:cover}</style></head>' +
    '<body><div class="stage">' +
    `<img data-imgslot="logo" src="${LOGO}" alt="Super Taco">` +
    '<h1 data-field="headline">Tacos &amp; More</h1>' +
    `<img data-imgslot="hero" src="${HERO}" alt="">` +
    '<div class="cards">' +
    // 0: right photo, plus a srcset the model made up
    card(0, 'Birria', '$14.50', `<div class="frame"><img data-imgslot="item.0.photo" src="${OUR(0)}" srcset="${OUR(0)} 1x, https://cdn.example.com/big-0.jpg 2x" alt=""></div>`) +
    // 1: no photo in the plan — the model borrowed row 0's
    card(1, 'Fish Taco', '$4.50', `<div class="frame"><img data-imgslot="item.1.photo" src="${OUR(0)}" alt=""></div>`) +
    // 2: has a photo — the model invented one (and a <source>)
    card(2, 'Asada', '$17.50', '<picture><source srcset="https://cdn.example.com/asada.webp" type="image/webp"><img data-imgslot="item.2.photo" src="https://cdn.example.com/asada.jpg" alt=""></picture>') +
    // 3: has a photo — the model used row 0's KEY and photo
    card(3, 'Al Pastor', '$4.25', `<img data-imgslot="item.0.photo" src="${OUR(0)}" alt="">`) +
    // 4: no photo — an invented background on an unkeyed panel
    card(4, 'Carnitas', '$12.75', `<div class="frame" style="background-image:url('https://cdn.example.com/x.jpg');background-size:cover"></div>`) +
    '</div>' +
    // Outside every card: a photo strip keyed to row 1 (no photo), showing row 2's photo.
    `<div class="strip"><img data-imgslot="item.1.photo" src="${OUR(2)}" alt=""></div>` +
    '</div></body></html>';
  const ROWS: Array<[string, string, number, string | null]> = [
    ['t-0', 'Birria', 1450, OUR(0)],
    ['t-1', 'Fish Taco', 450, null],
    ['t-2', 'Asada', 1750, OUR(2)],
    ['t-3', 'Al Pastor', 425, OUR(3)],
    ['t-4', 'Carnitas', 1275, null],
  ];
  const photoPlan = plan(ROWS, true);
  const res = bindMenuRows(BOARD, photoPlan);
  const cardOf = (html: string, n: number) => {
    const at = html.indexOf(`data-menu-row="${n}"`);
    return html.slice(html.lastIndexOf('<article', at), html.indexOf('</article>', at));
  };

  it('keeps a row\'s own photo, and drops a srcset it did not come with', () => {
    const img = tagWith(cardOf(res.html, 0), 'data-imgslot="item.0.photo"');
    expect(img).toContain(`src="${OUR(0)}"`);
    expect(img).not.toContain('srcset');
    expect(res.html).not.toContain('big-0.jpg');
  });

  it('a row with NO photo loses the borrowed one — the slot stays, empty', () => {
    const img = tagWith(cardOf(res.html, 1), 'data-imgslot="item.1.photo"');
    expect(img).toBe('<img data-imgslot="item.1.photo" alt="">');
  });

  it('an invented src becomes the row\'s own photo; the <source> beside it loses its srcset', () => {
    const c = cardOf(res.html, 2);
    expect(tagWith(c, 'data-imgslot="item.2.photo"')).toContain(`src="${OUR(2)}"`);
    expect(c).toContain('<source type="image/webp">');
    expect(res.html).not.toContain('cdn.example.com/asada');
  });

  it('another row\'s key and photo in a card are re-keyed to the card\'s own row and photo', () => {
    const c = cardOf(res.html, 3);
    expect(tagWith(c, 'data-imgslot="item.3.photo"')).toContain(`src="${OUR(3)}"`);
    expect(c).not.toContain('data-imgslot="item.0.photo"');
    expect(c).not.toContain(OUR(0));
  });

  it('an invented background on a no-photo row is dropped; the rest of its style stays', () => {
    const c = cardOf(res.html, 4);
    expect(c).not.toContain('cdn.example.com/x.jpg');
    expect(c).toContain('style="background-size:cover"');
  });

  it('outside every card, an item-keyed slot answers to the row its key names', () => {
    const strip = res.html.slice(res.html.indexOf('<div class="strip">'));
    expect(tagWith(strip, 'data-imgslot="item.1.photo"')).toBe('<img data-imgslot="item.1.photo" alt="">');
  });

  it('the header logo and the hero are not menu photos — untouched', () => {
    expect(res.html).toContain(`<img data-imgslot="logo" src="${LOGO}" alt="Super Taco">`);
    expect(res.html).toContain(`<img data-imgslot="hero" src="${HERO}" alt="">`);
  });

  it('every photo on the board is one the plan gave its own row', () => {
    const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
    const shown = [...res.html.matchAll(/<img\b[^>]*>/g)]
      .map((m) => [attr(m[0], 'data-imgslot'), attr(m[0], 'src')])
      .filter(([slot, src]) => /^item\.\d+\.photo$/.test(slot || '') && src);
    expect(shown).toEqual([
      ['item.0.photo', OUR(0)],
      ['item.2.photo', OUR(2)],
      ['item.3.photo', OUR(3)],
    ]);
    expect(validateBoundBoard(res.html, photoPlan)).toEqual({ ok: true, missing: [] });
  });

  it('negative control: bound WITHOUT itemPhotos, every mistake above is still on the board', () => {
    const keep = bindMenuRows(BOARD, plan(ROWS, undefined)).html;
    expect(tagWith(cardOf(keep, 1), 'data-imgslot="item.1.photo"')).toContain(`src="${OUR(0)}"`);
    expect(keep).toContain('cdn.example.com/asada.jpg');
    expect(keep).toContain('cdn.example.com/x.jpg');
    expect(keep).toContain('srcset=');
  });

  it('through the real generation path (sanitize → bind → price guard → validate)', () => {
    const facts = collectGroundedFacts(['menu board'], { menuContent: formatPosPlanContent(photoPlan) });
    const out = finishDesignerBoard(sanitizeDesignerHtml(BOARD).html, facts, photoPlan);
    expect(out.binding).toEqual({ ok: true, missing: [] });
    expect(out.dropped).toEqual([]);
    expect(out.html).not.toContain('cdn.example.com');
    expect(tagWith(cardOf(out.html, 1), 'data-imgslot="item.1.photo"')).not.toContain('src=');
  });

  it('a plan with NO photos at all (no storage, or none passed): every item image goes, the slots stay', () => {
    const none = bindMenuRows(BOARD, plan(ROWS.map(([id, name, c]) => [id, name, c, null]), true)).html;
    const itemImgs = [...none.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]).filter((t) => /data-imgslot="item\.\d+\.photo"/.test(t));
    expect(itemImgs).toHaveLength(5);
    expect(itemImgs.filter((t) => /\ssrc=/.test(t))).toEqual([]);
    expect(none).toContain(`<img data-imgslot="logo" src="${LOGO}" alt="Super Taco">`);
    expect(none).toContain(`<img data-imgslot="hero" src="${HERO}" alt="">`);
  });
});
