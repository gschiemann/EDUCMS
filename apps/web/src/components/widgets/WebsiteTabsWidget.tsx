'use client';

/**
 * WEBSITE_TABS — "paste your sites, done" (2026-09-28).
 *
 * Greg: "customers want to push multiple sites and give tabs to flip thru but
 * still lock those sites on the screen … this is only for touch screens … make
 * it dumb simple." One zone: a finger-sized tab bar (icon + name per site, a
 * Home button) and the site area underneath / above it.
 *
 * ── WHERE THE SITE ACTUALLY RENDERS ───────────────────────────────────
 *   • A screen running OUR APP with an APK that has `webTabsShow`: the site
 *     is a NATIVE top-level WebView the APK lays out over exactly the site
 *     area (bounds measured here, in device pixels). The APK enforces the
 *     host allowlist (default deny — the tabs' sites and their subdomains),
 *     blocks `file:` / `content:` / `intent:` / `javascript:` navigations,
 *     refuses downloads, and on idle return wipes cookies + site storage when
 *     "Sign out after idle" is on. That WebView carries NO JavaScript bridge.
 *   • Anywhere else (a browser player, an older APK): a SANDBOXED iframe per
 *     site — `allow-scripts allow-same-origin allow-forms`, so a site keeps
 *     its own origin and can sign in, but can NEVER navigate the top page
 *     (no `allow-top-navigation`) and can never open a popup (no
 *     `allow-popups`). A site whose headers refuse framing gets the honest
 *     card: "This site can only be shown on screens running the VenueOS app"
 *     — or, on OUR app with an APK older than 1.1.19, "This site needs the
 *     newest VenueOS app" (Greg saw the install copy on a screen that HAD it).
 *
 * ── WIDGET TRUTH (§19 / widget-truth.test) ────────────────────────────
 * Unconfigured in the builder → the named next action ("Paste your first
 * website"). Unconfigured on the glass → a quiet zone, no prompt.
 *
 * ── REMOTE-OPERABLE (player rule 15) ──────────────────────────────────
 * Focus is PARKED on the active tab when the widget goes live; Left/Right
 * (and Up/Down) move between tabs and Home with a visible ring; Enter
 * activates. On our app, Down from a top bar (Up from a bottom bar) hands
 * Android focus to the site so the remote can browse it, and the APK's Back
 * returns focus to the bar.
 *
 * ⚠️ Chromium-83 (NovaStar Taurus) scan path: physical longhand sides only
 * (no `inset`), no flex `gap`, and no `:focus-visible` (Chrome 86) — the
 * focus ring uses `:focus`.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { sceneCss } from './scene-css';
import { hasNativeBridge, nativeFire, nativeHas } from '@/app/player/nativeBridge';
import { DISPLAY_BLANK_EVENT, isDisplayBlanked } from '@/app/player/displayBlankSignal';
import { WidgetEmptyState } from './WidgetEmptyState';
import {
  buildHidePayload,
  buildShowPayload,
  fillCopy,
  idlePlanFor,
  normalizeWebsiteTabsConfig,
  tabInitials,
  toNativeBounds,
  viewerCopyFor,
  type NativeBounds,
  type WebsiteTab,
  type WebsiteTabsConfig,
} from './website-tabs-config';

/** Builder-side status line under the preview card (en / es / zh like the glass copy). */
const STATUS_COPY: Record<'en' | 'es' | 'zh', Record<'ok' | 'blocked' | 'unreachable' | 'unknown', string>> = {
  en: {
    ok: 'Loads on screens',
    blocked: 'Can’t preview here — it shows on screens running the VenueOS app',
    unreachable: "Can't reach this site",
    unknown: 'Not checked yet',
  },
  es: {
    ok: 'Se muestra en las pantallas',
    blocked: 'No se puede previsualizar aquí: se muestra en pantallas con la app VenueOS',
    unreachable: 'No se puede acceder a este sitio',
    unknown: 'Aún no comprobado',
  },
  zh: {
    ok: '可在屏幕上显示',
    blocked: '此处无法预览——在运行 VenueOS 应用的屏幕上正常显示',
    unreachable: '无法访问此网站',
    unknown: '尚未检查',
  },
};

