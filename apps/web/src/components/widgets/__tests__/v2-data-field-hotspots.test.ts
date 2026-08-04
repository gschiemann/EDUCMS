/**
 * §19 leg (c) — click-to-edit hotspots on the eight EDU v2 widget packs.
 *
 * `data-field="<configKey>"` is the contract BuilderZone reads: clicking such
 * an element on a selected zone makes it contentEditable and commits its
 * `innerText` back to `config[<key>]` (`enterFieldEdit`), AND it is the
 * selector the per-field style override is scoped to — BuilderZone and
 * player/page.tsx both emit
 * `[data-zone-id] [data-widget-content] [data-field="X"] { … !important }`
 * from `cfg._styles[X]`.
 *
 * On 2026-08-03 all eight packs had ZERO `data-field` attributes, so neither
 * mechanism could arm: no canvas click-to-edit, and per-field typography was
 * unreachable no matter what the panel wrote.
 *
 * These are static-source assertions on purpose. The alternative — mounting 40
 * widgets and asserting on rendered DOM — would only prove the attribute is
 * present when a config value happens to be set; the contract is that the
 * attribute is in the source at all, on every pack.
 */
import * as fs from 'fs';
import * as path from 'path';

const V2_DIR = path.join(__dirname, '..', 'v2');

/** The eight packs whose canonical widget type has a hand-built editor case. */
const PACKS = [
  'AnnouncementWidgets.tsx',
  'CalendarWidgets.tsx',
  'StaffWidgets.tsx',
  'CountdownWidgets.tsx',
  'LogoWidgets.tsx',
  'WeatherWidgets.tsx',
  'BellScheduleWidgets.tsx',
  'ClockWidgets.tsx',
] as const;

const read = (f: string) => fs.readFileSync(path.join(V2_DIR, f), 'utf8');

describe('v2 EDU packs expose data-field click-to-edit hotspots', () => {
  it.each(PACKS)('%s has at least one data-field hotspot', (file) => {
    expect(read(file)).toMatch(/data-field="/);
  });

  /**
   * The exact keys each pack hooks. Asserted as a SET rather than a count so
   * this is a real contract: dropping one during a redesign fails here.
   *
   * Some packs are legitimately thin because most of what they render is
   * derived, not operator text — a Calendar's rows come from the `events`
   * array (edited by the panel's ListItemsEditor, which §19 accepts for
   * "items addable / removable / reorderable"), and a Clock's digits are the
   * live time. Their scalar copy is all that a click-to-edit hotspot can
   * honestly own.
   */
  const EXPECTED: Record<string, string[]> = {
    'AnnouncementWidgets.tsx': ['cta', 'icon', 'label', 'message', 'title'],
    'CalendarWidgets.tsx': ['title'],
    'StaffWidgets.tsx': ['emoji', 'eyebrow', 'funFact', 'name', 'quote', 'role', 'subject'],
    'CountdownWidgets.tsx': ['eyebrow', 'label'],
    'LogoWidgets.tsx': ['established', 'schoolName', 'tagline'],
    'WeatherWidgets.tsx': ['location', 'staticDesc', 'staticIcon'],
    'BellScheduleWidgets.tsx': ['subtitle', 'title'],
    'ClockWidgets.tsx': ['label'],
  };

  it.each(PACKS)('%s hooks exactly its expected config keys', (file) => {
    const keys = Array.from(
      new Set(Array.from(read(file).matchAll(/data-field="([^"]+)"/g)).map((m) => m[1])),
    ).sort();
    expect(keys).toEqual(EXPECTED[file]);
  });

  it('every data-field key is a real config key the widget reads', () => {
    // A hotspot naming a key the widget never reads would silently write dead
    // config — the "adding entries to a registry without wiring them" failure
    // §19 calls out by name. Accepts `c.key` and `cfg?.key` (Countdown reads
    // its label through the `useCountdownLabel` helper, which takes `cfg`).
    for (const file of PACKS) {
      const src = read(file);
      const keys = new Set(
        Array.from(src.matchAll(/data-field="([^"]+)"/g)).map((m) => m[1]),
      );
      for (const key of keys) {
        const read_ = new RegExp(`\\b(?:c|cfg|config)\\??\\.${key}\\b`).test(src);
        expect({ file, key, read: read_ }).toEqual({ file, key, read: true });
      }
    }
  });

  it('no hotspot wraps decorated text (that would save the decoration)', () => {
    // enterFieldEdit commits the element's WHOLE innerText. So a hotspot may
    // not also contain a literal prefix/suffix — `▸ {c.cta}`, `★ … ★`,
    // `"{c.quote}"` etc. must wrap only the expression in an inner span.
    // Detect: a data-field opener whose children start with anything other
    // than the `{` of a JSX expression.
    for (const file of PACKS) {
      const src = read(file);
      const offenders: string[] = [];
      for (const m of src.matchAll(/data-field="[^"]+"[^<>]*>([^<{]*)\{/g)) {
        const leading = m[1];
        if (leading.trim() !== '') offenders.push(`${file}: "${leading.trim()}…"`);
      }
      expect(offenders).toEqual([]);
    }
  });
});
