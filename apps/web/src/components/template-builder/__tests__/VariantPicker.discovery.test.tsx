/**
 * MOUNTED proof for Phase 2 of the template-builder program (2026-09-11).
 *
 * The operator, after a lost customer demo: *"when you click on widgets its
 * blank and i thought we were going to redesign all these fucking filter
 * pills we have, its a fucking ugly mess."*
 *
 * These mount the REAL <VariantPicker /> — the component BuilderShell actually
 * renders — against the REAL variant registry and the REAL store, because the
 * defect was never in a predicate. It was in what the panel PUT ON SCREEN for
 * a brand-new template: a grid of nothing, behind seven rows of chips, some
 * of which printed database enums. A predicate test cannot see any of that.
 */
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { VariantPicker } from '../VariantPicker';
import { useBuilderStore } from '../useBuilderStore';

// jsdom has no ResizeObserver; live tile previews observe their own box.
beforeAll(() => {
  (globalThis as any).ResizeObserver =
    (globalThis as any).ResizeObserver ||
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
});

/** Exactly what `templates/page.tsx` seeds for "Start from blank". */
const PLACEHOLDER_ZONE = {
  id: 'zone-blank',
  name: 'Full Screen',
  widgetType: 'EMPTY',
  x: 0, y: 0, width: 100, height: 100,
  zIndex: 0, sortOrder: 0,
  defaultConfig: {},
} as any;

const CLOCK_ZONE = {
  id: 'zone-clock',
  name: 'Clock 1',
  widgetType: 'CLOCK',
  x: 10, y: 10, width: 30, height: 20,
  zIndex: 1, sortOrder: 0,
  defaultConfig: {},
} as any;

function setZones(zones: any[], selectedIds: string[] = []) {
  act(() => {
    useBuilderStore.setState({
      zones, selectedIds, past: [], future: [], isDirty: false, activeFieldName: null,
    } as any);
  });
}

function mountPicker() {
  return render(
    <DndContext>
      <VariantPicker />
    </DndContext>,
  );
}

/**
 * Every tile the panel is offering right now, by its accessible name.
 * The negative lookahead keeps the ADD/REPLACE MODE buttons out — they are
 * controls, not widgets, and counting them would mask an empty grid.
 */
const TILE_NAME = /^Add (?!to board$)|^Replace .+ with /;
function tiles() {
  return screen.queryAllByRole('button', { name: TILE_NAME });
}

/**
 * A token that still reads like a database column. NO `\b` anchors: in a
 * textContent sweep an enum is routinely glued to the digits of an adjacent
 * count ("Brand & people66HOUSE_AD_BANNER"), and a word-boundary assertion
 * silently misses exactly that — which is how an earlier version of this
 * sweep passed against a deliberately broken label function.
 */
const LOOKS_LIKE_AN_ENUM = /[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+/;

describe('a brand-new template opens on widgets, not on nothing', () => {
  beforeEach(() => setZones([PLACEHOLDER_ZONE], [PLACEHOLDER_ZONE.id]));

  it('shows a real, non-empty set of widgets even though the only zone is the EMPTY placeholder', () => {
    // THE BUG: the selected placeholder locked the type filter to `EMPTY`,
    // for which ZERO variants are registered, so the panel rendered "No
    // variants match your filters yet" and nothing else.
    mountPicker();
    expect(tiles().length).toBeGreaterThanOrEqual(8);
    expect(screen.queryByText(/No variants match/i)).toBeNull();
  });

  it('leads with a curated "Start here" row, not the whole catalogue', () => {
    mountPicker();
    expect(screen.getByText('Start here')).toBeTruthy();
    // 701 variants are registered. The default view must show a tiny
    // fraction of them — the failure mode is a wall, in both directions.
    expect(tiles().length).toBeLessThan(120);
  });

  it('tells the operator the board is empty and that a click will fill it', () => {
    mountPicker();
    expect(screen.getByText(/board is still empty/i)).toBeTruthy();
    // Every tile says FILL, never "swap".
    expect(tiles()[0].getAttribute('aria-label')).toMatch(/^Add .* to your empty board$/);
  });

  it('clicking a widget FILLS the placeholder instead of stacking a box on top of it', () => {
    mountPicker();
    fireEvent.click(tiles()[0]);
    const state = useBuilderStore.getState();
    expect(state.zones).toHaveLength(1);               // no orphan placeholder left behind
    expect(state.zones[0].id).toBe(PLACEHOLDER_ZONE.id);
    expect(state.zones[0].widgetType).not.toBe('EMPTY');
    expect(state.zones[0].width).toBe(100);            // keeps the placeholder's geometry
    expect(state.past.length).toBe(1);                 // one undo step
  });
});

describe('the pill wall is gone', () => {
  beforeEach(() => setZones([PLACEHOLDER_ZONE], [PLACEHOLDER_ZONE.id]));

  it('renders ONE filter control, and its options stay closed until asked for', () => {
    mountPicker();
    expect(screen.getAllByRole('button', { name: /^Filters/ })).toHaveLength(1);
    expect(screen.queryByLabelText('Category')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    expect(screen.getByLabelText('Category')).toBeTruthy();
  });

  it('holds at most FOUR filter axes', () => {
    mountPicker();
    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    // One dropdown per axis — deliberately not a chip rail hiding in a popover.
    expect(screen.getAllByRole('combobox').length).toBeLessThanOrEqual(4);
  });

  it('never prints a raw widget-type enum anywhere on the panel', () => {
    // The twelve the operator could see: HOUSE_AD_BANNER, MUSIC_PLAYER,
    // STADIUM_MEET_BOARD and the nine FITNESS_* chips.
    //
    // Scope note: this walks the DEFAULT view plus every category expanded, so
    // it reaches every tile a click can reach. `widget-catalog.test.ts` is the
    // exhaustive companion — it asserts the label function over all 74
    // registered types, including ones this tenant's vertical hides.
    const { container } = mountPicker();
    // Report the offending token, not just "true" — a failure here should name
    // the enum that leaked.
    const firstEnum = (s: string | null) => s?.match(LOOKS_LIKE_AN_ENUM)?.[0] ?? null;
    /**
     * Text the PANEL writes, excluding each tile's live widget artwork — a few
     * widget designs print SCREAMING_SNAKE as decoration on purpose
     * (PHOTO_OPS_CONTACT_SHEET literally renders "● CONTACT_SHEET"), and that is
     * the widget's design, not a label this panel chose.
     */
    const panelText = () => {
      const clone = container.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('[data-tile-preview]').forEach((n) => n.remove());
      return clone.textContent;
    };
    const sweep = () => {
      expect(firstEnum(panelText())).toBeNull();
      for (const el of Array.from(container.querySelectorAll('[aria-label],[title]'))) {
        expect(firstEnum(el.getAttribute('aria-label'))).toBeNull();
        expect(firstEnum(el.getAttribute('title'))).toBeNull();
      }
    };
    sweep();
    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    sweep();
    const axis = screen.getByLabelText('Category') as HTMLSelectElement;
    for (const option of Array.from(axis.options)) {
      fireEvent.change(axis, { target: { value: option.value } });
      sweep();
    }
  });

  it('groups the library into named rows with a per-row "See all"', () => {
    mountPicker();
    expect(screen.getByText('Words & headlines')).toBeTruthy();
    expect(screen.getByText('Time & schedules')).toBeTruthy();
    expect(screen.getByText('Photos & video')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /See all/i }).length).toBeGreaterThan(3);
  });

  it('"See all" opens that one category and offers a one-click way back', () => {
    mountPicker();
    const before = tiles().length;
    const row = screen.getByText('Words & headlines').closest('section')!;
    fireEvent.click(within(row).getByRole('button', { name: /See all/i }));
    expect(tiles().length).toBeGreaterThan(6);
    expect(tiles().length).not.toBe(before);
    fireEvent.click(screen.getByRole('button', { name: /All widgets/i }));
    expect(screen.getByText('Start here')).toBeTruthy();
  });
});

