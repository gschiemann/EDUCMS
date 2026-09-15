/**
 * The "make it live" heuristic and the import marker (template-import Package
 * D, 2026-09-15). Pure module — no mount, no store, no DOM.
 *
 * Every live widget offered here must be one that KEEPS ITSELF CURRENT, and the
 * suggestion order must never be able to hide an option. Both are asserted
 * below, alongside a NEGATIVE CONTROL block that fails if the heuristic starts
 * matching text it has no business matching — the failure mode that would turn
 * a helpful ordering into noise nobody trusts.
 */
import {
  LIVE_WIDGETS,
  MAX_SUGGESTIONS,
  suggestLiveWidgets,
  zoneLiveText,
  zoneCopyPreview,
  isImportedTemplate,
  shouldOfferLiveHint,
  liveHintDismissKey,
  IMPORTED_DESCRIPTION_PREFIX,
} from '../make-it-live';
import type { Zone } from '../types';

function zone(over: Partial<Zone> = {}): Zone {
  return {
    id: 'z1',
    name: 'Text 1',
    widgetType: 'TEXT',
    x: 0, y: 0, width: 20, height: 10, zIndex: 1, sortOrder: 0,
    defaultConfig: {},
    ...over,
  } as Zone;
}
/** A zone whose only copy is `content` — the shape both import parsers emit. */
const imported = (content: string, over: Partial<Zone> = {}) =>
  zone({ name: content.slice(0, 40), defaultConfig: { content }, ...over });

const suggestedTypes = (z: Zone) => suggestLiveWidgets(z).suggested.map((s) => s.type);
const allOfferedTypes = (z: Zone) => {
  const { suggested, others } = suggestLiveWidgets(z);
  return [...suggested.map((s) => s.type), ...others.map((o) => o.type)];
};

describe('the live catalogue', () => {
  it('offers only widgets that keep themselves current', () => {
    // TICKER and ANNOUNCEMENT move but their copy is static config an operator
    // still retypes — listing them under "live" would be the same over-claim
    // the import copy is being fixed for.
    expect(LIVE_WIDGETS.map((w) => w.type)).toEqual([
      'CLOCK', 'LUNCH_MENU', 'BELL_SCHEDULE', 'COUNTDOWN', 'WEATHER', 'CALENDAR',
    ]);
    expect(LIVE_WIDGETS.map((w) => w.type)).not.toContain('TICKER');
    expect(LIVE_WIDGETS.map((w) => w.type)).not.toContain('ANNOUNCEMENT');
  });

  it('gives every entry an operator-facing label and a blurb — never an enum', () => {
    for (const w of LIVE_WIDGETS) {
      expect(w.label).toBeTruthy();
      expect(w.label).not.toMatch(/^[A-Z0-9]+(_[A-Z0-9]+)*$/);
      expect(w.blurb.length).toBeGreaterThan(10);
    }
  });
});

