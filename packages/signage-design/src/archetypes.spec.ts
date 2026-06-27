import {
  ARCHETYPE_IDS,
  ARCHETYPES,
  SAFE_MARGIN_PCT,
  archetypeSupports,
  getArchetype,
  resolveArchetype,
} from './archetypes';
import { THEMES } from './themes';
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
  it('exposes 6 landscape archetypes', () => {
    expect(ARCHETYPE_IDS.length).toBe(6);
    expect(ARCHETYPE_IDS).toEqual(
      expect.arrayContaining([
        'hero-fullbleed',
        'split-50',
        'lower-third-banner',
        'stat-spotlight',
        'three-up-grid',
        'menu-list',
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
