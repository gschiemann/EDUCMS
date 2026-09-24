/**
 * Media Library — usage + deletion safety.
 *
 * §15 makes "where is this playing?" the highest-value missing information,
 * and §16 makes silent deletion of live signage unacceptable. §22's truth
 * rules bind both: an unreachable usage endpoint is UNKNOWN, never zero and
 * never "unused", and nothing on this page may offer a force-delete.
 *
 * Every case below is exercised through the real page.
 */

import * as React from 'react';
import { render, screen as rtl, fireEvent, within, act, waitFor } from '@testing-library/react';
import type { AssetUsage } from '@/hooks/use-api';

const ASSET = {
  id: 'a1',
  originalName: 'Recovery-Lounge-August.jpg',
  fileUrl: 'https://cdn.example.com/a1.jpg',
  mimeType: 'image/jpeg',
  fileSize: 1_258_291,
  status: 'PUBLISHED',
  folderId: null,
  createdAt: new Date('2026-08-20T10:00:00Z').toISOString(),
  uploadedBy: { id: 'u1', email: 'marketing@example.com' },
  processingMeta: { processedDimensions: { w: 1920, h: 1080 } },
};

const USED: AssetUsage = {
  playlists: [
    { id: 'p1', name: 'Summer Strength', itemCount: 6, scheduled: true, activeNow: true, screensReached: 4 },
    { id: 'p2', name: 'Lobby Rotation', itemCount: 12, scheduled: true, activeNow: false, screensReached: 3 },
    { id: 'p3', name: 'Member Welcome', itemCount: 3, scheduled: false, activeNow: false, screensReached: 1 },
  ],
  totals: { playlists: 3, screensReached: 8, locations: 2 },
  protectedEmergency: false,
};
const UNUSED: AssetUsage = { playlists: [], totals: { playlists: 0, screensReached: 0, locations: 0 }, protectedEmergency: false };
const PROTECTED: AssetUsage = { playlists: [], totals: { playlists: 0, screensReached: 0, locations: 0 }, protectedEmergency: true };

// Per-test knobs.
let usageState: { data?: AssetUsage; isLoading: boolean; isError: boolean } = { data: undefined, isLoading: false, isError: true };
let preflight: () => Promise<AssetUsage> = () => Promise.reject(new Error('no usage endpoint'));
let deleteImpl: (id: string) => Promise<unknown> = () => Promise.resolve({});

const query = (data: unknown) => () => ({ data, isLoading: false, isError: false, isFetching: false, refetch: jest.fn() });
const mutation = () => ({ mutateAsync: jest.fn().mockResolvedValue({}), mutate: jest.fn(), isPending: false });

jest.mock('@/hooks/use-api', () => {
  const actual = jest.requireActual('@/hooks/use-api');
  return {
    normalizeAssetList: actual.normalizeAssetList,
    assetUsageQueryKey: actual.assetUsageQueryKey,
    fetchAssetUsage: jest.fn(),
    useAssets: () => ({ data: { assets: [ASSET_REF.current], total: 1 }, isLoading: false, isError: false, isFetching: false, refetch: jest.fn() }),
    useAssetFolders: query([]),
    useAssetUsage: () => ({ ...usageState, refetch: jest.fn() }),
    useAddWebUrl: mutation,
    useDeleteAsset: () => ({ mutateAsync: (id: string) => deleteImpl(id), mutate: jest.fn(), isPending: false }),
    useCreateAssetFolder: mutation,
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
  useQueryClient: () => ({
    invalidateQueries: jest.fn(),
    refetchQueries: jest.fn(),
    fetchQuery: () => preflight(),
  }),
}));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), useParams: () => ({ schoolId: 's1' }) }));

const appConfirm = jest.fn().mockResolvedValue(false);
const appAlert = jest.fn().mockResolvedValue(true);
jest.mock('@/components/ui/app-dialog', () => ({
  appConfirm: (...a: unknown[]) => appConfirm(...a),
  appAlert: (...a: unknown[]) => appAlert(...a),
}));
jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));
jest.mock('@/store/ui-store', () => ({
  useUIStore: Object.assign(
    (sel: (s: unknown) => unknown) => sel({ user: { role: 'SCHOOL_ADMIN', id: 'u1' }, token: 't' }),
    { getState: () => ({ token: 't' }) },
  ),
}));
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

// Indirection so the module-level mock can read a value assigned per test.
const ASSET_REF = { current: ASSET as Record<string, unknown> };

import AssetsPage from '../page';

