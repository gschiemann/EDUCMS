/**
 * cache-report — the one shape `Screen.lastCacheReport` is written in
 * (2026-09-27). Both writers (telemetry, legacy /cache-status) go through
 * these functions, so the dashboard can trust the column's shape.
 */
import {
  DOWNLOAD_FILE_MAX_CHARS,
  sanitizeCacheReport,
  sanitizeDownloadingReport,
  sanitizeTier,
} from './cache-report';

describe('sanitizeTier', () => {
  it('keeps two non-negative ints and nothing else', () => {
    expect(sanitizeTier({ count: 4.7, bytes: 100, floorBytes: 5 })).toEqual({
      count: 4,
      bytes: 100,
    });
    expect(sanitizeTier({ count: -1, bytes: Number.NaN })).toEqual({
      count: 0,
      bytes: 0,
    });
    expect(sanitizeTier({ count: '3', bytes: Infinity })).toEqual({
      count: 0,
      bytes: 0,
    });
  });

  it('is absent for anything that is not a tier object', () => {
    for (const junk of [undefined, null, 7, 'x', [1, 2]])
      expect(sanitizeTier(junk)).toBeUndefined();
  });
});

describe('sanitizeDownloadingReport', () => {
  it('keeps the four documented fields', () => {
    expect(
      sanitizeDownloadingReport({
        file: 'clip.mp4',
        bytesLoaded: 10.9,
        bytesTotal: 100.2,
        deferredCommit: true,
      }),
    ).toEqual({
      file: 'clip.mp4',
      bytesLoaded: 10,
      bytesTotal: 100,
      deferredCommit: true,
    });
  });

  it('needs a usable byte count — without one there is no progress to store', () => {
    for (const bytesLoaded of [
      undefined,
      null,
      -1,
      Number.NaN,
      Infinity,
      '10',
    ]) {
      expect(
        sanitizeDownloadingReport({
          file: 'a.mp4',
          bytesLoaded,
          bytesTotal: 100,
        }),
      ).toBeNull();
    }
    for (const junk of [undefined, null, 'downloading', 3, [1]]) {
      expect(sanitizeDownloadingReport(junk)).toBeNull();
    }
  });

  it('an unknown or zero size is null, never 0 — the dashboard must not divide by it', () => {
    for (const bytesTotal of [undefined, null, 0, -5, 'big']) {
      expect(
        sanitizeDownloadingReport({ file: 'a.mp4', bytesLoaded: 7, bytesTotal })
          ?.bytesTotal,
      ).toBeNull();
    }
  });

  it('never stores more bytes than the file has', () => {
    expect(
      sanitizeDownloadingReport({
        file: 'a',
        bytesLoaded: 500,
        bytesTotal: 100,
      })?.bytesLoaded,
    ).toBe(100);
    // …but with no size there is nothing to clamp against.
    expect(
      sanitizeDownloadingReport({ file: 'a', bytesLoaded: 500 })?.bytesLoaded,
    ).toBe(500);
  });

  it('the file name is data an operator reads: control characters stripped, trimmed, capped', () => {
    const long = 'x'.repeat(DOWNLOAD_FILE_MAX_CHARS + 50);
    expect(
      sanitizeDownloadingReport({ file: long, bytesLoaded: 1 })?.file,
    ).toHaveLength(DOWNLOAD_FILE_MAX_CHARS);
    expect(
      sanitizeDownloadingReport({
        file: '  \u0000clip\u0085.mp4\n ',
        bytesLoaded: 1,
      })?.file,
    ).toBe('clip.mp4');
    // A missing or non-string name keeps the progress, with no name.
    expect(sanitizeDownloadingReport({ file: 42, bytesLoaded: 1 })?.file).toBe(
      '',
    );
    expect(sanitizeDownloadingReport({ bytesLoaded: 1 })?.file).toBe('');
  });

  it('holds the previous content only on an explicit true', () => {
    for (const deferredCommit of [undefined, false, 'true', 1]) {
      expect(
        sanitizeDownloadingReport({ file: 'a', bytesLoaded: 1, deferredCommit })
          ?.deferredCommit,
      ).toBe(false);
    }
  });
});

describe('sanitizeCacheReport', () => {
  it('a report with no download serializes byte-for-byte as before (the write debounce keys on it)', () => {
    const tiers = {
      playlist: { count: 2, bytes: 10 },
      emergency: { count: 1, bytes: 5 },
    };
    expect(JSON.stringify(sanitizeCacheReport(tiers))).toBe(
      JSON.stringify(tiers),
    );
    expect(
      JSON.stringify(
        sanitizeCacheReport({ playlist: { count: 2, bytes: 10 } }),
      ),
    ).toBe(JSON.stringify({ playlist: { count: 2, bytes: 10 } }));
  });

  it('drops every key it does not know — the legacy route used to store the body as sent', () => {
    const out = sanitizeCacheReport({
      playlist: { count: 1, bytes: 2 },
      emergency: { count: 3, bytes: 4, floorBytes: 9 },
      shell: { count: 5, bytes: 6 },
      injected: '<script>',
    });
    expect(out).toEqual({
      playlist: { count: 1, bytes: 2 },
      emergency: { count: 3, bytes: 4 },
    });
    expect(Object.keys(JSON.parse(JSON.stringify(out))).sort()).toEqual([
      'emergency',
      'playlist',
    ]);
  });

  it('carries a valid download snapshot and drops an invalid one', () => {
    expect(
      sanitizeCacheReport({
        downloading: { file: 'a.mp4', bytesLoaded: 5, bytesTotal: 10 },
      }).downloading,
    ).toEqual({
      file: 'a.mp4',
      bytesLoaded: 5,
      bytesTotal: 10,
      deferredCommit: false,
    });
    expect(
      sanitizeCacheReport({ downloading: { file: 'a.mp4' } }),
    ).not.toHaveProperty('downloading');
  });

  it('a body that is not an object stores an empty report, never the raw value', () => {
    for (const junk of [undefined, null, 'x', 42, [1, 2]]) {
      expect(JSON.stringify(sanitizeCacheReport(junk))).toBe('{}');
    }
  });
});
