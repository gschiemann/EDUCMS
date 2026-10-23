/**
 * The drawer for an end user (2026-10-22). Greg, on L55VEC's Overview: "the
 * overview screen has so much shit in it again, make sure we only show useful
 * items here to an end user". These pin the rules: a silent live channel is
 * not a banner, an old or invisible video blip is not red, one video verdict,
 * and the support material lives under Technical details — closed, and
 * fetching nothing until opened. Real problems keep their banner. Every
 * fixture is made up.
 */
import * as React from 'react';
import { act, render, screen as rtl, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ScreenDetailDrawer } from '../ScreenDetailDrawer';
import { buildScreenOps, type OpsScreen } from '../screenOps';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let playbackData: any;
const interruptionsCalls: unknown[][] = [];

jest.mock('@/hooks/use-api', () => ({
  useRefreshWeb: () => ({ mutate: jest.fn(), isPending: false }),
  useUpdateScreen: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
  useSetScreenOrientation: () => ({ mutate: jest.fn(), isPending: false }),
  useForceApkUpdate: () => ({ mutate: jest.fn(), isPending: false }),
  useDeleteScreen: () => ({ mutate: jest.fn(), isPending: false }),
  useScreenEvents: () => ({ data: { events: [] }, isLoading: false, isError: false }),
  useScreenDeviceInventory: () => ({ data: undefined, isLoading: false, isError: false }),
  useScreenPlaybackCapability: (_id: string, enabled: boolean) => ({ data: enabled ? playbackData : undefined, isLoading: false, isError: false }),
  // The Overview's interruptions section (2026-10-18): nothing recorded yet.
  useScreenInterruptions: (...args: unknown[]) => { interruptionsCalls.push(args); return { data: undefined, isLoading: false, isError: false }; },
  useClearPlaybackDemotion: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/lib/store', () => ({
  useAppStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'u1', role: 'SCHOOL_ADMIN' } }),
}));
jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));
jest.mock('@/lib/api-client', () => ({ apiFetch: jest.fn(async () => ({ success: true })) }));
jest.mock('@/components/ui/app-dialog', () => ({ appConfirm: jest.fn(async () => true) }));

const NOW = Date.parse('2026-10-22T15:00:00.000Z');
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

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


/** Technical details start closed and render nothing until opened (2026-10-22). */
function openTechnicalDetails() {
  const d = rtl.getByTestId('screen-technical-details') as HTMLDetailsElement;
  act(() => {
    d.open = true;
    d.dispatchEvent(new Event('toggle'));
  });
}


/** L55VEC's sample: 5 of 1,032 frames, three pauses worth 0.1 s, two days old. */
const OLD_BLIP = {
  url: 'https://example.test/media/clip.mp4', totalFrames: 1032, droppedFrames: 5,
  stalls: 3, stalledMs: 100, width: 2160, height: 3338, at: ago(49 * HOUR),
};

const SMOOTH = {
  screenId: 'scr-test-1', summary: 'smooth', declared: null, demotions: [],
  capability: {
    deviceClass: null, maxShortEdge: 2160, stuttersAtShortEdge: null, maxFps: null, maxUnitConcurrentVideos: null,
    evidence: 'measured-screen', concurrencyEvidence: 'unknown', evidenceAt: null, classScreens: 1, stale: false,
  },
  files: [{ sha256: 'a'.repeat(64), name: 'Promo.mp4', verdict: 'smooth', droppedPct: 0.1, samples: 100, settledSamples: 100,
    excludedSamples: 0, excludedReason: null, copy: null, width: 1920, height: 1080, unitConcurrentMax: 1 }],
};

beforeEach(() => {
  Element.prototype.scrollIntoView = jest.fn();
  playbackData = undefined;
  interruptionsCalls.length = 0;
});

describe('ScreenDetailDrawer for an end user (2026-10-22)', () => {
  it('a silent live channel is no banner; the fact waits under Technical details', () => {
    renderDrawer(screenRow({ pushChannel: 'stale', lastPushConnectedAt: ago(14 * HOUR) }));
    expect(rtl.queryByText(/Push delayed/)).not.toBeInTheDocument();
    openTechnicalDetails();
    expect(rtl.getByTestId('screen-live-link')).toHaveTextContent('Live connection: down since 14h ago.');
  });

  it('a real problem still gets its banner: offline', () => {
    renderDrawer(screenRow({ status: 'OFFLINE', lastPingAt: ago(2 * HOUR) }));
    const dialog = rtl.getByRole('dialog');
    expect(within(dialog).getByText('Offline · 2 hours')).toBeInTheDocument();
  });

  it('an old, invisible video blip is never red on the Overview', () => {
    renderDrawer(screenRow({ lastVideoReport: OLD_BLIP }));
    expect(rtl.queryByText('Stuttered on this screen')).not.toBeInTheDocument();
    expect(rtl.queryByTestId('screen-video-playback')).not.toBeInTheDocument();
    openTechnicalDetails();
    const sample = rtl.getByTestId('screen-video-playback');
    expect(sample).toHaveAttribute('data-video-news', 'false');
    expect(sample.className).not.toMatch(/rose|amber/);
    expect(sample).toHaveTextContent('5 of 1,032 frames dropped (0.5%)');
    expect(within(sample).queryByText(/Open this file in the Media Library/)).not.toBeInTheDocument();
  });

  it('a recent, visible stutter is news: it stays on the Overview, in colour', () => {
    renderDrawer(screenRow({
      lastVideoReport: { url: 'https://example.test/media/clip.mp4', totalFrames: 1000, droppedFrames: 80, at: ago(10 * 60_000) },
    }));
    const card = rtl.getByTestId('screen-content-card');
    const sample = within(card).getByTestId('screen-video-playback');
    expect(sample).toHaveAttribute('data-video-news', 'true');
    expect(sample).toHaveTextContent('Stuttered on this screen');
    expect(sample.className).toMatch(/rose/);
  });

  it('one video verdict on the Overview; the per-file list only under Technical details', () => {
    playbackData = SMOOTH;
    renderDrawer(screenRow());
    expect(rtl.getByTestId('screen-playback-summary')).toHaveTextContent('Plays video smoothly');
    expect(rtl.queryByTestId('screen-playback-files')).not.toBeInTheDocument();
    openTechnicalDetails();
    expect(rtl.getByTestId('screen-playback-files')).toBeInTheDocument();
    // The verdict is not drawn twice.
    expect(rtl.getAllByTestId('screen-playback-summary')).toHaveLength(1);
  });

  it('a screen with nothing measured says nothing about video on the Overview', () => {
    playbackData = { ...SMOOTH, summary: 'unknown', files: [] };
    renderDrawer(screenRow());
    expect(rtl.queryByTestId('screen-playback-card')).not.toBeInTheDocument();
  });

  it('Technical details start closed and fetch nothing until opened', () => {
    renderDrawer(screenRow());
    const d = rtl.getByTestId('screen-technical-details') as HTMLDetailsElement;
    expect(d.open).toBe(false);
    expect(interruptionsCalls).toHaveLength(0);
    openTechnicalDetails();
    expect(interruptionsCalls.length).toBeGreaterThan(0);
  });
});
