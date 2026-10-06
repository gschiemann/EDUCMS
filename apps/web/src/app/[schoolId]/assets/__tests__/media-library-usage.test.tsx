/**
 * Media Library — usage + deletion safety.
 *
 * §15 makes "where is this playing?" the highest-value missing information,
 * and §16 makes silent deletion of live signage unacceptable. §22's truth
 * rules bind both: an unreachable usage endpoint is UNKNOWN, never zero and
 * never "unused". Protected emergency content remains undeletable.
 *
 * Since 2026-09-26 the server deletes an in-use asset only with
 * `?confirm=in-use` (409 ASSET_IN_USE + the usage otherwise), so the page
 * sends `confirmInUse: true` ONLY after the operator confirmed a warning that
 * disclosed the usage: the in-use block's Delete, or the bulk warning.
 *
 * Every case below is exercised through the real page.
 */

import * as React from 'react';
import { render, screen as rtl, fireEvent, within, act, waitFor } from '@testing-library/react';
import type { AssetUsage } from '@/hooks/use-api';
jest.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));

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
type DeleteArg = { id: string; confirmInUse: boolean };
let deleteImpl: (arg: DeleteArg) => Promise<unknown> = () => Promise.resolve({});

/** What apiFetch throws for the server's 409 ASSET_IN_USE (status + code + parsed body). */
function assetInUse409(usage?: AssetUsage) {
  const body: Record<string, unknown> = {
    error: true,
    code: 'ASSET_IN_USE',
    message: 'This asset is in 3 playlists reaching 8 screens, so it was not deleted. Refresh the page and delete it again to confirm, or remove it from those playlists first.',
    confirmQuery: 'confirm=in-use',
  };
  if (usage) body.usage = usage;
  return Object.assign(new Error(body.message as string), { status: 409, code: 'ASSET_IN_USE', body });
}

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
    useDeleteAsset: () => ({ mutateAsync: (arg: DeleteArg) => deleteImpl(arg), mutate: jest.fn(), isPending: false }),
    useCreateAssetFolder: mutation,
    useRenameAssetFolder: mutation,
    useDeleteAssetFolder: mutation,
    useMoveAsset: mutation,
    useGenerateAltText: mutation,
    useUpdateAltText: mutation,
    useCheckAssetPlayback: mutation,
    useAssetStorageSummary: () => ({ data: { totalBytes: 309_900_000, totalFiles: 5, videos: { bytes: 306_400_000, files: 2 }, images: { bytes: 1_200_000, files: 1 }, other: { bytes: 2_300_000, files: 2 } }, isLoading: false }),
    // The allowance line is media-library-v1's concern; here it simply has no answer yet.
    useAssetStorageUsage: () => ({ data: undefined, isLoading: false, isError: false }),
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
// 2026-09-23 — the page now polls transcode state with react-query's useQuery,
// which this file's react-query mock does not provide. The poll is not what
// these tests are about: keep the pure helpers real, stub the network poll.
jest.mock('@/hooks/use-video-optimization', () => {
  const actual = jest.requireActual('@/hooks/use-video-optimization');
  return { ...actual, useVideoOptimizationStatus: () => new Map() };
});

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
      "It's used for emergency alerts, so it can't be deleted here. Manage it in Settings → Emergency.",
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
    expect(arg.title).toBe('Delete “Recovery-Lounge-August.jpg”?');
    expect(arg.message).toContain("It isn't in any playlist.");
    expect(arg.message).toContain("can't be undone");
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
    expect(arg.message).toContain("We couldn't check where it's used");
    expect(arg.message).not.toMatch(/isn't in any playlist/i);
  });

  it('IN USE: shows the affected playlists and allows the warned delete', async () => {
    preflight = () => Promise.resolve(USED);
    const deleted = jest.fn().mockResolvedValue({});
    deleteImpl = deleted;
    render(<AssetsPage />);
    fireEvent.click(rtl.getByRole('button', { name: 'More actions for Recovery-Lounge-August.jpg' }));
    await act(async () => {
      fireEvent.click(rtl.getByRole('menuitem', { name: 'Delete…' }));
    });
    const block = await rtl.findByTestId('asset-in-use-block');
    expect(block).toHaveTextContent('This file is in use');
    expect(block).toHaveTextContent("It's in 3 playlists reaching 8 screens");
    expect(block).toHaveTextContent('Deleting it takes it out of those playlists.');
    expect(block).not.toHaveTextContent(/unpublished|default content|available schedule/i);
    expect(within(block).getByRole('button', { name: 'Review usage' })).toBeInTheDocument();
    expect(within(block).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(within(block).getByRole('button', { name: 'Delete anyway' })).toBeInTheDocument();
    expect(appConfirm).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(block).getByRole('button', { name: 'Delete anyway' }));
    });
    // The operator saw the usage and chose Delete: the one single-asset path
    // that carries the in-use confirmation.
    expect(deleted).toHaveBeenCalledTimes(1);
    expect(deleted).toHaveBeenCalledWith({ id: 'a1', confirmInUse: true });
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
    expect(arg.title).toBe("Can't delete this file");
    expect(arg.message).toBe(
      "It's used for emergency alerts. Manage it in Settings → Emergency.",
    );
    expect(appConfirm).not.toHaveBeenCalled();
    expect(rtl.queryByTestId('asset-in-use-block')).not.toBeInTheDocument();
  });

  it('a server emergency guard wins over a stale pre-flight', async () => {
    // Pre-flight said unused (stale cache); the server still refuses protected content.
    preflight = () => Promise.resolve(UNUSED);
    appConfirm.mockResolvedValue(true);
    deleteImpl = () =>
      Promise.reject(Object.assign(new Error('Protected emergency content'), { status: 409, code: 'ASSET_IN_PROTECTED_PLAYLIST' }));
    render(<AssetsPage />);
    fireEvent.click(rtl.getByRole('button', { name: 'More actions for Recovery-Lounge-August.jpg' }));
    await act(async () => {
      fireEvent.click(rtl.getByRole('menuitem', { name: 'Delete…' }));
    });
    await waitFor(() => expect(appAlert).toHaveBeenCalled());
    expect(rtl.queryByTestId('asset-in-use-block')).not.toBeInTheDocument();
  });
});

