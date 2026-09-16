/**
 * The playlists LINE view must name the screens it is playing on.
 *
 * Operator, 2026-08-25: *"line view still needs to tell me what screens its
 * playing on"*. The row's meta strip printed COUNTS only — a calendar icon with
 * "2/3" and a monitor icon with "1/2 online" — so a row could tell you two of
 * your boards were dark and still leave you guessing WHICH. The grid card had
 * the names all along; only the row withheld them.
 *
 * These are render tests against the REAL page (same mount pattern as
 * publish-sheet-blast-radius.test.tsx), switched into Line view through the
 * operator's own Tile/Line toggle. What they lock down:
 *
 *   1. Names, not counts — at 1, 2 and 5 assignments, using the SAME first-two
 *      + "+N" rule the grid footer uses.
 *   2. The online signal survives: an assigned-but-OFFLINE screen is still
 *      named, and the full roster with each screen's state is in the row title
 *      (the backstop behind "+N").
 *   3. A group reads as a group, not as a screen.
 *   4. Zero assignments reads as a sentence, not an empty gap.
 *   5. THE MOBILE INVARIANT (2026-05-29 P0-5): every one of those elements
 *      lives INSIDE the `hidden sm:flex` strip. That strip is desktop-only
 *      because this row over-packs on a phone and flex-shrink collapsed the
 *      playlist NAME to 0px wide. Nothing added here may escape it.
 */

import * as React from 'react';
import { render, screen as rtl, fireEvent, within } from '@testing-library/react';

const SCREENS = [
  { id: 's1', name: 'Lobby North', status: 'ONLINE', screenGroupId: 'g1' },
  { id: 's2', name: 'Lobby South', status: 'OFFLINE', screenGroupId: 'g1' },
  { id: 's3', name: 'Cafeteria', status: 'ONLINE', screenGroupId: 'g1' },
  { id: 's4', name: 'Gym Ribbon', status: 'ONLINE', screenGroupId: null },
  { id: 's5', name: 'Library Wall', status: 'OFFLINE', screenGroupId: null },
];
const GROUPS = [{ id: 'g1', name: 'Lobby Wall', screens: SCREENS.slice(0, 3) }];

const PLAYLISTS = [
  { id: 'p0', name: 'Nowhere Loop', items: [], isActive: true },
  { id: 'p1', name: 'One Screen', items: [], isActive: true },
  { id: 'p2', name: 'Two Screens', items: [], isActive: true },
  { id: 'p5', name: 'Five Screens', items: [], isActive: true },
  { id: 'pg', name: 'Group Only', items: [], isActive: true },
];

const sched = (id: string, playlistId: string, screenId: string | null, screenGroupId?: string) => ({
  id, playlistId, screenId, screenGroupId: screenGroupId ?? null, isActive: true,
});
const SCHEDULES = [
  sched('a1', 'p1', 's1'),
  sched('b1', 'p2', 's1'),
  sched('b2', 'p2', 's2'),
  sched('c1', 'p5', 's1'),
  sched('c2', 'p5', 's2'),
  sched('c3', 'p5', 's3'),
  sched('c4', 'p5', 's4'),
  sched('c5', 'p5', 's5'),
  sched('d1', 'pg', null, 'g1'),
];

const query = (data: unknown) => () => ({ data, isLoading: false, isError: false, refetch: jest.fn() });
const mutation = () => ({ mutateAsync: jest.fn().mockResolvedValue({ id: 'x' }), isPending: false });

