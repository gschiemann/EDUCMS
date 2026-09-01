/**
 * Media Library — "Calm Assets v1" render tests.
 *
 * These mount the REAL page (same pattern as the playlists suites) so a
 * passing test proves the surface is WIRED, not just that a component
 * renders in isolation — the 2026-05-12 "edits landed in a file that was
 * never mounted" lesson.
 *
 * What they lock down, all from the design handoff:
 *   §11/§25  a card carries NO destructive control; management lives behind
 *            the overflow menu.
 *   §13      selecting anything raises the contextual bar — and the page
 *            header does NOT grow bulk buttons.
 *   §17      the footer states loaded-vs-total in BOTH API modes and never
 *            claims a total it wasn't given.
 *   §6/§14   the upload strip says what it accepts, in the operator's words.
 *   §20      empty / no-results states are distinct and never lie about an
 *            unfinished load.
 */

import * as React from 'react';
import { render, screen as rtl, fireEvent, within, act } from '@testing-library/react';

const NOW = Date.now();
const iso = (minsAgo: number) => new Date(NOW - minsAgo * 60_000).toISOString();

const ASSET = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  originalName: 'Recovery-Lounge-August.jpg',
  fileUrl: 'https://cdn.example.com/a1.jpg',
  mimeType: 'image/jpeg',
  fileSize: 1_258_291,
  status: 'PUBLISHED',
  folderId: null,
  createdAt: iso(30),
  uploadedBy: { id: 'u1', email: 'marketing@example.com' },
  processingMeta: { processedDimensions: { w: 1920, h: 1080 } },
  ...over,
});

const ASSETS = [
  ASSET(),
  ASSET({ id: 'a2', originalName: 'Trainer-Tips-01.mp4', mimeType: 'video/mp4', fileSize: 28_700_000, createdAt: iso(60) }),
  ASSET({ id: 'a3', originalName: 'Member-Welcome.pdf', mimeType: 'application/pdf', fileSize: 2_300_000, createdAt: iso(90), processingMeta: null }),
  ASSET({ id: 'a4', originalName: 'New-Signup-Flyer.png', mimeType: 'image/png', fileSize: 1_100_000, createdAt: iso(10), status: 'PENDING_APPROVAL' }),
];

const FOLDERS = [
  { id: 'f1', name: 'Campaigns', parentId: null, updatedAt: iso(60 * 24 * 2), _count: { assets: 42, children: 0 } },
  { id: 'f2', name: 'Club photography', parentId: null, updatedAt: iso(60 * 24), _count: { assets: 28, children: 0 } },
];

// ── Mock surface ─────────────────────────────────────────────────────
// `assetsResponse` is swapped per-test so the same page can be exercised in
// legacy (bare array) and paginated ({assets,total}) API modes.
let assetsResponse: unknown = ASSETS;
/** Every `useAssets` argument the page asked for, in order. */
let assetRequests: Array<Record<string, unknown> | undefined> = [];
let usageResponse: { data?: unknown; isLoading?: boolean; isError?: boolean } = { data: undefined, isLoading: false, isError: true };

const query = (data: unknown) => () => ({ data, isLoading: false, isError: false, isFetching: false, refetch: jest.fn() });
const mutation = () => ({ mutateAsync: jest.fn().mockResolvedValue({ id: 'x' }), mutate: jest.fn(), isPending: false });

