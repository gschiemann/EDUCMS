/**
 * Website Tabs — the pure half (2026-09-28).
 *
 * Greg: "customers want to push multiple sites and give tabs to flip thru but
 * still lock those sites on the screen … make it dumb simple." Everything the
 * widget DECIDES lives here, free of React and the DOM, so it is unit-tested
 * in isolation and shared byte-for-byte by the builder editor, the player
 * widget and the payload the native WebView receives:
 *
 *   • the config shape + tolerant normalisation (a hand-edited JSON zone must
 *     never blank a kiosk — a bad tab is dropped, a bad number is defaulted);
 *   • the host allowlist derived from the tabs (the native WebView's
 *     default-deny navigation policy is built from THIS and nothing else);
 *   • the viewer copy in en / es / zh (the glass has no next-intl provider,
 *     so widgets carry their own label tables — same pattern as the menu
 *     boards' GLASS_LABELS);
 *   • the idle plan (warn at T-10 s, return at T);
 *   • the exact JSON handed to `webTabsShow` / `webTabsHide`.
 *
 * ⚠️ Chromium-83 (NovaStar Taurus) is in the scan path for this directory:
 * nothing here touches CSS, but keep it that way — no DOM, no `inset`.
 */

export type TabEmbed = 'ok' | 'blocked' | 'unreachable' | 'unknown';
export type TabSignIn = 'none' | 'once';
export type BarPosition = 'top' | 'bottom';

export interface WebsiteTab {
  /** Stable per-tab id — the React key and the native session key suffix. */
  id: string;
  name: string;
  url: string;
  iconUrl?: string;
  /** Last site-check verdict; `unknown` until the panel has checked it. */
  embed?: TabEmbed;
  /** `once` keeps the site's cookies across idle resets; `none` (default) does not. */
  signIn?: TabSignIn;
}

export interface WebsiteTabsConfig {
  tabs: WebsiteTab[];
  barPosition: BarPosition;
  showHome: boolean;
  /** Seconds of no activity before the screen returns to the first tab. 0 = never. */
  idleReturnSec: number;
  /** Seconds of "Still there?" warning before that return. */
  idleWarnSec: number;
  /** ON: sign out (wipe cookies + site storage) on every idle return. OFF: sites stay signed in. */
  incognito: boolean;
  /** Viewer language for the glass copy; unset = follow the document / device. */
  lang?: string;
  /** Tab-bar colours. Unset = the tenant brand (`--brand-*` on the player). */
  barColor?: string;
  activeColor?: string;
  textColor?: string;
  /** The universal Text-style block writes these; the tab labels honour them. */
  fontFamily?: string;
  fontSize?: number;
  color?: string;
}

export const WEBSITE_TABS_DEFAULTS: Readonly<Omit<WebsiteTabsConfig, 'tabs'>> = Object.freeze({
  barPosition: 'top' as BarPosition,
  showHome: true,
  idleReturnSec: 120,
  idleWarnSec: 10,
  incognito: true,
});

/** Tabs beyond this are ignored: a tab bar has to stay finger-sized. */
export const WEBSITE_TABS_MAX = 12;

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * `example.com/menu` → `https://example.com/menu` (the same auto-prefix the
 * WEBPAGE widget and the API's site check apply). Returns null for anything
 * that is not http(s) once normalised — `javascript:`, `data:`, `file:`,
 * `intent:` never become a tab.
 */
export function normalizeTabUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > 2048) return null;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return null;
  }
  const withScheme = HAS_SCHEME.test(s) ? s : s.startsWith('//') ? `https:${s}` : `https://${s}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (!u.hostname) return null;
  return u.toString();
}

export function isHttpUrl(u: unknown): u is string {
  return typeof u === 'string' && /^https?:\/\//i.test(u) && normalizeTabUrl(u) !== null;
}

/** `https://www.district.example/portal` → `district.example`. */
export function tabHost(url: string): string | null {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return h || null;
  } catch {
    return null;
  }
}

/** Initials for a tab with no icon: "Lunch Menu" → "LM", "Wikipedia" → "W". */
export function tabInitials(name: string): string {
  const words = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '•';
  const letters = words.slice(0, 2).map((w) => w[0].toUpperCase());
  return letters.join('');
}

