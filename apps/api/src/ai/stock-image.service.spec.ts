/**
 * StockImageService — IMAGERY wave (2026-06-28).
 *
 * The free stock-photo path (Pexels) that makes EVERY photo-archetype board
 * come back with a real photo for $0. These specs pin the load-bearing
 * graceful-degradation contract:
 *   1. No PEXELS_API_KEY → returns null (feature off, board keeps its gradient),
 *      and NEVER calls fetch.
 *   2. With a key + a normal payload → returns the best high-res landscape URL.
 *   3. No results / non-2xx / network error / unparseable JSON → null, NEVER
 *      throws (a stock miss must never break board generation).
 *   4. The key rides the Authorization HEADER (never the URL).
 *   5. pickBestPhoto picks the best src key + the orientation crop.
 */

import { StockImageService, pickBestPhoto, pickPhotos } from './stock-image.service';

const PHOTO = {
  photographer: 'Jane Doe',
  url: 'https://www.pexels.com/photo/123/',
  src: {
    original: 'https://images.pexels.com/photos/123/orig.jpg',
    large2x: 'https://images.pexels.com/photos/123/large2x.jpg',
    large: 'https://images.pexels.com/photos/123/large.jpg',
    landscape: 'https://images.pexels.com/photos/123/landscape.jpg',
    portrait: 'https://images.pexels.com/photos/123/portrait.jpg',
    medium: 'https://images.pexels.com/photos/123/medium.jpg',
    small: 'https://images.pexels.com/photos/123/small.jpg',
    tiny: 'https://images.pexels.com/photos/123/tiny.jpg',
  },
};

function mockFetchOk(json: any) {
  return jest.fn(async () => ({ ok: true, status: 200, json: async () => json } as any));
}

describe('StockImageService', () => {
  const ORIG_KEY = process.env.PEXELS_API_KEY;
  const ORIG_FETCH = global.fetch;
  let svc: StockImageService;

  beforeEach(() => {
    svc = new StockImageService();
  });
  afterEach(() => {
    if (ORIG_KEY === undefined) delete process.env.PEXELS_API_KEY;
    else process.env.PEXELS_API_KEY = ORIG_KEY;
    global.fetch = ORIG_FETCH;
    jest.restoreAllMocks();
  });

  it('returns null and NEVER calls fetch when no key is set', async () => {
    delete process.env.PEXELS_API_KEY;
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as any;
    expect(svc.isConfigured()).toBe(false);
    const res = await svc.search('craft beer pour bar');
    expect(res).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns null for an empty query (no fetch)', async () => {
    process.env.PEXELS_API_KEY = 'test-key';
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as any;
    expect(await svc.search('   ')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns the best landscape URL on a normal payload', async () => {
    process.env.PEXELS_API_KEY = 'test-key';
    global.fetch = mockFetchOk({ photos: [PHOTO] }) as any;
    const res = await svc.search('craft beer pour bar', { orientation: 'landscape' });
    expect(res).not.toBeNull();
    expect(res!.url).toBe(PHOTO.src.large2x);
    expect(res!.photographer).toBe('Jane Doe');
    expect(res!.sourceUrl).toBe(PHOTO.url);
  });

  it('passes the key in the Authorization HEADER, never the URL', async () => {
    process.env.PEXELS_API_KEY = 'secret-key-xyz';
    const fetchSpy = mockFetchOk({ photos: [PHOTO] });
    global.fetch = fetchSpy as any;
    await svc.search('campus quad students');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).not.toContain('secret-key-xyz'); // key NOT in URL
    expect((init as any).headers.Authorization).toBe('secret-key-xyz'); // bare key in header
    expect((init as any).signal).toBeDefined(); // AbortSignal timeout present
  });

  it('returns null on no results — never throws', async () => {
    process.env.PEXELS_API_KEY = 'test-key';
    global.fetch = mockFetchOk({ photos: [] }) as any;
    await expect(svc.search('zzz nonexistent subject')).resolves.toBeNull();
  });

  it('returns null on a non-2xx response — never throws', async () => {
    process.env.PEXELS_API_KEY = 'bad-key';
    global.fetch = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({}) } as any)) as any;
    await expect(svc.search('anything')).resolves.toBeNull();
  });

  it('returns null on a network error — never throws', async () => {
    process.env.PEXELS_API_KEY = 'test-key';
    global.fetch = jest.fn(async () => { throw new Error('ECONNRESET'); }) as any;
    await expect(svc.search('anything')).resolves.toBeNull();
  });

  it('returns null on unparseable JSON — never throws', async () => {
    process.env.PEXELS_API_KEY = 'test-key';
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } } as any)) as any;
    await expect(svc.search('anything')).resolves.toBeNull();
  });
});