jest.mock('@/hooks/use-api', () => {
  const actual = jest.requireActual('@/hooks/use-api');
  return {
    normalizeAssetList: actual.normalizeAssetList,
    assetUsageQueryKey: actual.assetUsageQueryKey,
    fetchAssetUsage: jest.fn().mockRejectedValue(new Error('no usage endpoint')),
    useAssets: (params?: Record<string, unknown>) => {
      assetRequests.push(params);
      return { data: assetsResponse, isLoading: false, isError: false, isFetching: false, refetch: jest.fn() };
    },
    useAssetFolders: query(FOLDERS),
    useAssetUsage: () => ({
      data: usageResponse.data,
      isLoading: !!usageResponse.isLoading,
      isError: !!usageResponse.isError,
      refetch: jest.fn(),
    }),
    useAddWebUrl: mutation,
    useDeleteAsset: mutation,
    useCreateAssetFolder: mutation,
    useRenameAssetFolder: mutation,
    useDeleteAssetFolder: mutation,
    useMoveAsset: mutation,
    useGenerateAltText: mutation,
    useUpdateAltText: mutation,
  };
});
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
// The AI affordance self-gates on a network probe; keep it out of these tests.
jest.mock('@/components/ai/AiImageGenerateButton', () => ({ AiImageGenerateButton: () => null }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

import AssetsPage from '../page';

function mount() {
  return render(<AssetsPage />);
}

beforeEach(() => {
  assetsResponse = ASSETS;
  assetRequests = [];
  usageResponse = { data: undefined, isLoading: false, isError: true };
});

describe('Media Library v1 — the calm default view', () => {
  it('names the library scope in the subtitle: assets AND folders', () => {
    mount();
    expect(rtl.getByTestId('library-subtitle')).toHaveTextContent('4 assets across 2 folders');
  });

  it('the files heading counts the SCOPE it names, not the rows on screen', () => {
    // 50 rows of a 148-asset library: the heading names the library (the
    // footer says how much of it is loaded)…
    assetsResponse = { assets: Array.from({ length: 50 }, (_, i) => ASSET({ id: `z${i}`, originalName: `Z-${i}.jpg` })), total: 148 };
    const view = mount();
    expect(rtl.getByRole('heading', { name: /Recent files/ })).toHaveTextContent('Recent files 148');
    view.unmount();

    // …and once a search narrows it, the count is the matches.
    assetsResponse = { assets: ASSETS, total: 4 };
    mount();
    fireEvent.change(rtl.getByLabelText('Search the media library'), { target: { value: 'trainer' } });
    expect(rtl.getByRole('heading', { name: /Search results/ })).toHaveTextContent('Search results 1');
  });

  it('the root view renders FOLDERED assets too, not just unfoldered ones (regression)', () => {
    // A library that's mostly organized into folders — Greg's real report:
    // "Showing 50 of 112" in the footer, 3 cards on screen. Root is the
    // library's default view (unnarrowed — see the `narrowed` derivation),
    // so it must show every loaded asset regardless of folderId, and only
    // an actual folder visit narrows the grid.
    assetsResponse = {
      assets: [
        ASSET({ id: 'root-1' }),
        ASSET({ id: 'foldered-1', folderId: 'f1', originalName: 'Campaign-Hero.jpg' }),
        ASSET({ id: 'foldered-2', folderId: 'f2', originalName: 'Club-Floor.jpg' }),
      ],
      total: 3,
    };
    mount();
    expect(rtl.getByText('Campaign-Hero.jpg')).toBeInTheDocument();
    expect(rtl.getByText('Club-Floor.jpg')).toBeInTheDocument();
    expect(rtl.getByTestId('library-footer')).toHaveTextContent('All 3 assets loaded');
  });

  it('shows exactly two header controls — Add asset and Upload files, no bulk buttons', () => {
    mount();
    expect(rtl.getByRole('button', { name: /Add asset/i })).toBeInTheDocument();
    expect(rtl.getByRole('button', { name: /^Upload files$/i })).toBeInTheDocument();
    // Bulk actions must not exist until something is selected (§13).
    expect(rtl.queryByTestId('asset-bulk-bar')).not.toBeInTheDocument();
  });

  it('the upload strip states the drop affordance and the real accepted formats', () => {
    mount();
    const strip = rtl.getByTestId('upload-strip');
    expect(strip).toHaveTextContent('Drop files anywhere to upload');
    expect(strip).toHaveTextContent('Images, video, audio and PDF · up to 500 MB');
    // The uploader rejects SVG, so the strip must never advertise it (§6).
    expect(strip).not.toHaveTextContent(/svg/i);
  });

  it('cards carry no destructive control — only a select box and an overflow menu', () => {
    mount();
    expect(rtl.queryByRole('button', { name: 'Delete Recovery-Lounge-August.jpg' })).not.toBeInTheDocument();
    expect(rtl.getByRole('button', { name: 'Select Recovery-Lounge-August.jpg' })).toBeInTheDocument();
    expect(rtl.getByRole('button', { name: 'More actions for Recovery-Lounge-August.jpg' })).toBeInTheDocument();
  });

  it('a card prints the file kind and its SERVER-measured dimensions, never a thumbnail size', () => {
    mount();
    expect(rtl.getByText('JPG · 1920 × 1080')).toBeInTheDocument();
    // The PDF has no measured dimensions — so it prints none rather than a
    // fabricated page size (§22).
    const pdfCard = rtl.getByRole('button', { name: 'View details for Member-Welcome.pdf' });
    expect(pdfCard).toHaveTextContent('PDF');
    expect(pdfCard.textContent).not.toMatch(/×/);
  });

  it('flags only the states that change what the operator can do', () => {
    mount();
    expect(rtl.getAllByText('Pending review').length).toBeGreaterThan(0);
    // A healthy PUBLISHED asset gets no badge at all.
    expect(rtl.queryByText('Published')).not.toBeInTheDocument();
  });
});

describe('Media Library v1 — the overflow menu (§11)', () => {
  it('offers the six management actions, with delete separated and last', () => {
    mount();
    fireEvent.click(rtl.getByRole('button', { name: 'More actions for Recovery-Lounge-August.jpg' }));
    const menu = rtl.getByRole('menu', { name: 'Actions for Recovery-Lounge-August.jpg' });
    const labels = within(menu).getAllByRole('menuitem').map((b) => b.textContent);
    expect(labels).toEqual([
      'View details',
      'Create playlist from asset',
      'Move to folder',
      'Download',
      'Copy asset link',
      'Delete…',
    ]);
    expect(within(menu).getByRole('separator')).toBeInTheDocument();
  });

  it('View details opens the detail dialog for THAT asset', () => {
    mount();
    fireEvent.click(rtl.getByRole('button', { name: 'More actions for Trainer-Tips-01.mp4' }));
    fireEvent.click(rtl.getByRole('menuitem', { name: 'View details' }));
    expect(rtl.getByRole('dialog', { name: /Asset details: Trainer-Tips-01\.mp4/ })).toBeInTheDocument();
  });

  it('Escape closes the menu without firing an action', () => {
    mount();
    const trigger = rtl.getByRole('button', { name: 'More actions for Recovery-Lounge-August.jpg' });
    fireEvent.click(trigger);
    fireEvent.keyDown(rtl.getByRole('menu', { name: /Actions for/ }), { key: 'Escape' });
    expect(rtl.queryByRole('menu', { name: /Actions for/ })).not.toBeInTheDocument();
    expect(rtl.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Media Library v1 — selection bar (§13)', () => {
  it('appears on the first selection, counts correctly, and clears', () => {
    mount();
    fireEvent.click(rtl.getByRole('button', { name: 'Select Recovery-Lounge-August.jpg' }));
    const bar = rtl.getByTestId('asset-bulk-bar');
    expect(bar).toHaveTextContent('1 asset selected');

    fireEvent.click(rtl.getByRole('button', { name: 'Select Trainer-Tips-01.mp4' }));
    expect(rtl.getByTestId('asset-bulk-bar')).toHaveTextContent('2 assets selected');

    fireEvent.click(within(rtl.getByTestId('asset-bulk-bar')).getByRole('button', { name: /Clear selection/ }));
    expect(rtl.queryByTestId('asset-bulk-bar')).not.toBeInTheDocument();
  });

  it('keeps the routine actions inline and the destructive one behind More', () => {
    mount();
    fireEvent.click(rtl.getByRole('button', { name: 'Select Recovery-Lounge-August.jpg' }));
    const bar = rtl.getByTestId('asset-bulk-bar');
    expect(within(bar).getByRole('button', { name: /Create playlist/ })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: /Move to folder/ })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: /Download/ })).toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();

    fireEvent.click(within(bar).getByRole('button', { name: /More/ }));
    expect(within(bar).getByRole('menuitem', { name: /Delete…/ })).toBeInTheDocument();
  });

  it('Move to folder opens the destination picker for the selection', () => {
    mount();
    fireEvent.click(rtl.getByRole('button', { name: 'Select Recovery-Lounge-August.jpg' }));
    fireEvent.click(within(rtl.getByTestId('asset-bulk-bar')).getByRole('button', { name: /Move to folder/ }));
    expect(rtl.getByText(/to which folder\?/i)).toBeInTheDocument();
  });
});

describe('Media Library v1 — pagination footer (§17)', () => {
  it('paginated API: names the loaded count AND the library total, and offers Load more', () => {
    assetsResponse = { assets: ASSETS, total: 148 };
    mount();
    const footer = rtl.getByTestId('library-footer');
    expect(footer).toHaveTextContent('Showing 4 of 148 assets');
    expect(within(footer).getByRole('button', { name: 'Load more' })).toBeInTheDocument();
  });

  it('paginated API, everything loaded: says so and drops Load more', () => {
    assetsResponse = { assets: ASSETS, total: 4 };
    mount();
    const footer = rtl.getByTestId('library-footer');
    expect(footer).toHaveTextContent('All 4 assets loaded');
    expect(within(footer).queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('legacy API (no total): claims only what it holds — never invents a total', () => {
    assetsResponse = ASSETS; // bare array, the old contract
    mount();
    const footer = rtl.getByTestId('library-footer');
    expect(footer).toHaveTextContent('All 4 assets loaded');
    expect(footer).not.toHaveTextContent(' of ');
  });

  it('legacy API with a filled window: says "loaded so far", not a total', () => {
    // 50 rows back from a 50-row window means there may well be more.
    assetsResponse = Array.from({ length: 50 }, (_, i) => ASSET({ id: `x${i}`, originalName: `File-${i}.jpg` }));
    mount();
    const footer = rtl.getByTestId('library-footer');
    expect(footer).toHaveTextContent('50 assets loaded so far');
    expect(within(footer).getByRole('button', { name: 'Load more' })).toBeInTheDocument();
  });

  it('type-chip counts are withheld while the library is only partly loaded (§7 truth rule)', () => {
    assetsResponse = { assets: ASSETS, total: 148 };
    mount();
    const filters = rtl.getByRole('group', { name: 'Filter by media type' });
    // The All chip can show the server's real total…
    expect(within(filters).getByRole('button', { name: /All 148/ })).toBeInTheDocument();
    // …but a per-type count would describe only the loaded page, so it is absent.
    expect(within(filters).getByRole('button', { name: /^Images$/ })).toBeInTheDocument();
  });

  it('type-chip counts appear once the whole library is in hand', () => {
    assetsResponse = { assets: ASSETS, total: 4 };
    mount();
    const filters = rtl.getByRole('group', { name: 'Filter by media type' });
    expect(within(filters).getByRole('button', { name: /Images 2/ })).toBeInTheDocument();
    expect(within(filters).getByRole('button', { name: /Videos 1/ })).toBeInTheDocument();
    expect(within(filters).getByRole('button', { name: /Documents 1/ })).toBeInTheDocument();
  });
});

describe('Media Library v1 — states (§20)', () => {
  it('an empty library invites the first upload, not a shrug', () => {
    assetsResponse = { assets: [], total: 0 };
    mount();
    const empty = rtl.getByTestId('empty-library');
    expect(empty).toHaveTextContent('Add your first asset');
    expect(empty).toHaveTextContent('Upload an image, video, audio file or PDF to start building content.');
    expect(within(empty).getByRole('button', { name: 'Upload files' })).toBeInTheDocument();
    expect(within(empty).getByRole('button', { name: 'Add web URL' })).toBeInTheDocument();
  });

  it('a search with no hits offers a way out', () => {
    assetsResponse = { assets: ASSETS, total: 4 };
    mount();
    fireEvent.change(rtl.getByLabelText('Search the media library'), { target: { value: 'zzzz-nothing' } });
    const empty = rtl.getByTestId('empty-search');
    expect(empty).toHaveTextContent('No assets match');
    expect(empty).toHaveTextContent('Try another search or clear the active filter.');
    fireEvent.click(within(empty).getByRole('button', { name: 'Clear filters' }));
    expect(rtl.queryByTestId('empty-search')).not.toBeInTheDocument();
  });

  it('an unfinished load is never reported as an empty library', () => {
    // 50 rows of a bigger library, none of which match — we do NOT know the
    // library is empty of matches, and the copy must say exactly that.
    assetsResponse = { assets: Array.from({ length: 50 }, (_, i) => ASSET({ id: `y${i}`, originalName: `Other-${i}.jpg` })), total: 148 };
    mount();
    fireEvent.change(rtl.getByLabelText('Search the media library'), { target: { value: 'zzzz-nothing' } });
    const partial = rtl.getByTestId('empty-partial');
    expect(partial).toHaveTextContent('Nothing here in the 50 assets loaded so far');
    expect(partial).toHaveTextContent('Load the rest of the library to be sure.');
    expect(rtl.queryByTestId('empty-library')).not.toBeInTheDocument();
  });

  it('search covers uploader and alt text, not just the filename (§7)', () => {
    assetsResponse = {
      assets: [ASSET(), ASSET({ id: 'a9', originalName: 'Mystery.png', altText: 'a purple kettlebell', uploadedBy: { id: 'u2', email: 'coach@example.com' } })],
      total: 2,
    };
    mount();
    const box = rtl.getByLabelText('Search the media library');
    fireEvent.change(box, { target: { value: 'kettlebell' } });
    expect(rtl.getByText('Mystery.png')).toBeInTheDocument();
    expect(rtl.queryByText('Recovery-Lounge-August.jpg')).not.toBeInTheDocument();

    fireEvent.change(box, { target: { value: 'coach@example.com' } });
    expect(rtl.getByText('Mystery.png')).toBeInTheDocument();
  });

  it('stops sending q to an API that does not echo it back', async () => {
    // Legacy list endpoint: a bare array, so nothing is ever echoed.
    assetsResponse = ASSETS;
    mount();
    fireEvent.change(rtl.getByLabelText('Search the media library'), { target: { value: 'recovery' } });
    // The debounce fires, the query goes out once…
    await act(async () => { jest.advanceTimersByTime?.(400); await Promise.resolve(); });
    await new Promise((r) => setTimeout(r, 400));
    await act(async () => { await Promise.resolve(); });
    // …and after that unanswered attempt the page stops asking the server,
    // so a second term re-uses the window already in hand.
    fireEvent.change(rtl.getByLabelText('Search the media library'), { target: { value: 'trainer' } });
    await new Promise((r) => setTimeout(r, 400));
    await act(async () => { await Promise.resolve(); });
    const queriesSent = assetRequests.filter((p) => p && p.q !== undefined).map((p) => p!.q);
    expect(queriesSent).not.toContain('trainer');
    // Local filtering still works — this is a capability decision, not a
    // feature switch.
    expect(rtl.queryByText('Recovery-Lounge-August.jpg')).not.toBeInTheDocument();
    expect(rtl.getByText('Trainer-Tips-01.mp4')).toBeInTheDocument();
  });

  it('keeps sending q to an API that DOES search server-side', async () => {
    assetsResponse = { assets: ASSETS, total: 4, q: 'recovery' };
    mount();
    fireEvent.change(rtl.getByLabelText('Search the media library'), { target: { value: 'recovery' } });
    await new Promise((r) => setTimeout(r, 400));
    await act(async () => { await Promise.resolve(); });
    assetsResponse = { assets: ASSETS, total: 4, q: 'trainer' };
    fireEvent.change(rtl.getByLabelText('Search the media library'), { target: { value: 'trainer' } });
    await new Promise((r) => setTimeout(r, 400));
    await act(async () => { await Promise.resolve(); });
    const queriesSent = assetRequests.filter((p) => p && p.q !== undefined).map((p) => p!.q);
    expect(queriesSent).toContain('trainer');
  });

  it('Escape clears the search box', () => {
    assetsResponse = { assets: ASSETS, total: 4 };
    mount();
    const box = rtl.getByLabelText('Search the media library') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'recovery' } });
    expect(box.value).toBe('recovery');
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box.value).toBe('');
  });
});