let seq = 0;
function freshId(): string {
  seq += 1;
  return `tab-${Date.now().toString(36)}-${seq}-${Math.random().toString(36).slice(2, 6)}`;
}

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function optionalString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * Tolerant normalisation of whatever sits in `defaultConfig`. Never throws;
 * a tab without a usable http(s) URL is dropped; every surviving tab has an
 * id and a name (the host, when the operator gave none).
 */
export function normalizeWebsiteTabsConfig(raw: unknown): WebsiteTabsConfig {
  const cfg = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawTabs = Array.isArray(cfg.tabs) ? cfg.tabs : [];
  const tabs: WebsiteTab[] = [];
  const seenIds = new Set<string>();
  for (const t of rawTabs) {
    if (!t || typeof t !== 'object') continue;
    const tab = t as Record<string, unknown>;
    const url = normalizeTabUrl(tab.url);
    if (!url) continue;
    let id = typeof tab.id === 'string' && tab.id.trim() ? tab.id.trim() : freshId();
    if (seenIds.has(id)) id = freshId();
    seenIds.add(id);
    const name = optionalString(tab.name) || tabHost(url) || url;
    const embedRaw = tab.embed;
    const embed: TabEmbed =
      embedRaw === 'ok' || embedRaw === 'blocked' || embedRaw === 'unreachable' ? embedRaw : 'unknown';
    const iconUrl = normalizeTabUrl(tab.iconUrl) ?? undefined;
    tabs.push({
      id,
      name: name.slice(0, 40),
      url,
      ...(iconUrl ? { iconUrl } : {}),
      embed,
      signIn: tab.signIn === 'once' ? 'once' : 'none',
    });
    if (tabs.length >= WEBSITE_TABS_MAX) break;
  }
  const idleReturnSec = clampInt(cfg.idleReturnSec, WEBSITE_TABS_DEFAULTS.idleReturnSec, 0, 24 * 3600);
  const idleWarnSec = clampInt(cfg.idleWarnSec, WEBSITE_TABS_DEFAULTS.idleWarnSec, 0, 120);
  return {
    tabs,
    barPosition: cfg.barPosition === 'bottom' ? 'bottom' : 'top',
    showHome: cfg.showHome === undefined ? WEBSITE_TABS_DEFAULTS.showHome : cfg.showHome !== false,
    idleReturnSec,
    // The warning can never be longer than the idle window it precedes.
    idleWarnSec: idleReturnSec > 0 ? Math.min(idleWarnSec, Math.max(0, idleReturnSec - 1)) : idleWarnSec,
    incognito: cfg.incognito === undefined ? WEBSITE_TABS_DEFAULTS.incognito : cfg.incognito !== false,
    lang: optionalString(cfg.lang),
    barColor: optionalString(cfg.barColor),
    activeColor: optionalString(cfg.activeColor),
    textColor: optionalString(cfg.textColor),
    fontFamily: optionalString(cfg.fontFamily),
    fontSize: typeof cfg.fontSize === 'number' && Number.isFinite(cfg.fontSize) ? cfg.fontSize : undefined,
    color: optionalString(cfg.color),
  };
}

/**
 * The hosts the kiosk may navigate to: every tab's host, de-duplicated,
 * lower-cased, `www.` stripped. The native WebView allows exactly these
 * hosts and their subdomains (dot-boundary), and NOTHING else — default deny.
 * `www.` is stripped so `www.district.example` and `district.example` are one
 * site; a subdomain match on the bare host covers both.
 */
export function allowHostsFor(tabs: ReadonlyArray<Pick<WebsiteTab, 'url'>>): string[] {
  const out: string[] = [];
  for (const t of tabs) {
    const h = tabHost(t.url);
    if (h && out.indexOf(h) === -1) out.push(h);
  }
  return out;
}

/**
 * Would this navigation stay inside the tabs' sites? Mirrors the Kotlin
 * `WebTabsPolicy.isAllowedNavigation` exactly (the APK is the enforcer on our
 * app; this is what the widget's own "This kiosk only shows these sites"
 * message and the tests reason about). Exact host or dot-boundary subdomain,
 * http(s) only — `district.example.evil.com` is refused.
 */
