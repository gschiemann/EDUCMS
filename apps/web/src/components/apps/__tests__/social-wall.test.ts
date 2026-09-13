/**
 * Social Wall — the app that stopped being a stub (2026-09-12).
 *
 * It shipped as `comingSoon: true` with an EMPTY schema and an empty
 * `SOCIAL_FEED` build, i.e. a tile that said "Phase 2" forever. But a
 * moderated multi-network wall is a PRODUCT operators already buy, and
 * putting a bought wall on a screen is an ordinary WEBPAGE zone — so the
 * honest version of this app is a link field, not a promise.
 *
 * What these tests pin, in the order the defects would reappear:
 *
 *   1. Every vendor URL shape an operator would actually paste — including
 *      the whole embed snippet, which is what people copy — reaches the
 *      right embed URL. Verified against each vendor's own docs; the URLs
 *      are quoted in `url-transforms.toSocialWallEmbedUrl`.
 *   2. Everything else is REFUSED, not passed through. Every other transform
 *      in url-transforms.ts is deliberately forgiving; this one must not be,
 *      because a non-wall URL framed by the Social Wall app is a zone that
 *      silently isn't a wall.
 *   3. The refusals go through the REAL gate (`buildApp`), so the operator
 *      gets the sentence and the canvas gets nothing — the M6-1 contract.
 */
import { toSocialWallEmbedUrl, isSocialWallEmbedUrl } from '../url-transforms';
import { isSocialWallHost, scriptOnlyWallReason } from '../social-wall-hosts';
import { buildApp } from '../build-app';
import { APP_REGISTRY, getApp, listApps, type AppDefinition } from '../app-registry';

function app(id: string): AppDefinition {
  const found = getApp(id);
  if (!found) throw new Error(`registry has no app "${id}"`);
  return found;
}

// ── 1. Accepted shapes ────────────────────────────────────────────────────
describe('toSocialWallEmbedUrl — the links an operator actually pastes', () => {
  it.each([
    // ── Walls.io: the wall URL IS the embed URL.
    [
      'Walls.io wall URL',
      'https://my.walls.io/venueos',
      'https://my.walls.io/venueos',
    ],
    [
      'Walls.io wall URL with its display params',
      'https://my.walls.io/venueos?nobackground=1&show_header=0&layout=kiosk',
      'https://my.walls.io/venueos?nobackground=1&show_header=0&layout=kiosk',
    ],
    [
      'Walls.io whole iframe snippet (with HTML-escaped ampersands)',
      '<iframe allowfullscreen id="wallsio-iframe" src="https://my.walls.io/venueos?nobackground=1&amp;show_header=0" style="border:0;height:800px;width:100%" loading="lazy"></iframe>',
      'https://my.walls.io/venueos?nobackground=1&show_header=0',
    ],

    // ── Juicer: four inputs, one canonical output.
    [
      'Juicer iframe endpoint, already canonical',
      'https://www.juicer.io/api/feeds/venueos/iframe',
      'https://www.juicer.io/api/feeds/venueos/iframe',
    ],
    [
      'Juicer iframe endpoint keeps its tuning params',
      'https://www.juicer.io/api/feeds/venueos/iframe?per=1',
      'https://www.juicer.io/api/feeds/venueos/iframe?per=1',
    ],
    [
      'Juicer whole iframe snippet (single-quoted, as their docs print it)',
      "<iframe src='https://www.juicer.io/api/feeds/venueos/iframe' frameborder='0' width='1000' height='1000'></iframe>",
      'https://www.juicer.io/api/feeds/venueos/iframe',
    ],
    [
      'Juicer script snippet — the OTHER thing their embed screen hands you',
      '<script type="text/javascript" src="https://www.juicer.io/embed/venueos/embed-code.js" async defer></script>',
      'https://www.juicer.io/api/feeds/venueos/iframe',
    ],
    [
      'Juicer feed page an operator copies from the address bar',
      'https://www.juicer.io/venueos',
      'https://www.juicer.io/api/feeds/venueos/iframe',
    ],
    [
      'Juicer /feeds/<name> form',
      'https://www.juicer.io/feeds/venueos',
      'https://www.juicer.io/api/feeds/venueos/iframe',
    ],

    // ── Taggbox.
    [
      'Taggbox widget embed URL',
      'https://app.taggbox.com/widget/e/2mF4kq',
      'https://app.taggbox.com/widget/e/2mF4kq',
    ],
    [
      'Taggbox whole iframe snippet',
      '<iframe src="https://app.taggbox.com/widget/e/2mF4kq" style="width:100%;height:650px" frameborder="0" allowtransparency="true"></iframe>',
      'https://app.taggbox.com/widget/e/2mF4kq',
    ],

    // Whitespace from a sloppy copy is not a broken link.
    ['padded paste', '  https://my.walls.io/venueos  ', 'https://my.walls.io/venueos'],
  ])('%s', (_label, input, expected) => {
    expect(toSocialWallEmbedUrl(input)).toBe(expected);
  });

  it('is idempotent — running it on its own output changes nothing', () => {
    // This is exactly what `expects.recognises` relies on, so it is not a
    // nice-to-have: if a branch ever normalises on the second pass, the app
    // would refuse the config it had just built.
    for (const input of [
      'https://my.walls.io/venueos?layout=kiosk',
      'https://www.juicer.io/venueos',
      'https://app.taggbox.com/widget/e/2mF4kq',
    ]) {
      const once = toSocialWallEmbedUrl(input);
      expect(once).not.toBeNull();
      expect(toSocialWallEmbedUrl(once!)).toBe(once);
      expect(isSocialWallEmbedUrl(once!)).toBe(true);
    }
  });
});

