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
  // A video the server has probed (VideoPosterService → ffprobe): dimensions
  // land in originalDimensions (processedDimensions stays null — a video is
  // never re-encoded at upload) and the duration beside them.
  ASSET({ id: 'a2', originalName: 'Trainer-Tips-01.mp4', mimeType: 'video/mp4', fileSize: 28_700_000, createdAt: iso(60), processingMeta: { originalDimensions: { w: 1920, h: 1080 }, processedDimensions: null, durationMs: 75_400 } }),
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
/** What POST /assets/folders resolves to — or an Error it rejects with. */
let createFolderResult: unknown = { id: 'x' };

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
    useCreateAssetFolder: () => ({
      mutateAsync: jest.fn(async () => {
        if (createFolderResult instanceof Error) throw createFolderResult;
        return createFolderResult;
      }),
      mutate: jest.fn(),
      isPending: false,
    }),
    useRenameAssetFolder: mutation,
    useDeleteAssetFolder: mutation,
    useMoveAsset: mutation,
    useGenerateAltText: mutation,
    useUpdateAltText: mutation,
    useCheckAssetPlayback: mutation,
    useAssetStorageSummary: () => ({ data: { totalBytes: 309_900_000, totalFiles: 5, videos: { bytes: 306_400_000, files: 2 }, images: { bytes: 1_200_000, files: 1 }, other: { bytes: 2_300_000, files: 2 } }, isLoading: false }),
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
jest.mock('@/components/ai/AiImageGenerateButton', () => {
  const R = require('react');
  return {
    useAiImageAvailable: () => true,
    AiImageModal: ({ onClose }: { onClose: () => void }) =>
      R.createElement('div', { role: 'dialog', 'aria-label': 'Generate an image with AI' },
        R.createElement('button', { type: 'button', onClick: onClose }, 'Close')),
  };
});
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
// 2026-09-23 — the transcode poll uses react-query's useQuery, which this file's
// react-query mock does not provide. Keep the PURE helpers real (they decide
// what a tile says) and stub only the network poll with a controllable map.
let liveOptimization = new Map<string, unknown>();
jest.mock('@/hooks/use-video-optimization', () => {
  const actual = jest.requireActual('@/hooks/use-video-optimization');
  return { ...actual, useVideoOptimizationStatus: () => liveOptimization };
});

import { toast } from 'sonner';
import AssetsPage from '../page';

function mount() {
  return render(<AssetsPage />);
}