export function isUrlWithinTabs(url: string, allowHosts: ReadonlyArray<string>): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase();
  if (!host) return false;
  for (const allowed of allowHosts) {
    const a = allowed.toLowerCase();
    if (!a) continue;
    if (host === a || host === `www.${a}`) return true;
    if (host.endsWith(`.${a}`)) return true;
  }
  return false;
}

// ─── Viewer copy (the glass has no next-intl provider) ────────────────────

export interface ViewerCopy {
  home: string;
  stillThere: string;
  yesImHere: string;
  /** Uses `{n}` for the seconds left. */
  returningIn: string;
  blockedTitle: string;
  blockedBody: string;
  /** Our app, but a version without the native site view (older than 1.1.19). */
  updateTitle: string;
  updateBody: string;
  onlyTheseSitesTitle: string;
  onlyTheseSitesBody: string;
  backLabel: string;
  cantLoadTitle: string;
  cantLoadBody: string;
  loading: string;
  tabsLabel: string;
}

const COPY: Record<'en' | 'es' | 'zh', ViewerCopy> = {
  en: {
    home: 'Home',
    stillThere: 'Still there?',
    yesImHere: "Yes, I'm here",
    returningIn: 'Returning to the first site in {n} s',
    blockedTitle: 'This site can only be shown on screens running the VenueOS app',
    blockedBody: 'It does not allow being embedded in a web page. Install the VenueOS player app on this screen to show it.',
    updateTitle: 'This site needs the newest VenueOS app',
    updateBody: "This screen's app is out of date. Once it updates, this site shows here.",
    onlyTheseSitesTitle: 'This kiosk only shows these sites',
    onlyTheseSitesBody: 'Tap a tab to keep browsing.',
    backLabel: 'Back',
    cantLoadTitle: "Can't reach this site right now",
    cantLoadBody: "Check the screen's internet connection.",
    loading: 'Loading…',
    tabsLabel: 'Websites',
  },
  es: {
    home: 'Inicio',
    stillThere: '¿Sigue ahí?',
    yesImHere: 'Sí, aquí estoy',
    returningIn: 'Volviendo al primer sitio en {n} s',
    blockedTitle: 'Este sitio solo puede mostrarse en pantallas con la app VenueOS',
    blockedBody: 'No permite insertarse en una página web. Instale la app de reproducción VenueOS en esta pantalla para mostrarlo.',
    updateTitle: 'Este sitio necesita la versión más reciente de la app VenueOS',
    updateBody: 'La app de esta pantalla está desactualizada. Cuando se actualice, este sitio se mostrará aquí.',
    onlyTheseSitesTitle: 'Este quiosco solo muestra estos sitios',
    onlyTheseSitesBody: 'Toque una pestaña para seguir navegando.',
    backLabel: 'Atrás',
    cantLoadTitle: 'No se puede acceder a este sitio ahora',
    cantLoadBody: 'Compruebe la conexión a internet de la pantalla.',
    loading: 'Cargando…',
    tabsLabel: 'Sitios web',
  },
  zh: {
    home: '首页',
    stillThere: '还在吗？',
    yesImHere: '是的，我在',
    returningIn: '{n} 秒后返回第一个网站',
    blockedTitle: '此网站只能在运行 VenueOS 应用的屏幕上显示',
    blockedBody: '该网站不允许嵌入网页。请在此屏幕上安装 VenueOS 播放器应用以显示它。',
    updateTitle: '此网站需要最新版 VenueOS 应用',
    updateBody: '此屏幕上的应用版本过旧。更新后，此网站将在这里显示。',
    onlyTheseSitesTitle: '此信息亭只显示这些网站',
    onlyTheseSitesBody: '点击一个标签继续浏览。',
    backLabel: '返回',
    cantLoadTitle: '暂时无法访问此网站',
    cantLoadBody: '请检查屏幕的网络连接。',
    loading: '加载中…',
    tabsLabel: '网站',
  },
};

/** `es-MX` → Spanish copy, `zh-Hant` → Chinese, anything else → English. */
export function viewerCopyFor(lang?: string | null): ViewerCopy {
  const tag = String(lang || '')
    .trim()
    .toLowerCase();
  if (tag === 'es' || tag.startsWith('es-')) return COPY.es;
  if (tag === 'zh' || tag.startsWith('zh-')) return COPY.zh;
  return COPY.en;
}

