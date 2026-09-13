/**
 * SocialFeedWidget — the STATES.
 *
 * The point of this suite is the one rule that made "Coming soon" the right
 * copy for a year: the widget must never show something an operator or an
 * audience could mistake for working content when it is not. So each state
 * is asserted by the SENTENCE it puts on the glass, and there is an explicit
 * test that no sample/placeholder post exists anywhere.
 *
 * No geometry assertions — jsdom has no layout, and grading layout there is
 * how the widget-legibility work got fooled before. The pure layout maths
 * (`gridShape`) is tested directly instead.
 */
import { render, screen, act } from '@testing-library/react';
import { SocialFeedWidget, gridShape, relativeAge } from '../SocialFeedWidget';

const LS_DEVICE_TOKEN = 'edu_device_token';
const LS_MANIFEST_CACHE = 'edu_manifest_cache_v1';

function res(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function post(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    connectionId: 'conn-1',
    kind: 'image',
    text: 'Homecoming was unreal',
    mediaUrl: 'https://cdn.example.com/a.jpg',
    thumbnailUrl: null,
    permalink: 'https://www.instagram.com/p/a/',
    postedAt: new Date().toISOString(),
    ...over,
  };
}

/** Let the hook's first tick settle. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(LS_DEVICE_TOKEN, 'device-jwt');
  localStorage.setItem(LS_MANIFEST_CACHE, JSON.stringify({ m: { screenId: 'screen-1' } }));
  process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com/api/v1';
  (global as any).fetch = jest.fn().mockResolvedValue(res(200, { posts: [], connection: null }));
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('no connection', () => {
  it('tells the OPERATOR how to fix it in the builder', async () => {
    render(<SocialFeedWidget config={{ provider: 'instagram' }} />);
    await settle();
    expect(screen.getByText(/Connect an Instagram account to show posts here/i)).toBeInTheDocument();
    // ...and it must not have called the API at all.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('says nothing instructional on the WALL — a neutral branded panel', async () => {
    render(<SocialFeedWidget config={{ provider: 'instagram' }} live />);
    await settle();
    expect(screen.queryByText(/Connect an Instagram account/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Apps →/)).not.toBeInTheDocument();
    // The brand name is all an audience sees.
    expect(screen.getAllByText('Instagram').length).toBeGreaterThan(0);
  });

  it('uses the Facebook wording for a Facebook zone', async () => {
    render(<SocialFeedWidget config={{ provider: 'facebook' }} />);
    await settle();
    expect(screen.getByText(/Connect a Facebook Page to show posts here/i)).toBeInTheDocument();
  });
});

describe('connected', () => {
  it('renders the real posts and the account label', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      res(200, {
        posts: [post(), post({ id: 'p2', text: 'Second post' })],
        connection: {
          id: 'conn-1', providerId: 'instagram', displayName: '@sunnyside',
          status: 'ACTIVE', lastSyncedAt: new Date().toISOString(),
        },
      }),
    );
    render(<SocialFeedWidget config={{ provider: 'instagram', connectionId: 'conn-1' }} live />);
    await settle();
    expect(screen.getByText('@sunnyside')).toBeInTheDocument();
    expect(screen.getByText('Homecoming was unreal')).toBeInTheDocument();
    expect(screen.getByText('Second post')).toBeInTheDocument();
  });

  it('labels freshness from the SERVER’s last sync, never from render time', async () => {
    const syncedAt = new Date(Date.now() - 3 * 3600_000).toISOString(); // 3h ago
    (global.fetch as jest.Mock).mockResolvedValue(
      res(200, {
        posts: [post()],
        connection: {
          id: 'conn-1', providerId: 'instagram', displayName: '@sunnyside',
          status: 'ACTIVE', lastSyncedAt: syncedAt,
        },
      }),
    );
    render(<SocialFeedWidget config={{ provider: 'instagram', connectionId: 'conn-1' }} live />);
    await settle();
    expect(screen.getByText('Updated 3h ago')).toBeInTheDocument();
    // A board that repainted must never claim to be freshly synced.
    expect(screen.queryByText('Updated just now')).not.toBeInTheDocument();
  });

  it('honours maxItems', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      res(200, {
        posts: [post({ id: 'a', text: 'one' }), post({ id: 'b', text: 'two' }), post({ id: 'c', text: 'three' })],
        connection: { id: 'conn-1', providerId: 'instagram', displayName: '@x', status: 'ACTIVE', lastSyncedAt: null },
      }),
    );
    render(<SocialFeedWidget config={{ provider: 'instagram', connectionId: 'conn-1', maxItems: 2 }} live />);
    await settle();
    expect(screen.getByText('one')).toBeInTheDocument();
    expect(screen.getByText('two')).toBeInTheDocument();
    expect(screen.queryByText('three')).not.toBeInTheDocument();
  });

  it('single layout shows ONE post at a time', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      res(200, {
        posts: [post({ id: 'a', text: 'one' }), post({ id: 'b', text: 'two' })],
        connection: { id: 'conn-1', providerId: 'instagram', displayName: '@x', status: 'ACTIVE', lastSyncedAt: null },
      }),
    );
    render(
      <SocialFeedWidget
        config={{ provider: 'instagram', connectionId: 'conn-1', layout: 'single' }}
        live
      />,
    );
    await settle();
    expect(screen.getByText('one')).toBeInTheDocument();
    expect(screen.queryByText('two')).not.toBeInTheDocument();
  });
});

describe('empty', () => {
  it('says the account has not posted — never a sample post', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      res(200, {
        posts: [],
        connection: { id: 'conn-1', providerId: 'instagram', displayName: '@sunnyside', status: 'ACTIVE', lastSyncedAt: null },
      }),
    );
    render(<SocialFeedWidget config={{ provider: 'instagram', connectionId: 'conn-1' }} live />);
    await settle();
    expect(screen.getByText(/@sunnyside hasn’t posted yet/i)).toBeInTheDocument();
  });
});

describe('expired credential', () => {
  it('says RECONNECT rather than showing an empty frame', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      res(200, {
        posts: [],
        connection: { id: 'conn-1', providerId: 'instagram', displayName: '@sunnyside', status: 'EXPIRED', lastSyncedAt: null },
      }),
    );
    render(<SocialFeedWidget config={{ provider: 'instagram', connectionId: 'conn-1' }} />);
    await settle();
    expect(screen.getByText(/Instagram access expired/i)).toBeInTheDocument();
    expect(screen.getByText(/Reconnect in the Apps tab/i)).toBeInTheDocument();
  });

  it('keeps showing cached posts when the credential dies, and labels why', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      res(200, {
        posts: [post({ text: 'last good post' })],
        connection: { id: 'conn-1', providerId: 'instagram', displayName: '@sunnyside', status: 'EXPIRED', lastSyncedAt: null },
      }),
    );
    render(<SocialFeedWidget config={{ provider: 'instagram', connectionId: 'conn-1' }} live />);
    await settle();
    expect(screen.getByText('last good post')).toBeInTheDocument();
    expect(screen.getByText(/access expired — reconnect to get new posts/i)).toBeInTheDocument();
  });
});

describe('fetch failure', () => {
  it('KEEPS the last good list and says the posts are saved', async () => {
    // A previous good load is on disk...
    localStorage.setItem(
      'venueos_social_lastgood_conn-1',
      JSON.stringify({ posts: [post({ id: 'cached', text: 'from before the outage' })] }),
    );
    // ...and the network is down.
    (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));

    render(<SocialFeedWidget config={{ provider: 'instagram', connectionId: 'conn-1' }} live />);
    await settle();

    expect(screen.getByText('from before the outage')).toBeInTheDocument();
    expect(screen.getByText('Showing saved posts')).toBeInTheDocument();
  });

  it('with no cache at all, says it is loading — it does not invent posts', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));
    render(<SocialFeedWidget config={{ provider: 'instagram', connectionId: 'conn-1' }} live />);
    await settle();
    expect(screen.getByText(/Loading posts/i)).toBeInTheDocument();
  });
});

describe('no sample content, ever', () => {
  it('the module contains no placeholder post text', () => {
    // A grep-style assertion on the SOURCE, because the failure mode is a
    // future edit adding a friendly-looking DEMO_POSTS array — exactly what
    // RSSWidget does with RSS_SAMPLE_ITEMS, and exactly what this widget
    // must not do (a made-up social post is indistinguishable from a real
    // one to everybody who walks past the screen).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'SocialFeedWidget.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/SAMPLE_POSTS|DEMO_POSTS|SAMPLE_ITEMS/);
  });
});

describe('pure helpers', () => {
  it('relativeAge reads the timestamp, and refuses an unusable one', () => {
    const now = Date.parse('2026-09-12T12:00:00.000Z');
    expect(relativeAge('2026-09-12T11:58:00.000Z', now)).toBe('2m ago');
    expect(relativeAge('2026-09-12T09:00:00.000Z', now)).toBe('3h ago');
    expect(relativeAge('2026-09-10T12:00:00.000Z', now)).toBe('2d ago');
    expect(relativeAge(null, now)).toBe('');
    expect(relativeAge('not a date', now)).toBe('');
    // A future timestamp is not "in -3h" — it is unlabelled.
    expect(relativeAge('2026-09-12T15:00:00.000Z', now)).toBe('');
  });

  it('gridShape picks near-square cells for the box it is given', () => {
    // A wide box wants columns; a tall box wants rows.
    expect(gridShape(6, 1920, 1080)).toEqual({ cols: 3, rows: 2 });
    expect(gridShape(6, 1080, 1920)).toEqual({ cols: 2, rows: 3 });
    expect(gridShape(1, 1920, 1080)).toEqual({ cols: 1, rows: 1 });
    // Never zero columns, whatever it is handed.
    expect(gridShape(0, 0, 0).cols).toBeGreaterThanOrEqual(1);
  });
});
