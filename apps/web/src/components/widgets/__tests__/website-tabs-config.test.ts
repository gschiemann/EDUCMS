/**
 * Website Tabs — the pure half (2026-09-28).
 *
 * The widget, the editor and the native payload all read the SAME functions
 * here, so these pin the contract once: a hand-edited zone never blanks a
 * kiosk (bad tabs dropped, bad numbers defaulted), the allowlist handed to the
 * APK is exactly the tabs' sites and their subdomains (default deny), the
 * idle plan warns before it returns, and the glass copy exists in all three
 * languages.
 */
import {
  WEBSITE_TABS_MAX,
  allowHostsFor,
  buildHidePayload,
  buildShowPayload,
  fillCopy,
  idlePlanFor,
  isUrlWithinTabs,
  normalizeTabUrl,
  normalizeWebsiteTabsConfig,
  tabHost,
  tabInitials,
  toNativeBounds,
  viewerCopyFor,
} from '../website-tabs-config';

describe('normalizeTabUrl', () => {
  it('prefixes a bare domain and keeps http(s)', () => {
    expect(normalizeTabUrl('district.example')).toBe('https://district.example/');
    expect(normalizeTabUrl('  district.example/lunch ')).toBe('https://district.example/lunch');
    expect(normalizeTabUrl('http://intranet.example/x')).toBe('http://intranet.example/x');
  });

  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'intent://scan/#Intent;end', 'https://a.b/\nx', '', 42])(
    'refuses %p',
    (raw) => {
      expect(normalizeTabUrl(raw as never)).toBeNull();
    },
  );
});

describe('normalizeWebsiteTabsConfig — a hand-edited zone never blanks a kiosk', () => {
  it('applies the defaults to an empty config', () => {
    const c = normalizeWebsiteTabsConfig({});
    expect(c).toMatchObject({ tabs: [], barPosition: 'top', showHome: true, idleReturnSec: 120, idleWarnSec: 10, incognito: true });
  });

  it('drops tabs without a usable URL, names the rest by host, assigns ids, caps the count', () => {
    const c = normalizeWebsiteTabsConfig({
      tabs: [
        { url: 'https://www.district.example/portal' },
        { name: 'Bad', url: 'javascript:alert(1)' },
        { id: 'k', name: 'Lunch', url: 'lunch.example', embed: 'ok', signIn: 'once', iconUrl: 'data:image/png;base64,AAAA' },
        'garbage',
        null,
      ],
    });
    expect(c.tabs).toHaveLength(2);
    expect(c.tabs[0]).toMatchObject({ name: 'district.example', url: 'https://www.district.example/portal', embed: 'unknown', signIn: 'none' });
    expect(c.tabs[0].id).toBeTruthy();
    expect(c.tabs[1]).toMatchObject({ id: 'k', name: 'Lunch', url: 'https://lunch.example/', embed: 'ok', signIn: 'once' });
    expect(c.tabs[1].iconUrl).toBeUndefined(); // a data: icon is not an icon
    const many = normalizeWebsiteTabsConfig({ tabs: Array.from({ length: 20 }, (_, i) => ({ url: `https://s${i}.example` })) });
    expect(many.tabs).toHaveLength(WEBSITE_TABS_MAX);
  });

  it('de-duplicates colliding ids so React keys stay unique', () => {
    const c = normalizeWebsiteTabsConfig({ tabs: [{ id: 'same', url: 'https://a.example' }, { id: 'same', url: 'https://b.example' }] });
    expect(new Set(c.tabs.map((t) => t.id)).size).toBe(2);
  });

  it('clamps the idle numbers and never lets the warning outlast the idle window', () => {
    expect(normalizeWebsiteTabsConfig({ idleReturnSec: 'nope', idleWarnSec: -4 }).idleReturnSec).toBe(120);
    expect(normalizeWebsiteTabsConfig({ idleReturnSec: 30, idleWarnSec: 90 }).idleWarnSec).toBe(29);
    expect(normalizeWebsiteTabsConfig({ idleReturnSec: 0 })).toMatchObject({ idleReturnSec: 0 });
    expect(normalizeWebsiteTabsConfig({ barPosition: 'left' }).barPosition).toBe('top');
    expect(normalizeWebsiteTabsConfig({ incognito: false, showHome: false })).toMatchObject({ incognito: false, showHome: false });
  });
});

