/**
 * @jest-environment node
 */
import { GET } from '../route';

const env = process.env as Record<string, string | undefined>;
const saved = { ...env };
const realFetch = global.fetch;
let fetchMock: jest.Mock;

beforeEach(() => {
  delete env.CRON_SECRET;
  env.NEXT_PUBLIC_API_URL = 'https://internal-api.example.test';
  fetchMock = jest.fn(async () =>
    new Response(JSON.stringify({ status: 'ok', commit: 'abc123', db: 'internal detail' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  for (const k of Object.keys(env)) if (!(k in saved)) delete env[k];
  Object.assign(env, saved);
});

afterAll(() => {
  global.fetch = realFetch;
});

function req(auth?: string) {
  return new Request('https://app.example/api/cron/keepwarm', {
    headers: auth ? { authorization: auth } : {},
  });
}

describe('/api/cron/keepwarm', () => {
  it('in production without CRON_SECRET returns 503 and never calls upstream', async () => {
    env.NODE_ENV = 'production';
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    const text = await res.text();
    expect(text).not.toContain('internal-api.example.test');
  });

  it('with CRON_SECRET set, rejects a missing or wrong bearer', async () => {
    env.NODE_ENV = 'production';
    env.CRON_SECRET = 's3cret';
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req('Bearer nope'))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never echoes the API URL or the upstream body', async () => {
    env.NODE_ENV = 'production';
    env.CRON_SECRET = 's3cret';
    const res = await GET(req('Bearer s3cret'));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const text = await res.text();
    expect(text).not.toContain('internal-api.example.test');
    expect(text).not.toContain('internal detail');
    expect(text).not.toContain('abc123');
    expect(JSON.parse(text)).toMatchObject({ ok: true, status: 200 });
  });

  it('an upstream failure does not echo the URL or the error text', async () => {
    env.NODE_ENV = 'production';
    env.CRON_SECRET = 's3cret';
    fetchMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED internal-api.example.test:443'));
    const res = await GET(req('Bearer s3cret'));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain('internal-api.example.test');
    expect(text).not.toContain('ECONNREFUSED');
  });

  it('outside production an unset CRON_SECRET still pings (local development)', async () => {
    env.NODE_ENV = 'development';
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