const EMPTY_COPY: Record<'en' | 'es' | 'zh', { eyebrow: string; action: string; hint: string }> = {
  en: { eyebrow: 'WEBSITE TABS', action: 'Paste your first website', hint: 'Properties → Websites' },
  es: { eyebrow: 'PESTAÑAS WEB', action: 'Pegue su primer sitio web', hint: 'Propiedades → Sitios web' },
  zh: { eyebrow: '网站标签', action: '粘贴您的第一个网站', hint: '属性 → 网站' },
};

function langKey(lang?: string | null): 'en' | 'es' | 'zh' {
  const tag = String(lang || '')
    .trim()
    .toLowerCase();
  if (tag === 'es' || tag.startsWith('es-')) return 'es';
  if (tag === 'zh' || tag.startsWith('zh-')) return 'zh';
  return 'en';
}

/** The document's language when the config does not pin one. */
function documentLang(): string {
  if (typeof document === 'undefined') return 'en';
  return document.documentElement.lang || (typeof navigator !== 'undefined' ? navigator.language : 'en') || 'en';
}

let sessionSeq = 0;

/** The whole tab bar in one place, so the tab and the Home button match. */
function TabButton({
  label,
  iconUrl,
  active,
  focusable,
  onActivate,
  onKeyDown,
  buttonRef,
  testId,
  style,
  ariaLabel,
  role,
  iconOnly,
}: {
  label: string;
  iconUrl?: string;
  active: boolean;
  focusable: boolean;
  onActivate: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  buttonRef: (el: HTMLButtonElement | null) => void;
  testId: string;
  style: CSSProperties;
  ariaLabel?: string;
  role: 'tab' | 'button';
  /** Home: a compact house glyph, not a site-style tab (2026-09-28). */
  iconOnly?: boolean;
}) {
  const [iconBroken, setIconBroken] = useState(false);
  return (
    <button
      type="button"
      ref={buttonRef}
      role={role}
      aria-selected={role === 'tab' ? active : undefined}
      aria-label={ariaLabel}
      tabIndex={focusable ? 0 : -1}
      data-testid={testId}
      data-active={active ? '1' : '0'}
      className="wt-tab"
      onClick={onActivate}
      onKeyDown={onKeyDown}
      style={style}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '1.6em',
          height: '1.6em',
          marginRight: iconOnly ? 0 : '0.55em',
          borderRadius: '0.35em',
          overflow: 'hidden',
          background: 'rgba(255,255,255,0.14)',
          flexShrink: 0,
          fontSize: '0.9em',
          fontWeight: 800,
        }}
      >
        {iconUrl && !iconBroken ? (
          // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/no-noninteractive-element-interactions -- onError is the initials fallback's only signal
          <img
            src={iconUrl}
            alt=""
            draggable={false}
            onError={() => setIconBroken(true)}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
          />
        ) : iconOnly ? (
          '⌂'
        ) : (
          tabInitials(label)
        )}
      </span>
      <span
        style={{
          // Two lines, never "Wikipe…" (2026-09-28). -webkit-line-clamp works in
          // Chromium 83+, WebKit and Firefox 68+.
          display: iconOnly ? 'none' : '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          whiteSpace: 'normal',
          overflow: 'hidden',
          overflowWrap: 'break-word',
          lineHeight: 1.1,
          minWidth: 0,
        }}
      >
        {label}
      </span>
    </button>
  );
}