// ── 2. Refusals ───────────────────────────────────────────────────────────
describe('toSocialWallEmbedUrl — refuses everything it does not recognise', () => {
  it.each([
    // The brief's named cases first.
    ['a Curator.io wall (script-only embed)', 'https://curator.io/feed/venueos'],
    ['a Curator.io script snippet', '<script src="https://cdn.curator.io/published/abc123.js"></script>'],
    ['a random site', 'https://example.com/our-instagram'],
    ['an http: wall link', 'http://my.walls.io/venueos'],
    ['a lookalike host on another TLD', 'https://my.walls.io.evil.com/venueos'],
    ['a lookalike Juicer host', 'https://juicer.io.evil.com/venueos'],
    ['a prefix-lookalike', 'https://notjuicer.io/venueos'],

    // Same vendor, wrong page — a marketing URL is not a wall.
    ['the Walls.io marketing site', 'https://walls.io/pricing'],
    ['the Walls.io app root with no wall', 'https://my.walls.io/'],
    ['a Juicer marketing page', 'https://www.juicer.io/pricing'],
    ['a Juicer help article', 'https://help.juicer.io/en/articles/12702153-embed'],
    ['the Taggbox marketing site', 'https://taggbox.com/widget/'],
    // Verified live 2026-09-12: widget.taggbox.com 301s to taggbox.com, so a
    // URL of this shape frames a marketing redirect, not a widget.
    ['the non-embed taggbox subdomain', 'https://widget.taggbox.com/2mF4kq'],
    ['a Taggbox path that is not the widget embed', 'https://app.taggbox.com/dashboard/2mF4kq'],

    // Not URLs at all.
    ['a sentence', 'our social wall'],
    ['empty', ''],
    ['whitespace', '   '],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a bare wall name with no host', 'venueos'],
  ])('%s', (_label, input) => {
    expect(toSocialWallEmbedUrl(input)).toBeNull();
    expect(isSocialWallEmbedUrl(input)).toBe(false);
  });
});

describe('the host allowlist', () => {
  it('matches exact hosts and real subdomains, never a suffix lookalike', () => {
    expect(isSocialWallHost('my.walls.io')).toBe(true);
    expect(isSocialWallHost('www.juicer.io')).toBe(true);
    expect(isSocialWallHost('app.taggbox.com')).toBe(true);
    expect(isSocialWallHost('my.walls.io.evil.com')).toBe(false);
    expect(isSocialWallHost('walls.io')).toBe(false);
    expect(isSocialWallHost('notjuicer.io')).toBe(false);
    expect(isSocialWallHost('')).toBe(false);
  });
});

describe('scriptOnlyWallReason — a better sentence for a wall we cannot frame', () => {
  it('names Curator.io and says what to do instead', () => {
    const reason = scriptOnlyWallReason('https://curator.io/feed/venueos');
    expect(reason).toMatch(/Curator\.io only offers a script embed/);
    expect(reason).toMatch(/Walls\.io\/Juicer\/Taggbox/);
  });

  it('is silent for a lookalike host — that gets the ordinary refusal', () => {
    expect(scriptOnlyWallReason('https://curator.io.evil.com/x')).toBeNull();
    expect(scriptOnlyWallReason('https://my.walls.io/venueos')).toBeNull();
    expect(scriptOnlyWallReason('')).toBeNull();
  });
});

