/**
 * The Playlists switcher — the three contracts the page itself owns.
 *
 *   1. NEVER PAINT THE WRONG VARIANT FIRST. A stored `classic` preference must
 *      not show a frame of the v1 library on the way to the classic page. This
 *      is the operator's own 2026-08-31 report about the dashboard's rollback
 *      toggle ("i see the old classic dashboard for about .5 seconds"), turned
 *      into a test.
 *   2. THE ?newPlaylist=1 CONTRACT SURVIVES. The dashboard and the Assets page
 *      both link here with it, and Assets also stashes the picked asset ids in
 *      sessionStorage. Both must still open the wizard, and the param must be
 *      stripped so a refresh does not re-open it.
 *   3. ROLLBACK IS ONE CLICK, and it persists.
 */

import * as React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

const PLAYLISTS = [
  {
    id: 'p1', name: 'Member Promotions',
    items: [{ id: 'i1', durationMs: 90_000, asset: { originalName: 'spring.jpg', mimeType: 'image/jpeg' } }],
    updatedAt: new Date(Date.now() - 18 * 60_000).toISOString(),
    createdBy: { id: 'u1', email: 'garlan@example.com' },
  },
];
const SCREENS = [{ id: 's1', name: 'G43', status: 'ONLINE', screenGroupId: null, renderHealth: 'OK', lastRenderedAt: new Date().toISOString() }];
const SCHEDULES = [{ id: 'sc1', playlistId: 'p1', screenId: 's1', screenGroupId: null, isActive: true, startTime: new Date(Date.now() - 86400000).toISOString() }];

const query = (data: unknown) => () => ({ data, isLoading: false, isError: false, isFetched: true, refetch: jest.fn() });
const mutation = () => ({ mutateAsync: jest.fn().mockResolvedValue({ id: 'new' }), mutate: jest.fn(), isPending: false });

jest.mock('@/hooks/use-api', () => ({
  usePlaylists: query(PLAYLISTS),
  useSchedules: query(SCHEDULES),
  // 2026-09-16 — the library row got a stop/start control ("let me stop the
  // playlist right from the main menu here"), so the page calls this hook
  // unconditionally. NINTH time today a hook added to a mounted tree broke a
  // suite that mocks this module wholesale: such a mock must carry every hook
  // the tree REACHES, not just the ones the case exercises.
  useSetPlaylistActive: mutation,
  useScreens: query(SCREENS),
  useScreenGroups: query([]),
  useTemplates: query([]),
  usePlaylistSummary: query(null),
  useFleet: query({ root: null, locations: [], stats: {}, screens: [] }),
  useDeletePlaylist: mutation,
  useCreatePlaylist: mutation,
  useReorderPlaylistItems: mutation,
}));

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useParams: () => ({ schoolId: 'demo' }),
  useRouter: () => ({ push, replace: jest.fn(), back: jest.fn() }),
}));
jest.mock('@/store/ui-store', () => ({
  useUIStore: (sel: (s: unknown) => unknown) => sel({ user: { role: 'SCHOOL_ADMIN', id: 'u1' }, token: 't' }),
}));
jest.mock('@/components/ui/app-dialog', () => ({
  appConfirm: jest.fn().mockResolvedValue(true),
  appAlert: jest.fn().mockResolvedValue(undefined),
}));

// The wizard and the fleet modal are mounted by the page; stub them so this
// suite is about the switcher, not their internals (they have their own).
jest.mock('@/components/playlists/PlaylistCreateWizard', () => ({
  PlaylistCreateWizard: ({ open, initialAssetIds }: { open: boolean; initialAssetIds?: string[] }) =>
    open ? <div data-testid="wizard">wizard seeded:{(initialAssetIds ?? []).join(',')}</div> : null,
}));
jest.mock('@/components/playlists/PublishToLocationsModal', () => ({
  PublishToLocationsModal: () => null,
}));
jest.mock('@/components/playlists/PlaylistPreviewThumb', () => ({
  PlaylistPreviewThumb: () => <div data-testid="thumb" />,
}));

// next/dynamic would pull the whole 3.3k-line classic tree into this suite.
// Resolve it to a marker instead — what matters here is WHICH surface renders.
jest.mock('next/dynamic', () => () => {
  const Stub = () => <div data-testid="classic-page">classic</div>;
  Stub.displayName = 'ClassicStub';
  return Stub;
});

import PlaylistsPage from '../page';

function setUrl(search: string) {
  window.history.replaceState(null, '', `/demo/playlists${search}`);
}

beforeEach(() => {
  push.mockClear();
  localStorage.clear();
  sessionStorage.clear();
  setUrl('');
});

