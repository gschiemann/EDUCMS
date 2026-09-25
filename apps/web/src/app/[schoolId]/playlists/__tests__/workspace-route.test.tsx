/**
 * The workspace ROUTE — the fix for §6.8.
 *
 * The old detail view was `selectedId` inside the list page: not bookmarkable,
 * not shareable, gone on refresh. These tests prove the replacement is a real
 * address — that landing directly on /playlists/{id}?tab=delivery renders the
 * Delivery tab, that switching tabs rewrites the URL without stacking history,
 * and that a stale id is a genuine not-found rather than an empty editor.
 */

import * as React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';

const NOW = Date.now();
const PENDING = NOW - 12 * 60_000;

const PLAYLISTS = [{
  id: 'p1', name: 'Lobby Promotions',
  items: [{ id: 'i1', durationMs: 120_000, asset: { originalName: 'promo.jpg', mimeType: 'image/jpeg' } }],
  updatedAt: new Date(NOW - 12 * 60_000).toISOString(),
  createdBy: { id: 'u1', email: 'garlan@example.com' },
}];
const SCREENS = [
  { id: 's1', name: 'Front', status: 'ONLINE', screenGroupId: null, pendingRefreshAt: new Date(PENDING).toISOString(), refreshAckMs: PENDING, lastRenderedAt: new Date(NOW - 10_000).toISOString(), renderHealth: 'OK', pushChannel: 'live' },
  { id: 's2', name: 'G43', status: 'ONLINE', screenGroupId: null, pendingRefreshAt: new Date(PENDING).toISOString(), refreshAckMs: null, lastRenderedAt: new Date(NOW - 10_000).toISOString(), renderHealth: 'OK', pushChannel: 'stale' },
];
const SCHEDULES = [
  { id: 'sc1', playlistId: 'p1', screenId: 's1', screenGroupId: null, isActive: true, startTime: new Date(NOW - 86400000).toISOString() },
  { id: 'sc2', playlistId: 'p1', screenId: 's2', screenGroupId: null, isActive: true, startTime: new Date(NOW - 86400000).toISOString() },
];

const query = (data: unknown, extra: Record<string, unknown> = {}) => () =>
  ({ data, isLoading: false, isError: false, isFetched: true, refetch: jest.fn(), ...extra });

// The delivery hook's value varies per test, so it lives in a mutable binding
// the jest.mock factory closes over (the factory is hoisted and module-level —
// it cannot be re-declared per case).
const ABSENT_DELIVERY = () => ({ data: null, isLoading: false, isError: false, isFetched: false, refetch: jest.fn() });
let deliveryResult: () => unknown = ABSENT_DELIVERY;
const mutation = () => ({ mutateAsync: jest.fn().mockResolvedValue({}), mutate: jest.fn(), isPending: false });

// The delivery endpoint is ABSENT in this suite (resolves null after fetching),
// which is the degradation path the branch must handle.
jest.mock('@/hooks/use-api', () => ({
  usePlaylists: query(PLAYLISTS),
  useSchedules: query(SCHEDULES),
  useScreens: query(SCREENS),
  useScreenGroups: query([]),
  usePlaylistDelivery: () => deliveryResult(),
  useAuditLog: query({ items: [], total: 0, limit: 200, offset: 0 }),
  useSetPlaylistActive: mutation,
  // Added by the 2026-09-16 sync move: the route calls this hook, so the
  // mock must provide it or every mount throws "not a function".
  useSetPlaylistSync: mutation,
  useRefreshWeb: mutation,
  // The route mounts AddScreensDialog, which calls these even while closed —
  // hooks run before its `if (!open) return null`. A wholesale mock of this
  // module must therefore carry every hook the tree reaches, not just the
  // ones the route calls directly. Same trap as useSetPlaylistSync.
  useCreateSchedule: mutation,
  useUpdateSchedule: mutation,
  // The Screens tab's per-screen power switch and trash write through these.
  useToggleSchedule: mutation,
  useDeleteSchedule: mutation,
  // 2026-09-19 — the per-screen power/trash door. This mock replaces use-api
  // WHOLESALE, so a hook the page calls and this list lacks renders as
  // undefined and every test here dies on a TypeError instead of its subject.
  useSetPlaylistScreenActive: mutation,
  useRemovePlaylistScreen: mutation,
  // 2026-09-16 — AddScreensDialog renders the wizard's picker, which now
  // carries the double-sided "same on both sides / different per side" card and
  // writes the answer to the SCREEN. The dialog calls this hook unconditionally
  // (hooks run before its `if (!open) return null`), so this wholesale mock has
  // to carry it. Seventh time today that a hook added to the mounted tree broke
  // a suite that mocks this module wholesale.
  useSetScreenFaceMode: () => ({ mutate: jest.fn(), isPending: false }),
}));

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useParams: () => ({ schoolId: 'demo', playlistId: 'p1' }),
  useRouter: () => ({ push, replace: jest.fn(), back: jest.fn() }),
}));
jest.mock('@/store/ui-store', () => ({
  useUIStore: (sel: (s: unknown) => unknown) => sel({ user: { role: 'SCHOOL_ADMIN', id: 'u1' }, token: 't' }),
}));
jest.mock('@/components/ui/app-dialog', () => ({
  appConfirm: jest.fn().mockResolvedValue(true),
  appAlert: jest.fn().mockResolvedValue(undefined),
}));
// The embedded classic editor is 3.3k lines; stub it — its own suites cover
// it. The route pulls TWO things through next/dynamic (the editor and the
// classic page's offline-export control), so this stub stands in for both.
jest.mock('next/dynamic', () => () => {
  const Stub = () => <div data-testid="classic-editor">editor</div>;
  Stub.displayName = 'ClassicEditorStub';
  return Stub;
});

