/**
 * Provider URL builders, token exchange, and media mapping — with a mocked
 * fetch, so these run with no network and no Meta account.
 *
 * What each block is actually PROVING (a test that only re-states the code is
 * worth nothing):
 *   • the authorize URLs are the ones Meta documents, with the scopes that
 *     exist — a wrong scope name makes the whole dialog fail, and
 *     `pages_read_user_engagement` (which does not exist) is the exact
 *     mistake this repo's own brief made;
 *   • a CAROUSEL_ALBUM falls back to its first child's media_url, because a
 *     carousel has no media_url of its own and dropping it silently is how a
 *     board ends up with blank tiles;
 *   • a VIDEO keeps its still separately from its video file;
 *   • an OAuth-190 answer is graded `authFailure` so the connection goes
 *     EXPIRED (reconnect) instead of ERROR (retry forever);
 *   • the Graph error BODY never reaches the message we persist;
 *   • a non-Meta host is refused before the request leaves.
 */
import {
  MetaHttpError,
  META_GRAPH_VERSION,
  assertMetaUrl,
  isAllowedMetaHost,
  metaFetchJson,
} from './meta-http';
import * as instagram from './instagram';
import * as facebook from './facebook';

/** Minimal stand-in for a fetch Response, shaped the way metaFetchJson reads it. */
function reply(status: number, body: unknown) {
  return {
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

describe('meta-http host allowlist', () => {
  it('accepts exactly the five Meta hosts and nothing else', () => {
    for (const h of [
      'api.instagram.com',
      'graph.instagram.com',
      'graph.facebook.com',
      'www.instagram.com',
      'www.facebook.com',
    ]) {
      expect(isAllowedMetaHost(h)).toBe(true);
    }
    // The suffix attack: a host that ENDS with an allowed name is not it.
    expect(isAllowedMetaHost('graph.facebook.com.evil.example')).toBe(false);
    expect(isAllowedMetaHost('evil.example')).toBe(false);
    expect(isAllowedMetaHost('')).toBe(false);
  });

  it('refuses a non-Meta host and refuses plain http', () => {
    expect(() => assertMetaUrl('https://evil.example/graph')).toThrow(
      MetaHttpError,
    );
    expect(() => assertMetaUrl('http://graph.facebook.com/v26.0/me')).toThrow(
      /https/i,
    );
    expect(assertMetaUrl('https://graph.facebook.com/me').hostname).toBe(
      'graph.facebook.com',
    );
  });

  it('never follows a redirect automatically', async () => {
    const seen: any[] = [];
    const fetchImpl = async (_url: string, init: any) => {
      seen.push(init);
      return reply(200, { ok: true });
    };
    await metaFetchJson('https://graph.facebook.com/me', { fetchImpl });
    expect(seen[0].redirect).toBe('manual');
  });

  it('grades an OAuth-190 answer as an auth failure and keeps the body out of the message', async () => {
    const fetchImpl = async () =>
      reply(400, {
        error: {
          message:
            'Error validating access token: Session has expired. access_token=EAAsupersecrettokenvalue',
          type: 'OAuthException',
          code: 190,
          error_subcode: 463,
        },
      });
    expect.assertions(4);
    try {
      await metaFetchJson('https://graph.facebook.com/me', { fetchImpl });
    } catch (err: any) {
      expect(err).toBeInstanceOf(MetaHttpError);
      expect(err.authFailure).toBe(true);
      // The TYPE and CODE survive (searchable); the body does not.
      expect(err.message).toContain('OAuthException');
      expect(err.message).not.toContain('EAAsupersecrettokenvalue');
    }
  });

  it('grades a 500 as retryable, not as an expired credential', async () => {
    const fetchImpl = async () =>
      reply(500, { error: { type: 'Internal', code: 1 } });
    await expect(
      metaFetchJson('https://graph.facebook.com/me', { fetchImpl }),
    ).rejects.toMatchObject({
      authFailure: false,
    });
  });

  it('aborts a hung provider inside the deadline rather than hanging the caller', async () => {
    const fetchImpl = (_url: string, init: any) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const e: any = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      });
    await expect(
      metaFetchJson('https://graph.facebook.com/me', {
        fetchImpl,
        timeoutMs: 20,
      }),
    ).rejects.toThrow(/within 20ms/);
  });
});

