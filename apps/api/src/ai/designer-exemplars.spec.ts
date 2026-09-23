/**
 * The AI Designer's reference boards (2026-09-22, AI Designer rework).
 *
 * Three things are pinned here:
 *   1. FRESHNESS — designer-exemplars.generated.ts is exactly what
 *      apps/api/scripts/build-designer-exemplars.cjs produces from the CURRENT
 *      approved boards (with a negative control: a tampered copy fails the
 *      builder's own --check).
 *   2. WHAT THE MODEL IS SHOWN — no script, no injected runtime, no asset path
 *      that only resolves inside apps/web/public, fonts from the loaded list,
 *      LED-safe CSS, the row contract, the stage the platform scales.
 *   3. SELECTION — per purpose, the candidate's own layout first, never the
 *      target brand's own board, the request's orientation.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  DESIGNER_EXEMPLARS,
  exemplarIsTargetBrand,
  formatExemplarsForPrompt,
  selectDesignerExemplars,
  type DesignerExemplar,
} from './designer-exemplars';
import { DESIGNER_FONTS, auditDesignerHtmlTaurus, sanitizeDesignerHtml, designerStructuresFor } from './designer-prompt';

const API_ROOT = path.resolve(__dirname, '..', '..');
const BUILDER = path.join(API_ROOT, 'scripts', 'build-designer-exemplars.cjs');
const GENERATED = path.join(__dirname, 'designer-exemplars.generated.ts');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const builder = require(BUILDER) as { render(): string };

describe('designer-exemplars.generated.ts — freshness', () => {
  it('is exactly what the builder produces from the current boards', () => {
    expect(fs.readFileSync(GENERATED, 'utf8')).toBe(builder.render());
  });

  it('the builder\'s --check passes on the committed file and FAILS on a tampered copy (negative control)', () => {
    const run = (out: string) => {
      try {
        execFileSync(process.execPath, [BUILDER, '--check'], { env: { ...process.env, DESIGNER_EXEMPLARS_OUT: out }, stdio: 'pipe' });
        return 0;
      } catch (e: any) {
        return typeof e?.status === 'number' ? e.status : 1;
      }
    };
    expect(run(GENERATED)).toBe(0);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'designer-exemplars-'));
    const tampered = path.join(dir, 'designer-exemplars.generated.ts');
    fs.writeFileSync(tampered, fs.readFileSync(GENERATED, 'utf8').replace('$17.50', '$99.99'));
    expect(run(tampered)).toBe(1);
  });

  it('every reference records its approval and the board it came from', () => {
    expect(DESIGNER_EXEMPLARS.length).toBeGreaterThan(0);
    for (const e of DESIGNER_EXEMPLARS) {
      expect(e.approval).toMatch(/\S/);
      expect(fs.existsSync(path.join(API_ROOT, '..', '..', e.source))).toBe(true);
    }
  });

  it('compiles only approved references — held-back candidates never reach the model', () => {
    const ids = DESIGNER_EXEMPLARS.map((e) => e.id);
    expect(ids.some((id) => /gym|news|tacos/.test(id))).toBe(false);
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

  it.each(each)('%s has no asset path that only resolves inside apps/web/public', (_id, e) => {
    expect(e.html).not.toMatch(/\/templates\/|assets\/super-taco|url\(\s*['"]?\//);
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
      const got = selectDesignerExemplars({ purpose: 'menu', orientation: 'landscape', structureId: st.id, brandText: ['Casa Lupita'] });
      expect(got).toHaveLength(2);
      expect(got[0].structure).toBe(st.id);
      expect(got[1].structure).not.toBe(st.id);
    }
  });

  it('gives the three candidates of a batch three different primaries where the library allows', () => {
    const primaries = menu.map((st) => selectDesignerExemplars({ purpose: 'menu', orientation: 'landscape', structureId: st.id, brandText: [] })[0].id);
    expect(primaries[0]).not.toBe(primaries[1]);
  });

  it('NEVER shows a brand its own board (a Super Taco request gets no Super Taco reference)', () => {
    expect(selectDesignerExemplars({ purpose: 'menu', orientation: 'landscape', structureId: 'rail-cards', brandText: ['Super Taco'] })).toEqual([]);
    expect(selectDesignerExemplars({ purpose: 'menu', orientation: 'landscape', brandText: ['Brand: Super Taco. What they sell: tacos'] })).toEqual([]);
    expect(selectDesignerExemplars({ purpose: 'menu', orientation: 'landscape', brandText: ['https://supertacomex.com/menu'] })).toEqual([]);
    // Negative control: a different taqueria is shown the wall.
    expect(selectDesignerExemplars({ purpose: 'menu', orientation: 'landscape', brandText: ['Taco Bell'] }).length).toBe(2);
  });

  it('matches the request\'s orientation', () => {
    const port = selectDesignerExemplars({ purpose: 'menu', orientation: 'portrait', structureId: 'hero-cards', brandText: [] });
    expect(port.every((e) => e.orientation === 'portrait')).toBe(true);
    const land = selectDesignerExemplars({ purpose: 'menu', orientation: 'landscape', structureId: 'hero-cards', brandText: [] });
    expect(land.every((e) => e.orientation === 'landscape')).toBe(true);
  });

  it('an offer gets the approved offer board; purposes with no approved board get none', () => {
    const offer = selectDesignerExemplars({ purpose: 'offer', orientation: 'landscape', structureId: 'split-offer', brandText: [] });
    expect(offer.map((e) => e.structure)).toEqual(['split-offer']);
    for (const purpose of ['welcome', 'event', 'announcement'] as const) {
      expect(selectDesignerExemplars({ purpose, orientation: 'landscape', brandText: [] })).toEqual([]);
    }
  });

  it('respects max and prefers boards whose PRIMARY purpose matches', () => {
    expect(selectDesignerExemplars({ purpose: 'menu', orientation: 'landscape', max: 1, brandText: [] })).toHaveLength(1);
    // With no structure preference, a true menu board comes before the offer board that also lists menu.
    const two = selectDesignerExemplars({ purpose: 'menu', orientation: 'landscape', structureId: 'leader-rows', brandText: [] });
    expect(two.every((e) => e.purposes[0] === 'menu')).toBe(true);
  });

  it('is deterministic', () => {
    const a = selectDesignerExemplars({ purpose: 'menu', orientation: 'landscape', structureId: 'leader-rows', itemCount: 21, brandText: [] }).map((e) => e.id);
    const b = selectDesignerExemplars({ purpose: 'menu', orientation: 'landscape', structureId: 'leader-rows', itemCount: 21, brandText: [] }).map((e) => e.id);
    expect(a).toEqual(b);
  });
});

describe('exemplarIsTargetBrand', () => {
  const st = { brandTokens: ['super taco', 'supertaco'] };
  it('matches the spaced and the joined form, and nothing else', () => {
    expect(exemplarIsTargetBrand(st, ['Super Taco'])).toBe(true);
    expect(exemplarIsTargetBrand(st, ['SUPERTACOMEX.COM'])).toBe(true);
    expect(exemplarIsTargetBrand(st, ['Súper Taco'])).toBe(true);
    expect(exemplarIsTargetBrand(st, ['Taco Bell', 'super nachos'])).toBe(false);
    expect(exemplarIsTargetBrand(st, [null, undefined, ''])).toBe(false);
  });
});

describe('formatExemplarsForPrompt', () => {
  it('labels each board with whose it is and says none of its content goes on this board', () => {
    const got = selectDesignerExemplars({ purpose: 'menu', orientation: 'landscape', structureId: 'rail-cards', brandText: [] });
    const text = formatExemplarsForPrompt(got);
    expect(text.startsWith('REFERENCE BOARDS')).toBe(true);
    expect(text).toMatch(/none of it goes on this board/);
    expect(text).toContain('Reference 1 — Super Taco · Burritos & More (menu wall 2 of 3) (Super Taco). 3840×2160 landscape, rail + cards layout, 6 items.');
    expect(formatExemplarsForPrompt([])).toBe('');
  });
});