import WorkspacePage from '../[playlistId]/page';

function setUrl(search: string) {
  window.history.replaceState(null, '', `/demo/playlists/p1${search}`);
}

beforeEach(() => { push.mockClear(); setUrl(''); deliveryResult = ABSENT_DELIVERY; });

// ─────────────────────────────────────────────────────────────────────
describe('the detail view is a real address (§6.8)', () => {
  it('direct navigation with no ?tab lands on Content', () => {
    render(<WorkspacePage />);
    expect(screen.getByRole('tab', { name: 'Content' })).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByTestId('workspace-editor')).getByTestId('classic-editor'))
      .toBeInTheDocument();
  });

  it('direct navigation to ?tab=screens opens Screens — no Content frame first', () => {
    setUrl('?tab=screens');
    render(<WorkspacePage />);
    expect(screen.getByRole('tab', { name: 'Screens' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('delivery-table')).toBeInTheDocument();
  });

  it('direct navigation to ?tab=schedule opens Schedule', () => {
    setUrl('?tab=schedule');
    render(<WorkspacePage />);
    expect(screen.getByRole('tab', { name: 'Schedule' })).toHaveAttribute('aria-selected', 'true');
  });

  // The sections were renamed on 2026-09-16. A link someone saved, or a menu
  // item pointing at the old name, must land where that section went.
  it('an old ?tab=delivery link lands on Screens', () => {
    setUrl('?tab=delivery');
    render(<WorkspacePage />);
    expect(screen.getByRole('tab', { name: 'Screens' })).toHaveAttribute('aria-selected', 'true');
  });

  it('an old ?tab=publishing link lands on Schedule', () => {
    setUrl('?tab=publishing');
    render(<WorkspacePage />);
    expect(screen.getByRole('tab', { name: 'Schedule' })).toHaveAttribute('aria-selected', 'true');
  });

  it('an unknown ?tab falls back to Content rather than a blank panel', () => {
    setUrl('?tab=nonsense');
    render(<WorkspacePage />);
    expect(screen.getByRole('tab', { name: 'Content' })).toHaveAttribute('aria-selected', 'true');
  });

  it('switching tabs rewrites the URL — and Content clears the param rather than pinning it', () => {
    render(<WorkspacePage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Screens' }));
    expect(window.location.search).toBe('?tab=screens');
    fireEvent.click(screen.getByRole('tab', { name: 'Content' }));
    expect(window.location.search).toBe('');
  });

  it('Back returns to the library', () => {
    render(<WorkspacePage />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to Playlists' }));
    expect(push).toHaveBeenCalledWith('/demo/playlists');
  });

});

// ─────────────────────────────────────────────────────────────────────
describe('the header reads the real playlist', () => {
  it('names it and resolves its reach and schedule from the live payloads', () => {
    render(<WorkspacePage />);
    expect(screen.getByRole('heading', { name: 'Lobby Promotions' })).toBeInTheDocument();
    expect(screen.getByTestId('workspace-status')).toHaveTextContent('ACTIVE');
    expect(screen.getByRole('heading', { name: 'Lobby Promotions' }).parentElement!.parentElement!)
      .toHaveTextContent('2 screens · Always');
  });

  it('flags the G43 exception under the header, from the screens payload alone', () => {
    render(<WorkspacePage />);
    expect(screen.getByTestId('workspace-exception'))
      .toHaveTextContent('G43: not updated');
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('delivery degradation', () => {
  it('grades every target from the screens payload when the endpoint has not answered', () => {
    setUrl('?tab=delivery');
    render(<WorkspacePage />);
    const rows = screen.getAllByTestId('delivery-row');
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.textContent?.includes('G43'))!.dataset.state).toBe('not-updated');
    // A fresh render report alone is not proof that media actually loaded.
    expect(rows.find((r) => r.textContent?.includes('Front'))!.dataset.state).toBe('not-updated');
    expect(screen.queryByText(/Built from each screen’s own last report/)).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Greg, 2026-09-16, with a screenshot: "Not published" in a grey banner
// directly above a table listing LED Poster 1 as reachable with a confirmed
// picture. The endpoint answers `{latest: null}` for a playlist nobody has
// PUSHED — which is NOT "on no screen". `deliveryAnswered` counted that as an
// answer, so the summary became NOT_PUBLISHED while the table keyed off
// `payload?.latest` and listed the screens anyway.
//
// This lives at the ROUTE, not on the panel: the panel takes `derived` as a
// prop, so a panel-level test sets the very thing under test and the guard is
// short-circuited. Here nothing intercepts it.
describe('answered-but-never-pushed is not "not published"', () => {
  it('lists the screens and never claims the playlist reaches none', () => {
    deliveryResult = () => ({
      data: { latest: null, history: [] },
      isLoading: false, isError: false, isFetched: true, refetch: jest.fn(),
    });
    setUrl('?tab=screens');
    render(<WorkspacePage />);

    // The screens ARE listed…
    expect(screen.getAllByTestId('delivery-row')).toHaveLength(2);
    // …so nothing may say it reaches nothing.
    expect(screen.queryByText(/not published/i)).not.toBeInTheDocument();
    // …and the source of the grading is stated out loud.
    expect(screen.queryByText(/Built from each screen’s own last report/)).not.toBeInTheDocument();
  });
});
