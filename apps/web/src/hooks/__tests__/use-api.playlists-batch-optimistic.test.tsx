/**
 * useDeletePlaylistsBatch — the rows leave the list AT ONCE, the deletes finish
 * in the background (Greg, 2026-09-28: "it takes like 15 seconds to delete 12
 * playlist, clear the playlist as soon as i click delete and finish in the
 * background").
 *
 * Each delete is ~1.2 s server-side and they run one after another, so the
 * list used to hold every row for the whole run. Now `onMutate` takes them off
 * the cached list immediately and `onSettled` refetches, so a playlist that
 * could not be removed comes straight back.
 */
import * as React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string, init?: RequestInit) => apiFetch(path, init),
}));

import { usePlaylists, useDeletePlaylistsBatch } from '../use-api';

const row = (id: string) => ({ id, name: `Playlist ${id}` }) as never;

let serverIds: string[];
let release: () => void;
let gate: Promise<void>;

beforeEach(() => {
  serverIds = ['p1', 'p2', 'p3'];
  gate = new Promise<void>((res) => { release = res; });
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') {
      await gate; // the server is slow
      const id = path.split('?')[0].split('/').pop() as string;
      if (id === 'p2') throw Object.assign(new Error('the server said no'), { code: 'X' });
      serverIds = serverIds.filter((i) => i !== id);
      return { deleted: true };
    }
    return serverIds.map((id) => ({ id, name: `Playlist ${id}` }));
  });
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => ({ list: usePlaylists(), del: useDeletePlaylistsBatch() }), { wrapper });
}

describe('useDeletePlaylistsBatch — optimistic', () => {
  it('takes the rows off the list before a single delete has finished, and puts back the one that failed', async () => {
    const h = mount();
    await waitFor(() => expect((h.result.current.list.data as unknown[])?.length).toBe(3));

    let done: Promise<unknown> = Promise.resolve();
    await act(async () => {
      done = h.result.current.del.mutateAsync({ rows: [row('p1'), row('p2')], inUseIds: new Set<string>() });
      await Promise.resolve();
    });
    // The server has answered NOTHING yet (its gate is shut) — and the list is already short.
    expect(apiFetch.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1); // the first, still pending
    await waitFor(() => expect((h.result.current.list.data as Array<{ id: string }>).map((p) => p.id)).toEqual(['p3']));

    await act(async () => { release(); await done; });
    // p1 went; p2 was refused, so the refetch brings it back.
    await waitFor(() => expect((h.result.current.list.data as Array<{ id: string }>).map((p) => p.id)).toEqual(['p2', 'p3']));
  });

  it('a removed playlist stays gone while the deletes are still running (no refetch puts it back)', async () => {
    const h = mount();
    await waitFor(() => expect((h.result.current.list.data as unknown[])?.length).toBe(3));
    await act(async () => {
      void h.result.current.del.mutateAsync({ rows: [row('p1')], inUseIds: new Set<string>() });
      await Promise.resolve();
    });
    await waitFor(() => expect((h.result.current.list.data as Array<{ id: string }>).map((p) => p.id)).toEqual(['p2', 'p3']));
    await act(async () => { release(); await Promise.resolve(); });
  });
});
