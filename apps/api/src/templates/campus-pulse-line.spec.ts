import * as fs from 'fs';
import * as path from 'path';

import { SYSTEM_TEMPLATE_PRESETS } from './system-presets';

/**
 * Campus Pulse line — structural acceptance (2026-08-16).
 *
 * Pins the contract from scratch/handoff/campus-pulse-k12-design-round-
 * 2026-08-15/IMPLEMENTATION-PROMPT.md §Tests: the six approved sources and
 * their twelve preset registrations must stay exactly in the approved shape.
 * These are the checks that survive a refactor — a renamed field, a reused
 * hero image, a viewport unit sneaking into a scene, or a preset pointed at
 * the wrong canvas all fail here instead of on a school's wall.
 */

const BOARDS_DIR = path.resolve(
  __dirname,
  '../../../web/public/templates/school/campus-pulse',
);

const CONCEPTS = [
  { num: '01', file: '01-campus-magazine.html', hero: 'campus-pulse-hs-students-v1.jpg', bg: '#f4f0e8' },
  { num: '02', file: '02-digital-signal.html', hero: 'campus-pulse-hs-stem-v1.jpg', bg: '#071315' },
  { num: '03', file: '03-neo-yearbook.html', hero: 'campus-pulse-hs-arts-media-v1.jpg', bg: '#f3efe5' },
  { num: '04', file: '04-varsity-broadcast.html', hero: 'campus-pulse-hs-athletics-v1.jpg', bg: '#07111f' },
  { num: '05', file: '05-metro-wayfinding.html', hero: 'campus-pulse-hs-leadership-v1.jpg', bg: '#f2f5f7' },
  { num: '06', file: '06-aurora-fold.html', hero: 'campus-pulse-hs-campus-arts-v1.jpg', bg: '#120a2e' },
];

const read = (file: string) => fs.readFileSync(path.join(BOARDS_DIR, file), 'utf8');

const fieldKeys = (html: string) =>
  new Set(
    [...html.matchAll(/data-field="([^"]+)"/g)]
      .map((m) => m[1])
      // The bridge builds theme-token attributes dynamically
      // (`data-field="theme.'+aliases[k]+'"` inside a JS string) — those are
      // code, not DOM fields, and the concatenation variable name legitimately
      // differs between boards. Real field keys never contain a quote.
      .filter((k) => !k.includes("'")),
  );
