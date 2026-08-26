'use client';

/**
 * ConnectScreenCard — the device-first replacement for the old
 * "How to Connect a Screen" card on /screens.
 *
 * Operator, verbatim (2026-08-25):
 *   "the how to connect a screen section is worthless, because really they
 *    need to install an APK on their screen, or attach a media player 9
 *    times out of 10 .... the screen need to be rethought on how we serve
 *    that up to the admin to get screens going."
 *
 * The old card taught ONE flow — open venue-os.app/player in a browser,
 * read the code, type it here. That flow only exists on a display that
 * ships a usable browser. The real fleet is Android: commercial signage
 * panels and HDMI media players running the VenueOS Player APK, which is
 * why apps/player/ and the whole OTA controller exist at all.
 *
 * So: ask what the operator is holding, then show that path's steps. The
 * browser flow is kept, verbatim, as the THIRD choice.
 *
 * WHAT THIS COMPONENT IS NOT
 * ---------------------------------------------------------------
 * It does not pair anything. Every path funnels into the two pairing
 * entry points that already exist and are unchanged:
 *   1. the "Pair Screen" modal on this page (`onPairScreen`)
 *   2. the phone camera scanner at /pair (apps/web/src/app/pair/page.tsx)
 *
 * TRUTH CONSTRAINTS (each claim below is code-verified — see the inline
 * citations; do not add a claim here the app does not actually do):
 *   • APK URL — `${API_URL}/player/apk/latest`, the same endpoint the
 *     Settings → Player APK button links to. 302s to
 *     /api/v1/player/apk/v/:vc and streams the real bytes.
 *     apps/api/src/player-ota/player-ota.controller.ts
 *   • 6-CHARACTER code (not 6 digits — the old copy was wrong):
 *     `generatePairingCode(length = 6)` draws from PAIRING_CODE_ALPHABET,
 *     apps/api/src/screens/screens.controller.ts:205
 *   • the code screen also renders its own QR to /pair?code=…
 *     apps/web/src/components/player/KioskSplash.tsx
 *   • first-boot grants — SetupCeremony's six steps, offered one dialog at
 *     a time: install updates, background updates, brightness, keep
 *     running, screen-off, Home app.
 *     apps/player/app/src/main/java/com/educms/player/setup/SetupCeremony.kt
 *   • holds the panel awake — MainActivity adds FLAG_KEEP_SCREEN_ON.
 *     apps/player/app/src/main/java/com/educms/player/MainActivity.kt
 *
 * MOBILE PERF (CLAUDE.md standard): no pollers, no timers, no
 * backdrop-blur. The two QR codes are generated lazily — only once their
 * panel is actually on screen — so a collapsed card on a phone does no
 * work at all.
 */

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import QRCode from 'qrcode';
import {
  Tv, Cast, Globe, Wifi, Smartphone, Download, Copy, Check,
  ChevronDown, QrCode as QrCodeIcon, ExternalLink,
} from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import {
  CONNECT_PATHS,
  CONNECT_PATH_STORAGE_KEY,
  DEFAULT_CONNECT_PATH,
  apkDownloadUrl,
  connectPathMeta,
  normalizeConnectPath,
  pairFromPhoneUrl,
  shouldStartCollapsed,
  type ConnectPathId,
} from './connectPaths';

type IconComponent = React.ComponentType<{ className?: string; style?: React.CSSProperties }>;

const PATH_ICON: Record<ConnectPathId, IconComponent> = {
  android: Tv,
  'media-player': Cast,
  browser: Globe,
};

// ── The remembered choice, as a tiny external store ─────────────────────
//
// localStorage is an external store, so it is read through
// `useSyncExternalStore` rather than a mount effect that setStates (React
// 19 treats that as a cascading render; the repo's lint enforces it).
//
// NO memo cache here, deliberately. `getSnapshot` must be referentially
// stable or React re-renders forever — and it already is: this returns one
// of three string LITERALS, and `Object.is` compares equal strings as
// equal. Caching the parsed value would only add a way for the snapshot to
// go stale behind a direct `localStorage.setItem` somewhere else.
//
// A `storage` event covers the other-tab case; same-tab writes notify the
// listeners directly, because `storage` deliberately does not fire in the
// tab that performed the write.
const pathListeners = new Set<() => void>();

