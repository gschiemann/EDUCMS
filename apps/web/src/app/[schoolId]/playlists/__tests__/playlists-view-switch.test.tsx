/**
 * The Playlists route — the contracts the page itself owns.
 *
 *   1. THERE IS NO CLASSIC VIEW (2026-09-24). The route used to be a switcher
 *      with a per-user "Classic view" preference and a `?classic=<id>` deep
 *      link into the pre-v1 library. Greg: "why is a classic view option still
 *      showing...dump that shit, no more classic view". A stored preference
 *      from before the removal and the old deep link both land on v1, and no
 *      control on the page offers the old library.
 *   2. THE ?newPlaylist=1 CONTRACT SURVIVES. The dashboard and the Assets page
 *      both link here with it, and Assets also stashes the picked asset ids in
 *      sessionStorage. Both must still open the wizard, and the param must be
 *      stripped so a refresh does not re-open it.
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
describe('there is no classic view', () => {
  it('shows the v1 library, and offers no way into the old one', () => {
    render(<PlaylistsPage />);
    expect(screen.getByRole('heading', { name: 'Playlists' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /classic/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/classic view/i)).not.toBeInTheDocument();
  });

  it('a preference stored before the removal is ignored — v1 renders, nothing else', () => {
    localStorage.setItem('venueos_playlists_view', 'classic');
    render(<PlaylistsPage />);
    expect(screen.getByRole('heading', { name: 'Playlists' })).toBeInTheDocument();
    expect(screen.queryByText(/Back to the new Playlists/)).not.toBeInTheDocument();
  });

  it('the old ?classic=<id> deep link lands on v1 and is left alone (nothing consumes it)', () => {
    setUrl('?classic=p1');
    render(<PlaylistsPage />);
    expect(screen.getByRole('heading', { name: 'Playlists' })).toBeInTheDocument();
    expect(screen.queryByText(/Back to the new Playlists/)).not.toBeInTheDocument();
  });

  it('renders straight away even when storage throws — there is no preference to wait for', () => {
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
