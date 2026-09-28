/**
 * Render-level proof for the ProofDrawer (Fleet Command, Phase 2).
 *
 * The three things an operator must be able to trust here:
 *   1. A screen still holding this push reads "Waiting…" NEXT TO its own
 *      render-proof verdict — two independent truths, never merged.
 *   2. Targets the payload cannot name are reported as an honest aggregate,
 *      not silently dropped and not guessed at by name.
 *   3. Expanding a screen speaks plain English, never the wire vocabulary.
 */
import * as React from 'react';
import { render, screen as rtl, fireEvent, act } from '@testing-library/react';
import { ProofDrawer, type ProofDrawerScreen } from '../ProofDrawer';
import type { DeploymentRow } from '@/hooks/use-api';

const useScreenEvents = jest.fn();
const refreshMutate = jest.fn();
let refreshPending = false;
jest.mock('@/hooks/use-api', () => ({
  useScreenEvents: (screenId: string | null) => useScreenEvents(screenId),
  useRefreshWeb: () => ({ mutate: refreshMutate, isPending: refreshPending }),
}));
jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));

const VALUE = 1_724_000_000_000;

const deployment: DeploymentRow = {
  id: 'dep1',
  tenantId: 'west',
  label: 'Fall promo board',
  createdAt: new Date(Date.now() - 3 * 60_000).toISOString(),
  valueMs: VALUE,
  targetCount: 6,
  convergence: { converged: 4, painting: 2, done: false },
};

const screens: ProofDrawerScreen[] = [
  { id: 's1', name: 'Front desk', status: 'ONLINE', renderHealth: 'OK', renderStale: false, pendingRefreshAtMs: VALUE, locationName: 'Peak West' },
  { id: 's2', name: 'Studio A', status: 'ONLINE', renderHealth: 'OK', renderStale: false, pendingRefreshAtMs: VALUE, locationName: 'Peak West' },
];

function renderDrawer(over: Partial<React.ComponentProps<typeof ProofDrawer>> = {}) {
  return render(
    <ProofDrawer
      deployment={deployment}
      screens={screens}
      locationNoun={{ one: 'gym', many: 'gyms' }}
      onClose={() => {}}
      {...over}
    />,
  );
}

beforeEach(() => {
  useScreenEvents.mockReset();
  useScreenEvents.mockReturnValue({ data: undefined, isLoading: false });
  refreshMutate.mockReset();
  refreshPending = false;
});

