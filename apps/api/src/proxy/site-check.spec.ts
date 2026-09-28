/**
 * Website Tabs — site check (2026-09-28).
 *
 * The panel's one promise is "paste a URL, the tab fills itself in and tells
 * the truth about whether it will show". These pin the three halves of that
 * promise: the URL is normalised the way the screen will load it, the framing
 * verdict follows the headers browsers actually honour (CSP frame-ancestors
 * wins over X-Frame-Options; an invalid XFO frames fine; a report-only CSP
 * blocks nothing), and a failure is a RESULT the panel can show in words,
 * never a thrown error — with a refused private host reported exactly like a
 * bad scheme (no internal-network oracle).
 */
import {
  SsrfError,
  FetchTooLargeError,
  type SafeFetchResult,
} from '../branding/safe-fetch';
import {
  checkSite,
  extractSiteMeta,
  looksLikeSignIn,
  normalizeSiteUrl,
  parseEmbedPolicy,
} from './site-check';

const OURS = ['https://app.venue-os.app', 'https://venue-os.app'];

describe('normalizeSiteUrl — the URL the screen will load', () => {
  it('prefixes a bare domain with https:// exactly like WebpageWidget', () => {
    expect(normalizeSiteUrl('example.com')).toBe('https://example.com/');
    expect(normalizeSiteUrl('  example.com/menu  ')).toBe(
      'https://example.com/menu',
    );
    expect(normalizeSiteUrl('//cdn.example.com/x')).toBe(
      'https://cdn.example.com/x',
    );
  });

  it('keeps an explicit http(s) URL', () => {
    expect(normalizeSiteUrl('https://a.b/c?d=1')).toBe('https://a.b/c?d=1');
    expect(normalizeSiteUrl('http://a.b/')).toBe('http://a.b/');
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['file:', 'file:///etc/passwd'],
    ['data:', 'data:text/html,<script>1</script>'],
    ['intent:', 'intent://scan/#Intent;scheme=zxing;end'],
    ['control char', 'https://a.b/\nx'],
    ['empty', '   '],
    ['non-string', 42 as unknown as string],
  ])('refuses %s', (_label, raw) => {
    expect(normalizeSiteUrl(raw)).toBeNull();
  });

  it('refuses a URL past the paste ceiling', () => {
    expect(normalizeSiteUrl('https://a.b/' + 'x'.repeat(2100))).toBeNull();
  });
});

describe('parseEmbedPolicy — what a browser will actually do', () => {
  it('frames a page with neither header', () => {
    expect(parseEmbedPolicy({}, OURS)).toEqual({ embed: 'ok', reason: null });
    expect(parseEmbedPolicy(undefined, OURS)).toEqual({
      embed: 'ok',
      reason: null,
    });
  });

  it('blocks on X-Frame-Options DENY / SAMEORIGIN (any case)', () => {
    expect(parseEmbedPolicy({ 'x-frame-options': 'DENY' }, OURS)).toEqual({
      embed: 'blocked',
      reason: 'x-frame-options',
    });
    expect(parseEmbedPolicy({ 'x-frame-options': 'sameorigin' }, OURS)).toEqual(
      {
        embed: 'blocked',
        reason: 'x-frame-options',
      },
    );
  });

  it('ignores an INVALID X-Frame-Options value, as browsers do', () => {
    expect(parseEmbedPolicy({ 'x-frame-options': 'ALLOWALL' }, OURS)).toEqual({
      embed: 'ok',
      reason: null,
    });
  });

  it('ALLOW-FROM is a block unless it names one of our origins', () => {
    expect(
      parseEmbedPolicy(
        { 'x-frame-options': 'ALLOW-FROM https://other.example' },
        OURS,
      ).embed,
    ).toBe('blocked');
    expect(
      parseEmbedPolicy(
        { 'x-frame-options': 'ALLOW-FROM https://app.venue-os.app/' },
        OURS,
      ).embed,
    ).toBe('ok');
  });

  it('CSP frame-ancestors WINS over X-Frame-Options', () => {
    // XFO says deny, CSP says anyone may frame — the browser follows CSP.
    expect(
      parseEmbedPolicy(
        {
          'x-frame-options': 'DENY',
          'content-security-policy': "default-src 'self'; frame-ancestors *",
        },
        OURS,
      ),
    ).toEqual({ embed: 'ok', reason: null });
    // …and the reverse: CSP denies while XFO is absent.
    expect(
      parseEmbedPolicy(
        { 'content-security-policy': "frame-ancestors 'none'" },
        OURS,
      ),
    ).toEqual({
      embed: 'blocked',
      reason: 'frame-ancestors',
    });
    expect(
      parseEmbedPolicy(
        { 'content-security-policy': "frame-ancestors 'self'" },
        OURS,
      ).embed,
    ).toBe('blocked');
  });

  it('a scheme-source or a listed own origin admits us; a stranger does not', () => {
    const csp = (v: string) =>
      parseEmbedPolicy({ 'content-security-policy': v }, OURS).embed;
    expect(csp('frame-ancestors https:')).toBe('ok');
    expect(csp("frame-ancestors 'self' https://app.venue-os.app")).toBe('ok');
    expect(csp("frame-ancestors 'self' https://*.venue-os.app")).toBe('ok');
    expect(csp("frame-ancestors 'self' https://portal.district.example")).toBe(
      'blocked',
    );
    // A wildcard must not match on a non-dot boundary.
    expect(csp('frame-ancestors https://*.os.app')).toBe('blocked');
  });

  it('a report-only policy blocks nothing', () => {
    expect(
      parseEmbedPolicy(
        { 'content-security-policy-report-only': "frame-ancestors 'none'" },
        OURS,
      ).embed,
    ).toBe('ok');
  });

  it('reads every header when node folded several into an array', () => {
    expect(
      parseEmbedPolicy(
        { 'content-security-policy': ['img-src *', "frame-ancestors 'none'"] },
        OURS,
      ).embed,
    ).toBe('blocked');
  });
});