beforeEach(() => {
  ASSET_REF.current = ASSET;
  usageState = { data: undefined, isLoading: false, isError: true };
  preflight = () => Promise.reject(new Error('no usage endpoint'));
  deleteImpl = () => Promise.resolve({});
  appConfirm.mockReset().mockResolvedValue(false);
  appAlert.mockReset().mockResolvedValue(true);
});

function openDetail() {
  render(<AssetsPage />);
  fireEvent.click(rtl.getByRole('button', { name: 'View details for Recovery-Lounge-August.jpg' }));
  return rtl.getByRole('dialog', { name: /Asset details/ });
}

describe('Asset detail — usage and impact (§15)', () => {
  it('KNOWN + in use: names the playlists, the reach and the locations', () => {
    usageState = { data: USED, isLoading: false, isError: false };
    openDetail();
    const usage = rtl.getByTestId('asset-usage');
    expect(usage).toHaveTextContent('Used in 3 playlists');
    expect(usage).toHaveTextContent('Currently reaching 8 screens across 2 locations');

    // Collapsed by default; the expander reveals the individual playlists.
    expect(within(usage).queryByText('Summer Strength')).not.toBeInTheDocument();
    const toggle = within(usage).getByRole('button', { name: /Show the playlists/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(within(usage).getByText('Summer Strength')).toBeInTheDocument();
    expect(within(usage).getByText('Lobby Rotation')).toBeInTheDocument();
    expect(within(usage).getByText('Member Welcome')).toBeInTheDocument();
    // Scheduling state is stated per playlist, not implied.
    expect(within(usage).getByText('Active now')).toBeInTheDocument();
    expect(within(usage).getByText('Not scheduled')).toBeInTheDocument();
  });

  it('KNOWN + unused: says so plainly', () => {
    usageState = { data: UNUSED, isLoading: false, isError: false };
    openDetail();
    expect(rtl.getByTestId('asset-usage')).toHaveTextContent('Not used by any playlist');
  });

  it('UNKNOWN: says it cannot check — never zero, never "unused"', () => {
    usageState = { data: undefined, isLoading: false, isError: true };
    openDetail();
    const usage = rtl.getByTestId('asset-usage');
    expect(usage).toHaveTextContent("Can't check usage right now");
    expect(usage).not.toHaveTextContent(/not used by any playlist/i);
    expect(usage).not.toHaveTextContent('Used in 0 playlists');
    expect(within(usage).getByRole('button', { name: /Try again/ })).toBeInTheDocument();
  });

  it('LOADING: shows a check-in-progress line, not a zero', () => {
    usageState = { data: undefined, isLoading: true, isError: false };
    openDetail();
    const usage = rtl.getByTestId('asset-usage');
    expect(usage).toHaveTextContent('Checking where this asset is used…');
    expect(usage).not.toHaveTextContent(/not used/i);
  });

  it('PROTECTED emergency content reads distinctly and points at Emergency settings', () => {
    usageState = { data: PROTECTED, isLoading: false, isError: false };
    openDetail();
    expect(rtl.getByTestId('asset-usage')).toHaveTextContent(
      'This asset is protected emergency content and cannot be removed here. Open Emergency settings to review it.',
    );
  });

  it('a scheduled-but-dark playlist is not described as reaching screens', () => {
    usageState = {
      data: {
        playlists: [{ id: 'p1', name: 'Off Season', itemCount: 2, scheduled: true, activeNow: false, screensReached: 0 }],
        totals: { playlists: 1, screensReached: 0, locations: 0 },
        protectedEmergency: false,
      },
      isLoading: false,
      isError: false,
    };
    openDetail();
    const usage = rtl.getByTestId('asset-usage');
    expect(usage).toHaveTextContent('Used in 1 playlist');
    expect(usage).toHaveTextContent('Not on any screen right now');
    expect(usage).not.toHaveTextContent(/Currently reaching/);
  });
});

describe('Deletion safety (§16)', () => {
  it('KNOWN-unused: the confirmation says exactly that, and never promises restoration', async () => {
    preflight = () => Promise.resolve(UNUSED);
    render(<AssetsPage />);
    fireEvent.click(rtl.getByRole('button', { name: 'More actions for Recovery-Lounge-August.jpg' }));
    await act(async () => {
      fireEvent.click(rtl.getByRole('menuitem', { name: 'Delete…' }));
    });
    await waitFor(() => expect(appConfirm).toHaveBeenCalled());
    const arg = appConfirm.mock.calls[0][0];
    expect(arg.title).toBe('Delete "Recovery-Lounge-August.jpg"?');
    expect(arg.message).toContain('This asset is not used by any playlist.');
    expect(arg.message).toContain('cannot be restored');
    expect(arg.message).not.toMatch(/30 days|restore it|trash/i);
    expect(arg.tone).toBe('danger');
  });

  it('UNKNOWN usage: the confirmation carries the caution instead of claiming it is unused', async () => {
    preflight = () => Promise.reject(new Error('404'));
    render(<AssetsPage />);
    fireEvent.click(rtl.getByRole('button', { name: 'More actions for Recovery-Lounge-August.jpg' }));
    await act(async () => {
      fireEvent.click(rtl.getByRole('menuitem', { name: 'Delete…' }));
    });
    await waitFor(() => expect(appConfirm).toHaveBeenCalled());
    const arg = appConfirm.mock.calls[0][0];
    expect(arg.message).toContain("We couldn't check where this asset is used");
    expect(arg.message).not.toMatch(/not used by any playlist/i);
  });

  it('IN USE: shows the §16 block instead of a confirmation — and offers no force-delete', async () => {
    preflight = () => Promise.resolve(USED);
    render(<AssetsPage />);
    fireEvent.click(rtl.getByRole('button', { name: 'More actions for Recovery-Lounge-August.jpg' }));
    await act(async () => {
      fireEvent.click(rtl.getByRole('menuitem', { name: 'Delete…' }));
    });
    const block = await rtl.findByTestId('asset-in-use-block');
    expect(block).toHaveTextContent('This asset is currently in use');
    expect(block).toHaveTextContent('It appears in 3 playlists reaching 8 screens');
    expect(block).toHaveTextContent('Remove or replace those references before deleting it.');
    expect(within(block).getByRole('button', { name: 'Review usage' })).toBeInTheDocument();
    expect(within(block).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    // No escape hatch of any kind.
    const labels = within(block).getAllByRole('button').map((b) => b.textContent || '');
    expect(labels.some((l) => /delete anyway|force|remove anyway/i.test(l))).toBe(false);
    // And no confirmation dialog was ever offered.
    expect(appConfirm).not.toHaveBeenCalled();
  });

  it('IN USE: "Review usage" lands the operator in that asset’s detail usage section', async () => {
    preflight = () => Promise.resolve(USED);
    usageState = { data: USED, isLoading: false, isError: false };
    render(<AssetsPage />);
    fireEvent.click(rtl.getByRole('button', { name: 'More actions for Recovery-Lounge-August.jpg' }));
    await act(async () => {
      fireEvent.click(rtl.getByRole('menuitem', { name: 'Delete…' }));
    });
    fireEvent.click(within(await rtl.findByTestId('asset-in-use-block')).getByRole('button', { name: 'Review usage' }));
    expect(rtl.getByRole('dialog', { name: /Asset details/ })).toBeInTheDocument();
    expect(rtl.getByTestId('asset-usage')).toHaveTextContent('Used in 3 playlists');
  });

  it('PROTECTED: refuses at the door with the exact §16 copy, no confirmation', async () => {
    preflight = () => Promise.resolve(PROTECTED);
    render(<AssetsPage />);
    fireEvent.click(rtl.getByRole('button', { name: 'More actions for Recovery-Lounge-August.jpg' }));
    await act(async () => {
      fireEvent.click(rtl.getByRole('menuitem', { name: 'Delete…' }));
    });
    await waitFor(() => expect(appAlert).toHaveBeenCalled());
    const arg = appAlert.mock.calls[0][0];
    expect(arg.title).toBe('Protected emergency content');
    expect(arg.message).toBe(
      'This asset is protected emergency content and cannot be removed here. Open Emergency settings to review it.',
    );
    expect(appConfirm).not.toHaveBeenCalled();
    expect(rtl.queryByTestId('asset-in-use-block')).not.toBeInTheDocument();
  });

  it('a server 409 wins over a stale pre-flight: the block appears with the SERVER usage', async () => {
    // Pre-flight said unused (stale cache); the DELETE comes back 409.
    preflight = () => Promise.resolve(UNUSED);
    appConfirm.mockResolvedValue(true);
    deleteImpl = () =>
      Promise.reject(Object.assign(new Error('Asset in use'), { status: 409, code: 'ASSET_IN_USE', body: { code: 'ASSET_IN_USE', usage: USED } }));
    render(<AssetsPage />);
    fireEvent.click(rtl.getByRole('button', { name: 'More actions for Recovery-Lounge-August.jpg' }));
    await act(async () => {
      fireEvent.click(rtl.getByRole('menuitem', { name: 'Delete…' }));
    });
    const block = await rtl.findByTestId('asset-in-use-block');
    expect(block).toHaveTextContent('It appears in 3 playlists reaching 8 screens');
  });
});