describe('instagram provider', () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    process.env.INSTAGRAM_APP_ID = 'ig-app-id';
    process.env.INSTAGRAM_APP_SECRET = 'ig-app-secret';
  });
  afterEach(() => {
    process.env = { ...OLD };
  });

  it('builds the documented authorize URL with the instagram_business_basic scope', () => {
    const url = new URL(
      instagram.instagramAuthorizeUrl({
        state: 'nonce123',
        redirectUri:
          'https://api.example.com/api/v1/integrations/social/oauth/instagram/callback',
      }),
    );
    expect(url.origin + url.pathname).toBe(
      'https://www.instagram.com/oauth/authorize',
    );
    expect(url.searchParams.get('client_id')).toBe('ig-app-id');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('instagram_business_basic');
    expect(url.searchParams.get('state')).toBe('nonce123');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://api.example.com/api/v1/integrations/social/oauth/instagram/callback',
    );
    // The secret must never be in a URL the operator's browser will follow.
    expect(url.search).not.toContain('ig-app-secret');
  });

  it('reports its own missing env vars instead of throwing', () => {
    delete process.env.INSTAGRAM_APP_SECRET;
    expect(instagram.instagramConfigured()).toBe(false);
    expect(instagram.instagramMissingEnv()).toEqual(['INSTAGRAM_APP_SECRET']);
  });

  it('exchanges the code by POST with a form body', async () => {
    const calls: Array<{ url: string; init: any }> = [];
    const fetchImpl = async (url: string, init: any) => {
      calls.push({ url, init });
      return reply(200, { access_token: 'short-lived', user_id: '178414' });
    };
    const out = await instagram.instagramExchangeCode(
      { code: 'CODE', redirectUri: 'https://api.example.com/cb' },
      fetchImpl,
    );
    expect(out).toEqual({ accessToken: 'short-lived', userId: '178414' });
    expect(calls[0].url).toBe('https://api.instagram.com/oauth/access_token');
    expect(calls[0].init.method).toBe('POST');
    const body = new URLSearchParams(calls[0].init.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('client_secret')).toBe('ig-app-secret');
    expect(body.get('code')).toBe('CODE');
  });

  it('turns expires_in into an absolute expiry on the long-lived swap', async () => {
    const fetchImpl = async (url: string) => {
      const u = new URL(url);
      expect(u.origin + u.pathname).toBe(
        'https://graph.instagram.com/access_token',
      );
      expect(u.searchParams.get('grant_type')).toBe('ig_exchange_token');
      return reply(200, { access_token: 'long-lived', expires_in: 5184000 });
    };
    const before = Date.now();
    const out = await instagram.instagramExchangeLongLived(
      'short-lived',
      fetchImpl,
    );
    expect(out.accessToken).toBe('long-lived');
    const days = (out.expiresAt.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(59);
    expect(days).toBeLessThan(61);
  });

  it('refreshes through the ig_refresh_token endpoint', async () => {
    const fetchImpl = async (url: string) => {
      const u = new URL(url);
      expect(u.origin + u.pathname).toBe(
        'https://graph.instagram.com/refresh_access_token',
      );
      expect(u.searchParams.get('grant_type')).toBe('ig_refresh_token');
      return reply(200, { access_token: 'rolled', expires_in: 5184000 });
    };
    const out = await instagram.instagramRefreshToken('long-lived', fetchImpl);
    expect(out.accessToken).toBe('rolled');
  });

  it('requests the pinned Graph version and the documented media fields', async () => {
    let seen = '';
    const fetchImpl = async (url: string) => {
      seen = url;
      return reply(200, { data: [] });
    };
    await instagram.instagramFetchMedia('tok', 30, fetchImpl);
    const u = new URL(seen);
    expect(u.pathname).toBe(`/${META_GRAPH_VERSION}/me/media`);
    expect(u.searchParams.get('fields')).toBe(instagram.INSTAGRAM_MEDIA_FIELDS);
    expect(u.searchParams.get('limit')).toBe('30');
  });

  it('clamps an absurd limit rather than passing it through', async () => {
    let seen = '';
    const fetchImpl = async (url: string) => {
      seen = url;
      return reply(200, { data: [] });
    };
    await instagram.instagramFetchMedia('tok', 100_000, fetchImpl);
    expect(new URL(seen).searchParams.get('limit')).toBe('50');
  });

  describe('media mapping', () => {
    it('maps an IMAGE', () => {
      const p = instagram.mapInstagramMedia({
        id: '1',
        media_type: 'IMAGE',
        media_url: 'https://cdn.example.com/a.jpg',
        permalink: 'https://www.instagram.com/p/a/',
        caption: 'Game night',
        timestamp: '2026-09-01T18:00:00+0000',
      })!;
      expect(p.kind).toBe('image');
      expect(p.mediaUrl).toBe('https://cdn.example.com/a.jpg');
      expect(p.text).toBe('Game night');
      expect(p.postedAt.toISOString()).toBe('2026-09-01T18:00:00.000Z');
    });

    it('keeps a VIDEO thumbnail separate from the video file', () => {
      const p = instagram.mapInstagramMedia({
        id: '2',
        media_type: 'VIDEO',
        media_url: 'https://cdn.example.com/clip.mp4',
        thumbnail_url: 'https://cdn.example.com/clip.jpg',
      })!;
      expect(p.kind).toBe('video');
      expect(p.mediaUrl).toBe('https://cdn.example.com/clip.mp4');
      expect(p.thumbnailUrl).toBe('https://cdn.example.com/clip.jpg');
    });

    it("falls back to a CAROUSEL_ALBUM's first child, which is the only place its picture lives", () => {
      const p = instagram.mapInstagramMedia({
        id: '3',
        media_type: 'CAROUSEL_ALBUM',
        // Deliberately NO media_url — this is the real Graph shape.
        children: {
          data: [
            {
              media_url: 'https://cdn.example.com/c1.jpg',
              media_type: 'IMAGE',
            },
          ],
        },
      })!;
      expect(p.kind).toBe('carousel');
      expect(p.mediaUrl).toBe('https://cdn.example.com/c1.jpg');
    });

    it('drops a non-https media url instead of putting it in an img src', () => {
      const p = instagram.mapInstagramMedia({
        id: '4',
        media_type: 'IMAGE',
        media_url: 'javascript:alert(1)',
      })!;
      expect(p.mediaUrl).toBeNull();
    });

    it('refuses a row with no id', () => {
      expect(instagram.mapInstagramMedia({ media_type: 'IMAGE' })).toBeNull();
    });
  });
});

