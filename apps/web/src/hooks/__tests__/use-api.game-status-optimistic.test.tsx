/**
 * Muse beta S-02 / S-03 (2026-10-07): Go Live showed nothing until the
 * server answered, and the console said SCHEDULED while the board said LIVE.
 * The status mutation now flips the cached game the instant it is fired; a
 * refusal re-reads server truth. And a live status pill with no snapshot yet
 * never claims LIVE.
 */
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

const GAME_ID = 'game-status-1';
const GAME_KEY = ['sports-game', GAME_ID];

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string, opts?: unknown) => apiFetch(path, opts),
}));

import { useGameControl } from '../use-api';
import { __resetGameOpQueues } from '@/lib/game-op-queue';
import { GameStateProvider } from '@/components/widgets/sports/GameStateContext';
import { GameStatusWidget } from '@/components/widgets/sports/SportElementWidgets';

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  qc.setQueryData(GAME_KEY, { id: GAME_ID, sport: 'basketball', status: 'SCHEDULED', homeTeam: 'H', awayTeam: 'A' });
  let ctl!: ReturnType<typeof useGameControl>;
  function Inner() {
    ctl = useGameControl(GAME_ID);
    return null;
  }
  render(
    <QueryClientProvider client={qc}>
      <Inner />
    </QueryClientProvider>,
  );
  return { qc, getCtl: () => ctl };
}

beforeEach(() => {
  apiFetch.mockReset();
  __resetGameOpQueues();
});

it('Go Live flips the cached status to LIVE before the server answers', async () => {
  let answer!: (v: unknown) => void;
  apiFetch.mockImplementation((path: string) =>
    path.endsWith('/status') ? new Promise((r) => { answer = r; }) : Promise.resolve(null),
  );
  const { qc, getCtl } = mount();
  getCtl().status.mutate({ status: 'LIVE' });
  await waitFor(() => expect((qc.getQueryData(GAME_KEY) as any).status).toBe('LIVE'));
  await waitFor(() => expect(getCtl().status.isPending).toBe(true));
  answer({ id: GAME_ID, sport: 'basketball', status: 'LIVE', startedAt: '2026-10-11T00:00:00Z' });
  await waitFor(() => expect((qc.getQueryData(GAME_KEY) as any).startedAt).toBe('2026-10-11T00:00:00Z'));
});

it('a refused Go Live re-reads server truth instead of keeping the optimistic LIVE', async () => {
  apiFetch.mockImplementation((path: string) =>
    path.endsWith('/status')
      ? Promise.reject(Object.assign(new Error('nope'), { status: 409 }))
      : Promise.resolve({ id: GAME_ID, sport: 'basketball', status: 'SCHEDULED' }),
  );
  const { qc, getCtl } = mount();
  const spy = jest.spyOn(qc, 'invalidateQueries');
  getCtl().status.mutate({ status: 'LIVE' });
  await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: GAME_KEY }));
});

it('a live surface with no snapshot yet shows a neutral pill, never LIVE', () => {
  const realFetch = (global as any).fetch;
  (global as any).fetch = jest.fn(() => new Promise(() => undefined));
  const { container } = render(
    <GameStateProvider gameId="g-none">
      <GameStatusWidget config={{}} />
    </GameStateProvider>,
  );
  expect(container.textContent).not.toContain('LIVE');
  expect(container.textContent).toContain('—');
  (global as any).fetch = realFetch;
});

it('the builder (no provider) keeps its sample LIVE pill', () => {
  const { container } = render(<GameStatusWidget config={{}} />);
  expect(container.textContent).toContain('LIVE');
});
