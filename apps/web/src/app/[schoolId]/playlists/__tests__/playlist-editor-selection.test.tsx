/**
 * The playlist EDITOR (the Content tab of /[schoolId]/playlists/[playlistId], which
 * mounts ClassicPlaylistsPage) — the one select-all pattern (Greg, 2026-10-04:
 * "select all should be the same across the entire app… i dont want some random
 * button… that says select all").
 *
 *   - the item list's header carries ONE tri-state box, named "Select all items
 *     shown", and every row a box named "Select <file>";
 *   - the "Add Media" picker has NO "Select All" button: the same box sits at the
 *     start of a "Files N" line above the tiles, each tile has its own box, and the
 *     tile's picture is only a mouse convenience (hidden from assistive tech), so
 *     the checkbox is the one control a keyboard and a screen reader reach.
 */
import * as React from 'react';
import { render, screen as rtl, fireEvent, within } from '@testing-library/react';

const asset = (id: string, originalName: string) => ({
  id, originalName, fileUrl: `https://cdn.example.com/${id}.png`, mimeType: 'image/png',
});
const item = (id: string, a: ReturnType<typeof asset>, order: number) => ({
  id, assetId: a.id, asset: a, durationMs: 10_000, sequenceOrder: order, muted: true,
});

const PLAYLISTS = [
  {
    id: 'p1', name: 'Kings Landscape', isActive: true,
    items: [
      item('i1', asset('a1', 'Blackout Night.png'), 0),
      item('i2', asset('a2', 'Season Tickets.png'), 1),
      item('i3', asset('a3', 'Team Store.png'), 2),
    ],
  },
];
const LIBRARY = [
  { id: 'L1', originalName: 'wide.png', fileUrl: 'https://cdn.example.com/wide.png', mimeType: 'image/png', folderId: null, status: 'PUBLISHED' },
  { id: 'L2', originalName: 'tall.png', fileUrl: 'https://cdn.example.com/tall.png', mimeType: 'image/png', folderId: null, status: 'PUBLISHED' },
  { id: 'L3', originalName: 'square.png', fileUrl: 'https://cdn.example.com/square.png', mimeType: 'image/png', folderId: null, status: 'PUBLISHED' },
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
  useFleetOperations: query(undefined),
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
    sel({ user: { role: 'SCHOOL_ADMIN', id: 'u1' }, tenant: { id: 't1' } }),
}));

// The CLASSIC page, deliberately — it is what the workspace route mounts as the Content tab.
import PlaylistsPage from '../ClassicPlaylistsPage';

const mountEditor = () => render(<PlaylistsPage embedPlaylistId="p1" embedSection="content" />);
const header = () => rtl.getByRole('checkbox', { name: 'Select all items shown' }) as HTMLInputElement;
const rowBox = (name: string) => rtl.getByRole('checkbox', { name: `Select ${name}` }) as HTMLInputElement;

describe('the editor\'s item list — one tri-state select-all box', () => {
  it('has the box in its header, named for what it covers, and a named box on every row', () => {
    mountEditor();
    expect(rtl.getAllByRole('checkbox', { name: 'Select all items shown' })).toHaveLength(1);
    for (const n of ['Blackout Night.png', 'Season Tickets.png', 'Team Store.png']) {
      expect(rowBox(n)).toBeInTheDocument();
    }
  });

  it('is tri-state: none → all → some → all → none, and the rows follow', () => {
    mountEditor();
    expect(header().checked).toBe(false);
    expect(header().indeterminate).toBe(false);
    expect(rtl.getByText('3 items')).toBeInTheDocument();

    fireEvent.click(header()); // none → all
    expect(['Blackout Night.png', 'Season Tickets.png', 'Team Store.png'].every((n) => rowBox(n).checked)).toBe(true);
    expect(header().checked).toBe(true);
    expect(rtl.getByText('3 selected')).toBeInTheDocument();

    fireEvent.click(rowBox('Season Tickets.png')); // one off → the dash
    expect(header().checked).toBe(false);
    expect(header().indeterminate).toBe(true);
    expect(rtl.getByText('2 selected')).toBeInTheDocument();

    fireEvent.click(header()); // the dash selects the rest
    expect(header().checked).toBe(true);

    fireEvent.click(header()); // all → clear
    expect(['Blackout Night.png', 'Season Tickets.png', 'Team Store.png'].some((n) => rowBox(n).checked)).toBe(false);
    expect(rtl.getByText('3 items')).toBeInTheDocument();
  });

  it('still removes exactly the selected rows (what the bulk action does is unchanged)', () => {
    mountEditor();
    fireEvent.click(rowBox('Blackout Night.png'));
    fireEvent.click(rowBox('Team Store.png'));
    fireEvent.click(rtl.getByRole('button', { name: 'Remove 2 selected slides' }));
    expect(rtl.queryByText('Blackout Night.png')).toBeNull();
    expect(rtl.queryByText('Team Store.png')).toBeNull();
    expect(rtl.getByText('Season Tickets.png')).toBeInTheDocument();
  });
});