const imgSlots = (html: string) =>
  new Set([...html.matchAll(/data-imgslot="([^"]+)"/g)].map((m) => m[1]));

describe('Campus Pulse — sources on disk', () => {
  it('all six board files and all six hero assets exist', () => {
    for (const c of CONCEPTS) {
      expect(fs.existsSync(path.join(BOARDS_DIR, c.file))).toBe(true);
      expect(fs.existsSync(path.join(BOARDS_DIR, 'assets', c.hero))).toBe(true);
    }
  });

  it('the six hero assets are six DISTINCT files (no reuse across concepts)', () => {
    // Distinct names AND distinct bytes — a copy-paste duplicate under a new
    // name is exactly the failure the approval banned.
    const sizes = CONCEPTS.map((c) => fs.statSync(path.join(BOARDS_DIR, 'assets', c.hero)).size);
    expect(new Set(CONCEPTS.map((c) => c.hero)).size).toBe(6);
    expect(new Set(sizes).size).toBe(6);
  });

  it('every source references ITS OWN hero asset, one-to-one', () => {
    for (const c of CONCEPTS) {
      const html = read(c.file);
      expect(html).toContain(`assets/${c.hero}`);
      for (const other of CONCEPTS) {
        if (other.hero !== c.hero) expect(html).not.toContain(`assets/${other.hero}`);
      }
    }
  });

  it('all six sources expose exactly the same editable field-key set', () => {
    const first = fieldKeys(read(CONCEPTS[0].file));
    expect(first.size).toBeGreaterThanOrEqual(30); // 31 text fields in FIELD-SCHEMA.md
    for (const c of CONCEPTS.slice(1)) {
      const keys = fieldKeys(read(c.file));
      expect([...keys].sort()).toEqual([...first].sort());
    }
  });

  it('every source carries both image slots (school.logo + hero.photo)', () => {
    for (const c of CONCEPTS) {
      const slots = imgSlots(read(c.file));
      expect(slots.has('school.logo')).toBe(true);
      expect(slots.has('hero.photo')).toBe(true);
    }
  });

  it('every source authors BOTH orientations in one file (.is-portrait fixed-px scene)', () => {
    for (const c of CONCEPTS) {
      const html = read(c.file);
      expect(html).toMatch(/is-portrait/);
      // Logical canvases from the orientation contract.
      expect(html).toMatch(/1920/);
      expect(html).toMatch(/1080/);
    }
  });

  it('no source uses viewport units or the CSS inset shorthand (Taurus/Chromium-83 bans)', () => {
    for (const c of CONCEPTS) {
      const html = read(c.file);
      expect(html).not.toMatch(/[0-9](vw|vh|vmin|vmax)\b/);
      expect(html).not.toMatch(/inset:\s*[^;{]+;/);
    }
  });

  it('every source speaks the full bridge protocol', () => {
    for (const c of CONCEPTS) {
      const html = read(c.file);
      for (const evt of [
        'educms-ready',
        'educms-overrides',
        'educms-edit-mode',
        'educms-field-click',
        'educms-freeze',
        'educms-unfreeze',
      ]) {
        expect(html).toContain(evt);
      }
    }
  });
});

describe('Campus Pulse — twelve preset registrations', () => {
  const line = SYSTEM_TEMPLATE_PRESETS.filter((p) => p.id.startsWith('preset-school-hs-campus-pulse-'));

  it('registers exactly 12 presets: six landscape + six portrait siblings', () => {
    expect(line).toHaveLength(12);
    expect(line.filter((p) => p.orientation === 'LANDSCAPE')).toHaveLength(6);
    expect(line.filter((p) => p.orientation === 'PORTRAIT')).toHaveLength(6);
  });

  it.each(CONCEPTS)('concept $num: landscape + portrait siblings share a source and differ only by orientation', (c) => {
    const land = line.find((p) => p.id === `preset-school-hs-campus-pulse-${c.num}`)!;
    const port = line.find((p) => p.id === `preset-school-hs-campus-pulse-${c.num}-portrait`)!;
    expect(land).toBeDefined();
    expect(port).toBeDefined();

    // Landscape: bare URL (player auto-orients); portrait: explicit ?o=portrait.
    const url = `/templates/school/campus-pulse/${c.file}`;
    expect((land.zones[0].defaultConfig as any).url).toBe(url);
    expect((port.zones[0].defaultConfig as any).url).toBe(`${url}?o=portrait`);

    // Exact 4K canvases per the orientation contract.
    expect([land.screenWidth, land.screenHeight]).toEqual([3840, 2160]);
    expect([port.screenWidth, port.screenHeight]).toEqual([2160, 3840]);

    // Approved fallback background, both siblings.
    expect(land.bgColor).toBe(c.bg);
    expect(port.bgColor).toBe(c.bg);
  });

  it('every preset is a single full-canvas EXTERNAL_HTML zone with the Campus Pulse config', () => {
    for (const p of line) {
      expect(p.category).toBe('LOBBY_WELCOME');
      expect(p.schoolLevel).toBe('HIGH');
      expect(p.zones).toHaveLength(1);
      const z = p.zones[0];
      expect(z.widgetType).toBe('EXTERNAL_HTML');
      expect([z.x, z.y, z.width, z.height, z.zIndex, z.sortOrder]).toEqual([0, 0, 100, 100, 1, 0]);
      const cfg = z.defaultConfig as any;
      expect(cfg.campusPulse).toBe(true);
      expect(cfg.liveClock).toBe(true);
      expect(cfg.liveDate).toBe(true);
      expect(cfg.liveWeather).toBe(true);
      expect(cfg.clockTimezone).toBe('');
      expect(cfg.clockFormat).toBe('12h');
      expect(cfg.weatherLocation).toBe('');
      expect(cfg.weatherUnits).toBe('imperial');
    }
  });
});
