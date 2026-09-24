/**
 * The Content tab's row controls are on the row, always, on every input.
 *
 * Greg, 2026-09-24, on an iPad: "when i click into an existing playlist, i
 * cant delete content once it has been added...we should have the little
 * trash can just like other menus" and "the gear icon only shows up once
 * you click on the content itself". Both buttons carried
 * `md:opacity-0 md:group-hover:opacity-100` — hidden until the pointer
 * hovered the row, and a touch screen has no hover: the trash was
 * unreachable on a tablet and the gear only surfaced after a blind tap had
 * toggled it. Same screenshot, first row: a video whose thumbnail was a
 * blank grey box — a <video preload="none"> with a hover-load trick, the
 * same no-hover problem.
 *
 * Runs against the REAL page (the classic editor the v1 workspace embeds),
 * with the fixture shape of the sibling suites. The hover assertions mock
 * HTMLMediaElement.prototype.play/pause, which jsdom does not implement.
 */
import * as React from 'react';
import { render, screen as rtl, fireEvent, within, act } from '@testing-library/react';
// jsdom 26 has no PointerEvent; without this, `pointerType` never reaches React.
import '../../../../../test-mocks/pointer-event-polyfill';

let mockRole = 'SCHOOL_ADMIN';

const POSTER_A1 = 'https://cdn.example.com/posters/a1.jpg';
const POSTER_L2 = 'https://cdn.example.com/posters/L2.jpg';

const asset = (id: string, originalName: string, mimeType: string, extra: Record<string, unknown> = {}) => ({
  id, originalName, mimeType, fileUrl: `https://cdn.example.com/${id}.${originalName.split('.').pop()}`, ...extra,
});
const item = (id: string, a: ReturnType<typeof asset>, order: number) => ({
  id, assetId: a.id, asset: a, durationMs: 10_000, sequenceOrder: order, muted: true,
});

const PLAYLISTS = [
  {
    id: 'p1', name: 'Friday Night', isActive: true,
    items: [
      item('i1', asset('a1', 'Kickoff.mp4', 'video/mp4', { posterUrl: POSTER_A1 }), 0),
      item('i2', asset('a2', 'Season Tickets.png', 'image/png'), 1),
      item('i3', asset('a3', 'Halftime.mp4', 'video/mp4', { posterUrl: null }), 2),
    ],
  },
];
const LIBRARY = [
  { ...asset('L1', 'wide.png', 'image/png'), folderId: null, status: 'PUBLISHED' },
  { ...asset('L2', 'promo.mp4', 'video/mp4', { posterUrl: POSTER_L2 }), folderId: null, status: 'PUBLISHED' },
  { ...asset('L3', 'raw.mp4', 'video/mp4', { posterUrl: null }), folderId: null, status: 'PUBLISHED' },
];

const query = (data: unknown) => () => ({ data, isLoading: false, isError: false, refetch: jest.fn() });
const mutation = () => ({ mutateAsync: jest.fn().mockResolvedValue({ id: 'x' }), isPending: false });

jest.mock('@/hooks/use-api', () => ({
  usePlaylists: query(PLAYLISTS),
  useAssets: query(LIBRARY),
  useAssetFolders: query([]),
  useScreenGroups: query([]),
  useSchedules: query([]),
  useScreens: query([]),
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
    sel({ user: { role: mockRole, id: 'u1' }, tenant: { id: 't1' } }),
}));

// The CLASSIC page, deliberately — it is what /[schoolId]/playlists/[playlistId]
// mounts as the Content tab.
import PlaylistsPage from '../ClassicPlaylistsPage';

const NAMES = ['Kickoff.mp4', 'Season Tickets.png', 'Halftime.mp4'];
const removeButtons = () => rtl.getAllByRole('button', { name: 'Remove slide' });
const settingsButtons = () => rtl.getAllByRole('button', { name: 'Slide settings' });
const saveButton = () => rtl.queryByRole('button', { name: 'Save' });
// The row STRIP (grip … trash) — it carries the dnd-kit attributes for an
// editor, none for a viewer, so key off its own class. The settings panel
// opens below it inside the card, so panel queries go through cardOf.
const rowOf = (name: string) => rtl.getByText(name).closest('.playlist-item-card') as HTMLElement;
const cardOf = (name: string) => rowOf(name).parentElement as HTMLElement;
const rowCheckbox = (name: string) => within(rowOf(name)).getByRole('checkbox');

let play: jest.SpyInstance;
let pause: jest.SpyInstance;
beforeEach(() => {
  mockRole = 'SCHOOL_ADMIN';
  play = jest.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  pause = jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});
afterEach(() => {
  play.mockRestore();
  pause.mockRestore();
});