describe('the Add Media picker — the same box over the tiles, no "Select All" button', () => {
  const openPicker = () => {
    mountEditor();
    fireEvent.click(rtl.getAllByRole('button', { name: /Add Media/i })[0]);
    return rtl.getByRole('dialog', { name: /Choose Media/i });
  };
  const tileBox = (dialog: HTMLElement, name: string) => within(dialog).getByRole('checkbox', { name: `Select ${name}` }) as HTMLInputElement;

  it('has no stand-alone Select All button anywhere in it', () => {
    const dialog = openPicker();
    expect(within(dialog).queryByRole('button', { name: /select all/i })).toBeNull();
  });

  it('puts the box at the start of a "Files N" line above the tiles', () => {
    const dialog = openPicker();
    const box = within(dialog).getByRole('checkbox', { name: 'Select all files shown' });
    const heading = within(dialog).getByRole('heading', { name: /Files/ });
    expect(heading).toHaveTextContent('Files 3');
    expect(box.closest('div')).toBe(heading.closest('div'));
    expect(box.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is tri-state over the files shown, and the modal\'s own count follows', () => {
    const dialog = openPicker();
    const all = () => within(dialog).getByRole('checkbox', { name: 'Select all files shown' }) as HTMLInputElement;
    expect(within(dialog).getByText('0 selected')).toBeInTheDocument();

    fireEvent.click(all()); // none → every file shown
    expect(['wide.png', 'tall.png', 'square.png'].every((n) => tileBox(dialog, n).checked)).toBe(true);
    expect(all().checked).toBe(true);
    expect(within(dialog).getByText('3 selected')).toBeInTheDocument();

    fireEvent.click(tileBox(dialog, 'tall.png')); // one off → the dash
    expect(all().indeterminate).toBe(true);
    expect(all().checked).toBe(false);

    fireEvent.click(all()); // the dash selects the rest …
    expect(all().checked).toBe(true);
    fireEvent.click(all()); // … and all clears them
    expect(within(dialog).getByText('0 selected')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add Selected' })).toBeDisabled();
  });

  it('every tile has its own named box; the picture is not a second control for assistive tech', () => {
    const dialog = openPicker();
    expect(within(dialog).getAllByRole('checkbox', { name: /^Select (wide|tall|square)\.png$/ })).toHaveLength(3);
    // the tile's picture button is aria-hidden and out of the tab order — Playlists' PreviewOpener arrangement
    const hidden = Array.from(dialog.querySelectorAll('button[aria-hidden="true"]'));
    expect(hidden.length).toBeGreaterThanOrEqual(3);
    for (const b of hidden) expect(b).toHaveAttribute('tabindex', '-1');
  });

  it('clicking a tile\'s picture still toggles it (a mouse convenience), and the tile wears the shared selected look', () => {
    const dialog = openPicker();
    const tile = tileBox(dialog, 'wide.png').closest('[data-selected]') as HTMLElement;
    expect(tile).toHaveAttribute('data-selected', 'false');
    fireEvent.click(tile.querySelector('button[aria-hidden="true"]') as HTMLElement);
    expect(tile).toHaveAttribute('data-selected', 'true');
    expect(tileBox(dialog, 'wide.png').checked).toBe(true);
    expect(tile.className).toContain('border-indigo-500');
    expect(tile.className).toContain('ring-indigo-200');
  });

  it('a tile\'s box waits for the pointer until anything is selected, then every tile shows one (a phone has no pointer: it is always drawn)', () => {
    const dialog = openPicker();
    const chip = (n: string) => tileBox(dialog, n).parentElement!.parentElement as HTMLElement;
    expect(chip('wide.png').className).toContain('opacity-0');
    fireEvent.click(tileBox(dialog, 'wide.png'));
    expect(['wide.png', 'tall.png', 'square.png'].every((n) => !chip(n).className.includes('opacity-0'))).toBe(true);
  });
});

describe('the box explains itself on hover (Greg, 2026-10-04: "is a bare checkbox understood as select all?")', () => {
  const titleOf = (el: HTMLElement) => (el.closest('label') as HTMLElement).getAttribute('title');

  it('the item list\'s header box says "Select all items shown", and "Clear selection" once every item is selected', () => {
    mountEditor();
    expect(titleOf(header())).toBe('Select all items shown'); // none
    fireEvent.click(rowBox('Blackout Night.png')); // some
    expect(header().indeterminate).toBe(true);
    expect(titleOf(header())).toBe('Select all items shown');
    fireEvent.click(header()); // all
    expect(header().checked).toBe(true);
    expect(titleOf(header())).toBe('Clear selection');
    fireEvent.click(header()); // none again
    expect(titleOf(header())).toBe('Select all items shown');
  });

  it('every row box says "Select <file>"', () => {
    mountEditor();
    expect(titleOf(rowBox('Team Store.png'))).toBe('Select Team Store.png');
  });

  it('the Add Media picker\'s heading box says "Select all files shown", and "Clear selection" once every file shown is selected; its tiles say "Select <name>"', () => {
    mountEditor();
    fireEvent.click(rtl.getAllByRole('button', { name: /Add Media/i })[0]);
    const dialog = rtl.getByRole('dialog', { name: /Choose Media/i });
    const all = () => within(dialog).getByRole('checkbox', { name: 'Select all files shown' }) as HTMLInputElement;
    expect(titleOf(all())).toBe('Select all files shown');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Select wide.png' })); // some
    expect(titleOf(all())).toBe('Select all files shown');
    fireEvent.click(all()); // all
    expect(titleOf(all())).toBe('Clear selection');
    expect(titleOf(within(dialog).getByRole('checkbox', { name: 'Select tall.png' }))).toBe('Select tall.png');
  });
});
