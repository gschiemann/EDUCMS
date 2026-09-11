/**
 * §19 CLICK-TO-EDIT — every widget whose job is to show the operator's WORDS
 * must let them click those words on the canvas.
 *
 * WHY THIS EXISTS. CLAUDE.md §19 is explicit: "Adding entries to a registry
 * without wiring them into PropertiesPanel does not count — the operator must
 * actually be able to click the text and edit it." Nothing enforced the second
 * half. On 2026-09-11 the operator added the first widget of a customer demo,
 * clicked its text, and nothing happened; driving the builder end to end found
 * that 4 of the 12 widgets the picker recommends FIRST rendered text with no
 * hotspot at all, and this sweep then found 101 across the whole library.
 *
 * WHY IT MOUNTS. Which component renders a variant is decided at runtime by
 * `config.variant` and `config.theme` through lazy family chunks. Static
 * analysis cannot follow that, and this repo has been burned before by a gate
 * that passed because it was looking at a file nobody renders (CLAUDE.md #9).
 * So this goes through `WidgetPreview` — the exact path BuilderZone uses.
 *
 * WHAT COUNTS AS A HOTSPOT. Any of the three affordances BuilderZone honours:
 *   [data-field]            inline contenteditable, commits one config key
 *   [data-field-jump]       opens the real editor — for LIST-backed text where
 *                           typing over the rendered join would destroy rows
 *   [title="Click to edit"] EditableText's own textarea swap
 *
 * SCOPE. Only TEXT-BEARING widget types. A clock renders the time, a weather
 * sign renders a live forecast, an image renders an image — a hotspot on those
 * would imply you can type a new temperature. Their fields live in Properties
 * and that is correct.
 *
 * THE RATCHET. `widget-hotspot-baseline.json` lists what was already broken
 * when the gate landed. A variant NOT in the baseline with zero hotspots fails.
 * A baselined variant that now HAS one also fails, until its entry is deleted —
 * so the number only goes down and a fixed widget cannot silently regress.
 */

import { render } from '@testing-library/react';
import { WidgetPreview, warmVariantRegistry } from '../WidgetRenderer';
import { warmAllWidgetFamilies } from '../widget-families';
import { listVariants } from '../variants';
import '../variants-register';
import baseline from '../../../../tools/widget-hotspot-baseline.json';

class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

/**
 * Widget types whose visible content is the OPERATOR'S OWN WORDS. Everything
 * else renders computed or live data (CLOCK, WEATHER, live feeds), media
 * (IMAGE, VIDEO, carousels), or pure decoration — see SCOPE above. Adding a
 * new text widget type here is deliberate, and so is leaving one out.
 */
const TEXT_BEARING = new Set([
  'TEXT', 'RICH_TEXT', 'ANNOUNCEMENT', 'TICKER', 'COUNTDOWN', 'LUNCH_MENU',
  'BELL_SCHEDULE', 'STAFF_SPOTLIGHT', 'CALENDAR', 'QUOTE', 'MENU_BOARD', 'HEADLINE',
]);

const HOTSPOT_SELECTOR = '[data-field],[data-field-jump],[title="Click to edit"]';

jest.setTimeout(120_000);

