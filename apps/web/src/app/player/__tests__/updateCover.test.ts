/**
 * The cover frame, both halves, in jsdom (2026-10-10):
 *   - capture: a live frame, the CORS re-fetch when the canvas is tainted,
 *     the colour fallback, the size cap, storage quota
 *   - the inline first-paint script: ES5, parses, paints from the record,
 *     stamps coverAtMs, ignores stale / junk, exposes clear()
 *   - removal: idempotent, stamps contentAtMs, moves the record to evidence
 */
import {
  UPDATE_COVER_KEY,
  UPDATE_EVIDENCE_KEY,
  parseUpdateAppliedRecord,
  type UpdateAppliedRecord,
} from '../offHoursUpdate';
import {
  captureCoverFrame,
  dominantColorOf,
  pickCoverSource,
  removeUpdateCover,
  writeUpdateCover,
  type UpdateCoverRecord,
} from '../updateCover';
import {
  UPDATE_COVER_ATTR,
  UPDATE_COVER_INLINE_JS,
  UPDATE_COVER_MAX_AGE_MS,
} from '../updateCoverInline';

const JPEG = 'data:image/jpeg;base64,/9j/4AAQ';

function slide(src = 'http://api.invalid/assets/slide-0.png'): HTMLImageElement {
  const im = document.createElement('img');
  im.setAttribute('data-slide-id', 'item-0');
  im.src = src;
  Object.defineProperty(im, 'complete', { value: true });
  Object.defineProperty(im, 'naturalWidth', { value: 1920 });
  Object.defineProperty(im, 'naturalHeight', { value: 1080 });
  im.getBoundingClientRect = () => ({ width: 1920, height: 1080, top: 0, left: 0, right: 1920, bottom: 1080, x: 0, y: 0, toJSON() {} }) as DOMRect;
  document.body.appendChild(im);
  return im;
}

function baseRecord(over: Partial<UpdateAppliedRecord> = {}): UpdateAppliedRecord {
  return {
    v: 1, from: 'aaaa', to: 'bbbb', window: 'nightly', boundary: 'item', zone: 'America/Chicago', zoneSource: 'device',
    capture: 'live', navigatedAtMs: Date.now(), ...over,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute(UPDATE_COVER_ATTR);
  document.documentElement.style.cssText = '';
  sessionStorage.clear();
  delete (window as unknown as { __eduUpdateCover?: unknown }).__eduUpdateCover;
});

