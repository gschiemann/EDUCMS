/**
 * The Schedule tab's card has THREE states, not two.
 *
 * Greg, 2026-09-16, looking at a playlist whose header read ACTIVE · 10 screens ·
 * Always while the schedule row underneath was dimmed with a grey dot:
 *
 *   "why does this look like its not active..."
 *
 * It was dimmed to `opacity-60` because ONE of the ten rules behind that window
 * was paused, and the card keyed on `allActive` — every rule or nothing. A
 * schedule still running on nine of ten screens IS running; showing it as off
 * sends the operator hunting a problem that is one paused screen, and
 * simultaneously hides that paused screen behind a blanket "off" look.
 *
 * So: running (green) / partly paused (amber, and it says how many) / paused
 * everywhere (grey). These cases are what stop it collapsing back to two.
 */

import * as React from 'react';
import { render, screen as rtl, fireEvent, act, within } from '@testing-library/react';

const SCREENS = Array.from({ length: 10 }, (_, i) => ({
  id: `s${i + 1}`, name: `Screen ${i + 1}`, status: 'ONLINE', screenGroupId: null,
}));
const GROUPS: unknown[] = [];
const PLAYLISTS = [{ id: 'p1', name: 'Kings Portrait', items: [], isActive: true }];

/** Ten always-on rules on one window — `paused` many of them switched off. */
const schedulesWith = (paused: number) =>
  SCREENS.map((s, i) => ({
    id: `sc${i + 1}`,
    playlistId: 'p1',
    screenId: s.id,
    screenGroupId: null,
    isActive: i >= paused,
    daysOfWeek: null,
    timeStart: null,
    timeEnd: null,
    mutedOverride: null,
    startTime: '2026-09-16T00:00:00Z',
    priority: 0,
  }));

let SCHEDULES: any[] = schedulesWith(0);

const query = (data: unknown) => () => ({ data, isLoading: false, isError: false, refetch: jest.fn() });
const mutation = () => ({ mutateAsync: jest.fn().mockResolvedValue({ id: 'x' }), mutate: jest.fn(), isPending: false });

jest.mock('@/hooks/use-api', () => ({
  usePlaylists: query(PLAYLISTS),
  useAssets: query([]),
  useAssetFolders: query([]),
  useScreenGroups: query(GROUPS),
  useSchedules: () => ({ data: SCHEDULES, isLoading: false, isError: false, refetch: jest.fn() }),
  useScreens: query(SCREENS),
  useTemplates: query([]),
  useUsers: query([]),
  useFleet: query({ root: null, locations: [], stats: { total: 0, online: 0, offline: 0, locationCount: 0 }, screens: [] }),
  useCreatePlaylist: mutation,
  useDeletePlaylist: mutation,
  useReorderPlaylistItems: mutation,
  useCreateSchedule: mutation,
  useSetPlaylistSync: mutation,
  useDeleteSchedule: mutation,
  useToggleSchedule: mutation,
  useUpdateSchedule: mutation,
  useSetPlaylistActive: mutation,
  useCreateSubmission: mutation,
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

import PlaylistsPage from '../ClassicPlaylistsPage';

async function openScheduleTab() {
  const view = render(<PlaylistsPage />);
  await act(async () => {
    fireEvent.click(rtl.getByRole('button', { name: 'Open playlist Kings Portrait' }));
  });
  await act(async () => {
    // The tab label carries a count — "Schedules (10)" — so match the prefix.
    fireEvent.click(rtl.getByRole('button', { name: /^Schedules/ }));
  });
  return view;
}

/** The card element behind the "Every day · All day" heading. */
function scheduleCard(): HTMLElement {
  const heading = rtl.getByText(/Every day/);
  let el: HTMLElement | null = heading;
  while (el && !(el.className || '').includes('rounded-2xl')) el = el.parentElement;
  if (!el) throw new Error('schedule card not found');
  return el;
}

describe('the Schedule card tells the truth about how much is running', () => {
  it('ALL ten running → green, not dimmed, and no paused pill', async () => {
    SCHEDULES = schedulesWith(0);
    await openScheduleTab();
    const card = scheduleCard();
    expect(card.className).not.toContain('opacity-60');
    expect(card.className).toContain('emerald');
    expect(within(card).queryByText(/Paused on/)).not.toBeInTheDocument();
    expect(within(card).queryByText('Paused everywhere')).not.toBeInTheDocument();
  });

  it('ONE paused → still LIVE, and it says which count (the reported bug)', async () => {
    SCHEDULES = schedulesWith(1);
    await openScheduleTab();
    const card = scheduleCard();
    // The regression guard: this used to dim to 60% and read as "not active".
    expect(card.className).not.toContain('opacity-60');
    expect(card.className).toContain('emerald');
    expect(within(card).getByText('Paused on 1 of 10 screens')).toBeInTheDocument();
  });

  it('ALL paused → grey, dimmed, and says so plainly', async () => {
    SCHEDULES = schedulesWith(10);
    await openScheduleTab();
    const card = scheduleCard();
    expect(card.className).toContain('opacity-60');
    expect(within(card).getByText('Paused everywhere')).toBeInTheDocument();
    expect(within(card).queryByText(/Paused on/)).not.toBeInTheDocument();
  });
});