describe('every row carries its own remove + settings buttons, visible without hover or a prior tap', () => {
  it('renders one of each per row on first paint, with no hover-reveal class', () => {
    render(<PlaylistsPage embedPlaylistId="p1" embedSection="content" />);
    expect(removeButtons()).toHaveLength(NAMES.length);
    expect(settingsButtons()).toHaveLength(NAMES.length);
    for (const b of [...removeButtons(), ...settingsButtons()]) {
      expect(b.className).not.toMatch(/opacity-0|group-hover/);
      expect(b.className).toMatch(/\bmin-h-11\b/); // 44 px on a phone
      expect(b).toBeVisible();
      expect(b).not.toBeDisabled();
      expect(b).toHaveAttribute('title');
    }
  });

  it('the trash removes the row and the Save button appears, enabled', () => {
    render(<PlaylistsPage embedPlaylistId="p1" embedSection="content" />);
    expect(saveButton()).toBeNull(); // nothing dirty yet
    fireEvent.click(within(rowOf('Kickoff.mp4')).getByRole('button', { name: 'Remove slide' }));
    expect(rtl.queryByText('Kickoff.mp4')).not.toBeInTheDocument();
    expect(rtl.getByText('Season Tickets.png')).toBeInTheDocument();
    expect(rtl.getByText('Halftime.mp4')).toBeInTheDocument();
    expect(removeButtons()).toHaveLength(2);
    expect(saveButton()).toBeEnabled();
  });

  it('a touch press on the trash is a tap, not a drag — the row is removed', () => {
    render(<PlaylistsPage embedPlaylistId="p1" embedSection="content" />);
    const trash = within(rowOf('Season Tickets.png')).getByRole('button', { name: 'Remove slide' });
    fireEvent.pointerDown(trash, { pointerType: 'touch', isPrimary: true });
    fireEvent.touchStart(trash);
    fireEvent.touchEnd(trash);
    fireEvent.pointerUp(trash, { pointerType: 'touch', isPrimary: true });
    fireEvent.click(trash);
    expect(rtl.queryByText('Season Tickets.png')).not.toBeInTheDocument();
    expect(rtl.getByText('Kickoff.mp4')).toBeInTheDocument();
    expect(rtl.getByText('Halftime.mp4')).toBeInTheDocument();
  });

  it('a mouse press-and-move on the trash or gear never activates a drag; the same on the grip does', async () => {
    render(<PlaylistsPage embedPlaylistId="p1" embedSection="content" />);
    const row = rowOf('Kickoff.mp4');
    const drag = (el: HTMLElement) => {
      fireEvent.mouseDown(el, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.mouseMove(document, { clientX: 60, clientY: 10 }); // well past the 8 px activation distance
    };
    // dnd-kit removes its document listeners — including a capture-phase
    // `click` stopPropagation that swallows the click after a drag — 50 ms
    // AFTER the drag ends (AbstractPointerSensor.detach → setTimeout(…, 50)).
    // Wait that out, or every click in every later test in this file is
    // silently eaten (bitten writing this suite: six unrelated failures).
    const release = async () => {
      fireEvent.mouseUp(document);
      await act(() => new Promise<void>((resolve) => setTimeout(resolve, 60)));
    };
    drag(within(row).getByRole('button', { name: 'Remove slide' }));
    expect(row).not.toHaveAttribute('aria-pressed', 'true');
    await release();
    drag(within(row).getByRole('button', { name: 'Slide settings' }));
    expect(row).not.toHaveAttribute('aria-pressed', 'true');
    await release();
    // Positive control: the grip IS the activator, so the harness can see a drag start.
    drag(within(row).getByRole('button', { name: 'Drag to reorder' }));
    expect(row).toHaveAttribute('aria-pressed', 'true');
    await release();
    expect(row).not.toHaveAttribute('aria-pressed', 'true');
  });

  it('the gear opens the slide settings for its row', () => {
    render(<PlaylistsPage embedPlaylistId="p1" embedSection="content" />);
    const gear = within(rowOf('Halftime.mp4')).getByRole('button', { name: 'Slide settings' });
    expect(gear).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(gear);
    expect(gear).toHaveAttribute('aria-expanded', 'true');
    expect(within(cardOf('Halftime.mp4')).getByLabelText('Slide Transition Effect')).toBeInTheDocument();
  });

  it('a viewer sees the trash, disabled', () => {
    mockRole = 'RESTRICTED_VIEWER';
    render(<PlaylistsPage embedPlaylistId="p1" embedSection="content" />);
    expect(removeButtons()).toHaveLength(NAMES.length);
    for (const b of removeButtons()) {
      expect(b).toBeDisabled();
      expect(b).toHaveAttribute('title', 'Read-only — viewer role');
    }
  });
});

describe('bulk remove from the selection toolbar', () => {
  it('appears only with a selection, removes exactly the selected rows, clears the selection, dirties the editor', () => {
    render(<PlaylistsPage embedPlaylistId="p1" embedSection="content" />);
    expect(rtl.queryByRole('button', { name: /selected slide/ })).toBeNull();
    expect(rtl.getByText('3 items')).toBeInTheDocument();

    fireEvent.click(rowCheckbox('Kickoff.mp4'));
    fireEvent.click(rowCheckbox('Season Tickets.png'));
    expect(rtl.getByText('2 selected')).toBeInTheDocument();
    const bulk = rtl.getByRole('button', { name: 'Remove 2 selected slides' });
    expect(bulk).toHaveTextContent('Remove 2');
    expect(bulk).toBeEnabled();
    expect(bulk.className).toMatch(/rose/);

    fireEvent.click(bulk);
    expect(rtl.queryByText('Kickoff.mp4')).not.toBeInTheDocument();
    expect(rtl.queryByText('Season Tickets.png')).not.toBeInTheDocument();
    expect(rtl.getByText('Halftime.mp4')).toBeInTheDocument();
    expect(rtl.getByText('1 items')).toBeInTheDocument(); // selection cleared
    expect(rtl.queryByRole('button', { name: /selected slide/ })).toBeNull();
    expect(rowCheckbox('Halftime.mp4')).not.toBeChecked();
    expect(saveButton()).toBeEnabled();
  });

  it('reads "Remove 1 selected slide" for a single selection', () => {
    render(<PlaylistsPage embedPlaylistId="p1" embedSection="content" />);
    fireEvent.click(rowCheckbox('Halftime.mp4'));
    expect(rtl.getByRole('button', { name: 'Remove 1 selected slide' })).toHaveTextContent('Remove 1');
  });

  it('is disabled for a viewer', () => {
    mockRole = 'RESTRICTED_VIEWER';
    render(<PlaylistsPage embedPlaylistId="p1" embedSection="content" />);
    fireEvent.click(rowCheckbox('Kickoff.mp4'));
    expect(rtl.getByRole('button', { name: 'Remove 1 selected slide' })).toBeDisabled();
  });
});

describe('video thumbnails', () => {
  it('a row whose video has a poster draws the poster <img>; one without falls back to the first-frame <video>', () => {
    render(<PlaylistsPage embedPlaylistId="p1" embedSection="content" />);
    const withPoster = rowOf('Kickoff.mp4');
    const poster = withPoster.querySelector('img') as HTMLImageElement;
    expect(poster.getAttribute('src')).toBe(POSTER_A1);
    expect(withPoster.querySelector('video')?.getAttribute('preload')).toBe('none'); // zero video bytes at rest
    expect(play).not.toHaveBeenCalled();

    const noPoster = rowOf('Halftime.mp4');
    expect(noPoster.querySelector('img')).toBeNull();
    const video = noPoster.querySelector('video') as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe('https://cdn.example.com/a3.mp4#t=0.1');
    expect(video.getAttribute('preload')).toBe('metadata');
  });

  it('hovering a row thumbnail with a mouse plays it; leaving pauses it; a touch does neither', () => {
    render(<PlaylistsPage embedPlaylistId="p1" embedSection="content" />);
    const tile = rowOf('Kickoff.mp4').querySelector('[data-video-preview]') as HTMLElement;
    fireEvent.pointerEnter(tile, { pointerType: 'touch' });
    fireEvent.pointerLeave(tile, { pointerType: 'touch' });
    expect(play).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();

    fireEvent.pointerEnter(tile, { pointerType: 'mouse' });
    expect(play).toHaveBeenCalledTimes(1);
    fireEvent.pointerLeave(tile, { pointerType: 'mouse' });
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('the Add Media picker gives its video tiles the same poster, with a measured orientation tag', () => {
    render(<PlaylistsPage embedPlaylistId="p1" embedSection="content" />);
    fireEvent.click(rtl.getAllByRole('button', { name: /Add Media/i })[0]);
    const tile = rtl.getByRole('button', { name: 'Select promo.mp4' });
    const poster = tile.querySelector('img') as HTMLImageElement;
    expect(poster.getAttribute('src')).toBe(POSTER_L2);
    expect(poster.className).toMatch(/\bobject-contain\b/);
    expect(within(tile).queryByTestId('asset-orientation')).toBeNull();
    Object.defineProperty(poster, 'naturalWidth', { configurable: true, value: 1080 });
    Object.defineProperty(poster, 'naturalHeight', { configurable: true, value: 1920 });
    fireEvent.load(poster);
    expect(within(tile).getByTestId('asset-orientation')).toHaveTextContent('Portrait');

    const raw = rtl.getByRole('button', { name: 'Select raw.mp4' });
    expect(raw.querySelector('img')).toBeNull();
    expect(raw.querySelector('video')?.getAttribute('src')).toBe('https://cdn.example.com/L3.mp4#t=0.1');
    expect(play).not.toHaveBeenCalled();
  });
});
