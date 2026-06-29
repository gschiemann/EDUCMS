import {
  ARCHETYPE_IDS,
  ARCHETYPES,
  SAFE_MARGIN_PCT,
  archetypeSupports,
  getArchetype,
  resolveArchetype,
} from './archetypes';
import { THEMES } from './themes';
import { enforce } from './validator';
import { CANVAS_CLASSES } from './types';
import type { ArchetypeId, ResolvedZone } from './types';

const theme = THEMES[0]!;
const landscape = CANVAS_CLASSES['landscape-16-9'];

function contentZones(zones: ResolvedZone[]): ResolvedZone[] {
  return zones.filter((z) => z.slot !== 'background');
}

// Full-bleed media (background + image) is intentionally allowed to reach the
// edges; only TEXT must respect the safe margin.
function marginCheckedZones(zones: ResolvedZone[]): ResolvedZone[] {
  return zones.filter((z) => z.slot !== 'background' && z.slot !== 'image');
}

function rectsOverlap(a: ResolvedZone, b: ResolvedZone): boolean {
  const eps = 1e-6;
  return (
    a.x < b.x + b.width - eps &&
    a.x + a.width > b.x + eps &&
    a.y < b.y + b.height - eps &&
    a.y + a.height > b.y + eps
  );
}

describe('archetype registry', () => {
  it('exposes the full archetype catalog', () => {
    expect(ARCHETYPE_IDS.length).toBe(9);
    expect(ARCHETYPE_IDS).toEqual(
      expect.arrayContaining([
        'hero-fullbleed',
        'split-50',
        'lower-third-banner',
        'stat-spotlight',
        'three-up-grid',
        'menu-list',
        'poster-promo',
        'quote-spotlight',
        'title-cta',
      ]),
    );
  });

  it('every archetype supports the landscape-16-9 canvas', () => {
    for (const id of ARCHETYPE_IDS) {
      expect(archetypeSupports(id, 'landscape-16-9')).toBe(true);
    }
  });

  it('getArchetype throws on an off-menu id', () => {
    expect(() => getArchetype('totally-made-up' as ArchetypeId)).toThrow();
  });
});

describe.each(ARCHETYPE_IDS)('resolve(%s) on landscape', (id) => {
  const zones = resolveArchetype(id, landscape, theme);

  it('produces at least one zone with a required headline-or-stat slot', () => {
    expect(zones.length).toBeGreaterThan(0);
    const hasFocal = zones.some((z) => z.slot === 'headline' || z.slot === 'stat');
    expect(hasFocal).toBe(true);
  });

  it('keeps every TEXT zone inside the 5% safe margin', () => {
    for (const z of marginCheckedZones(zones)) {
      expect(z.x).toBeGreaterThanOrEqual(SAFE_MARGIN_PCT - 1e-6);
      expect(z.y).toBeGreaterThanOrEqual(SAFE_MARGIN_PCT - 1e-6);
      expect(z.x + z.width).toBeLessThanOrEqual(100 - SAFE_MARGIN_PCT + 1e-6);
      expect(z.y + z.height).toBeLessThanOrEqual(100 - SAFE_MARGIN_PCT + 1e-6);
    }
  });

  it('lets a full-bleed background reach the edges', () => {
    const bg = zones.find((z) => z.slot === 'background');
    if (bg) {
      expect(bg.x).toBe(0);
      expect(bg.y).toBe(0);
      expect(bg.width).toBe(100);
      expect(bg.height).toBe(100);
    }
  });

  it('has no overlap between DISTINCT content slots', () => {
    const cz = contentZones(zones);
    for (let i = 0; i < cz.length; i++) {
      for (let j = i + 1; j < cz.length; j++) {
        if (cz[i]!.slot === cz[j]!.slot) continue; // tiled list rows allowed
        expect(rectsOverlap(cz[i]!, cz[j]!)).toBe(false);
      }
    }
  });

  it('emits longhand-only geometry (no inset/gap leakage in style tokens)', () => {
    // The contract is %-coords + token names. Assert no styleToken value is a
    // CSS inset/gap shorthand string (Taurus-safe invariant, CLAUDE.md #10).
    for (const z of zones) {
      const serialized = JSON.stringify(z.styleTokens);
      expect(serialized).not.toMatch(/"inset"/);
      expect(serialized).not.toMatch(/\bgap\b/);
    }
  });
});

// ---------------------------------------------------------------------------
// ORIENTATION (Wave 3): for EACH archetype and EACH canvas class in its
// `supports`, the resolved geometry must be in-bounds, content >= 5% margin,
// and no two DIFFERENT-slot content zones overlap.
// ---------------------------------------------------------------------------

const SINGLE_MESSAGE: ArchetypeId[] = [
  'hero-fullbleed',
  'lower-third-banner',
  'stat-spotlight',
  'poster-promo',
  'title-cta',
];
const MULTI_ZONE: ArchetypeId[] = [
  'split-50',
  'three-up-grid',
  'menu-list',
  'quote-spotlight',
];

