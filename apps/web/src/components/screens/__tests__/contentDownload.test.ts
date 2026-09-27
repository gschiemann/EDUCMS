/**
 * contentDownload — what a screen says about the file it is downloading
 * (2026-09-27). The rules pinned here:
 *   • the snapshot is validated on the way in (the column is JSON);
 *   • only a FRESH snapshot is progress — older than ~2 telemetry ticks and
 *     its numbers are withheld (`stale`), an offline screen says nothing;
 *   • the copy never invents a number (no ETA, no percent without a size);
 *   • the English each line carries IS what en.json says, and es / zh have
 *     every key — one catalogue, no drift.
 */
import en from '@/i18n/messages/en.json';
import es from '@/i18n/messages/es.json';
import zh from '@/i18n/messages/zh.json';
import {
  copy,
  deriveContentDownload,
  downloadLine,
  DOWNLOAD_COPY_EN,
  DOWNLOAD_REPORT_FRESH_MS,
  fmtBytes,
  liveDownload,
  parseDownloadSnapshot,
  type DownloadCopyKey,
} from '../contentDownload';
import { fmtBytes as screenOpsFmtBytes } from '../v3/screenOps';

const NOW = Date.parse('2026-09-27T12:00:00.000Z');
const MB = 1024 * 1024;
const SIZE = 141 * MB; // fmtBytes → "141 MB"
const AT_62 = Math.ceil(SIZE * 0.62); // floors to exactly 62 %

const report = (downloading: unknown) => ({ playlist: { count: 3, bytes: 10 }, downloading });
const screen = (downloading: unknown, ageMs = 20_000, status = 'ONLINE') => ({
  status,
  lastCacheReport: report(downloading),
  lastCacheReportAt: new Date(NOW - ageMs).toISOString(),
});

function resolve(cat: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((n, p) => (n && typeof n === 'object' ? (n as Record<string, unknown>)[p] : undefined), cat);
}

describe('parseDownloadSnapshot — the column is JSON, so nothing is trusted', () => {
  it('reads the four fields', () => {
    expect(parseDownloadSnapshot(report({ file: 'a.mp4', bytesLoaded: 10, bytesTotal: 100, deferredCommit: true }))).toEqual({
      file: 'a.mp4', bytesLoaded: 10, bytesTotal: 100, deferredCommit: true,
    });
  });

  it('no snapshot, or one with no usable byte count, is no download', () => {
    for (const junk of [null, undefined, 'x', [1], { file: 'a.mp4' }, { bytesLoaded: -1 }, { bytesLoaded: '5' }, { bytesLoaded: Number.NaN }]) {
      expect(parseDownloadSnapshot(report(junk))).toBeNull();
    }
    expect(parseDownloadSnapshot(null)).toBeNull();
    expect(parseDownloadSnapshot({ playlist: { count: 1, bytes: 1 } })).toBeNull();
  });

  it('an unknown size is null (never divided by), bytes never pass the size, the name is cleaned and capped', () => {
    expect(parseDownloadSnapshot(report({ file: 'a', bytesLoaded: 5, bytesTotal: 0 }))!.bytesTotal).toBeNull();
    expect(parseDownloadSnapshot(report({ file: 'a', bytesLoaded: 500, bytesTotal: 100 }))!.bytesLoaded).toBe(100);
    const s = parseDownloadSnapshot(report({ file: `\u0007 ${'x'.repeat(300)}`, bytesLoaded: 1 }))!;
    expect(s.file).toHaveLength(120);
    expect(s.file.startsWith('x')).toBe(true);
    expect(parseDownloadSnapshot(report({ bytesLoaded: 1, deferredCommit: 'yes' }))).toEqual({
      file: '', bytesLoaded: 1, bytesTotal: null, deferredCommit: false,
    });
  });
});

