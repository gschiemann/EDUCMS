/**
 * Sports Wave S2-2 (2026-07-02) — "Bind to game" picker in PropertiesPanel.
 *
 * Mounts the REAL `ContentFields` switch (CLAUDE.md rule #9 — the exact
 * component the sidebar renders per PropertiesPanel.tsx's own switch
 * dispatch) for each sports widget type and proves:
 *  - the picker renders (this is a real, addressable field — not a dead
 *    registry entry with no UI wiring),
 *  - it lists the tenant's games via useGames(), LIVE games sorted first
 *    with a visible marker, FINAL games last,
 *  - an explicit "Unbound (sample in builder)" option exists and is the
 *    default when config.gameId is unset,
 *  - picking a game writes config.gameId through updateZone — the exact
 *    key WidgetRenderer's WidgetPreview reads to decide whether to wrap
 *    the zone in its own GameStateProvider (see WidgetRenderer.tsx /
 *    GameStateContext.tsx and sports-render-surface.test.tsx for the
 *    render-tree proof of what that binding actually does).
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Deterministic games list — no real network in a unit test. Order here
// is DELIBERATELY not LIVE-first, to prove GameBindField does its own
// sort rather than trusting API order.
const MOCK_GAMES = [
  { id: 'g-final', sport: 'basketball', homeTeam: 'Riverside', awayTeam: 'Lakeview', status: 'FINAL', createdAt: '2026-06-01T00:00:00.000Z' },
  { id: 'g-live', sport: 'basketball', homeTeam: 'Eastview', awayTeam: 'Westfield', status: 'LIVE', createdAt: '2026-07-02T00:00:00.000Z' },
  { id: 'g-scheduled', sport: 'basketball', homeTeam: 'Northgate', awayTeam: 'Southport', status: 'SCHEDULED', createdAt: '2026-07-03T00:00:00.000Z' },
];

jest.mock('@/hooks/use-api', () => ({
  useAssets: () => ({ data: [] }),
  usePlaylists: () => ({ data: [] }),
  useTemplates: () => ({ data: [] }),
  useTemplateBackdrops: () => ({ data: [] }),
  useGames: () => ({ data: MOCK_GAMES }),
}));

// Test-noise silencer: the builder UI mounts the AI affordances
// (ChatToEditBox et al.), each of which probes GET /ai/key through
// apiFetch() on mount. In jsdom that probe can only fail — spamming
// console.error from the api-client logger — and its .then(setState)
// lands AFTER the test's act() scope, firing "not wrapped in act(...)"
// warnings. This suite does not test the AI affordances, so keep the
// probe permanently pending: no console noise, no post-test setState.
jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual('@/lib/api-client'),
  apiFetch: jest.fn(() => new Promise(() => undefined)),
}));

import { ContentFields } from '../PropertiesPanel';

function makeZone(widgetType: string, defaultConfig: Record<string, unknown> = {}) {
  return { id: 'sports-zone-1', widgetType, defaultConfig };
}

function lastCfg(updateZone: jest.Mock): Record<string, unknown> {
  const calls = updateZone.mock.calls;
  return calls[calls.length - 1][1].defaultConfig as Record<string, unknown>;
}

function mountFields(widgetType: string, defaultConfig: Record<string, unknown>, updateZone: jest.Mock) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ContentFields zone={makeZone(widgetType, defaultConfig)} updateZone={updateZone} />
    </QueryClientProvider>,
  );
}

function getBindSelect(): HTMLSelectElement {
  return screen.getByRole('combobox', { name: /bind to game/i }) as HTMLSelectElement;
}

describe('S2-2 — "Bind to game" picker renders for every sports widget type', () => {
  const SPORTS_WIDGET_TYPES_AND_CONFIG: [string, Record<string, unknown>][] = [
    ['SWIM_LANE_GRID', {}],
    ['DIVE_LEADERBOARD', {}],
    ['SWIM_RELAY_EXCHANGE', {}],
    ['SWIM_SPLITS_PANEL', {}],
    ['DIVE_JUDGES_PANEL', {}],
    ['SCOREBOARD', { variant: 'scoreboard-main' }],
    ['SCOREBOARD', { variant: 'ribbon-main' }],
    ['SCOREBOARD', { variant: 'scorebug-main' }],
  ];

  for (const [widgetType, baseCfg] of SPORTS_WIDGET_TYPES_AND_CONFIG) {
    const label = baseCfg.variant ? `${widgetType} (${baseCfg.variant})` : widgetType;
    it(`renders a "Bind to game" dropdown for ${label}`, () => {
      mountFields(widgetType, baseCfg, jest.fn());
      expect(getBindSelect()).toBeInTheDocument();
    });
  }
});

describe('S2-2 — picker content and sort order', () => {
  it('defaults to "Unbound (sample in builder)" when config.gameId is unset', () => {
    mountFields('SWIM_LANE_GRID', {}, jest.fn());
    const select = getBindSelect();
    expect(select.value).toBe('');
    expect(screen.getByText('Unbound (sample in builder)')).toBeInTheDocument();
  });

  it('lists LIVE games first with a visible marker, FINAL games last, regardless of API order', () => {
    mountFields('SWIM_LANE_GRID', {}, jest.fn());
    const select = getBindSelect();
    const optionTexts = Array.from(select.options).map((o) => o.textContent || '');
    // index 0 is the "Unbound" option.
    expect(optionTexts[0]).toContain('Unbound');
    expect(optionTexts[1]).toContain('🔴 LIVE');
    expect(optionTexts[1]).toContain('Eastview');
    // FINAL sorted after SCHEDULED.
    const finalIdx = optionTexts.findIndex((t) => t.includes('Final'));
    const scheduledIdx = optionTexts.findIndex((t) => t.includes('Northgate'));
    expect(finalIdx).toBeGreaterThan(scheduledIdx);
  });

  it('shows the currently-bound game as selected when config.gameId is set', () => {
    mountFields('SWIM_LANE_GRID', { gameId: 'g-live' }, jest.fn());
    expect(getBindSelect().value).toBe('g-live');
  });
});

describe('S2-2 — picking a game writes config.gameId', () => {
  it('writes the selected gameId through updateZone for SWIM_LANE_GRID', () => {
    const updateZone = jest.fn();
    mountFields('SWIM_LANE_GRID', {}, updateZone);
    fireEvent.change(getBindSelect(), { target: { value: 'g-live' } });
    expect(lastCfg(updateZone).gameId).toBe('g-live');
  });

  it('writes the selected gameId through updateZone for the scoreboard-main variant', () => {
    const updateZone = jest.fn();
    mountFields('SCOREBOARD', { variant: 'scoreboard-main' }, updateZone);
    fireEvent.change(getBindSelect(), { target: { value: 'g-final' } });
    expect(lastCfg(updateZone).gameId).toBe('g-final');
    // The variant is preserved — picking a game must not clobber other config.
    expect(lastCfg(updateZone).variant).toBe('scoreboard-main');
  });

  it('clears config.gameId when the operator picks "Unbound" again', () => {
    const updateZone = jest.fn();
    mountFields('SWIM_LANE_GRID', { gameId: 'g-live' }, updateZone);
    fireEvent.change(getBindSelect(), { target: { value: '' } });
    expect(lastCfg(updateZone).gameId).toBe('');
  });
});

describe('S2-2 — no new settings sprawl (Greg\'s law)', () => {
  it('the sports sections expose exactly ONE game-binding control, not several', () => {
    mountFields('SWIM_LANE_GRID', {}, jest.fn());
    expect(screen.getAllByRole('combobox', { name: /bind to game/i }).length).toBe(1);
  });
});
