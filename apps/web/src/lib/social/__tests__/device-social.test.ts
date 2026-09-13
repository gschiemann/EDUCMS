/**
 * device-social — the null / [] / data contract, and the device-vs-session
 * path choice.
 *
 * These are the two things that cost real debugging on the MENU board and
 * would cost it again here:
 *
 *  1. Collapsing "the account has no posts" into "the fetch failed" keeps
 *     deleted content on a wall forever. `[]` must come back as DATA and
 *     `null` only for a genuine failure.
 *  2. A widget that reads a session-only endpoint demos perfectly in the
 *     dashboard and is DEAD on every wall. So on a real player the request
 *     must carry the DEVICE token, and it must address the API origin
 *     exactly once (`NEXT_PUBLIC_API_URL` already ends in /api/v1).
 */
import {
  fetchSocialPosts,
  readLastGood,
  writeLastGood,
  socialApiRoot,
  hasDeviceContext,
} from '../device-social';

const LS_DEVICE_TOKEN = 'edu_device_token';
const LS_MANIFEST_CACHE = 'edu_manifest_cache_v1';

function res(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const OLD_ENV = { ...process.env };
beforeEach(() => {
  localStorage.clear();
  (global as any).fetch = jest.fn();
  process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com/api/v1';
});
afterEach(() => {
  process.env = { ...OLD_ENV };
  jest.restoreAllMocks();
});

function asDevice() {
  localStorage.setItem(LS_DEVICE_TOKEN, 'device-jwt-abc');
  localStorage.setItem(LS_MANIFEST_CACHE, JSON.stringify({ m: { screenId: 'screen-1' } }));
}

/** The dashboard path's injected session fetcher. */
const neverCalled = () => {
  throw new Error('session fallback must not be used on the device path');
};

describe('API origin', () => {
  it('does not double the /api/v1 prefix', () => {
    expect(socialApiRoot()).toBe('https://api.example.com');
  });

  it('falls back to the page origin when the env var is unset', () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    expect(socialApiRoot()).toBe(window.location.origin);
  });
});

describe('device vs session path', () => {
  it('is not a device until there is both a token and a screen', () => {
    expect(hasDeviceContext()).toBe(false);
    localStorage.setItem(LS_DEVICE_TOKEN, 'device-jwt-abc');
    expect(hasDeviceContext()).toBe(false);
    localStorage.setItem(LS_MANIFEST_CACHE, JSON.stringify({ m: { screenId: 's' } }));
    expect(hasDeviceContext()).toBe(true);
  });

  it('sends the DEVICE token on a real player — the endpoint a wall can reach', async () => {
    asDevice();
    (global.fetch as jest.Mock).mockResolvedValue(res(200, { posts: [], connection: null }));
    await fetchSocialPosts({ connectionId: 'conn-1', limit: 6 }, neverCalled);

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(
      'https://api.example.com/api/v1/integrations/social/posts?connectionId=conn-1&limit=6',
    );
    expect(init.headers.Authorization).toBe('Bearer device-jwt-abc');
  });

  it('uses the injected session fetcher in the dashboard (no device token)', async () => {
    const session = jest.fn().mockResolvedValue({ posts: [{ id: 'p1', postedAt: 'x' }] });
    const out = await fetchSocialPosts({ connectionId: 'conn-1', limit: 6 }, session);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(session).toHaveBeenCalledWith(
      '/integrations/social/posts?connectionId=conn-1&limit=6',
      expect.anything(),
    );
    expect(out?.posts).toHaveLength(1);
  });
});

