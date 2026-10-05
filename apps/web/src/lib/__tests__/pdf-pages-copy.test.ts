import { useTranslations } from 'next-intl';
import {
  pdfItemLine,
  pdfPagesMayStillLand,
  pdfPagesStatusOf,
  pdfFailureReason,
  PDF_PAGES_POLL_WINDOW_MS,
} from '../pdf-pages-copy';
import { libraryPollMs, ENCODE_CHECK_POLL_MS } from '../video-encode-copy';

// The jest mock of next-intl is a plain function over the real en catalog.
// eslint-disable-next-line react-hooks/rules-of-hooks -- the next-intl test mock, called once at module scope in a test file; no component renders here
const t = useTranslations() as unknown as (k: string, v?: Record<string, string | number>) => string;

const BASE = 'https://x.supabase.co/storage/v1/object/public/assets/t/pdf-pages/a/k/';
const frames = () => ({
  landscape: { sha256: 'a'.repeat(64), size: 10 },
  'landscape-1080': { sha256: 'b'.repeat(64), size: 10 },
  portrait: { sha256: 'c'.repeat(64), size: 10 },
  'portrait-1080': { sha256: 'd'.repeat(64), size: 10 },
});
const ready = (pages: number, count = pages) => ({
  mimeType: 'application/pdf',
  processingMeta: {
    pdfPages: {
      version: 1, state: 'ready', count, base: BASE,
      pages: Array.from({ length: pages }, (_, i) => ({ n: i + 1, w: 100, h: 130, frames: frames() })),
      ...(count > pages ? { truncatedAt: pages } : {}),
      updatedAt: 'x',
    },
  },
});
const pending = (over: Record<string, unknown> = {}) => ({
  mimeType: 'application/pdf',
  processingMeta: { pdfPages: { version: 1, state: 'pending', updatedAt: new Date().toISOString(), ...over } },
});
const failed = (error: string, legacy = false) => ({
  mimeType: 'application/pdf',
  processingMeta: { pdfPages: { version: 1, state: 'failed', error, ...(legacy ? { legacy: true } : {}), updatedAt: 'x' } },
});

describe('pdfPagesStatusOf — the library reads the record the way the manifest does', () => {
  it('preparing / ready / capped / failed / nothing', () => {
    expect(pdfPagesStatusOf(pending({ count: 12, done: 7 }))).toEqual({ kind: 'preparing', done: 7, count: 12 });
    expect(pdfPagesStatusOf(ready(12))).toEqual({ kind: 'ready', pages: 12, count: 12, truncated: false });
    expect(pdfPagesStatusOf(ready(60, 214))).toEqual({ kind: 'ready', pages: 60, count: 214, truncated: true });
    expect(pdfPagesStatusOf(failed('pdf-password-protected'))).toEqual({ kind: 'failed', reason: 'password', legacy: false });
    expect(pdfPagesStatusOf({ mimeType: 'application/pdf', processingMeta: null })).toBeNull();
    expect(pdfPagesStatusOf({ mimeType: 'image/png', processingMeta: ready(1).processingMeta })).toBeNull();
  });

  it('every failure code maps to one plain reason', () => {
    expect(pdfFailureReason('pdf-password-protected')).toBe('password');
    expect(pdfFailureReason('pdf-unreadable')).toBe('unreadable');
    expect(pdfFailureReason('page-render-failed')).toBe('unreadable');
    expect(pdfFailureReason('pdf-too-large')).toBe('tooLarge');
    expect(pdfFailureReason('render-interrupted')).toBe('other');
  });
});

describe('pdfItemLine — the playlist editor\'s line for a PDF item', () => {
  it('"12 pages · 10 s each = 2 min"', () => {
    expect(pdfItemLine(t, ready(12), 10_000)).toBe('12 pages · 10 s each = 2 min');
    expect(pdfItemLine(t, ready(1), 8_000)).toBe('1 page · 8 s each = 8 s');
    expect(pdfItemLine(t, ready(60, 214), 15_000)).toBe('60 pages · 15 s each = 15 min');
    expect(pdfItemLine(t, ready(60), 120_000)).toBe('60 pages · 120 s each = 2 h 0 min');
  });
  it('says what is happening when there are no pages yet, and nothing for a PDF with no record', () => {
    expect(pdfItemLine(t, pending({ count: 12, done: 7 }), 10_000)).toBe('Preparing pages… 7 of 12');
    expect(pdfItemLine(t, pending(), 10_000)).toBe('Preparing pages…');
    expect(pdfItemLine(t, failed('pdf-unreadable'), 10_000)).toBe("Can't be shown on screens");
    expect(pdfItemLine(t, failed('pdf-unreadable', true), 10_000)).toBe("Can't be shown on screens");
    expect(pdfItemLine(t, { mimeType: 'application/pdf', processingMeta: null }, 10_000)).toBeNull();
  });
});

describe('the library polls while pages are still being made — and only then', () => {
  it('a fresh pending record polls; a stale one, a ready one or a non-PDF does not', () => {
    const now = Date.now();
    expect(pdfPagesMayStillLand(pending(), now)).toBe(true);
    expect(libraryPollMs([pending() as any], now)).toBe(ENCODE_CHECK_POLL_MS);
    const stale = pending({ updatedAt: new Date(now - PDF_PAGES_POLL_WINDOW_MS - 1).toISOString() });
    expect(pdfPagesMayStillLand(stale, now)).toBe(false);
    expect(libraryPollMs([ready(3) as any, stale as any], now)).toBe(false);
  });
});

describe('every PDF pages sentence ships in English, Spanish and Chinese', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const catalogs: Record<string, any> = {
    en: require('../../i18n/messages/en.json'),
    es: require('../../i18n/messages/es.json'),
    zh: require('../../i18n/messages/zh.json'),
  };
  const flat = (node: any, prefix = ''): Record<string, string> =>
    Object.entries(node).reduce((acc, [k, v]) => {
      const key = prefix ? `${prefix}.${k}` : k;
      return typeof v === 'string' ? { ...acc, [key]: v } : { ...acc, ...flat(v, key) };
    }, {} as Record<string, string>);
  const placeholders = (s: string) =>
    [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).filter((n, i, all) => all.indexOf(n) === i).sort();
  const en = flat(catalogs.en.assetsLib.pdfPages);

  it.each(['es', 'zh'])('%s has every key, with the same placeholders', (lang) => {
    const other = flat(catalogs[lang].assetsLib.pdfPages);
    expect(Object.keys(other).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en)) {
      expect([key, placeholders(other[key])]).toEqual([key, placeholders(en[key])]);
      expect(other[key]).not.toBe(en[key].includes('{') ? '' : en[key]); // translated, not copied
    }
  });
});