/**
 * Only consulted when localStorage THROWS (private mode, storage disabled
 * by policy, some locked-down kiosk webviews). Without it the chooser would
 * be inert on those browsers: the tap writes nothing, the snapshot never
 * moves, and the tile visibly refuses to select. It is deliberately NOT a
 * cache for the working case — a readable store is always the truth.
 */
let memoryPath: ConnectPathId | null = null;

function readStoredPath(): ConnectPathId {
  try {
    return normalizeConnectPath(window.localStorage.getItem(CONNECT_PATH_STORAGE_KEY));
  } catch {
    return memoryPath ?? DEFAULT_CONNECT_PATH;
  }
}

/** SSR + first hydration paint: always the default, so markup matches. */
function readServerPath(): ConnectPathId {
  return DEFAULT_CONNECT_PATH;
}

function subscribeToStoredPath(onChange: () => void): () => void {
  pathListeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    // `key === null` is a whole-store clear, which affects us too.
    if (e.key !== null && e.key !== CONNECT_PATH_STORAGE_KEY) return;
    onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    pathListeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

function writeStoredPath(id: ConnectPathId): void {
  memoryPath = id;
  try {
    window.localStorage.setItem(CONNECT_PATH_STORAGE_KEY, id);
  } catch { /* non-fatal: the choice holds for this visit, not the next */ }
  pathListeners.forEach((l) => l());
}

interface ConnectScreenCardProps {
  /** How many screens are already paired. >0 ⇒ card starts collapsed. */
  pairedCount: number;
  /** `${origin}/player` — the browser path's URL, computed by the page. */
  playerUrl: string;
  /** Opens the page's existing Pair Screen modal. Not reimplemented here. */
  onPairScreen: () => void;
  /** Viewer role — the page already disables its own Pair button this way. */
  pairDisabled?: boolean;
}

/**
 * Copy-to-clipboard button — MOVED here verbatim (behavior-wise) from the
 * `CopyUrlButton` that lived in screens/page.tsx purely to serve the card
 * this component replaces. Keeping its three hard-won fixes intact:
 *
 *  1. `cursor-pointer` — the old plain <button> read as dead/un-clickable.
 *  2. A visible "Copied!" state — `navigator.clipboard.writeText` is silent.
 *  3. A legacy `execCommand('copy')` fallback — `navigator.clipboard` is
 *     `undefined` outside a secure context (plain-HTTP previews, some kiosk
 *     webviews), where the optional-chain used to silently no-op.
 *
 * `variant='hero'` is the original full-width brand button (the browser
 * path's Player-URL row); `variant='inline'` is the compact twin used beside
 * the narrower APK / phone-link rows. Both clear 44px.
 */
function CopyButton({
  url,
  label,
  variant = 'inline',
}: {
  url: string;
  label: string;
  variant?: 'hero' | 'inline';
}) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = async () => {
    let ok = false;
    // Modern path — only present in a secure context (HTTPS/localhost).
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        ok = true;
      }
    } catch {
      /* fall through to the legacy path */
    }
    // Legacy fallback — works on plain HTTP and older webviews.
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.top = '0';
        ta.style.left = '0';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    setCopied(ok);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  // Single self-clearing timeout, torn down on unmount. Not a poller.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  if (variant === 'hero') {
    return (
      <button
        type="button"
        onClick={copy}
        aria-label={label}
        className="flex items-center gap-1.5 min-h-11 px-4 text-white text-sm font-bold rounded-xl shrink-0 shadow-sm transition-all active:scale-95 cursor-pointer"
        style={{ background: copied ? '#16a34a' : 'var(--brand-primary, #4f46e5)' }}
      >
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        {copied ? t('screens.copiedBang') : t('screens.copyUrl')}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      className="shrink-0 min-h-11 min-w-11 px-3 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-800 text-xs font-bold inline-flex items-center justify-center gap-1.5 shadow-sm cursor-pointer transition-all active:scale-95"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
      <span className="hidden sm:inline">
        {copied ? t('screens.copiedBang') : t('screens.copyUrl')}
      </span>
    </button>
  );
}

