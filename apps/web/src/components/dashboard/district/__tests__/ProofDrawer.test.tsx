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
import { render, screen as rtl, fireEvent } from '@testing-library/react';
import { ProofDrawer, type ProofDrawerScreen } from '../ProofDrawer';
import type { DeploymentRow } from '@/hooks/use-api';

const useScreenEvents = jest.fn();
jest.mock('@/hooks/use-api', () => ({
  useScreenEvents: (screenId: string | null) => useScreenEvents(screenId),
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
});

describe('ProofDrawer', () => {
  it('names the waiting screens with an ack chip beside the render-proof chip', () => {
    renderDrawer();
    expect(rtl.getByText('Fall promo board')).toBeInTheDocument();
    expect(rtl.getByText('4/6 confirmed')).toBeInTheDocument();
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
    expect(rtl.queryByText('Update push sent')).not.toBeInTheDocument();
    expect(useScreenEvents).toHaveBeenCalledWith(null);

    fireEvent.click(rtl.getByText('Front desk'));

    expect(rtl.getByText('Update push sent')).toBeInTheDocument();
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