describe('extractSiteMeta — name + icon from the head', () => {
  const BASE = 'https://www.lincoln.k12.example/portal/index.html';

  it('prefers og:site_name, then the brand segment of the title, then the host', () => {
    const withOg =
      '<html><head><meta property="og:site_name" content="Lincoln High">' +
      '<title>Home | Lincoln High</title></head></html>';
    expect(extractSiteMeta(withOg, BASE).name).toBe('Lincoln High');
    const titleOnly =
      '<html><head><title>Lunch Menus &amp; More | Lincoln High</title></head></html>';
    expect(extractSiteMeta(titleOnly, BASE).name).toBe('Lincoln High');
    expect(
      extractSiteMeta('<html><head></head><body>x</body></html>', BASE).name,
    ).toBe('lincoln.k12.example');
  });

  it('picks the apple-touch-icon over a plain icon, and the largest plain icon otherwise', () => {
    const html = `<html><head>
      <link rel="icon" sizes="16x16" href="/small.png">
      <link rel="icon" sizes="192x192" href="/big.png">
    </head></html>`;
    expect(extractSiteMeta(html, BASE).iconUrl).toBe(
      'https://www.lincoln.k12.example/big.png',
    );
    const withApple = html.replace(
      '</head>',
      '<link rel="apple-touch-icon" href="/touch.png"></head>',
    );
    expect(extractSiteMeta(withApple, BASE).iconUrl).toBe(
      'https://www.lincoln.k12.example/touch.png',
    );
  });

  it('resolves a relative href against the FINAL url and refuses a non-http icon', () => {
    expect(
      extractSiteMeta('<link rel="icon" href="../img/f.ico">', BASE).iconUrl,
    ).toBe('https://www.lincoln.k12.example/img/f.ico');
    expect(
      extractSiteMeta(
        '<link rel="icon" href="data:image/png;base64,AAAA">',
        BASE,
      ).iconUrl,
    ).toBe('https://www.lincoln.k12.example/favicon.ico');
  });

  it('falls back to /favicon.ico on the origin when the page declares nothing', () => {
    expect(
      extractSiteMeta('<html><head><title>x</title></head></html>', BASE)
        .iconUrl,
    ).toBe('https://www.lincoln.k12.example/favicon.ico');
  });
});