jest.mock('@/hooks/use-api', () => ({
  usePlaylists: query(PLAYLISTS),
  useAssets: query([]),
  useAssetFolders: query([]),
  useScreenGroups: query(GROUPS),
  useSchedules: query(SCHEDULES),
  useScreens: query(SCREENS),
  useTemplates: query([]),
  useUsers: query([]),
  useFleet: query({ root: null, locations: [], stats: { total: 0, online: 0, offline: 0, locationCount: 0 }, screens: [] }),
  useCreatePlaylist: mutation,
  useDeletePlaylist: mutation,
  useReorderPlaylistItems: mutation,
  useCreateSchedule: mutation,
  useDeleteSchedule: mutation,
  useToggleSchedule: mutation,
  useUpdateSchedule: mutation,
  useSetPlaylistActive: mutation,
  useCreateSubmission: mutation,
  // The mounted PlaylistCreateWizard offers "Keep screens in sync" on its
  // screen step and applies it with a follow-up call after create, so this
  // hook is now called unconditionally anywhere the wizard mounts.
  useSetPlaylistSync: mutation,
  usePublishToFleet: () => ({ mutateAsync: jest.fn(), isPending: false, isError: false, reset: jest.fn() }),
}));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn(), refetchQueries: jest.fn() }),
}));
jest.mock('@/components/ui/app-dialog', () => ({
  appConfirm: jest.fn().mockResolvedValue(true),
  appAlert: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));
jest.mock('@/store/ui-store', () => ({
  useUIStore: (sel: (s: unknown) => unknown) =>
    sel({ user: { role: 'SCHOOL_ADMIN', id: 'u1' }, tenant: { id: 't1' } }),
}));

// Points at the CLASSIC page deliberately. These two suites guard behaviour
// that lives in ./ClassicPlaylistsPage.tsx (the pre-v1 library rows + the
// publish sheet's blast radius), which the Operations v1 rebuild preserved
// rather than rewrote — ../page is now the v1/classic switcher.
import PlaylistsPage from '../ClassicPlaylistsPage';

/** Mount the page and flip the operator's Tile/Line toggle to Line. */
function renderLineView() {
  const view = render(<PlaylistsPage />);
  fireEvent.click(rtl.getByRole('button', { name: /^Line$/i }));
  return view;
}

/** The row element for one playlist, found via its own "Open playlist X" hit area. */
function row(name: string): HTMLElement {
  const opener = rtl.getByRole('button', { name: `Open playlist ${name}` });
  return opener.parentElement as HTMLElement;
}

/** The assignment cell inside that row. */
function assignments(name: string): HTMLElement {
  return within(row(name)).getByTestId('row-assignments');
}

describe('Playlists — line view names the screens', () => {
  it('0 assignments: says so in words instead of leaving a gap', () => {
    renderLineView();
    expect(assignments('Nowhere Loop')).toHaveTextContent('Not assigned to any screen');
  });

  it('1 assignment: names the screen, no overflow badge', () => {
    renderLineView();
    const cell = assignments('One Screen');
    expect(cell).toHaveTextContent('Lobby North');
    expect(cell).not.toHaveTextContent('+');
    expect(cell).toHaveAttribute('title', 'Lobby North - Online');
  });

  it('2 assignments: names both, still no overflow badge', () => {
    renderLineView();
    const cell = assignments('Two Screens');
    expect(cell).toHaveTextContent('Lobby North');
    expect(cell).toHaveTextContent('Lobby South');
    expect(cell).not.toHaveTextContent('+');
  });

  it('2 assignments: an assigned-but-DARK screen is still named — and marked', () => {
    renderLineView();
    const cell = assignments('Two Screens');
    // Lobby South is OFFLINE. It must be visible BY NAME (the whole point of
    // the fix) and visually separated from the screens that are up.
    const dark = within(cell).getByText('Lobby South');
    expect(dark.className).toMatch(/text-amber-600/);
    const up = within(cell).getByText('Lobby North');
    expect(up.className).not.toMatch(/text-amber-600/);
    // ...and the title spells the state out for a screen reader / hover.
    expect(cell.getAttribute('title')).toBe('Lobby North - Online\nLobby South - Offline');
  });

  it('5 assignments: first two + "+3", with the full roster in the title', () => {
    renderLineView();
    const cell = assignments('Five Screens');
    expect(cell).toHaveTextContent('Lobby North');
    expect(cell).toHaveTextContent('Lobby South');
    expect(cell).toHaveTextContent('+3');
    // Not shown inline — but recoverable without opening the playlist.
    expect(cell).not.toHaveTextContent('Cafeteria');
    expect(cell.getAttribute('title')).toBe(
      [
        'Lobby North - Online',
        'Lobby South - Offline',
        'Cafeteria - Online',
        'Gym Ribbon - Online',
        'Library Wall - Offline',
      ].join('\n'),
    );
  });

  it('the count the row always had is still there — names were ADDED, not swapped in', () => {
    renderLineView();
    // 5 screens, 2 of them dark.
    expect(row('Five Screens')).toHaveTextContent('3/5 online');
    // Schedule count too.
    expect(row('Five Screens')).toHaveTextContent('5/5');
  });

  it('a GROUP reads as a group, not as a screen', () => {
    renderLineView();
    // A group assignment expands to its member screens upstream, so the group
    // itself lands in the overflow — but the title must still call it a group.
    const cell = assignments('Group Only');
    expect(cell.getAttribute('title')).toBe(
      ['Lobby North - Online', 'Lobby South - Offline', 'Cafeteria - Online', 'Lobby Wall - Screen group'].join('\n'),
    );
    expect(cell).toHaveTextContent('+2');
  });

  it('THE MOBILE INVARIANT: every added element stays inside the desktop-only strip', () => {
    renderLineView();
    for (const name of ['Nowhere Loop', 'One Screen', 'Five Screens', 'Group Only']) {
      const cell = assignments(name);
      const strip = cell.parentElement as HTMLElement;
      // The strip itself is the `hidden sm:flex` container — below `sm` the
      // whole thing is display:none and the playlist NAME owns the row.
      expect(strip.className).toContain('hidden');
      expect(strip.className).toContain('sm:flex');
      // ...and the name is NOT inside it, so it can never be squeezed by it.
      const heading = within(row(name)).getByRole('heading', { level: 3 });
      expect(strip.contains(heading)).toBe(false);
      expect((heading.parentElement?.parentElement as HTMLElement).className).toContain('min-w-0');
    }
  });
});
