/**
 * useDeleteAsset / useDeletePlaylist — the in-use confirmation on the wire
 * (2026-09-26). The API deletes an in-use asset or a published playlist only
 * with `?confirm=in-use`; the hooks add it for `{ id, confirmInUse: true }`
 * and for nothing else, and the optimistic removal keys on the id either way.
 */
import * as React from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string, init?: RequestInit) => apiFetch(path, init),
}));

import { inUseDeletePath, useDeleteAsset, useDeletePlaylist } from '../use-api';

function mount<T>(useHook: () => T) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(useHook, { wrapper });
  return { qc, get result() { return result.current; } };
}

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ deleted: true });
});

describe('inUseDeletePath', () => {
  it('adds ?confirm=in-use only for an explicit confirmInUse: true', () => {
    expect(inUseDeletePath('/assets', 'a1')).toBe('/assets/a1');
    expect(inUseDeletePath('/assets', { id: 'a1' })).toBe('/assets/a1');
    expect(inUseDeletePath('/assets', { id: 'a1', confirmInUse: false })).toBe('/assets/a1');
    expect(inUseDeletePath('/assets', { id: 'a1', confirmInUse: true })).toBe('/assets/a1?confirm=in-use');
    expect(inUseDeletePath('/playlists', { id: 'p1', confirmInUse: true })).toBe('/playlists/p1?confirm=in-use');
  });
});

describe.each([
  ['useDeleteAsset', useDeleteAsset, '/assets'],
  ['useDeletePlaylist', useDeletePlaylist, '/playlists'],
] as const)('%s', (_name, useHook, base) => {
  it.each([
    ['a bare id (every older caller)', 'x1', `${base}/x1`],
    ['{ confirmInUse: false }', { id: 'x1', confirmInUse: false }, `${base}/x1`],
    ['{ confirmInUse: true }', { id: 'x1', confirmInUse: true }, `${base}/x1?confirm=in-use`],
  ])('%s', async (_label, arg, path) => {
    const h = mount(() => useHook());
    await act(async () => {
      await h.result.mutateAsync(arg as never);
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith(path, { method: 'DELETE' });
  });
});

describe('the optimistic removal keys on the id, and a refusal puts the row back', () => {
  it('useDeletePlaylist', async () => {
    let settle!: (v: unknown) => void;
    apiFetch.mockImplementationOnce(() => new Promise((_res, rej) => { settle = rej; }));
    const h = mount(useDeletePlaylist);
    h.qc.setQueryData(['playlists'], [{ id: 'p1' }, { id: 'p2' }]);
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = h.result.mutateAsync({ id: 'p1', confirmInUse: false }).catch((e) => e);
      await Promise.resolve();
    });
    expect(h.qc.getQueryData(['playlists'])).toEqual([{ id: 'p2' }]);
    await act(async () => {
      settle(Object.assign(new Error('published'), { status: 409, code: 'PLAYLIST_PUBLISHED' }));
      await pending;
    });
    expect(h.qc.getQueryData(['playlists'])).toEqual([{ id: 'p1' }, { id: 'p2' }]);
  });

  it('useDeleteAsset', async () => {
    let settle!: (v: unknown) => void;
    apiFetch.mockImplementationOnce(() => new Promise((_res, rej) => { settle = rej; }));
    const h = mount(useDeleteAsset);
    h.qc.setQueryData(['assets'], [{ id: 'a1' }, { id: 'a2' }]);
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = h.result.mutateAsync({ id: 'a1', confirmInUse: false }).catch((e) => e);
      await Promise.resolve();
    });
    expect(h.qc.getQueryData(['assets'])).toEqual([{ id: 'a2' }]);
    await act(async () => {
      settle(Object.assign(new Error('in use'), { status: 409, code: 'ASSET_IN_USE' }));
      await pending;
    });
    expect(h.qc.getQueryData(['assets'])).toEqual([{ id: 'a1' }, { id: 'a2' }]);
  });
});


it('bulk removal updates paged and legacy caches together, restoring only files the server kept', async () => {
  let settle!: (value: unknown) => void;
  apiFetch.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
  const h = mount(useDeleteAsset);
  const rows = [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }];
  h.qc.setQueryData(['assets'], rows);
  h.qc.setQueryData(['assets', 'page', 'all'], { assets: rows, total: 3 });
  const invalidate = jest.spyOn(h.qc, 'invalidateQueries');
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = h.result.mutateAsync({ ids: ['a1', 'a2'], confirmInUse: true });
    await Promise.resolve();
  });
  expect(h.qc.getQueryData(['assets'])).toEqual([{ id: 'a3' }]);
  expect(h.qc.getQueryData(['assets', 'page', 'all'])).toEqual({ assets: [{ id: 'a3' }], total: 1 });
  await act(async () => {
    settle({ results: [{ id: 'a1', deleted: true }, { id: 'a2', deleted: false, code: 'ASSET_IN_EMERGENCY_CONTENT' }] });
    await pending;
  });
  expect(h.qc.getQueryData(['assets'])).toEqual([{ id: 'a2' }, { id: 'a3' }]);
  expect(h.qc.getQueryData(['assets', 'page', 'all'])).toEqual({ assets: [{ id: 'a2' }, { id: 'a3' }], total: 2 });
  expect(invalidate.mock.calls.map(([arg]) => arg?.queryKey)).toEqual([['assets'], ['playlists'], ['schedules'], ['screens']]);
});
