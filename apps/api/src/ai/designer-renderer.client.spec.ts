/**
 * designer-renderer.client — what the API sends the board renderer, and what it
 * does with every answer. The renderer's answers are the REAL ones in
 * __fixtures__/renderer (see designer-review.spec.ts for provenance) and its
 * error bodies follow its own contract (renderer-contract.ts RenderErrorBody).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  DesignerRendererClient,
  RENDER_IMAGE_CAPS,
  isTrustedImageUrl,
  rendererBaseUrl,
} from './designer-renderer.client';
import { RENDER_CONTRACT_VERSION } from './renderer-contract';

const SUPA = 'https://abc.supabase.co';
const OURS = `${SUPA}/storage/v1/object/public/assets/ai-designer/t1/logo-1a2b.png`;
const ENV = {
  RENDERER_URL: 'http://renderer.railway.internal:8080/',
  SUPABASE_URL: SUPA,
};
const RENDER_OK = fs.readFileSync(
  path.join(
    __dirname,
    '__fixtures__',
    'renderer',
    'exemplar-menu-hero-cards.response.json',
  ),
  'utf8',
);
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

const board = (img: string) =>
  `<!doctype html><html><head><style>.stage{width:3840px;height:2160px;position:relative;background:url('${img}')}</style></head>` +
  `<body><div class="stage"><img data-imgslot="logo" src="${img}"><h1 data-field="h">Hi</h1></div></body></html>`;

function respond(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(body),
  } as unknown as Response;
}

function client(
  over: {
    fetch?: jest.Mock;
    safeFetch?: jest.Mock;
    env?: Record<string, string>;
  } = {},
) {
  const fetchMock = over.fetch ?? jest.fn(async () => respond(200, RENDER_OK));
  const safeFetchMock =
    over.safeFetch ??
    jest.fn(async (url: string) => ({
      body: PNG,
      contentType: 'image/png',
      finalUrl: url,
      status: 200,
    }));
  const c = new DesignerRendererClient({
    fetch: fetchMock as any,
    safeFetch: safeFetchMock as any,
    env: over.env ?? ENV,
    log: () => {},
  });
  return { c, fetchMock, safeFetchMock };
}

describe('config', () => {
  it('on only with RENDERER_URL, off with the kill switch', () => {
    expect(rendererBaseUrl({})).toBeNull();
    expect(rendererBaseUrl(ENV)).toBe('http://renderer.railway.internal:8080');
    expect(
      rendererBaseUrl({ ...ENV, AI_DESIGN_REVIEW_DISABLED: '1' }),
    ).toBeNull();
    expect(rendererBaseUrl({ RENDERER_URL: 'file:///etc/passwd' })).toBeNull();
    expect(
      new DesignerRendererClient({
        env: { ...ENV, AI_DESIGN_REVIEW_DISABLED: 'true' },
      }).imagesEnabled(),
    ).toBe(false);
  });

  it('only our public storage is trusted — no look-alikes, no traversal, nothing without SUPABASE_URL', () => {
    expect(isTrustedImageUrl(OURS, ENV)).toBe(true);
    expect(
      isTrustedImageUrl(`${SUPA}.evil.com/storage/v1/object/public/x.png`, ENV),
    ).toBe(false);
    expect(
      isTrustedImageUrl(`${SUPA}@evil.com/storage/v1/object/public/x.png`, ENV),
    ).toBe(false);
    expect(
      isTrustedImageUrl(
        `${SUPA}/storage/v1/object/public/../../auth/v1/x`,
        ENV,
      ),
    ).toBe(false);
    expect(
      isTrustedImageUrl(`${SUPA}/storage/v1/object/private-bucket/x.png`, ENV),
    ).toBe(false);
    expect(isTrustedImageUrl(OURS, {})).toBe(false);
  });
});

describe('render', () => {
  it('inlines OUR images as data: URIs and posts {html, canvasWidth, canvasHeight} to /render', async () => {
    const { c, fetchMock, safeFetchMock } = client();
    const out = await c.render(board(OURS), { width: 3840, height: 2160 });
    expect(out.ok).toBe(true);
    expect(safeFetchMock).toHaveBeenCalledTimes(1); // one fetch for both references
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://renderer.railway.internal:8080/render');
    const body = JSON.parse(init.body);
    expect(Object.keys(body).sort()).toEqual([
      'canvasHeight',
      'canvasWidth',
      'html',
    ]);
    expect(body.canvasWidth).toBe(3840);
    expect(body.html).not.toContain(OURS);
    expect(body.html).toContain(
      `src="data:image/png;base64,${PNG.toString('base64')}"`,
    );
    expect(body.html).toContain('data-vos-csp'); // the document a screen gets
    expect(body.html).toContain('/*VOS-FIT-ENGINE*/');
  });

  it('an image from any other host is NEVER fetched — it goes as written (the renderer blocks it)', async () => {
    const { c, safeFetchMock, fetchMock } = client();
    const out = await c.render(board('https://www.supertacomex.com/logo.png'), {
      width: 3840,
      height: 2160,
    });
    expect(out.ok).toBe(true);
    expect(safeFetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).html).toContain(
      'https://www.supertacomex.com/logo.png',
    );
  });

  it('a trusted image over the per-image cap is skipped (reported, left as written)', async () => {
    const big = Buffer.alloc(
      Math.ceil((RENDER_IMAGE_CAPS.perImageChars * 3) / 4) + 10,
      1,
    );
    const { c } = client({
      safeFetch: jest.fn(async (url: string) => ({
        body: big,
        contentType: 'image/jpeg',
        finalUrl: url,
        status: 200,
      })),
    });
    const out = await c.render(board(OURS), { width: 3840, height: 2160 });
    expect(out.ok && out.skippedImages).toEqual([
      { url: OURS, reason: 'too-large' },
    ]);
  });

  it('the total cap holds across images', async () => {
    const half = Buffer.alloc(
      Math.floor((RENDER_IMAGE_CAPS.perImageChars * 3) / 4) - 100,
      2,
    );
    const { c } = client({
      safeFetch: jest.fn(async (url: string) => ({
        body: half,
        contentType: 'image/jpeg',
        finalUrl: url,
        status: 200,
      })),
    });
    const imgs = [1, 2, 3].map(
      (i) => `${SUPA}/storage/v1/object/public/assets/p${i}.jpg`,
    );
    const html = `<html><head></head><body><div>${imgs.map((u) => `<img src="${u}">`).join('')}</div></body></html>`;
    const out = await c.inlineBoardImages(html);
    expect(out.inlined).toHaveLength(2);
    expect(out.skipped).toEqual([{ url: imgs[2], reason: 'total-cap' }]);
  });

  it.each([
    [429, 'queue_full'],
    [504, 'render_timeout'],
    [503, 'memory_limit'],
    [500, 'render_failed'],
  ])('HTTP %i (%s) → skipped, never thrown', async (status, code) => {
    const { c } = client({
      fetch: jest.fn(async () =>
        respond(
          status,
          JSON.stringify({
            contractVersion: RENDER_CONTRACT_VERSION,
            error: code,
            message: 'x',
          }),
        ),
      ),
    });
    const out = await c.render(board(OURS), { width: 3840, height: 2160 });
    expect(out).toMatchObject({
      ok: false,
      status,
      reason: `HTTP ${status} ${code}`,
    });
  });

  it('a network error or a timeout → skipped', async () => {
    const err = Object.assign(new Error('fetch failed'), {
      cause: { code: 'ECONNREFUSED' },
    });
    const { c } = client({
      fetch: jest.fn(async () => {
        throw err;
      }),
    });
    expect(
      await c.render(board(OURS), { width: 3840, height: 2160 }),
    ).toMatchObject({ ok: false, reason: 'unreachable (ECONNREFUSED)' });
    const timeout = Object.assign(new Error('aborted'), {
      name: 'TimeoutError',
    });
    const { c: c2 } = client({
      fetch: jest.fn(async () => {
        throw timeout;
      }),
    });
    expect(
      await c2.render(board(OURS), { width: 3840, height: 2160 }),
    ).toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('an answer from a different contract version is refused', async () => {
    const other = JSON.stringify({
      ...JSON.parse(RENDER_OK),
      contractVersion: 2,
    });
    const { c } = client({ fetch: jest.fn(async () => respond(200, other)) });
    expect(
      await c.render(board(OURS), { width: 3840, height: 2160 }),
    ).toMatchObject({ ok: false, reason: 'contract-version 2 (expected 1)' });
  });

  it('renderer off → nothing is fetched or posted', async () => {
    const { c, fetchMock, safeFetchMock } = client({
      env: { SUPABASE_URL: SUPA },
    });
    expect(
      await c.render(board(OURS), { width: 3840, height: 2160 }),
    ).toMatchObject({ ok: false, reason: 'renderer-off' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(safeFetchMock).not.toHaveBeenCalled();
  });
});

describe('loadModelImage — the logo / photo for the draw', () => {
  it('ours + raster → attached; other hosts, SVG or the kill switch → not', async () => {
    const { c } = client();
    expect(await c.loadModelImage(OURS)).toEqual({
      mediaType: 'image/png',
      base64: PNG.toString('base64'),
    });
    expect(
      await c.loadModelImage('https://www.supertacomex.com/logo.png'),
    ).toBeNull();
    const { c: svg } = client({
      safeFetch: jest.fn(async (url: string) => ({
        body: Buffer.from('<svg/>'),
        contentType: 'image/svg+xml',
        finalUrl: url,
        status: 200,
      })),
    });
    expect(await svg.loadModelImage(OURS)).toBeNull();
    const { c: off, safeFetchMock } = client({
      env: { ...ENV, AI_DESIGN_REVIEW_DISABLED: '1' },
    });
    expect(await off.loadModelImage(OURS)).toBeNull();
    expect(safeFetchMock).not.toHaveBeenCalled();
  });
});
