import {
  CONNECT_PATHS,
  CONNECT_PATH_STORAGE_KEY,
  DEFAULT_CONNECT_PATH,
  apkDownloadUrl,
  connectPathMeta,
  normalizeConnectPath,
  pairFromPhoneUrl,
  shouldStartCollapsed,
} from '../connectPaths';

describe('connectPaths — path catalog', () => {
  it('offers exactly the three real install shapes', () => {
    expect(CONNECT_PATHS.map((p) => p.id)).toEqual(['android', 'media-player', 'browser']);
  });

  it('puts Android first and browser LAST — the whole point of the rebuild', () => {
    // Operator: they "need to install an APK on their screen, or attach a
    // media player 9 times out of 10". The browser flow used to be the only
    // flow; if it ever floats back to the top this test fails.
    expect(CONNECT_PATHS[0].id).toBe('android');
    expect(CONNECT_PATHS[CONNECT_PATHS.length - 1].id).toBe('browser');
  });

  it('badges only the Android path as most common', () => {
    const badged = CONNECT_PATHS.filter((p) => p.badge);
    expect(badged).toHaveLength(1);
    expect(badged[0].id).toBe('android');
    expect(badged[0].badge).toBe('Most common');
  });

  it('gives every path its OWN step-set — the media player is not a second APK flow', () => {
    // This replaced a `usesApk: boolean` that was true for BOTH Android
    // paths, which is precisely how "Attached media player" ended up
    // rendering the sideload steps verbatim. Operator, 2026-08-25:
    // "install apk should not be the same as media player ... media player
    // should be instructions on how to plugin a venue os media player to
    // their existing screen".
    expect(connectPathMeta('android').steps).toBe('apk-sideload');
    expect(connectPathMeta('media-player').steps).toBe('media-player');
    expect(connectPathMeta('browser').steps).toBe('browser-url');
  });

  it('never lets two paths share a step-set (the clone regression, as a gate)', () => {
    const sets = CONNECT_PATHS.map((p) => p.steps);
    expect(new Set(sets).size).toBe(sets.length);
  });

  it('describes the media-player tile as a player cabled to a display they own', () => {
    // The old hint sold it as "An Android stick or box plugged into any
    // TV's HDMI port" — indistinguishable from the Android tile, which is
    // half of why the two flows read as one.
    expect(connectPathMeta('media-player').hint).toMatch(/display you already own/);
    expect(connectPathMeta('media-player').hint).not.toMatch(/sideload/i);
  });

  it('falls back to the first path for an unknown id rather than returning undefined', () => {
    expect(connectPathMeta('nope' as never).id).toBe('android');
  });
});

describe('normalizeConnectPath', () => {
  it('accepts every real id', () => {
    expect(normalizeConnectPath('android')).toBe('android');
    expect(normalizeConnectPath('media-player')).toBe('media-player');
    expect(normalizeConnectPath('browser')).toBe('browser');
  });

  it('tolerates whitespace and case from a hand-edited localStorage value', () => {
    expect(normalizeConnectPath('  BROWSER ')).toBe('browser');
    expect(normalizeConnectPath('Media-Player')).toBe('media-player');
  });

  it('defaults to Android for null / undefined / junk / wrong types', () => {
    // `localStorage.getItem` returns null on a first visit — the common case.
    expect(normalizeConnectPath(null)).toBe(DEFAULT_CONNECT_PATH);
    expect(normalizeConnectPath(undefined)).toBe('android');
    expect(normalizeConnectPath('')).toBe('android');
    expect(normalizeConnectPath('tv-stick')).toBe('android');
    expect(normalizeConnectPath(42)).toBe('android');
    expect(normalizeConnectPath({ id: 'browser' })).toBe('android');
  });

  it('pins the storage key so a rename never silently forgets everyone’s choice', () => {
    expect(CONNECT_PATH_STORAGE_KEY).toBe('venueos.connectPath');
  });
});

describe('apkDownloadUrl', () => {
  // The value baked into the production bundle (NEXT_PUBLIC_API_URL).
  const PROD_BASE = 'https://api-production-39a1.up.railway.app/api/v1';

  it('builds the live OTA endpoint from the production API base', () => {
    expect(apkDownloadUrl(PROD_BASE)).toBe(
      'https://api-production-39a1.up.railway.app/api/v1/player/apk/latest',
    );
  });

  it('matches the path the settings page already links to', () => {
    // apps/web/src/app/[schoolId]/settings/page.tsx builds
    // `${API_URL}/player/apk/latest`. Same string, so the QR here and that
    // button can never drift.
    expect(apkDownloadUrl(PROD_BASE)).toBe(`${PROD_BASE}/player/apk/latest`);
  });

  it('does not double up the slash when the base has a trailing one', () => {
    expect(apkDownloadUrl('https://example.test/api/v1/')).toBe(
      'https://example.test/api/v1/player/apk/latest',
    );
    expect(apkDownloadUrl('https://example.test/api/v1///')).toBe(
      'https://example.test/api/v1/player/apk/latest',
    );
  });

  it('handles the local-dev fallback base', () => {
    expect(apkDownloadUrl('http://localhost:8080/api/v1')).toBe(
      'http://localhost:8080/api/v1/player/apk/latest',
    );
  });

  it('returns empty for an unusable base so we never encode a broken QR', () => {
    expect(apkDownloadUrl('')).toBe('');
    expect(apkDownloadUrl('   ')).toBe('');
    expect(apkDownloadUrl(null)).toBe('');
    expect(apkDownloadUrl(undefined)).toBe('');
  });
});

describe('pairFromPhoneUrl', () => {
  it('points at the existing phone scanner route', () => {
    expect(pairFromPhoneUrl('https://venue-os.app')).toBe('https://venue-os.app/pair');
  });

  it('strips a trailing slash', () => {
    expect(pairFromPhoneUrl('https://venue-os.app/')).toBe('https://venue-os.app/pair');
  });

  it('degrades to a relative path when there is no origin (SSR)', () => {
    expect(pairFromPhoneUrl('')).toBe('/pair');
    expect(pairFromPhoneUrl(null)).toBe('/pair');
  });
});

describe('shouldStartCollapsed', () => {
  it('stays open for a fleet with nothing paired yet', () => {
    expect(shouldStartCollapsed(0)).toBe(false);
  });

  it('collapses the moment any screen is paired', () => {
    expect(shouldStartCollapsed(1)).toBe(true);
    expect(shouldStartCollapsed(3)).toBe(true);
    expect(shouldStartCollapsed(4200)).toBe(true);
  });

  it('treats loading / missing / nonsense counts as "not onboarded yet"', () => {
    expect(shouldStartCollapsed(undefined)).toBe(false);
    expect(shouldStartCollapsed(null)).toBe(false);
    expect(shouldStartCollapsed(NaN)).toBe(false);
    expect(shouldStartCollapsed(-1)).toBe(false);
  });
});
