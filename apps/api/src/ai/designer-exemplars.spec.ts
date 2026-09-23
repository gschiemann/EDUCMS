/**
 * The AI Designer's reference boards (2026-09-22, AI Designer rework; welcome
 * boards + venue-type preference 2026-09-23).
 *
 * Five things are pinned here:
 *   1. FRESHNESS — designer-exemplars.generated.ts is exactly what
 *      apps/api/scripts/build-designer-exemplars.cjs produces from the CURRENT
 *      approved boards (with a negative control: a tampered copy fails the
 *      builder's own --check).
 *   2. NO BUSINESS CONTENT — not one line, name, dish word, price, time or brand
 *      spelling from the source boards survives into the generated file, and
 *      every word a reference shows is one the placeholder banks write
 *      (negative controls: restoring a real dish, price, wordmark, person,
 *      venue, time or line is caught).
 *   3. WHAT THE MODEL IS SHOWN — no script, no injected runtime, no asset path
 *      that only resolves inside apps/web/public, fonts from the loaded list,
 *      LED-safe CSS, no type under the size floor of the board's OWN canvas, the
 *      row contract, the stage the platform scales, only Designer attributes.
 *   4. SELECTION — per purpose, the request's own venue type first (a board kept
 *      to its own type reaches another only as a last resort), the candidate's
 *      own layout first, the request's orientation; no vertical = the selection
 *      the Designer made before venue types existed.
 *   5. STRUCTURES — every reference names a structure of its purpose, and the
 *      layouts a batch builds are unchanged by the two appended ones.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as cheerio from 'cheerio';
import { VERTICALS } from '@cms/api-types';
import {
  DESIGNER_EXEMPLARS,
  exemplarFamilyFor,
  exemplarTier,
  formatExemplarsForPrompt,
  selectDesignerExemplars,
  type DesignerExemplar,
  type SelectDesignerExemplarsInput,
} from './designer-exemplars';
import {
  DESIGNER_FONTS,
  auditDesignerHtmlTaurus,
  sanitizeDesignerHtml,
  designerStructuresFor,
  designerSizeFloor,
  designerVerticalFamily,
} from './designer-prompt';
import { DESIGNER_PURPOSES, DESIGNER_STRUCTURES, type DesignerPurpose } from './designer-structures';

const API_ROOT = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(API_ROOT, '..', '..');
const BUILDER = path.join(API_ROOT, 'scripts', 'build-designer-exemplars.cjs');
const GENERATED = path.join(__dirname, 'designer-exemplars.generated.ts');

interface BuilderSource {
  status: 'reference' | 'candidate' | 'wip';
  id: string;
  file: string;
  brandTokens?: string[];
  neutralizer?: number;
  stage?: string;
  canvas?: { w: number; h: number };
  portrait?: { canvas: { w: number; h: number }; prefixes: string[]; flag?: { attr?: [string, string] } };
  orientations?: Array<'landscape' | 'portrait'>;
  verticals?: string[];
  verticalOnly?: boolean;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const builder = require(BUILDER) as {
  render(): string;
  SOURCES: BuilderSource[];
  splitStatements(css: string): Array<{ kind: string; selector?: string; prelude?: string; body?: string }>;
  splitDecls(body: string): Array<{ prop: string; value: string }>;
  splitSelectors(sel: string): string[];
  liftSize(size: string, floor: number): string;
  placeholderFor(text: string, key: string, line: number, src: { brandTokens: string[] }): string;
  placeholderV2(text: string, key: string, line: number, src: { brandTokens: string[] }): string;
  placeholderWords(): Set<string>;
  roleOfKey(key: string, src: { roles?: unknown[] }, text: string): string;
  NAME_ROLES: Set<string>;
};
const REFERENCES = builder.SOURCES.filter((s) => s.status === 'reference');
const V2_REFERENCES = REFERENCES.filter((s) => s.neutralizer === 2);
const sourceOf = (e: DesignerExemplar) => REFERENCES.find((s) => e.id === s.id || e.id === `${s.id}-portrait`);
const variantsOf = (s: BuilderSource) => s.orientations ?? (s.portrait ? ['landscape', 'portrait'] : ['landscape']);
const readSource = (s: BuilderSource) => fs.readFileSync(path.join(REPO_ROOT, s.file), 'utf8');

describe('designer-exemplars.generated.ts — freshness', () => {
  it('is exactly what the builder produces from the current boards', () => {
    expect(fs.readFileSync(GENERATED, 'utf8')).toBe(builder.render());
  });

  it("the builder's --check passes on the committed file and FAILS on a tampered copy (negative control)", () => {
    const run = (out: string) => {
      try {
        execFileSync(process.execPath, [BUILDER, '--check'], { env: { ...process.env, DESIGNER_EXEMPLARS_OUT: out }, stdio: 'pipe' });
        return 0;
      } catch (e: unknown) {
        const status = (e as { status?: unknown } | null)?.status;
        return typeof status === 'number' ? status : 1;
      }
    };
    expect(run(GENERATED)).toBe(0);
    const committed = fs.readFileSync(GENERATED, 'utf8');
    expect(committed).toContain('$00.00');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'designer-exemplars-'));
    const tampered = path.join(dir, 'designer-exemplars.generated.ts');
    fs.writeFileSync(tampered, committed.replace('$00.00', '$99.99'));
    expect(run(tampered)).toBe(1);
    // …and a tampered WELCOME board (a placeholder swapped back for a name).
    expect(committed).toContain('>Staff Name<');
    fs.writeFileSync(tampered, committed.replace('>Staff Name<', '>Coach Name<'));
    expect(run(tampered)).toBe(1);
  });

  it('every reference records its approval, and SOURCES names the board it came from (hash-checked)', () => {
    expect(DESIGNER_EXEMPLARS.length).toBeGreaterThan(0);
    for (const e of DESIGNER_EXEMPLARS) {
      expect(e.approval).toMatch(/\S/);
      const src = sourceOf(e);
      expect(src).toBeDefined();
      expect(e.sourceSha256).toBe(crypto.createHash('sha256').update(readSource(src!), 'utf8').digest('hex').slice(0, 16));
    }
  });

  it('a welcome / announcement / information reference is a board that carries its own APPROVED header', () => {
    expect(V2_REFERENCES.length).toBeGreaterThan(0);
    for (const src of V2_REFERENCES) expect(readSource(src)).toMatch(/APPROVED 20\d\d-\d\d-\d\d/);
  });

  it('compiles only approved references, in the orientations that passed — held-back candidates never reach the model', () => {
    const want = REFERENCES.flatMap((s) => variantsOf(s).map((o) => (o === 'portrait' ? `${s.id}-portrait` : s.id))).sort();
    expect(DESIGNER_EXEMPLARS.map((e) => e.id).sort()).toEqual(want);
    for (const c of builder.SOURCES.filter((s) => s.status !== 'reference')) {
      expect(DESIGNER_EXEMPLARS.some((e) => e.id.startsWith(c.id))).toBe(false);
    }
    // The gym split board's portrait failed the render gate (04-exemplars.md).
    expect(DESIGNER_EXEMPLARS.map((e) => e.id)).toContain('welcome-split');
    expect(DESIGNER_EXEMPLARS.map((e) => e.id)).not.toContain('welcome-split-portrait');
  });

  it('a 1080p board keeps its canvas: width/height are the source canvas, never a rescale', () => {
    for (const e of DESIGNER_EXEMPLARS) {
      const src = sourceOf(e)!;
      const canvas = e.orientation === 'portrait' ? src.portrait!.canvas : src.canvas!;
      expect([e.width, e.height]).toEqual([canvas.w, canvas.h]);
    }
    expect(DESIGNER_EXEMPLARS.some((e) => e.width === 1920 && e.height === 1080)).toBe(true);
  });

  it('pins exactly which references are priced — the boards fact-guard and menu-binding are tested on', () => {
    expect(DESIGNER_EXEMPLARS.filter((e) => e.priced).map((e) => e.id).sort()).toEqual([
      'menu-hero-cards',
      'menu-hero-cards-portrait',
      'menu-rail-cards',
      'menu-rail-cards-portrait',
      'offer-split',
      'offer-split-portrait',
    ]);
  });
});

// ── 2. No business content ──────────────────────────────────────────────────
// What a leak looks like is derived from the SOURCE boards themselves, so a new
// dish, name or time Codex adds to one of them is covered the day it lands.
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const wordsOf = (s: string) => fold(s).match(/\p{L}+/gu) || [];
const VOCAB = builder.placeholderWords();
/** Every text a board SHOWS: its text nodes and its text-bearing attributes. */
function shownText(html: string): string[] {
  const $ = cheerio.load(html);
  $('script, style, noscript, template').remove();
  const out: string[] = [];
  $('body *')
    .contents()
    .each((_i, n) => {
      if ((n.type as string) !== 'text') return;
      const t = $(n).text().replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
    });
  $('[alt],[title],[aria-label]').each((_i, el) => {
    for (const a of ['alt', 'title', 'aria-label']) {
      const v = $(el).attr(a);
      if (v) out.push(v);
    }
  });
  for (const css of html.match(/<style>[\s\S]*?<\/style>/g) || []) {
    for (const m of css.matchAll(/content\s*:\s*(["'])(.*?)\1/g)) if (m[2]) out.push(m[2]);
  }
  return out;
}
/** The name-like tokens of a board's markup: class and id values, split into words. */
function markupTokens(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/\s(?:class|id)="([^"]*)"/g)) {
    for (const part of m[1].split(/[\s_-]+/)) {
      for (const w of part.replace(/([a-z])([A-Z])/g, '$1 $2').split(' ')) if (w) out.add(fold(w));
    }
  }
  return out;
}
function sourceContent() {
  const lines = new Set<string>();
  const dishWords = new Set<string>();
  const prices = new Set<string>();
  const brand = new Set<string>();
  // v2 (welcome / announcement / information) sources.
  const shownLines = new Set<string>();
  const names = new Set<string>();
  const times = new Set<string>();
  for (const src of REFERENCES) {
    const raw = readSource(src);
    for (const m of raw.matchAll(/\$\d+(?:\.\d\d)?/g)) prices.add(m[0]);
    for (const t of src.brandTokens || []) {
      brand.add(fold(t));
      brand.add(fold(t).replace(/ /g, ''));
      brand.add(fold(t).replace(/ /g, '-'));
    }
    const $ = cheerio.load(raw);
    // Scripts, styles and the theme-token block are code and config, not content.
    $('script, style, noscript, template, .theme-data, [data-widget="theme"]').remove();
    $('body *')
      .contents()
      .each((_i, n) => {
        if ((n.type as string) !== 'text') return;
        const text = $(n).text().replace(/\s+/g, ' ').trim();
        if (!text) return;
        const field = $(n).parent().closest('[data-field]').attr('data-field') || '';
        for (const m of text.matchAll(/\b\d{1,2}:\d\d\b/g)) if (/[1-9]/.test(m[0])) times.add(m[0]);
        if (src.neutralizer === 2) {
          const words = wordsOf(text);
          // A line made only of placeholder words ("Class", "Today's label") is
          // indistinguishable from a placeholder — it cannot be content.
          if ((text.match(/\p{L}/gu) || []).length >= 4 && words.some((w) => !VOCAB.has(w))) shownLines.add(text);
          if (builder.NAME_ROLES.has(builder.roleOfKey(field, src as { roles?: unknown[] }, text))) {
            for (const w of words) if (w.length >= 3 && !VOCAB.has(w)) names.add(w);
          }
          return;
        }
        if ((text.match(/\p{L}/gu) || []).length < 4) return; // 01 · 02 / 03 · #1 · ✹ stay
        lines.add(text);
        if (/^(item|combo)\.\d+\./.test(field)) for (const w of fold(text).match(/[a-z]{5,}/g) || []) dishWords.add(w);
      });
    $('[data-seed]').each((_i, el) => {
      lines.add(String($(el).attr('data-seed')));
    });
    if (src.neutralizer === 2) for (const t of src.brandTokens || []) for (const w of wordsOf(t)) if (!VOCAB.has(w)) names.add(w);
  }
  return { lines, dishWords, prices, brand, shownLines, names, times };
}
const CONTENT = sourceContent();
/**
 * The menu boards' check, over any text (the whole generated file included):
 * their lines, prices and every source's brand spellings. `dishWords` (menu
 * words ≥ 5 letters, class names included) runs over the MENU boards' html
 * only — a welcome board's own `.chips` / `.plate` classes are its markup, not
 * a dish; its text is held to the placeholder words instead (shownLeaks).
 */
function leaks(text: string, opts: { dishWords?: boolean } = {}): string[] {
  const hay = fold(text);
  const words = new Set(hay.match(/[a-z]+/g) || []);
  // A dish word that is also an HTML tag in this text ("street-style" vs
  // <style>) is markup, not content. Class names are NOT exempt: a class like
  // `mode-burritos` is exactly the kind of leak this catches.
  const tags = new Set(Array.from(hay.matchAll(/<\/?([a-z][a-z0-9]*)/g), (m) => m[1]));
  const found: string[] = [];
  for (const l of CONTENT.lines) if (hay.includes(fold(l))) found.push(`line: ${l}`);
  if (opts.dishWords !== false) for (const w of CONTENT.dishWords) if (words.has(w) && !tags.has(w)) found.push(`word: ${w}`);
  for (const p of CONTENT.prices) if (!/^\$0+(\.00)?$/.test(p) && text.includes(p)) found.push(`price: ${p}`);
  for (const b of CONTENT.brand) if (hay.includes(b)) found.push(`brand: ${b}`);
  return found;
}
/** The menu / offer boards (the v1 neutralizer), as one text. */
const MENU_HTML = DESIGNER_EXEMPLARS.filter((e) => sourceOf(e)?.neutralizer !== 2)
  .map((e) => e.html)
  .join('\n');
/** The welcome / announcement / information leak check, per board. */
function shownLeaks(html: string): string[] {
  const shown = shownText(html);
  const flat = ` ${shown.map((t) => wordsOf(t).join(' ')).join(' | ')} `;
  const tokens = markupTokens(html);
  const found: string[] = [];
  for (const l of CONTENT.shownLines) {
    const w = wordsOf(l).join(' ');
    if (w && flat.includes(` ${w} `)) found.push(`line: ${l}`);
  }
  for (const n of CONTENT.names) if (flat.includes(` ${n} `) || tokens.has(n)) found.push(`name: ${n}`);
  for (const t of CONTENT.times) if (shown.some((s) => new RegExp(`(^|[^\\d])${t.replace(':', '\\:')}($|[^\\d])`).test(s))) found.push(`time: ${t}`);
  for (const s of shown) for (const w of wordsOf(s)) if (!VOCAB.has(w)) found.push(`not a placeholder: ${w}`);
  return [...new Set(found)];
}

describe('no business content on a reference board', () => {
  const generated = fs.readFileSync(GENERATED, 'utf8');

  it('derives a real leak list from the source boards (the check is not vacuous)', () => {
    expect(CONTENT.lines.size).toBeGreaterThan(40);
    expect(CONTENT.dishWords.size).toBeGreaterThan(30);
    expect(CONTENT.prices.size).toBeGreaterThan(5);
    expect([...CONTENT.brand]).toEqual(expect.arrayContaining(['super taco', 'supertaco', 'super-taco']));
    // The welcome boards: their lines, the member / coach / venue names, the class times.
    expect(CONTENT.shownLines.size).toBeGreaterThan(40);
    expect([...CONTENT.names]).toEqual(expect.arrayContaining(['ironworks', 'jordan', 'maya', 'yoga', 'field', 'form']));
    expect([...CONTENT.times]).toEqual(expect.arrayContaining(['7:42', '6:00', '5:30', '9:42']));
    expect(VOCAB.size).toBeGreaterThan(50);
  });

  it('not one brand spelling, source line or price appears anywhere in designer-exemplars.generated.ts, nor a dish word on a menu board', () => {
    expect(leaks(generated, { dishWords: false })).toEqual([]);
    expect(MENU_HTML.length).toBeGreaterThan(30000);
    expect(leaks(MENU_HTML)).toEqual([]);
  });

  it.each(DESIGNER_EXEMPLARS.map((e) => [e.id, e] as [string, DesignerExemplar]))(
    '%s shows only placeholder words — no source line, name, time — in its text, attributes, CSS content or class names',
    (_id, e) => {
      expect(shownLeaks(e.html)).toEqual([]);
    },
  );

  it('NEGATIVE CONTROL: restoring one real dish name, price or the wordmark is caught', () => {
    const name = [...CONTENT.lines].find((l) => /burrito/i.test(l) && !/·/.test(l))!;
    expect(name).toBeTruthy();
    expect(MENU_HTML).toContain('Menu Item One');
    expect(leaks(MENU_HTML.replace('Menu Item One', name)).length).toBeGreaterThan(0);
    expect(leaks(MENU_HTML.replace('$00.00', [...CONTENT.prices].find((p) => p !== '$0.00')!))).toEqual([expect.stringMatching(/^price: /)]);
    expect(leaks(MENU_HTML.replace('VENUE NAME', 'SUPER TACO'))).toEqual(expect.arrayContaining(['brand: super taco']));
    // …and a content word hiding in a class name (the source's `mode-burritos`).
    expect(MENU_HTML).toContain('mode-menu');
    expect(leaks(MENU_HTML.replace(/mode-menu/g, 'mode-burritos'))).toEqual(['line: Burritos']);
    // The whole-file pass catches a brand or a price on ANY board.
    expect(leaks(generated.replace('Venue Name Here', 'Ironworks Here'), { dishWords: false })).toEqual(['brand: ironworks']);
  });

  it('NEGATIVE CONTROL: restoring a real person, venue, time, line or class name on a welcome board is caught', () => {
    const hero = DESIGNER_EXEMPLARS.find((e) => e.id === 'welcome-name-hero')!.html;
    const scene = DESIGNER_EXEMPLARS.find((e) => e.id === 'welcome-scene')!.html;
    expect(shownLeaks(hero)).toEqual([]);
    expect(hero).toContain('>Guest<');
    expect(shownLeaks(hero.replace('>Guest<', '>Jordan<'))).toEqual(expect.arrayContaining(['name: jordan']));
    expect(hero).toContain('>Staff Name<');
    expect(shownLeaks(hero.replace('>Staff Name<', '>Coach Maya<'))).toEqual(expect.arrayContaining(['name: maya']));
    expect(hero).toContain('>0:00 PM<');
    expect(shownLeaks(hero.replace('>0:00 PM<', '>7:42 PM<'))).toEqual(['time: 7:42']);
    expect(shownLeaks(hero.replace('>Short label<', '>Your trainer<'))).toEqual(
      expect.arrayContaining(['line: Your trainer', 'not a placeholder: trainer']),
    );
    // A name in a class name, and in an attribute the board shows.
    expect(shownLeaks(hero.replace('class="stage"', 'class="stage ironworks-stage"'))).toEqual(['name: ironworks']);
    expect(shownLeaks(scene.replace('aria-label="Label"', 'aria-label="Field Form"'))).toEqual(
      expect.arrayContaining(['name: field', 'name: form']),
    );
  });

  it('every price is a zero placeholder and every photo is an empty frame', () => {
    for (const e of DESIGNER_EXEMPLARS) {
      for (const m of e.html.matchAll(/[$€£]\s?\d[\d.,]*/g)) expect(m[0]).toMatch(/^\$0+\.00$/);
      expect(e.html).not.toMatch(/<img[^>]*\ssrc=|url\(/i);
      if (e.priced) expect(e.html).toMatch(/data-imgslot="item\.0\.image"/);
    }
  });

  it("the placeholders keep each line's length and the board's own numbers", () => {
    const src = { brandTokens: ['super taco', 'supertaco'] };
    expect(builder.placeholderFor('SUPER TACO', '', 0, src)).toBe('VENUE NAME');
    expect(builder.placeholderFor('$14.50', 'item.0.price', 0, src)).toBe('$00.00');
    expect(builder.placeholderFor('$4.95', 'item.4.price', 0, src)).toBe('$0.00');
    expect(builder.placeholderFor('02 / 03', 'rail.number', 0, src)).toBe('02 / 03');
    expect(builder.placeholderFor('Menu Wall · 02 / 03', 'header.series', 0, src)).toMatch(/^[A-Z][a-z]+(?: [A-Z][a-z]+)? · 02 \/ 03$/);
    expect(builder.placeholderFor('Supertacomex.com', 'footer.right', 0, src)).toBe('www.example.com');
    const name = builder.placeholderFor('Shredded Chicken Super Nachos', 'item.3.name', 0, src);
    expect(name).toMatch(/Four/);
    expect(Math.abs(name.length - 'Shredded Chicken Super Nachos'.length)).toBeLessThanOrEqual(4);
  });

  it('v2 placeholders: a role per field, digits zeroed in times and rooms, date words neutral, case kept, lengths kept', () => {
    const src = { brandTokens: ['ironworks'] };
    const v2 = (t: string, k: string, line = 0) => builder.placeholderV2(t, k, line, src);
    expect(v2('7:42 PM', 'clock.hhmm')).toBe('0:00 PM');
    expect(v2('7:50–8:42', 'period.0.time')).toBe('0:00–0:00');
    expect(v2('Coach Maya', 'trainer.name')).toBe('Staff Name');
    expect(v2('Jordan', 'hero.name')).toBe('Guest');
    expect(v2('Ironworks Fitness', 'brand.name')).toBe('Venue Name Here');
    expect(v2('Member since Jul 1', 'hero.since')).toBe('Short label Mth 0');
    expect(v2('Tuesday · July 22', 'clock.date')).toBe('Weekday · Month 00');
    expect(v2('Locker #114 assigned', 'checklist.0.t')).toBe('Detail #000 location');
    // A class name keeps its length: one letter longer is one more line in a squeezed column.
    expect(v2('Spin', 'classes.1.name')).toBe('Name');
    expect(v2('Yoga Flow', 'classes.2.name')).toBe('Class One');
    expect(v2('HIIT 45', 'classes.0.name')).toBe('NAME 00');
    // Furniture stays.
    expect(v2('01', 'hero.index')).toBe('01');
    expect(v2('02 / 03', 'rail.number')).toBe('02 / 03');
  });
});

describe('what the model is shown', () => {
  const each = DESIGNER_EXEMPLARS.map((e) => [e.id, e] as [string, DesignerExemplar]);

  it.each(each)('%s carries no script and no injected runtime', (_id, e) => {
    expect(e.html).not.toMatch(/<script/i);
    expect(e.html).not.toMatch(/EDUCMS-|VOS-FIT-ENGINE|_edit-shim|educms-overrides/);
    expect(e.strippedRuntimes.length).toBeGreaterThan(0); // the source really had one
  });

  it.each(each)('%s passes the Designer sanitizer untouched and is LED-safe', (_id, e) => {
    const { html, taurusWarnings } = sanitizeDesignerHtml(e.html);
    expect(taurusWarnings).toEqual([]);
    expect(auditDesignerHtmlTaurus(e.html)).toEqual([]);
    expect(html).toBe(e.html);
  });

  it.each(each)('%s uses only fonts the Designer may use, and loads them', (_id, e) => {
    const quoted = Array.from(e.html.matchAll(/'([A-Z][A-Za-z0-9 ]+)'/g), (m) => m[1]);
    expect(quoted.length).toBeGreaterThan(0);
    for (const fam of quoted) expect(DESIGNER_FONTS as readonly string[]).toContain(fam);
    expect(e.html).not.toMatch(/Impact|Georgia|Arial|Helvetica|Manrope|DM Mono|DM Sans|Instrument Serif|Nunito(?! Sans)/);
    for (const fam of new Set(quoted)) expect(e.html).toContain(`family=${fam.replace(/ /g, '+')}`);
  });

  it.each(each)('%s sets no type under the size floor of its own canvas (52 px at 4K, 26 px at 1080p)', (_id, e) => {
    const floor = designerSizeFloor(e.width, e.height).caption;
    expect(floor).toBe(Math.min(e.width, e.height) >= 2160 ? 52 : 26);
    const css = /<style>([\s\S]*?)<\/style>/.exec(e.html)![1];
    const sizes: string[] = [];
    const walk = (list: ReturnType<typeof builder.splitStatements>) => {
      for (const s of list) {
        if (s.kind === 'at' && /^@(media|supports)/.test(s.prelude || '')) walk(builder.splitStatements(s.body || ''));
        if (s.kind !== 'rule') continue;
        for (const d of builder.splitDecls(s.body || '')) {
          if (d.prop === 'font-size') sizes.push(d.value);
          if (d.prop === 'font') {
            const m = /(calc\([^)]*\)\)?|\d+(?:\.\d+)?px)(?:\/\S+)?\s/.exec(d.value);
            if (m) sizes.push(m[1]);
          }
        }
      }
    };
    walk(builder.splitStatements(css));
    expect(sizes.length).toBeGreaterThan(10);
    for (const size of sizes) {
      const px = /(\d+(?:\.\d+)?)px/.exec(size);
      if (px) expect(Number(px[1])).toBeGreaterThanOrEqual(floor);
    }
  });

  it('the floor lift raises only the two shapes the boards use, and only below the floor', () => {
    expect(builder.liftSize('42px', 52)).toBe('52px');
    expect(builder.liftSize('calc(46px * var(--type-scale))', 52)).toBe('calc(52px * var(--type-scale))');
    expect(builder.liftSize('60px', 52)).toBe('60px');
    expect(builder.liftSize('1.2em', 52)).toBe('1.2em');
  });

  it.each(each)('%s has no asset path that only resolves inside apps/web/public', (_id, e) => {
    expect(e.html).not.toMatch(/\/templates\/|assets\/|url\(\s*['"]?\//);
  });

  it.each(each)('%s opens <body> with its fixed-size stage, the board canvas, that the platform scales', (_id, e) => {
    const src = sourceOf(e)!;
    const $ = cheerio.load(e.html);
    expect($('body').children().first().is(src.stage!)).toBe(true);
    const css = /<style>([\s\S]*?)<\/style>/.exec(e.html)![1];
    const rules = builder.splitStatements(css).filter((s) => s.kind === 'rule');
    const decl = (r: { body?: string }, prop: string) => builder.splitDecls(r.body || '').find((d) => d.prop === prop)?.value;
    const own = rules.filter((r) => builder.splitSelectors(r.selector || '').includes(src.stage!));
    expect(own.some((r) => decl(r, 'position') === 'relative')).toBe(true);
    for (const r of own) expect(decl(r, 'transform')).toBeUndefined();
    // Its size: the stage rule, or in portrait the rule the board's portrait flag scopes to it.
    const flagged =
      e.orientation === 'portrait'
        ? rules.filter((r) =>
            builder.splitSelectors(r.selector || '').some((sel) => src.portrait!.prefixes.some((p) => sel.startsWith(p) && sel.slice(p.length).trim() === src.stage)),
          )
        : [];
    let w: string | undefined;
    let h: string | undefined;
    for (const r of flagged.length ? flagged : own) {
      w = decl(r, 'width') ?? w;
      h = decl(r, 'height') ?? h;
    }
    expect([w, h]).toEqual([`${e.width}px`, `${e.height}px`]);
    // No self-scaling left behind (the stage's own rules carry no transform, above).
    expect(e.html).not.toMatch(/--stage-scale/);
  });

  it.each(each)('%s follows the row contract: data-menu-row="N" around item.N.* fields, no data-seed', (_id, e) => {
    const rows = Array.from(e.html.matchAll(/data-menu-row="(\d+)"/g), (m) => m[1]);
    expect(rows.length).toBe(e.itemCount);
    expect(rows).toEqual(rows.map((_v, i) => String(i)));
    for (const n of rows) {
      expect(e.html).toContain(`data-field="item.${n}.name"`);
      expect(e.html).toContain(`data-field="item.${n}.price"`);
    }
    expect(e.html).not.toMatch(/data-seed|data-pos-item|data-img="|combo\.\d/);
  });

  it.each(each)("%s carries only Designer attributes — no other runtime's config for the model to copy", (_id, e) => {
    const allowed = new Set(['data-field', 'data-imgslot', 'data-menu-row', 'data-fit', 'data-fit-min', 'data-fit-max', 'data-fit-col', 'data-action']);
    // …plus, on a portrait variant, the board's own static orientation flag
    // (the menu boards set a class; the gym boards `data-orient`).
    const flag = e.orientation === 'portrait' ? sourceOf(e)!.portrait?.flag?.attr?.[0] : undefined;
    if (flag) allowed.add(flag);
    const attrs = new Set(Array.from(e.html.matchAll(/\s(data-[\w-]+)(?==|[\s>])/g), (m) => m[1]));
    for (const a of attrs) expect(allowed).toContain(a);
  });
});

describe('selectDesignerExemplars', () => {
  const menu = designerStructuresFor('menu');

  it("puts the candidate's own layout first and a DIFFERENT one second", () => {
    for (const st of menu.slice(0, 2)) {
      const got = selectDesignerExemplars({ purpose: 'menu', orientation: 'landscape', structureId: st.id });
      expect(got).toHaveLength(2);
      expect(got[0].structure).toBe(st.id);
      expect(got[1].structure).not.toBe(st.id);
    }
  });

  it('gives the three candidates of a batch three different primaries where the library allows', () => {
    const primaries = menu.map((st) => selectDesignerExemplars({ purpose: 'menu', orientation: 'landscape', structureId: st.id })[0].id);
    expect(primaries[0]).not.toBe(primaries[1]);
  });

  it('has no brand input: every venue — the one a board was first made for included — gets two references', () => {
    // A Super Taco request used to get NONE (its own wall was excluded). The
    // boards carry placeholders now, so there is nothing to exclude.
    const got = selectDesignerExemplars({ purpose: 'menu', orientation: 'landscape', structureId: 'rail-cards' });
    expect(got.map((e) => e.id)).toEqual(['menu-rail-cards', 'menu-hero-cards']);
  });

  it("matches the request's orientation", () => {
    const port = selectDesignerExemplars({ purpose: 'menu', orientation: 'portrait', structureId: 'hero-cards' });
    expect(port.every((e) => e.orientation === 'portrait')).toBe(true);
    const land = selectDesignerExemplars({ purpose: 'menu', orientation: 'landscape', structureId: 'hero-cards' });
    expect(land.every((e) => e.orientation === 'landscape')).toBe(true);
  });

  it('an offer gets the approved offer board; welcome gets its boards in both orientations; event stays EMPTY (nothing approved)', () => {
    const offer = selectDesignerExemplars({ purpose: 'offer', orientation: 'landscape', structureId: 'split-offer' });
    expect(offer.map((e) => e.structure)).toEqual(['split-offer']);
    for (const orientation of ['landscape', 'portrait'] as const) {
      expect(selectDesignerExemplars({ purpose: 'welcome', orientation, max: 3 }).map((e) => e.structure).sort()).toEqual([
        'name-hero',
        'scene',
        'split-welcome',
      ]);
      expect(selectDesignerExemplars({ purpose: 'event', orientation, max: 3 })).toEqual([]);
    }
  });

  it('respects max and prefers boards whose PRIMARY purpose matches', () => {
    expect(selectDesignerExemplars({ purpose: 'menu', orientation: 'landscape', max: 1 })).toHaveLength(1);
    // With no structure preference, a true menu board comes before the offer board that also lists menu.
    const two = selectDesignerExemplars({ purpose: 'menu', orientation: 'landscape', structureId: 'leader-rows' });
    expect(two.every((e) => e.purposes[0] === 'menu')).toBe(true);
  });

  it('is deterministic', () => {
    const a = selectDesignerExemplars({ purpose: 'menu', orientation: 'landscape', structureId: 'leader-rows', itemCount: 21 }).map((e) => e.id);
    const b = selectDesignerExemplars({ purpose: 'menu', orientation: 'landscape', structureId: 'leader-rows', itemCount: 21 }).map((e) => e.id);
    expect(a).toEqual(b);
  });
});

describe("selectDesignerExemplars — the request's own venue type", () => {
  const ORIENTATIONS = ['landscape', 'portrait'] as const;
  const STRUCTURE_IDS = [undefined, ...Object.values(DESIGNER_STRUCTURES).flatMap((list) => list.map((s) => s.id))];
  /** The selector as it was before venue types (master 6823f580), for the pin below. */
  function beforeVenueTypes(input: SelectDesignerExemplarsInput, pool: readonly DesignerExemplar[]): string[] {
    const max = Math.max(0, Math.min(input.max ?? 2, 3));
    const items = Math.max(0, input.itemCount ?? 0);
    const eligible = pool.filter((e) => e.purposes.includes(input.purpose));
    if (!eligible.length || !max) return [];
    const byStructure = new Map<string, DesignerExemplar>();
    for (const e of eligible) {
      const cur = byStructure.get(e.structure);
      if (!cur || (cur.orientation !== input.orientation && e.orientation === input.orientation)) byStructure.set(e.structure, e);
    }
    const lead = (e: DesignerExemplar) => (e.purposes[0] === input.purpose ? 0 : 1);
    return [...byStructure.values()]
      .sort(
        (a, b) =>
          Number(b.structure === input.structureId) - Number(a.structure === input.structureId) ||
          lead(a) - lead(b) ||
          Math.abs(a.itemCount - items) - Math.abs(b.itemCount - items) ||
          a.id.localeCompare(b.id),
      )
      .slice(0, max)
      .map((e) => e.id);
  }
  // A K-12 lunch board, kept to schools, in a structure the food boards also
  // have (hero-cards) and in one they lack (leader-rows) — the hardest cases.
  const lunch = (id: string, structure: string): DesignerExemplar => ({
    ...DESIGNER_EXEMPLARS.find((e) => e.id === 'menu-hero-cards')!,
    id,
    structure,
    verticals: ['school'],
    verticalOnly: true,
    priced: false,
  });
  const POOL = [...DESIGNER_EXEMPLARS, lunch('k12-lunch-hero', 'hero-cards'), lunch('k12-lunch-rows', 'leader-rows')];

  it('tags every board with a family designerVerticalFamily really returns, and keeps only the school boards to their own type', () => {
    const families = new Set(VERTICALS.map((v) => designerVerticalFamily(v).toLowerCase()));
    expect([...families]).toEqual(expect.arrayContaining(['food', 'school', 'fitness', 'retail']));
    for (const e of DESIGNER_EXEMPLARS) {
      expect(e.verticals?.length).toBeGreaterThan(0);
      for (const v of e.verticals!) expect(['food', 'school', 'fitness', 'retail']).toContain(v);
      expect(!!e.verticalOnly).toBe(e.verticals!.includes('school'));
    }
    expect(exemplarFamilyFor('QSR')).toBe('food');
    expect(exemplarFamilyFor('restaurant')).toBe('food');
    expect(exemplarFamilyFor('K12')).toBe('school');
    expect(exemplarFamilyFor('SPORTS')).toBe('school');
    expect(exemplarFamilyFor('GYM')).toBe('fitness');
    expect(exemplarFamilyFor('FASHION')).toBe('retail');
    expect(exemplarFamilyFor('WORSHIP')).toBe('worship');
    expect(exemplarFamilyFor(undefined)).toBe('');
    expect(exemplarFamilyFor('  ')).toBe('');
    const taco = DESIGNER_EXEMPLARS.find((e) => e.id === 'menu-hero-cards')!;
    expect([exemplarTier(taco, 'food'), exemplarTier(taco, 'school'), exemplarTier(taco, '')]).toEqual([0, 1, 1]);
    expect([exemplarTier(POOL[POOL.length - 1], 'school'), exemplarTier(POOL[POOL.length - 1], 'food')]).toEqual([0, 2]);
    expect(exemplarTier({ ...taco, verticals: undefined }, 'food')).toBe(0);
  });

  it("a caller passing no vertical gets today's result: menu and offer exactly as before venue types, on the old six boards", () => {
    const OLD_SIX = DESIGNER_EXEMPLARS.filter((e) => e.priced);
    expect(OLD_SIX).toHaveLength(6);
    let compared = 0;
    for (const purpose of ['menu', 'offer'] as const)
      for (const orientation of ORIENTATIONS)
        for (const structureId of STRUCTURE_IDS)
          for (const itemCount of [0, 1, 6, 21])
            for (const max of [1, 2, 3]) {
              const input = { purpose, orientation, structureId, itemCount, max };
              const want = beforeVenueTypes(input, OLD_SIX);
              expect(selectDesignerExemplars(input).map((e) => e.id)).toEqual(want);
              expect(selectDesignerExemplars({ ...input, pool: POOL }).map((e) => e.id)).toEqual(want);
              expect(selectDesignerExemplars({ ...input, vertical: null }).map((e) => e.id)).toEqual(want);
              compared++;
            }
    expect(compared).toBeGreaterThan(200);
  });

  it('a taqueria (or any restaurant) never sees a school lunch board — not even for a layout only the school board has', () => {
    for (const vertical of ['QSR', 'RESTAURANT', 'BAR', 'HOSPITALITY', undefined])
      for (const orientation of ORIENTATIONS)
        for (const structureId of STRUCTURE_IDS)
          for (const max of [1, 2, 3]) {
            const got = selectDesignerExemplars({ purpose: 'menu', orientation, structureId, max, vertical, pool: POOL });
            expect(got.length).toBeGreaterThan(0);
            expect(got.some((e) => e.verticals?.includes('school'))).toBe(false);
          }
  });

  it("a school menu gets the school's own boards first, and a food board only for a layout the school boards lack", () => {
    const got = selectDesignerExemplars({ purpose: 'menu', orientation: 'landscape', max: 3, vertical: 'K12', pool: POOL });
    expect(got.map((e) => e.id)).toEqual(['k12-lunch-hero', 'k12-lunch-rows', 'menu-rail-cards']);
    const own = selectDesignerExemplars({ purpose: 'menu', orientation: 'landscape', structureId: 'hero-cards', vertical: 'K12', pool: POOL });
    expect(own[0].id).toBe('k12-lunch-hero');
  });

  it('a board kept to its own venue type reaches another type only when the purpose has nothing else', () => {
    const onlySchool = POOL.filter((e) => e.verticals?.includes('school'));
    const got = selectDesignerExemplars({ purpose: 'menu', orientation: 'landscape', max: 3, vertical: 'QSR', pool: onlySchool });
    expect(got.map((e) => e.id).sort()).toEqual(['k12-lunch-hero', 'k12-lunch-rows']);
  });

  it("a gym welcome gets the gym boards first, then the retail scene; a store's welcome leads with its own scene", () => {
    for (const vertical of ['GYM', 'FITNESS']) {
      const got = selectDesignerExemplars({ purpose: 'welcome', orientation: 'landscape', max: 3, vertical });
      expect(got.map((e) => e.id)).toEqual(['welcome-name-hero', 'welcome-split', 'welcome-scene']);
    }
    const store = selectDesignerExemplars({ purpose: 'welcome', orientation: 'landscape', max: 3, vertical: 'RETAIL' });
    expect(store.map((e) => e.id)).toEqual(['welcome-scene', 'welcome-name-hero', 'welcome-split']);
    // A portrait gym request still learns from the split board (landscape only).
    const port = selectDesignerExemplars({ purpose: 'welcome', orientation: 'portrait', max: 3, vertical: 'GYM' });
    expect(port.map((e) => e.id)).toEqual(['welcome-name-hero-portrait', 'welcome-split', 'welcome-scene-portrait']);
  });

  it('keeps the candidate-structure rule above the venue rule, and one board per structure', () => {
    const got = selectDesignerExemplars({ purpose: 'welcome', orientation: 'landscape', structureId: 'scene', max: 3, vertical: 'GYM' });
    expect(got.map((e) => e.structure)).toEqual(['scene', 'name-hero', 'split-welcome']);
    for (const vertical of ['GYM', 'RETAIL', 'K12', 'QSR', undefined])
      for (const purpose of DESIGNER_PURPOSES)
        for (const orientation of ORIENTATIONS) {
          const list = selectDesignerExemplars({ purpose, orientation, max: 3, vertical, pool: POOL });
          expect(new Set(list.map((e) => e.structure)).size).toBe(list.length);
        }
  });

  it('designer-prompt.ts and this module import each other at CALL time only — either load order works', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ex = require('./designer-exemplars') as typeof import('./designer-exemplars');
      expect(ex.exemplarFamilyFor('QSR')).toBe('food');
      expect(ex.selectDesignerExemplars({ purpose: 'welcome', orientation: 'landscape', vertical: 'GYM' })[0].id).toBe('welcome-name-hero');
    });
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const prompt = require('./designer-prompt') as typeof import('./designer-prompt');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ex = require('./designer-exemplars') as typeof import('./designer-exemplars');
      expect(prompt.designerVerticalFamily('K12')).toBe('school');
      expect(ex.exemplarFamilyFor('K12')).toBe('school');
    });
  });
});