describe('StockImageService.searchMany (Wave B / editor-crush B1 — in-editor grid)', () => {
  const ORIG_KEY = process.env.PEXELS_API_KEY;
  const ORIG_FETCH = global.fetch;
  let svc: StockImageService;

  beforeEach(() => {
    svc = new StockImageService();
  });
  afterEach(() => {
    if (ORIG_KEY === undefined) delete process.env.PEXELS_API_KEY;
    else process.env.PEXELS_API_KEY = ORIG_KEY;
    global.fetch = ORIG_FETCH;
    jest.restoreAllMocks();
  });

  it('returns [] and NEVER calls fetch when no key is set', async () => {
    delete process.env.PEXELS_API_KEY;
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as any;
    const res = await svc.searchMany('craft beer pour bar');
    expect(res).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns [] for an empty query (no fetch)', async () => {
    process.env.PEXELS_API_KEY = 'test-key';
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as any;
    expect(await svc.searchMany('   ')).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns every usable photo in the payload (a grid, not just #1)', async () => {
    process.env.PEXELS_API_KEY = 'test-key';
    const second = { ...PHOTO, photographer: 'John Roe', src: { ...PHOTO.src, large2x: 'https://images.pexels.com/photos/456/large2x.jpg' } };
    global.fetch = mockFetchOk({ photos: [PHOTO, second] }) as any;
    const res = await svc.searchMany('campus quad students');
    expect(res).toHaveLength(2);
    expect(res[0].url).toBe(PHOTO.src.large2x);
    expect(res[1].url).toBe(second.src.large2x);
    expect(res[1].photographer).toBe('John Roe');
  });

  it('clamps limit into [1,24] and passes it as per_page', async () => {
    process.env.PEXELS_API_KEY = 'test-key';
    const fetchSpy = mockFetchOk({ photos: [PHOTO] });
    global.fetch = fetchSpy as any;
    await svc.searchMany('sunset over stadium', { limit: 999 });
    const [url] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('per_page=24');
  });

  it('passes the key in the Authorization HEADER, never the URL', async () => {
    process.env.PEXELS_API_KEY = 'secret-key-xyz';
    const fetchSpy = mockFetchOk({ photos: [PHOTO] });
    global.fetch = fetchSpy as any;
    await svc.searchMany('campus quad students');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).not.toContain('secret-key-xyz');
    expect((init as any).headers.Authorization).toBe('secret-key-xyz');
  });

  it('returns [] on a non-2xx response — never throws', async () => {
    process.env.PEXELS_API_KEY = 'bad-key';
    global.fetch = jest.fn(async () => ({ ok: false, status: 429, json: async () => ({}) } as any)) as any;
    await expect(svc.searchMany('anything')).resolves.toEqual([]);
  });

  it('returns [] on a network error — never throws', async () => {
    process.env.PEXELS_API_KEY = 'test-key';
    global.fetch = jest.fn(async () => { throw new Error('ECONNRESET'); }) as any;
    await expect(svc.searchMany('anything')).resolves.toEqual([]);
  });
});

describe('pickPhotos', () => {
  it('returns every extractable photo, dropping entries with no usable src', () => {
    const bad = { photographer: 'Nobody', src: {} };
    const res = pickPhotos({ photos: [PHOTO, bad] }, 'landscape');
    expect(res).toHaveLength(1);
    expect(res[0].url).toBe(PHOTO.src.large2x);
  });
  it('returns [] on an empty / malformed payload', () => {
    expect(pickPhotos({}, 'landscape')).toEqual([]);
    expect(pickPhotos({ photos: [] }, 'landscape')).toEqual([]);
    expect(pickPhotos(null, 'landscape')).toEqual([]);
  });
});

describe('pickBestPhoto', () => {
  it('prefers large2x for landscape', () => {
    expect(pickBestPhoto({ photos: [PHOTO] }, 'landscape')!.url).toBe(PHOTO.src.large2x);
  });
  it('falls back to the orientation crop then large when large2x is missing', () => {
    const noLarge2x = { ...PHOTO, src: { ...PHOTO.src, large2x: undefined } };
    expect(pickBestPhoto({ photos: [noLarge2x] }, 'portrait')!.url).toBe(PHOTO.src.portrait);
  });
  it('returns null on an empty / malformed payload', () => {
    expect(pickBestPhoto({}, 'landscape')).toBeNull();
    expect(pickBestPhoto({ photos: [] }, 'landscape')).toBeNull();
    expect(pickBestPhoto({ photos: [{}] }, 'landscape')).toBeNull();
    expect(pickBestPhoto(null, 'landscape')).toBeNull();
  });
  it('ignores a non-https src URL', () => {
    const httpOnly = { src: { large2x: 'http://insecure/x.jpg' } };
    expect(pickBestPhoto({ photos: [httpOnly] }, 'landscape')).toBeNull();
  });
});