beforeEach(() => {
  assetsResponse = ASSETS;
  assetRequests = [];
  usageResponse = { data: undefined, isLoading: false, isError: true };
  createFolderResult = { id: 'x' };
  liveOptimization = new Map();
  (toast.error as jest.Mock).mockClear();
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

  it('shows ONE header control — Add asset — and no bulk buttons (2026-09-14)', () => {
    mount();
    expect(rtl.getByRole('button', { name: /Add asset/i })).toBeInTheDocument();
    // Greg: "add assets, url, and generate from AI should be under one
    // button, not multiple buttons" — the standalone Upload files is gone.
    expect(rtl.queryByRole('button', { name: /^Upload files$/i })).not.toBeInTheDocument();
    // Bulk actions must not exist until something is selected (§13).
    expect(rtl.queryByTestId('asset-bulk-bar')).not.toBeInTheDocument();
  });

  it('Add asset opens a menu with Upload files, Add web URL and Generate image with AI', () => {
    mount();
    fireEvent.click(rtl.getByRole('button', { name: /Add asset/i }));
    const menu = rtl.getByRole('menu', { name: 'Add asset' });
    expect(within(menu).getByRole('menuitem', { name: 'Upload files' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Add web URL' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Generate image with AI' })).toBeInTheDocument();
  });

  it('Generate image with AI opens the generator even though the menu closes (2026-09-14)', () => {
    // The modal used to be rendered INSIDE the menu, so the click that
    // opened it also unmounted it — the item did nothing, every time.
    mount();
    fireEvent.click(rtl.getByRole('button', { name: /Add asset/i }));
    fireEvent.click(rtl.getByRole('menuitem', { name: 'Generate image with AI' }));
    expect(rtl.queryByRole('menu', { name: 'Add asset' })).not.toBeInTheDocument();
    expect(rtl.getByRole('dialog', { name: 'Generate an image with AI' })).toBeInTheDocument();
  });

  it('the upload strip states the drop affordance and the real accepted formats', () => {
    mount();
    const strip = rtl.getByTestId('upload-strip');
    expect(strip).toHaveTextContent('Drop files anywhere to upload');
    // 2026-09-23: uploads go straight to storage, so video may be up to 2 GB.
    expect(strip).toHaveTextContent('Images, video, audio and PDF · video up to 2 GB');
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

  it('a video card prints its probed dimensions AND duration (the 2026-09-24 "—" bug)', () => {
    mount();
    // originalDimensions written by ffprobe at upload; nothing client-measured
    // (the client fallback is image-only by design).
    expect(rtl.getByText('MP4 · 1920 × 1080 · 1:15')).toBeInTheDocument();
  });

  it('the detail panel shows a video\'s resolution with its duration beside it', () => {
    mount();
    fireEvent.click(rtl.getByRole('button', { name: 'More actions for Trainer-Tips-01.mp4' }));
    fireEvent.click(rtl.getByRole('menuitem', { name: 'View details' }));
    const dialog = rtl.getByRole('dialog', { name: /Asset details: Trainer-Tips-01\.mp4/ });
    expect(within(dialog).getByText('1920 × 1080 px · 1:15')).toBeInTheDocument();
  });

  it('a video that was never probed still prints an em dash, never a fabricated size', () => {
    assetsResponse = [
      ASSET({ id: 'v9', originalName: 'Unprobed.mp4', mimeType: 'video/mp4', processingMeta: null }),
    ];
    mount();
    const card = rtl.getByRole('button', { name: 'View details for Unprobed.mp4' });
    expect(card).toHaveTextContent('MP4');
    expect(card.textContent).not.toMatch(/×/);
    fireEvent.click(rtl.getByRole('button', { name: 'More actions for Unprobed.mp4' }));
    fireEvent.click(rtl.getByRole('menuitem', { name: 'View details' }));
    const dialog = rtl.getByRole('dialog', { name: /Asset details: Unprobed\.mp4/ });
    expect(dialog.textContent).not.toMatch(/\d+ × \d+/);
    expect(within(dialog).getAllByText('—').length).toBeGreaterThan(0);
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

  it('keeps every selection action inline — Delete included, since a one-item More menu was a click for nothing (2026-09-24)', () => {
    mount();
    fireEvent.click(rtl.getByRole('button', { name: 'Select Recovery-Lounge-August.jpg' }));
    const bar = rtl.getByTestId('asset-bulk-bar');
    expect(within(bar).getByRole('button', { name: /Create playlist/ })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: /Move to folder/ })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: /Download/ })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: /Delete…/ })).toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: /More/ })).not.toBeInTheDocument();
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

/** Mount the page as `role`, restoring the SCHOOL_ADMIN store afterwards. */
function asRole(role: string, body: () => void) {
  const store = jest.requireMock('@/store/ui-store');
  const original = store.useUIStore;
  store.useUIStore = Object.assign(
    (sel: (s: unknown) => unknown) => sel({ user: { role, id: 'u9' }, token: 't' }),
    { getState: () => ({ token: 't' }) },
  );
  try {
    mount();
    body();
  } finally {
    store.useUIStore = original;
  }
}

describe('Media Library v1 — read-only role', () => {
  it('disables every mutating affordance with the reason spelled out', () => {
    asRole('RESTRICTED_VIEWER', () => {
      expect(rtl.getByRole('button', { name: /Add asset/ })).toBeDisabled();
      expect(rtl.getByRole('button', { name: /Add asset/ })).toHaveAttribute('title', 'Read-only access');
    });
  });
});

/**
 * Deletion is admin-only; the rest of the library is not.
 *
 * `DELETE /assets/:id` and `DELETE /assets/folders/:folderId` are
 * `@RequireRoles(SUPER_ADMIN, DISTRICT_ADMIN, SCHOOL_ADMIN)`, while upload
 * (`POST /assets/upload`), add-by-URL (`POST /assets/url`), move
 * (`PUT /assets/:id/move`), folder create/rename (`POST|PUT /assets/folders`)
 * and create-playlist (`POST /playlists`) all list CONTRIBUTOR.
 *
 * The bug this pins: every delete control gated on `isViewer`, which is only
 * true for RESTRICTED_VIEWER — so a CONTRIBUTOR saw four enabled delete
 * affordances the API answers with 403.
 */