describe('suggestion order', () => {
  it('puts CLOCK first for a day name — the "TODAY: TUESDAY" case', () => {
    expect(suggestedTypes(imported('TODAY: TUESDAY'))[0]).toBe('CLOCK');
  });

  it.each([
    ['Today’s hours', 'CLOCK'],
    ['Wednesday', 'CLOCK'],
    ['Assembly at 9:45 AM', 'CLOCK'],
    ['September 15', 'CLOCK'],
    ['9/15/26', 'CLOCK'],
    ["Today's Lunch", 'LUNCH_MENU'],
    ['CAFETERIA', 'LUNCH_MENU'],
    ['Breakfast served 7-8', 'LUNCH_MENU'],
    ['Bell Schedule', 'BELL_SCHEDULE'],
    ['Period 3 — Chemistry', 'BELL_SCHEDULE'],
    ['Homeroom', 'BELL_SCHEDULE'],
    ['12 DAYS UNTIL GRADUATION', 'COUNTDOWN'],
    ['Countdown to spring break', 'COUNTDOWN'],
    ['Weather', 'WEATHER'],
    ['High: 72°F', 'WEATHER'],
    ['Upcoming Events', 'CALENDAR'],
    ['This week at Lincoln', 'CALENDAR'],
  ])('%s → suggests %s', (text, type) => {
    expect(suggestedTypes(imported(text))).toContain(type);
  });

  it('quotes back the exact phrase it matched, so the operator can disagree', () => {
    const [top] = suggestLiveWidgets(imported('TODAY: TUESDAY')).suggested;
    expect(top.because).toContain('TODAY');
    expect(top.because).toMatch(/goes out of date/i);
  });

  it('caps the promoted set so it stays an ordering, not a wall', () => {
    // Deliberately hits five rules at once.
    const busy = imported('Tuesday lunch menu — bell schedule, 5 days until the weather forecast');
    expect(suggestLiveWidgets(busy).suggested.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
  });

  it('never hides an option: every live widget is offered whether it matched or not', () => {
    const matched = imported('TODAY: TUESDAY');
    const unmatched = imported('Welcome to our school');
    for (const z of [matched, unmatched]) {
      expect(allOfferedTypes(z).sort()).toEqual(LIVE_WIDGETS.map((w) => w.type).sort());
    }
  });

  it('never offers the type the zone already is', () => {
    const asClock = zone({ widgetType: 'CLOCK', name: 'Tuesday', defaultConfig: {} });
    expect(allOfferedTypes(asClock)).not.toContain('CLOCK');
    expect(allOfferedTypes(asClock)).toHaveLength(LIVE_WIDGETS.length - 1);
  });

  it('reads the zone NAME as copy — an imported text zone is named after its text', () => {
    // Both import parsers set name = text.slice(0, 40), so on an imported board
    // the name IS the copy.
    expect(zoneLiveText(zone({ name: 'TODAY: TUESDAY', defaultConfig: {} }))).toContain('TUESDAY');
    expect(suggestedTypes(zone({ name: 'TODAY: TUESDAY', defaultConfig: {} }))).toContain('CLOCK');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROL — what must NOT match.
//
// A suggester that fires on everything is worse than none: the operator stops
// reading it. Widen a regex carelessly and one of these goes red.
// ───────────────────────────────────────────────────────────────────────────
describe('negative control — text that must NOT be promoted', () => {
  it('suggests nothing for plain signage copy', () => {
    for (const text of [
      'Welcome to Lincoln High School',
      'Go Wildcats!',
      'Room 204',
      'Please sign in at the front office',
      'Our mission is to inspire every learner',
    ]) {
      expect(suggestLiveWidgets(imported(text)).suggested).toHaveLength(0);
    }
  });

  it('does not read the English word "may" as a month', () => {
    expect(suggestedTypes(imported('You may enter through Door 4'))).toHaveLength(0);
    // …but a real date still lands.
    expect(suggestedTypes(imported('May 14 — Field Day'))).toContain('CLOCK');
  });

  it('does not read "Tuesday" as a countdown just because it ends in "day"', () => {
    expect(suggestedTypes(imported('Tuesday'))).not.toContain('COUNTDOWN');
  });

  it('does not read a degree-free number as weather', () => {
    expect(suggestedTypes(imported('Room 72'))).not.toContain('WEATHER');
    expect(suggestedTypes(imported('High five!'))).not.toContain('WEATHER');
  });

  it('does not read a plain word as a bell schedule', () => {
    expect(suggestedTypes(imported('Periodic table of elements'))).not.toContain('BELL_SCHEDULE');
  });

  it('ignores non-string config values rather than throwing', () => {
    const odd = zone({ name: '', defaultConfig: { content: 42, message: null, title: { a: 1 } } as never });
    expect(() => suggestLiveWidgets(odd)).not.toThrow();
    expect(zoneLiveText(odd)).toBe('');
  });

  it('survives a zone with no config at all', () => {
    expect(() => suggestLiveWidgets(zone({ name: '', defaultConfig: null }))).not.toThrow();
  });
});

describe('the copy a swap would discard', () => {
  it('quotes the content, not the zone name (the name survives the swap)', () => {
    expect(zoneCopyPreview(zone({ name: 'Headline', defaultConfig: { content: 'TODAY: TUESDAY' } })))
      .toBe('TODAY: TUESDAY');
  });
  it('flattens whitespace and truncates so a confirm dialog stays readable', () => {
    const long = zoneCopyPreview(zone({ defaultConfig: { content: `a${'b'.repeat(200)}` } }), 20);
    expect(long).toHaveLength(20);
    expect(long!.endsWith('…')).toBe(true);
    expect(zoneCopyPreview(zone({ defaultConfig: { content: ' one\n  two ' } }))).toBe('one two');
  });
  it('is null when there is nothing to lose', () => {
    expect(zoneCopyPreview(zone({ defaultConfig: {} }))).toBeNull();
  });
});

describe('telling an imported template apart', () => {
  it('recognises the marker the importer actually writes', () => {
    // imports.controller.ts writes exactly this on BOTH create paths.
    expect(isImportedTemplate('Imported from design upload on 2026-09-15')).toBe(true);
    expect(isImportedTemplate('Imported from canva on 2026-09-15')).toBe(true);
    expect(IMPORTED_DESCRIPTION_PREFIX).toBe('Imported from ');
  });

  it('does not fire on a hand-built template', () => {
    expect(isImportedTemplate('')).toBe(false);
    expect(isImportedTemplate(undefined)).toBe(false);
    expect(isImportedTemplate(null)).toBe(false);
    expect(isImportedTemplate('Lobby welcome board')).toBe(false);
    expect(isImportedTemplate('We imported this from PowerPoint')).toBe(false);
  });
});

describe('the import hint', () => {
  const desc = 'Imported from design upload on 2026-09-15';

  it('shows on an imported text zone whose copy the heuristic can name', () => {
    expect(shouldOfferLiveHint(imported('TODAY: TUESDAY'), desc)).toBe(true);
  });

  it('stays silent on a hand-built template, however stale the text looks', () => {
    expect(shouldOfferLiveHint(imported('TODAY: TUESDAY'), 'Lobby welcome board')).toBe(false);
    expect(shouldOfferLiveHint(imported('TODAY: TUESDAY'), '')).toBe(false);
  });

  it('stays silent when it has nothing specific to point at', () => {
    // No nagging with a generic "this might go stale" — the control is still
    // there, it just does not announce itself.
    expect(shouldOfferLiveHint(imported('Go Wildcats!'), desc)).toBe(false);
  });

  it('stays silent on a zone an import did not produce as text', () => {
    expect(shouldOfferLiveHint(imported('TODAY: TUESDAY', { widgetType: 'IMAGE' }), desc)).toBe(false);
    expect(shouldOfferLiveHint(imported('TODAY: TUESDAY', { widgetType: 'CLOCK' }), desc)).toBe(false);
  });

  it('is dismissed per template, not per zone — one deck, one tip', () => {
    expect(liveHintDismissKey('tpl-a')).not.toBe(liveHintDismissKey('tpl-b'));
    expect(liveHintDismissKey('tpl-a')).toContain('tpl-a');
  });
});
