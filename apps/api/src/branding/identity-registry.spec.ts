/**
 * The identity-key registry (@cms/api-types brand-identity-keys.ts) is proven
 * from the renderer code, not typed from memory.
 *
 * Owner, 2026-11-23: "make sure that when I rebrand something everything gets
 * updated that's available". A rebrand writes the organisation's name,
 * tagline, initials and logo into the keys each themed widget reads, and
 * treats a value still equal to the renderer's own placeholder as nobody's.
 * That is only safe if every key is one the renderer READS and every
 * placeholder is one the renderer PAINTS — so this spec reads the web
 * renderer sources (the same cross-file technique as brand-identity.spec.ts):
 *
 *   1. every registered key is read by its renderer (a DEFAULTS or interface
 *      line alone does not count — that is what keeps CORNERMAN and
 *      DISCOTHEQUE out);
 *   2. every placeholder is that renderer's default for that key, verbatim,
 *      and a text key carries data-field="key" there;
 *   3. completeness: every identity read in widgets/{ms,hs,fitness},
 *      Animated*, themes/* and v2/LogoWidgets is registered or excluded;
 *   4. no variant is registered for a non-LOGO type in the table, and the v2
 *      'Logos' ids derive to exactly the five the table names;
 *   5. the system catalogue ships no identity value that is not a registered
 *      placeholder for its zone (CI fails if a future preset ships a name).
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  EXCLUDED_IDENTITY_KEYS,
  V2_LOGO_VARIANT_IDS,
  WIDGET_IDENTITY_KEYS,
  identityKeysFor,
  normaliseIdentityText,
  placeholdersFor,
  selectorMatches,
} from '@cms/api-types';
import { ALL_PRESETS } from '../templates/ensure-system-presets';
import {
  BOARD_INITIALS_FIELDS,
  BOARD_LOGO_SLOTS,
  BOARD_MONOGRAM_FIELDS,
  BOARD_NAME_FIELDS,
  BOARD_TAGLINE_FIELDS,
  isBlank,
  isPlaceholder,
} from './brand-identity';

const WIDGETS = path.resolve(__dirname, '../../../web/src/components/widgets');
const cache = new Map<string, string>();
const read = (rel: string): string => {
  if (!cache.has(rel))
    cache.set(rel, fs.readFileSync(path.join(WIDGETS, rel), 'utf8'));
  return cache.get(rel)!;
};
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function listTsx(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(WIDGETS, dir), {
    withFileTypes: true,
  })) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (e.name !== '__tests__' && e.name !== 'node_modules')
        out.push(...listTsx(rel));
    } else if (e.name.endsWith('.tsx')) out.push(rel);
  }
  return out;
}

// ── Where each component lives, and which components render each type ──

const ALL_FILES = listTsx('');
const COMPONENT_FILE = new Map<string, string>();
for (const f of ALL_FILES) {
  for (const m of read(f).matchAll(
    /^export (?:function|const) ([A-Z][A-Za-z0-9_]*)/gm,
  ))
    if (!COMPONENT_FILE.has(m[1])) COMPONENT_FILE.set(m[1], f);
}

const RENDERER = read('WidgetRenderer.tsx');
/** `case 'TYPE': return <Component` in WidgetRenderer's type switch. */
const CASE_COMPONENT = new Map<string, string>();
for (const m of RENDERER.matchAll(
  /case '([A-Z0-9_]+)':\s*return <([A-Z][A-Za-z0-9_]*)/g,
))
  if (!CASE_COMPONENT.has(m[1])) CASE_COMPONENT.set(m[1], m[2]);

/** The body of `[export] function NAME(` in `src` (up to the next top-level `}`). */
function functionBody(src: string, name: string): string {
  const start = src.search(new RegExp(`\\n(?:export )?function ${name}\\(`));
  if (start < 0) throw new Error(`function ${name} not found`);
  const end = src.indexOf('\n}\n', start);
  return src.slice(start, end + 2);
}
const LOGO_WIDGET = functionBody(RENDERER, 'LogoWidget');
/** LogoWidget's theme switch: theme → component. */
const LOGO_THEME_COMPONENT = new Map<string, string>();
for (const m of LOGO_WIDGET.matchAll(
  /config\.theme === '([a-z0-9-]+)'\) return <([A-Z][A-Za-z0-9_]*)/g,
))
  LOGO_THEME_COMPONENT.set(m[1], m[2]);

