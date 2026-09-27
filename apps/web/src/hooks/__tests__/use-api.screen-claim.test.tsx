/**
 * useShowGameOnScreens — K12-F35 (claim display ownership atomically).
 *
 * The console's take-over names the game the operator saw on the screen
 * (`takeover: { screenId: ownerGameId }`) so the server only takes it while
 * that game still owns it; a claim that loses (409 SCREEN_IN_USE) refetches
 * the screen list so the console shows the actual assignment.
 *
 * Mocking convention matches use-api.game-control-optimistic.test.tsx: mock
 * `apiFetch` at `@/lib/api-client`, mount the real hook inside a real
 * QueryClientProvider.
 */
import { act, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const GAME_ID = 'game-claim-1';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string, opts?: { method?: string; body?: string }) => apiFetch(path, opts),
}));

import { useShowGameOnScreens } from '../use-api';

type ShowHook = ReturnType<typeof useShowGameOnScreens>;

function Probe({ onHook }: { onHook: (h: ShowHook) => void }) {
  onHook(useShowGameOnScreens(GAME_ID));
  return null;
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const out: { show?: ShowHook } = {};
  render(
    <QueryClientProvider client={qc}>
      <Probe onHook={(h) => (out.show = h)} />
    </QueryClientProvider>,
  );
  return { qc, out };
}

beforeEach(() => apiFetch.mockReset());

describe('useShowGameOnScreens — K12-F35', () => {
  it('sends the confirmed owner with a take-over', async () => {
    apiFetch.mockResolvedValue([{ id: 's1', showing: true }]);
    const { out } = mount();
    await act(async () => {
      await out.show!.mutateAsync({
        screenIds: ['s1'],
        surface: 'BOARD',
        force: true,
        takeover: { s1: 'game-other' },
      });
    });
    expect(apiFetch).toHaveBeenCalledWith(`/sports/games/${GAME_ID}/show`, {
      method: 'POST',
      body: JSON.stringify({
        screenIds: ['s1'],
        surface: 'BOARD',
        force: true,
        takeover: { s1: 'game-other' },
      }),
    });
  });

  it('a lost claim invalidates the screen list so the console shows the real owner', async () => {
    const conflict = Object.assign(new Error('Already showing another game: Gym.'), {
      status: 409,
      code: 'SCREEN_IN_USE',
      body: { code: 'SCREEN_IN_USE', screenNames: ['Gym'] },
    });
    apiFetch.mockRejectedValue(conflict);
    const { qc, out } = mount();
    qc.setQueryData(['sports-game-screens', GAME_ID], [{ id: 's1', showing: false, showingOther: false }]);
    await act(async () => {
      await out.show!.mutateAsync({ screenIds: ['s1'] }).catch(() => undefined);
    });
    await waitFor(() =>
      expect(qc.getQueryState(['sports-game-screens', GAME_ID])?.isInvalidated).toBe(true),
    );
  });
});