export function fillCopy(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
}

// ─── Idle plan ─────────────────────────────────────────────────────────────

export interface IdlePlan {
  /** ms of inactivity after which the "Still there?" warning shows. */
  warnAfterMs: number;
  /** ms of inactivity after which the kiosk returns to the first tab. */
  returnAfterMs: number;
}

/** null when idle return is off (`idleReturnSec: 0`). */
export function idlePlanFor(cfg: Pick<WebsiteTabsConfig, 'idleReturnSec' | 'idleWarnSec'>): IdlePlan | null {
  if (!cfg.idleReturnSec || cfg.idleReturnSec <= 0) return null;
  const returnAfterMs = cfg.idleReturnSec * 1000;
  const warn = Math.max(0, Math.min(cfg.idleWarnSec, cfg.idleReturnSec - 1)) * 1000;
  return { warnAfterMs: returnAfterMs - warn, returnAfterMs };
}

// ─── The native contract ───────────────────────────────────────────────────

/** Device-pixel rectangle of the site area, as the APK lays the WebView out. */
export interface NativeBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The JSON `webTabsShow` carries. Versioned so the APK can refuse a shape it
 * does not understand instead of guessing. Mirrors `WebTabsPolicy.ShowRequest`.
 */
export interface WebTabsShowPayload {
  v: 1;
  url: string;
  bounds: NativeBounds;
  /** Default-deny allowlist — see `allowHostsFor`. */
  allowHosts: string[];
  /** ON → the APK wipes cookies + site storage on `webTabsHide({wipe:true})`. */
  incognito: boolean;
  /** Identifies the widget instance so a re-show of the same URL is a no-op. */
  sessionKey: string;
  /** Hand the overlay Android focus (a D-pad user pressed "into the site"). */
  focus: boolean;
  /**
   * Copy for the two pages the APK itself has to paint, localised on the web
   * side: the blocked-navigation page (`title`/`body`) and the cannot-load
   * page (`offlineTitle`/`offlineBody`), plus the shared Back label.
   */
  copy: { title: string; body: string; back: string; offlineTitle: string; offlineBody: string };
}

export interface WebTabsHidePayload {
  v: 1;
  /** Sign out: wipe cookies + site storage as the overlay comes down. */
  wipe: boolean;
}

/**
 * The panel's physical size as the APK put it on the player URL (`w`, `h`
 * — `getRealDisplaySize()`, physical pixels). Null when absent or junk.
 */
export function physicalSizeFromQuery(search: string | null | undefined): { w: number; h: number } | null {
  try {
    const p = new URLSearchParams(search || '');
    const w = parseInt(p.get('w') || '', 10);
    const h = parseInt(p.get('h') || '', 10);
    if (!(w > 0) || !(h > 0) || w > 16384 || h > 16384) return null;
    return { w, h };
  } catch {
    return null;
  }
}

/**
 * How many WINDOW pixels one CSS pixel of the player page covers — the factor
 * the native site view's rect must be multiplied by.
 *
 * ⚠️ NOT `window.devicePixelRatio` (2026-11-07 field report: "it didn't fill
 * the screen … the login was in the bottom corner"). The player pins its
 * layout viewport to the panel's PHYSICAL size (layout.tsx sets the viewport
 * meta to `width=<w>` from the APK's `w`/`h`, and the APK loads the page at
 * `setInitialScale(100)`), so on a 2160×3840 Goodview one CSS px is one
 * physical px — while the ROM still reports its density (3.0 on that panel)
 * as the devicePixelRatio. Multiplying by it put the site view 3× too far
 * down and right, clamped into a corner of the glass. The native video
 * path already scales by "the WebView's size over the page's layout
 * viewport (that ratio is the device pixel ratio, whatever the ROM reports)"
 * (`FaceVideoPolicy.rect`); this is the same ratio, derived on the page side
 * so the shipped APKs need no update.
 *
 * The URL size is trusted only when it is consistent with the viewport's
 * shape (both axes agree within 10 %, either as given or swapped — the URL is
 * built at page load, before a rotation may land). Anything else — no URL
 * size, an LED canvas pin, a ratio outside 0.25–8 — falls back to the
 * reported devicePixelRatio, which is what every build did before.
 */
