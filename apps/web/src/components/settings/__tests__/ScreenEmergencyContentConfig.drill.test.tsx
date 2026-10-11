/**
 * Per-screen emergency content — the Live | Drill switch (2026-10-10).
 *
 * Greg: "custom location content available for drills too — just duplicate
 * everything for live emergencies to drill ones." The drawer's config opens
 * on LIVE, and in DRILL every upload / clear writes the screen's `drill*`
 * columns (never the live ones), under the same per-type slots.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mutateAsync = jest.fn();
jest.mock('@/hooks/use-api', () => ({
  useUpdateScreenEmergencyContent: () => ({ mutateAsync, isPending: false, isError: false }),
}));
jest.mock('@/hooks/use-tenant-copy', () => ({ useTenantCopy: () => ({ vertical: 'K12' }) }));
jest.mock('@/store/ui-store', () => ({ useUIStore: { getState: () => ({ token: 'tok' }) } }));
jest.mock('@/lib/api-url', () => ({ API_URL: 'http://api.test/api/v1' }));

import { ScreenEmergencyContentConfig, screenContentApiKeys } from '@/components/settings/ScreenEmergencyContentConfig';

const baseScreen = {
  id: 's-1',
  name: 'Gym',
  floorX: null,
  floorY: null,
  status: 'ONLINE',
  lastPingAt: null,
  emergencyLockdownAssetUrl: 'https://cdn.test/live-lockdown.png',
  drillLockdownAssetUrl: null,
};

function pickFile(input: HTMLInputElement) {
  const file = new File(['png'], 'drill.png', { type: 'image/png' });
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue({});
  (global as any).fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ url: 'https://cdn.test/uploaded.png' }),
  }));
});

describe('the API keys per mode', () => {
  it('live keys are the Sprint-8b body keys; drill keys are the drill column names', () => {
    expect(screenContentApiKeys('lockdown', 'landscape', 'live')).toEqual({ playlist: 'lockdownPlaylistId', asset: 'lockdownAssetUrl' });
    expect(screenContentApiKeys('lockdown', 'portrait', 'live')).toEqual({ playlist: 'lockdownPortraitPlaylistId', asset: 'lockdownPortraitAssetUrl' });
    expect(screenContentApiKeys('lockdown', 'landscape', 'drill')).toEqual({ playlist: 'drillLockdownPlaylistId', asset: 'drillLockdownAssetUrl' });
    expect(screenContentApiKeys('evacuate', 'portrait', 'drill')).toEqual({ playlist: 'drillEvacuatePortraitPlaylistId', asset: 'drillEvacuatePortraitAssetUrl' });
    expect(screenContentApiKeys('medical', 'landscape', 'drill')).toEqual({ playlist: 'drillMedicalPlaylistId', asset: 'drillMedicalAssetUrl' });
  });
});

describe('ScreenEmergencyContentConfig — Live | Drill', () => {
  it('opens on LIVE and shows the live slot; an upload writes the live keys', async () => {
    render(<ScreenEmergencyContentConfig screenId="s-1" screen={baseScreen as any} />);
    expect(screen.getByTestId('screen-emergency-content')).toHaveAttribute('data-mode', 'live');
    expect(screen.getByTestId('screen-emergency-mode-tab-live')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('screen-emergency-mode-note')).toHaveTextContent('during a real emergency');
    // the live lockdown asset is shown
    expect(screen.getByText(/live-lockdown\.png/)).toBeInTheDocument();

    const inputs = document.querySelectorAll('input[type="file"]');
    await act(async () => pickFile(inputs[0] as HTMLInputElement)); // lockdown · landscape
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      screenId: 's-1',
      patch: { lockdownAssetUrl: 'https://cdn.test/uploaded.png', lockdownPlaylistId: null },
    });
  });

  it('in DRILL the same slot is empty, the note says drill, and an upload writes the DRILL keys only', async () => {
    render(<ScreenEmergencyContentConfig screenId="s-1" screen={baseScreen as any} />);
    fireEvent.click(screen.getByTestId('screen-emergency-mode-tab-drill'));
    expect(screen.getByTestId('screen-emergency-content')).toHaveAttribute('data-mode', 'drill');
    expect(screen.getByTestId('screen-emergency-mode-tab-drill')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('screen-emergency-mode-note')).toHaveTextContent('practice drill');
    // the LIVE asset is not shown in the drill slot
    expect(screen.queryByText(/live-lockdown\.png/)).not.toBeInTheDocument();

    const inputs = document.querySelectorAll('input[type="file"]');
    await act(async () => pickFile(inputs[0] as HTMLInputElement));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      screenId: 's-1',
      patch: { drillLockdownAssetUrl: 'https://cdn.test/uploaded.png', drillLockdownPlaylistId: null },
    });
    const patch = mutateAsync.mock.calls[0][0].patch;
    expect(Object.keys(patch).every((k) => k.startsWith('drill'))).toBe(true);
    // the drill slot now shows the upload
    expect(screen.getByText(/uploaded\.png/)).toBeInTheDocument();
  });

  it('clearing a DRILL slot clears the drill keys and leaves the live asset alone', async () => {
    render(
      <ScreenEmergencyContentConfig
        screenId="s-1"
        screen={{ ...baseScreen, drillLockdownAssetUrl: 'https://cdn.test/drill-lockdown.png' } as any}
      />,
    );
    fireEvent.click(screen.getByTestId('screen-emergency-mode-tab-drill'));
    expect(screen.getByText(/drill-lockdown\.png/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Clear Landscape Lockdown asset'));
    });
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      screenId: 's-1',
      patch: { drillLockdownPlaylistId: null, drillLockdownAssetUrl: null },
    });
    // back on LIVE the live asset is untouched
    fireEvent.click(screen.getByTestId('screen-emergency-mode-tab-live'));
    expect(screen.getByText(/live-lockdown\.png/)).toBeInTheDocument();
  });

  it('returns to LIVE when another screen is opened', () => {
    const { rerender } = render(<ScreenEmergencyContentConfig screenId="s-1" screen={baseScreen as any} />);
    fireEvent.click(screen.getByTestId('screen-emergency-mode-tab-drill'));
    expect(screen.getByTestId('screen-emergency-content')).toHaveAttribute('data-mode', 'drill');
    rerender(<ScreenEmergencyContentConfig screenId="s-2" screen={{ ...baseScreen, id: 's-2' } as any} />);
    expect(screen.getByTestId('screen-emergency-content')).toHaveAttribute('data-mode', 'live');
  });
});