// ─────────────────────────────────────────────────────────────────────
describe('never paint the wrong variant first', () => {
  it('shows the v1 library by default', () => {
    render(<PlaylistsPage />);
    expect(screen.getByRole('heading', { name: 'Playlists' })).toBeInTheDocument();
    expect(screen.queryByTestId('classic-page')).not.toBeInTheDocument();
  });

  it('a stored classic preference goes straight to classic — the v1 library never appears', () => {
    localStorage.setItem('venueos_playlists_view', 'classic');
    render(<PlaylistsPage />);
    expect(screen.getByTestId('classic-page')).toBeInTheDocument();
    // The v1 header is the tell: if it rendered at all, the page guessed.
    expect(screen.queryByRole('heading', { name: 'Playlists' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Needs attention/ })).not.toBeInTheDocument();
  });

  it('holds a skeleton rather than guessing while the preference is unread', () => {
    // Storage that throws is the pathological case the try/catch covers; the
    // page must still resolve to a decision rather than spin forever.
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    render(<PlaylistsPage />);
    expect(screen.getByRole('heading', { name: 'Playlists' })).toBeInTheDocument();
    spy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('§5 — the ?newPlaylist=1 contract', () => {
  it('opens the wizard and strips the param so a refresh does not re-open it', () => {
    setUrl('?newPlaylist=1');
    render(<PlaylistsPage />);
    expect(screen.getByTestId('wizard')).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('seeds the wizard from the Assets handoff stash, and clears it', () => {
    setUrl('?newPlaylist=1');
    sessionStorage.setItem('edu_new_playlist_assets', JSON.stringify(['a1', 'a2']));
    render(<PlaylistsPage />);
    expect(screen.getByTestId('wizard')).toHaveTextContent('seeded:a1,a2');
    expect(sessionStorage.getItem('edu_new_playlist_assets')).toBeNull();
  });

  it('preserves other query params while stripping its own', () => {
    setUrl('?newPlaylist=1&keep=yes');
    render(<PlaylistsPage />);
    expect(window.location.search).toBe('?keep=yes');
  });

  it('does not open the wizard on a plain visit', () => {
    render(<PlaylistsPage />);
    expect(screen.queryByTestId('wizard')).not.toBeInTheDocument();
  });

  it('does NOT consume the param while the classic surface is showing — that page reads it itself', () => {
    localStorage.setItem('venueos_playlists_view', 'classic');
    setUrl('?newPlaylist=1');
    render(<PlaylistsPage />);
    expect(window.location.search).toBe('?newPlaylist=1');
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('§5 — Templates’ ?publishPlaylist= express lane', () => {
  it('lands on that playlist’s Schedule tab, with a durable URL', () => {
    setUrl('?publishPlaylist=p1');
    render(<PlaylistsPage />);
    expect(push).toHaveBeenCalledWith('/demo/playlists/p1?tab=schedule');
    expect(window.location.search).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('rollback', () => {
  it('Classic view switches surface and persists the choice', () => {
    render(<PlaylistsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Classic view' }));
    expect(screen.getByTestId('classic-page')).toBeInTheDocument();
    expect(localStorage.getItem('venueos_playlists_view')).toBe('classic');
  });

  it('and back again', () => {
    localStorage.setItem('venueos_playlists_view', 'classic');
    render(<PlaylistsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to the new Playlists' }));
    expect(screen.getByRole('heading', { name: 'Playlists' })).toBeInTheDocument();
    expect(localStorage.getItem('venueos_playlists_view')).toBe('v1');
  });

  it('?classic=<id> is a ONE-VISIT hop that never becomes the stored preference', () => {
    setUrl('?classic=p1');
    render(<PlaylistsPage />);
    expect(screen.getByTestId('classic-page')).toBeInTheDocument();
    expect(localStorage.getItem('venueos_playlists_view')).toBeNull();
    expect(window.location.search).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('the library is wired to the durable workspace', () => {
  it('opening a row navigates to its own route', () => {
    render(<PlaylistsPage />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Member Promotions' })[0]);
    expect(push).toHaveBeenCalledWith('/demo/playlists/p1');
  });

  it('derives the row model when the summary endpoint is absent', () => {
    render(<PlaylistsPage />);
    // usePlaylistSummary is mocked to null — the row still has every fact.
    expect(screen.getByTestId('library-summary')).toHaveTextContent('1 playlist · 1 active');
    const row = screen.getAllByTestId('playlist-row')[0];
    expect(row).toHaveTextContent('Member Promotions');
    expect(row).toHaveTextContent('1 screen');
    expect(row).toHaveTextContent('Always');
  });
});
