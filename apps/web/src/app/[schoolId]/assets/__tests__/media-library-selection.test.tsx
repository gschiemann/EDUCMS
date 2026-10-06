/**
 * Media Library — ONE select-all pattern (Greg, 2026-10-04: "select all should
 * be the same across the entire app… it looks best on the playlist columns so
 * make the assets the same… i dont want some random button like you put that
 * says select all").
 *
 * Mounts the REAL page. What this locks down:
 *   - there is no stand-alone "Select all" button in the toolbar, in either view;
 *   - LIST view: the tri-state box is in the table header's FIRST column, over the
 *     rows shown — the Playlists table's box;
 *   - TILE view: the same box sits at the start of the files heading line;
 *   - "Select all N" lives in the bulk bar, only while more than what is selected
 *     matches, and it still reaches files that were never loaded (it pages through
 *     the library);
 *   - the 2026-10-04 safety rule survives: a select-EVERYTHING selection is dropped
 *     when the folder, filter or search changes, a hand-picked one is kept;
 *   - un-ticking the box after a select-everything clears all of it, including the
 *     files nobody can see;
 *   - clearing while "Select all" is still on its way is final.
 */

import * as React from 'react';
jest.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
import { render, screen as rtl, fireEvent, within, act } from '@testing-library/react';

const NOW = Date.now();
const iso = (minsAgo: number) => new Date(NOW - minsAgo * 60_000).toISOString();

const file = (i: number, over: Record<string, unknown> = {}) => ({
  id: `a${i}`,
  originalName: `File-${String(i).padStart(2, '0')}.jpg`,
  fileUrl: `https://cdn.example.com/a${i}.jpg`,
  mimeType: 'image/jpeg',
  fileSize: 1_000_000 + i,
  status: 'PUBLISHED',
  folderId: null,
  createdAt: iso(i + 1),
  uploadedBy: { id: 'u1', email: 'marketing@example.com' },
  processingMeta: { processedDimensions: { w: 1920, h: 1080 } },
  ...over,
});

/** The whole library on the server: 60 files. */
const SERVER_LIBRARY = Array.from({ length: 60 }, (_, i) => file(i));
/** What the page has loaded so far: the first three. */
const LOADED = SERVER_LIBRARY.slice(0, 3);

const FOLDERS = [
  { id: 'f1', name: 'Campaigns', parentId: null, updatedAt: iso(60 * 24 * 2), _count: { assets: 42, children: 0 } },
];

let assetsResponse: unknown = { assets: LOADED, total: SERVER_LIBRARY.length };
const apiFetchMock = jest.fn();

const query = (data: unknown) => () => ({ data, isLoading: false, isError: false, isFetching: false, refetch: jest.fn() });
const mutation = () => ({ mutateAsync: jest.fn().mockResolvedValue({ id: 'x' }), mutate: jest.fn(), isPending: false });