/** Static registerVariant() calls: id → { widgetType, render }. */
const VARIANTS_SRC = read('variants-register.ts');
const VARIANT = new Map<string, { widgetType: string; render: string }>();
for (const chunk of VARIANTS_SRC.split('registerVariant(').slice(1)) {
  const id = /\bid:\s*'([a-z0-9-]+)'/.exec(chunk)?.[1];
  const widgetType = /\bwidgetType:\s*'([A-Z0-9_]+)'/.exec(chunk)?.[1];
  const render = /\brender:\s*([A-Z][A-Za-z0-9_]*)/.exec(chunk)?.[1];
  if (id && widgetType && render && !VARIANT.has(id))
    VARIANT.set(id, { widgetType, render });
}

/** The v2 'Logos' pack: kebab-cased variant id → component (v2/registry.ts). */
const V2_REGISTRY = read('v2/registry.ts');
const V2_LOGOS = new Map<string, string>();
for (const m of V2_REGISTRY.matchAll(
  /W\('([A-Z0-9_]+)',\s*'Logos',[^\n]*?Logos\.([A-Z][A-Za-z0-9_]*)\)/g,
))
  V2_LOGOS.set(m[1].toLowerCase().replace(/_/g, '-'), m[2]);

const fileOf = (component: string): string => {
  const f = COMPONENT_FILE.get(component);
  if (!f) throw new Error(`no file exports ${component}`);
  return f;
};

/** Every source a type renders through; LOGO's own renderer is LogoWidget's body. */
const LOGO_SOURCE = '(WidgetRenderer.tsx LogoWidget)';
function sourcesOf(type: string): string[] {
  if (type === 'LOGO') {
    const files = new Set<string>([LOGO_SOURCE]);
    for (const c of LOGO_THEME_COMPONENT.values()) files.add(fileOf(c));
    for (const v of VARIANT.values())
      if (v.widgetType === 'LOGO') files.add(fileOf(v.render));
    for (const c of V2_LOGOS.values()) files.add(fileOf(c));
    return [...files];
  }
  const c = CASE_COMPONENT.get(type);
  if (!c) throw new Error(`WidgetRenderer has no case for ${type}`);
  return [fileOf(c)];
}
const sourceText = (s: string) => (s === LOGO_SOURCE ? LOGO_WIDGET : read(s));

/** The sources a LOGO selector resolves to (its variants and themes). */
function logoSourcesFor(sel: {
  variants?: readonly string[];
  themes?: readonly string[];
}): string[] {
  const out: string[] = [];
  for (const id of sel.variants || []) {
    const c = V2_LOGOS.get(id) ?? VARIANT.get(id)?.render;
    if (!c) throw new Error(`LOGO variant ${id} is not registered`);
    if (!V2_LOGOS.has(id)) expect(VARIANT.get(id)!.widgetType).toBe('LOGO');
    out.push(fileOf(c));
  }
  for (const t of sel.themes || []) {
    const c = LOGO_THEME_COMPONENT.get(t);
    if (!c) throw new Error(`LogoWidget has no theme ${t}`);
    out.push(fileOf(c));
  }
  return out;
}

// ── What counts as a READ of a config key ──

function readsKey(src: string, key: string): boolean {
  const k = esc(key);
  const forms = [
    new RegExp(`\\bpick\\(\\s*(?:config\\s*,\\s*)?['"]${k}['"]\\s*\\)`),
    new RegExp(`\\b(?:c|config|cfg)\\??\\.?\\[\\s*['"]${k}['"]\\s*\\]`),
  ];
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
    forms.push(new RegExp(`\\b(?:c|config|cfg)\\??\\.${k}\\b`));
  return forms.some((re) => re.test(src));
}