describe('null / [] / data contract', () => {
  it('an EMPTY list is DATA, not a failure', async () => {
    asDevice();
    (global.fetch as jest.Mock).mockResolvedValue(res(200, { posts: [] }));
    const out = await fetchSocialPosts({ connectionId: 'conn-1' }, neverCalled);
    expect(out).not.toBeNull();
    expect(out!.posts).toEqual([]);
  });

  it('a NETWORK ERROR is a failure (null), so the caller keeps its last good list', async () => {
    asDevice();
    (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));
    expect(await fetchSocialPosts({ connectionId: 'conn-1' }, neverCalled)).toBeNull();
  });

  it('a 500 is a failure (null)', async () => {
    asDevice();
    (global.fetch as jest.Mock).mockResolvedValue(res(500, {}));
    expect(await fetchSocialPosts({ connectionId: 'conn-1' }, neverCalled)).toBeNull();
  });

  it('a malformed body is a failure (null), never an accidental clear', async () => {
    asDevice();
    (global.fetch as jest.Mock).mockResolvedValue(res(200, { nonsense: true }));
    expect(await fetchSocialPosts({ connectionId: 'conn-1' }, neverCalled)).toBeNull();
  });

  it('a 404 falls through to the session path (endpoint not deployed yet)', async () => {
    asDevice();
    (global.fetch as jest.Mock).mockResolvedValue(res(404, {}));
    const session = jest.fn().mockResolvedValue({ posts: [] });
    const out = await fetchSocialPosts({ connectionId: 'conn-1' }, session);
    expect(session).toHaveBeenCalled();
    expect(out!.posts).toEqual([]);
  });

  it('refuses to call anything at all without a connectionId', async () => {
    asDevice();
    expect(await fetchSocialPosts({ connectionId: '' }, neverCalled)).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('response mapping', () => {
  it('carries through the credential-free connection summary', async () => {
    asDevice();
    (global.fetch as jest.Mock).mockResolvedValue(
      res(200, {
        posts: [
          {
            id: 'p1', connectionId: 'conn-1', kind: 'image', text: 'hello',
            mediaUrl: 'https://cdn/x.jpg', thumbnailUrl: null,
            permalink: 'https://www.instagram.com/p/x/', postedAt: '2026-09-01T00:00:00.000Z',
          },
        ],
        connection: {
          id: 'conn-1', providerId: 'instagram', displayName: '@sunnyside',
          status: 'EXPIRED', lastSyncedAt: '2026-09-01T01:00:00.000Z',
        },
      }),
    );
    const out = await fetchSocialPosts({ connectionId: 'conn-1' }, neverCalled);
    expect(out!.posts[0]).toEqual({
      id: 'p1', connectionId: 'conn-1', kind: 'image', text: 'hello',
      mediaUrl: 'https://cdn/x.jpg', thumbnailUrl: null,
      permalink: 'https://www.instagram.com/p/x/', postedAt: '2026-09-01T00:00:00.000Z',
    });
    expect(out!.connection).toEqual({
      id: 'conn-1', providerId: 'instagram', displayName: '@sunnyside',
      status: 'EXPIRED', lastSyncedAt: '2026-09-01T01:00:00.000Z',
    });
  });

  it('clamps the limit rather than sending whatever it is handed', async () => {
    asDevice();
    (global.fetch as jest.Mock).mockResolvedValue(res(200, { posts: [] }));
    await fetchSocialPosts({ connectionId: 'conn-1', limit: 9999 }, neverCalled);
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain('limit=50');
  });
});

describe('last-good cache', () => {
  const post = {
    id: 'p1', connectionId: 'conn-1', kind: 'image', text: 'cached',
    mediaUrl: 'https://cdn/x.jpg', thumbnailUrl: null, permalink: null,
    postedAt: '2026-09-01T00:00:00.000Z',
  };

  it('round-trips, and is keyed per connection', () => {
    writeLastGood('conn-1', [post]);
    expect(readLastGood('conn-1')).toEqual([post]);
    expect(readLastGood('conn-2')).toBeNull();
  });

  it('survives unparseable storage without throwing', () => {
    localStorage.setItem('venueos_social_lastgood_conn-1', '{not json');
    expect(readLastGood('conn-1')).toBeNull();
  });

  it('never persists more than a boardful', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ ...post, id: `p${i}` }));
    writeLastGood('conn-1', many);
    expect(readLastGood('conn-1')).toHaveLength(12);
  });
});
