import { render, screen, waitFor } from '@testing-library/react';
import { StatusBoard } from '../StatusBoard';

/**
 * /health/storage answers a status string only ({ status: 'ok' | 'degraded' }
 * with 200, { status: 'down' } with 503). The status page reads that string.
 */
function mockApi(storage: { ok: boolean; body: unknown }) {
  global.fetch = jest.fn(async (url: string) => {
    const u = String(url);
    if (u.endsWith('/health/storage')) {
      return { ok: storage.ok, json: async () => storage.body } as Response;
    }
    if (u.endsWith('/health/emergency-path')) return { ok: true, json: async () => ({}) } as Response;
    return { ok: true, json: async () => ({ db: 'ok', redis: 'ok' }) } as Response;
  }) as unknown as typeof fetch;
}

describe('StatusBoard storage row', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it.each([
    [{ ok: true, body: { status: 'ok' } }, 'Uploads healthy'],
    [{ ok: true, body: { status: 'degraded' } }, 'Working via backup transport'],
    [{ ok: false, body: { status: 'down' } }, 'Uploads failing'],
  ])('%j → %s', async (storage, text) => {
    mockApi(storage);
    render(<StatusBoard />);
    await waitFor(() => expect(screen.getByText(text)).toBeInTheDocument());
  });
});