describe('structures', () => {
  it('every reference names a structure of its lead purpose, and every structure id is unique', () => {
    for (const e of DESIGNER_EXEMPLARS) expect(DESIGNER_STRUCTURES[e.purposes[0]].map((s) => s.id)).toContain(e.structure);
    const ids = Object.values(DESIGNER_STRUCTURES).flatMap((list) => list.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('schedule and directory are announcement-family, APPENDED — the three layouts a batch builds are unchanged', () => {
    expect(DESIGNER_STRUCTURES.announcement.map((s) => s.id)).toEqual(['headline-split', 'poster', 'bulletin', 'schedule', 'directory']);
    expect(designerStructuresFor('announcement', 3).map((s) => s.id)).toEqual(['headline-split', 'poster', 'bulletin']);
    for (const p of DESIGNER_PURPOSES as readonly DesignerPurpose[]) expect(designerStructuresFor(p).length).toBe(3);
  });
});

describe('formatExemplarsForPrompt', () => {
  it('says the boards carry placeholders, and names each by layout — never by a business', () => {
    const got = selectDesignerExemplars({ purpose: 'menu', orientation: 'landscape', structureId: 'rail-cards' });
    const text = formatExemplarsForPrompt(got);
    expect(text.startsWith('REFERENCE BOARDS')).toBe(true);
    expect(text).toMatch(/Every word, price and photo on them is a placeholder \(VENUE NAME, Menu Item One, \$0\.00, empty photo frames\)/);
    expect(text).toMatch(/none of it goes on this board/);
    expect(text).toContain('Reference 1 — Menu board — photo rail + dish cards (one screen of a three-screen wall). 3840×2160 landscape, rail + cards layout, 6 items.');
    expect(leaks(text)).toEqual([]);
    expect(formatExemplarsForPrompt([])).toBe('');
  });

  it('labels a 1080p reference with its own canvas, so the model scales it', () => {
    const text = formatExemplarsForPrompt(selectDesignerExemplars({ purpose: 'welcome', orientation: 'landscape', vertical: 'RETAIL', max: 1 }));
    expect(text).toContain('1920×1080 landscape, scene layout.');
    expect(shownLeaks(text.slice(text.indexOf('<!doctype')))).toEqual([]);
  });
});