export function WebsiteTabsWidget({ config, live }: { config: unknown; live?: boolean }) {
  const cfg: WebsiteTabsConfig = useMemo(() => normalizeWebsiteTabsConfig(config), [config]);
  const isLive = !!live;
  const lang = cfg.lang || documentLang();
  const copy = useMemo(() => viewerCopyFor(lang), [lang]);
  const lk = langKey(lang);

  const tabs = cfg.tabs;
  const homeId = tabs[0]?.id ?? null;
  const [activeId, setActiveId] = useState<string | null>(homeId);
  // A tab removed from the config (a live edit) must not leave a dead id.
  const active: WebsiteTab | null = useMemo(() => {
    if (!tabs.length) return null;
    return tabs.find((t) => t.id === activeId) ?? tabs[0];
  }, [tabs, activeId]);
  useEffect(() => {
    if (active && active.id !== activeId) setActiveId(active.id);
  }, [active, activeId]);

  // ── The native path: our app, with an APK that implements the pair. ─────
  // `nativeHas` is synchronous and the channel's method manifest is injected
  // at document start, so this is stable for the widget's lifetime. On a
  // manifest-less channel it answers from KNOWN_METHODS + the UA floor
  // (nativeBridge.ts), so an older APK simply gets the iframe fallback.
  const native = useMemo(() => isLive && nativeHas('webTabsShow') && nativeHas('webTabsHide'), [isLive]);
  // Our app, but an APK without the native site view (older than 1.1.19):
  // the honest card there is "update the app", not "install the app".
  const inApp = useMemo(() => isLive && hasNativeBridge(), [isLive]);
  const sessionKey = useRef<string>('');
  if (!sessionKey.current) {
    sessionSeq += 1;
    sessionKey.current = `wt-${Date.now().toString(36)}-${sessionSeq}`;
  }

  const contentRef = useRef<HTMLDivElement | null>(null);
  const lastSentRef = useRef<string>('');
  const [frameKey, setFrameKey] = useState(0);
  const [frameFailed, setFrameFailed] = useState<Record<string, boolean>>({});

  const measureBounds = useCallback((): NativeBounds | null => {
    const el = contentRef.current;
    if (!el || typeof window === 'undefined') return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return toNativeBounds({ left: r.left, top: r.top, width: r.width, height: r.height }, window.devicePixelRatio || 1);
  }, []);

  const sendShow = useCallback(
    (opts?: { focus?: boolean; force?: boolean }) => {
      if (!native || !active) return;
      // The screen is blanked (dashboard Off / the on-off schedule): the native
      // site view sits ABOVE the page's black cover, so it must stay down.
      if (isDisplayBlanked()) return;
      const bounds = measureBounds();
      if (!bounds) return;
      const payload = buildShowPayload({
        url: active.url,
        bounds,
        tabs,
        incognito: cfg.incognito,
        sessionKey: sessionKey.current,
        focus: opts?.focus === true,
        copy,
      });
      const json = JSON.stringify(payload);
      if (!opts?.force && !opts?.focus && json === lastSentRef.current) return;
      lastSentRef.current = json;
      nativeFire('webTabsShow', json);
    },
    [native, active, tabs, cfg.incognito, copy, measureBounds],
  );

  const sendHide = useCallback(
    (wipe: boolean) => {
      if (!native) return;
      lastSentRef.current = '';
      nativeFire('webTabsHide', JSON.stringify(buildHidePayload(wipe)));
    },
    [native],
  );

  // Show on every URL / bounds change; hide (and sign out when incognito) on unmount.
  useEffect(() => {
    if (!native) return;
    sendShow();
    const el = contentRef.current;
    const RO = typeof ResizeObserver !== 'undefined' ? ResizeObserver : null;
    const ro = RO && el ? new RO(() => sendShow()) : null;
    if (ro && el) ro.observe(el);
    const onResize = () => sendShow();
    window.addEventListener('resize', onResize);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [native, sendShow]);
  // A blank takes the site down without signing anyone out; the wake puts it
  // back. (An alert or Stop unmounts this widget instead — see the effect below.)
  useEffect(() => {
    if (!native) return;
    const onBlank = (e: Event) => {
      if ((e as CustomEvent<{ on?: boolean }>).detail?.on) sendHide(false);
      else sendShow({ force: true });
    };
    window.addEventListener(DISPLAY_BLANK_EVENT, onBlank);
    return () => window.removeEventListener(DISPLAY_BLANK_EVENT, onBlank);
  }, [native, sendHide, sendShow]);
  useEffect(() => {
    if (!native) return;
    const wipeOnLeave = cfg.incognito;
    return () => sendHide(wipeOnLeave);
    // The unmount cleanup must capture the LAST incognito value.
  }, [native, cfg.incognito, sendHide]);

  // ── Idle: warn at T-warn, return to the first tab at T. ────────────────
  const plan = useMemo(() => (isLive ? idlePlanFor(cfg) : null), [isLive, cfg]);
  const [warning, setWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const dirtyRef = useRef(false); // anything happened since the last reset?
  const stillHereRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!warning) return;
    try {
      stillHereRef.current?.focus({ preventScroll: true });
    } catch {
      /* an OEM WebView without the options bag */
    }
  }, [warning]);
  const timersRef = useRef<{ warn: ReturnType<typeof setTimeout> | null; ret: ReturnType<typeof setTimeout> | null; tick: ReturnType<typeof setInterval> | null }>({
    warn: null,
    ret: null,
    tick: null,
  });

  const clearTimers = useCallback(() => {
    const t = timersRef.current;
    if (t.warn) clearTimeout(t.warn);
    if (t.ret) clearTimeout(t.ret);
    if (t.tick) clearInterval(t.tick);
    t.warn = null;
    t.ret = null;
    t.tick = null;
  }, []);

  const goHome = useCallback(
    (reason: 'idle' | 'tap') => {
      if (!homeId) return;
      const wasElsewhere = active?.id !== homeId;
      const needsReset = reason === 'tap' || wasElsewhere || dirtyRef.current;
      setWarning(false);
      dirtyRef.current = false;
      if (!needsReset) return;
      setActiveId(homeId);
      if (native) {
        // Sign out first (when asked), then put the first site back up fresh.
        sendHide(reason === 'idle' && cfg.incognito);
        lastSentRef.current = '';
        // `sendShow` runs from the effect above once `active` updates; a
        // re-tap of Home while already on it needs an explicit force.
        if (!wasElsewhere) setTimeout(() => sendShow({ force: true }), 0);
      } else {
        setFrameKey((k) => k + 1);
      }
    },
    [homeId, active, native, cfg.incognito, sendHide, sendShow],
  );
  const goHomeRef = useRef(goHome);
  goHomeRef.current = goHome;

  const armIdle = useCallback(() => {
    clearTimers();
    if (!plan) return;
    setWarning(false);
    const t = timersRef.current;
    t.warn = setTimeout(() => {
      // Nothing to return to: an untouched kiosk already on Home stays quiet.
      if (!dirtyRef.current) {
        armIdle();
        return;
      }
      const warnMs = plan.returnAfterMs - plan.warnAfterMs;
      if (warnMs > 0) {
        setSecondsLeft(Math.ceil(warnMs / 1000));
        setWarning(true);
        t.tick = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
      }
      t.ret = setTimeout(() => {
        clearTimers();
        goHomeRef.current('idle');
        armIdle();
      }, Math.max(0, warnMs));
    }, plan.warnAfterMs);
  }, [plan, clearTimers]);

  const noteActivity = useCallback(() => {
    dirtyRef.current = true;
    if (warning) setWarning(false);
    armIdle();
  }, [armIdle, warning]);

  useEffect(() => {
    if (!plan) return;
    armIdle();
    // The APK relays every touch inside the native site view. The iframe path
    // cannot see inside a cross-origin frame; its one signal is a tap INTO
    // the site (this page losing focus to the frame). Focus merely STAYING in
    // the frame is not use — a visitor who walked away leaves it there, and
    // that kiosk must still go back to the first site. What the frame hides
    // (reading, tapping links), the "Still there?" warning covers.
    const onNativeActivity = () => noteActivity();
    window.addEventListener('edu:webtabs-activity', onNativeActivity);
    const onBlur = () => {
      // activeElement settles after the blur event.
      setTimeout(() => {
        const el = document.activeElement;
        if (el && el.tagName === 'IFRAME' && contentRef.current?.contains(el)) noteActivity();
      }, 0);
    };
    if (!native) window.addEventListener('blur', onBlur);
    return () => {
      clearTimers();
      window.removeEventListener('edu:webtabs-activity', onNativeActivity);
      if (!native) window.removeEventListener('blur', onBlur);
    };
    // armIdle/noteActivity are stable per plan; re-arming on every render
    // would restart the idle clock on every paint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, native]);

  // ── Remote / keyboard: roving focus across Home + tabs. ────────────────
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const order = useMemo(() => [...(cfg.showHome && homeId ? ['home'] : []), ...tabs.map((t) => t.id)], [cfg.showHome, homeId, tabs]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const currentFocusId = focusId && order.indexOf(focusId) !== -1 ? focusId : active?.id ?? order[0] ?? null;

  useEffect(() => {
    // Park focus on the active tab when the widget goes live, unless the
    // page already parked it somewhere real (an escape surface, a dialog).
    if (!isLive || !active) return;
    const el = buttonRefs.current[active.id];
    const ae = typeof document !== 'undefined' ? document.activeElement : null;
    if (el && (!ae || ae === document.body)) {
      try {
        el.focus({ preventScroll: true });
      } catch {
        /* an OEM WebView without the options bag */
      }
    }
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive]);

  const moveFocus = useCallback(
    (from: string, delta: 1 | -1) => {
      const i = order.indexOf(from);
      if (i === -1 || order.length === 0) return;
      const next = order[(i + delta + order.length) % order.length];
      setFocusId(next);
      buttonRefs.current[next]?.focus({ preventScroll: true });
    },
    [order],
  );

  const onTabKeyDown = useCallback(
    (id: string) => (e: KeyboardEvent<HTMLButtonElement>) => {
      const intoSite = cfg.barPosition === 'top' ? 'ArrowDown' : 'ArrowUp';
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        moveFocus(id, 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        moveFocus(id, -1);
      } else if (e.key === intoSite && native) {
        // Hand the site Android focus so the remote can browse it.
        e.preventDefault();
        sendShow({ focus: true });
      }
    },
    [cfg.barPosition, moveFocus, native, sendShow],
  );

  // ── Styling ────────────────────────────────────────────────────────────
  const barBg = cfg.barColor || 'var(--brand-primary, #0f172a)';
  const activeBg = cfg.activeColor || 'var(--brand-accent, #f59e0b)';
  const ink = cfg.textColor || cfg.color || 'var(--brand-primary-ink, #ffffff)';
  // More tabs → a slightly smaller default label so every name stays readable.
  const autoLabelSize = tabs.length <= 4 ? 'clamp(16px, 1.55vw, 26px)' : tabs.length <= 6 ? 'clamp(14px, 1.3vw, 22px)' : 'clamp(12px, 1.1vw, 19px)';
  const labelSize: string | number = typeof cfg.fontSize === 'number' && cfg.fontSize > 0 ? cfg.fontSize : autoLabelSize;
  const barAtTop = cfg.barPosition === 'top';

  const tabStyle = (isActive: boolean): CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    flex: '0 1 auto',
    minWidth: '6.5em',
    maxWidth: '18em',
    minHeight: 64,
    padding: '0.55em 1.1em',
    marginRight: '0.4em',
    borderRadius: '0.6em',
    border: '2px solid transparent',
    background: isActive ? activeBg : 'rgba(255,255,255,0.09)',
    color: ink,
    fontFamily: cfg.fontFamily || 'inherit',
    fontSize: labelSize,
    fontWeight: 700,
    lineHeight: 1.1,
    cursor: 'pointer',
    // No hover-only affordances on a touch surface; the ring is on :focus.
    outline: 'none',
    touchAction: 'manipulation',
    userSelect: 'none',
    WebkitUserSelect: 'none',
  });

  // ── Empty (widget truth) ───────────────────────────────────────────────
  if (!tabs.length) {
    if (isLive) {
      // A real screen: hold the zone, say nothing.
      return <div data-testid="website-tabs" data-empty="1" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />;
    }
    const e = EMPTY_COPY[lk];
    return (
      <div data-testid="website-tabs" data-empty="1" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
        <WidgetEmptyState eyebrow={e.eyebrow} action={e.action} hint={e.hint} accent="#0ea5e9" />
      </div>
    );
  }

  const bar = (
    <div
      role="tablist"
      aria-label={copy.tabsLabel}
      data-testid="website-tabs-bar"
      style={{
        display: 'flex',
        alignItems: 'center',
        flexShrink: 0,
        overflowX: 'auto',
        overflowY: 'hidden',
        padding: '0.5em 0.6em',
        background: barBg,
        color: ink,
        fontSize: labelSize,
        boxShadow: barAtTop ? '0 2px 8px rgba(0,0,0,0.25)' : '0 -2px 8px rgba(0,0,0,0.25)',
        // Chromium-83-safe: the ring uses :focus (no :focus-visible).
      }}
    >
      <style>{sceneCss(`.wt-tab:focus{box-shadow:0 0 0 4px ${ink} , 0 0 0 7px rgba(0,0,0,0.35)!important}.wt-tab:active{transform:scale(0.97)}`)}</style>
      {cfg.showHome && homeId && (
        <TabButton
          role="button"
          label={copy.home}
          active={false}
          focusable={currentFocusId === 'home'}
          onActivate={() => {
            noteActivity();
            goHome('tap');
          }}
          onKeyDown={onTabKeyDown('home')}
          buttonRef={(el) => {
            buttonRefs.current.home = el;
          }}
          testId="website-tabs-home"
          ariaLabel={copy.home}
          iconOnly
          style={{ ...tabStyle(false), marginRight: '0.9em', minWidth: 0, padding: '0.55em 0.8em' }}
        />
      )}
      {tabs.map((t) => (
        <TabButton
          key={t.id}
          role="tab"
          label={t.name}
          iconUrl={t.iconUrl}
          active={active?.id === t.id}
          focusable={currentFocusId === t.id}
          onActivate={() => {
            noteActivity();
            setFocusId(t.id);
            if (active?.id !== t.id) {
              setActiveId(t.id);
            }
          }}
          onKeyDown={onTabKeyDown(t.id)}
          buttonRef={(el) => {
            buttonRefs.current[t.id] = el;
          }}
          testId={`website-tab-${t.id}`}
          style={tabStyle(active?.id === t.id)}
        />
      ))}
    </div>
  );

  // With the native site view up, the content box is under the APK's WebView,
  // so a warning drawn there is invisible and the kiosk would jump back
  // unannounced. It rides over the tab bar instead.
  const barWarning =
    isLive && warning && native ? (
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={copy.stillThere}
        data-testid="website-tabs-idle-warning"
        data-placement="bar"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 0.8em',
          boxSizing: 'border-box',
          background: '#0f172a',
          color: '#f8fafc',
          fontSize: labelSize,
          zIndex: 5,
        }}
      >
        <span style={{ fontWeight: 900, marginRight: '0.7em', whiteSpace: 'nowrap' }}>{copy.stillThere}</span>
        <span style={{ opacity: 0.85, marginRight: '1em', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {fillCopy(copy.returningIn, { n: secondsLeft })}
        </span>
        <button
          type="button"
          ref={stillHereRef}
          className="wt-tab"
          data-testid="website-tabs-still-here"
          onClick={() => noteActivity()}
          style={{
            flexShrink: 0,
            minHeight: 56,
            padding: '0.4em 1.2em',
            borderRadius: 999,
            border: 0,
            background: activeBg,
            color: ink,
            fontSize: 'inherit',
            fontWeight: 800,
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          {copy.yesImHere}
        </button>
      </div>
    ) : null;
  const barBlock = (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      {bar}
      {barWarning}
    </div>
  );

  const status = active ? STATUS_COPY[lk][active.embed ?? 'unknown'] : '';

  const content = (
    <div
      ref={contentRef}
      data-testid="website-tabs-content"
      data-native={native ? '1' : '0'}
      style={{ position: 'relative', flex: '1 1 auto', minHeight: 0, background: '#ffffff', overflow: 'hidden' }}
    >
      {!isLive && active && (
        // The builder: a preview card, never a live iframe on the canvas.
        <div
          data-testid="website-tabs-preview"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '4%',
            background: 'linear-gradient(180deg,#f8fafc,#e2e8f0)',
            color: '#0f172a',
            fontFamily: cfg.fontFamily || 'inherit',
          }}
        >
          <div
            style={{
              width: '18%',
              maxWidth: 140,
              minWidth: 40,
              aspectRatio: '1 / 1',
              borderRadius: '18%',
              background: '#ffffff',
              boxShadow: '0 6px 24px rgba(15,23,42,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              marginBottom: '2%',
              fontSize: 'clamp(18px, 3vw, 48px)',
              fontWeight: 800,
            }}
          >
            {active.iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={active.iconUrl} alt="" style={{ width: '70%', height: '70%', objectFit: 'contain' }} />
            ) : (
              tabInitials(active.name)
            )}
          </div>
          <div style={{ fontSize: 'clamp(16px, 2.4vw, 40px)', fontWeight: 800, lineHeight: 1.1 }}>{active.name}</div>
          <div style={{ fontSize: 'clamp(11px, 1.1vw, 18px)', opacity: 0.6, marginTop: '0.5em', wordBreak: 'break-all' }}>{isLive ? active.url : (
            <a href={active.url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{active.url} ↗</a>
          )}</div>
          <div
            data-testid="website-tabs-status"
            data-embed={active.embed ?? 'unknown'}
            style={{
              marginTop: '1.2em',
              fontSize: 'clamp(11px, 1.1vw, 18px)',
              fontWeight: 700,
              padding: '0.4em 0.9em',
              borderRadius: 999,
              background: active.embed === 'ok' ? '#dcfce7' : active.embed === 'blocked' ? '#fef3c7' : active.embed === 'unreachable' ? '#fee2e2' : '#e2e8f0',
              color: active.embed === 'ok' ? '#166534' : active.embed === 'blocked' ? '#92400e' : active.embed === 'unreachable' ? '#991b1b' : '#334155',
            }}
          >
            {status}
          </div>
        </div>
      )}

      {isLive && active && native && (
        // The APK paints its WebView over this box; until it does, show
        // which site is coming.
        <div
          data-testid="website-tabs-native-placeholder"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#0b1220',
            color: '#cbd5e1',
            fontSize: 'clamp(16px, 2vw, 32px)',
            fontWeight: 600,
          }}
        >
          {copy.loading}
        </div>
      )}

      {isLive && active && !native && active.embed === 'blocked' && (
        <div
          data-testid="website-tabs-blocked"
          role="note"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '6%',
            background: '#0f172a',
            color: '#f8fafc',
          }}
        >
          <div data-reason={inApp ? 'app-update' : 'needs-app'} style={{ fontSize: 'clamp(20px, 2.6vw, 44px)', fontWeight: 800, lineHeight: 1.15, maxWidth: '22em' }}>
            {inApp ? copy.updateTitle : copy.blockedTitle}
          </div>
          <div style={{ fontSize: 'clamp(14px, 1.4vw, 24px)', opacity: 0.75, marginTop: '1em', maxWidth: '32em' }}>{inApp ? copy.updateBody : copy.blockedBody}</div>
        </div>
      )}

      {isLive && active && !native && active.embed !== 'blocked' && frameFailed[active.id] && (
        <div
          data-testid="website-tabs-unreachable"
          role="note"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '6%',
            background: '#0f172a',
            color: '#f8fafc',
          }}
        >
          <div style={{ fontSize: 'clamp(20px, 2.6vw, 44px)', fontWeight: 800 }}>{copy.cantLoadTitle}</div>
          <div style={{ fontSize: 'clamp(14px, 1.4vw, 24px)', opacity: 0.75, marginTop: '1em' }}>{copy.cantLoadBody}</div>
        </div>
      )}

      {isLive && active && !native && active.embed !== 'blocked' && !frameFailed[active.id] && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- onError is the "can't reach" card's only signal
        <iframe
          key={`${active.id}-${frameKey}`}
          data-testid="website-tabs-frame"
          title={active.name}
          src={active.url}
          // Its own origin (so it can sign in), forms, scripts — and NOTHING
          // that could leave the kiosk: no top navigation, no popups, no
          // downloads. This is the browser-player half of "lock those sites
          // on the screen"; the APK's allowlist is the other half.
          sandbox="allow-scripts allow-same-origin allow-forms"
          referrerPolicy="strict-origin-when-cross-origin"
          onError={() => setFrameFailed((m) => ({ ...m, [active.id]: true }))}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0, background: '#fff' }}
        />
      )}

      {isLive && warning && !native && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label={copy.stillThere}
          data-testid="website-tabs-idle-warning"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            background: 'rgba(15,23,42,0.86)',
            color: '#f8fafc',
            zIndex: 5,
          }}
        >
          <div style={{ fontSize: 'clamp(28px, 4vw, 72px)', fontWeight: 900, lineHeight: 1 }}>{copy.stillThere}</div>
          <div style={{ fontSize: 'clamp(16px, 1.8vw, 30px)', opacity: 0.8, marginTop: '0.8em' }}>
            {fillCopy(copy.returningIn, { n: secondsLeft })}
          </div>
          <button
            type="button"
            // Parked for the remote (rule 15): the one control on the glass
            // while the warning is up. A ref + effect rather than
            // `autoFocus` so the a11y lint's blanket rule stays quiet.
            ref={stillHereRef}
            className="wt-tab"
            data-testid="website-tabs-still-here"
            onClick={() => noteActivity()}
            style={{
              marginTop: '1.4em',
              minWidth: '9em',
              minHeight: 72,
              padding: '0.6em 1.6em',
              borderRadius: 999,
              border: 0,
              background: activeBg,
              color: ink,
              fontSize: 'clamp(18px, 2.2vw, 36px)',
              fontWeight: 800,
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            {copy.yesImHere}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div
      data-testid="website-tabs"
      data-bar-position={cfg.barPosition}
      onPointerDownCapture={isLive ? noteActivity : undefined}
      onKeyDownCapture={isLive ? noteActivity : undefined}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: barBg,
        overflow: 'hidden',
      }}
    >
      {barAtTop ? barBlock : null}
      {content}
      {barAtTop ? null : barBlock}
    </div>
  );
}

export default WebsiteTabsWidget;