/** Numbered step, matching the old card's circle idiom exactly. */
function Step({ n, title, children }: { n: number; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex gap-3.5">
      <div
        className="w-10 h-10 rounded-2xl text-white flex items-center justify-center text-sm font-black shrink-0"
        style={{
          background: 'var(--brand-primary, #4f46e5)',
          boxShadow: '0 1px 2px color-mix(in srgb, var(--brand-primary, #4f46e5) 30%, transparent)',
        }}
      >
        {n}
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-sm font-bold text-slate-700">{title}</p>
        {children}
      </div>
    </div>
  );
}

export function ConnectScreenCard({
  pairedCount,
  playerUrl,
  onPairScreen,
  pairDisabled,
}: ConnectScreenCardProps) {
  // The remembered choice comes from localStorage, which is an EXTERNAL
  // STORE — so it is read with `useSyncExternalStore`, not with a mount
  // effect that calls setState (React 19 flags that as a cascading render,
  // and `react-hooks/set-state-in-effect` fails the lint). The server
  // snapshot is the Android default, so SSR and the first client paint
  // agree and there is no hydration mismatch; a stored value that differs
  // lands on the store's own update pass.
  const path = useSyncExternalStore(
    subscribeToStoredPath,
    readStoredPath,
    readServerPath,
  );

  // `null` = "no explicit tap yet, follow the fleet". Once the operator taps
  // the collapsed row (or the collapse chevron) their intent wins for the
  // rest of the visit — including while `pairedCount` is still resolving.
  const [manualExpand, setManualExpand] = useState<boolean | null>(null);
  const expanded = manualExpand ?? !shouldStartCollapsed(pairedCount);

  const meta = connectPathMeta(path);
  const apkUrl = useMemo(() => apkDownloadUrl(API_URL), []);
  const phonePairUrl = useMemo(
    () => pairFromPhoneUrl(typeof window !== 'undefined' ? window.location.origin : ''),
    [],
  );

  // ── QR codes, generated lazily ────────────────────────────────────────
  // Each effect ENCODES only while its panel is actually on screen — a
  // collapsed card runs neither. Nothing is cleared on the way out: both
  // source URLs are mount-stable `useMemo` constants, so a retained data
  // URL can never go stale, and the render gates below decide what is
  // visible. (Clearing here would be a synchronous setState inside an
  // effect — the cascading-render pattern React 19 warns about.)
  const [apkQr, setApkQr] = useState('');
  const wantApkQr = expanded && meta.steps === 'apk-sideload' && !!apkUrl;
  useEffect(() => {
    if (!wantApkQr) return;
    let live = true;
    QRCode.toDataURL(apkUrl, { width: 200, margin: 1 })
      .then((d) => { if (live) setApkQr(d); })
      // The "Download the APK here" button in the same block is the
      // fallback — the copyable URL field it used to name was removed
      // 2026-08-25 ("remove the copy URL field and keep just the download
      // APK"), so do not re-point this comment at a copy control.
      .catch(() => { /* no QR — the download button below still works */ });
    return () => { live = false; };
  }, [wantApkQr, apkUrl]);

  const [showPhoneQr, setShowPhoneQr] = useState(false);
  const wantPhoneQr = expanded && showPhoneQr;
  const [phoneQr, setPhoneQr] = useState('');
  useEffect(() => {
    if (!wantPhoneQr) return;
    let live = true;
    QRCode.toDataURL(phonePairUrl, { width: 180, margin: 1 })
      .then((d) => { if (live) setPhoneQr(d); })
      .catch(() => { /* no QR — the copyable /pair link below still works */ });
    return () => { live = false; };
  }, [wantPhoneQr, phonePairUrl]);

  // ── Collapsed: one slim row, nothing else ─────────────────────────────
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setManualExpand(true)}
        data-testid="connect-screen-collapsed"
        aria-expanded={false}
        className="w-full min-h-11 bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50"
      >
        <span
          className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'color-mix(in srgb, var(--brand-primary, #4f46e5) 12%, white)' }}
        >
          <Wifi className="w-4 h-4" style={{ color: 'var(--brand-primary, #4f46e5)' }} />
        </span>
        <span className="text-sm font-bold text-slate-700">Connect another screen</span>
        <span className="text-xs text-slate-400 hidden sm:inline truncate">
          Android player, media stick, or a browser display
        </span>
        <ChevronDown className="w-4 h-4 text-slate-400 ml-auto shrink-0" />
      </button>
    );
  }

  // ── Expanded ──────────────────────────────────────────────────────────
  //
  // SURFACE: the same one every other card on /screens wears (white,
  // rounded-3xl, the page's soft shadow) plus the slate hairline this
  // card's own COLLAPSED row already had, so collapsing and expanding read
  // as one object rather than two. It used to be a mint/teal gradient that
  // matched nothing else on the page — operator, 2026-08-25: "i dont like
  // the darker color of the back ground in this menu, keep the theme".
  // "The theme" is the BRAND palette, and that is untouched: the step
  // badges, the active-tile ring and the Pair button all still resolve
  // --brand-primary / --brand-accent. Do not reintroduce a panel-local
  // accent colour here.
  return (
    <div
      className="bg-white rounded-3xl border border-slate-200 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]"
      data-testid="connect-screen-card"
    >
      <div className="flex items-start gap-3 mb-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-slate-800">Connect a screen</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Nearly every screen runs the VenueOS Player app. Pick what you&apos;re setting up
            and we&apos;ll show only those steps.
          </p>
        </div>
        {shouldStartCollapsed(pairedCount) && (
          <button
            type="button"
            onClick={() => setManualExpand(false)}
            aria-label="Collapse connect instructions"
            className="shrink-0 min-h-11 min-w-11 -mt-2 -mr-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 inline-flex items-center justify-center"
          >
            <ChevronDown className="w-4 h-4 rotate-180" />
          </button>
        )}
      </div>

      {/* 1 — the chooser */}
      <p className="text-xs font-bold text-slate-600 mb-2">What are you setting up?</p>
      <div
        role="radiogroup"
        aria-label="What are you setting up?"
        className="grid grid-cols-1 sm:grid-cols-3 gap-2.5"
      >
        {CONNECT_PATHS.map((p) => {
          const Icon = PATH_ICON[p.id];
          const active = p.id === path;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={active}
              data-testid={`connect-path-${p.id}`}
              onClick={() => writeStoredPath(p.id)}
              className={`min-h-11 text-left rounded-2xl border px-3.5 py-3 flex gap-3 items-start transition-colors ${
                active
                  ? 'bg-white border-transparent shadow-sm ring-2'
                  : 'bg-slate-50 border-slate-200 hover:bg-white'
              }`}
              style={
                active
                  ? ({ '--tw-ring-color': 'var(--brand-primary, #4f46e5)' } as React.CSSProperties)
                  : undefined
              }
            >
              <Icon
                className="w-5 h-5 shrink-0 mt-0.5"
                style={{ color: active ? 'var(--brand-primary, #4f46e5)' : '#94a3b8' }}
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 flex-wrap">
                  <span className={`text-sm font-bold ${active ? 'text-slate-800' : 'text-slate-600'}`}>
                    {p.label}
                  </span>
                  {p.badge && (
                    <span
                      className="text-[10px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-full text-white"
                      style={{ background: 'var(--brand-primary, #4f46e5)' }}
                    >
                      {p.badge}
                    </span>
                  )}
                </span>
                <span className="block text-[11px] text-slate-500 mt-0.5">{p.hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* 2 — the steps for whichever path is chosen.

          THREE step-sets, not two. `media-player` used to ride the same
          branch as `android`, so choosing it re-rendered the identical
          sideload-the-APK flow — operator, 2026-08-25: "install apk should
          not be the same as media player ... media player should be
          instructions on how to plugin a venue os media player to their
          existing screen". The paths differ in WHO runs the app: on
          `apk-sideload` the display runs it, on `media-player` a small box
          does and the display is just a monitor. See ConnectStepSet in
          connectPaths.ts. */}
      <div className="mt-5 pt-5 border-t border-slate-200 space-y-5">
        {meta.steps === 'apk-sideload' ? (
          <>
            <Step n={1} title="Install the VenueOS Player app on the screen">
              <p className="text-xs text-slate-500 mt-0.5">
                Scan this from the screen’s own browser or setup app, or from your phone,
                then sideload it.
              </p>

              <div className="mt-3 flex flex-col sm:flex-row gap-3 sm:items-center">
                {wantApkQr && apkQr && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={apkQr}
                    alt="QR code linking to the VenueOS Player APK download"
                    width={132}
                    height={132}
                    data-testid="connect-apk-qr"
                    className="rounded-xl bg-white border border-slate-200 p-1.5 shadow-sm shrink-0 self-start"
                  />
                )}
                <div className="min-w-0 flex-1 space-y-2">
                  {apkUrl ? (
                    <>
                      {/* The read-only URL field + Copy URL button that used
                          to sit here were removed 2026-08-25 — operator:
                          "remove the copy URL field and keep just the
                          download APK". The QR above is how the link
                          reaches the screen itself; this button is how it
                          reaches the machine you are standing at. */}
                      <a
                        href={apkUrl}
                        target="_blank"
                        rel="noopener"
                        data-testid="connect-apk-download"
                        className="min-h-11 px-3.5 rounded-xl bg-white border border-slate-200 shadow-sm text-xs font-bold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5"
                      >
                        <Download className="w-3.5 h-3.5" /> Download the APK here
                        <ExternalLink className="w-3 h-3 text-slate-400" />
                      </a>
                      <p className="text-[11px] text-slate-400">
                        Always the current release — the link resolves to the newest published
                        build, so there is no version to look up. After this one install the app
                        keeps itself updated.
                      </p>
                      {/* USB path (2026-08-25, operator request). Plenty of
                          commercial panels ship no browser and no way to scan
                          the QR above — but they all have a USB port and a
                          file manager, so this is the route that always works.
                          Kept to one sentence on purpose. */}
                      <p className="text-[11px] text-slate-400" data-testid="connect-apk-usb">
                        <span className="font-semibold text-slate-500">No browser on the panel?</span>{' '}
                        Save the APK to a USB stick, plug it into the panel, open its file
                        manager, and tap the file — Android asks you to allow the install once.
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-amber-700">
                      This deploy has no API URL configured, so the download link can&apos;t be
                      built. Set <code className="font-mono">NEXT_PUBLIC_API_URL</code> and redeploy.
                    </p>
                  )}
                </div>
              </div>
            </Step>

            <Step n={2} title="Open it — the app shows a 6-character code">
              <p className="text-xs text-slate-500 mt-0.5">
                First launch asks for a few one-tap Android permissions, one dialog at a time,
                then the code fills the screen.
              </p>
            </Step>

            <Step n={3} title="Pair it">
              <p className="text-xs text-slate-500 mt-0.5">
                Type that code into <span className="font-semibold text-slate-600">Pair Screen</span> below,
                or scan the QR the screen is showing with your phone.
              </p>
            </Step>
          </>
        ) : meta.steps === 'media-player' ? (
          /* Physical hookup, not a software install. Every claim here is
             either hardware-generic (HDMI, power, input select) or already
             code-verified in this file's header: the SetupCeremony grants
             offered one dialog at a time incl. the Home-app step, and
             MainActivity's FLAG_KEEP_SCREEN_ON. Do NOT add product
             specifics we cannot support — no model, no dimensions, no
             price, no "what's in the box", no shipping or ordering copy. */
          <>
            <Step n={1} title="Plug the player into the display">
              <p className="text-xs text-slate-500 mt-0.5">
                Into any free HDMI input, then give it power. The display is only a monitor on
                this path — the player is what runs the VenueOS Player app.
              </p>
              {apkUrl && (
                <p className="text-[11px] text-slate-400 mt-2">
                  Using an Android stick you already own? That one needs the Player app
                  installed on it first —{' '}
                  <a
                    href={apkUrl}
                    target="_blank"
                    rel="noopener"
                    data-testid="connect-byo-apk-link"
                    className="font-semibold underline underline-offset-2 hover:text-slate-600"
                  >
                    download the APK
                  </a>
                  . A VenueOS player already has it.
                </p>
              )}
            </Step>

            <Step n={2} title="Switch the display to that input">
              <p className="text-xs text-slate-500 mt-0.5">
                Use the display’s own source or input button. A VenueOS media player is
                preloaded with the Player app, so there is nothing to sideload.
              </p>
            </Step>

            <Step n={3} title="It starts up and shows a 6-character code">
              <p className="text-xs text-slate-500 mt-0.5">
                First power-up asks for a few one-tap Android permissions, one dialog at a time —
                including setting the Player as the Home app, so it comes back on its own after a
                reboot or a power cut. Then the code fills the screen, and it holds the panel
                awake while it plays.
              </p>
            </Step>

            <Step n={4} title="Pair it">
              <p className="text-xs text-slate-500 mt-0.5">
                Type that code into <span className="font-semibold text-slate-600">Pair Screen</span> below,
                or scan the QR the screen is showing with your phone.
              </p>
            </Step>
          </>
        ) : (
          <>
            <Step n={1} title="Open the Player URL on the display">
              <p className="text-xs text-slate-500 mt-0.5">
                In the display&apos;s own browser. Works on a smart panel, a PC, or a Chromebook —
                nothing to install.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <code className="flex-1 min-w-0 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[11px] sm:text-sm font-mono text-slate-700 select-all break-all">
                  {playerUrl}
                </code>
                <CopyButton url={playerUrl} label="Copy the Player URL" variant="hero" />
              </div>
            </Step>

            <Step n={2} title="The page shows a 6-character code" />

            <Step n={3} title="Pair it">
              <p className="text-xs text-slate-500 mt-0.5">
                Type that code into <span className="font-semibold text-slate-600">Pair Screen</span> below,
                or scan the QR the page is showing with your phone.
              </p>
            </Step>
          </>
        )}
      </div>

      {/* 3 — the two pairing entry points that already exist */}
      <div className="mt-5 pt-4 border-t border-slate-200 flex flex-col sm:flex-row gap-2.5">
        <button
          type="button"
          onClick={onPairScreen}
          disabled={pairDisabled}
          title={pairDisabled ? 'Read-only — viewer role' : undefined}
          data-testid="connect-pair-screen"
          className="min-h-11 px-4 rounded-xl text-white text-sm font-bold shadow-sm inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: 'var(--brand-accent, var(--brand-primary, #4f46e5))' }}
        >
          <Wifi className="w-4 h-4" /> Pair Screen
        </button>
        <button
          type="button"
          onClick={() => setShowPhoneQr((v) => !v)}
          aria-expanded={showPhoneQr}
          data-testid="connect-phone-pair-toggle"
          className="min-h-11 px-4 rounded-xl bg-white border border-slate-200 text-slate-700 text-sm font-bold shadow-sm inline-flex items-center justify-center gap-2 hover:bg-slate-50"
        >
          <Smartphone className="w-4 h-4" />
          {showPhoneQr ? 'Hide phone pairing' : 'Pair from my phone'}
        </button>
      </div>

      {showPhoneQr && (
        <div
          className="mt-3 bg-white rounded-2xl border border-slate-200 p-4 flex flex-col sm:flex-row gap-4 sm:items-center"
          data-testid="connect-phone-qr-panel"
        >
          {wantPhoneQr && phoneQr && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={phoneQr}
              alt="QR code that opens the phone pairing scanner"
              width={120}
              height={120}
              className="shrink-0 self-start"
            />
          )}
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
              <QrCodeIcon className="w-4 h-4 text-slate-400" /> Scan this with your phone
            </p>
            <p className="text-xs text-slate-500 mt-1">
              It opens the pairing scanner. Then point your phone at the code the screen is
              showing — no typing.
            </p>
            <div className="flex items-center gap-2 mt-2">
              <code className="flex-1 min-w-0 px-3 py-2 bg-slate-50 rounded-lg text-[11px] font-mono text-slate-600 select-all break-all">
                {phonePairUrl}
              </code>
              <CopyButton url={phonePairUrl} label="Copy the phone pairing link" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
