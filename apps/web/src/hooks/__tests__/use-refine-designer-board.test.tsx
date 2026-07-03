/**
 * useRefineDesignerBoard (Wave D1, 2026-07-02, launch-sprint #282) — the
 * designer-board counterpart of useRefineSignageBoard (use-api.ts), added so
 * the DEFAULT AI candidate picker (templates/page.tsx) can refine an
 * AI-Designer (_designerHtml) candidate through the SAME backend route
 * ChatToEditBox.tsx already uses inside the builder: POST
 * /templates/refine-designer with a base64 `htmlBase64` body, returning the
 * revised `{ html }`.
 *
 * Mocking convention matches use-api.game-control-optimistic.test.tsx: mock
 * `apiFetch` at `@/lib/api-client`, mount a thin `Inner` component that
 * exposes the real hook, drive it inside a real QueryClientProvider.
 */
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

interface FetchOpts {
  method?: string;
  body?: string;
}

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string, opts?: FetchOpts) => apiFetch(path, opts),
}));

import { useRefineDesignerBoard } from '../use-ai-designer';

function mountHook() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  let hook!: ReturnType<typeof useRefineDesignerBoard>;
  function Inner() {
    hook = useRefineDesignerBoard();
    return null;
  }
  render(
    <QueryClientProvider client={qc}>
      <Inner />
    </QueryClientProvider>,
  );
  return { getHook: () => hook };
}

beforeEach(() => {
  apiFetch.mockReset();
});

describe('useRefineDesignerBoard', () => {
  it('POSTs /templates/refine-designer with a base64-encoded html + the instruction + vertical', async () => {
    apiFetch.mockResolvedValue({ html: '<html><body>Revised</body></html>' });
    const { getHook } = mountHook();

    getHook().mutate({ html: '<html><body>Original</body></html>', instruction: 'darker theme', vertical: 'restaurant' });

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    const [path, opts] = apiFetch.mock.calls[0];
    expect(path).toBe('/templates/refine-designer');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.instruction).toBe('darker theme');
    expect(body.vertical).toBe('restaurant');
    // utf8-safe base64 round-trips back to the exact original html — same
    // encoding ChatToEditBox.tsx uses so the global sanitizer passes it
    // through without gutting <style>/<script>.
    expect(decodeURIComponent(escape(atob(body.htmlBase64)))).toBe('<html><body>Original</body></html>');
  });

  it('omits vertical when not provided', async () => {
    apiFetch.mockResolvedValue({ html: '<html></html>' });
    const { getHook } = mountHook();

    getHook().mutate({ html: '<html></html>', instruction: 'add a stat' });

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    const body = JSON.parse(apiFetch.mock.calls[0][1].body);
    expect(body).not.toHaveProperty('vertical');
  });

  it('resolves with the revised html the picker swaps into the candidate', async () => {
    apiFetch.mockResolvedValue({ html: '<html><body>Translated</body></html>' });
    const { getHook } = mountHook();

    getHook().mutate({ html: '<html></html>', instruction: 'Translate ALL visible copy to Spanish.' });

    await waitFor(() => expect(getHook().data?.html).toBe('<html><body>Translated</body></html>'));
  });

  it('surfaces a rejection so the picker can show a friendly error (no silent swallow)', async () => {
    apiFetch.mockRejectedValue(new Error('AI provider out of credit'));
    const { getHook } = mountHook();

    getHook().mutate({ html: '<html></html>', instruction: 'darker theme' });

    await waitFor(() => expect(getHook().isError).toBe(true));
    expect(getHook().error?.message).toBe('AI provider out of credit');
  });
});
