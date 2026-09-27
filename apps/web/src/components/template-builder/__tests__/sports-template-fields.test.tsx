/**
 * K-12 launch audit (2026-09-27) — the Properties panel for the sports
 * template catalogue. Mounts the REAL `ContentFields` switch (CLAUDE.md rule
 * #9: the exact component the builder's sidebar renders) and proves each
 * control writes the config key its renderer actually reads.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const MOCK_GAMES = [
  { id: 'g-live', sport: 'basketball', homeTeam: 'Eastview', awayTeam: 'Westfield', status: 'LIVE', createdAt: '2026-07-02T00:00:00.000Z' },
];

jest.mock('@/hooks/use-api', () => ({
  useAssets: () => ({ data: [] }),
  usePlaylists: () => ({ data: [] }),
  useTemplates: () => ({ data: [] }),
  useTemplateBackdrops: () => ({ data: [] }),
  useGames: () => ({ data: MOCK_GAMES }),
}));

// The builder UI mounts AI affordances that probe GET /ai/key on mount; keep
// that probe pending so jsdom logs nothing and nothing lands after act().
jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual('@/lib/api-client'),
  apiFetch: jest.fn(() => new Promise(() => undefined)),
}));

import { ContentFields } from '../PropertiesPanel';

function mountFields(defaultConfig: Record<string, unknown>, updateZone: jest.Mock, widgetType = 'SCOREBOARD') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ContentFields zone={{ id: 'z1', widgetType, defaultConfig }} updateZone={updateZone} />
    </QueryClientProvider>,
  );
}

function lastCfg(updateZone: jest.Mock): Record<string, unknown> {
  const calls = updateZone.mock.calls;
  return calls[calls.length - 1][1].defaultConfig as Record<string, unknown>;
}

describe('F28 — HS / College / Pro live scoreboard can be bound and styled', () => {
  for (const variant of ['scoreboard-hs', 'scoreboard-college', 'scoreboard-pro']) {
    it(`${variant}: shows Bind to game + look + banner, never the legacy literal score fields`, () => {
      mountFields({ variant, tier: variant.replace('scoreboard-', ''), gameId: '' }, jest.fn());
      expect(screen.getByRole('combobox', { name: /bind to game/i })).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: /scoreboard look/i })).toBeInTheDocument();
      expect(screen.getByText('Banner text')).toBeInTheDocument();
      // The legacy generic-scoreboard fields this renderer never reads.
      expect(screen.queryByText('Home score')).not.toBeInTheDocument();
      expect(screen.queryByText('Status')).not.toBeInTheDocument();
    });
  }

  it('binding writes config.gameId, the key WidgetPreview wraps a game provider on', () => {
    const updateZone = jest.fn();
    mountFields({ variant: 'scoreboard-hs', tier: 'hs', gameId: '' }, updateZone);
    fireEvent.change(screen.getByRole('combobox', { name: /bind to game/i }), { target: { value: 'g-live' } });
    expect(lastCfg(updateZone)).toMatchObject({ variant: 'scoreboard-hs', gameId: 'g-live' });
  });

  it('the look picker writes config.tier', () => {
    const updateZone = jest.fn();
    mountFields({ variant: 'scoreboard-hs', tier: 'hs' }, updateZone);
    fireEvent.change(screen.getByRole('combobox', { name: /scoreboard look/i }), { target: { value: 'pro' } });
    expect(lastCfg(updateZone)).toMatchObject({ tier: 'pro' });
  });
});

describe('F29 — Main Scoreboard: live values are explicit, overrides are marked and removable', () => {
  it('live mode: an unset game fact reads "From the game" and nothing is written by mounting or by one stray click', () => {
    const updateZone = jest.fn();
    mountFields({ variant: 'scoreboard-main', gameId: 'g-live' }, updateZone);
    expect(screen.getAllByText(/From the game/).length).toBeGreaterThan(5);
    // The old panel rendered a "Home score" box showing 0 that wrote on first touch.
    expect(screen.queryByLabelText('Home score')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Override Home score' }));
    expect(updateZone).not.toHaveBeenCalled();
    // Only typing a value writes the override.
    fireEvent.change(screen.getByLabelText('Home score'), { target: { value: '12' } });
    expect(lastCfg(updateZone)).toMatchObject({ homeScore: 12 });
  });

  it('an override is badged and "Use live value" removes it', () => {
    const updateZone = jest.fn();
    mountFields({ variant: 'scoreboard-main', gameId: 'g-live', homeScore: 9 }, updateZone);
    expect(screen.getByText('Overrides the live value')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use the live value for Home score' }));
    const cfg = lastCfg(updateZone);
    expect('homeScore' in cfg && cfg.homeScore === undefined).toBe(true);
  });

  it('binding a game clears every typed game fact (so the live score shows) and keeps team branding', () => {
    const updateZone = jest.fn();
    mountFields({ variant: 'scoreboard-main', homeScore: 9, awayScore: 3, clock: '1:00', homeName: 'LIONS' }, updateZone);
    fireEvent.change(screen.getByRole('combobox', { name: /bind to game/i }), { target: { value: 'g-live' } });
    const cfg = lastCfg(updateZone);
    expect(cfg.gameId).toBe('g-live');
    expect(cfg.homeScore).toBeUndefined();
    expect(cfg.awayScore).toBeUndefined();
    expect(cfg.clock).toBeUndefined();
    expect(cfg.homeName).toBe('LIONS');
    expect(screen.getByRole('status')).toHaveTextContent('Cleared 3 typed values so the live game shows.');
  });

  it('manual mode: plain fields, no game binding, no live badges', () => {
    mountFields({ variant: 'scoreboard-main', dataMode: 'manual' }, jest.fn());
    expect(screen.queryByRole('combobox', { name: /bind to game/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/From the game/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Home score')).toBeInTheDocument();
    expect(screen.getByText(/never reads a game and never shows LIVE/)).toBeInTheDocument();
  });

  it('switching the source writes config.dataMode', () => {
    const updateZone = jest.fn();
    mountFields({ variant: 'scoreboard-main' }, updateZone);
    fireEvent.change(screen.getByRole('combobox', { name: 'Where the numbers come from' }), { target: { value: 'manual' } });
    expect(lastCfg(updateZone)).toMatchObject({ dataMode: 'manual' });
  });
});

describe('F26 — the relay exchange panel records the referee’s DQ; the board never infers one', () => {
  const LEGS = [
    { legName: 'Leg 1', swimmer: 'A. Lee', split: '27.80', cumulative: '27.80', exchange: '0.18' },
    { legName: 'Leg 2', swimmer: 'B. Cruz', split: '31.42', cumulative: '59.22', exchange: '-0.02' },
  ];

  it('says the exchange shows as typed and offers a per-leg DQ switch', () => {
    mountFields({ legs: LEGS }, jest.fn(), 'SWIM_RELAY_EXCHANGE');
    expect(screen.getByText(/exchange time shows exactly as typed/i)).toBeInTheDocument();
    expect(screen.queryByText(/auto-flags/i)).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'leg 2 DQ (referee’s call)' })).not.toBeChecked();
  });

  it('marking a leg DQ writes dq:true on that leg only', () => {
    const updateZone = jest.fn();
    mountFields({ legs: LEGS }, updateZone, 'SWIM_RELAY_EXCHANGE');
    fireEvent.click(screen.getByRole('checkbox', { name: 'leg 2 DQ (referee’s call)' }));
    const legs = lastCfg(updateZone).legs as Array<Record<string, unknown>>;
    expect(legs[1]).toMatchObject({ swimmer: 'B. Cruz', exchange: '-0.02', dq: true });
    expect(legs[0].dq).toBeUndefined();
  });
});