export function cssToWindowRatio(
  viewport: { w: number; h: number },
  physical: { w: number; h: number } | null,
  reportedDpr: number,
): number {
  const fallback = Number.isFinite(reportedDpr) && reportedDpr > 0 ? reportedDpr : 1;
  if (!physical || !(viewport.w > 0) || !(viewport.h > 0)) return fallback;
  const agree = (a: number, b: number) => Math.abs(a - b) / Math.max(a, b) <= 0.1;
  const sane = (r: number) => Number.isFinite(r) && r >= 0.25 && r <= 8;
  const rx = physical.w / viewport.w;
  const ry = physical.h / viewport.h;
  if (sane(rx) && agree(rx, ry)) return rx;
  const sx = physical.h / viewport.w;
  const sy = physical.w / viewport.h;
  if (sane(sx) && agree(sx, sy)) return sx;
  return fallback;
}

/**
 * Sign out on an idle return / when the widget leaves the glass?
 * The kiosk switch says so — unless a tab is set to "Sign in once", which the
 * editor promises keeps that site signed in "even when Sign out after idle is
 * on". Shipped APKs wipe cookies process-wide (Android's CookieManager has no
 * per-site delete), so honouring that promise means not wiping at all while
 * such a tab exists. Until 2026-11-07 the per-tab choice was saved and read
 * by nothing: a dashboard behind a login was signed out at every idle return.
 */
export function signOutOnLeave(cfg: Pick<WebsiteTabsConfig, 'incognito' | 'tabs'>): boolean {
  return cfg.incognito && !cfg.tabs.some((t) => t.signIn === 'once');
}

/** Where the active site renders on this surface. */
export type SiteSurface = 'native' | 'frame' | 'needs-app' | 'app-update';

/**
 * The framing decision, in one place. Our app's native site view is a
 * TOP-LEVEL WebView, so a site whose headers forbid framing
 * (`X-Frame-Options`, CSP `frame-ancestors`) — and its sign-in, its cookies —
 * work there exactly as in a browser tab. Without it, a site the panel's
 * check found `blocked` is never put in a frame (the browser would refuse it
 * and show an empty box): the screen says what it needs instead. Everything
 * else — a frameable site, or one not checked yet — gets the sandboxed frame.
 */
export function siteSurfaceFor(args: { native: boolean; inApp: boolean; embed?: TabEmbed }): SiteSurface {
  if (args.native) return 'native';
  if (args.embed === 'blocked') return args.inApp ? 'app-update' : 'needs-app';
  return 'frame';
}

/** CSS-pixel rect × the CSS→window ratio (see `cssToWindowRatio`) → the integer device rect the APK needs. */
export function toNativeBounds(
  rect: { left: number; top: number; width: number; height: number },
  dpr: number,
): NativeBounds {
  const s = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const left = Math.round(rect.left * s);
  const top = Math.round(rect.top * s);
  return {
    left,
    top,
    width: Math.max(0, Math.round((rect.left + rect.width) * s) - left),
    height: Math.max(0, Math.round((rect.top + rect.height) * s) - top),
  };
}

export function buildShowPayload(args: {
  url: string;
  bounds: NativeBounds;
  tabs: ReadonlyArray<Pick<WebsiteTab, 'url'>>;
  incognito: boolean;
  sessionKey: string;
  focus?: boolean;
  copy: ViewerCopy;
}): WebTabsShowPayload {
  return {
    v: 1,
    url: args.url,
    bounds: args.bounds,
    allowHosts: allowHostsFor(args.tabs),
    incognito: args.incognito,
    sessionKey: args.sessionKey,
    focus: args.focus === true,
    copy: {
      title: args.copy.onlyTheseSitesTitle,
      body: args.copy.onlyTheseSitesBody,
      back: args.copy.backLabel,
      offlineTitle: args.copy.cantLoadTitle,
      offlineBody: args.copy.cantLoadBody,
    },
  };
}

export function buildHidePayload(wipe: boolean): WebTabsHidePayload {
  return { v: 1, wipe };
}
