/**
 * K-12 sports launch, lane B3 (2026-09-27). Greg: "make it visible for k-12 as
 * well". A school runs its own games, so the SPORTS widget pack — scoreboards,
 * the score / clock / period / stat elements, the swim and dive boards, the
 * venue pack and the celebrations — belongs in a K-12 builder palette too.
 * Every other vertical must be unchanged.
 *
 * Two proofs: the gate itself over the REAL registered catalogue, and the REAL
 * <VariantPicker /> (the component BuilderShell mounts for the widgets panel)
 * showing the tiles to a K-12 operator — in the "Game day" row, not mixed into
 * the school rows.
 */
import { render, screen, fireEvent, within } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import '@/components/widgets/variants-register';
import { listVariants } from '@/components/widgets/variants';
import { VariantPicker, variantVisibleForVertical, scopeVisibleToVertical } from '../VariantPicker';
import { useBuilderStore } from '../useBuilderStore';
import { useUIStore } from '@/store/ui-store';

beforeAll(() => {
  const g = globalThis as unknown as { ResizeObserver?: unknown };
  g.ResizeObserver =
    g.ResizeObserver ||
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
});

const SPORTS_TYPES = [
  'SCOREBOARD', 'SCORE_HOME', 'SCORE_AWAY', 'GAME_CLOCK', 'GAME_SEGMENT', 'GAME_STAT',
  'SWIM_LANE_GRID', 'DIVE_LEADERBOARD', 'STADIUM_MEET_BOARD',
];

const all = listVariants();
const sportsVariants = all.filter(
  (v) => v.vertical === 'SPORTS' || SPORTS_TYPES.includes(String(v.widgetType)),
);

describe('the palette gate', () => {
  it('has a real sports pack to gate (guard has teeth)', () => {
    expect(sportsVariants.length).toBeGreaterThan(100);
    const types = new Set(sportsVariants.map((v) => String(v.widgetType)));
    for (const t of SPORTS_TYPES) expect(types.has(t)).toBe(true);
    expect(types.has('CELEBRATION')).toBe(true);
  });

  it('a K-12 school sees every sports widget', () => {
    const hidden = sportsVariants.filter((v) => !variantVisibleForVertical(v, 'K12')).map((v) => v.id);
    expect(hidden).toEqual([]);
  });

  it('a sports venue still sees every sports widget', () => {
    expect(sportsVariants.every((v) => variantVisibleForVertical(v, 'SPORTS'))).toBe(true);
  });

  it.each(['GYM', 'RESTAURANT', 'QSR', 'BAR', 'CORPORATE', 'HEALTHCARE', 'RETAIL', 'WORSHIP', 'HOSPITALITY'])(
    'a %s tenant still sees none of them (other verticals unchanged)',
    (vertical) => {
      expect(sportsVariants.filter((v) => variantVisibleForVertical(v, vertical))).toEqual([]);
    },
  );

  it('opens nothing else to a school: food, bar, gym and retail packs stay out', () => {
    const leaked = all.filter(
      (v) =>
        /^(RESTAURANT|BAR_|FITNESS_|RETAIL)/.test(String(v.widgetType)) &&
        variantVisibleForVertical(v, 'K12'),
    );
    expect(leaked).toEqual([]);
    expect(scopeVisibleToVertical('GYM', 'K12')).toBe(false);
    expect(scopeVisibleToVertical('K12', 'SPORTS')).toBe(false);
  });
});

function mountPickerAs(vertical: string) {
  useUIStore.setState({ user: { role: 'SCHOOL_ADMIN', tenantVertical: vertical } } as unknown as Parameters<typeof useUIStore.setState>[0]);
  useBuilderStore.setState({ zones: [], selectedIds: [], past: [], future: [] } as unknown as Parameters<typeof useBuilderStore.setState>[0]);
  return render(
    <DndContext>
      <VariantPicker />
    </DndContext>,
  );
}

/** A palette row (`<section>`) by its heading text, or null. */
function rowNamed(title: string): HTMLElement | null {
  const heading = screen
    .queryAllByRole('heading', { level: 3 })
    .find((h) => (h.firstChild?.textContent ?? '').trim() === title);
  return (heading?.closest('section') as HTMLElement | null) ?? null;
}

describe('the rendered palette', () => {
  afterEach(() => useUIStore.setState({ user: null } as unknown as Parameters<typeof useUIStore.setState>[0]));

  it('a K-12 operator gets a "Game day" row with the live scoreboard in it', () => {
    mountPickerAs('K12');
    expect(rowNamed('Game day')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search widgets'), { target: { value: 'Main Scoreboard' } });
    expect(screen.getByText('Main Scoreboard (live)')).toBeTruthy();
  });

  it('a gym operator does not', () => {
    mountPickerAs('GYM');
    expect(rowNamed('Game day')).toBeNull();
    fireEvent.change(screen.getByLabelText('Search widgets'), { target: { value: 'Main Scoreboard' } });
    expect(screen.queryByText('Main Scoreboard (live)')).toBeNull();
  });

  it('the school rows are not flooded: the Words row still leads with school widgets', () => {
    mountPickerAs('K12');
    const words = rowNamed('Words & headlines');
    expect(words).toBeTruthy();
    expect(within(words as HTMLElement).queryByText(/scoreboard/i)).toBeNull();
  });
});