describe('In-use confirmation — sent only after a warning that showed the usage (2026-09-26)', () => {
  async function clickDelete() {
    render(<AssetsPage />);
    fireEvent.click(rtl.getByRole('button', { name: 'More actions for Recovery-Lounge-August.jpg' }));
    await act(async () => {
      fireEvent.click(rtl.getByRole('menuitem', { name: 'Delete…' }));
    });
  }

  it('KNOWN-unused: the confirmed delete goes WITHOUT the in-use confirmation', async () => {
    preflight = () => Promise.resolve(UNUSED);
    appConfirm.mockResolvedValue(true);
    const deleted = jest.fn().mockResolvedValue({});
    deleteImpl = deleted;
    await clickDelete();
    await waitFor(() => expect(deleted).toHaveBeenCalled());
    expect(deleted).toHaveBeenCalledWith({ id: 'a1', confirmInUse: false });
  });

  it('UNKNOWN usage: "we couldn\'t check" is not an in-use confirmation either', async () => {
    preflight = () => Promise.reject(new Error('503'));
    appConfirm.mockResolvedValue(true);
    const deleted = jest.fn().mockResolvedValue({});
    deleteImpl = deleted;
    await clickDelete();
    await waitFor(() => expect(deleted).toHaveBeenCalled());
    expect(deleted).toHaveBeenCalledWith({ id: 'a1', confirmInUse: false });
  });

  it('a server ASSET_IN_USE 409 behind a stale pre-flight opens the in-use warning with the SERVER usage; only its Delete confirms', async () => {
    preflight = () => Promise.resolve(UNUSED);
    appConfirm.mockResolvedValue(true);
    const deleted = jest.fn()
      .mockRejectedValueOnce(assetInUse409(USED))
      .mockResolvedValueOnce({});
    deleteImpl = deleted;
    await clickDelete();
    const block = await rtl.findByTestId('asset-in-use-block');
    expect(block).toHaveTextContent("It's in 3 playlists reaching 8 screens");
    expect(within(block).getByText('Summer Strength')).toBeInTheDocument();
    expect(deleted).toHaveBeenCalledTimes(1);
    expect(deleted).toHaveBeenLastCalledWith({ id: 'a1', confirmInUse: false });
    expect(appAlert).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(block).getByRole('button', { name: 'Delete anyway' }));
    });
    expect(deleted).toHaveBeenCalledTimes(2);
    expect(deleted).toHaveBeenLastCalledWith({ id: 'a1', confirmInUse: true });
    expect(rtl.queryByTestId('asset-in-use-block')).not.toBeInTheDocument();
  });

  it('Cancel on that warning sends nothing more', async () => {
    preflight = () => Promise.reject(new Error('503'));
    appConfirm.mockResolvedValue(true);
    const deleted = jest.fn().mockRejectedValueOnce(assetInUse409(USED));
    deleteImpl = deleted;
    await clickDelete();
    const block = await rtl.findByTestId('asset-in-use-block');
    fireEvent.click(within(block).getByRole('button', { name: 'Cancel' }));
    expect(rtl.queryByTestId('asset-in-use-block')).not.toBeInTheDocument();
    expect(deleted).toHaveBeenCalledTimes(1);
  });

  it('a server usage that turns out to be protected emergency content: the protected notice, never a delete offer', async () => {
    preflight = () => Promise.resolve(UNUSED);
    appConfirm.mockResolvedValue(true);
    const deleted = jest.fn().mockRejectedValueOnce(assetInUse409({ ...USED, protectedEmergency: true }));
    deleteImpl = deleted;
    await clickDelete();
    await waitFor(() => expect(appAlert).toHaveBeenCalled());
    expect(appAlert.mock.calls[0][0].title).toBe("Can't delete this file");
    expect(rtl.queryByTestId('asset-in-use-block')).not.toBeInTheDocument();
    expect(deleted).toHaveBeenCalledTimes(1);
  });

  it('a 409 ASSET_IN_USE with no usage summary: the server sentence, and no confirmed retry', async () => {
    preflight = () => Promise.resolve(UNUSED);
    appConfirm.mockResolvedValue(true);
    const deleted = jest.fn().mockRejectedValueOnce(assetInUse409());
    deleteImpl = deleted;
    await clickDelete();
    await waitFor(() => expect(appAlert).toHaveBeenCalled());
    expect(appAlert.mock.calls[0][0]).toMatchObject({
      title: "Couldn't delete this file",
      message: expect.stringContaining('so it was not deleted'),
    });
    expect(rtl.queryByTestId('asset-in-use-block')).not.toBeInTheDocument();
    expect(deleted).toHaveBeenCalledTimes(1);
  });

  it('a refusal of the CONFIRMED delete (emergency content) is reported, never answered with another confirmation', async () => {
    preflight = () => Promise.resolve(USED);
    const deleted = jest.fn().mockRejectedValueOnce(
      Object.assign(new Error('This file is emergency content.'), { status: 409, code: 'ASSET_IN_EMERGENCY_CONTENT' }),
    );
    deleteImpl = deleted;
    await clickDelete();
    const block = await rtl.findByTestId('asset-in-use-block');
    await act(async () => {
      fireEvent.click(within(block).getByRole('button', { name: 'Delete anyway' }));
    });
    await waitFor(() => expect(appAlert).toHaveBeenCalled());
    expect(appAlert.mock.calls[0][0]).toMatchObject({ title: "Couldn't delete this file", message: 'This file is emergency content.' });
    expect(deleted).toHaveBeenCalledTimes(1);
    expect(deleted).toHaveBeenCalledWith({ id: 'a1', confirmInUse: true });
  });

  describe('bulk delete', () => {
    function selectAndDelete() {
      render(<AssetsPage />);
      fireEvent.click(rtl.getByRole('checkbox', { name: 'Select Recovery-Lounge-August.jpg' }));
      return act(async () => {
        fireEvent.click(within(rtl.getByTestId('asset-bulk-bar')).getByRole('button', { name: /^Delete$/ }));
      });
    }

    it('its warning names the in-use consequence, and each delete then carries the confirmation', async () => {
      appConfirm.mockResolvedValue(true);
      const deleted = jest.fn().mockResolvedValue({});
      deleteImpl = deleted;
      await selectAndDelete();
      await waitFor(() => expect(deleted).toHaveBeenCalled());
      expect(appConfirm.mock.calls[0][0].message).toContain("They'll be removed from any playlists that use them.");
      expect(deleted).toHaveBeenCalledWith({ ids: ['a1'], confirmInUse: true });
    });

    it('a cancelled bulk warning sends nothing', async () => {
      appConfirm.mockResolvedValue(false);
      const deleted = jest.fn().mockResolvedValue({});
      deleteImpl = deleted;
      await selectAndDelete();
      await waitFor(() => expect(appConfirm).toHaveBeenCalled());
      expect(deleted).not.toHaveBeenCalled();
    });

    it('an emergency refusal (ASSET_IN_EMERGENCY_CONTENT) is reported as protected content that was kept', async () => {
      appConfirm.mockResolvedValue(true);
      deleteImpl = () =>
        Promise.resolve({ results: [{ id: 'a1', deleted: false, code: 'ASSET_IN_EMERGENCY_CONTENT', message: 'This file is emergency content.' }] });
      await selectAndDelete();
      await waitFor(() => expect(appAlert).toHaveBeenCalled());
      expect(appAlert.mock.calls[0][0]).toMatchObject({ title: "Couldn't delete every file" });
      expect(appAlert.mock.calls[0][0].message).toBe('0 of 1 deleted. 1 is used for emergency alerts and was kept. This file is emergency content.');
    });
  });
});