// ── 3. Through the real gate ──────────────────────────────────────────────
describe('buildApp(social-wall) — the outcome an operator actually gets', () => {
  it('builds an interactive WEBPAGE zone from a Walls.io link', () => {
    const out = buildApp(app('social-wall'), { url: 'https://my.walls.io/venueos' });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('unreachable');
    expect(out.widgetType).toBe('WEBPAGE');
    expect(out.defaultConfig).toEqual({
      url: 'https://my.walls.io/venueos',
      // A wall is a live JS app: the strip-scripts static path would freeze
      // it on whatever posts loaded first.
      staticMode: false,
      // `refreshIntervalMs` is the key WidgetRenderer's WebpageWidget reads
      // (`const refreshInterval = config.refreshIntervalMs || 0`).
      // `refreshMinutes` is a FORM-FIELD key in the Web Page app, converted
      // by its build() — writing that name here would be a silent no-op.
      refreshIntervalMs: 900_000,
    });
    expect(out.defaultConfig).not.toHaveProperty('refreshMinutes');
  });

  it('accepts a pasted Juicer snippet end-to-end', () => {
    const out = buildApp(app('social-wall'), {
      url: "<iframe src='https://www.juicer.io/api/feeds/venueos/iframe' frameborder='0'></iframe>",
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('unreachable');
    expect(out.defaultConfig.url).toBe('https://www.juicer.io/api/feeds/venueos/iframe');
  });

  it('refuses Curator.io with the reason that tells them what to do', () => {
    const out = buildApp(app('social-wall'), { url: 'https://curator.io/feed/venueos' });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.code).toBe('invalid');
    expect(out.reason).toMatch(/Curator\.io only offers a script embed, which screens can’t run/);
    expect(out.reason).toMatch(/Walls\.io\/Juicer\/Taggbox/);
  });

  it('refuses a non-wall link in the app’s own words', () => {
    const out = buildApp(app('social-wall'), { url: 'https://example.com/our-instagram' });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.code).toBe('invalid');
    expect(out.reason).toMatch(/doesn’t look like a Walls\.io, Juicer or Taggbox wall link/i);
  });

  it('treats a blank field as an unfinished form, not a broken link', () => {
    const out = buildApp(app('social-wall'), { url: '' });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.code).toBe('missing');
  });

  it('is no longer coming-soon, and its tile says what you need first', () => {
    const wall = app('social-wall');
    expect(wall.comingSoon).toBeUndefined();
    expect(wall.frictionTier).toBe('aggregator');
    expect(wall.blurb).toMatch(/Walls\.io, Juicer or Taggbox/);
    // The friction is real and must be stated on the tile: this app is only
    // useful to someone who already has a wall.
    expect(wall.blurb).toMatch(/you need a wall with one of those services first/i);
    expect(wall.configSchema.map((f) => f.key)).toEqual(['url']);
    expect(wall.configSchema[0].required).toBe(true);
    expect(wall.configSchema[0].help).toMatch(/Walls\.io/);
    expect(wall.configSchema[0].help).toMatch(/Juicer/);
    expect(wall.configSchema[0].help).toMatch(/Taggbox/);
  });
});

// ── 4. listApps({ includeComingSoon: false }) ─────────────────────────────
describe('listApps — the includeComingSoon flag that used to do nothing', () => {
  it('hides coming-soon apps when explicitly told to', () => {
    const visible = listApps({ includeComingSoon: false });
    expect(visible.some((a) => a.comingSoon)).toBe(false);
    expect(visible.map((a) => a.id)).toEqual(
      APP_REGISTRY.filter((a) => !a.comingSoon).map((a) => a.id),
    );
  });

  it('still SHOWS them by default — discoverability is the default, honesty is the badge', () => {
    expect(listApps().map((a) => a.id)).toEqual(APP_REGISTRY.map((a) => a.id));
    expect(listApps({ includeComingSoon: true }).map((a) => a.id)).toEqual(APP_REGISTRY.map((a) => a.id));
    // Passing an unrelated option must not start filtering.
    expect(listApps({ category: 'social' }).map((a) => a.id))
      .toEqual(APP_REGISTRY.filter((a) => a.category === 'social').map((a) => a.id));
  });

  it('removes exactly the coming-soon apps and nothing else', () => {
    // Deliberately arithmetic rather than `expect(some(comingSoon)).toBe(true)`:
    // this wave is replacing the stubs one by one, and a test that REQUIRES a
    // stub to exist would fail the day the last one ships. This form stays
    // true either way, and is still non-vacuous while any stub remains.
    const stubs = APP_REGISTRY.filter((a) => a.comingSoon);
    const visible = listApps({ includeComingSoon: false });
    expect(visible).toHaveLength(APP_REGISTRY.length - stubs.length);
    for (const s of stubs) expect(visible.map((v) => v.id)).not.toContain(s.id);
  });

  it('composes with the other filters instead of overriding them', () => {
    const social = listApps({ category: 'social', includeComingSoon: false });
    expect(social.every((a) => a.category === 'social' && !a.comingSoon)).toBe(true);
    expect(social.map((a) => a.id)).toContain('social-wall');
  });
});