jest.mock('@/hooks/use-api', () => {
  const actual = jest.requireActual('@/hooks/use-api');
  return {
    normalizeAssetList: actual.normalizeAssetList,
    assetUsageQueryKey: actual.assetUsageQueryKey,
    fetchAssetUsage: jest.fn().mockRejectedValue(new Error('no usage endpoint')),
    useAssets: () => ({ data: assetsResponse, isLoading: false, isError: false, isFetching: false, refetch: jest.fn() }),
    useAssetFolders: query(FOLDERS),
    useAssetUsage: () => ({ data: undefined, isLoading: false, isError: true, refetch: jest.fn() }),
    useAddWebUrl: mutation,
    useDeleteAsset: mutation,
    useCreateAssetFolder: mutation,
    useRenameAssetFolder: mutation,
    useDeleteAssetFolder: mutation,
    useMoveAsset: mutation,
    useGenerateAltText: mutation,
    useUpdateAltText: mutation,
    useCheckAssetPlayback: mutation,
    useAssetStorageSummary: () => ({ data: { totalBytes: 1, totalFiles: 60, videos: { bytes: 0, files: 0 }, images: { bytes: 1, files: 60 }, other: { bytes: 0, files: 0 } }, isLoading: false }),
    useAssetStorageUsage: () => ({ data: undefined, isLoading: false, isError: false }),
  };
});
jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual('@/lib/api-client'),
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn(), refetchQueries: jest.fn(), fetchQuery: jest.fn().mockRejectedValue(new Error('no usage endpoint')) }),
}));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), useParams: () => ({ schoolId: 's1' }) }));
jest.mock('@/components/ui/app-dialog', () => ({
  appConfirm: jest.fn().mockResolvedValue(true),
  appAlert: jest.fn().mockResolvedValue(true),
}));
jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));
jest.mock('@/store/ui-store', () => ({
  useUIStore: Object.assign(
    (sel: (s: unknown) => unknown) => sel({ user: { role: 'SCHOOL_ADMIN', id: 'u1' }, token: 't' }),
    { getState: () => ({ token: 't' }) },
  ),
}));
jest.mock('@/components/ai/AiImageGenerateButton', () => ({
  useAiImageAvailable: () => false,
  AiImageModal: () => null,
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/hooks/use-video-optimization', () => {
  const actual = jest.requireActual('@/hooks/use-video-optimization');
  return { ...actual, useVideoOptimizationStatus: () => new Map() };
});

import AssetsPage from '../page';

/** The server's paged read: `/assets?take=1000&skip=N` */
function servePages() {
  apiFetchMock.mockImplementation(async (path: string) => {
    const url = new URL(path, 'http://x');
    const skip = Number(url.searchParams.get('skip') || 0);
    const take = Number(url.searchParams.get('take') || 50);
    return { assets: SERVER_LIBRARY.slice(skip, skip + take), total: SERVER_LIBRARY.length };
  });
}

const bar = () => rtl.queryByTestId('asset-bulk-bar');
const headerBox = () => rtl.getByRole('checkbox', { name: 'Select all files shown' }) as HTMLInputElement;
const tileBox = (i: number) => rtl.getByRole('checkbox', { name: `Select File-${String(i).padStart(2, '0')}.jpg` }) as HTMLInputElement;
const listView = () => fireEvent.click(rtl.getByRole('button', { name: 'List view' }));
const selectAllLink = () => within(rtl.getByTestId('asset-bulk-bar')).queryByRole('button', { name: /^Select all \d+$/ });

async function selectEverything() {
  fireEvent.click(headerBox());
  await act(async () => { fireEvent.click(selectAllLink() as HTMLElement); });
}

beforeEach(() => {
  assetsResponse = { assets: LOADED, total: SERVER_LIBRARY.length };
  apiFetchMock.mockReset();
  servePages();
});

describe('Media Library — no stand-alone "Select all" button', () => {
  it('the toolbar has none, in either view, with or without a selection', () => {
    render(<AssetsPage />);
    expect(rtl.queryByRole('button', { name: /^Select all/ })).not.toBeInTheDocument();
    listView();
    expect(rtl.queryByRole('button', { name: /^Select all/ })).not.toBeInTheDocument();
    fireEvent.click(headerBox());
    // …the only "Select all N" is inside the bulk bar
    expect(within(rtl.getByTestId('asset-bulk-bar')).getByRole('button', { name: 'Select all 60' })).toBeInTheDocument();
    expect(rtl.getAllByRole('button', { name: /^Select all/ })).toHaveLength(1);
  });
});

describe('Media Library — LIST view: the header box, over the rows shown', () => {
  it('sits in the table header\'s FIRST column — where the Playlists table has it', () => {
    render(<AssetsPage />);
    listView();
    const table = rtl.getByRole('table');
    const firstHeader = within(table).getAllByRole('columnheader')[0];
    expect(within(firstHeader).getByRole('checkbox', { name: 'Select all files shown' })).toBe(headerBox());
  });

  it('is tri-state: none → all → some → all → none, and every row follows it', () => {
    render(<AssetsPage />);
    listView();
    const rows = () => within(rtl.getByRole('table')).getAllByRole('checkbox', { name: /^Select File-/ }) as HTMLInputElement[];
    expect(rows()).toHaveLength(3);
    expect(headerBox().checked).toBe(false);
    expect(headerBox().indeterminate).toBe(false);

    fireEvent.click(headerBox()); // none → all shown
    expect(rows().every((r) => r.checked)).toBe(true);
    expect(headerBox().checked).toBe(true);
    expect(bar()).toHaveTextContent('3 assets selected');

    fireEvent.click(rows()[1]); // one row off → the dash
    expect(headerBox().checked).toBe(false);
    expect(headerBox().indeterminate).toBe(true);

    fireEvent.click(headerBox()); // the dash selects the rest
    expect(rows().every((r) => r.checked)).toBe(true);
    expect(headerBox().checked).toBe(true);

    fireEvent.click(headerBox()); // all → clears the rows shown
    expect(rows().some((r) => r.checked)).toBe(false);
    expect(bar()).not.toBeInTheDocument();
  });
});

describe('Media Library — TILE view: the same box, at the start of the files heading', () => {
  it('is in the heading line (not inside the heading), and is the only one', () => {
    render(<AssetsPage />);
    const box = headerBox();
    const heading = rtl.getByRole('heading', { name: /Recent files/ });
    expect(heading.contains(box)).toBe(false);
    // the heading's name stays exactly what it was
    expect(heading).toHaveTextContent('Recent files 60');
    // box and heading share one line, the box first
    expect(box.closest('div')).toBe(heading.closest('div'));
    expect(box.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rtl.getAllByRole('checkbox', { name: 'Select all files shown' })).toHaveLength(1);
  });

  it('moves into the table header in the list view — never both at once', () => {
    render(<AssetsPage />);
    listView();
    const heading = rtl.getByRole('heading', { name: /Recent files/ });
    expect(rtl.getAllByRole('checkbox', { name: 'Select all files shown' })).toHaveLength(1);
    expect(heading.parentElement?.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it('selects and clears the tiles shown, tri-state', () => {
    render(<AssetsPage />);
    fireEvent.click(headerBox());
    expect([0, 1, 2].every((i) => tileBox(i).checked)).toBe(true);
    fireEvent.click(tileBox(0));
    expect(headerBox().indeterminate).toBe(true);
    fireEvent.click(headerBox());
    expect(headerBox().checked).toBe(true);
    fireEvent.click(headerBox());
    expect(bar()).not.toBeInTheDocument();
  });

  it('shows no box at all when there is nothing to select', () => {
    assetsResponse = { assets: [], total: 0 };
    render(<AssetsPage />);
    expect(rtl.queryByRole('checkbox', { name: 'Select all files shown' })).not.toBeInTheDocument();
  });

  it('each tile\'s own box stays out of the way until something is selected, then every tile shows one', () => {
    render(<AssetsPage />);
    const chip = (i: number) => tileBox(i).parentElement!.parentElement as HTMLElement;
    expect(chip(0).className).toContain('opacity-0');
    expect(chip(2).className).toContain('opacity-0');
    fireEvent.click(tileBox(1));
    expect([0, 1, 2].every((i) => !chip(i).className.includes('opacity-0'))).toBe(true);
    // …and the selected tile carries the shared selected look
    expect(tileBox(1).closest('li')!.className).toContain('ring-indigo-200');
    expect(tileBox(0).closest('li')!.className).not.toContain('ring-indigo-200');
  });
});

describe('Media Library — "Select all N" lives in the bulk bar', () => {
  it('is offered once something is selected, and reaches files that were never loaded', async () => {
    render(<AssetsPage />);
    expect(bar()).not.toBeInTheDocument();
    fireEvent.click(tileBox(0));
    expect(selectAllLink()).toHaveTextContent('Select all 60');

    await act(async () => { fireEvent.click(selectAllLink() as HTMLElement); });
    expect(apiFetchMock).toHaveBeenCalledWith('/assets?take=1000&skip=0');
    expect(bar()).toHaveTextContent('60 assets selected');
    // everything is selected, so there is nothing more to offer
    expect(selectAllLink()).toBeNull();
    // and the box above the tiles agrees
    expect(headerBox().checked).toBe(true);
  });

  it('is not offered when everything that matches is already on screen', () => {
    assetsResponse = { assets: LOADED, total: LOADED.length };
    render(<AssetsPage />);
    fireEvent.click(headerBox());
    expect(bar()).toHaveTextContent('3 assets selected');
    expect(selectAllLink()).toBeNull();
  });

  it('is offered again once a file is un-ticked from a select-everything selection', async () => {
    render(<AssetsPage />);
    await selectEverything();
    expect(selectAllLink()).toBeNull();
    fireEvent.click(tileBox(0));
    expect(bar()).toHaveTextContent('59 assets selected');
    expect(selectAllLink()).toHaveTextContent('Select all 60');
  });

  it('reads "Selecting…" while it works, and Clear then cancels it for good', async () => {
    let finish: (v: unknown) => void = () => {};
    apiFetchMock.mockImplementation(() => new Promise((res) => { finish = res; }));
    render(<AssetsPage />);
    fireEvent.click(tileBox(0));
    await act(async () => { fireEvent.click(selectAllLink() as HTMLElement); });
    const link = within(rtl.getByTestId('asset-bulk-bar')).getByRole('button', { name: 'Selecting…' });
    expect(link).toBeDisabled();
    // the header box stands down too while the request is out
    expect(headerBox()).toBeDisabled();

    fireEvent.click(within(rtl.getByTestId('asset-bulk-bar')).getByRole('button', { name: /Clear selection/ }));
    expect(bar()).not.toBeInTheDocument();
    // the late answer must not fill the selection back in
    await act(async () => { finish({ assets: SERVER_LIBRARY, total: SERVER_LIBRARY.length }); });
    expect(bar()).not.toBeInTheDocument();
    expect(headerBox().checked).toBe(false);
  });
});

describe('Media Library — un-ticking the box after a select-everything', () => {
  it('clears ALL of it, including the files nobody can see', async () => {
    render(<AssetsPage />);
    await selectEverything();
    expect(bar()).toHaveTextContent('60 assets selected');
    fireEvent.click(headerBox()); // checked → clear
    expect(bar()).not.toBeInTheDocument();
    expect(headerBox().checked).toBe(false);
  });
});

describe('Media Library — the 2026-10-04 safety rule survives', () => {
  it('a select-EVERYTHING selection is dropped when the FOLDER changes', async () => {
    render(<AssetsPage />);
    await selectEverything();
    expect(bar()).toHaveTextContent('60 assets selected');
    fireEvent.click(rtl.getByRole('button', { name: 'Open folder Campaigns' }));
    expect(bar()).not.toBeInTheDocument();
  });

  it('…when the FILTER changes', async () => {
    render(<AssetsPage />);
    await selectEverything();
    fireEvent.click(rtl.getByRole('button', { name: /^Videos/ }));
    expect(bar()).not.toBeInTheDocument();
  });

  it('…when the SEARCH changes', async () => {
    render(<AssetsPage />);
    await selectEverything();
    fireEvent.change(rtl.getByLabelText('Search the media library'), { target: { value: 'file-0' } });
    expect(bar()).not.toBeInTheDocument();
  });

  it('a HAND-PICKED selection is kept across a folder change, so files can still be gathered', () => {
    render(<AssetsPage />);
    fireEvent.click(tileBox(0));
    expect(bar()).toHaveTextContent('1 asset selected');
    fireEvent.click(rtl.getByRole('button', { name: 'Open folder Campaigns' }));
    expect(bar()).toHaveTextContent('1 asset selected');
  });

  it('the box above the list selects what is SHOWN, so it is hand-picked too: kept across a folder change', () => {
    render(<AssetsPage />);
    fireEvent.click(headerBox());
    expect(bar()).toHaveTextContent('3 assets selected');
    fireEvent.click(rtl.getByRole('button', { name: 'Open folder Campaigns' }));
    expect(bar()).toHaveTextContent('3 assets selected');
  });

  it('a select-everything that was cleared does not leave its flag behind to eat a later hand-pick', async () => {
    render(<AssetsPage />);
    await selectEverything();
    fireEvent.click(within(rtl.getByTestId('asset-bulk-bar')).getByRole('button', { name: /Clear selection/ }));
    fireEvent.click(tileBox(0)); // a fresh, hand-picked selection
    fireEvent.click(rtl.getByRole('button', { name: 'Open folder Campaigns' }));
    expect(bar()).toHaveTextContent('1 asset selected');
  });

  it('…nor one that was emptied by un-ticking every file, one at a time', async () => {
    // A small library that is fully on screen: pick one, take "Select all 5", then
    // un-tick all five. The selection is empty — and it must not still count as
    // "everything", or the next hand-pick would be dropped by the next folder change.
    const five = SERVER_LIBRARY.slice(0, 5);
    assetsResponse = { assets: five, total: five.length };
    apiFetchMock.mockImplementation(async () => ({ assets: five, total: five.length }));
    render(<AssetsPage />);
    fireEvent.click(tileBox(0));
    await act(async () => { fireEvent.click(selectAllLink() as HTMLElement); });
    expect(bar()).toHaveTextContent('5 assets selected');
    for (let i = 0; i < 5; i += 1) fireEvent.click(tileBox(i));
    expect(bar()).not.toBeInTheDocument();

    fireEvent.click(tileBox(2)); // a fresh, hand-picked selection
    fireEvent.click(rtl.getByRole('button', { name: 'Open folder Campaigns' }));
    expect(bar()).toHaveTextContent('1 asset selected');
  });
});

describe('Media Library — the box covers only the rows SHOWN', () => {
  it('with a search narrowing the list, it selects the matches and offers nothing more', () => {
    render(<AssetsPage />);
    fireEvent.change(rtl.getByLabelText('Search the media library'), { target: { value: 'file-01' } });
    expect(rtl.getByRole('heading', { name: /Search results/ })).toHaveTextContent('Search results 1');
    fireEvent.click(headerBox());
    expect(bar()).toHaveTextContent('1 asset selected');
    expect(selectAllLink()).toBeNull();
  });
});

describe('Media Library — the box explains itself on hover (Greg, 2026-10-04: "is a bare checkbox understood as select all?")', () => {
  const titleOf = (el: HTMLElement) => (el.closest('label') as HTMLElement).getAttribute('title');

  it('TILES: the heading box says "Select all files shown", and "Clear selection" once every tile shown is selected', () => {
    render(<AssetsPage />);
    expect(titleOf(headerBox())).toBe('Select all files shown'); // none
    fireEvent.click(tileBox(0)); // some
    expect(titleOf(headerBox())).toBe('Select all files shown');
    fireEvent.click(headerBox()); // all shown
    expect(titleOf(headerBox())).toBe('Clear selection');
    fireEvent.click(headerBox()); // back to none
    expect(titleOf(headerBox())).toBe('Select all files shown');
  });

  it('LIST: the table header box says the same, in each state', () => {
    render(<AssetsPage />);
    listView();
    expect(titleOf(headerBox())).toBe('Select all files shown');
    fireEvent.click(within(rtl.getByRole('table')).getByRole('checkbox', { name: 'Select File-01.jpg' }));
    expect(headerBox().indeterminate).toBe(true);
    expect(titleOf(headerBox())).toBe('Select all files shown');
    fireEvent.click(headerBox());
    expect(headerBox().checked).toBe(true);
    expect(titleOf(headerBox())).toBe('Clear selection');
  });

  it('after a select-everything it says "Clear selection" — and says "Select all" again once a file is un-ticked', async () => {
    render(<AssetsPage />);
    await selectEverything();
    expect(titleOf(headerBox())).toBe('Clear selection');
    fireEvent.click(tileBox(0));
    expect(headerBox().indeterminate).toBe(true);
    expect(titleOf(headerBox())).toBe('Select all files shown');
  });

  it('the accessible name does not change with the state — the checkbox carries it', () => {
    render(<AssetsPage />);
    fireEvent.click(headerBox());
    expect(rtl.getByRole('checkbox', { name: 'Select all files shown' })).toBeChecked();
  });

  it('every item box says "Select <name>" — tiles and rows', () => {
    render(<AssetsPage />);
    expect(titleOf(tileBox(0))).toBe('Select File-00.jpg');
    listView();
    const row = within(rtl.getByRole('table')).getByRole('checkbox', { name: 'Select File-02.jpg' });
    expect(titleOf(row)).toBe('Select File-02.jpg');
  });
});