describe('a filter that matches nothing always has an exit', () => {
  beforeEach(() => setZones([PLACEHOLDER_ZONE], [PLACEHOLDER_ZONE.id]));

  it('says why it is empty and puts the whole library one click away', () => {
    mountPicker();
    fireEvent.change(screen.getByLabelText('Search widgets'), {
      target: { value: 'zzzzz-no-such-widget' },
    });
    expect(tiles()).toHaveLength(0);
    const escape = screen.getByRole('button', { name: /Show all widgets/i });
    fireEvent.click(escape);
    expect(tiles().length).toBeGreaterThanOrEqual(8);
  });
});

describe('ADD and REPLACE are different gestures', () => {
  beforeEach(() => setZones([CLOCK_ZONE], [CLOCK_ZONE.id]));

  it('defaults to ADD when a real widget is selected — a click never silently swaps it', () => {
    mountPicker();
    const addMode = screen.getByRole('button', { name: 'Add to board' });
    expect(addMode.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /^Replace “Clock 1”$/ }).getAttribute('aria-pressed')).toBe('false');

    // Pick from the CATALOGUE, not the restyle row — the restyle row is a
    // deliberate replace surface and is asserted separately below.
    const library = screen.getByText('Most used').closest('section')!;
    fireEvent.click(within(library).getAllByRole('button', { name: /^Add / })[0]);
    expect(useBuilderStore.getState().zones).toHaveLength(2);
    expect(useBuilderStore.getState().zones[0].widgetType).toBe('CLOCK');
  });

  it('REPLACE is an explicit, labelled choice that keeps the zone in place', () => {
    mountPicker();
    fireEvent.click(screen.getByRole('button', { name: /^Replace “Clock 1”$/ }));
    const tile = screen.getAllByRole('button', { name: /^Replace “Clock 1” with / })[0];
    fireEvent.click(tile);
    const state = useBuilderStore.getState();
    expect(state.zones).toHaveLength(1);                 // replaced, not appended
    expect(state.zones[0].id).toBe(CLOCK_ZONE.id);
    expect(state.zones[0].x).toBe(10);                   // geometry preserved
    expect(state.past.length).toBe(1);                   // undoable
  });

  it('the restyle row is always a replace, and every tile says so', () => {
    mountPicker();
    const section = screen.getByText(/^Restyle “Clock 1”$/).closest('section')!;
    const restyleTiles = within(section).getAllByRole('button', { name: /^Replace “Clock 1” with / });
    expect(restyleTiles.length).toBeGreaterThan(0);
    fireEvent.click(restyleTiles[0]);
    expect(useBuilderStore.getState().zones).toHaveLength(1);
  });

  it('every tile is operable by keyboard — drag is never the only route', () => {
    mountPicker();
    const library = screen.getByText('Most used').closest('section')!;
    const tile = within(library).getAllByRole('button', { name: /^Add / })[0];
    expect(tile.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(tile, { key: 'Enter' });
    expect(useBuilderStore.getState().zones).toHaveLength(2);
  });
});

describe('industry chrome never leaks from an inferred vertical', () => {
  it('shows no school-level axis when the tenant vertical was only inferred', () => {
    // No user in the UI store ⇒ `normalizeVertical(undefined)` says K12 but
    // `verticalKnown` is false. A CORPORATE operator saw grade filters here.
    setZones([PLACEHOLDER_ZONE], [PLACEHOLDER_ZONE.id]);
    mountPicker();
    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    expect(screen.queryByLabelText('School level')).toBeNull();
  });
});