describe('Media Library v1 — deletion is admin-only', () => {
  const openAssetMenu = () =>
    fireEvent.click(rtl.getByRole('button', { name: 'More actions for Recovery-Lounge-August.jpg' }));
  const openFolderMenu = () =>
    fireEvent.click(rtl.getByRole('button', { name: 'Folder actions for Campaigns' }));
  const openBulkBar = () => {
    fireEvent.click(rtl.getByRole('button', { name: 'Select Recovery-Lounge-August.jpg' }));
    return rtl.getByTestId('asset-bulk-bar');
  };
  const openDetail = () =>
    fireEvent.click(rtl.getByRole('button', { name: 'View details for Recovery-Lounge-August.jpg' }));

  it('a CONTRIBUTOR keeps every write it is allowed', () => {
    asRole('CONTRIBUTOR', () => {
      expect(rtl.getByRole('button', { name: /Add asset/ })).toBeEnabled();
      expect(rtl.getByRole('button', { name: /New Folder/i })).toBeEnabled();
      openAssetMenu();
      expect(rtl.getByRole('menuitem', { name: 'Move to folder' })).toBeEnabled();
      expect(rtl.getByRole('menuitem', { name: 'Create playlist from asset' })).toBeEnabled();
      openFolderMenu();
      expect(rtl.getByRole('menuitem', { name: 'Rename' })).toBeEnabled();
    });
  });

  it.each([
    ['CONTRIBUTOR', true],
    ['RESTRICTED_VIEWER', true],
    ['SCHOOL_ADMIN', false],
    ['DISTRICT_ADMIN', false],
    ['SUPER_ADMIN', false],
  ])('%s: every delete affordance disabled=%s', (role, denied) => {
    asRole(role, () => {
      const check = (el: HTMLElement) => (denied ? expect(el).toBeDisabled() : expect(el).toBeEnabled());

      openAssetMenu();
      check(rtl.getByRole('menuitem', { name: 'Delete…' }));

      openFolderMenu();
      check(rtl.getByRole('menuitem', { name: /Delete folder/ }));

      const bar = openBulkBar();
      check(within(bar).getByRole('button', { name: /Delete…/ }));

      openDetail();
      check(rtl.getByRole('button', { name: /Delete asset/ }));
    });
  });

  it('names the real reason on the blocked control, not "read-only"', () => {
    asRole('CONTRIBUTOR', () => {
      openAssetMenu();
      expect(rtl.getByRole('menuitem', { name: 'Delete…' }))
        .toHaveAttribute('title', 'Only an admin can delete files');
    });
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
    // Video: the direct-upload ceiling is 2 GB (a 600 MB 4K clip is fine now).
    const big = new File(['x'], 'huge.mp4', { type: 'video/mp4' });
    Object.defineProperty(big, 'size', { value: 2.5 * 1024 * 1024 * 1024 });
    // Anything else keeps the 500 MB outer cap.
    const pdf = new File(['x'], 'scan.pdf', { type: 'application/pdf' });
    Object.defineProperty(pdf, 'size', { value: 600 * 1024 * 1024 });
    Object.defineProperty(input, 'files', { value: [big, pdf], configurable: true });
    await act(async () => { fireEvent.change(input); });

    const queue = rtl.getByTestId('upload-queue');
    expect(queue).toHaveTextContent('File exceeds 2 GB (this one is 2.50 GB)');
    expect(queue).toHaveTextContent('File exceeds 500 MB (this one is 600.0 MB)');
  });
});