describe('facebook provider', () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    process.env.META_APP_ID = 'fb-app-id';
    process.env.META_APP_SECRET = 'fb-app-secret';
  });
  afterEach(() => {
    process.env = { ...OLD };
  });

  it('asks for the scopes Meta actually documents for reading Page posts', () => {
    // pages_read_user_CONTENT. `pages_read_user_engagement` does not exist,
    // and asking for a non-existent permission fails the whole dialog.
    expect([...facebook.FACEBOOK_SCOPES]).toEqual([
      'pages_show_list',
      'pages_read_engagement',
      'pages_read_user_content',
    ]);
    const url = new URL(
      facebook.facebookAuthorizeUrl({
        state: 'n',
        redirectUri: 'https://api.example.com/cb',
      }),
    );
    expect(url.origin + url.pathname).toBe(
      `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`,
    );
    expect(url.searchParams.get('scope')).toBe(
      'pages_show_list,pages_read_engagement,pages_read_user_content',
    );
    expect(url.search).not.toContain('fb-app-secret');
  });

  it('reports its own missing env vars instead of throwing', () => {
    delete process.env.META_APP_ID;
    expect(facebook.facebookConfigured()).toBe(false);
    expect(facebook.facebookMissingEnv()).toEqual(['META_APP_ID']);
  });

  it('exchanges the code, then swaps for a long-lived user token', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      return reply(200, { access_token: urls.length === 1 ? 'short' : 'long' });
    };
    const short = await facebook.facebookExchangeCode(
      { code: 'CODE', redirectUri: 'https://api.example.com/cb' },
      fetchImpl,
    );
    const long = await facebook.facebookExchangeLongLived(
      short.accessToken,
      fetchImpl,
    );
    expect(long.accessToken).toBe('long');
    expect(new URL(urls[0]).pathname).toBe(
      `/${META_GRAPH_VERSION}/oauth/access_token`,
    );
    expect(new URL(urls[0]).searchParams.get('code')).toBe('CODE');
    expect(new URL(urls[1]).searchParams.get('grant_type')).toBe(
      'fb_exchange_token',
    );
  });

  it('returns one Page per /me/accounts entry and drops entries with no token', async () => {
    const fetchImpl = async (url: string) => {
      expect(new URL(url).pathname).toBe(`/${META_GRAPH_VERSION}/me/accounts`);
      return reply(200, {
        data: [
          { id: '111', name: 'Sunnyside Cafe', access_token: 'page-tok-1' },
          { id: '222', name: 'No Token Page' },
          { id: '333', name: 'Second Location', access_token: 'page-tok-3' },
        ],
      });
    };
    const pages = await facebook.facebookFetchPages('long', fetchImpl);
    expect(pages.map((p) => p.pageId)).toEqual(['111', '333']);
    expect(pages[0].accessToken).toBe('page-tok-1');
  });

  it('requests posts for the page id under the pinned version', async () => {
    let seen = '';
    const fetchImpl = async (url: string) => {
      seen = url;
      return reply(200, { data: [] });
    };
    await facebook.facebookFetchPosts('111', 'page-tok', 30, fetchImpl);
    const u = new URL(seen);
    expect(u.pathname).toBe(`/${META_GRAPH_VERSION}/111/posts`);
    expect(u.searchParams.get('fields')).toBe(facebook.FACEBOOK_POST_FIELDS);
  });

  it('cannot be talked into a path escape by a stored page id', async () => {
    let seen = '';
    const fetchImpl = async (url: string) => {
      seen = url;
      return reply(200, { data: [] });
    };
    await facebook.facebookFetchPosts('111/../../evil', 'tok', 10, fetchImpl);
    expect(new URL(seen).pathname).toBe(`/${META_GRAPH_VERSION}/111evil/posts`);
  });

  describe('post mapping', () => {
    it('maps a photo post', () => {
      const p = facebook.mapFacebookPost({
        id: '111_222',
        message: 'Open late tonight',
        full_picture: 'https://scontent.example.com/p.jpg',
        permalink_url: 'https://www.facebook.com/111/posts/222',
        created_time: '2026-09-02T12:00:00+0000',
      })!;
      expect(p.kind).toBe('image');
      expect(p.mediaUrl).toBe('https://scontent.example.com/p.jpg');
      expect(p.text).toBe('Open late tonight');
      expect(p.permalink).toBe('https://www.facebook.com/111/posts/222');
    });

    it('maps a video attachment as a video', () => {
      const p = facebook.mapFacebookPost({
        id: '111_333',
        message: 'Highlights',
        attachments: {
          data: [
            {
              media_type: 'video',
              media: { image: { src: 'https://x.example/t.jpg' } },
            },
          ],
        },
      })!;
      expect(p.kind).toBe('video');
      expect(p.mediaUrl).toBe('https://x.example/t.jpg');
    });

    it('maps a text-only post as text, not as a broken image', () => {
      const p = facebook.mapFacebookPost({
        id: '111_444',
        message: 'Closed Monday',
      })!;
      expect(p.kind).toBe('text');
      expect(p.mediaUrl).toBeNull();
    });

    it('refuses a row with no id', () => {
      expect(facebook.mapFacebookPost({ message: 'orphan' })).toBeNull();
    });
  });
});