describe('ProofDrawer', () => {
  it('names the waiting screens with an ack chip beside the render-proof chip', () => {
    renderDrawer();
    expect(rtl.getByText('Fall promo board')).toBeInTheDocument();
    expect(rtl.getByText(/4 of 6 confirmed/)).toBeInTheDocument();
    expect(rtl.getByText('Front desk')).toBeInTheDocument();
    expect(rtl.getByText('Studio A')).toBeInTheDocument();
    expect(rtl.getAllByText('Waiting…')).toHaveLength(2);
    // RenderTrustChip's own copy — proof of a picture is a SEPARATE truth
    // from "this push landed", and both must be on the row.
    expect(rtl.getAllByText(/Showing content ✓/).length).toBe(2);
    // Grouped under the location, counted with the vertical noun.
    expect(rtl.getByText('Peak West')).toBeInTheDocument();
    expect(rtl.getByText(/2 screens across 1 gym/)).toBeInTheDocument();
  });

  it('a screen that no longer holds this value reads "Update confirmed"', () => {
    renderDrawer({
      screens: [{ ...screens[0], pendingRefreshAtMs: null }],
    });
    expect(rtl.getByText('Update confirmed')).toBeInTheDocument();
    expect(rtl.queryByText('Waiting…')).not.toBeInTheDocument();
  });

  it('reports the targets it cannot name as an honest aggregate', () => {
    renderDrawer();
    // 6 targets − 2 nameable = 4 we can only count.
    expect(rtl.getByText('Confirmed or superseded (4)')).toBeInTheDocument();
    expect(rtl.getByText(/can’t list them by name/)).toBeInTheDocument();
  });

  it('expanding a screen loads its history and speaks plain English', () => {
    useScreenEvents.mockImplementation((id: string | null) =>
      id === 's1'
        ? {
            isLoading: false,
            data: {
              events: [
                { id: 'e1', kind: 'refresh-requested', detail: {}, createdAt: new Date(Date.now() - 60_000).toISOString() },
                { id: 'e2', kind: 'auto-refresh-requested', detail: {}, createdAt: new Date(Date.now() - 120_000).toISOString() },
                { id: 'e3', kind: 'refresh-acked', detail: {}, createdAt: new Date(Date.now() - 180_000).toISOString() },
                { id: 'e4', kind: 'repair-required', detail: {}, createdAt: new Date(Date.now() - 240_000).toISOString() },
                { id: 'e5', kind: 'credential-restored', detail: {}, createdAt: new Date(Date.now() - 300_000).toISOString() },
              ],
            },
          }
        : { isLoading: false, data: undefined },
    );
    renderDrawer();
    // Collapsed: dormant query, nothing rendered.
    expect(rtl.queryByText('Update sent to this screen')).not.toBeInTheDocument();
    expect(useScreenEvents).toHaveBeenCalledWith(null);

    fireEvent.click(rtl.getByText('Front desk'));

    expect(rtl.getByText('Update sent to this screen')).toBeInTheDocument();
    expect(rtl.getByText('VenueOS asked this screen to reload itself')).toBeInTheDocument();
    expect(rtl.getByText('Screen confirmed the update')).toBeInTheDocument();
    expect(rtl.getByText('Screen needs re-pairing')).toBeInTheDocument();
    expect(rtl.getByText('Screen’s trust restored')).toBeInTheDocument();
    // Engineer-speak is banned on this surface.
    expect(rtl.queryByText(/manifest|render-proof|poll/i)).not.toBeInTheDocument();
  });

  it('empty history says so instead of showing nothing', () => {
    useScreenEvents.mockReturnValue({ isLoading: false, data: { events: [] } });
    renderDrawer();
    fireEvent.click(rtl.getByText('Front desk'));
    expect(rtl.getByText('No recent activity recorded.')).toBeInTheDocument();
  });

  // ─── Per-screen take-over ("Push again") ────────────────────────
  it('offers "Push again" ONLY on a row that is still waiting', () => {
    renderDrawer({
      screens: [screens[0], { ...screens[1], pendingRefreshAtMs: null }],
    });
    // One waiting screen → exactly one button. A confirmed row must not
    // offer a fix that would do nothing.
    expect(rtl.getAllByText('Push again')).toHaveLength(1);
    expect(rtl.getByText('Update confirmed')).toBeInTheDocument();
  });

  it('fires the push for THAT screen only, and says so in plain English', () => {
    renderDrawer();
    const buttons = rtl.getAllByText('Push again');
    expect(buttons[1]).toHaveAttribute('title', 'Send this one screen the reload command again.');
    fireEvent.click(buttons[1]); // Studio A — the second row
    expect(refreshMutate).toHaveBeenCalledTimes(1);
    expect(refreshMutate).toHaveBeenCalledWith({ screenId: 's2' });
  });

  it('confirms with a transient "Sent ✓" that cannot re-fire, then offers itself again', () => {
    jest.useFakeTimers();
    try {
      renderDrawer();
      const button = rtl.getAllByText('Push again')[0];
      fireEvent.click(button);

      const sent = rtl.getByText('Sent ✓');
      expect(sent).toBeDisabled();
      fireEvent.click(sent);
      expect(refreshMutate).toHaveBeenCalledTimes(1); // no double-fire

      act(() => { jest.advanceTimersByTime(3000); });
      expect(rtl.queryByText('Sent ✓')).not.toBeInTheDocument();
      // Only the row we clicked went quiet — the other still offers itself.
      expect(rtl.getAllByText('Push again')).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('is disabled while the push is in flight', () => {
    refreshPending = true;
    renderDrawer();
    expect(rtl.queryByText('Push again')).not.toBeInTheDocument();
    for (const b of rtl.getAllByLabelText('Sending')) {
      expect(b.closest('button')).toBeDisabled();
    }
  });

  // ─── Delivery pipeline stepper ──────────────────────────────────
  // The fourth node is the point of this suite: it must NEVER claim, in any
  // state, because nothing in this product can see the glass.
  it('renders the four lifecycle nodes off the deployment already passed in', () => {
    renderDrawer();
    expect(rtl.getByTestId('step-published')).toHaveTextContent('3m ago');
    expect(rtl.getByTestId('step-delivered')).toHaveTextContent('4/6');
    expect(rtl.getByTestId('step-showing')).toHaveTextContent('2/6');
    expect(rtl.getByTestId('step-verified')).toHaveTextContent('optional hardware evidence');
  });

  it('a node is complete only at the full count, partial above zero, none at zero', () => {
    renderDrawer({
      deployment: { ...deployment, convergence: { converged: 6, painting: 0, done: true } },
    });
    // Published always happened — that is what minted the record.
    expect(rtl.getByTestId('step-published')).toHaveAttribute('data-state', 'complete');
    expect(rtl.getByTestId('step-delivered')).toHaveAttribute('data-state', 'complete');
    expect(rtl.getByTestId('step-showing')).toHaveAttribute('data-state', 'none');
  });

  it('partial delivery is brand-tinted, never green', () => {
    renderDrawer();
    expect(rtl.getByTestId('step-delivered')).toHaveAttribute('data-state', 'partial');
    expect(rtl.getByTestId('step-showing')).toHaveAttribute('data-state', 'partial');
  });

  it('“Verified” stays unavailable even when every other node is complete', () => {
    renderDrawer({
      deployment: { ...deployment, convergence: { converged: 6, painting: 6, done: true } },
    });
    expect(rtl.getByTestId('step-delivered')).toHaveAttribute('data-state', 'complete');
    expect(rtl.getByTestId('step-showing')).toHaveAttribute('data-state', 'complete');
    // The one node that can never light up — we have no camera on the glass.
    expect(rtl.getByTestId('step-verified')).toHaveAttribute('data-state', 'unavailable');
    expect(rtl.getByTestId('step-verified').querySelector('.bg-emerald-500')).toBeNull();
  });

  it('a zero-target record never reads “complete” off an empty denominator', () => {
    renderDrawer({
      deployment: { ...deployment, targetCount: 0, convergence: { converged: 0, painting: 0, done: false } },
    });
    expect(rtl.getByTestId('step-delivered')).toHaveAttribute('data-state', 'none');
    expect(rtl.getByTestId('step-showing')).toHaveAttribute('data-state', 'none');
  });

  it('Escape and the close button both close; focus starts on close', () => {
    const onClose = jest.fn();
    renderDrawer({ onClose });
    expect(rtl.getByLabelText('Close')).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(rtl.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

/**
 * Lane B4 (2026-09-27) — the drawer is the only mount of the render-trust
 * chip, and it used to hand it three of its inputs: every download, every
 * "content unavailable", every re-pair and every stale proof read as either
 * the plain green or the red alarm. The chip now gets what the Screens page
 * gives it.
 */
describe('ProofDrawer — the chip says what each screen is doing', () => {
  const MB141 = 141 * 1024 * 1024;
  const fresh = () => new Date(Date.now() - 20_000).toISOString();
  const row = (over: Partial<ProofDrawerScreen>): ProofDrawerScreen => ({
    id: 'sx', name: 'Lobby', status: 'ONLINE', renderHealth: 'OK', renderStale: false,
    pendingRefreshAtMs: VALUE, locationName: 'Peak West', ...over,
  });
  const downloading = (deferredCommit: boolean) => ({
    downloading: { file: 'promo%20night.mp4', bytesLoaded: Math.ceil(MB141 * 0.62), bytesTotal: MB141, deferredCommit },
  });

  it('a screen downloading its first content: "Downloading new content · 62% of 141 MB"', () => {
    renderDrawer({
      screens: [row({ lastRenderedAt: fresh(), lastRenderedHash: 'idle:content-downloading', lastCacheReport: downloading(false), lastCacheReportAt: fresh() })],
    });
    expect(rtl.getByText(/Downloading new content · 62% of 141\sMB/)).toBeInTheDocument();
    expect(rtl.queryByText(/Showing content ✓/)).toBeNull();
  });

  it('new content held behind the previous one: "Still showing previous content · new content 62% of 141 MB"', () => {
    renderDrawer({
      screens: [row({ lastRenderedAt: fresh(), lastRenderedHash: 'pl:abc', lastCacheReport: downloading(true), lastCacheReportAt: fresh() })],
    });
    expect(rtl.getByText(/Still showing previous content · new content 62% of 141\sMB/)).toBeInTheDocument();
  });

  it('a snapshot too old to be progress shows no numbers', () => {
    renderDrawer({
      screens: [row({
        lastRenderedAt: fresh(), lastRenderedHash: 'idle:content-downloading',
        lastCacheReport: downloading(false), lastCacheReportAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      })],
    });
    expect(rtl.getByText(/Downloading new content · 20s ago/)).toBeInTheDocument();
    expect(rtl.queryByText(/62%/)).toBeNull();
  });

  it('every scheduled file failed: "Content unavailable"', () => {
    renderDrawer({ screens: [row({ lastRenderedAt: fresh(), lastRenderedHash: 'idle:content-unavailable' })] });
    expect(rtl.getByText(/Content unavailable · 20s ago/)).toBeInTheDocument();
  });

  it('a screen on downgraded credentials reads "Re-pair required", never plain green', () => {
    renderDrawer({ screens: [row({ lastRenderedAt: fresh(), lastRenderedHash: 'pl:abc', authState: 'REPAIR_REQUIRED' })] });
    expect(rtl.getByText(/Re-pair required/)).toBeInTheDocument();
    expect(rtl.queryByText(/Showing content ✓/)).toBeNull();
  });

  it('a proof that went quiet a minute ago is "Confirming picture…", not the red alarm', () => {
    renderDrawer({
      screens: [row({ renderHealth: 'STALE', renderStale: true, lastRenderedAt: new Date(Date.now() - 60_000).toISOString(), lastRenderedHash: 'pl:abc' })],
    });
    expect(rtl.getByText(/Confirming picture/)).toBeInTheDocument();
    expect(rtl.queryByText(/still responds/)).toBeNull();
  });

  it('a painting screen carries its check time', () => {
    renderDrawer({ screens: [row({ lastRenderedAt: fresh(), lastRenderedHash: 'pl:abc' })] });
    expect(rtl.getByText(/Showing content ✓ · checked 20s ago/)).toBeInTheDocument();
  });
});