const IDENTITY_LAST = new Set([
  'schoolName',
  'schoolInitials',
  'tagline',
  'initials',
]);
const isIdentityKey = (k: string) => {
  const last = k.split('.').pop()!;
  return (
    IDENTITY_LAST.has(last) ||
    k === 'school.name' ||
    k === 'brand.name' ||
    /logourl$/i.test(last)
  );
};
/** Every identity-looking key `src` reads. */
function identityReads(src: string): Set<string> {
  const keys = new Set<string>();
  const forms = [
    /\bpick\(\s*(?:config\s*,\s*)?['"]([A-Za-z0-9_.]+)['"]\s*\)/g,
    /\b(?:c|config|cfg)\??\.([A-Za-z_][A-Za-z0-9_]*)\b/g,
    /\b(?:c|config|cfg)\??\.?\[\s*['"]([A-Za-z0-9_.]+)['"]\s*\]/g,
  ];
  for (const re of forms)
    for (const m of src.matchAll(re)) if (isIdentityKey(m[1])) keys.add(m[1]);
  return keys;
}

/** `text` is the renderer's default for `key`: `key: 'text'` (DEFAULTS / FALLBACK) or `.key || 'text'`. */
function isDefaultFor(src: string, key: string, text: string): boolean {
  const k = esc(key);
  const t = esc(text);
  return new RegExp(
    `(?:['"]?${k}['"]?\\s*:\\s*|\\.${k}\\s*\\|\\|\\s*)['"]${t}['"]`,
  ).test(src);
}

const TYPES = Object.keys(WIDGET_IDENTITY_KEYS);
const specRows = TYPES.flatMap((type) =>
  WIDGET_IDENTITY_KEYS[type].map((spec) => ({ type, spec })),
);

describe('identity registry — sanity', () => {
  it('finds the renderers it reads', () => {
    expect(ALL_FILES.length).toBeGreaterThan(100);
    expect(CASE_COMPONENT.get('MS_ARCADE')).toBe('MsArcadeWidget');
    expect(LOGO_THEME_COMPONENT.get('office-dashboard')).toBe(
      'OfficeDashboardLogo',
    );
    expect(VARIANT.get('logo-athletics')).toEqual({
      widgetType: 'LOGO',
      render: 'AthleticsLogo',
    });
    expect(specRows.length).toBeGreaterThan(50);
  });

  it('identityKeysFor: registered types, [] for Terminal / Transit, null otherwise', () => {
    expect(identityKeysFor('HS_TERMINAL')).toEqual([]);
    expect(identityKeysFor('HS_TRANSIT_PORTRAIT')).toEqual([]);
    expect(identityKeysFor('EXTERNAL_HTML')).toBeNull();
    expect(identityKeysFor('CLOCK')).toBeNull();
    expect(identityKeysFor('constructor')).toBeNull();
    expect(identityKeysFor(undefined)).toBeNull();
  });

  it('normaliseIdentityText: NBSP, collapsed whitespace, trimmed, lowercased', () => {
    expect(normaliseIdentityText('  Westridge  \n Wildcats ')).toBe(
      'westridge wildcats',
    );
    expect(normaliseIdentityText('   ')).toBeNull();
    expect(normaliseIdentityText(7)).toBeNull();
  });

  it('selectorMatches: a variant wins; else the theme; no selector matches all', () => {
    const sel = {
      variants: ['logo-athletics'],
      themes: ['high-school-athletics'],
    };
    expect(selectorMatches(sel, { variant: 'logo-athletics' })).toBe(true);
    expect(selectorMatches(sel, { theme: 'high-school-athletics' })).toBe(true);
    expect(
      selectorMatches(sel, {
        variant: 'logo-neon',
        theme: 'high-school-athletics',
      }),
    ).toBe(false);
    expect(
      selectorMatches(sel, { variant: '  ', theme: 'high-school-athletics' }),
    ).toBe(true);
    expect(selectorMatches(sel, {})).toBe(false);
    expect(selectorMatches(undefined, {})).toBe(true);
  });
});

describe('identity registry — (1) every key is READ by its renderer', () => {
  it.each(specRows.map((r) => [r.type, r.spec.key, r.spec] as const))(
    '%s reads %s',
    (type, key, spec) => {
      const sources =
        type === 'LOGO' && spec.absentWhen
          ? logoSourcesFor(spec.absentWhen)
          : sourcesOf(type);
      expect(sources.some((s) => readsKey(sourceText(s), key))).toBe(true);
    },
  );

  it('a key only declared (DEFAULTS / interface) is not a read — CORNERMAN and DISCOTHEQUE', () => {
    for (const type of ['FITNESS_CORNERMAN', 'FITNESS_DISCOTHEQUE']) {
      const src = read(sourcesOf(type)[0]);
      expect(src).toMatch(/['"]gymLogoUrl['"]\s*:/);
      expect(readsKey(src, 'gymLogoUrl')).toBe(false);
      expect(identityKeysFor(type)).toBeNull();
      expect(EXCLUDED_IDENTITY_KEYS[type]).toEqual([
        expect.objectContaining({ key: 'gymLogoUrl' }),
      ]);
    }
    // ...while a registered gym scene really reads it.
    expect(readsKey(read(sourcesOf('FITNESS_STADIUM')[0]), 'gymLogoUrl')).toBe(
      true,
    );
  });
});

describe('identity registry — (2) placeholders are the renderer defaults, verbatim', () => {
  const rows = specRows.flatMap(({ type, spec }) =>
    (spec.placeholders || []).map(
      (p) => [type, spec.key, p.text, spec, p] as const,
    ),
  );

  it('there are placeholders to check', () => {
    expect(rows.length).toBeGreaterThan(20);
  });

  it.each(rows)('%s %s: %s', (type, key, text, spec, p) => {
    const sources =
      type === 'LOGO'
        ? p.when
          ? logoSourcesFor(p.when)
          : sourcesOf(type)
        : sourcesOf(type);
    expect(sources.length).toBeGreaterThan(0);
    for (const s of sources) {
      const src = sourceText(s);
      expect(isDefaultFor(src, key, text)).toBe(true);
      expect(readsKey(src, key)).toBe(true);
      if (spec.role !== 'logo') expect(src).toContain(`data-field="${key}"`);
    }
  });

  it('every text key carries data-field="key" in a renderer that reads it', () => {
    for (const { type, spec } of specRows) {
      if (spec.role === 'logo') continue;
      const ok = sourcesOf(type).some((s) => {
        const src = sourceText(s);
        return (
          readsKey(src, spec.key) && src.includes(`data-field="${spec.key}"`)
        );
      });
      expect([type, spec.key, ok]).toEqual([type, spec.key, true]);
    }
  });

  it('short initials are placeholders only on the athletics and Varsity renderers', () => {
    for (const { type, spec } of specRows) {
      if (spec.role !== 'initials') continue;
      for (const p of spec.placeholders || []) {
        if (type === 'LOGO')
          expect(p.when).toEqual({
            variants: ['logo-athletics'],
            themes: ['high-school-athletics'],
          });
        else expect(type).toMatch(/^HS_VARSITY(_PORTRAIT)?$/);
      }
    }
  });
});

describe('identity registry — (3) completeness', () => {
  const scanned = [
    ...listTsx('ms'),
    ...listTsx('hs'),
    ...listTsx('fitness'),
    ...listTsx('themes'),
    ...fs.readdirSync(WIDGETS).filter((f) => /^Animated.*\.tsx$/.test(f)),
    'v2/LogoWidgets.tsx',
  ];

  // file → the types it renders (inverse of sourcesOf over every type WidgetRenderer switches on).
  const typesOfFile = new Map<string, Set<string>>();
  const allTypes = new Set<string>([...CASE_COMPONENT.keys(), 'LOGO']);
  for (const type of allTypes) {
    let sources: string[] = [];
    try {
      sources = sourcesOf(type);
    } catch {
      continue;
    }
    for (const s of sources) {
      if (!typesOfFile.has(s)) typesOfFile.set(s, new Set());
      typesOfFile.get(s)!.add(type);
    }
  }
  const covered = (type: string, key: string) =>
    (identityKeysFor(type) || []).some((s) => s.key === key) ||
    Object.entries(EXCLUDED_IDENTITY_KEYS).some(
      ([t, list]) =>
        (t === type || t.startsWith(`${type}/`)) &&
        list.some((e) => e.key === key),
    );

  it('scans the renderer families', () => {
    expect(scanned.filter((f) => f.startsWith('ms/')).length).toBe(16);
    expect(
      scanned.filter((f) => f.startsWith('hs/')).length,
    ).toBeGreaterThanOrEqual(16);
  });

  it.each(scanned.map((f) => [f]))(
    '%s: every identity read is registered or excluded',
    (f) => {
      const reads = [...identityReads(read(f))];
      if (reads.length === 0) return;
      const types = typesOfFile.get(f);
      expect([f, types ? [...types] : 'renders no known type']).toEqual([
        f,
        expect.any(Array),
      ]);
      const missing = reads.filter(
        (k) => ![...types!].some((t) => covered(t, k)),
      );
      expect([f, missing]).toEqual([f, []]);
    },
  );

  it('themes/* identity reads all sit in LOGO renderers', () => {
    const logoComponents = new Set<string>([
      ...LOGO_THEME_COMPONENT.values(),
      ...[...VARIANT.values()]
        .filter((v) => v.widgetType === 'LOGO')
        .map((v) => v.render),
    ]);
    for (const f of listTsx('themes')) {
      let fn = '';
      for (const line of read(f).split('\n')) {
        const m = /^(?:export\s+)?(?:function|const)\s+([A-Za-z0-9_]+)/.exec(
          line,
        );
        if (m) fn = m[1];
        if (identityReads(line).size > 0)
          expect([f, fn, logoComponents.has(fn)]).toEqual([f, fn, true]);
      }
    }
  });

  it('exclusions: each has a reason, is not also registered, and names a key its renderer has', () => {
    const files: Record<string, string[]> = {
      SCOREBOARD: [
        'v2/SportsVenueWidgets.tsx',
        'sports/MainScoreboardWidget.tsx',
      ],
      'LOGO/logo-principals': [fileOf(VARIANT.get('logo-principals')!.render)],
      'LOGO/field-day': [fileOf(LOGO_THEME_COMPONENT.get('field-day')!)],
    };
    for (const [entry, list] of Object.entries(EXCLUDED_IDENTITY_KEYS)) {
      const type = entry.split('/')[0];
      for (const e of list) {
        expect(e.reason.trim().length).toBeGreaterThan(5);
        if (!entry.includes('/'))
          expect((identityKeysFor(type) || []).map((s) => s.key)).not.toContain(
            e.key,
          );
      }
      // STAFF_SPOTLIGHT's `initials` is #347's rule (a person's): no renderer
      // read to point at, pinned by brand-identity.spec.ts instead.
      if (entry === 'STAFF_SPOTLIGHT') continue;
      const srcs = (files[entry] ?? sourcesOf(type)).map(sourceText).join('\n');
      for (const e of list) {
        const declared = new RegExp(`['"]?${esc(e.key)}['"]?\\s*[?]?:`).test(
          srcs,
        );
        const marked = srcs.includes(`data-field="${e.key}"`);
        expect([
          entry,
          e.key,
          readsKey(srcs, e.key) || declared || marked,
        ]).toEqual([entry, e.key, true]);
      }
    }
    // logo-principals paints a hard-coded name and never reads schoolName.
    const principalsComponent = VARIANT.get('logo-principals')!.render;
    const principals = functionBody(
      read(fileOf(principalsComponent)),
      principalsComponent,
    );
    expect(principals).toContain('WASHINGTON');
    expect(readsKey(principals, 'schoolName')).toBe(false);
  });
});

describe('identity registry — (4) variants', () => {
  it('no variant is registered for a non-LOGO type in the table', () => {
    const variantTypes = new Set<string>(
      [...VARIANTS_SRC.matchAll(/\bwidgetType:\s*'([A-Z0-9_]+)'/g)].map(
        (m) => m[1],
      ),
    );
    const canonical =
      /const V2_CATEGORY_TO_CANONICAL[^=]*=\s*\{([\s\S]*?)\n\};/.exec(
        VARIANTS_SRC,
      )?.[1];
    expect(canonical).toBeTruthy();
    for (const m of canonical!.matchAll(/:\s*'([A-Z0-9_]+)'/g))
      variantTypes.add(m[1]);
    expect(variantTypes.has('LOGO')).toBe(true);
    expect(TYPES.filter((t) => t !== 'LOGO' && variantTypes.has(t))).toEqual(
      [],
    );
  });

  it("the v2 'Logos' ids derive to exactly the five in the table", () => {
    expect([...V2_LOGOS.keys()].sort()).toEqual(
      [...V2_LOGO_VARIANT_IDS].sort(),
    );
    for (const c of V2_LOGOS.values())
      expect(fileOf(c)).toBe('v2/LogoWidgets.tsx');
    expect(VARIANTS_SRC).toMatch(/'Logos':\s*'LOGO'/);
    const overrides =
      /const V2_ID_OVERRIDES[^=]*=\s*\{([\s\S]*?)\};/.exec(VARIANTS_SRC)?.[1] ??
      '';
    expect(overrides).not.toMatch(/LOGO_/);
  });
});

describe('identity registry — (5) the system catalogue ships no identity of its own', () => {
  const parse = (raw: unknown): Record<string, unknown> => {
    if (!raw) return {};
    if (typeof raw === 'string') {
      try {
        const v: unknown = JSON.parse(raw);
        return v && typeof v === 'object' && !Array.isArray(v)
          ? (v as Record<string, unknown>)
          : {};
      } catch {
        return {};
      }
    }
    return typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  };
  const nested = (cfg: Record<string, unknown>, key: string): unknown => {
    let v: unknown = cfg;
    for (const part of key.split('.')) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
      v = (v as Record<string, unknown>)[part];
    }
    return v;
  };
  const BOARD_TEXT = [
    ...BOARD_NAME_FIELDS,
    ...BOARD_TAGLINE_FIELDS,
    ...BOARD_INITIALS_FIELDS,
    ...BOARD_MONOGRAM_FIELDS,
  ];

  it('every identity value in a preset zone is a registered placeholder for that zone', () => {
    const offenders: string[] = [];
    let zones = 0;
    let registryZones = 0;
    for (const preset of ALL_PRESETS as unknown as Array<{
      id: string;
      zones?: Array<{ widgetType: string; defaultConfig?: unknown }>;
    }>) {
      for (const z of preset.zones || []) {
        zones += 1;
        const cfg = parse(z.defaultConfig);
        const specs = identityKeysFor(z.widgetType);
        const check = (key: string, value: unknown, ok: boolean) => {
          if (!isBlank(value) && !ok)
            offenders.push(
              `${preset.id} ${z.widgetType} ${key}=${JSON.stringify(value)}`,
            );
        };
        if (z.widgetType === 'EXTERNAL_HTML') {
          const text = parse(cfg.textOverrides);
          for (const k of BOARD_TEXT)
            check(`textOverrides.${k}`, text[k], false);
          const img = parse(cfg.imageOverrides);
          for (const k of BOARD_LOGO_SLOTS)
            check(`imageOverrides.${k}`, img[k], false);
        } else if (specs) {
          registryZones += 1;
          for (const spec of specs) {
            const ph = placeholdersFor(spec, cfg);
            check(spec.key, cfg[spec.key], isPlaceholder(cfg[spec.key], ph));
            if (spec.key.includes('.')) {
              const sh = nested(cfg, spec.key);
              check(`${spec.key} (nested)`, sh, isPlaceholder(sh, ph));
            }
          }
        } else if ('schoolName' in cfg) {
          for (const k of [
            'schoolName',
            'tagline',
            'initials',
            'schoolInitials',
          ])
            check(k, cfg[k], false);
        }
      }
    }
    expect(zones).toBeGreaterThan(500);
    expect(registryZones).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });
});

// ── (6) Generic placeholders (#347 round-3 review) ──
// A placeholder that is a word a tenant could type as their own ('WILDCATS',
// 'WHS', 'HS', 'CENTRAL ADMINISTRATION') is matched only on a template whose
// brand history has no value for that role (brand-identity.ts
// rolesWithHistory). Pin the set so a new generic literal is a decision.
describe('identity registry — (6) generic placeholders', () => {
  const generic = specRows.flatMap(({ type, spec }) =>
    (spec.placeholders || [])
      .filter((p) => p.generic)
      .map((p) => `${type} ${spec.key} ${p.text}`),
  );

  it('are exactly the mascot, abbreviation and office words', () => {
    expect(generic.sort()).toEqual([
      'HS_VARSITY schoolInitials WHS',
      'HS_VARSITY_PORTRAIT schoolInitials WHS',
      'HS_VARSITY_PORTRAIT schoolName WILDCATS',
      'LOGO initials HS',
      'LOGO schoolName CENTRAL ADMINISTRATION',
    ]);
  });

  it('every initials placeholder is generic (short initials are some school’s real abbreviation)', () => {
    for (const { type, spec } of specRows) {
      if (spec.role !== 'initials') continue;
      for (const p of spec.placeholders || [])
        expect([type, spec.key, p.text, p.generic]).toEqual([
          type,
          spec.key,
          p.text,
          true,
        ]);
    }
  });

  it('placeholdersFor { generic: false } drops only the generic ones', () => {
    const [portraitName, portraitInitials] =
      WIDGET_IDENTITY_KEYS.HS_VARSITY_PORTRAIT;
    expect(placeholdersFor(portraitName, {})).toEqual(['WILDCATS']);
    expect(placeholdersFor(portraitName, {}, { generic: false })).toEqual([]);
    expect(placeholdersFor(portraitInitials, {}, { generic: false })).toEqual(
      [],
    );
    const [landscapeName] = WIDGET_IDENTITY_KEYS.HS_VARSITY;
    expect(placeholdersFor(landscapeName, {}, { generic: false })).toEqual([
      'WESTRIDGE WILDCATS',
    ]);
    const logoName = WIDGET_IDENTITY_KEYS.LOGO.find(
      (s) => s.key === 'schoolName',
    )!;
    expect(
      placeholdersFor(
        logoName,
        { theme: 'office-dashboard' },
        { generic: false },
      ),
    ).toEqual([]);
    expect(
      placeholdersFor(logoName, { variant: 'logo-ops' }, { generic: false }),
    ).toEqual(['Roosevelt Academy']);
  });
});

// ── (7) LOGO's two logo keys: no renderer reads both ──
// Apply fills logoUrl AND assetUrl on a LOGO zone (#347). A typed logo in one
// could only be shadowed by the organisation's logo in the other if a
// renderer read both (`assetUrl || logoUrl`). Each LOGO renderer reads one:
// the v2 variants `logoUrl`, LogoWidget and its themed crests `assetUrl`.
describe('identity registry — (7) LOGO logo keys', () => {
  const components: Array<[string, string]> = [
    ...[...LOGO_THEME_COMPONENT.values()].map((c): [string, string] => [
      c,
      functionBody(read(fileOf(c)), c),
    ]),
    ...[...VARIANT.values()]
      .filter((v) => v.widgetType === 'LOGO')
      .map((v): [string, string] => [
        v.render,
        functionBody(read(fileOf(v.render)), v.render),
      ]),
    ...[...V2_LOGOS.values()].map((c): [string, string] => [
      c,
      functionBody(read(fileOf(c)), c),
    ]),
    ['LogoWidget', LOGO_WIDGET],
  ];
  const logoKeysRead = (body: string) =>
    ['logoUrl', 'assetUrl'].filter((k) => readsKey(body, k));

  it('finds the LOGO renderers', () => {
    expect(components.length).toBeGreaterThan(25);
  });

  it.each(components.map(([c, body]) => [c, body]))(
    '%s reads at most one of logoUrl / assetUrl',
    (_c, body) => {
      expect(logoKeysRead(body).length).toBeLessThanOrEqual(1);
    },
  );

  it('the v2 variants read logoUrl; LogoWidget and the themed crests read assetUrl (or no image)', () => {
    const v2 = new Set(V2_LOGOS.values());
    for (const c of v2)
      expect(logoKeysRead(functionBody(read(fileOf(c)), c))).toEqual([
        'logoUrl',
      ]);
    expect(logoKeysRead(LOGO_WIDGET)).toEqual(['assetUrl']);
    const others = components.filter(([c]) => !v2.has(c));
    expect(
      others.filter(([, body]) => logoKeysRead(body).includes('logoUrl')),
    ).toEqual([]);
    // The detector sees the crests' reads (most paint config.assetUrl).
    expect(
      others.filter(([, body]) => logoKeysRead(body).includes('assetUrl'))
        .length,
    ).toBeGreaterThan(15);
  });
});
