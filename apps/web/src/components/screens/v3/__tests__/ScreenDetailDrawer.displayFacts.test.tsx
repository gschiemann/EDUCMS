/**
 * "A green test is not proof of a mount" (CLAUDE.md #9): this renders the REAL
 * ScreenDetailDrawer and asks whether the Overview tab shows the "Panel and
 * playback pacing" section — for a screen that has a native report, and not at
 * all for one that has none. Every fixture is made up.
 */
import * as React from 'react';
import { render, screen as rtl, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ScreenDetailDrawer } from '../ScreenDetailDrawer';
import { buildScreenOps, type OpsScreen } from '../screenOps';

jest.mock('@/hooks/use-api', () => ({
  useRefreshWeb: () => ({ mutate: jest.fn(), isPending: false }),
  useUpdateScreen: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
  useSetScreenOrientation: () => ({ mutate: jest.fn(), isPending: false }),
  useForceApkUpdate: () => ({ mutate: jest.fn(), isPending: false }),
  useDeleteScreen: () => ({ mutate: jest.fn(), isPending: false }),
  useScreenEvents: () => ({ data: { events: [] }, isLoading: false, isError: false }),
  useScreenDeviceInventory: () => ({ data: undefined, isLoading: false, isError: false }),
  useScreenPlaybackCapability: () => ({ data: undefined, isLoading: false, isError: false }),
  // The Overview's interruptions section (2026-10-18): nothing recorded yet.
  useScreenInterruptions: () => ({ data: undefined, isLoading: false, isError: false }),
  useClearPlaybackDemotion: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/lib/store', () => ({
  useAppStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'u1', role: 'SCHOOL_ADMIN' } }),
}));
jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));
jest.mock('@/lib/api-client', () => ({ apiFetch: jest.fn(async () => ({ success: true })) }));
jest.mock('@/components/ui/app-dialog', () => ({ appConfirm: jest.fn(async () => true) }));

const NOW = Date.parse('2026-10-18T12:00:00.000Z');

const buckets = (): number[] => {
  const b = new Array<number>(16).fill(0);
  b[2] = 4; b[4] = 41_191; b[5] = 5; b[8] = 3;
  return b;
};

const NATIVE = {
  version: 1,
  state: 'presenting',
  at: new Date(NOW - 120_000).toISOString(),
  evidence: 'surface-render-callback',
  timing: {
    decodedFrames: 41_210, submittedFrames: 41_203, lateFrames: 143, lastLateUs: 120, maxLateUs: 4_100,
    maxSubmitGapMs: 96, leadUs: 66_666, sourceWidth: 3840, sourceHeight: 2160,
    droppedFrames: 0, sourceFps: 30, refreshRate: 30, displayMode: '1:3840x2160@30.00',
    intervalUnitNs: 8_333_333, intervalBuckets: buckets(), intervalCount: 41_203,
    supportedModes: ['1:3840x2160@30.00'], keepScreenOn: true,
  },
};

function screenRow(over: Partial<OpsScreen> = {}) {
  const screen: OpsScreen = {
    id: 'scr-test-1', name: 'Test lobby screen', status: 'ONLINE',
    lastPingAt: new Date(NOW - 8_000).toISOString(),
    renderHealth: 'OK', renderStale: false,
    lastRenderedAt: new Date(NOW - 20_000).toISOString(), lastRenderedHash: 'content:9f2',
    pendingRefreshAt: null, pushChannel: 'live', authState: 'PROVEN',
    hardwareModel: 'Test Wall Display', resolution: '3840x2160',
    ...over,
  };
  return buildScreenOps({ screens: [screen], schedules: [], playlists: [], deployedSha: null, now: NOW }).rows[0];
}

function renderDrawer(row: ReturnType<typeof screenRow>) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ScreenDetailDrawer
        row={row}
        placeName="Test group"
        previewHref={null}
        canControl
        groups={[]}
        now={NOW}
        onClose={jest.fn()}
        onOpenDisplaySchedule={jest.fn()}
        pushState={undefined}
        onPushApk={jest.fn()}
        apkPending={false}
        onRefreshWeb={jest.fn()}
        refreshWebPending={false}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

describe('ScreenDetailDrawer → Panel and playback pacing', () => {
  it('shows the section on the Overview tab for a screen with a native report', () => {
    renderDrawer(screenRow({ lastVideoReport: { url: 'https://example.test/a.mp4', native: NATIVE } }));
    const overview = rtl.getByRole('tabpanel');
    const section = within(overview).getByTestId('display-facts-section');
    expect(within(section).getByRole('heading', { name: 'Panel and playback pacing' })).toBeInTheDocument();
    expect(section.textContent).toContain('3840×2160 at 30 Hz');
    expect(section.textContent).toContain('99.97 % on cadence · 143 late · 0 dropped · max gap 96 ms');
    expect(section.textContent).toContain('The player window held keep-screen-on at the last report.');
  });

  it('sits between the video playback card and the Device card', () => {
    renderDrawer(screenRow({ lastVideoReport: { native: NATIVE } }));
    const section = rtl.getByTestId('display-facts-section');
    const content = rtl.getByTestId('screen-content-card');
    const device = rtl.getByTestId('screen-device-card');
    expect(content.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section.compareDocumentPosition(device) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each([
    ['a screen that never reported video', {}],
    ['an HTML-only video sample', { lastVideoReport: { url: 'https://example.test/a.mp4', totalFrames: 900, droppedFrames: 3 } }],
    ['an empty native block', { lastVideoReport: { native: {} } }],
  ])('shows no box at all for %s', (_name, over) => {
    renderDrawer(screenRow(over as Partial<OpsScreen>));
    expect(rtl.queryByTestId('display-facts-section')).not.toBeInTheDocument();
    expect(rtl.queryByText('Panel and playback pacing')).not.toBeInTheDocument();
    // The rest of the Overview is untouched.
    expect(rtl.getByTestId('screen-content-card')).toBeInTheDocument();
  });

  it('is an Overview fact: the Settings and History tabs do not carry it', () => {
    renderDrawer(screenRow({ lastVideoReport: { native: NATIVE } }));
    fireEvent.click(rtl.getByRole('tab', { name: 'History' }));
    expect(rtl.queryByTestId('display-facts-section')).not.toBeInTheDocument();
  });
});