describe('captureCoverFrame', () => {
  it('nothing on the glass → a colour frame, capture none', async () => {
    const f = await captureCoverFrame(document, { render: () => JPEG });
    expect(f).toMatchObject({ kind: 'color', capture: 'none', w: 0, h: 0 });
    expect(f.color).toMatch(/^#/);
  });

  it('a visible slide draws live, scaled to ≤ 480 px wide', async () => {
    slide();
    const seen: Array<[number, number]> = [];
    const f = await captureCoverFrame(document, { render: (_s, w, h) => { seen.push([w, h]); return JPEG; } });
    expect(f).toMatchObject({ kind: 'image', data: JPEG, capture: 'live', w: 480, h: 270 });
    expect(seen).toEqual([[480, 270]]);
  });

  it('a tainted canvas re-fetches the image with CORS once and draws that', async () => {
    const im = slide('http://api.invalid/assets/slide-2.png');
    let calls = 0;
    const f = await captureCoverFrame(document, {
      render: (s) => { calls++; if (s === im) throw new DOMException('tainted', 'SecurityError'); return JPEG; },
      refetch: async (url) => { expect(url).toContain('slide-2.png'); return document.createElement('img'); },
    });
    expect(f).toMatchObject({ kind: 'image', capture: 'refetch' });
    expect(calls).toBe(2);
  });

  it('a tainted canvas whose re-fetch fails falls back to the colour — never the splash', async () => {
    slide();
    document.body.style.backgroundColor = 'rgb(17, 34, 51)';
    const f = await captureCoverFrame(document, {
      render: () => { throw new DOMException('tainted', 'SecurityError'); },
      refetch: async () => null,
    });
    expect(f).toMatchObject({ kind: 'color', capture: 'color', color: '#112233' });
  });

  it('a frame over the size cap is refused in favour of the colour', async () => {
    slide();
    const f = await captureCoverFrame(document, { render: () => 'data:image/jpeg;base64,' + 'A'.repeat(500_000), refetch: async () => null });
    expect(f.kind).toBe('color');
  });

  it('a decoding <video> wins over an <img>', () => {
    slide();
    const v = document.createElement('video');
    Object.defineProperty(v, 'readyState', { value: 4 });
    v.getBoundingClientRect = () => ({ width: 1920, height: 1080, top: 0, left: 0, right: 1920, bottom: 1080, x: 0, y: 0, toJSON() {} }) as DOMRect;
    document.body.appendChild(v);
    expect(pickCoverSource(document)).toBe(v);
  });

  it('dominantColorOf climbs to the nearest opaque background', () => {
    const outer = document.createElement('div');
    outer.style.backgroundColor = 'rgb(1, 2, 3)';
    const inner = document.createElement('div');
    inner.style.backgroundColor = 'rgba(0, 0, 0, 0)';
    outer.appendChild(inner);
    document.body.appendChild(outer);
    expect(dominantColorOf(inner)).toBe('#010203');
    expect(dominantColorOf(null, '#abc')).toBe('#abc');
  });
});

describe('writeUpdateCover', () => {
  it('drops the picture, keeps the record, when storage refuses the full write', () => {
    const writes: string[] = [];
    const storage = {
      setItem: (_k: string, v: string) => { if (v.includes('"data"')) throw new Error('QuotaExceededError'); writes.push(v); },
      removeItem: () => undefined,
    };
    const rec: UpdateCoverRecord = { ...baseRecord(), kind: 'image', data: JPEG, color: '#000', w: 480, h: 270 };
    expect(writeUpdateCover(storage, rec)).toBe(true);
    expect(JSON.parse(writes[0])).toMatchObject({ kind: 'color', from: 'aaaa' });
    expect(writes[0]).not.toContain(JPEG);
  });
});

describe('the inline first-paint script', () => {
  const run = () => new Function(UPDATE_COVER_INLINE_JS)();

  it('is ES5 and parses', () => {
    expect(() => new Function(UPDATE_COVER_INLINE_JS)).not.toThrow();
    expect(UPDATE_COVER_INLINE_JS).not.toMatch(/=>|`|\?\./);
  });

  it('no record → touches nothing', () => {
    run();
    expect(document.documentElement.getAttribute(UPDATE_COVER_ATTR)).toBeNull();
    expect(document.documentElement.style.backgroundImage).toBe('');
  });

  it('paints the image frame on <html>, marks it, and stamps coverAtMs', () => {
    const rec: UpdateCoverRecord = { ...baseRecord(), kind: 'image', data: JPEG, color: '#123456', w: 480, h: 270 };
    sessionStorage.setItem(UPDATE_COVER_KEY, JSON.stringify(rec));
    run();
    const html = document.documentElement;
    expect(html.getAttribute(UPDATE_COVER_ATTR)).toBe('image');
    expect(html.style.backgroundImage).toContain(JPEG);
    expect(html.style.backgroundColor).toBe('rgb(18, 52, 86)');
    expect(html.style.backgroundSize).toBe('100% 100%');
    const stamped = parseUpdateAppliedRecord(sessionStorage.getItem(UPDATE_COVER_KEY));
    expect(typeof stamped?.coverAtMs).toBe('number');
    expect((window as unknown as { __eduUpdateCover: { clear: () => void } }).__eduUpdateCover.clear).toBeInstanceOf(Function);
  });

  it('a colour record paints only the colour; a non-hex colour is refused', () => {
    sessionStorage.setItem(UPDATE_COVER_KEY, JSON.stringify({ ...baseRecord(), kind: 'color', color: 'url(javascript:1)' }));
    run();
    expect(document.documentElement.getAttribute(UPDATE_COVER_ATTR)).toBe('color');
    expect(document.documentElement.style.backgroundColor).toBe('rgb(0, 0, 0)');
    expect(document.documentElement.style.backgroundImage).toBe('');
  });

  it('a non-image data URL is never painted', () => {
    sessionStorage.setItem(UPDATE_COVER_KEY, JSON.stringify({ ...baseRecord(), kind: 'image', data: 'data:text/html,<b>x</b>', color: '#000' }));
    run();
    expect(document.documentElement.style.backgroundImage).toBe('');
  });

  it('a stale record (older than the max age) is discarded, not painted', () => {
    sessionStorage.setItem(UPDATE_COVER_KEY, JSON.stringify({ ...baseRecord({ navigatedAtMs: Date.now() - UPDATE_COVER_MAX_AGE_MS - 1 }), kind: 'color', color: '#000' }));
    run();
    expect(document.documentElement.getAttribute(UPDATE_COVER_ATTR)).toBeNull();
    expect(sessionStorage.getItem(UPDATE_COVER_KEY)).toBeNull();
  });

  it('junk is discarded', () => {
    sessionStorage.setItem(UPDATE_COVER_KEY, '{not json');
    run();
    expect(document.documentElement.getAttribute(UPDATE_COVER_ATTR)).toBeNull();
    sessionStorage.setItem(UPDATE_COVER_KEY, JSON.stringify({ v: 7 }));
    run();
    expect(sessionStorage.getItem(UPDATE_COVER_KEY)).toBeNull();
  });

  it('clear() takes the frame down', () => {
    sessionStorage.setItem(UPDATE_COVER_KEY, JSON.stringify({ ...baseRecord(), kind: 'image', data: JPEG, color: '#000' }));
    run();
    (window as unknown as { __eduUpdateCover: { clear: () => void } }).__eduUpdateCover.clear();
    expect(document.documentElement.getAttribute(UPDATE_COVER_ATTR)).toBeNull();
    expect(document.documentElement.style.backgroundImage).toBe('');
  });
});

describe('removeUpdateCover', () => {
  it('takes the cover down, stamps contentAtMs and moves the record (without the picture) to the evidence key', () => {
    const t0 = Date.now() - 1_000;
    sessionStorage.setItem(UPDATE_COVER_KEY, JSON.stringify({ ...baseRecord({ navigatedAtMs: t0 }), kind: 'image', data: JPEG, color: '#000' }));
    new Function(UPDATE_COVER_INLINE_JS)();
    const out = removeUpdateCover(document, sessionStorage, t0 + 5_000);
    expect(out).toMatchObject({ from: 'aaaa', contentAtMs: t0 + 5_000 });
    expect(typeof out?.coverAtMs).toBe('number');
    expect(document.documentElement.getAttribute(UPDATE_COVER_ATTR)).toBeNull();
    expect(sessionStorage.getItem(UPDATE_COVER_KEY)).toBeNull();
    const evidence = sessionStorage.getItem(UPDATE_EVIDENCE_KEY) || '';
    expect(evidence).toContain('"contentAtMs":' + (t0 + 5_000));
    expect(evidence).not.toContain(JPEG);
    // Idempotent.
    expect(removeUpdateCover(document, sessionStorage, 6_000)).toBeNull();
  });

  it('with no cover and no record it is a no-op', () => {
    expect(removeUpdateCover(document, sessionStorage, 1)).toBeNull();
    expect(sessionStorage.getItem(UPDATE_EVIDENCE_KEY)).toBeNull();
  });
});
