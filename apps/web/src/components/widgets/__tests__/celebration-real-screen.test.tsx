/**
 * K-12 sports launch, lane B3, leftover (a) — 2026-09-27.
 *
 * A celebration zone nobody filled in used to put its SAMPLES on a real
 * screen: a school's stadium board read "PLAYER · +6 · 67 YD · 21-14" for a
 * touchdown nobody described. The rule now (v2/_shared/celebration-sample.ts):
 *
 *   • builder — an unfilled field shows its sample (a tile is never blank);
 *   • real screen (RenderSurfaceProvider surface="player") — an unfilled
 *     field is blank and the line that only exists to show it is gone;
 *   • a role word the pack used to SEED into saved zones ("PLAYER",
 *     "SCORER", …) counts as unfilled on a real screen;
 *   • a freshly dropped celebration is no longer seeded with samples.
 *
 * The sweep renders all 76 celebrations on both surfaces, so a scene added
 * later without the sample gate fails here.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as React from 'react';
import { render, cleanup } from '@testing-library/react';
import '@/components/widgets/variants-register';
import { listVariants } from '@/components/widgets/variants';
import { RenderSurfaceProvider } from '../render-surface';
import { ALL_V2_WIDGETS } from '../v2/registry';
import {
  CELEBRATION_ROLE_PLACEHOLDERS,
  sampleFor,
  joinParts,
  withUnit,
  has,
} from '../v2/_shared/celebration-sample';

const CELEBRATIONS = ALL_V2_WIDGETS.filter((w) => w.type.startsWith('CEL_'));

/** Content keys: everything the Style section does not own. */
const isContentKey = (k: string) => k !== 'style' && !/Color$/.test(k);

/** The strings a default carries (arrays and row objects flattened). */
function sampleStrings(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(sampleStrings);
  if (v && typeof v === 'object') return Object.values(v as Record<string, unknown>).flatMap(sampleStrings);
  return [];
}

// The scenes size off offsetWidth/offsetHeight (withMeasuredHeight +
// useElementSize); jsdom reports 0, which renders nothing at all. Give every
// element a 16:9 box so the scene paints its text.
const realOffsetW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
const realOffsetH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 1280 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 720 });
});
afterAll(() => {
  if (realOffsetW) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', realOffsetW);
  if (realOffsetH) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', realOffsetH);
});
afterEach(cleanup);

function textOf(
  Component: React.ComponentType<{ config?: Record<string, unknown>; live?: boolean }>,
  config: Record<string, unknown>,
  surface: 'builder' | 'player',
): string {
  const node = <Component config={config} live={false} />;
  const { container } = render(
    surface === 'player' ? <RenderSurfaceProvider surface="player">{node}</RenderSurfaceProvider> : node,
  );
  return (container.textContent || '').replace(/\s+/g, ' ').trim();
}

describe('the sample rule', () => {
  const builder = sampleFor(false);
  const screen = sampleFor(true);

  it('builder: an unfilled field shows its sample', () => {
    expect(builder(undefined, 'PLAYER')).toBe('PLAYER');
    expect(builder(null, 7)).toBe(7);
    expect(builder(undefined, ["12'"])).toEqual(["12'"]);
  });

  it('real screen: an unfilled field is blank (text, number and list)', () => {
    expect(screen(undefined, 'PLAYER')).toBe('');
    expect(screen(null, 7)).toBe('');
    expect(screen(undefined, ["12'"])).toEqual([]);
  });

  it('real screen: a seeded role word counts as unfilled, in any case or padding', () => {
    for (const word of CELEBRATION_ROLE_PLACEHOLDERS) {
      expect(screen(word, 'x')).toBe('');
      expect(screen(` ${word.toLowerCase()} `, 'x')).toBe('');
      // …while the builder keeps showing what the zone holds.
      expect(builder(word, 'x')).toBe(word);
    }
  });

  it('a real value always wins, on both surfaces — numbers included (#295)', () => {
    for (const f of [builder, screen]) {
      expect(f('JORDAN LEE', 'PLAYER')).toBe('JORDAN LEE');
      expect(f(7, 3)).toBe(7);
      expect(f(0, 3)).toBe(0);
      expect(f('', 'PLAYER')).toBe(''); // cleared on purpose stays cleared
    }
  });

  it('a detail line never shows a separator or a unit with nothing next to it', () => {
    expect(joinParts(withUnit(5, 'HOLE '), withUnit(452, '', ' YD'))).toBe('HOLE 5 · 452 YD');
    expect(joinParts(withUnit('', 'HOLE '), withUnit(452, '', ' YD'))).toBe('452 YD');
    expect(joinParts(withUnit('', 'HOLE '), withUnit(undefined, '', ' YD'))).toBe('');
    expect(has(0)).toBe(true);
    expect(has('  ')).toBe(false);
  });
});

