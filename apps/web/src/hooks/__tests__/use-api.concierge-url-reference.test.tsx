/**
 * useConciergeUrlReference — POST concierge/reference/url carries the canvas
 * being designed (2026-09-23), so the API checks and sizes the site's photo for
 * THAT board instead of 3840×2160 (TemplatesController.resolveReferenceAssets
 * reads `screenWidth` / `screenHeight` off the body).
 *
 * Mocked at `apiFetch` (the convention in this folder), so the REAL hook runs
 * inside a real QueryClientProvider and the assertion is on the wire body.
 */
import { useEffect } from 'react';
import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string, opts?: { method?: string; body?: string }) => apiFetch(path, opts),
}));

import { useConciergeUrlReference } from '../use-api';

type Mutate = ReturnType<typeof useConciergeUrlReference>['mutateAsync'];

type Canvas = { w: number; h: number } | null | undefined;

/** Mounts the REAL hook; the latest `mutateAsync` is handed out from an effect (never during render). */
function Probe({ c, onMutate }: { c: Canvas; onMutate: (m: Mutate) => void }) {
  const { mutateAsync } = useConciergeUrlReference(c);
  useEffect(() => onMutate(mutateAsync));
  return null;
}

function mount(canvas: Canvas) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  let mutate: Mutate | null = null;
  const onMutate = (m: Mutate) => {
    mutate = m;
  };
  const view = render(
    <QueryClientProvider client={qc}>
      <Probe c={canvas} onMutate={onMutate} />
    </QueryClientProvider>,
  );
  const rerender = (c: Canvas) =>
    view.rerender(
      <QueryClientProvider client={qc}>
        <Probe c={c} onMutate={onMutate} />
      </QueryClientProvider>,
    );
  return { getMutate: () => mutate!, rerender };
}

const sentBody = (call = 0) => JSON.parse(apiFetch.mock.calls[call][1].body);

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ kind: 'url', summary: 'Brand: Super Taco.' });
});

describe('useConciergeUrlReference sends the canvas with the URL', () => {
  it('the Concierge\'s canvas rides in the body', async () => {
    const { getMutate } = mount({ w: 960, h: 1080 });
    await act(async () => {
      await getMutate()({ url: 'supertacomex.com' });
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch.mock.calls[0][0]).toBe('/templates/concierge/reference/url');
    expect(apiFetch.mock.calls[0][1].method).toBe('POST');
    expect(sentBody()).toEqual({ url: 'supertacomex.com', screenWidth: 960, screenHeight: 1080 });
  });

  it('follows the canvas the operator switches to (the latest render wins)', async () => {
    const { getMutate, rerender } = mount({ w: 3840, h: 2160 });
    rerender({ w: 2160, h: 3840 });
    await act(async () => {
      await getMutate()({ url: 'supertacomex.com' });
    });
    expect(sentBody()).toEqual({ url: 'supertacomex.com', screenWidth: 2160, screenHeight: 3840 });
  });

  it('a call may name its own canvas', async () => {
    const { getMutate } = mount({ w: 3840, h: 2160 });
    await act(async () => {
      await getMutate()({ url: 'supertacomex.com', screenWidth: 1920, screenHeight: 1080 });
    });
    expect(sentBody()).toEqual({ url: 'supertacomex.com', screenWidth: 1920, screenHeight: 1080 });
  });

  it('negative control: with no canvas the body is exactly the old one', async () => {
    const { getMutate } = mount(undefined);
    await act(async () => {
      await getMutate()({ url: 'supertacomex.com' });
    });
    expect(sentBody()).toEqual({ url: 'supertacomex.com' });
  });
});