describe('Media Library — videos being optimized for screens (2026-09-23)', () => {
  const VIDEO = (job: Record<string, unknown> | null, over: Record<string, unknown> = {}) =>
    ASSET({ id: 'v1', originalName: 'Gym-4K.mp4', mimeType: 'video/mp4', fileSize: 1_503_238_553, transcodeJob: job, processingMeta: null, ...over });

  it('a queued/running transcode says so on the tile, with its progress', () => {
    assetsResponse = [VIDEO({ status: 'running', reason: null, progress: 42, sourceBytes: 1_503_238_553, outputBytes: null, finishedAt: null })];
    mount();
    expect(rtl.getByTestId('video-optimizing')).toHaveTextContent('Optimizing for screens… 42%');
  });

  it('the poll’s fresher answer wins over the list row', () => {
    assetsResponse = [VIDEO({ status: 'queued', reason: null, progress: null, sourceBytes: 1_503_238_553, outputBytes: null, finishedAt: null })];
    liveOptimization = new Map([['v1', { status: 'running', reason: null, progress: 77, sourceBytes: 1_503_238_553, outputBytes: null, finishedAt: null }]]);
    mount();
    expect(rtl.getByTestId('video-optimizing')).toHaveTextContent('Optimizing for screens… 77%');
  });

  it('a finished swap shows what it saved; one that saved nothing shows nothing on the tile', () => {
    assetsResponse = [
      VIDEO({ status: 'done', reason: 'swapped', progress: 100, sourceBytes: 1_000_000_000, outputBytes: 220_000_000, finishedAt: iso(1) }, { fileSize: 220_000_000 }),
      VIDEO({ status: 'skipped', reason: 'not-smaller', progress: null, sourceBytes: 5_000_000, outputBytes: 6_000_000, finishedAt: iso(1) }, { id: 'v2', originalName: 'Small.mp4' }),
    ];
    mount();
    const chips = rtl.getAllByTestId('video-optimized');
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveTextContent('Optimized −78%');
    expect(rtl.queryByTestId('video-optimizing')).not.toBeInTheDocument();
  });
});

describe('a new folder opens itself', () => {
  /** Create a folder from the page's own control, as an operator does. */
  const createFolder = async (name = 'Fall Festival') => {
    fireEvent.click(rtl.getByRole('button', { name: 'New Folder' }));
    fireEvent.change(rtl.getByLabelText('New folder name'), {
      target: { value: name },
    });
    await act(async () => {
      fireEvent.click(rtl.getByRole('button', { name: 'Create' }));
    });
  };

  it('lands the operator inside the folder they just made', async () => {
    // Greg, live-testing: "when i create a new folder in the assets menu
    // it should take me directly into that new folder to upload content."
    // It used to create the folder and leave you standing at the root, so
    // the next thing you did was hunt for what you had just made.
    createFolderResult = { id: 'f2' }; // 'Club photography' in FOLDERS
    mount();
    expect(rtl.getByLabelText('Folder path')).not.toHaveTextContent(
      'Club photography',
    );

    await createFolder();

    const path = rtl.getByLabelText('Folder path');
    expect(path).toHaveTextContent('Club photography');
    // …and it is the folder you are STANDING in, not a link you could
    // follow — which is what makes the next upload land there.
    expect(within(path).getByText('Club photography')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('counts the folder you are in, not the library you left', async () => {
    // The All chip read the whole library everywhere, so a folder that
    // held one picture showed "All 2" beside "Images 1" — and an empty
    // one showed "All 13" over a grid that said it was empty.
    assetsResponse = {
      assets: [
        ASSET({ id: 'root-1' }),
        ASSET({ id: 'in-f2', folderId: 'f2', originalName: 'Club-Hero.jpg' }),
      ],
      total: 2,
    };
    createFolderResult = { id: 'f2' };
    mount();
    expect(rtl.getByRole('button', { name: /^All \d+$/ })).toHaveTextContent('2');

    await createFolder();

    expect(rtl.getByRole('button', { name: /^All \d+$/ })).toHaveTextContent('1');
    expect(rtl.getByRole('button', { name: /^Images/ })).toHaveTextContent('1');
  });

  it('closes the name box only once the folder really exists', async () => {
    createFolderResult = new Error('A folder called that already exists.');
    mount();
    await createFolder();

    // The old code awaited the create with no catch: the rejection went
    // unhandled, the box stayed open with the name still in it, and
    // nothing on screen said why nothing had happened.
    expect(toast.error).toHaveBeenCalledWith(
      'A folder called that already exists.',
    );
    expect(rtl.getByLabelText('New folder name')).toHaveValue('Fall Festival');
    expect(rtl.getByLabelText('Folder path')).toHaveTextContent('All Files');
  });
});
