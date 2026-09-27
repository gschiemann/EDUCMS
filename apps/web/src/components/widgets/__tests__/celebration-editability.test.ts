/**
 * K-12 launch audit (2026-09-27) — the 76 sports celebration variants.
 *
 * 06-WIDGET-REVIEW graded the celebrations "C (validation incomplete)": a
 * renderer-by-renderer field sweep had never been done. These celebrations
 * have no hand-built editor — the Properties panel's generic v2 editor builds
 * their fields from the registry `defaults`. So a config key a renderer
 * READS but its registry defaults OMIT is a word on screen the operator
 * cannot reach. This is that sweep, as a permanent gate:
 *
 *   1. every `c.<key>` a celebration renderer reads (except `style`, which
 *      the v2 Style section owns) is a key of its registry defaults;
 *   2. no celebration default or renderer fallback carries a real pro
 *      athlete's name (F38 — a freshly dropped 3-pointer celebration on a
 *      school's gym board read "CURRY · 7 TONIGHT"; a soccer goal read
 *      "MESSI").
 *
 * Static on purpose: rendering 76 animated scenes proves presence only for
 * values that happen to be set; the contract is about the source.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ALL_V2_WIDGETS } from '../v2/registry';

const V2_DIR = path.join(__dirname, '..', 'v2');
const SOURCES = fs
  .readdirSync(V2_DIR)
  .filter((f) => /^Celebrations.*\.tsx$/.test(f))
  .map((f) => ({ file: f, src: fs.readFileSync(path.join(V2_DIR, f), 'utf8') }));

function componentBody(name: string): { file: string; body: string } | null {
  for (const { file, src } of SOURCES) {
    const start = src.indexOf(`function ${name}(`);
    if (start < 0) continue;
    const next = src.indexOf('\nexport function', start + 10);
    return { file, body: src.slice(start, next < 0 ? undefined : next) };
  }
  return null;
}

const CELEBRATIONS = ALL_V2_WIDGETS.filter((w) => w.type.startsWith('CEL_'));

/** Renderers whose only config is `style` — a fixed-copy cinematic. */
const STYLE_ONLY = new Set(['CEL_FOOTBALL_SAFETY']);

describe('celebration renderers expose every field they render', () => {
  it('finds all 76 celebration variants', () => {
    expect(CELEBRATIONS.length).toBe(76);
  });

  for (const w of CELEBRATIONS) {
    it(`${w.type}: every key the renderer reads is editable`, () => {
      const inner = /Measured\((\w+)\)/.exec((w.Component as { displayName?: string }).displayName || '')?.[1];
      expect(inner).toBeTruthy();
      const found = componentBody(inner!);
      expect(found).not.toBeNull();
      const reads = new Set<string>();
      const re = /\bc\.([a-zA-Z_][a-zA-Z0-9_]*)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(found!.body))) if (m[1] !== 'style') reads.add(m[1]);
      if (STYLE_ONLY.has(w.type)) {
        expect([...reads]).toEqual([]);
        return;
      }
      const defaults = (w.defaults || {}) as Record<string, unknown>;
      const missing = [...reads].filter((k) => !(k in defaults));
      expect({ type: w.type, missing }).toEqual({ type: w.type, missing: [] });
    });
  }
});

describe('no pro athlete names in celebration samples (F38)', () => {
  // The names the pack shipped with — any one reappearing is a regression.
  const PRO = /\b(CURRY|GIANNIS|BOOKER|EMBIID|GILGEOUS|DONCIC|IRVING|TATUM|JOKIC|MCDAVID|DRAISAITL|OVECHKIN|MATTHEWS|BARKOV|SHESTERKIN|BARKLEY|RAMSEY|BUTKER|PARSONS|PEPPERS|BOSA|MESSI|HAALAND|BELLINGHAM|RAMOS|COURTOIS|BECKHAM|BURNES|TUCKER|DEVERS|KERSHAW|LINDOR|ALBIES|OLSON|JUDGE|OHTANI|SKENES|MAHOMES|PAYTON|PASTRNAK|PEL[ÉE]|MBAPP[ÉE]|ALCARAZ|SINNER|SWIATEK|DJOKOVIC|GAUFF|RAMBO|GAUDET|BURROUGHS|STEVESON|DAKE|WOODS|SCHEFFLER|MORIKAWA|FURY|USYK|CANELO|BIVOL|BOLT|LEDECKY|PHELPS|DRESSEL|WARHOLM)\b/;

  it('registry defaults', () => {
    const offenders = CELEBRATIONS.filter((w) => PRO.test(JSON.stringify(w.defaults || {}))).map((w) => w.type);
    expect(offenders).toEqual([]);
  });

  it('renderer fallbacks (the text a zone shows with nothing configured)', () => {
    const offenders: string[] = [];
    for (const { file, src } of SOURCES) {
      src.split('\n').forEach((line, i) => {
        if (/\?\?|\|\|/.test(line) && PRO.test(line) && !/^\s*(\/\/|\*)/.test(line)) offenders.push(`${file}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
