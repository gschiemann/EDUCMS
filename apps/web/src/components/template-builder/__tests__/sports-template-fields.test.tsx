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
