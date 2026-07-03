/**
 * Sports Wave S3 — S3-3 (2026-07-03 sports deep-pass audit, P0-3
 * follow-up): `DiveJudgesPanelWidget` used to render a HARD-CODED
 * fabricated dive description ("REVERSE 1½ SOMERSAULT TUCK",
 * SwimDiveWidgets.tsx:983 pre-fix) on every surface, live or not — a
 * real, bound meet with no diveGroup configured showed an invented dive
 * name to the crowd. The rest of this widget (diverName/diveCode/dd)
 * already followed the S2-1 no-fake-data rule (live reads the real
 * scalar stat or renders blank/dash; only the builder shows the sample);
 * diveGroup was the one field S2-1 explicitly left for this wave (see
 * CLAUDE.md task description). This spec proves the fix the same way
 * `sports-render-surface.test.tsx` proves every other S2-1 case: mount
 * `WidgetPreview` with a real `GameStateProvider` (mocked poll) via
 * `config.gameId` on `renderSurface="player"`, and assert the fabricated
 * string never appears once real (but diveGroup-less) live data exists.
 *
 * A NEW file (not an edit to the existing sports-render-surface.test.tsx)
 * per this wave's fence — same render helper + mocking pattern, just
 * scoped to the one widget/field this wave owns.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { WidgetPreview } from '../WidgetRenderer';

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

function renderWidget(
  type: string,
  config: Record<string, unknown> = {},
  extra: { renderSurface?: 'player' } = {},
) {
  return render(
    <div style={{ position: 'relative', width: 800, height: 450 }}>
      <WidgetPreview
        widgetType={type}
        config={config}
        width={100}
        height={100}
        live={extra.renderSurface === 'player'}
        renderSurface={extra.renderSurface}
      />
    </div>,
  );
}

const FABRICATED_DIVE = 'REVERSE 1½ SOMERSAULT TUCK'; // the pre-fix hard-coded string

describe('DIVE_JUDGES_PANEL — diveGroup no-fake-data (S3-3)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function mockLiveGame(stats: Record<string, unknown>) {
    const fetchMock = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'dive-meet-1',
            sport: 'diving',
            status: 'LIVE',
            segment: 1,
            homeTeam: 'RIVERSIDE',
            awayTeam: 'LAKEVIEW',
            homeScore: 0,
            awayScore: 0,
            homeColor: '#0f766e',
            awayColor: '#7c2d12',
            homeLogoUrl: null,
            awayLogoUrl: null,
            clockMs: 0,
            clockRunning: false,
            clockUpdatedAt: new Date().toISOString(),
            stats,
            serverTime: Date.now(),
          }),
      }),
    );
    (global as unknown as { fetch: unknown }).fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  it('a real bound dive with NO diveGroup configured renders no dive-name line at all — never the fabricated sample', async () => {
    const fetchMock = mockLiveGame({
      currentDiver: 'R. TANAKA',
      diveCode: '305C',
      dd: 2.7,
      judgeScores: [7, 7.5, 8],
    });

    renderWidget(
      'DIVE_JUDGES_PANEL',
      { gameId: 'dive-meet-1' }, // NO diveGroup override — the common case
      { renderSurface: 'player' },
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/R\. TANAKA/)).toBeInTheDocument());

    // The real diver/dive-code/DD show (proves this is the "live with
    // data" branch, not the earlier "no game bound" empty state).
    expect(screen.getByText(/305C/)).toBeInTheDocument();
    // The fabricated sample dive name must NEVER appear on a live surface.
    expect(screen.queryByText(new RegExp(FABRICATED_DIVE, 'i'))).not.toBeInTheDocument();
    expect(screen.queryByText('SAMPLE')).not.toBeInTheDocument();
  });

  it('a real bound dive WITH an operator-configured diveGroup renders that real override', async () => {
    const fetchMock = mockLiveGame({
      currentDiver: 'R. TANAKA',
      diveCode: '305C',
      dd: 2.7,
      judgeScores: [7, 7.5, 8],
    });

    renderWidget(
      'DIVE_JUDGES_PANEL',
      { gameId: 'dive-meet-1', diveGroup: 'Forward 2½ Somersault Pike' },
      { renderSurface: 'player' },
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/FORWARD 2½ SOMERSAULT PIKE/i)).toBeInTheDocument());
    expect(screen.queryByText(new RegExp(FABRICATED_DIVE, 'i'))).not.toBeInTheDocument();
  });

  it('the builder (no renderSurface / no GameStateProvider) still shows the fabricated SAMPLE dive, clearly watermarked', () => {
    render(
      <div style={{ position: 'relative', width: 800, height: 450 }}>
        <WidgetPreview widgetType="DIVE_JUDGES_PANEL" config={{}} width={100} height={100} live={false} />
      </div>,
    );
    expect(screen.getByText(new RegExp(FABRICATED_DIVE, 'i'))).toBeInTheDocument();
    expect(screen.getByText('SAMPLE')).toBeInTheDocument();
  });

  it('on the real player with NO game bound at all: the bind-a-game callout shows, never the fabricated dive name', () => {
    renderWidget('DIVE_JUDGES_PANEL', {}, { renderSurface: 'player' });
    expect(screen.getByText('NO GAME BOUND')).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(FABRICATED_DIVE, 'i'))).not.toBeInTheDocument();
  });
});