describe('deriveContentDownload — fresh, held, stale, none', () => {
  it('downloading: fresh, nothing held — with the percent and the decoded name', () => {
    const d = deriveContentDownload(screen({ file: 'RIOT%20promo%204K.mp4', bytesLoaded: AT_62, bytesTotal: SIZE }), NOW)!;
    expect(d).toEqual({ state: 'downloading', fileName: 'RIOT promo 4K.mp4', bytesLoaded: AT_62, bytesTotal: SIZE, percent: 62 });
  });

  it('held: the previous content stays on glass', () => {
    expect(deriveContentDownload(screen({ file: 'a.mp4', bytesLoaded: 1, bytesTotal: 2, deferredCommit: true }), NOW)!.state).toBe('held');
  });

  it('stale: older than about two telemetry ticks is never progress', () => {
    const old = deriveContentDownload(screen({ file: 'a.mp4', bytesLoaded: 1, bytesTotal: 2 }, DOWNLOAD_REPORT_FRESH_MS + 1), NOW)!;
    expect(old.state).toBe('stale');
    expect(liveDownload(old)).toBeNull();
    // The edge itself is still fresh.
    expect(deriveContentDownload(screen({ file: 'a', bytesLoaded: 1 }, DOWNLOAD_REPORT_FRESH_MS), NOW)!.state).toBe('downloading');
    // Undated is ungradable — stale, never fresh by default.
    expect(
      deriveContentDownload({ status: 'ONLINE', lastCacheReport: report({ file: 'a', bytesLoaded: 1 }), lastCacheReportAt: null }, NOW)!.state,
    ).toBe('stale');
    // A stamp from the future (browser clock behind the server) is not old.
    expect(deriveContentDownload(screen({ file: 'a', bytesLoaded: 1 }, -60_000), NOW)!.state).toBe('downloading');
  });

  it('two telemetry ticks plus a retry fit inside the window — a live download never flickers stale', () => {
    // Ticks are 60 s and a failed one retries in 15 s (player telemetry.ts);
    // the API writes the report on every tick while a download is in flight.
    expect(DOWNLOAD_REPORT_FRESH_MS).toBeGreaterThan(2 * 60_000 + 15_000);
  });

  it('none: an offline screen says nothing, and no snapshot is no download', () => {
    expect(deriveContentDownload(screen({ file: 'a', bytesLoaded: 1 }, 20_000, 'OFFLINE'), NOW)).toBeNull();
    expect(deriveContentDownload({ status: 'ONLINE', lastCacheReport: { playlist: { count: 1, bytes: 1 } }, lastCacheReportAt: new Date(NOW).toISOString() }, NOW)).toBeNull();
  });

  it('the percent is a floor — 100 only once every byte is there — and absent without a size', () => {
    expect(deriveContentDownload(screen({ file: 'a', bytesLoaded: 999, bytesTotal: 1000 }), NOW)!.percent).toBe(99);
    expect(deriveContentDownload(screen({ file: 'a', bytesLoaded: 1000, bytesTotal: 1000 }), NOW)!.percent).toBe(100);
    expect(deriveContentDownload(screen({ file: 'a', bytesLoaded: 1000 }), NOW)!.percent).toBeNull();
  });

  it('a malformed escape in the name passes through rather than throwing', () => {
    expect(deriveContentDownload(screen({ file: 'clip%E0%A4%A.mp4', bytesLoaded: 1 }), NOW)!.fileName).toBe('clip%E0%A4%A.mp4');
    expect(deriveContentDownload(screen({ file: '', bytesLoaded: 1 }), NOW)!.fileName).toBeNull();
  });
});

describe('downloadLine — the copy per state', () => {
  const fresh = (over: Record<string, unknown> = {}) =>
    deriveContentDownload(screen({ file: 'a.mp4', bytesLoaded: AT_62, bytesTotal: SIZE, ...over }), NOW);

  it('downloading: "Downloading new content · 62% of 141 MB"', () => {
    const line = downloadLine('downloading', fresh());
    expect(line.en).toBe('Downloading new content · 62% of 141 MB');
    expect(line.message).toEqual({ key: 'screens.contentState.downloadingProgress', values: { percent: 62, size: '141 MB' } });
  });

  it('held: "Still showing previous content · new content 62% of 141 MB"', () => {
    expect(downloadLine('showing-previous', fresh({ deferredCommit: true })).en).toBe(
      'Still showing previous content · new content 62% of 141 MB',
    );
  });

  it('no size yet: bytes so far, never a percent', () => {
    const d = deriveContentDownload(screen({ file: 'a.mp4', bytesLoaded: 20 * MB }), NOW);
    expect(downloadLine('downloading', d).en).toBe('Downloading new content · 20 MB so far');
    expect(downloadLine('showing-previous', d).en).toBe('Still showing previous content · new content 20 MB so far');
    expect(downloadLine('background', d).en).toBe('Downloading another file · 20 MB so far');
  });

  it('a stale or absent download carries no number at all', () => {
    const stale = deriveContentDownload(screen({ file: 'a.mp4', bytesLoaded: AT_62, bytesTotal: SIZE }, 10 * 60_000), NOW);
    for (const d of [stale, null, undefined]) {
      const line = downloadLine('downloading', d);
      expect(line.en).toBe('Downloading new content');
      expect(line.en).not.toMatch(/\d/);
      expect(line.message).toEqual({ key: 'screens.contentState.downloading' });
    }
  });

  it('background: another file of content that already plays', () => {
    expect(downloadLine('background', fresh()).en).toBe('Downloading another file · 62% of 141 MB');
  });

  it('never predicts: no line anywhere says how long is left', () => {
    for (const en of Object.values(DOWNLOAD_COPY_EN)) {
      expect(en).not.toMatch(/\b(remaining|left|eta|minutes? to go|about \d)/i);
    }
  });
});

describe('one catalogue — the English here IS en.json, and es / zh have every key', () => {
  const keys = Object.keys(DOWNLOAD_COPY_EN) as DownloadCopyKey[];

  it('covers a non-trivial set (a sweep over nothing proves nothing)', () => {
    expect(keys.length).toBeGreaterThanOrEqual(20);
  });

  it.each(keys)('%s', (key) => {
    expect(resolve(en, key)).toBe(DOWNLOAD_COPY_EN[key]);
    for (const cat of [es, zh]) {
      const value = resolve(cat, key);
      expect(typeof value).toBe('string');
      expect((value as string).length).toBeGreaterThan(0);
    }
  });

  it('copy() fills the same placeholders the catalogue declares', () => {
    const c = copy('playlistsPage.deliveryDownloadMany', { count: 2, screens: 3 });
    expect(c.en).toBe('on 2 of 3 screens');
    expect(c.message).toEqual({ key: 'playlistsPage.deliveryDownloadMany', values: { count: 2, screens: 3 } });
    // A placeholder with no value stays visible rather than vanishing.
    expect(copy('screens.contentState.downloadingProgress').en).toBe('Downloading new content · {percent}% of {size}');
  });
});

describe('fmtBytes — one byte vocabulary', () => {
  it('is the same function the screen Overview has always used', () => {
    expect(screenOpsFmtBytes).toBe(fmtBytes);
    expect(fmtBytes(SIZE)).toBe('141 MB');
  });
});