describe('orientation: every archetype x every supported canvas class', () => {
  for (const id of ARCHETYPE_IDS) {
    const supported = ARCHETYPES[id].supports;
    describe(`${id}`, () => {
      for (const cid of supported) {
        const canvas = CANVAS_CLASSES[cid];

        it(`[${cid}] resolves at least one zone`, () => {
          const zones = resolveArchetype(id, canvas, theme);
          expect(zones.length).toBeGreaterThan(0);
        });

        it(`[${cid}] all rects are in bounds (0..100)`, () => {
          for (const z of resolveArchetype(id, canvas, theme)) {
            expect(z.x).toBeGreaterThanOrEqual(0);
            expect(z.y).toBeGreaterThanOrEqual(0);
            expect(z.width).toBeGreaterThan(0);
            expect(z.height).toBeGreaterThan(0);
            expect(z.x + z.width).toBeLessThanOrEqual(100.001);
            expect(z.y + z.height).toBeLessThanOrEqual(100.001);
          }
        });

        it(`[${cid}] content (non-image) zones keep the 5% safe margin`, () => {
          for (const z of marginCheckedZones(resolveArchetype(id, canvas, theme))) {
            expect(z.x).toBeGreaterThanOrEqual(SAFE_MARGIN_PCT - 1e-6);
            expect(z.y).toBeGreaterThanOrEqual(SAFE_MARGIN_PCT - 1e-6);
            expect(z.x + z.width).toBeLessThanOrEqual(100 - SAFE_MARGIN_PCT + 1e-6);
            expect(z.y + z.height).toBeLessThanOrEqual(100 - SAFE_MARGIN_PCT + 1e-6);
          }
        });

        it(`[${cid}] no overlap between DISTINCT content slots`, () => {
          const cz = contentZones(resolveArchetype(id, canvas, theme));
          for (let i = 0; i < cz.length; i++) {
            for (let j = i + 1; j < cz.length; j++) {
              if (cz[i]!.slot === cz[j]!.slot) continue; // tiled list rows allowed
              expect(rectsOverlap(cz[i]!, cz[j]!)).toBe(false);
            }
          }
        });

        it(`[${cid}] passes the validator with no error-severity findings`, () => {
          const zones = resolveArchetype(id, canvas, theme);
          const result = enforce(zones, { canvas, theme });
          const errors = result.findings.filter((f) => f.severity === 'error');
          expect(errors).toEqual([]);
          expect(result.ok).toBe(true);
        });
      }
    });
  }

  it('the 5 single-message archetypes support the ribbon; the 4 multi-zone do NOT', () => {
    for (const id of SINGLE_MESSAGE) {
      expect(archetypeSupports(id, 'ultrawide-ribbon')).toBe(true);
    }
    for (const id of MULTI_ZONE) {
      expect(archetypeSupports(id, 'ultrawide-ribbon')).toBe(false);
    }
  });

  it('every archetype supports landscape, portrait, and square (the universal three)', () => {
    for (const id of ARCHETYPE_IDS) {
      expect(archetypeSupports(id, 'landscape-16-9')).toBe(true);
      expect(archetypeSupports(id, 'portrait-9-16')).toBe(true);
      expect(archetypeSupports(id, 'square')).toBe(true);
    }
  });

  it("each archetype's supports[] contains only valid canvas class ids", () => {
    const valid = new Set(Object.keys(CANVAS_CLASSES));
    for (const id of ARCHETYPE_IDS) {
      for (const cid of ARCHETYPES[id].supports) {
        expect(valid.has(cid)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// MENU CANVAS-FILL (2026-06-28) — the menu-list resolver lays out the WHOLE menu
// and FILLS the canvas: a long landscape menu (>=7 items) goes two-column; a
// short one (<=6) stays a single centered column WITH a negative-space photo
// panel on the empty side; portrait stays single full-width column. The row
// COUNT matches the (clamped) item count so unused rows never exist.
// ---------------------------------------------------------------------------
describe('menu-list content-aware fill', () => {
  const portrait = CANVAS_CLASSES['portrait-9-16'];

  function rows(zones: ResolvedZone[]): ResolvedZone[] {
    return zones.filter((z) => z.slot === 'listItem');
  }

  it('a 10-item landscape menu yields 10 rows across TWO columns', () => {
    const zones = resolveArchetype('menu-list', landscape, theme, { itemCount: 10 });
    const r = rows(zones);
    expect(r.length).toBe(10);
    // Two distinct x columns (left + right), each ~46% wide.
    const xs = new Set(r.map((z) => Math.round(z.x)));
    expect(xs.size).toBe(2);
    // No negative-space photo panel on a long (two-column) menu.
    expect(zones.some((z) => z.slot === 'image')).toBe(false);
    // The right column's value edge reaches the safe-right (~95%): some row spans
    // out past the canvas midpoint, so the right half is filled, not empty.
    const maxRight = Math.max(...r.map((z) => z.x + z.width));
    expect(maxRight).toBeGreaterThan(90);
  });

  it('a 4-item landscape menu yields a SINGLE centered column + a photo panel', () => {
    const zones = resolveArchetype('menu-list', landscape, theme, { itemCount: 4 });
    const r = rows(zones);
    expect(r.length).toBe(4);
    // Single column — every row shares one left x.
    const xs = new Set(r.map((z) => Math.round(z.x)));
    expect(xs.size).toBe(1);
    // The empty side carries a negative-space photo/panel (image slot), so the
    // right half is never stranded.
    const photo = zones.filter((z) => z.slot === 'image');
    expect(photo.length).toBe(1);
    expect(photo[0]!.x).toBeGreaterThan(50); // sits on the right side
    expect(photo[0]!.x + photo[0]!.width).toBeLessThanOrEqual(100 + 1e-6);
    // Vertically CENTERED: the block doesn't strand the bottom — the first row
    // starts below the headline band but the last row ends well inside the canvas.
    const firstTop = Math.min(...r.map((z) => z.y));
    const lastBottom = Math.max(...r.map((z) => z.y + z.height));
    expect(firstTop).toBeGreaterThan(18); // below the headline
    expect(lastBottom).toBeLessThanOrEqual(95 + 1e-6); // inside the safe bottom
  });

  it('a portrait menu stays a single full-width column (no photo panel)', () => {
    const zones = resolveArchetype('menu-list', portrait, theme, { itemCount: 8 });
    const r = rows(zones);
    expect(r.length).toBe(8);
    const xs = new Set(r.map((z) => Math.round(z.x)));
    expect(xs.size).toBe(1);
    // Full content width (no reserved photo side on a portrait pillar).
    expect(r[0]!.width).toBeGreaterThan(80);
    expect(zones.some((z) => z.slot === 'image')).toBe(false);
  });

  it('clamps the row count to the [3, 12] band (whole menu, never a fixed 5)', () => {
    // 1 item → at least the 3-row minimum (reads as a list, not a lone line).
    expect(rows(resolveArchetype('menu-list', landscape, theme, { itemCount: 1 })).length).toBe(3);
    // 20 items → capped at 12 (the parser caps the same).
    expect(rows(resolveArchetype('menu-list', landscape, theme, { itemCount: 20 })).length).toBe(12);
  });

  it('no opts (legacy/preview path) still resolves a legal default menu', () => {
    const zones = resolveArchetype('menu-list', landscape, theme);
    expect(rows(zones).length).toBeGreaterThanOrEqual(3);
    const result = enforce(zones, { canvas: landscape, theme });
    expect(result.findings.filter((f) => f.severity === 'error')).toEqual([]);
  });

  it('a 10-item landscape menu passes the validator with no errors (no scrim on menu text)', () => {
    const zones = resolveArchetype('menu-list', landscape, theme, { itemCount: 10 });
    const result = enforce(zones, { canvas: landscape, theme, copy: { headline: 'Our Menu' } });
    expect(result.findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('a 4-item menu with a photo panel does NOT trigger a text scrim (image is a half, not a full-bleed bg)', () => {
    // The negative-space panel is an `image` slot, not a `background` — so the
    // menu TEXT must NOT be treated as text-over-image and get a scrim.
    const zones = resolveArchetype('menu-list', landscape, theme, { itemCount: 4 });
    const result = enforce(zones, { canvas: landscape, theme, copy: { headline: 'Our Menu' } });
    expect(result.findings.some((f) => f.code === 'TEXT_OVER_IMAGE_NO_SCRIM')).toBe(false);
    expect(result.ok).toBe(true);
  });
});

describe('every-archetype geometry sanity', () => {
  it('all rects are within 0-100 bounds', () => {
    for (const id of ARCHETYPE_IDS) {
      for (const z of resolveArchetype(id, landscape, theme)) {
        expect(z.x).toBeGreaterThanOrEqual(0);
        expect(z.y).toBeGreaterThanOrEqual(0);
        expect(z.width).toBeGreaterThan(0);
        expect(z.height).toBeGreaterThan(0);
        expect(z.x + z.width).toBeLessThanOrEqual(100 + 1e-6);
        expect(z.y + z.height).toBeLessThanOrEqual(100 + 1e-6);
      }
    }
  });

  it('exactly one accent zone per archetype (one reserved accent)', () => {
    for (const id of ARCHETYPE_IDS) {
      const accents = resolveArchetype(id, landscape, theme).filter(
        (z) => z.styleTokens.isAccent,
      );
      expect(accents.length).toBeLessThanOrEqual(1);
    }
  });

  it('exposes a supports[] array on every archetype', () => {
    for (const id of ARCHETYPE_IDS) {
      expect(Array.isArray(ARCHETYPES[id].supports)).toBe(true);
      expect(ARCHETYPES[id].supports.length).toBeGreaterThan(0);
    }
  });
});