describe('checkSite — a result the panel can show, never a throw', () => {
  const ok = (over: Partial<SafeFetchResult>): SafeFetchResult => ({
    body: Buffer.from(
      '<html><head><title>Wiki | Example</title></head></html>',
    ),
    contentType: 'text/html; charset=utf-8',
    finalUrl: 'https://example.com/',
    status: 200,
    headers: {},
    ...over,
  });
  const answering = (over: Partial<SafeFetchResult>) => ({
    fetch: () => Promise.resolve(ok(over)),
  });
  const failing = (err: Error) => ({ fetch: () => Promise.reject(err) });

  it('loads: name, icon and embed ok', async () => {
    const r = await checkSite('example.com', answering({}));
    expect(r).toMatchObject({
      ok: true,
      url: 'https://example.com/',
      embed: 'ok',
      reason: null,
      name: 'Wiki',
      status: 200,
    });
    expect(r.iconUrl).toBe('https://example.com/favicon.ico');
  });

  it('needs our app: a framing block is a verdict, not a failure', async () => {
    const r = await checkSite(
      'https://example.com',
      answering({ headers: { 'x-frame-options': 'DENY' } }),
    );
    expect(r.ok).toBe(true);
    expect(r.embed).toBe('blocked');
    expect(r.reason).toBe('x-frame-options');
    expect(r.name).toBe('Wiki');
  });

  it('cannot reach: a non-2xx keeps the host as the name and says http-status', async () => {
    const r = await checkSite(
      'https://example.com/gone',
      answering({ status: 404, body: Buffer.from('') }),
    );
    expect(r).toMatchObject({
      ok: false,
      embed: 'unreachable',
      reason: 'http-status',
      status: 404,
      name: 'example.com',
    });
  });

  it('a refused private host reads exactly like any other refusal — no oracle', async () => {
    const r = await checkSite(
      'https://intranet.example',
      failing(
        new SsrfError(
          'DNS for intranet.example resolved to private range (10.0.0.5)',
        ),
      ),
    );
    expect(r).toMatchObject({
      ok: false,
      embed: 'unreachable',
      reason: 'blocked-host',
      name: null,
      finalUrl: null,
    });
    expect(JSON.stringify(r)).not.toContain('10.0.0.5');
  });

  it('a sign-in redirect loop is "needs the app", never "can\'t reach" (demo.medpower.org)', async () => {
    const r = await checkSite(
      'https://demo.medpower.org',
      failing(new SsrfError('Too many redirects')),
    );
    expect(r).toMatchObject({
      ok: false,
      embed: 'blocked',
      reason: 'sign-in',
      finalUrl: null,
      name: null,
    });
  });

  it('a redirect to a sign-in page on another host never becomes the tab URL, name or icon', async () => {
    const r = await checkSite(
      'https://portal.district.example',
      answering({
        finalUrl:
          'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=1&redirect_uri=https%3A%2F%2Fportal.district.example%2Fcb&state=once',
        headers: { 'x-frame-options': 'DENY' },
        body: Buffer.from('<html><head><title>Sign in to your account</title></head></html>'),
      }),
    );
    expect(r).toMatchObject({
      ok: true,
      finalUrl: null,
      embed: 'blocked',
      reason: 'sign-in',
      name: 'portal.district.example',
      iconUrl: 'https://portal.district.example/favicon.ico',
    });
  });

  it('an ordinary redirect to another host is still reported, so the panel can adopt it', async () => {
    const r = await checkSite(
      'https://bit.ly/menu',
      answering({ finalUrl: 'https://menus.example/today' }),
    );
    expect(r.finalUrl).toBe('https://menus.example/today');
    expect(r.reason).toBeNull();
  });

  it('too large and network failures are named, and never thrown', async () => {
    const big = await checkSite(
      'https://example.com',
      failing(new FetchTooLargeError('x')),
    );
    expect(big.reason).toBe('too-large');
    const net = await checkSite(
      'https://example.com',
      failing(new Error('ECONNRESET')),
    );
    expect(net.reason).toBe('network');
    expect(net.embed).toBe('unreachable');
  });

  it('a non-URL never reaches the fetcher', async () => {
    const fetch = jest.fn(() => Promise.resolve(ok({})));
    const r = await checkSite('javascript:alert(1)', { fetch });
    expect(fetch).not.toHaveBeenCalled();
    expect(r.reason).toBe('invalid-url');
  });

  it('a non-HTML answer (a PDF, an image) still gets a host name and a favicon guess', async () => {
    const r = await checkSite(
      'https://example.com/menu.pdf',
      answering({
        contentType: 'application/pdf',
        body: Buffer.from('%PDF'),
        finalUrl: 'https://example.com/menu.pdf',
      }),
    );
    expect(r).toMatchObject({
      ok: true,
      embed: 'ok',
      name: 'example.com',
      iconUrl: 'https://example.com/favicon.ico',
    });
  });
});

describe('looksLikeSignIn — a page the tab must never adopt as its URL', () => {
  it('knows OAuth / OIDC, SAML and sign-in paths', () => {
    expect(
      looksLikeSignIn(
        'https://login.learn.medpower.com/authorize?client_id=r4&redirect_uri=https%3A%2F%2Fdemo.medpower.org%2F',
      ),
    ).toBe(true);
    expect(
      looksLikeSignIn('https://idp.example/x?client_id=1&response_type=code'),
    ).toBe(true);
    expect(looksLikeSignIn('https://idp.example/sso?SAMLRequest=abc')).toBe(true);
    expect(looksLikeSignIn('https://login.learn.medpower.com/u/login/identifier?state=x')).toBe(true);
    expect(looksLikeSignIn('https://accounts.google.com/v3/signin/identifier')).toBe(true);
  });

  it('leaves ordinary pages alone', () => {
    expect(looksLikeSignIn('https://menus.example/today')).toBe(false);
    expect(looksLikeSignIn('https://example.com/?client_id=1')).toBe(false);
    expect(looksLikeSignIn('https://example.com/blog/logins-explained')).toBe(false);
    expect(looksLikeSignIn('not a url')).toBe(false);
  });
});