describe('§19 — text widgets are click-to-edit on the canvas', () => {
  let zero: string[] = [];
  let scanned = 0;

  beforeAll(async () => {
    // Families load from their own chunks (P1-1), so a proxy renders `null`
    // until its chunk resolves. Without warming, EVERY widget would look
    // hotspot-free and this gate would be a false red for the whole library.
    await warmAllWidgetFamilies();
    await warmVariantRegistry();

    for (const v of listVariants()) {
      if (!TEXT_BEARING.has(String(v.widgetType))) continue;
      scanned++;
      const { container, unmount } = render(
        <div style={{ position: 'relative', width: 800, height: 400 }}>
          <WidgetPreview
            widgetType={String(v.widgetType)}
            config={{ ...(v.defaultConfig || {}), variant: v.id }}
            width={100}
            height={100}
            // The builder ALWAYS passes this. EditableText's `canEdit` is gated
            // on it, so omitting it would make every widget look broken.
            onConfigChange={() => {}}
          />
        </div>,
      );
      if (container.querySelectorAll(HOTSPOT_SELECTOR).length === 0) zero.push(v.id);
      unmount();
    }
    zero = zero.sort();
  });

  it('scans a meaningful slice of the library (guards against a false green)', () => {
    // If the registry or the family warm-up ever breaks, `scanned` collapses
    // and every assertion below passes vacuously. Pin the floor.
    expect(scanned).toBeGreaterThan(200);
  });

  it('no NEW text widget ships without a click-to-edit hotspot', () => {
    const known = new Set<string>(baseline.knownZeroHotspot as string[]);
    const regressions = zero.filter((id) => !known.has(id));
    expect(regressions).toEqual([]);
  });

  /**
   * A hotspot pointing at the WRONG SHAPE is worse than no hotspot — it does
   * not fail to work, it destroys the operator's data, and the count-based
   * checks above wave it through because an attribute is present.
   *
   * Two real cases, both live on master until 2026-09-11 and both found by
   * reading a diff rather than by any gate:
   *
   *   `ticker-gym` carried `data-field="messages"` on a node whose text is
   *   `messages.join(' /// ')` printed twice. Committing wrote that doubled
   *   string over the ARRAY; the next render called `.join()` on a string and
   *   THREW. One click and type killed the widget.
   *
   *   The default LUNCH_MENU rows carried `data-field="menu.0.day"`, but
   *   `config.menu` is a newline-delimited STRING. setByPath sees the `0`
   *   segment, runs `Array.isArray(existing) ? [...existing] : []` — throwing
   *   the string away — and the renderer then falls back to sample food. One
   *   edit replaced the whole week.
   *
   * The rule both violate: an INLINE `data-field` commits `innerText`, a
   * single string, so it may only target a key that holds a single string.
   * Anything list-shaped is `data-field-jump`, which opens the real editor
   * and commits nothing.
   */
  it('no inline hotspot targets a list-shaped key (that corrupts, it does not just fail)', () => {
    // PROBE the component, do not read `defaultConfig`. The first version of
    // this check did read it, passed with both known-destructive attributes
    // restored, and was therefore worth nothing: neither `ticker-gym` nor the
    // default LUNCH_MENU rows carry the offending key in their registration,
    // so `Array.isArray(undefined)` answered false and the check waved them
    // through. A gate has to be watched failing before it is believed.
    const MARK_A = 'zzprobealphazz';
    const MARK_B = 'zzprobebetazz';
    const offenders: string[] = [];

    /**
     * Mount and read back the hotspots. Returns null when the widget THREW.
     *
     * A throw is a real answer, not a test failure: it means the component
     * refused the probe's shape. `StaffModernCard` does `name.split(...)`, so
     * handing `staffName` an array crashes it — which proves that key is
     * string-shaped and therefore safe for an inline commit. Treating the
     * throw as "not list-shaped" is the CONSERVATIVE reading; the only way to
     * be flagged is to survive the probe AND render both elements.
     */
    const hotspotsOf = (v: { id: string; widgetType: unknown }, cfg: Record<string, unknown>) => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const { container, unmount } = render(
          <div style={{ position: 'relative', width: 800, height: 400 }}>
            <WidgetPreview widgetType={String(v.widgetType)} config={cfg} width={100} height={100} onConfigChange={() => {}} />
          </div>,
        );
        const out = Array.from(container.querySelectorAll('[data-field]')).map((el) => ({
          key: el.getAttribute('data-field') || '',
          text: el.textContent || '',
        }));
        unmount();
        return out;
      } catch {
        return null;
      } finally {
        spy.mockRestore();
      }
    };

    // Every registered variant, PLUS each bare widget type with no variant at
    // all. That second half is not padding: a zone whose config carries no
    // `variant` falls through to WidgetRenderer's own type dispatch, and those
    // default renderers are invisible to a variant-only sweep. The default
    // LUNCH_MENU rows — the worst corruption found on 2026-09-11, one edit
    // replacing the operator's whole week — live exactly there, and the first
    // version of this check could not see them.
    const subjects: Array<{ id: string; widgetType: unknown; defaultConfig?: unknown }> = [
      ...listVariants().filter((v) => TEXT_BEARING.has(String(v.widgetType))),
      ...[...TEXT_BEARING].map((t) => ({ id: `type:${t}`, widgetType: t, defaultConfig: {} })),
    ];

    for (const v of subjects) {
      const isType = v.id.startsWith('type:');
      const base = isType
        ? {}
        : { ...((v.defaultConfig || {}) as Record<string, unknown>), variant: v.id };
      for (const { key } of hotspotsOf(v, base) ?? []) {
        const head = key.split('.')[0];
        const dotted = /^[^.]+\.\d+(\.|$)/.test(key);

        if (!dotted) {
          // Feed the key a two-element ARRAY. If the node comes back holding
          // BOTH elements, it renders a join — so an inline commit would put
          // one flat string where a list lives. `ticker-gym` did exactly that
          // and the next render threw on `.join()` of a string.
          const probed = hotspotsOf(v, { ...base, [key]: [MARK_A, MARK_B] });
          const node = probed?.find((h) => h.key === key);
          // Both marks present is NOT enough: React renders an array passed
          // into a plain string slot by simply concatenating its children, so
          // every honest single-string field would look like a list. The
          // discriminator is the SEPARATOR — a real `.join(sep)` puts visible
          // glue between the elements (' /// ', ' ★ ', ' ◆ '); React's own
          // concatenation puts nothing. Only glue means the component is
          // rendering a list it will not get back from one flat innerText.
          const between = node?.text.match(
            new RegExp(`${MARK_A}([\\s\\S]*?)${MARK_B}`),
          )?.[1];
          // A bare "," is JS's DEFAULT array→string glue, not a deliberate
          // join: any code that stringifies the probe without joining it —
          // `${value}`, `String(value)`, `.toString()` — produces exactly
          // that. `staff-field-day` does `(config.bio || '…').toString()` on
          // a field that is genuinely one string, and was flagged for it.
          // Excluding "," can only ever MISS a real list joined on a bare
          // comma, which is the safe direction for a corruption check.
          const deliberateGlue = between !== undefined && between.trim().length > 0 && between.trim() !== ',';
          if (deliberateGlue) {
            offenders.push(
              `${v.id}: data-field="${key}" renders a list joined with ${JSON.stringify(between)} — use data-field-jump`,
            );
          }
        } else {
          // A dotted `a.N.b` tells setByPath to rebuild `a` as an ARRAY,
          // discarding whatever is there. That is CORRECT when the component
          // genuinely stores an array at `a`, and destructive when it cannot.
          //
          // So the question is not "is `a` a string right now" — the first
          // version asked that and flagged BELL_SCHEDULE, whose dotted keys
          // are right (normalizeBellSchedule accepts an array, and merely
          // TOLERATES a legacy string). The question is whether `a` can hold
          // an array AT ALL. Probe it: feed `a` an array carrying the marks
          // and see whether they reach the screen.
          //   BELL_SCHEDULE → normalizeBellSchedule honours the array → marks
          //     render → legitimate, not flagged.
          //   LUNCH_MENU    → normalizeMenuLines takes ONLY a string, so the
          //     array falls through to DEFAULT_MENU_LINES → marks never render
          //     → the dotted key could never do anything but destroy the
          //     operator's menu. Flagged.
          const asArray = hotspotsOf(v, {
            ...base,
            [head]: [
              { label: MARK_A, title: MARK_A, day: MARK_A, start: MARK_A, items: MARK_A, name: MARK_A },
              { label: MARK_B, title: MARK_B, day: MARK_B, start: MARK_B, items: MARK_B, name: MARK_B },
            ],
          });
          const arrayHonoured = asArray?.some((h) => h.text.includes(MARK_A));
          if (asArray !== null && !arrayHonoured) {
            offenders.push(
              `${v.id}: data-field="${key}" but config.${head} cannot hold an array — setByPath would discard it`,
            );
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('a widget that gained a hotspot is removed from the baseline', () => {
    const stale = (baseline.knownZeroHotspot as string[]).filter((id) => !zero.includes(id));
    // A spent exemption left in place is cover for the next regression on the
    // same id — the same rule the variant-registry baseline carries.
    expect(stale).toEqual([]);
  });
});