describe('Media Library v1 — folders (§9)', () => {
  it('renders compact folder cards with counts and a last-updated line', () => {
    mount();
    expect(rtl.getByRole('button', { name: 'Open folder Campaigns' })).toHaveTextContent('42 files');
    expect(rtl.getByRole('button', { name: 'Open folder Campaigns' })).toHaveTextContent('Updated 2 days ago');
  });

  it('opening a folder puts it at the end of the breadcrumb as the current page', () => {
    mount();
    fireEvent.click(rtl.getByRole('button', { name: 'Open folder Campaigns' }));
    const nav = rtl.getByRole('navigation', { name: 'Folder path' });
    expect(within(nav).getByText('Campaigns')).toHaveAttribute('aria-current', 'page');
    // The root stays a link back.
    expect(within(nav).getByRole('button', { name: 'All Files' })).toBeInTheDocument();
  });
});

describe('Media Library v1 — read-only role', () => {
  it('disables every mutating affordance with the reason spelled out', () => {
    jest.isolateModules(() => {});
    // Re-mock the store as a viewer for this test only.
    const store = jest.requireMock('@/store/ui-store');
    const original = store.useUIStore;
    store.useUIStore = Object.assign(
      (sel: (s: unknown) => unknown) => sel({ user: { role: 'RESTRICTED_VIEWER', id: 'u9' }, token: 't' }),
      { getState: () => ({ token: 't' }) },
    );
    try {
      mount();
      expect(rtl.getByRole('button', { name: /^Upload files$/ })).toBeDisabled();
      expect(rtl.getByRole('button', { name: /Add asset/ })).toBeDisabled();
      expect(rtl.getByRole('button', { name: /^Upload files$/ })).toHaveAttribute('title', 'Read-only access');
    } finally {
      store.useUIStore = original;
    }
  });
});

describe('Media Library v1 — upload queue phases (§14)', () => {
  it('a rejected file never enters the queue as Uploading — it names the fix', async () => {
    mount();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const mov = new File(['x'], 'IMG_0042.mov', { type: 'video/quicktime' });
    Object.defineProperty(input, 'files', { value: [mov], configurable: true });
    await act(async () => { fireEvent.change(input); });

    const queue = rtl.getByTestId('upload-queue');
    expect(queue).toHaveTextContent('IMG_0042.mov');
    expect(queue).toHaveTextContent('Failed');
    expect(queue).toHaveTextContent('MOV is unsupported — export as MP4 (H.264)');
    expect(queue).not.toHaveTextContent('Ready');
  });

  it('an oversized file is refused with the real limit, before any network call', async () => {
    mount();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const big = new File(['x'], 'huge.mp4', { type: 'video/mp4' });
    Object.defineProperty(big, 'size', { value: 600 * 1024 * 1024 });
    Object.defineProperty(input, 'files', { value: [big], configurable: true });
    await act(async () => { fireEvent.change(input); });

    expect(rtl.getByTestId('upload-queue')).toHaveTextContent('File exceeds 500 MB');
  });
});
