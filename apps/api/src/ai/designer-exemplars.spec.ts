/**
 * The AI Designer's reference boards (2026-09-22, AI Designer rework).
 *
 * Four things are pinned here:
 *   1. FRESHNESS — designer-exemplars.generated.ts is exactly what
 *      apps/api/scripts/build-designer-exemplars.cjs produces from the CURRENT
 *      approved boards (with a negative control: a tampered copy fails the
 *      builder's own --check).
 *   2. NO BUSINESS CONTENT — not one line, dish word, price or brand spelling
 *      from the source boards survives into the generated file: every word,
 *      price and photo is a placeholder (negative control: restoring one real
 *      dish name, price or the wordmark is caught).
 *   3. WHAT THE MODEL IS SHOWN — no script, no injected runtime, no asset path
 *      that only resolves inside apps/web/public, fonts from the loaded list,
 *      LED-safe CSS, no type under the size floor, the row contract, the stage
 *      the platform scales.
 *   4. SELECTION — per purpose, the candidate's own layout first, the request's
 *      orientation, and the same references for every venue.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as cheerio from 'cheerio';
import {
  DESIGNER_EXEMPLARS,
  formatExemplarsForPrompt,
  selectDesignerExemplars,
  type DesignerExemplar,
} from './designer-exemplars';
import { DESIGNER_FONTS, auditDesignerHtmlTaurus, sanitizeDesignerHtml, designerStructuresFor, designerSizeFloor } from './designer-prompt';

const API_ROOT = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(API_ROOT, '..', '..');
const BUILDER = path.join(API_ROOT, 'scripts', 'build-designer-exemplars.cjs');
const GENERATED = path.join(__dirname, 'designer-exemplars.generated.ts');

interface BuilderSource {
  status: 'reference' | 'candidate';
  id: string;
  file: string;
  brandTokens?: string[];
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const builder = require(BUILDER) as {
  render(): string;
  SOURCES: BuilderSource[];
  splitStatements(css: string): Array<{ kind: string; selector?: string; prelude?: string; body?: string }>;
  splitDecls(body: string): Array<{ prop: string; value: string }>;
  liftSize(size: string, floor: number): string;
  placeholderFor(text: string, key: string, line: number, src: { brandTokens: string[] }): string;
};
const REFERENCES = builder.SOURCES.filter((s) => s.status === 'reference');
const sourceOf = (e: DesignerExemplar) => REFERENCES.find((s) => e.id === s.id || e.id === `${s.id}-portrait`);

describe('designer-exemplars.generated.ts — freshness', () => {
  it('is exactly what the builder produces from the current boards', () => {
    expect(fs.readFileSync(GENERATED, 'utf8')).toBe(builder.render());
  });

  it('the builder\'s --check passes on the committed file and FAILS on a tampered copy (negative control)', () => {
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
  });

  it('every reference records its approval, and SOURCES names the board it came from (hash-checked)', () => {
    expect(DESIGNER_EXEMPLARS.length).toBeGreaterThan(0);
    for (const e of DESIGNER_EXEMPLARS) {
      expect(e.approval).toMatch(/\S/);
      const src = sourceOf(e);
      expect(src).toBeDefined();
      const raw = fs.readFileSync(path.join(REPO_ROOT, src!.file), 'utf8');
      expect(e.sourceSha256).toBe(crypto.createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 16));
    }
  });

  it('compiles only approved references — held-back candidates never reach the model', () => {
    const want = REFERENCES.flatMap((s) => [s.id, `${s.id}-portrait`]).sort();
    expect(DESIGNER_EXEMPLARS.map((e) => e.id).sort()).toEqual(want);
    for (const c of builder.SOURCES.filter((s) => s.status === 'candidate')) {
      expect(DESIGNER_EXEMPLARS.some((e) => e.id.startsWith(c.id))).toBe(false);
    }
  });
});

// ── 2. No business content ──────────────────────────────────────────────────
// What a leak looks like is derived from the SOURCE boards themselves, so a new
// dish Codex adds to one of them is covered the day it lands.
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function sourceContent() {
  const lines = new Set<string>();
  const dishWords = new Set<string>();
  const prices = new Set<string>();
  const brand = new Set<string>();
  for (const src of REFERENCES) {
    const raw = fs.readFileSync(path.join(REPO_ROOT, src.file), 'utf8');
    for (const m of raw.matchAll(/\$\d+(?:\.\d\d)?/g)) prices.add(m[0]);
    for (const t of src.brandTokens || []) {
      brand.add(fold(t));
      brand.add(fold(t).replace(/ /g, ''));
      brand.add(fold(t).replace(/ /g, '-'));
    }
    const $ = cheerio.load(raw);
    // Scripts, styles and the theme-token block are code and config, not content.
    $('script, style, noscript, template, .theme-data, [data-widget="theme"]').remove();
    $('body *').contents().each((_i, n) => {
      if ((n.type as string) !== 'text') return;
      const text = $(n).text().replace(/\s+/g, ' ').trim();
      if ((text.match(/\p{L}/gu) || []).length < 4) return; // 01 · 02 / 03 · #1 · ✹ stay
      lines.add(text);
      const field = $(n).parent().closest('[data-field]').attr('data-field') || '';
      if (/^(item|combo)\.\d+\./.test(field)) for (const w of fold(text).match(/[a-z]{5,}/g) || []) dishWords.add(w);
    });
    $('[data-seed]').each((_i, el) => { lines.add(String($(el).attr('data-seed'))); });
  }
  return { lines, dishWords, prices, brand };
}
const CONTENT = sourceContent();
function leaks(text: string): string[] {
  const hay = fold(text);
  const words = new Set(hay.match(/[a-z]+/g) || []);
  // A dish word that is also an HTML tag in this text ("street-style" vs
  // <style>) is markup, not content. Class names are NOT exempt: a class like
  // `mode-burritos` is exactly the kind of leak this catches.
  const tags = new Set(Array.from(hay.matchAll(/<\/?([a-z][a-z0-9]*)/g), (m) => m[1]));
  const found: string[] = [];
  for (const l of CONTENT.lines) if (hay.includes(fold(l))) found.push(`line: ${l}`);
  for (const w of CONTENT.dishWords) if (words.has(w) && !tags.has(w)) found.push(`word: ${w}`);
  for (const p of CONTENT.prices) if (!/^\$0+(\.00)?$/.test(p) && text.includes(p)) found.push(`price: ${p}`);
  for (const b of CONTENT.brand) if (hay.includes(b)) found.push(`brand: ${b}`);
  return found;
}

describe('no business content on a reference board', () => {
  const generated = fs.readFileSync(GENERATED, 'utf8');

  it('derives a real leak list from the source boards (the check is not vacuous)', () => {
    expect(CONTENT.lines.size).toBeGreaterThan(40);
    expect(CONTENT.dishWords.size).toBeGreaterThan(30);
    expect(CONTENT.prices.size).toBeGreaterThan(5);
    expect([...CONTENT.brand]).toEqual(expect.arrayContaining(['super taco', 'supertaco', 'super-taco']));
  });

  it('not one brand spelling, source line, dish word or price appears anywhere in designer-exemplars.generated.ts', () => {
    expect(leaks(generated)).toEqual([]);
  });

  it('NEGATIVE CONTROL: restoring one real dish name, price or the wordmark is caught', () => {
    const name = [...CONTENT.lines].find((l) => /burrito/i.test(l) && !/·/.test(l))!;
    expect(name).toBeTruthy();
    expect(generated).toContain('Menu Item One');
    expect(leaks(generated.replace('Menu Item One', name)).length).toBeGreaterThan(0);
    expect(leaks(generated.replace('$00.00', [...CONTENT.prices].find((p) => p !== '$0.00')!))).toEqual([expect.stringMatching(/^price: /)]);
    expect(leaks(generated.replace('VENUE NAME', 'SUPER TACO'))).toEqual(expect.arrayContaining(['brand: super taco']));
    // …and a content word hiding in a class name (the source's `mode-burritos`).
    expect(generated).toContain('mode-menu');
    expect(leaks(generated.replace(/mode-menu/g, 'mode-burritos'))).toEqual(['line: Burritos']);
  });

  it('every price is a zero placeholder and every photo is an empty frame', () => {
    for (const e of DESIGNER_EXEMPLARS) {
      for (const m of e.html.matchAll(/[$€£]\s?\d[\d.,]*/g)) expect(m[0]).toMatch(/^\$0+\.00$/);
      expect(e.html).not.toMatch(/<img[^>]*\ssrc=|url\(/i);
      expect(e.html).toMatch(/data-imgslot="item\.0\.image"/);
    }
  });

  it('the placeholders keep each line\'s length and the board\'s own numbers', () => {
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
    expect(e.html).not.toMatch(/Impact|Georgia|Arial|Helvetica/);
    for (const fam of new Set(quoted)) expect(e.html).toContain(`family=${fam.replace(/ /g, '+')}`);
  });

  it.each(each)('%s sets no type under the size floor (the portrait labels were 42-46 px)', (_id, e) => {
    const floor = designerSizeFloor(e.width, e.height).caption;
    expect(floor).toBe(52);
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

  it.each(each)('%s opens <body> with the fixed-size stage the platform scales', (_id, e) => {
    const body = e.html.slice(e.html.indexOf('<body'));
    expect(body).toMatch(/^<body[^>]*><div class="stage[^"]*" id="stage"/);
    expect(e.html).toMatch(/\.stage\{position:relative;width:3840px;height:2160px/);
    if (e.orientation === 'portrait') expect(e.html).toMatch(/portrait \.stage\{width:2160px;height:3840px|body\.portrait \.stage\{width:2160px;height:3840px/);
    // No self-scaling left behind.
    expect(e.html).not.toMatch(/--stage-scale|transform:translate\(-50%,-50%\)/);
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
});

describe('selectDesignerExemplars', () => {
  const menu = designerStructuresFor('menu');

  it('puts the candidate\'s own layout first and a DIFFERENT one second', () => {
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

  it('matches the request\'s orientation', () => {
    const port = selectDesignerExemplars({ purpose: 'menu', orientation: 'portrait', structureId: 'hero-cards' });
    expect(port.every((e) => e.orientation === 'portrait')).toBe(true);
    const land = selectDesignerExemplars({ purpose: 'menu', orientation: 'landscape', structureId: 'hero-cards' });
    expect(land.every((e) => e.orientation === 'landscape')).toBe(true);
  });

  it('an offer gets the approved offer board; purposes with no approved board get none', () => {
    const offer = selectDesignerExemplars({ purpose: 'offer', orientation: 'landscape', structureId: 'split-offer' });
    expect(offer.map((e) => e.structure)).toEqual(['split-offer']);
    for (const purpose of ['welcome', 'event', 'announcement'] as const) {
      expect(selectDesignerExemplars({ purpose, orientation: 'landscape' })).toEqual([]);
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
});
