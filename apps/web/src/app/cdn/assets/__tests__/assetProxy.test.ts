/**
 * @jest-environment node
 */
import { GET, HEAD } from '../[...path]/route';

const realFetch = global.fetch;
let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn(async () =>
    new Response('BODY', { status: 200, headers: { 'content-type': 'image/png', 'content-length': '4' } }),
  );
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterAll(() => {
  global.fetch = realFetch;
});

function call(path: string[], head = false) {
  const req = new Request('https://app.example/cdn/assets/x');
  const ctx = { params: Promise.resolve({ path }) };
  return head ? HEAD(req, ctx) : GET(req, ctx);
}

function expectSafety(res: Response) {
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  expect(res.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
}

describe('/cdn/assets path segments', () => {
  it.each([
    [['tenant', '..', 'x.png']],
    [['tenant', '.', 'x.png']],
    [['tenant', '', 'x.png']],
    [['tenant', '%2e%2e', 'x.png']],
    [['tenant', '%2E%2e', 'x.png']],
    [['tenant', '.%2e', 'x.png']],
    [['tenant', '%252e%252e', 'x.png']],
    [['tenant', '%2e', 'x.png']],
    [['tenant', '%E0%A4%A', 'x.png']],
  ])('rejects %j with 400 and never fetches', async (path) => {
    const res = await call(path);
    expect(res.status).toBe(400);
    expectSafety(res);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a normal object path and fetches only the assets bucket', async () => {
    const res = await call(['tenant-1', 'media', 'photo one.png']);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toMatch(/\/storage\/v1\/object\/public\/assets\/tenant-1\/media\/photo%20one\.png$/);
  });

  it('an empty path is a 404 with the safety headers', async () => {
    const res = await call([]);
    expect(res.status).toBe(404);
    expectSafety(res);
  });
});

describe('/cdn/assets content types', () => {
  it.each(['image/png', 'image/svg+xml', 'video/mp4', 'audio/mpeg', 'application/pdf', 'video/webm; codecs=vp9'])(
    'passes %s through inline',
    async (ct) => {
      fetchMock.mockResolvedValueOnce(new Response('x', { status: 200, headers: { 'content-type': ct } }));
      const res = await call(['t', 'f']);
      expect(res.headers.get('content-type')).toBe(ct);
      expect(res.headers.get('content-disposition')).toBeNull();
      expectSafety(res);
    },
  );

  it.each(['text/html', 'text/html; charset=utf-8', 'application/javascript', 'application/xhtml+xml', 'text/xml', ''])(
    'serves %j as an octet-stream attachment',
    async (ct) => {
      const headers: Record<string, string> = ct ? { 'content-type': ct } : {};
      const r = new Response('x', { status: 200, headers });
      if (!ct) r.headers.delete('content-type');
      fetchMock.mockResolvedValueOnce(r);
      const res = await call(['t', 'f']);
      expect(res.headers.get('content-type')).toBe('application/octet-stream');
      expect(res.headers.get('content-disposition')).toBe('attachment');
      expectSafety(res);
    },
  );

  it('HEAD responses carry the safety headers too', async () => {
    const res = await call(['t', 'f'], true);
    expectSafety(res);
    expect(res.headers.get('cache-control')).toMatch(/immutable/);
  });

  it('an upstream failure is a 502 with the safety headers', async () => {
    fetchMock.mockRejectedValueOnce(new Error('down'));
    const res = await call(['t', 'f']);
    expect(res.status).toBe(502);
    expectSafety(res);
  });
});
