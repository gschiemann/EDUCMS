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

  it('a widget that gained a hotspot is removed from the baseline', () => {
    const stale = (baseline.knownZeroHotspot as string[]).filter((id) => !zero.includes(id));
    // A spent exemption left in place is cover for the next regression on the
    // same id — the same rule the variant-registry baseline carries.
    expect(stale).toEqual([]);
  });
});