describe('every celebration on a real screen', () => {
  it('finds all 76', () => {
    expect(CELEBRATIONS.length).toBe(76);
  });

  for (const w of CELEBRATIONS) {
    const defaults = (w.defaults || {}) as Record<string, unknown>;
    const Component = w.Component as React.ComponentType<{ config?: Record<string, unknown>; live?: boolean }>;

    it(`${w.type}: nothing filled in → no sample text and no role word`, () => {
      const text = textOf(Component, {}, 'player').toUpperCase();
      const leaked = Object.entries(defaults)
        .filter(([k]) => isContentKey(k))
        .flatMap(([k, v]) => sampleStrings(v).map((s) => [k, s.trim()] as const))
        .filter(([, s]) => s.length >= 2 && text.includes(s.toUpperCase()));
      expect({ type: w.type, leaked }).toEqual({ type: w.type, leaked: [] });
      for (const word of CELEBRATION_ROLE_PLACEHOLDERS) {
        expect({ type: w.type, word, shown: new RegExp(`\\b${word}\\b`).test(text) }).toEqual({
          type: w.type,
          word,
          shown: false,
        });
      }
    });

    it(`${w.type}: an OLD zone holding the seeded role words shows none of them`, () => {
      // Zones saved before this change carry the registry defaults verbatim.
      const text = textOf(Component, defaults, 'player').toUpperCase();
      for (const [k, v] of Object.entries(defaults)) {
        if (!isContentKey(k) || typeof v !== 'string') continue;
        if (!CELEBRATION_ROLE_PLACEHOLDERS.has(v.trim().toUpperCase())) continue;
        expect({ type: w.type, key: k, shown: new RegExp(`\\b${v.trim().toUpperCase()}\\b`).test(text) }).toEqual({
          type: w.type,
          key: k,
          shown: false,
        });
      }
    });
  }
});

describe('the builder keeps its preview', () => {
  it('an unfilled three-pointer shows its samples in the builder and not on a screen', () => {
    const three = CELEBRATIONS.find((w) => w.type === 'CEL_BASKETBALL_THREE')!;
    const Component = three.Component as React.ComponentType<{ config?: Record<string, unknown>; live?: boolean }>;
    const inBuilder = textOf(Component, {}, 'builder');
    expect(inBuilder).toContain('PLAYER');
    expect(inBuilder).toMatch(/7/);
    const onScreen = textOf(Component, {}, 'player');
    expect(onScreen).not.toContain('PLAYER');
    expect(onScreen).not.toMatch(/7 TONIGHT/i);
  });

  it("a filled-in celebration shows the operator's words on a real screen", () => {
    const td = CELEBRATIONS.find((w) => w.type === 'CEL_FOOTBALL_TOUCHDOWN')!;
    const Component = td.Component as React.ComponentType<{ config?: Record<string, unknown>; live?: boolean }>;
    const text = textOf(Component, { player: 'JORDAN LEE', distance: '45 YD', score: '14-7' }, 'player');
    expect(text).toContain('JORDAN LEE');
    expect(text).toContain('45 YD');
    expect(text).toContain('14-7');
  });
});

describe('a freshly dropped celebration', () => {
  const byType = new Map(CELEBRATIONS.map((w) => [w.type.toLowerCase().replace(/_/g, '-'), w]));
  const dropped = listVariants({ widgetType: 'CELEBRATION' });

  it('is registered for every celebration', () => {
    expect(dropped.length).toBeGreaterThanOrEqual(76);
  });

  it('is seeded with its colours and style only — never a sample', () => {
    const seededContent = dropped
      .map((v) => ({ id: v.id, keys: Object.keys(v.defaultConfig || {}).filter(isContentKey) }))
      .filter((r) => r.keys.length > 0);
    expect(seededContent).toEqual([]);
  });

  it('keeps every colour its registry entry defines', () => {
    for (const v of dropped) {
      const w = byType.get(v.id);
      if (!w) continue;
      for (const [k, val] of Object.entries(w.defaults || {})) {
        if (!isContentKey(k)) expect((v.defaultConfig as Record<string, unknown>)[k]).toEqual(val);
      }
    }
  });
});

describe('the scoreboard orchestrator and the ribbon strip', () => {
  const WIDGETS = path.join(__dirname, '..');

  it('orchestrator cue defaults carry no role word, name, number or minute', () => {
    const src = fs.readFileSync(path.join(WIDGETS, 'sports', 'CtsRibbonWidgets.tsx'), 'utf8');
    const start = src.indexOf('const CUE_CATALOG = {');
    const end = src.indexOf('} as const;', start);
    expect(start).toBeGreaterThan(0);
    const block = src.slice(start, end);
    const defaults = [...block.matchAll(/defaults: (\{[^}]*\})/g)].map((m) => m[1]);
    expect(defaults.length).toBeGreaterThanOrEqual(30);
    const roleish = /'(PLAYER|SCORER|SLUGGER|KEEPER|GOALIE|GOLFER|SERVER|ACE|ATHLETE|EVENT|TEAM|PITCHER|KICKER|FINAL)'/;
    for (const d of defaults) {
      expect({ d, roleWord: roleish.test(d) }).toEqual({ d, roleWord: false });
      // The one number allowed is the buzzer's 0.0 — true the moment it fires.
      expect({ d, number: /\d/.test(d.replace("clock: '0.0'", '')) }).toEqual({ d, number: false });
    }
  });

  it('the ribbon strip states what a touchdown is worth, and no timed penalty for a soccer kick', () => {
    const src = fs.readFileSync(path.join(WIDGETS, '..', '..', 'app', 'ribbon', '[gameId]', 'page.tsx'), 'utf8');
    expect(src).not.toContain("subtitle = '+7'");
    expect(src).toContain("subtitle = '+6'");
    expect(src).toContain("if (!scorerName && key === 'exclusion') subtitle = '20-SECOND PENALTY'");
  });
});