describe('the host allowlist — default deny, the tabs and their subdomains', () => {
  const tabs = [{ url: 'https://www.district.example/portal' }, { url: 'https://lunch.example/menu' }, { url: 'https://district.example/other' }];

  it('is the de-duplicated set of tab hosts with www. stripped', () => {
    expect(allowHostsFor(tabs)).toEqual(['district.example', 'lunch.example']);
  });

  it('allows the tab hosts, www., and dot-boundary subdomains only', () => {
    const allow = allowHostsFor(tabs);
    expect(isUrlWithinTabs('https://district.example/anything', allow)).toBe(true);
    expect(isUrlWithinTabs('https://www.district.example/x', allow)).toBe(true);
    expect(isUrlWithinTabs('https://portal.district.example/x', allow)).toBe(true);
    expect(isUrlWithinTabs('http://lunch.example/', allow)).toBe(true);
    expect(isUrlWithinTabs('https://evil.example/', allow)).toBe(false);
    expect(isUrlWithinTabs('https://district.example.evil.com/', allow)).toBe(false);
    expect(isUrlWithinTabs('https://notdistrict.example/', allow)).toBe(false);
    expect(isUrlWithinTabs('javascript:alert(1)', allow)).toBe(false);
    expect(isUrlWithinTabs('intent://district.example/#Intent;end', allow)).toBe(false);
    expect(isUrlWithinTabs('file:///sdcard/x', allow)).toBe(false);
  });

  it('an empty allowlist admits nothing', () => {
    expect(isUrlWithinTabs('https://district.example/', [])).toBe(false);
  });
});

describe('helpers', () => {
  it('tabHost strips www., tabInitials takes two words', () => {
    expect(tabHost('https://www.district.example/x')).toBe('district.example');
    expect(tabInitials('Lunch Menu')).toBe('LM');
    expect(tabInitials('wikipedia')).toBe('W');
    expect(tabInitials('')).toBe('•');
  });

  it('fillCopy substitutes {n}', () => {
    expect(fillCopy('Back in {n} s', { n: 7 })).toBe('Back in 7 s');
  });
});

describe('the idle plan', () => {
  it('warns 10 s before a 120 s return by default', () => {
    expect(idlePlanFor({ idleReturnSec: 120, idleWarnSec: 10 })).toEqual({ warnAfterMs: 110_000, returnAfterMs: 120_000 });
  });

  it('is off when idle return is 0', () => {
    expect(idlePlanFor({ idleReturnSec: 0, idleWarnSec: 10 })).toBeNull();
  });

  it('never warns before the clock starts', () => {
    expect(idlePlanFor({ idleReturnSec: 5, idleWarnSec: 60 })).toEqual({ warnAfterMs: 1_000, returnAfterMs: 5_000 });
  });
});

describe('viewer copy — every string in en / es / zh', () => {
  it('picks the language by tag and falls back to English', () => {
    expect(viewerCopyFor('es-MX').home).toBe('Inicio');
    expect(viewerCopyFor('zh-Hant').home).toBe('首页');
    expect(viewerCopyFor('fr').home).toBe('Home');
    expect(viewerCopyFor(null).home).toBe('Home');
  });

  it('has the same keys, non-empty, in all three languages', () => {
    const en = viewerCopyFor('en') as unknown as Record<string, string>;
    for (const lang of ['es', 'zh']) {
      const other = viewerCopyFor(lang) as unknown as Record<string, string>;
      expect(Object.keys(other).sort()).toEqual(Object.keys(en).sort());
      for (const k of Object.keys(en)) {
        expect(other[k].length).toBeGreaterThan(0);
        // ICU-ish placeholders must survive translation.
        expect(other[k].includes('{n}')).toBe(en[k].includes('{n}'));
      }
    }
  });
});

describe('the native contract', () => {
  it('scales CSS px to device px without a seam between left+width and right', () => {
    expect(toNativeBounds({ left: 0, top: 40.4, width: 720, height: 1239.6 }, 3)).toEqual({ left: 0, top: 121, width: 2160, height: 3719 });
    expect(toNativeBounds({ left: 10, top: 10, width: 100, height: 50 }, 1)).toEqual({ left: 10, top: 10, width: 100, height: 50 });
    // A nonsense DPR is treated as 1, never as 0 (which would zero the view).
    expect(toNativeBounds({ left: 1, top: 1, width: 10, height: 10 }, 0)).toEqual({ left: 1, top: 1, width: 10, height: 10 });
  });

  it('builds a versioned show payload with the allowlist and localised blocked-page copy', () => {
    const p = buildShowPayload({
      url: 'https://www.district.example/portal',
      bounds: { left: 0, top: 200, width: 1920, height: 880 },
      tabs: [{ url: 'https://www.district.example/portal' }, { url: 'https://lunch.example' }],
      incognito: true,
      sessionKey: 'wt-1',
      focus: false,
      copy: viewerCopyFor('es'),
    });
    expect(p).toMatchObject({
      v: 1,
      url: 'https://www.district.example/portal',
      allowHosts: ['district.example', 'lunch.example'],
      incognito: true,
      sessionKey: 'wt-1',
      focus: false,
    });
    expect(p.copy.title).toBe('Este quiosco solo muestra estos sitios');
    expect(p.copy.back).toBe('Atrás');
    expect(JSON.parse(JSON.stringify(p))).toEqual(p); // plain JSON, no functions
  });

  it('builds the hide payload', () => {
    expect(buildHidePayload(true)).toEqual({ v: 1, wipe: true });
    expect(buildHidePayload(false)).toEqual({ v: 1, wipe: false });
  });
});
