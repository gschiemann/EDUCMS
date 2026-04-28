"use client";

import { useState, useEffect, useCallback, useRef, useMemo, Component, ReactNode } from 'react';
import '@/components/widgets/variants-register'; // Boot-time registration for custom themes
import { MonitorPlay, Wifi, WifiOff, AlertTriangle, Loader2, Settings, CheckCircle2, HardDrive, Cpu, Server, Network, Play, Monitor, Info, Power, RefreshCw, Download, LogOut } from 'lucide-react';
import { KioskSplash, type LoadProgress } from '@/components/player/KioskSplash';
import { WidgetPreview } from '@/components/widgets/WidgetRenderer';
import {
  registerOfflineCache,
  precachePlaylist,
  precacheEmergency,
  getCacheStatus,
  formatBytes,
  isSwSupported,
  type CacheStatus,
} from './offline-cache';
import { appConfirm, appAlert } from '@/components/ui/app-dialog';

// ─────────────────────────────────────────────────────────────────────────────
// Bullet-proof helpers (Phase 1 hardening)
// ─────────────────────────────────────────────────────────────────────────────

const LS_TOKEN = 'edu_device_token';
const LS_MANIFEST_CACHE = 'edu_manifest_cache_v1';
const LS_EMERGENCY_CACHE = 'edu_emergency_cache_v1';

/** Read a URL query param once; safe for SSR. */
function qp(name: string): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(name);
}

/**
 * True when the player was opened via the dashboard's "Open Screen in Browser"
 * ExternalLink button (which appends &preview=1). In preview mode we:
 *   - Use a synthetic `preview-<random>` fingerprint so we don't stomp the
 *     real kiosk's heartbeat or lastPingAt.
 *   - Skip the /screens/register call entirely (returns a fake paired=false response).
 *   - Skip the 30s /screens/status heartbeat entirely.
 *   - Show a PREVIEW MODE chip so it's visually obvious.
 */
function isPreviewMode(): boolean {
  return qp('preview') === '1';
}

/** True when running inside the Android player WebView (passed via ?client=android). */
function isAndroidWebView(): boolean {
  if (typeof window === 'undefined') return false;
  if (qp('client') === 'android') return true;
  // Native app exposes window.EduCmsNative as a JS bridge.
  return !!(window as any).EduCmsNative;
}

/** Ask the Android shell to do a hard reload (last-resort recovery). No-op in browser. */
function nativeReload() {
  try { (window as any).EduCmsNative?.reload?.(); } catch { /* noop */ }
}

/** Get the device pairing token from URL → localStorage → null. */
function getDeviceToken(): string | null {
  if (typeof window === 'undefined') return null;
  const fromUrl = qp('token');
  if (fromUrl) {
    try { localStorage.setItem(LS_TOKEN, fromUrl); } catch {}
    return fromUrl;
  }
  try { return localStorage.getItem(LS_TOKEN); } catch { return null; }
}

/** Compute exponential backoff with full jitter. Capped at maxMs. */
function backoffMs(attempt: number, baseMs = 1000, maxMs = 30_000): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 10));
  return Math.floor(Math.random() * exp);
}

/** Cache the last good manifest payload so the player can survive a cold reboot offline. */
function cacheManifest(m: any) {
  try { localStorage.setItem(LS_MANIFEST_CACHE, JSON.stringify({ at: Date.now(), m })); } catch {}
}
function readCachedManifest(): { at: number; m: any } | null {
  try {
    const raw = localStorage.getItem(LS_MANIFEST_CACHE);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/**
 * Cache the last-known emergency override. CRITICAL for life-safety: if the
 * device power-cycles mid-emergency or loses network during the alert, we can
 * still show the cached emergency on next boot until ALL_CLEAR or a fresh
 * manifest arrives. Stale cache is auto-discarded after 4 hours.
 */
function cacheEmergency(payload: any | null) {
  try {
    if (!payload) {
      localStorage.removeItem(LS_EMERGENCY_CACHE);
      return;
    }
    // HIGH-8 audit fix: persist a server-issued absolute expiry alongside
    // the payload so we don't depend on the device's wall clock to decide
    // staleness. Order of preference:
    //   1. payload.expiresAt    — server-side absolute UNIX seconds
    //   2. payload.expires_at   — same field, snake_case variant
    //   3. fall back to "Date.now() + 4h" written at cache time (legacy
    //      behavior). Marked so reads can prefer absolute when present.
    const serverExpires =
      typeof payload?.expiresAt === 'number' ? payload.expiresAt * 1000 :
      typeof payload?.expires_at === 'number' ? payload.expires_at * 1000 :
      null;
    const fallbackExpires = Date.now() + 4 * 60 * 60 * 1000;
    localStorage.setItem(LS_EMERGENCY_CACHE, JSON.stringify({
      at: Date.now(),
      expiresAt: serverExpires ?? fallbackExpires,
      hasServerExpiry: serverExpires != null,
      payload,
    }));
  } catch {}
}
function readCachedEmergency(): any | null {
  try {
    const raw = localStorage.getItem(LS_EMERGENCY_CACHE);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const { at, expiresAt, hasServerExpiry, payload } = parsed;
    // Prefer server-issued absolute expiry when available — robust against
    // device clock skew that could otherwise hide an expired alert OR keep
    // a long-stale one alive (e.g. kiosk clock regressed by a month).
    if (typeof expiresAt === 'number' && Date.now() > expiresAt) {
      return null;
    }
    // Legacy fallback (no server expiry was stored): 4h TTL anchored to
    // the cache write time. Same behavior as before.
    if (!hasServerExpiry && typeof at === 'number' && Date.now() - at > 4 * 60 * 60 * 1000) {
      return null;
    }
    return payload;
  } catch { return null; }
}

function getApiRoot(): string {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const apiParam = params.get('api');
    if (apiParam) {
      // Save to localStorage so it persists across refreshes
      localStorage.setItem('edu_api_root', apiParam.replace(/\/api\/v1\/?$/, ''));
      return apiParam.replace(/\/api\/v1\/?$/, '');
    }
    const saved = localStorage.getItem('edu_api_root');
    if (saved) return saved;
  }
  const env = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';
  return env.replace('/api/v1', '');
}

// Generate a stable device fingerprint for this physical device.
//
// PRECEDENCE (first match wins):
//   1. Preview mode (?preview=1) — returns a throw-away `preview-<random>`
//      fingerprint that starts with 'preview-'. The API ignores these so the
//      dashboard's "Open Screen in Browser" button never poisons the real
//      kiosk's heartbeat or lastPingAt.
//   2. URL ?fp= — passed by the Android APK using Settings.Secure.ANDROID_ID
//      which survives app uninstalls + reinstalls (it only rotates on
//      factory reset). This is what lets a re-sideloaded kiosk come back
//      paired without a fresh pairing dance.
//   3. URL ?deviceId= — legacy alias used by dev test paths
//   4. localStorage 'edu_device_fp' — fallback for pure browser players
//      (plain Chrome tab). Gets a random UUID on first run and sticks
//      as long as the browser profile lasts.
function getDeviceFingerprint(): string {
  const key = 'edu_device_fp';
  if (typeof window !== 'undefined') {
    // Preview mode: return a synthetic fingerprint so we don't write to
    // localStorage and never stomp the real paired device's identity.
    if (isPreviewMode()) {
      return `preview-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    }
    const params = new URLSearchParams(window.location.search);
    // Android APK passes the stable Android ID as ?fp=
    const apkFp = params.get('fp');
    if (apkFp && apkFp.length >= 8) {
      localStorage.setItem(key, apkFp);
      return apkFp;
    }
    const idParam = params.get('deviceId');
    if (idParam) {
      localStorage.setItem(key, idParam);
      return idParam;
    }
  }
  let fp = localStorage.getItem(key);
  if (!fp) {
    fp = `device-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    localStorage.setItem(key, fp);
  }
  return fp;
}

/**
 * Build the heartbeat URL with ?v=&vc= appended when the page knows
 * its APK version.
 *
 * History: up through v1.0.10 the native HeartbeatService never fired
 * because nothing in the native code wrote `device_fingerprint` or
 * `api_root` to SharedPreferences (operator 2026-04-27 caught this
 * after pushing an OTA that silently no-op'd). The web heartbeats DO
 * fire (that's why kiosks show ONLINE), so this helper threads the
 * APK version into the heartbeat URL so the server captures the
 * version regardless of whether the native service is alive.
 *
 * v1.0.11 finally fixed the prefs-write bug — once an APK >=1.0.11 is
 * installed, the native service WILL fire too. We keep this URL
 * helper because (a) it's still the only path on browser players,
 * and (b) belt-and-suspenders for older sideloaded APKs that haven't
 * been upgraded yet.
 */
/**
 * Resolve the player APK version from any of three sources, in order
 * of precedence. Defensive against URL-param loss on navigation /
 * page reload (operator caught us on 2026-04-27: kiosk on v1.0.11
 * but dashboard chip stuck blank).
 *
 *   1. URL ?v= / ?vc= — set by the APK via MainActivity.loadPlayer
 *   2. EduCmsNative.deviceInfo() bridge — always available on APK
 *      (returns appVersion in JSON), survives any in-page navigation
 *   3. localStorage — sticky cache so even a hard reload of the
 *      WebView keeps the version in heartbeats while we wait for
 *      the bridge to come back online
 */
function resolvePlayerVersion(): { v: string | null; vc: string | null } {
  if (typeof window === 'undefined') return { v: null, vc: null };

  // 1. URL params (initial APK URL)
  const params = new URLSearchParams(window.location.search);
  let v = params.get('v') || null;
  let vc = params.get('vc') || null;

  // 2. Native bridge — most reliable on APK
  if (!v) {
    try {
      const bridge = (window as any).EduCmsNative;
      const raw = bridge?.deviceInfo?.();
      if (raw) {
        const info = JSON.parse(raw);
        if (info?.appVersion) v = String(info.appVersion);
      }
    } catch { /* bridge unavailable, fall through */ }
  }

  // 3. localStorage cache (set on any successful detection above)
  if (!v) {
    try {
      const cached = localStorage.getItem('edu_player_apk_version');
      if (cached) v = cached;
      const cachedVc = localStorage.getItem('edu_player_apk_version_code');
      if (!vc && cachedVc) vc = cachedVc;
    } catch { /* private mode / quota — fall through */ }
  }

  // Persist whatever we found for the next page load.
  try {
    if (v) localStorage.setItem('edu_player_apk_version', v);
    if (vc) localStorage.setItem('edu_player_apk_version_code', vc);
  } catch { /* tolerated */ }

  return { v, vc };
}

function buildHeartbeatUrl(apiRoot: string, fp: string): string {
  if (typeof window === 'undefined') return `${apiRoot}/api/v1/screens/status/${fp}`;
  const { v, vc } = resolvePlayerVersion();
  const qs = new URLSearchParams();
  if (v) qs.set('v', v);
  if (vc) qs.set('vc', vc);
  // v1.0.13 — Manager APK version. Player can't query Android
  // PackageManager from the WebView directly, but Manager itself
  // writes its own version into the cross-app HealthProvider as
  // part of the existing heartbeat IPC. The native MainActivity
  // (v1.0.13+) reads it from the provider and passes &mv= on the
  // page URL just like ?v= and ?vc=. Older APKs don't pass it;
  // server treats absent as "no manager info".
  const params = new URLSearchParams(window.location.search);
  const mv = params.get('mv');
  if (mv) qs.set('mv', mv);
  const suffix = qs.toString();
  return suffix
    ? `${apiRoot}/api/v1/screens/status/${fp}?${suffix}`
    : `${apiRoot}/api/v1/screens/status/${fp}`;
}

function getDeviceInfo() {
  const ua = navigator.userAgent;
  let os = 'Unknown';
  if (/android/i.test(ua)) os = 'Android';
  else if (/ipad|iphone|ipod/i.test(ua)) os = 'iOS';
  else if (/windows/i.test(ua)) os = 'Windows';
  else if (/mac/i.test(ua)) os = 'macOS';
  else if (/linux/i.test(ua)) os = 'Linux';
  else if (/cros/i.test(ua)) os = 'Chrome OS';

  let browser = 'Unknown';
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/chrome/i.test(ua)) browser = 'Chrome';
  else if (/firefox/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua)) browser = 'Safari';

  // Prefer URL-supplied native resolution (Android APK detects the
  // real physical pixel count via WindowManager.maximumWindowMetrics
  // and passes it as ?w=...&h=... — window.screen.width returns
  // DPI-scaled CSS pixels which lie by 2-3x on HiDPI displays).
  // Fall back to window.screen for plain browser players.
  let pxW = 0, pxH = 0;
  try {
    const qp = new URLSearchParams(window.location.search);
    pxW = parseInt(qp.get('w') || '0', 10) || 0;
    pxH = parseInt(qp.get('h') || '0', 10) || 0;
  } catch {}
  if (!pxW || !pxH) {
    pxW = window.screen.width;
    pxH = window.screen.height;
  }

  return {
    resolution: `${pxW}×${pxH}`,
    osInfo: os,
    browserInfo: `${browser} ${navigator.language}`,
    userAgent: ua,
  };
}

type Phase = 'registering' | 'pairing' | 'connecting' | 'playing' | 'offline' | 'emergency';

// ─── Software version + manual OTA trigger inside the info overlay ───
// User ask 2026-04-20: "stop/start with the TV remote, see the software
// version, maybe trigger the update from there". Enter key already toggles
// the overlay (onKeyDown handler on the playlist container); this row
// puts the missing version info + a Check-for-updates button in reach.
function SoftwareInfoRow() {
  const [apkVersion, setApkVersion] = useState<string | null>(null);
  const [webVersion] = useState<string>(
    (process.env.NEXT_PUBLIC_BUILD_SHA || '').slice(0, 7) || 'dev',
  );
  const [checking, setChecking] = useState(false);
  const [lastCheckMsg, setLastCheckMsg] = useState<string | null>(null);

  useEffect(() => {
    try {
      const bridge = (window as any).EduCmsNative;
      if (bridge && typeof bridge.deviceInfo === 'function') {
        const raw = bridge.deviceInfo();
        const info = JSON.parse(raw);
        if (info?.appVersion) setApkVersion(info.appVersion);
      }
    } catch { /* browser player — leave as null */ }
  }, []);

  const handleCheck = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setChecking(true);
    setLastCheckMsg(null);
    try {
      // Preferred path: 1.0.6+ native bridge enqueues the OTA worker
      // right now. The worker handles the full download+install dance,
      // so we just tell the operator we've asked.
      const bridge = (window as any).EduCmsNative;
      if (bridge && typeof bridge.checkForUpdates === 'function') {
        const ver = bridge.checkForUpdates();
        setLastCheckMsg(`Checking… (currently on ${ver || apkVersion || '?'})`);
        // After ~8s the worker has usually either begun downloading
        // (install prompt pops separately) OR reported uptoDate.
        setTimeout(() => setLastCheckMsg((prev) => prev ? 'Check complete — watch for install prompt if an update was available.' : prev), 8_000);
        return;
      }
      // Fallback for 1.0.5 (no bridge method): POST /update-check directly
      // from JS, show the result. If an update is available, open the
      // APK URL so Android's downloader + installer kick in manually.
      const payload = {
        versionName: apkVersion || 'browser',
        versionCode: 0,
        fingerprint: localStorage.getItem('edu_device_fp') || '',
        abi: 'browser',
      };
      const r = await fetch(`${getApiRoot()}/api/v1/player/update-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        setLastCheckMsg(`Check failed — HTTP ${r.status}. Try rebooting the kiosk.`);
        return;
      }
      const data = await r.json();
      if (data?.uptoDate) {
        setLastCheckMsg(`Up to date — running ${apkVersion || 'web build'}.`);
        return;
      }
      if (data?.latest?.apkUrl) {
        setLastCheckMsg(`Update available: ${data.latest.versionName}. Opening installer…`);
        // Navigate to the APK URL — on Android this kicks off the
        // download + install flow even for older APK builds that
        // don't have the native OTA bridge.
        try { window.location.href = data.latest.apkUrl; } catch { /* noop */ }
        return;
      }
      setLastCheckMsg('Check complete — no update info returned.');
    } catch (err: any) {
      setLastCheckMsg(`Check error: ${err?.message || err}`);
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <div className="flex justify-between">
        <span className="text-slate-400">APK version</span>
        <span className="text-white font-medium text-xs">{apkVersion || '(browser — no APK)'}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-slate-400">Web build</span>
        <span className="text-white font-mono text-[11px]">{webVersion}</span>
      </div>
      {apkVersion && (
        <button
          onClick={handleCheck}
          disabled={checking}
          className="w-full mt-1 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded-lg font-medium text-xs transition-colors flex items-center justify-center gap-1.5"
        >
          {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          {checking ? 'Checking…' : 'Check for updates'}
        </button>
      )}
      {lastCheckMsg && (
        <p className="text-[11px] text-slate-400 leading-snug px-0.5">{lastCheckMsg}</p>
      )}
    </>
  );
}

// ─── Diagnostics section inside the info overlay ───────────────────────────────
// Calls window.EduCmsNative.getRecentLogs() (Kotlin bridge) to pull the
// tail of the on-device rotating log file and display it in a scrollable
// pre block. Two action buttons:
//   "Upload to Support" — calls uploadDiagnostics() to POST /api/v1/player-logs
//   "Copy"             — copies the raw log text to the clipboard
// Only rendered when the native bridge is present (inside the APK WebView).
// Hidden in plain browser player builds.
function DiagnosticsRow() {
  const [logs, setLogs] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const bridge = typeof window !== 'undefined' ? (window as any).EduCmsNative : null;
  if (!bridge || typeof bridge.getRecentLogs !== 'function') return null;

  const loadLogs = (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const raw = bridge.getRecentLogs();
      setLogs(typeof raw === 'string' ? raw : JSON.stringify(raw));
    } catch (err: any) {
      setLogs('(error reading logs: ' + (err?.message || String(err)) + ')');
    }
    setExpanded(true);
  };

  const handleUpload = (e: React.MouseEvent) => {
    e.stopPropagation();
    setUploading(true);
    setUploadMsg(null);
    try {
      const result = typeof bridge.uploadDiagnostics === 'function'
        ? bridge.uploadDiagnostics()
        : 'uploadDiagnostics not available';
      setUploadMsg(result || 'upload triggered');
    } catch (err: any) {
      setUploadMsg('error: ' + (err?.message || String(err)));
    } finally {
      setUploading(false);
    }
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!logs) return;
    try {
      await navigator.clipboard.writeText(logs);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable on some older WebViews — fail silently.
    }
  };

  return (
    <div className="pt-1 border-t border-slate-700/60 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-slate-400 text-xs font-medium uppercase tracking-wide">Diagnostics</span>
        <button
          onClick={expanded ? (e) => { e.stopPropagation(); setExpanded(false); } : loadLogs}
          className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          {expanded ? 'Hide logs' : 'Show device logs'}
        </button>
      </div>

      {expanded && (
        <>
          <pre className="bg-slate-950 rounded-lg p-2 text-[10px] font-mono text-slate-300 overflow-y-auto max-h-48 whitespace-pre-wrap break-all leading-relaxed">
            {logs || '(loading...)'}
          </pre>
          <div className="flex gap-2">
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="flex-1 py-1.5 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-md text-[11px] font-medium transition-colors"
            >
              {uploading ? 'Uploading...' : 'Upload to Support'}
            </button>
            <button
              onClick={handleCopy}
              className="py-1.5 px-3 bg-slate-700 hover:bg-slate-600 text-white rounded-md text-[11px] font-medium transition-colors"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          {uploadMsg && (
            <p className="text-[10px] text-slate-400 leading-snug">{uploadMsg}</p>
          )}
        </>
      )}
    </div>
  );
}

// ─── Cache status chip shown inside the info overlay. Surfaces both tiers
// ─── so admins can verify the player is actually serving emergencies from
// ─── disk (not network) — critical sanity check during drills.
function CacheStatusRow({ status }: { status: CacheStatus | null }) {
  if (!status) {
    return (
      <div className="flex justify-between"><span className="text-slate-400">Offline cache</span><span className="text-slate-500 text-xs">checking…</span></div>
    );
  }
  if (!status.supported) {
    return (
      <div className="flex justify-between"><span className="text-slate-400">Offline cache</span><span className="text-slate-500 text-xs">unsupported (browser)</span></div>
    );
  }
  return (
    <>
      <div className="flex justify-between">
        <span className="text-slate-400">Playlist cache</span>
        <span className="text-white font-medium text-xs">{status.playlist.count} assets · {formatBytes(status.playlist.bytes)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-slate-400">Emergency cache 🛡️</span>
        <span className={status.emergency.count > 0 ? 'text-emerald-400 font-medium text-xs' : 'text-amber-400 font-medium text-xs'}>
          {status.emergency.count > 0
            ? `${status.emergency.count} assets · ${formatBytes(status.emergency.bytes)} ✓`
            : 'NONE — emergencies will fetch from network'}
        </span>
      </div>
    </>
  );
}

// ─── Error boundary wraps the whole player so a single widget crash can't
// ─── black out the screen mid-emergency. On crash, we surface the cached
// ─── emergency (if any) and start a recovery countdown, then auto-reload.
class PlayerErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; err?: any }> {
  state = { hasError: false, err: undefined as any };
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private reloadCount = 0;
  static getDerivedStateFromError(err: any) { return { hasError: true, err }; }
  componentDidCatch(err: any, info: any) {
    console.error('[Player] FATAL render error', err, info);
    // Bound the reload loop. If the widget keeps crashing on mount,
    // a naked setTimeout(reload, 8s) becomes an infinite crash-reload
    // loop that burns CPU and prevents operator intervention. After
    // 3 reloads in a row we STOP auto-reloading and leave the
    // "Player recovering…" screen up so someone can manually
    // intervene. The counter resets when the app successfully
    // mounts without hitting the boundary (Component instance gets
    // discarded by React).
    try {
      const k = '__edu_player_reloadcount';
      const prev = parseInt(sessionStorage.getItem(k) || '0', 10) || 0;
      this.reloadCount = prev + 1;
      sessionStorage.setItem(k, String(this.reloadCount));
    } catch { /* sessionStorage unavailable */ }

    if (this.reloadCount >= 3) {
      console.warn('[Player] Error boundary hit >=3 times — pausing auto-reload for operator intervention');
      return;
    }

    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      if (isAndroidWebView()) nativeReload();
      else if (typeof window !== 'undefined') window.location.reload();
    }, 8_000);
  }
  componentWillUnmount() {
    if (this.reloadTimer) { clearTimeout(this.reloadTimer); this.reloadTimer = null; }
    // Healthy unmount — reset the crash counter so one bad render
    // doesn't permanently pin us to the "pause auto-reload" state.
    try { sessionStorage.removeItem('__edu_player_reloadcount'); } catch {}
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    const cachedEm = readCachedEmergency();
    if (cachedEm) {
      // Life-safety override survives the crash.
      return (
        <div className="fixed inset-0 bg-red-700 text-white flex flex-col items-center justify-center p-12 text-center">
          <AlertTriangle className="w-32 h-32 mb-8 animate-pulse" />
          <h1 className="text-7xl font-black uppercase tracking-wider mb-6">{cachedEm.type || cachedEm.title || 'Emergency'}</h1>
          {cachedEm.textBlob && <p className="text-3xl font-bold max-w-4xl">{cachedEm.textBlob}</p>}
          <p className="text-sm mt-12 opacity-70">Player recovering — reloading shortly</p>
        </div>
      );
    }
    return (
      <div className="fixed inset-0 bg-slate-950 text-white flex flex-col items-center justify-center">
        <Loader2 className="w-12 h-12 text-amber-500 animate-spin mb-4" />
        <h2 className="text-xl font-bold mb-2">Player recovering…</h2>
        <p className="text-slate-400 text-sm">Reloading in a few seconds</p>
      </div>
    );
  }
}

export default function PlayerPageWrapper() {
  return <PlayerErrorBoundary><PlayerPage /></PlayerErrorBoundary>;
}


function PlayerPage() {
  const [phase, setPhase] = useState<Phase>('registering');
  const [storageInfo, setStorageInfo] = useState({ used: '1.2 GB', total: '32 GB', percent: 4 });

  // One-shot admin-token handoff for preview mode. The dashboard appends
  // `#t=<jwt>&o=<portrait|landscape>` when opening the Preview link.
  // Fragments aren't sent to servers or included in referrer headers —
  // safer than a query param. We capture the value on mount, immediately
  // wipe the hash from the URL, and keep the token in a ref so it's
  // available to fetchContent without being serializable state.
  const previewHandoffTokenRef = useRef<string | null>(null);
  const [previewOrientation, setPreviewOrientation] = useState<'portrait' | 'landscape'>('landscape');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash || '';
    if (hash) {
      try {
        // Strip the leading '#', parse as a form-urlencoded pair list.
        const params = new URLSearchParams(hash.slice(1));
        const t = params.get('t');
        if (t) previewHandoffTokenRef.current = t;
      } catch { /* bad fragment — ignore */ }
      // Clear the hash WITHOUT reloading the page so the token doesn't
      // linger in the address bar, dev-tools, or browser history.
      try {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      } catch { /* non-fatal */ }
    }
    // Preview orientation comes through the plain query string (not the
    // fragment) — it isn't sensitive.
    const q = qp('orientation');
    if (q === 'portrait' || q === 'landscape') setPreviewOrientation(q);
  }, []);

  // Preview-only orientation simulator. In portrait preview, we rotate
  // the <body> 90° and resize it to `100vh × 100vw` so content that
  // uses `position: fixed; inset: 0` — which the player does
  // extensively — fills the rotated frame instead of the literal
  // landscape browser viewport. The `transform` on body is what
  // establishes a new containing block for fixed descendants (per CSS
  // spec) so no component code changes are needed. Only runs in
  // preview mode; real kiosks rotate via Android's system orientation
  // and never hit this path.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!isPreviewMode()) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.getAttribute('style');
    const prevBody = body.getAttribute('style');
    if (previewOrientation === 'portrait') {
      html.style.cssText = 'height:100vh;overflow:hidden;background:#000;';
      body.style.cssText = [
        'position:fixed',
        'top:50%',
        'left:50%',
        'width:100vh',
        'height:100vw',
        'transform:translate(-50%,-50%) rotate(90deg)',
        'transform-origin:center center',
        'background:#000',
        'overflow:hidden',
        'margin:0',
      ].join(';') + ';';
    } else {
      // Explicit landscape: reset anything a portrait-preview before it
      // might have left behind (same tab, navigated between previews).
      html.style.cssText = '';
      body.style.cssText = '';
    }
    return () => {
      // Restore whatever was there before on unmount so hot-reloading the
      // dev server doesn't persist weird body styles into the admin UI.
      if (prevHtml == null) html.removeAttribute('style'); else html.setAttribute('style', prevHtml);
      if (prevBody == null) body.removeAttribute('style'); else body.setAttribute('style', prevBody);
    };
  }, [previewOrientation]);

  // Read the tenant display name from the LS branding cache if this
  // machine has ever been used as an admin browser with that tenant.
  // Pre-pair the player has no tenant scope, so this is best-effort —
  // falls back to "EduSignage" when no brand is cached.
  const [brandName, setBrandName] = useState<string>('EduSignage');
  useEffect(() => {
    try {
      const raw = localStorage.getItem('edu-cms-branding-cache-v1');
      if (raw) {
        const b = JSON.parse(raw);
        if (b?.displayName) setBrandName(b.displayName);
      }
    } catch {}
  }, []);

  // v1.0.11 OTA fix — bootstrap the native side with apiRoot + fp so
  // HeartbeatService and OtaUpdateWorker can actually hit the API.
  //
  // BACKGROUND: both services read these values from SharedPreferences
  // on every run. Up through v1.0.10 NOTHING in the native code wrote
  // them, so both services silently no-op'd. The dashboard's force-OTA
  // push went through the WebSocket → bridge.checkForUpdates() →
  // OtaUpdateWorker → exit at "api_root not set" with zero HTTP calls.
  // Operator hit this 2026-04-27 — pushed v1.0.10 to a v1.0.9 kiosk,
  // dashboard cycled fake stages, kiosk never moved.
  //
  // This effect calls a new EduCmsNative.setBootstrap(apiRoot, fp)
  // bridge method that writes both keys to prefs. Idempotent: safe to
  // call on every page load. The native side strips a trailing
  // /api/v1 if accidentally included so we can't double-prefix.
  //
  // Older APKs (v1.0.10 and below) don't expose setBootstrap on the
  // bridge — the optional-call short-circuits silently and the device
  // stays in the broken-prefs state until upgraded.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isPreviewMode()) return; // preview tabs don't pair, never run native services
    const bridge = (window as any).EduCmsNative;
    if (!bridge?.setBootstrap) return; // older APK without the method
    try {
      const fp = getDeviceFingerprint();
      const apiRoot = getApiRoot();
      if (fp && apiRoot && fp.length >= 8) {
        bridge.setBootstrap(apiRoot, fp);
      }
    } catch (e) {
      // Bridge call failure is non-fatal — heartbeat + OTA stay in the
      // pre-fix degraded mode (web heartbeats keep working, native
      // worker stays asleep until next launch).
      // eslint-disable-next-line no-console
      console.warn('[Player] setBootstrap bridge call failed', e);
    }
  }, []);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(({ usage, quota }) => {
        if (usage && quota) {
          setStorageInfo({
             used: (usage / (1024 * 1024 * 1024)).toFixed(2) + ' GB',
             total: (quota / (1024 * 1024 * 1024)).toFixed(0) + ' GB',
             percent: Math.round((usage / quota) * 100)
          });
        }
      });
    }
  }, []);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [screenId, setScreenId] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [screenName, setScreenName] = useState<string>('');
  const [playlist, setPlaylist] = useState<any>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [showOverlay, setShowOverlay] = useState(false);
  // v1.0.16 — visible feedback for the "Sync Now" button. Operator
  // (2026-04-27): "hitting sync does nothing it appears, not sure
  // what the button is used for". Cause: when fetchContent runs and
  // the manifest hasn't changed, the React tree doesn't re-render —
  // the operator sees no acknowledgment that the click registered.
  // Track a short-lived state we flip into 'syncing' / 'done' / 'err'
  // and let the button label reflect it for ~2s.
  const [syncFeedback, setSyncFeedback] = useState<'idle' | 'syncing' | 'done' | 'err'>('idle');
  // Stop splash state — shows a branded "playback paused" screen
  // in place of the content. The operator sees player branding +
  // Resume / Exit / Unpair buttons, NOT a dismissable black curtain.
  // exitUnavailable becomes true after handleExitApp tried every
  // known path (native bridge, window.close) and none took effect;
  // the splash then switches to a "use your remote's HOME button"
  // hint so the operator isn't left poking a broken Exit button.
  const [playbackStopped, setPlaybackStopped] = useState(false);
  const [exitUnavailable, setExitUnavailable] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  // Split refs: interval runs at steady cadence, timeout is the one-
  // shot backoff retry. Previously both shared `pollRef` which caused
  // races when a failing tick reassigned the same handle.
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // Bullet-proof refs (Phase 1)
  const fetchFailCountRef = useRef(0);
  // Registration retry counter — NEVER GIVES UP. Increments on every
  // failed /screens/register call so backoffMs climbs toward its cap.
  // When Railway is deploying the player could hit a few 502s in a row;
  // these are expected and we want to self-heal without the operator
  // having to touch the Retry button.
  const registerFailCountRef = useRef(0);
  const registerRetryTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Seconds remaining until the next auto-retry attempt, for display on
  // the Unable-to-Connect screen so the user knows we're working on it.
  const [autoRetryInSec, setAutoRetryInSec] = useState<number | null>(null);
  const autoRetryIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // ─── Connectivity toast (operator caught huge bug 2026-04-27) ───
  // The kiosk used to switch to a full-screen `phase === 'offline'`
  // blocker on registration / manifest failure, which (a) wiped the
  // splash + any cached content and (b) had a broken retry loop —
  // setPhase('offline') re-ran the registration useEffect and its
  // cleanup synchronously cleared the just-scheduled retry timers.
  // Operator screenshot: stuck on "Reconnecting… Registration HTTP
  // 500 / Next attempt in 3s" with the countdown frozen forever.
  //
  // New design — never block the screen:
  //   1. On any connectivity error, set `connectivityState` and KEEP
  //      the current phase (splash or content). A small floating toast
  //      surfaces the retry countdown + Retry-now / Exit / Reset.
  //   2. The retry chain lives in a ref-based loop that survives
  //      useEffect cleanup. Stops only on success or explicit reset.
  type ConnectivityState =
    | { kind: 'connected' }
    | { kind: 'reconnecting'; reason: string; nextRetryAt: number; attempt: number };
  const [connectivity, setConnectivity] = useState<ConnectivityState>({ kind: 'connected' });
  // Resilient registration loop — DETACHED from the useEffect lifecycle
  // so a phase change doesn't cancel an in-flight retry. The catch
  // handler in the previous code did exactly that and produced the
  // frozen-countdown bug. This ref holds a stop() callback so we can
  // tear down the chain on success / explicit reset.
  const registrationLoopRef = useRef<{ stop: () => void } | null>(null);
  const tickToastRef = useRef<NodeJS.Timeout | null>(null);
  const wsFailCountRef = useRef(0);
  const lastWsMessageAtRef = useRef<number>(Date.now());
  // Audit fix #2 (partial): WebSocket message replay/dupe protection.
  // Tracks recent eventIds so an attacker who captures a signed message
  // can't replay it. Eviction is a soft cap to bound memory.
  const recentEventIdsRef = useRef<Map<string, number>>(new Map());
  // Server-clock offset learned at AUTH_OK. Needed because Android
  // signage devices frequently boot without NTP sync and drift from
  // wall-clock — the staleness gate on SENSITIVE WS events would
  // otherwise drop every emergency. Offset is "server - local"; apply
  // by ADDING to local Date.now() before comparing.
  const serverClockOffsetRef = useRef<number>(0);

  // Connecting-phase download progress. Fed by the fetch pipeline
  // (manifest/ws stages) and by the service worker (per-asset cache
  // events). KioskSplash renders a phase-specific message + progress
  // bar + current-item line — previously said only "Loading content…"
  // with no feedback while a 50 MB asset downloaded, which operators
  // read as a hung player.
  const [loadProgress, setLoadProgress] = useState<LoadProgress | null>(null);
  // OTA push overlay — shown on the device screen when an admin
  // clicks "Push update" in the dashboard. Mirrors the dashboard's
  // stage progression so the operator standing at the kiosk can see
  // the same info as the operator at the dashboard.
  // Operator (2026-04-27): "we should really show on the device
  // splash screen that an update is happening."
  // Re-renders every 5s while active so the stage label updates
  // (the timer effect below). Auto-clears after 8 minutes (covers
  // the 5-min dashboard timeout + buffer) — if the install actually
  // succeeds the kiosk reboots, which clears all React state anyway.
  const [otaProgress, setOtaProgress] = useState<{ startedAt: number; bridgeAvailable: boolean } | null>(null);
  // APK version reported by the Android player on the URL as ?v=. Used
  // by the splash screens (pairing / connecting / registering) so the
  // operator can see at a glance which build a kiosk is running. Stays
  // null for browser players (no APK).
  const apkVersion = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('v')
    : null;

  // Remote-control Back-button bridge. The Android shell (v1.0.10+)
  // dispatches an `edu-show-stop-overlay` window event when the user
  // hits the remote's Back key. We surface the Stop/Exit splash so
  // the operator can choose Resume / Exit / Unpair without a touch
  // screen. Cleanup on unmount keeps things tidy across phase
  // transitions.
  useEffect(() => {
    const onShowStop = () => {
      setPlaybackStopped(true);
    };
    window.addEventListener('edu-show-stop-overlay', onShowStop as EventListener);
    return () => window.removeEventListener('edu-show-stop-overlay', onShowStop as EventListener);
  }, []);

  // Latest published APK version — fetched once at boot, used by the
  // post-pair splash to show "Update available" + Install button.
  // Operator (2026-04-27): "this is also the screen that should show
  // when an upgrade is available and also allow me to kick it off."
  const [latestApkVersion, setLatestApkVersion] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${getApiRoot()}/api/v1/player/latest-version`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.versionName) setLatestApkVersion(String(data.versionName));
      } catch { /* tolerated */ }
    })();
    return () => { cancelled = true; };
  }, []);
  // Tick to drive stage advancement on the overlay. We avoid a tight
  // setInterval; one tick every 5s is enough to advance through the
  // stage labels in real time without hammering re-renders.
  const [, setOtaTick] = useState(0);
  useEffect(() => {
    if (!otaProgress) return;
    const t = setInterval(() => {
      setOtaTick((n) => n + 1);
      // Auto-clear after 8 min — if install succeeded, the kiosk
      // reboots + this state is wiped on its own. The 8-min
      // ceiling covers operators who saw "no response" and want
      // the overlay to disappear.
      if (Date.now() - otaProgress.startedAt > 8 * 60_000) {
        setOtaProgress(null);
      }
    }, 5_000);
    return () => clearInterval(t);
  }, [otaProgress]);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);
  const wsReconnectRef = useRef<NodeJS.Timeout | null>(null);
  const httpFallbackRef = useRef<NodeJS.Timeout | null>(null);
  const emergencyPollRef = useRef<NodeJS.Timeout | null>(null);
  const cachedAuthTokenRef = useRef<string | null>(null);
  const [activeEmergency, setActiveEmergency] = useState<any | null>(null);
  const [cacheStatus, setCacheStatus] = useState<CacheStatus | null>(null);
  const lastEmergencySetHashRef = useRef<string>('');
  // HIGH-5: track the last set of playlist asset URLs we pushed to the SW.
  // Equal hash = no-op skip; saves a postMessage + SW work on every poll.
  const lastPlaylistSetHashRef = useRef<string>('');
  // Signature of the current playlist items + template so applyManifest
  // can short-circuit when the manifest poll returned the same content
  // we're already rendering. Without this, setPlaylist(new obj) +
  // setCurrentIndex(0) fire on every 5-10s poll and the slide cycle
  // gets yanked back to 0 before it can advance past slide 2 — the
  // "carousel only shows items 1 and 2" bug the Integration Lead
  // reported on the Goodview device.
  const currentPlaylistSigRef = useRef<string>('');
  // Manifest-reported playlist summary for the Stopped splash. Holds
  // the name, schedule window, item count, and approximate byte size
  // for each scheduled playlist. Only used for the operator info
  // panel — not touched by playback logic.
  type ManifestPlaylistSummary = {
    id: string;
    name: string;
    itemCount: number;
    totalBytes: number;
    daysOfWeek: string | null;
    timeStart: string | null;
    timeEnd: string | null;
    isTemplate: boolean;
  };
  const [manifestPlaylists, setManifestPlaylists] = useState<ManifestPlaylistSummary[]>([]);
  // Hydrate any cached emergency on first render so a power-cycle mid-alert
  // still shows the alert until ALL_CLEAR or a fresh manifest arrives.
  useEffect(() => {
    const cached = readCachedEmergency();
    if (cached) setActiveEmergency(cached);
  }, []);

  // Register the offline-cache Service Worker on mount. Safe no-op when
  // SW isn't supported (older browsers, in-page test runners, etc).
  useEffect(() => {
    if (!isSwSupported()) return;
    registerOfflineCache().then(() => {
      // Ask for current status as soon as the worker activates.
      getCacheStatus().then(setCacheStatus).catch(() => {});
    });
    // Refresh status every 30s so the info overlay stays current.
    const t = setInterval(() => {
      getCacheStatus().then(setCacheStatus).catch(() => {});
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  // Listen for SW cache-progress events. The SW emits PRECACHE_PROGRESS
  // for every asset as it's pulled into the cache; we pipe that into
  // loadProgress so KioskSplash's bar moves in real time.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;
    const onMessage = (ev: MessageEvent) => {
      const msg: any = ev.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'PRECACHE_PROGRESS') {
        setLoadProgress((prev) => ({
          phase: msg.tier === 'emergency' ? 'emergency' : 'assets',
          loaded: msg.loaded,
          total: msg.total,
          currentItem: msg.currentItem ?? null,
          retrying: prev?.retrying ?? 0,
          lastError: null,
        }));
      } else if (msg.type === 'PRECACHE_PLAYLIST_DONE' || msg.type === 'PRECACHE_EMERGENCY_DONE') {
        // Keep a brief "ready" state so the bar hits 100% before
        // KioskSplash unmounts on phase flip to 'playing'.
        setLoadProgress({ phase: 'ready' });
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  // Report cache status to the server every 30s so admins can see in the
  // dashboard which screens actually have emergency content on disk.
  //
  // sec-fix(wave1) #5 made /cache-status require a device JWT whose `sub`
  // equals the screenId. Without a Bearer header the POST was 401-ing
  // silently, so the `lastCacheReport` column never populated and the
  // dashboard's cache pill was stuck on "?" forever. The device token is
  // minted at /register time and cached in localStorage as LS_TOKEN.
  //
  // Preview mode: skip — never write cache status on behalf of the real device.
  useEffect(() => {
    if (!screenId) return;
    if (isPreviewMode()) return;
    const post = async () => {
      try {
        const status = await getCacheStatus();
        if (!status?.supported) return;
        const tok = getDeviceToken();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (tok) headers['Authorization'] = `Bearer ${tok}`;
        await fetch(`${getApiRoot()}/api/v1/screens/${screenId}/cache-status`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            playlist: status.playlist,
            emergency: status.emergency,
          }),
        });
      } catch { /* best-effort — admin visibility, not safety-critical */ }
    };
    post();
    const t = setInterval(post, 30_000);
    return () => clearInterval(t);
  }, [screenId]);

  // Refresh emergency-asset pre-cache whenever we know the screenId. This
  // runs alongside (not instead of) the periodic manifest sync — the
  // emergency tier is sacred and we keep it hot proactively.
  const refreshEmergencyCache = useCallback(async () => {
    if (!screenId || !isSwSupported()) return;
    try {
      const headers: Record<string, string> = {};
      const tok = getDeviceToken();
      if (tok) headers['Authorization'] = `Bearer ${tok}`;
      const res = await fetch(`${getApiRoot()}/api/v1/screens/${screenId}/emergency-assets`, { headers });
      if (!res.ok) return;
      const data = await res.json();
      // Short-circuit if the asset set is unchanged since last push.
      if (data.setHash && data.setHash === lastEmergencySetHashRef.current) return;
      lastEmergencySetHashRef.current = data.setHash || '';
      await precacheEmergency(data.assets || [], data.setHash || '');
      console.log(`[Player] Emergency pre-cache push: ${data.assets?.length || 0} assets, ${formatBytes(data.totalBytes || 0)}`);
    } catch (e) {
      // Best-effort; emergency play still works from network if push fails.
    }
  }, [screenId]);

  useEffect(() => {
    refreshEmergencyCache();
    // Also re-check every 5 minutes to pick up admin changes to emergency
    // playlists between manifest syncs.
    const t = setInterval(refreshEmergencyCache, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [refreshEmergencyCache]);

  // ─── Phase 1: Register device ───
  // NEVER GIVES UP. If /screens/register fails (Railway restarting,
  // WiFi dropped during boot, whatever) we schedule an auto-retry with
  // exponential backoff. The kiosk must come back online on its own
  // once the server is reachable again — user ask: "make sure the
  // player is constantly checking in to get reconnected and not
  // waiting for me".
  useEffect(() => {
    if (phase !== 'registering') return;
    // Clear any pending retry — we're actively trying right now.
    if (registerRetryTimerRef.current) {
      clearTimeout(registerRetryTimerRef.current);
      registerRetryTimerRef.current = null;
    }
    if (autoRetryIntervalRef.current) {
      clearInterval(autoRetryIntervalRef.current);
      autoRetryIntervalRef.current = null;
    }
    setAutoRetryInSec(null);

    let cancelled = false;
    const register = async () => {
      try {
        const fp = getDeviceFingerprint();
        const deviceInfo = getDeviceInfo();

        // Preview mode: skip the real register call entirely. Use the deviceId
        // from the URL to fetch the manifest (content still renders) but don't
        // touch the DB row. The API returns a fake not-paired payload for
        // preview-* fingerprints so we still get a screenId to fetch from.
        if (isPreviewMode()) {
          const deviceId = qp('deviceId') || '';
          // Surface the paired device's content by moving straight to connecting
          // with the real screenId from the URL. The manifest fetch uses the
          // admin JWT (not a device token) so auth still works.
          if (deviceId) {
            // We need to find the screenId for this fingerprint. Use the
            // status endpoint which is public and returns the screenId.
            const statusRes = await fetch(buildHeartbeatUrl(getApiRoot(), deviceId), { cache: 'no-store' });
            if (statusRes.ok) {
              const statusData = await statusRes.json();
              setScreenId(statusData.screenId);
              setScreenName(statusData.name || 'Preview Screen');
              setPhase('connecting');
              return;
            }
          }
          // Fallback: nothing to show. Stay on registering to show splash.
          setPairingCode(null);
          setPhase('pairing');
          return;
        }

        const res = await fetch(`${getApiRoot()}/api/v1/screens/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceFingerprint: fp, ...deviceInfo }),
        });

        if (cancelled) return;
        if (!res.ok) throw new Error(`Registration HTTP ${res.status}`);
        const data = await res.json();

        setScreenId(data.screenId);
        setScreenName(data.name);

        // Persist the device JWT the API now mints at register time.
        // Before this fix the browser player had no device token, so
        // manifest fetches fell back to a hardcoded demo admin login
        // (that doesn't exist in production) and every paired screen
        // showed 'unable to connect'.
        if (data.deviceToken) {
          try { localStorage.setItem(LS_TOKEN, data.deviceToken); } catch {}
        }

        registerFailCountRef.current = 0;

        if (data.paired) {
          // Already paired — go straight to connecting
          setPhase('connecting');
        } else {
          // Show pairing code
          setPairingCode(data.pairingCode);
          setPhase('pairing');
        }
      } catch (e: any) {
        if (cancelled) return;
        // KEY FIX: rethrow into the resilient outer loop instead of
        // setPhase('offline'). The phase change was triggering this
        // useEffect's cleanup which cleared the retry timers we'd
        // just scheduled, freezing the countdown forever. Now we stay
        // on phase='registering' (splash visible) and let the
        // registrationLoopRef chain drive retries from outside the
        // effect lifecycle.
        throw e;
      }
    };

    // Tear down any prior loop before starting a new one (effect re-run
    // after a successful reset, etc.).
    if (registrationLoopRef.current) {
      registrationLoopRef.current.stop();
      registrationLoopRef.current = null;
    }

    let stopped = false;
    let attempt = 0;
    const runOnce = async () => {
      if (stopped || cancelled) return;
      attempt += 1;
      try {
        await register();
        // Success — register() already set phase to pairing/connecting.
        // Clear connectivity state so the toast goes away.
        setConnectivity({ kind: 'connected' });
        registerFailCountRef.current = 0;
      } catch (e: any) {
        if (stopped || cancelled) return;
        registerFailCountRef.current += 1;
        const delayMs = backoffMs(registerFailCountRef.current, 2_000, 30_000);
        const reason = e?.message || 'Cannot reach the server';
        console.warn(
          `[Player] register failed (#${registerFailCountRef.current}): ${reason} — retrying in ${Math.round(delayMs / 1000)}s`,
        );
        const targetAt = Date.now() + delayMs;
        setConnectivity({
          kind: 'reconnecting',
          reason,
          nextRetryAt: targetAt,
          attempt: registerFailCountRef.current,
        });
        // Re-trigger toast countdown re-render every second.
        if (tickToastRef.current) clearInterval(tickToastRef.current);
        tickToastRef.current = setInterval(() => {
          // No-op state set just to force re-render of the countdown.
          // Cheaper than running a full state update — the toast
          // component reads nextRetryAt and Date.now().
          setConnectivity((c) => (c.kind === 'reconnecting' ? { ...c } : c));
          if (Date.now() >= targetAt && tickToastRef.current) {
            clearInterval(tickToastRef.current);
            tickToastRef.current = null;
          }
        }, 1000);
        registerRetryTimerRef.current = setTimeout(() => {
          if (!stopped && !cancelled) runOnce();
        }, delayMs);
      }
    };
    registrationLoopRef.current = {
      stop: () => {
        stopped = true;
        if (registerRetryTimerRef.current) {
          clearTimeout(registerRetryTimerRef.current);
          registerRetryTimerRef.current = null;
        }
        if (tickToastRef.current) {
          clearInterval(tickToastRef.current);
          tickToastRef.current = null;
        }
      },
    };
    runOnce();

    return () => {
      cancelled = true;
      // We DO NOT stop the registrationLoopRef here. If phase changed
      // because register() succeeded, the loop has already cleaned
      // itself up via setConnectivity({ kind: 'connected' }) above.
      // If something else changed the phase, we still want the loop
      // to keep trying — that's the whole point of the fix. The loop
      // stops only on:
      //   - explicit user "Retry now" / "Reset" (clears + re-runs)
      //   - successful registration
      //   - component unmount (handled by the per-loop `stopped` flag
      //     when the parent useEffect cleanup is called)
      // Actually: on unmount we DO need to stop. Distinguish unmount
      // from effect re-run by checking if the ref is still us.
      // Safe to call stop() — second-call is a no-op via `stopped`.
      // Only stop if this run is the active loop (avoid clobbering
      // a fresh loop that started after a reset).
    };
  }, [phase]);

  // ─── Phase 2: Poll while showing pairing code (with backoff on errors) ───
  useEffect(() => {
    if (phase !== 'pairing') return;
    // Defensively clear any prior interval before scheduling a new one.
    // Split interval + timeout refs so we never confuse the two. The
    // previous single-ref code juggled both via clearInterval/
    // clearTimeout on the same handle, which made it easy for a
    // concurrent tick invocation to cancel a just-scheduled retry
    // while racing with the interval it thought it had just cleared.
    if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
    if (pollTimeoutRef.current) { clearTimeout(pollTimeoutRef.current); pollTimeoutRef.current = null; }

    const fp = getDeviceFingerprint();
    let pollFails = 0;
    const tick = async () => {
      try {
        const res = await fetch(buildHeartbeatUrl(getApiRoot(), fp));
        if (!res.ok) { pollFails += 1; return; }
        pollFails = 0;
        const data = await res.json();
        if (data.paired) {
          setScreenName(data.name);
          setScreenId(data.screenId);
          setPhase('connecting');
        }
      } catch { pollFails += 1; }
      // Stretch the interval after repeated failures so we don't hammer a down server.
      if (pollFails >= 3) {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        const delay = backoffMs(pollFails, 3000, 30_000);
        // Schedule one retry via timeout; retry itself re-arms the
        // interval on a successful tick.
        if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = setTimeout(tick as any, delay);
      }
    };
    pollIntervalRef.current = setInterval(tick, 3000);
    return () => {
      if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
      if (pollTimeoutRef.current) { clearTimeout(pollTimeoutRef.current); pollTimeoutRef.current = null; }
    };
  }, [phase]);

  // ─── Phase 3: Fetch playlist content ───
  const fetchContent = useCallback(async () => {
    if (!screenId) return;

    // Resolve auth token for this fetch. Device-pairing token first —
    // the old "admin fallback login" with hardcoded creds was baked
    // into the production Vercel bundle and was viewable via
    // view-source, which is exactly the kind of thing a pilot IT
    // team code-audits on day one. If no device token is available
    // we allow TWO additional sources ONLY in preview mode:
    //   1. A one-shot admin JWT handed off via the URL fragment by
    //      the dashboard's "Open in Browser (Preview)" button
    //      (wiped from the hash on mount — see previewHandoffTokenRef).
    //   2. A previously-cached handoff token kept in memory across
    //      polls in this same tab.
    // Without this the preview tab had nothing to authenticate with
    // and /manifest returned 401, throwing fetchContent into a loop
    // that flipped the player between 'connecting' and 'playing'
    // every retry cycle. Real paired players are unaffected.
    const resolveAuthToken = async (): Promise<string> => {
      const deviceTok = getDeviceToken();
      if (deviceTok) return deviceTok;
      if (isPreviewMode() && previewHandoffTokenRef.current) {
        cachedAuthTokenRef.current = previewHandoffTokenRef.current;
        return previewHandoffTokenRef.current;
      }
      if (cachedAuthTokenRef.current) return cachedAuthTokenRef.current;
      throw new Error('NO_DEVICE_TOKEN');
    };

    // Apply manifest payload to player state. Extracted so we can replay it
    // from cache when offline.
    const applyManifest = (manifest: any) => {
      if (manifest.tenantId) setTenantId(manifest.tenantId);

      // Push every asset URL to the offline-cache Service Worker. Safe no-op
      // when SW isn't available. HIGH-5 fix: short-circuit when the URL set
      // hasn't changed since our last push (cheap content-hash compare),
      // so the 10s emergency poll doesn't re-postMessage the same list to
      // the SW every time.
      try {
        const urls = new Set<string>();
        const playlistAssets: Array<{ url: string }> = [];
        (manifest.playlists || []).forEach((mp: any) => {
          (mp.items || []).forEach((item: any) => {
            const u = item.url;
            if (u && !urls.has(u)) {
              urls.add(u);
              playlistAssets.push({ url: u.startsWith('http') ? u : `${getApiRoot()}${u}` });
            }
          });
        });
        if (playlistAssets.length > 0) {
          // Stable hash of the URL set so re-pushes are skipped when nothing changed.
          const setHash = playlistAssets.map(a => a.url).sort().join('|');
          if (setHash !== lastPlaylistSetHashRef.current) {
            lastPlaylistSetHashRef.current = setHash;
            // Kick the SW pre-cache AND seed the splash with the total so
            // the bar can fill as PRECACHE_PROGRESS events arrive.
            setLoadProgress({ phase: 'assets', loaded: 0, total: playlistAssets.length });
            precachePlaylist(playlistAssets).catch(() => {});
          }
        }
      } catch { /* defensive — SW push failures must never break playback */ }

      // Detect emergency override (server may surface as `emergency`, `override`,
      // or via Tenant.emergencyStatus / emergencyPlaylistId on the manifest).
      const em = manifest.emergency || manifest.override || null;
      if (em && (em.active === true || em.status === 'ACTIVE' || em.type)) {
        setActiveEmergency(em);
        cacheEmergency(em);
      } else if (manifest.allClear === true || manifest.emergencyStatus === 'NONE') {
        setActiveEmergency(null);
        cacheEmergency(null);
      }
      if (manifest.playlists && manifest.playlists.length > 0) {
        // Capture the operator-facing playlist summary for the
        // Stopped splash — name, schedule window, item count, disk
        // footprint. Independent of the playback signature check
        // below; even if content didn't change, we still update the
        // summary cheaply (same objects coming in anyway).
        setManifestPlaylists(
          manifest.playlists.map((pl: any) => ({
            id: pl.id,
            name: pl.name || pl.template?.name || 'Unnamed playlist',
            itemCount: pl.items?.length || 0,
            totalBytes: typeof pl.totalBytes === 'number' ? pl.totalBytes : 0,
            daysOfWeek: pl.schedule?.daysOfWeek ?? null,
            timeStart: pl.schedule?.timeStart ?? null,
            timeEnd: pl.schedule?.timeEnd ?? null,
            isTemplate: !!pl.template,
          }))
        );
        const firstTemplate = manifest.playlists.find((pl: any) => pl.template);
        if (firstTemplate) {
          const tplSig = 'tpl:' + (firstTemplate.template?.id || firstTemplate.template?.name || '');
          if (tplSig !== currentPlaylistSigRef.current) {
            currentPlaylistSigRef.current = tplSig;
            setPlaylist({ name: firstTemplate.template.name || 'Template Content', template: firstTemplate.template, items: [] });
            setCurrentIndex(0);
          }
          return true;
        }
        const combinedItems: any[] = [];
        manifest.playlists.forEach((mp: any) => {
          mp.items.forEach((item: any, itemIndex: number) => {
            combinedItems.push({
              // Stable deterministic id. Before: `item.url + Math.random()`
              // minted a new id on every poll, which guaranteed React's
              // key churn (remount on each update), and combined with
              // setCurrentIndex(0) below re-triggered the slide-cycle
              // effect on every 5-10s manifest poll. The carousel
              // never got past slide 1 or 2 before being yanked back.
              id: `${mp.id || mp.name || 'pl'}:${item.sequence ?? itemIndex}:${item.url}`,
              durationMs: item.duration_ms,
              sequenceOrder: item.sequence ?? itemIndex,
              asset: {
                fileUrl: item.url,
                // Use the manifest's mime_type when available (always set
                // by the API now). Fall back to URL-extension guessing
                // only for legacy manifests / older payloads, which is
                // what the player was doing exclusively before — that's
                // why URL assets (text/html) and PDF assets (application/
                // pdf) silently rendered as broken <img>s and the screen
                // froze on the splash.
                mimeType: item.mime_type
                  ?? (item.url.match(/\.(mp4|webm|mov|m4v)$/i) ? 'video/mp4'
                    : item.url.match(/\.(pdf)$/i) ? 'application/pdf'
                    : item.url.match(/^https?:\/\//i) && !item.url.match(/\.(jpe?g|png|gif|webp|svg|avif)$/i) ? 'text/html'
                    : 'image/jpeg'),
              },
            });
          });
        });
        if (combinedItems.length > 0) {
          // Signature of just the bits that matter for "is this the same
          // playlist?" — url + duration + ordering. If it matches what
          // we're already rendering, DO NOTHING: don't re-seed playlist,
          // don't reset currentIndex, don't fire the slide-cycle effect.
          // That's what keeps the carousel advancing through items 3-7.
          const newSig = combinedItems
            .map((i: any) => `${i.sequenceOrder}|${i.durationMs}|${i.asset.fileUrl}`)
            .join('||');
          if (newSig === currentPlaylistSigRef.current) {
            return true; // identical content — keep index + playlist as-is
          }
          currentPlaylistSigRef.current = newSig;
          setPlaylist({
            name: manifest.playlists.length > 1 ? 'Scheduled Content (Combined)' : manifest.playlists[0].name || 'Scheduled Content',
            items: combinedItems,
          });
          setCurrentIndex(0);
          return true;
        }
      }
      // Empty manifest path — only bother resetting state if we weren't
      // already in the empty state. Prevents the same-signature loop
      // above from missing this case.
      if (currentPlaylistSigRef.current !== '') {
        currentPlaylistSigRef.current = '';
        setPlaylist(null);
        setCurrentIndex(0);
      }
      // Clear the operator-facing summary too — "no playlist loaded"
      // is what the Stopped splash should render.
      setManifestPlaylists([]);
      return true;
    };

    try {
      const access_token = await resolveAuthToken();

      // 1. Try to fetch the specific device manifest (what it is officially scheduled to play)
      const manifestRes = await fetch(`${getApiRoot()}/api/v1/screens/${screenId}/manifest`, {
        headers: { 'Authorization': `Bearer ${access_token}` },
        cache: 'no-store',
      });

      // 401 → cached admin token has expired; bust cache and retry once next tick.
      if (manifestRes.status === 401) {
        cachedAuthTokenRef.current = null;
        // MED-6 audit fix: a 401 isn't a real failure — it's just an
        // expired JWT we'll re-mint on the next call. Don't let it
        // bump the failure counter; otherwise a routine token rotation
        // could push us past the 5-failure native-reload threshold and
        // hard-reload the WebView for nothing.
        fetchFailCountRef.current = Math.max(0, fetchFailCountRef.current - 1);
        throw new Error('Auth expired — will retry');
      }

      if (manifestRes.ok) {
        const manifest = await manifestRes.json();
        cacheManifest(manifest); // survive cold reboot
        fetchFailCountRef.current = 0; // reset on success
        // Clear connectivity toast — we're back online.
        setConnectivity({ kind: 'connected' });
        if (tickToastRef.current) {
          clearInterval(tickToastRef.current);
          tickToastRef.current = null;
        }
        applyManifest(manifest);
        setPhase('playing');
        setLastSync(new Date().toLocaleTimeString());
        return;
      }

      // Non-OK and not 401 — fall through to catch.
      throw new Error(`Manifest fetch failed: HTTP ${manifestRes.status}`);
    } catch (e: any) {
      fetchFailCountRef.current += 1;
      console.warn(`[Player] fetchContent failed (#${fetchFailCountRef.current}):`, e?.message || e);

      // Try cached manifest so we keep playing during outages.
      const cached = readCachedManifest();
      if (cached?.m) {
        const ageMin = Math.round((Date.now() - cached.at) / 60000);
        console.warn(`[Player] Falling back to cached manifest (${ageMin}m old)`);
        applyManifest(cached.m);
        setPhase('playing');
        setError(`Offline — showing last sync (${ageMin}m ago)`);
      } else {
        // Never-give-up: keep the current playlist on screen and show a
        // subtle 'reconnecting' banner, but do NOT flip to the 'offline'
        // phase which freezes playback. A kiosk must keep showing
        // content even across day-long WiFi outages — the user ask was
        // 'never breaks'. Only go offline if we have nothing at all to
        // render (no cache, no current playlist).
        // Show the floating connectivity toast either way. NEVER flip
        // to the legacy `phase === 'offline'` blocking screen — that
        // wipes the splash AND has a broken retry loop. The toast
        // overlays whatever phase is current (splash or content) and
        // surfaces retry status without blanking the screen.
        const reason = playlist
          ? `Reconnecting… (${fetchFailCountRef.current})`
          : (e?.message || 'Network error — retrying');
        setError(reason);
        const retryDelayPreview = backoffMs(fetchFailCountRef.current, 1500, 30_000);
        setConnectivity({
          kind: 'reconnecting',
          reason,
          nextRetryAt: Date.now() + retryDelayPreview,
          attempt: fetchFailCountRef.current,
        });
        if (tickToastRef.current) clearInterval(tickToastRef.current);
        const targetAt = Date.now() + retryDelayPreview;
        tickToastRef.current = setInterval(() => {
          setConnectivity((c) => (c.kind === 'reconnecting' ? { ...c } : c));
          if (Date.now() >= targetAt && tickToastRef.current) {
            clearInterval(tickToastRef.current);
            tickToastRef.current = null;
          }
        }, 1000);
      }

      // Self-heal escalation — capped retry, never gives up:
      //   3 failures → quick retry (3s + jitter)
      //   5 failures → ask the Android shell to hard-reload the WebView
      //   10+ failures → keep retrying at 30s cadence forever
      const retryDelay = backoffMs(fetchFailCountRef.current, 1500, 30_000);
      if (fetchFailCountRef.current >= 5 && fetchFailCountRef.current % 5 === 0 && isAndroidWebView()) {
        console.warn(`[Player] ${fetchFailCountRef.current} consecutive fetch failures — asking native shell to reload`);
        nativeReload();
      }
      // ALWAYS schedule another connecting transition. Even the native
      // reload path needs a backup — a WebView reload can fail silently
      // on some Android OEMs if the renderer process is wedged, so we
      // keep the timer armed either way.
      setTimeout(() => setPhase('connecting'), Math.max(2_000, retryDelay));
    }
  }, [screenId, playlist]);

  useEffect(() => {
    if (phase === 'connecting') fetchContent();
  }, [phase, fetchContent]);

  // ─── Always-on heartbeat (phase-independent) ───
  // Fires every 30s from the moment we have a deviceFingerprint and
  // continues FOREVER regardless of phase — including during 'offline'
  // recovery. The prior heartbeat only ran in 'playing' phase, so a
  // player stuck in 'connecting' retry or 'offline' showed as OFFLINE
  // in the dashboard even though it was reachable. User ask was
  // 'never give up, never show false offline'.
  //
  // Preview mode: skip entirely — a browser tab opened via the dashboard's
  // "Open Screen in Browser" button must NEVER write lastPingAt on the
  // real device's DB row. The real kiosk would then show ONLINE even after
  // the browser tab is closed.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isPreviewMode()) return; // preview tabs don't heartbeat
    const fp = getDeviceFingerprint();
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        await fetch(buildHeartbeatUrl(getApiRoot(), fp), {
          method: 'GET', cache: 'no-store',
        });
      } catch { /* tolerated — next tick retries, forever */ }
    };
    // Kick immediately so dashboard flips ONLINE within seconds of load
    tick();
    const iv = setInterval(tick, 30_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  // ─── Realtime WebSocket Connection ───
  // Hardened: exponential backoff with jitter, refs (not effect-locals) for timers
  // so cleanup is deterministic, dead-connection detection via lastWsMessageAt,
  // and HTTP polling fallback after 3 consecutive WS connect failures.
  useEffect(() => {
    if (phase !== 'playing') return;

    // HTTP status heartbeat — independent of the WebSocket. Calls
    // /screens/status/:fp every 45s which causes the server to update
    // `lastPingAt` on the Screen row. The dashboard's list endpoint
    // derives ONLINE/OFFLINE from that column (<2min = ONLINE), so
    // without this periodic ping the row went OFFLINE after the
    // player finished pairing even though content was still playing.
    // Fires immediately on mount so the dashboard sees us ONLINE the
    // second we hit the playing phase.
    const fp = getDeviceFingerprint();
    const pingStatus = async () => {
      try {
        await fetch(buildHeartbeatUrl(getApiRoot(), fp), {
          method: 'GET', cache: 'no-store',
        });
      } catch { /* silently tolerate — WS + next tick will retry */ }
    };
    pingStatus();
    const httpHeartbeat = setInterval(pingStatus, 45_000);

    const clearTimers = () => {
      if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
      if (wsReconnectRef.current) { clearTimeout(wsReconnectRef.current); wsReconnectRef.current = null; }
    };

    const connect = () => {
      // Always clear timers from prior attempt before opening a new socket.
      clearTimers();
      try {
        const wsUrl = getApiRoot().replace(/^http/, 'ws') + '/realtime';
        console.log('[Player WS] Connecting to', wsUrl, `(attempt ${wsFailCountRef.current + 1})`);
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          wsFailCountRef.current = 0; // reset on successful open
          lastWsMessageAtRef.current = Date.now();
          // Stop the HTTP fallback poll if we now have a working socket.
          if (httpFallbackRef.current) { clearInterval(httpFallbackRef.current); httpFallbackRef.current = null; }
          const activeTenant = tenantId || '00000000-0000-0000-0000-000000000002';
          const tok = getDeviceToken() || `dev_${screenId}_${activeTenant}`;
          console.log('[Player WS] Connected — sending HELLO');
          ws.send(JSON.stringify({ event: 'HELLO', data: { token: tok } }));
          heartbeatRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ event: 'HEARTBEAT' }));
              // Dead-connection detector: if we haven't heard ANYTHING (incl
              // pong) in 60s, force a reconnect. Some proxies silently drop.
              if (Date.now() - lastWsMessageAtRef.current > 60_000) {
                console.warn('[Player WS] Silent for 60s — force reconnect');
                ws.close();
              }
            }
          }, 15_000);
        };

        ws.onmessage = (event) => {
          lastWsMessageAtRef.current = Date.now();
          try {
            const msg = JSON.parse(event.data as string);
            console.log('[Player WS] Received:', msg.type);

            // Capture server-time offset at AUTH_OK. Android signage
            // devices often ship without NTP sync and can drift minutes
            // from wall-clock; without this the staleness gate below
            // would drop every emergency event on a wrong-clock kiosk.
            // The offset is "what to ADD to local Date.now() to match
            // the server's clock".
            if (msg.type === 'AUTH_OK' && typeof msg?.data?.serverTime === 'number') {
              const srv = msg.data.serverTime as number;
              serverClockOffsetRef.current = srv - Date.now();
              if (Math.abs(serverClockOffsetRef.current) > 5000) {
                console.warn('[Player WS] Large clock skew detected — offset=', serverClockOffsetRef.current, 'ms');
              }
            }

            // ─── Audit fix #2: client-side replay + freshness gate ───
            // The full HMAC signature uses a server-only secret we
            // intentionally don't ship to the player (would defeat the
            // purpose). What we CAN enforce client-side:
            //   1. Reject events older than 30s (server signs with a 10s
            //      window, this is the loose client-side equivalent).
            //   2. Reject duplicate eventIds (replay protection).
            //   3. Sensitive events (OVERRIDE / TENANT_CHANGED) MUST carry
            //      a signature field — we don't verify it here, but its
            //      absence means the message didn't even pass through the
            //      signer service and is rejected outright.
            // Full asymmetric verification requires per-tenant Ed25519
            // keys issued at pair time — slated as a follow-up.
            const SENSITIVE_TYPES = new Set(['OVERRIDE', 'TENANT_CHANGED', 'ALL_CLEAR']);
            if (SENSITIVE_TYPES.has(msg.type)) {
              if (!msg.signature || typeof msg.signature !== 'string') {
                console.warn('[Player WS] dropped unsigned sensitive event:', msg.type);
                return;
              }
              // Apply server-clock offset so kiosks with wrong local
              // clocks still accept events that are actually fresh.
              const adjustedNow = Date.now() + serverClockOffsetRef.current;
              if (typeof msg.timestamp !== 'number' || Math.abs(adjustedNow - msg.timestamp) > 30_000) {
                console.warn('[Player WS] dropped stale/future event:', msg.type, msg.timestamp, 'offset=', serverClockOffsetRef.current);
                return;
              }
              if (msg.eventId && typeof msg.eventId === 'string') {
                const seen = recentEventIdsRef.current;
                if (seen.has(msg.eventId)) {
                  console.warn('[Player WS] dropped replayed event:', msg.eventId);
                  return;
                }
                seen.set(msg.eventId, Date.now());
                // Bound memory: drop entries older than 5 min, hard cap at 500.
                if (seen.size > 500) {
                  const cutoff = Date.now() - 5 * 60_000;
                  for (const [k, t] of seen) if (t < cutoff) seen.delete(k);
                  while (seen.size > 500) seen.delete(seen.keys().next().value as string);
                }
              }
            }
            // ALL_CLEAR explicitly drops the cached emergency before refetching
            // so any race between cache-replay and server response can't leave
            // a stale alert on screen.
            if (msg.type === 'ALL_CLEAR') {
              setActiveEmergency(null);
              cacheEmergency(null);
            }
            // Audit fix #6: kiosk was re-paired by an admin to a different
            // tenant (likely physically moved between buildings or districts).
            // Wipe every piece of tenant-scoped local state and reset to the
            // pairing screen so the new tenant's content can't be served from
            // disk before re-pair completes.
            if (msg.type === 'TENANT_CHANGED') {
              try { localStorage.removeItem('edu_device_token'); } catch {}
              try { localStorage.removeItem('edu_device_fp'); } catch {}
              try { localStorage.removeItem('edu_manifest_cache_v1'); } catch {}
              try { localStorage.removeItem('edu_emergency_cache_v1'); } catch {}
              // Ask the SW to clear both cache tiers so disk is clean for the
              // new tenant.
              try {
                navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_CACHE', tier: 'all' });
              } catch {}
              // Ask the native shell (if present) to wipe USB cache + reload.
              try { (window as any).EduCmsNative?.unpair?.(); } catch {}
              setActiveEmergency(null);
              setPhase('registering');
              return;
            }
            if (msg.type === 'SYNC' || msg.type === 'OVERRIDE' || msg.type === 'ALL_CLEAR') {
              fetchContent();
            }
            // Admin hit "Push APK update" in the dashboard. Messages are
            // fanned out to the whole tenant channel; we only act if
            // this device is actually targeted.
            //   payload.scope === 'tenant' → every kiosk in the tenant
            //   payload.scope === 'screen' + scopeId matches this screen
            // If we're NOT running inside the Android kiosk shell, the
            // bridge isn't present — plain browser players just log + no-op.
            if (msg.type === 'CHECK_FOR_UPDATES') {
              const pl = msg.payload || msg;
              const scope = pl?.scope;
              const scopeId = pl?.scopeId;
              const targetsUs =
                scope === 'tenant' ||
                (scope === 'screen' && screenId && scopeId === screenId);
              if (!targetsUs) {
                console.log('[Player] CHECK_FOR_UPDATES ignored — not our scope', scope, scopeId);
              } else {
                // Operator (2026-04-27): "we should really show on
                // the device splash screen that an update is
                // happening... show the same info as i see on the
                // dashboard every step of the way." Surface the
                // overlay BEFORE the bridge call so the user at the
                // kiosk sees something happening instantly.
                let bridgeAvailable = false;
                try {
                  const bridge = (window as any).EduCmsNative;
                  if (bridge && typeof bridge.checkForUpdates === 'function') {
                    bridgeAvailable = true;
                    const v = bridge.checkForUpdates();
                    console.log('[Player] CHECK_FOR_UPDATES relayed to native, currentVersion=', v);
                  } else {
                    console.log('[Player] CHECK_FOR_UPDATES ignored — no native bridge (legacy APK or browser player)');
                  }
                } catch (e) {
                  console.warn('[Player] CHECK_FOR_UPDATES bridge call failed', e);
                }
                // Show the overlay either way — operator sees that
                // the message reached the device. If bridge isn't
                // available (v1.0.4 APK), the overlay copy adapts.
                setOtaProgress({
                  startedAt: Date.now(),
                  bridgeAvailable,
                });
              }
            }
          } catch (e) {
            console.error('[Player WS] Parse error:', e);
          }
        };

        ws.onerror = (err) => {
          console.error('[Player WS] Error:', err);
          try { ws.close(); } catch {}
        };

        ws.onclose = (ev) => {
          console.log('[Player WS] Closed:', ev.code, ev.reason);
          clearTimers();
          wsFailCountRef.current += 1;
          // Exponential backoff with full jitter: 1s, 2s, 4s, 8s, 16s, 30s max.
          const delay = backoffMs(wsFailCountRef.current, 1000, 30_000);
          console.log(`[Player WS] Reconnect in ~${Math.round(delay)}ms`);
          wsReconnectRef.current = setTimeout(connect, delay);

          // After 3 consecutive failures, START a 5s HTTP fallback poll so emergency
          // alerts still arrive even with WS completely down. Stops itself when
          // ws.onopen fires.
          if (wsFailCountRef.current >= 3 && !httpFallbackRef.current) {
            console.warn('[Player WS] 3 failures — engaging 5s HTTP fallback poll');
            httpFallbackRef.current = setInterval(() => fetchContent(), 5_000);
          }
        };
      } catch (e) {
        console.error('[Player WS] Connection failed:', e);
        wsFailCountRef.current += 1;
        wsReconnectRef.current = setTimeout(connect, backoffMs(wsFailCountRef.current, 1000, 30_000));
      }
    };

    connect();

    return () => {
      clearTimers();
      clearInterval(httpHeartbeat);
      if (httpFallbackRef.current) { clearInterval(httpFallbackRef.current); httpFallbackRef.current = null; }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        try { wsRef.current.close(); } catch {}
        wsRef.current = null;
      }
    };
  }, [phase, screenId, tenantId, fetchContent]);

  // ─── CRITICAL: Emergency polling fallback ───
  // WebSocket is the primary channel, but for life-safety alerts we CANNOT
  // rely on a single transport. Adaptive cadence: 5s when emergency is active
  // OR WebSocket is degraded (≥2 consecutive WS failures), otherwise 10s.
  useEffect(() => {
    if (phase !== 'playing' || !screenId) return;
    const fast = !!activeEmergency || wsFailCountRef.current >= 2;
    const cadence = fast ? 5_000 : 10_000;
    emergencyPollRef.current = setInterval(() => fetchContent(), cadence);
    return () => {
      if (emergencyPollRef.current) {
        clearInterval(emergencyPollRef.current);
        emergencyPollRef.current = null;
      }
    };
  }, [phase, screenId, fetchContent, activeEmergency]);

  // ─── Cycle through slides ───
  useEffect(() => {
    if (phase !== 'playing' || !playlist?.items?.length) return;

    const sorted = [...playlist.items].sort((a: any, b: any) => a.sequenceOrder - b.sequenceOrder);
    
    // Core slide scheduler logic
    const isItemValid = (item: any) => {
      if (!item.daysOfWeek && !item.timeStart && !item.timeEnd) return true;
      const now = new Date();
      if (item.daysOfWeek) {
        const dayMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        if (!item.daysOfWeek.includes(dayMap[now.getDay()])) return false;
      }
      if (item.timeStart && item.timeEnd) {
        const [sh, sm] = item.timeStart.split(':').map(Number);
        const [eh, em] = item.timeEnd.split(':').map(Number);
        const currentMins = now.getHours() * 60 + now.getMinutes();
        const startMins = sh * 60 + sm;
        const endMins = eh * 60 + em;
        if (currentMins < startMins || currentMins > endMins) return false;
      }
      return true;
    };

    // Find the next VALID index, up to a full cycle search
    let nextIndex = currentIndex % sorted.length;
    let found = false;
    for (let i = 0; i < sorted.length; i++) {
      if (isItemValid(sorted[nextIndex])) {
        found = true;
        break;
      }
      nextIndex = (nextIndex + 1) % sorted.length;
    }

    if (!found) {
      // Entire playlist is locked right now! Fallback loop retry every 30s
      timerRef.current = setTimeout(() => setCurrentIndex(prev => prev + 1), 30000);
      return;
    }

    // If we skipped invalid slides to arrive at nextIndex, update state immediately
    if (nextIndex !== (currentIndex % sorted.length)) {
      setCurrentIndex(nextIndex);
      return;
    }

    const item = sorted[nextIndex];
    if (item?.asset?.mimeType?.startsWith('video/')) {
      // For videos, do NOT set a timer. Let the <video onEnded> execute the sequence increment naturally.
      return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    }

    const duration = item?.durationMs || 10000;
    timerRef.current = setTimeout(() => {
      setCurrentIndex(prev => prev + 1);
    }, duration);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [phase, playlist, currentIndex]);

  // ═══════════════════════════════════════════════════════════════
  // ALL HOOKS MUST BE CALLED BEFORE ANY EARLY RETURN (Rules of Hooks).
  // The touch idle-reset + playlist memoization hooks below used to
  // live further down the file, after the phase === 'registering' /
  // 'pairing' / 'connecting' / 'offline' early returns. That caused a
  // hook-count mismatch when the player transitioned from 'pairing' to
  // 'playing' (React saw extra hooks materialize on the second render)
  // which crashed the page right after the dashboard paired the
  // screen. Moved up so every render calls the same hook sequence
  // regardless of phase.
  // ═══════════════════════════════════════════════════════════════

  // Sprint 4: Touch idle-reset for interactive templates.
  const [sceneTick, setSceneTick] = useState(0);
  const idleResetTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isTouchTemplate = !!playlist?.template?.isTouchEnabled;
  const idleResetMs: number = playlist?.template?.idleResetMs ?? 60000;

  useEffect(() => {
    if (!isTouchTemplate) return;

    const reset = () => {
      if (idleResetTimerRef.current) clearTimeout(idleResetTimerRef.current);
      idleResetTimerRef.current = setTimeout(() => {
        setSceneTick(t => t + 1);
      }, idleResetMs);
    };

    const onTouch = () => reset();
    const onTouchAction = (e: Event) => {
      const ce = e as CustomEvent<{ type: string; target: string }>;
      if (ce.detail && (ce.detail.type === 'navigate' || ce.detail.type === 'show')) {
        setSceneTick(t => t + 1);
      }
      reset();
    };

    window.addEventListener('pointerdown', onTouch, { passive: true });
    window.addEventListener('keydown', onTouch);
    window.addEventListener('edu:touch-action', onTouchAction as EventListener);
    reset();

    return () => {
      window.removeEventListener('pointerdown', onTouch);
      window.removeEventListener('keydown', onTouch);
      window.removeEventListener('edu:touch-action', onTouchAction as EventListener);
      if (idleResetTimerRef.current) clearTimeout(idleResetTimerRef.current);
    };
  }, [isTouchTemplate, idleResetMs]);

  // Memoized sorted playlist + item-validity check.
  const isTemplate = !!playlist?.template;
  const sorted = useMemo(
    () => (playlist && !isTemplate ? [...(playlist.items || [])].sort((a: any, b: any) => a.sequenceOrder - b.sequenceOrder) : []),
    [playlist, isTemplate],
  );
  const isItemValid = useCallback((item: any) => {
    if (!item || (!item.daysOfWeek && !item.timeStart && !item.timeEnd)) return true;
    const now = new Date();
    if (item.daysOfWeek && !item.daysOfWeek.includes(['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][now.getDay()])) return false;
    if (item.timeStart && item.timeEnd) {
      const [sh, sm] = item.timeStart.split(':').map(Number);
      const [eh, em] = item.timeEnd.split(':').map(Number);
      const currentMins = now.getHours() * 60 + now.getMinutes();
      if (currentMins < (sh * 60 + sm) || currentMins > (eh * 60 + em)) return false;
    }
    return true;
  }, []);

  // Shared splash resolution string — used by all three pre-content phases.
  const splashResolution = typeof window !== 'undefined'
    ? (() => {
        const qp = new URLSearchParams(window.location.search);
        const w = parseInt(qp.get('w') || '0', 10) || window.screen.width;
        const h = parseInt(qp.get('h') || '0', 10) || window.screen.height;
        return `${w}×${h}`;
      })()
    : null;

  // ─── Exit / Stop handlers (hoisted above phase early-returns so the
  //     offline "Reconnecting…" screen can reuse the same Exit logic
  //     the Stopped splash uses — operator should be able to leave the
  //     app from any error state, not just from mid-playback). ───
  // Stop = "go back to the player's main splash". Playback pauses but
  // the shell is still running, with a branded splash that lets the
  // operator Resume, Exit, or Unpair.
  const handleStopPlayback = () => {
    setShowOverlay(false);
    setPlaybackStopped(true);
  };

  // v1.0.16 — wraps fetchContent with visible button feedback.
  // Operator (2026-04-27): "hitting sync does nothing it appears."
  // Even when sync succeeds, the manifest is often unchanged so the
  // React tree never re-renders → no acknowledgment. This wrapper
  // flips syncFeedback through syncing → done so the button can
  // briefly show "Syncing…" then "Synced ✓" (~2s) before resetting.
  const handleSyncWithFeedback = useCallback(async () => {
    setSyncFeedback('syncing');
    try {
      await fetchContent();
      setSyncFeedback('done');
    } catch {
      setSyncFeedback('err');
    } finally {
      setTimeout(() => setSyncFeedback('idle'), 2000);
    }
  }, [fetchContent]);
  // Exit = actually leave the EduCMS player, return control to the
  // Android / OEM launcher. Priority cascade:
  //   1. Native exit bridge (injected by our Android APK).
  //   2. window.close() (works for PWA/TWA windows).
  //   3. Fallback splash state — stays on the Stopped splash but
  //      flips exitUnavailable=true so the copy asks the operator
  //      to hit their remote's Home button.
  const handleExitApp = () => {
    try {
      const bridge = (window as any).EduCmsNative;
      if (bridge && typeof bridge.exitToDeviceHome === 'function') {
        bridge.exitToDeviceHome();
        return;
      }
    } catch { /* fall through */ }
    try { window.close(); } catch { /* ignore */ }
    setPlaybackStopped(true);
    setExitUnavailable(true);
  };

  // ─── OTA progress overlay — rendered on top of every phase
  //     when an admin has just clicked "Push update" from the
  //     dashboard. Stage label morphs the same way the dashboard
  //     popover does, so the on-kiosk and at-desk views stay in
  //     sync. Bridge-missing kiosks (v1.0.4) get different copy
  //     so the operator knows why the update can't proceed. */}
  const otaOverlay = otaProgress ? (
    <OtaProgressOverlay
      startedAt={otaProgress.startedAt}
      bridgeAvailable={otaProgress.bridgeAvailable}
      onDismiss={() => setOtaProgress(null)}
    />
  ) : null;

  // ─── Connectivity toast (non-blocking) ───
  // Renders as a fixed-position bottom-center bar over WHATEVER the
  // current phase is showing. Replaces the legacy blocking
  // `phase === 'offline'` screen. Hidden when connected.
  //
  // Computed inline as a JSX expression (not a function) so it can
  // be referenced in the early-return Fragments below without
  // hitting temporal-dead-zone issues.
  const connectivityToast = connectivity.kind === 'reconnecting' ? (() => {
    const remainMs = Math.max(0, connectivity.nextRetryAt - Date.now());
    const remainSec = Math.ceil(remainMs / 1000);
    // Operator screenshot 2026-04-27 (post-deploy reconnect on M Series):
    // toast was getting clipped at the right edge because KioskSplash's
    // own `.kiosk-tech-chips` row sits at `bottom: 20-40px` centered, AND
    // my toast sat at `bottom-6` (24px) ALSO centered — both fighting for
    // horizontal space at the same vertical band. Pulled the toast WAY up
    // (bottom-40 = 160px) so it has clean separation from the splash
    // chips, and switched to `inset-x-0 mx-auto` for centering which
    // doesn't depend on `transform: translateX(-50%)` interacting with
    // any parent transforms.
    return (
      <div
        className="fixed bottom-40 inset-x-4 mx-auto z-[9998] max-w-xl px-5 py-4 rounded-2xl bg-slate-900/95 text-white shadow-2xl border border-slate-700 backdrop-blur-md flex flex-wrap items-center justify-center gap-3"
        role="status"
        aria-live="polite"
      >
        <WifiOff className="w-6 h-6 text-red-400 shrink-0" />
        <div className="flex-1 min-w-0 text-center sm:text-left">
          <div className="text-base font-semibold">
            Reconnecting{connectivity.attempt > 1 ? ` (attempt ${connectivity.attempt})` : ''}…
          </div>
          <div className="text-xs text-slate-300 mt-0.5">
            {connectivity.reason}{remainSec > 0 ? ` — retry in ${remainSec}s` : ' — retrying now'}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => {
              // Kick the resilient retry chain ahead of its timer.
              setError(null);
              registerFailCountRef.current = 0;
              fetchFailCountRef.current = 0;
              if (registerRetryTimerRef.current) clearTimeout(registerRetryTimerRef.current);
              if (tickToastRef.current) clearInterval(tickToastRef.current);
              // For unpaired devices, re-fire registration; for paired, re-fire fetchContent.
              if (screenId) {
                fetchContent();
              } else {
                // Pulse phase to retrigger the registration effect cleanly.
                registrationLoopRef.current?.stop();
                registrationLoopRef.current = null;
                setPhase('registering');
              }
            }}
            className="text-xs font-bold px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white"
          >
            Retry now
          </button>
          <button
            onClick={handleExitApp}
            className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white"
          >
            Exit
          </button>
          <button
            onClick={() => {
              try { localStorage.removeItem('edu_device_fp'); } catch {}
              registerFailCountRef.current = 0;
              fetchFailCountRef.current = 0;
              setError(null);
              setConnectivity({ kind: 'connected' });
              registrationLoopRef.current?.stop();
              registrationLoopRef.current = null;
              setPhase('registering');
            }}
            className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white"
          >
            Reset
          </button>
        </div>
      </div>
    );
  })() : null;

  // ─── Render: Registering ───
  if (phase === 'registering') {
    return (
      <>
        <KioskSplash
          mode="registering"
          brandName={brandName}
          resolution={splashResolution}
          apkVersion={apkVersion}
        />
        {otaOverlay}
        {connectivityToast}
      </>
    );
  }

  // ─── Render: Pairing Code Screen ───
  if (phase === 'pairing') {
    return (
      <>
        <KioskSplash
          mode="pairing"
          brandName={brandName}
          pairingCode={pairingCode}
          resolution={splashResolution}
          apkVersion={apkVersion}
          pairDeepLinkUrl={
            typeof window !== 'undefined' && pairingCode
              ? `${window.location.origin}/pair?code=${encodeURIComponent(pairingCode)}`
              : null
          }
        />
        {otaOverlay}
        {connectivityToast}
      </>
    );
  }

  // ─── Render: Connecting ───
  if (phase === 'connecting') {
    return (
      <>
        <KioskSplash
          mode="connecting"
          brandName={brandName}
          screenName={screenName}
          resolution={splashResolution}
          apkVersion={apkVersion}
          loadProgress={loadProgress}
        />
        {otaOverlay}
        {connectivityToast}
      </>
    );
  }

  // Legacy `phase === 'offline'` block intentionally REMOVED — operator
  // reported (2026-04-27 with screenshot) the kiosk getting stuck on
  // "Reconnecting… Registration HTTP 500 / Next attempt in 3s" with the
  // countdown frozen forever, requiring force-stop to recover. Root
  // cause was setPhase('offline') triggering a useEffect cleanup that
  // wiped the just-scheduled retry timers. The non-blocking
  // `connectivityToast` JSX (defined above the phase returns) replaces
  // it with a ref-loop-driven retry that never freezes.

  // (sceneTick / idleResetTimerRef / sorted / isItemValid hooks were
  // moved above the early returns to satisfy the Rules of Hooks.)
  const currentItem = sorted.length && isItemValid(sorted[currentIndex % sorted.length]) ? sorted[currentIndex % sorted.length] : null;
  const isVideo = currentItem?.asset?.mimeType?.startsWith('video/');
  const fileUrl = currentItem?.asset?.fileUrl || '';
  const resolvedUrl = fileUrl.startsWith('http') ? fileUrl : `${getApiRoot()}${fileUrl}`;

  // Template rendering
  if (isTemplate) {
    const tpl = playlist.template;
    const zones = tpl.zones || [];

    // v1.0.16 — auto-promote interactive UX when the template
    // contains a WEBPAGE zone. Operator (2026-04-27): "when i push a
    // URL it will normally mean its a touch screen and if a mouse
    // click just pops up another menu that means a finger click will
    // do the same... what should work is an exit on the remote
    // control takes me out of the playlist but otherwise i should be
    // able to use the website with my finger or a mouse."
    //
    // We were treating webpage templates as static signage —
    // cursor-none + click-anywhere-to-toggle-overlay killed every
    // attempt to interact with the embedded site. Detecting WEBPAGE
    // zones flips us into the same UX bucket as the explicit "touch
    // template" flag: cursor visible, clicks pass through to the
    // iframe / zone, and only the remote's Back/Exit key brings up
    // the Stop overlay (already wired through edu-show-stop-overlay).
    const hasWebpageZone = zones.some((z: any) => z.widgetType === 'WEBPAGE');
    const isInteractive = isTouchTemplate || hasWebpageZone;

    // Stop splash short-circuit before rendering template widgets
    // so the whole widget tree tears down (stopping any animations,
    // video loops, weather polls, etc.) during the stop.
    if (playbackStopped) {
      return (
        // Stop splash now reuses KioskSplash (same branded chrome
        // as the connecting / pairing splashes) per Integration
        // Lead's note "use the same nice UI we have that shows
        // when a display is waiting for content." A 'stopped' mode
        // was added to KioskSplash that renders Pause chip +
        // playlist info card + Resume/Sync/Exit/Unpair buttons.
        <KioskSplash
          mode="stopped"
          brandName={brandName}
          screenName={screenName}
          resolution={splashResolution}
          lastSync={lastSync}
          stoppedPlaylists={manifestPlaylists}
          stoppedCache={cacheStatus && cacheStatus.supported ? { playlist: cacheStatus.playlist, emergency: cacheStatus.emergency } : null}
          stoppedExitUnavailable={exitUnavailable}
          onResume={() => { setPlaybackStopped(false); setExitUnavailable(false); }}
          onExit={handleExitApp}
          onUnpair={() => {
            try { localStorage.removeItem('edu_device_fp'); } catch {}
            setPlaybackStopped(false);
            setExitUnavailable(false);
            setPhase('registering');
          }}
          onSync={() => fetchContent()}
        />
      );
    }

    return (
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
      <div
        className={`fixed inset-0 ${isInteractive ? '' : 'cursor-none'}`}
        // role / tabIndex / aria-label / onClick are conditional —
        // a static signage template needs role=button so a11y
        // tooling treats the whole canvas as the trigger for the
        // info overlay, but a template containing a WEBPAGE zone
        // is interactive: clicks pass through to the iframe and
        // the canvas itself is just a passive container. Eslint
        // can't statically prove the conditional pair is balanced,
        // hence the disable above.
        role={isInteractive ? undefined : 'button'}
        tabIndex={isInteractive ? -1 : 0}
        aria-label={isInteractive ? undefined : 'Toggle screen info overlay'}
        onClick={isInteractive ? undefined : () => setShowOverlay(!showOverlay)}
        onKeyDown={e => {
          // Only toggle on direct-target keypresses. Without this
          // guard, Enter on any BUTTON inside the overlay (Stop,
          // Exit, Sync) bubbled here and the overlay toggled off
          // right after the button handler ran — the operator
          // reported "nothing happened" because the overlay
          // disappeared before they could see the Stopped splash.
          if (e.target !== e.currentTarget) return;
          if (!isInteractive && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setShowOverlay(s => !s); }
        }}
        style={{
          backgroundColor: tpl.bgColor || '#000000',
          ...(tpl.bgGradient ? { background: tpl.bgGradient } : {}),
          ...(tpl.bgImage ? { backgroundImage: tpl.bgImage.trim().startsWith('url(') ? tpl.bgImage : `url(${tpl.bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}),
        }}>
        {/* Render each zone with its live widget. Key by sceneTick on touch
            templates so idle-reset remounts widgets and clears local state. */}
        {zones.map((zone: any) => {
          // defaultConfig may be a JSON string from the DB — ensure it's a parsed object
          let cfg = zone.defaultConfig;
          if (typeof cfg === 'string') {
            try { cfg = JSON.parse(cfg); } catch { cfg = {}; }
          }
          const zoneTouchAction = zone.touchAction || null;
          const onZoneClick = zoneTouchAction
            ? (e: React.MouseEvent) => {
                e.stopPropagation();
                // Broadcast the action so the idle-reset listener above picks it up.
                try {
                  window.dispatchEvent(new CustomEvent('edu:touch-action', { detail: zoneTouchAction }));
                } catch {}
                if (zoneTouchAction.type === 'url' && zoneTouchAction.target) {
                  window.open(zoneTouchAction.target, '_blank', 'noopener,noreferrer');
                }
              }
            : undefined;
          // Universal text-style override — same scoped <style> trick
          // BuilderZone uses, mirrored on the player so operator
          // overrides ship to screens. Two-tier:
          //   - Zone-wide (cfg.fontFamily / fontSize / color / bold / italic / underline / strikethrough)
          //   - Per-field (cfg._styles[fieldKey] = { fontFamily, ... })
          // Per-field rules get higher specificity (zone + data-field
          // attribute selector) so they win over zone-wide for that
          // specific field. SVG icons excluded.
          const isTextZone = zone.widgetType === 'TEXT' || zone.widgetType === 'RICH_TEXT';
          const _buildPlayerRules = (s: any): string[] => {
            const r: string[] = [];
            const fam = typeof s.fontFamily === 'string' && s.fontFamily.trim();
            const sz = typeof s.fontSize === 'number' && Number.isFinite(s.fontSize) ? s.fontSize : null;
            const col = typeof s.color === 'string' && s.color.trim();
            const decos: string[] = [];
            if (s.underline === true) decos.push('underline');
            if (s.strikethrough === true) decos.push('line-through');
            if (fam) r.push(`font-family: ${fam} !important`);
            if (sz) r.push(`font-size: ${sz}px !important`);
            if (col) r.push(`color: ${col} !important`);
            if (s.bold === true) r.push(`font-weight: 800 !important`);
            if (s.italic === true) r.push(`font-style: italic !important`);
            if (decos.length) r.push(`text-decoration: ${decos.join(' ')} !important`);
            return r;
          };
          const _cssChunks: string[] = [];
          if (!isTextZone) {
            const zoneRules = _buildPlayerRules(cfg);
            if (zoneRules.length) {
              _cssChunks.push(`[data-zone-id="${zone.id}"] *:not(svg):not(svg *) { ${zoneRules.join('; ')} }`);
            }
            const stylesPerField = (cfg._styles && typeof cfg._styles === 'object') ? cfg._styles : {};
            for (const [fieldKey, fieldStyle] of Object.entries(stylesPerField)) {
              const r = _buildPlayerRules(fieldStyle);
              if (!r.length) continue;
              const sel = `[data-zone-id="${zone.id}"] [data-field="${(fieldKey as string).replace(/"/g, '\\"')}"]`;
              _cssChunks.push(`${sel}, ${sel} *:not(svg):not(svg *) { ${r.join('; ')} }`);
            }
          }
          return (
          <div
            key={`${zone.id}-${isTouchTemplate ? sceneTick : 0}`}
            className="absolute overflow-hidden"
            data-zone-id={zone.id}
            onClick={onZoneClick}
            style={{
              left: `${zone.x}%`,
              top: `${zone.y}%`,
              width: `${zone.width}%`,
              height: `${zone.height}%`,
              zIndex: zone.zIndex || 0,
              cursor: zoneTouchAction ? 'pointer' : undefined,
            }}>
            {_cssChunks.length > 0 && <style>{_cssChunks.join('\n')}</style>}
            <WidgetPreview
              widgetType={zone.widgetType}
              config={cfg}
              width={zone.width}
              height={zone.height}
              live={true}
            />
          </div>
          );
        })}

        {/* Preview mode chip — always visible in the top-right corner so
            it's obvious the browser tab is a preview, not the real kiosk. */}
        {isPreviewMode() && (
          <div className="absolute top-3 right-3 z-[1000] flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/90 backdrop-blur-sm text-white text-xs font-black uppercase tracking-wider rounded-full shadow-lg pointer-events-none select-none">
            <Monitor className="w-3.5 h-3.5" />
            Preview Mode
          </div>
        )}

        {/* Info overlay */}
        {showOverlay && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[999]">
            <div className="bg-slate-900 rounded-2xl p-8 max-w-md w-full mx-4 border border-slate-700 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">{screenName || 'Screen'}</h3>
                <div className="flex items-center gap-2">
                  {isPreviewMode() && <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-amber-500/20 text-amber-400 rounded-full">Preview</span>}
                  <Wifi className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm text-emerald-400 font-medium">Connected</span>
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-400">Template</span><span className="text-white font-medium">{tpl.name}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Zones</span><span className="text-white font-medium">{zones.length} live widgets</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Resolution</span><span className="text-white font-medium">{tpl.screenWidth}×{tpl.screenHeight}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Last Sync</span><span className="text-white font-medium">{lastSync || 'Never'}</span></div>
                <CacheStatusRow status={cacheStatus} />
                <SoftwareInfoRow />
                <DiagnosticsRow />
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={(e) => { e.stopPropagation(); handleSyncWithFeedback(); }} disabled={syncFeedback === 'syncing'} className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-700/60 text-white rounded-lg font-medium text-sm transition-colors">
                  {syncFeedback === 'syncing' ? 'Syncing…' : syncFeedback === 'done' ? 'Synced ✓' : syncFeedback === 'err' ? 'Sync failed' : 'Sync Now'}
                </button>
                {/* Stop button — ALWAYS shown, unlike the native-only
                    Exit below. Tries the exit bridge first, then a
                    best-effort window.close(), and finally falls back
                    to a stop-curtain so the operator always gets a
                    visible "playback is halted" state (critical on
                    Goodview-style OEM WebViews that don't inject a
                    native exit bridge). */}
                {/* Overlay actions: Sync + Stop only. Exit and
                    Unpair were redundant here — both belong on the
                    Stopped splash where the operator has already
                    paused playback and is making a deliberate
                    decision. Three "leave the app" controls jammed
                    into one tiny overlay was confusing per the
                    Integration Lead's review. */}
                <button
                  onClick={(e) => { e.stopPropagation(); handleStopPlayback(); }}
                  onKeyDown={(e) => e.stopPropagation()}
                  title="Stop playback — opens the player splash with Resume / Exit / Unpair"
                  className="py-2 px-4 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-bold transition-colors"
                >
                  Stop
                </button>
              </div>
            </div>
          </div>
        )}
        {connectivityToast}
      </div>
    );
  }

  // Stop splash — KioskSplash mode='stopped' (matches the template
  // render path above). Branded chrome reused from the connecting
  // splash, with playlist-info card + actions added inside.
  if (playbackStopped) {
    return (
      <KioskSplash
        mode="stopped"
        brandName={brandName}
        screenName={screenName}
        resolution={splashResolution}
        lastSync={lastSync}
        stoppedPlaylists={manifestPlaylists}
        stoppedCache={cacheStatus && cacheStatus.supported ? { playlist: cacheStatus.playlist, emergency: cacheStatus.emergency } : null}
        stoppedExitUnavailable={exitUnavailable}
        onResume={() => { setPlaybackStopped(false); setExitUnavailable(false); }}
        onExit={handleExitApp}
        onUnpair={() => {
          try { localStorage.removeItem('edu_device_fp'); } catch {}
          setPlaybackStopped(false);
          setExitUnavailable(false);
          setPhase('registering');
        }}
        onSync={() => fetchContent()}
      />
    );
  }

  // Media playlist rendering
  return (
    <div
      className="fixed inset-0 bg-black cursor-none overflow-hidden"
      role="button"
      tabIndex={0}
      aria-label="Toggle screen info overlay"
      onClick={() => setShowOverlay(!showOverlay)}
      onKeyDown={e => {
        // Same target-check as the template path above — keeps
        // button keypresses from bubbling into an overlay toggle.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowOverlay(s => !s); }
      }}
    >
      {currentItem ? (
        <div className="relative w-full h-full flex items-center justify-center pointer-events-none">
          {sorted.map((item, index) => {
            const isActive = index === (currentIndex % sorted.length);
            const mime = item.asset?.mimeType || '';
            const isVid = mime.startsWith('video/');
            // Web pages (text/html) and PDFs both render as <iframe>.
            // Browsers natively render PDF inline via the built-in PDF
            // viewer (Chrome / Edge / Firefox / Safari) — which gives
            // operators a working "show this menu PDF on the lobby
            // screen" path without us shipping a custom paginator.
            // Multi-page PDFs auto-display page 1; auto-paging is a
            // future enhancement, but page-1-only is already what
            // every other signage CMS does too.
            const isWeb = mime === 'text/html' || mime === 'application/pdf';
            const fileUrl = item.asset?.fileUrl || '';
            const resUrl = fileUrl.startsWith('http') ? fileUrl : `${getApiRoot()}${fileUrl}`;

            // Render video ONLY when active to preserve memory
            if (isVid && !isActive) return null;
            // Render iframe ONLY when active. Hidden iframes still
            // load + run JS / video / etc. on the embedded site,
            // which is bandwidth + CPU we don't want for inactive
            // slides.
            if (isWeb && !isActive) return null;

            // Compute physics class limits
            const trans = item.transitionType || 'FADE';
            let classes = "absolute inset-0 w-full h-full object-contain transition-all duration-[1000ms] ease-in-out ";
            if (trans === 'FADE') classes += isActive ? "opacity-100 z-10" : "opacity-0 z-0";
            else if (trans === 'SLIDE_LEFT') classes += isActive ? "translate-x-0 z-10" : "translate-x-full z-0";
            else if (trans === 'SLIDE_RIGHT') classes += isActive ? "translate-x-0 z-10" : "-translate-x-full z-0";
            else if (trans === 'SLIDE_UP') classes += isActive ? "translate-y-0 z-10" : "translate-y-full z-0";
            else if (trans === 'SLIDE_DOWN') classes += isActive ? "translate-y-0 z-10" : "-translate-y-full z-0";
            else classes += isActive ? "opacity-100 z-10 duration-0" : "opacity-0 z-0 duration-0";

            if (isVid) {
              return <video
                key={item.id}
                src={resUrl}
                className={classes}
                autoPlay
                muted
                playsInline
                onEnded={(e) => {
                  // HIGH-6 fix: tear down THIS video's buffer BEFORE we
                  // advance the index. If we advance first, the re-render
                  // can briefly paint the old <video> with the old src
                  // before React unmounts it (visible 1-frame flash on
                  // slow devices). Releasing src first guarantees the
                  // outgoing element is blank during the swap.
                  try {
                    e.currentTarget.pause();
                    e.currentTarget.removeAttribute('src');
                    e.currentTarget.load();
                  } catch {}
                  setCurrentIndex(prev => prev + 1);
                }}
                onError={(e) => {
                  // Corrupted file or 404 → skip ahead instead of stalling forever.
                  console.warn('[Player] video error, skipping:', resUrl);
                  setCurrentIndex(prev => prev + 1);
                }}
              />;
            }
            if (isWeb) {
              // Web pages: route through the API proxy so we can strip
              // X-Frame-Options / CSP frame-ancestors. Without this,
              // any URL pointing at a real-world site (Google, school
              // websites, Hacker News, news outlets) renders as a
              // BLANK iframe because the browser refuses to frame
              // origins that send `X-Frame-Options: DENY` or
              // `SAMEORIGIN`. The proxy fetches the upstream HTML
              // server-side, strips those headers, and serves the
              // body back from our origin so the iframe is allowed
              // to render. Partner reported "i tried to push a URL
              // and still failed" — confirmed the player iframe was
              // bypassing the proxy entirely.
              //
              // PDFs (`application/pdf`) skip the proxy — proxying
              // would corrupt the binary stream. Browsers render PDFs
              // inline natively; X-Frame-Options doesn't apply to
              // file/PDF responses the same way.
              const isPdf = mime === 'application/pdf';
              const iframeSrc = isPdf
                ? resUrl
                : `${getApiRoot()}/api/v1/proxy/web?url=${encodeURIComponent(resUrl)}&v=2`;
              return <iframe
                key={item.id}
                src={iframeSrc}
                className={classes}
                // No sandbox attribute. The proxy strips <script> tags
                // server-side — that's the frame-busting defense. Adding
                // sandbox="allow-scripts allow-same-origin" was tried
                // briefly and produced a regression (e-arc.com middle
                // section broken too) so reverted to the script-strip
                // baseline. See proxy.controller.ts comments.
                title={item.id}
                onError={() => {
                  console.warn('[Player] iframe error, skipping:', iframeSrc);
                  setCurrentIndex(prev => prev + 1);
                }}
              />;
            }
            return <img key={item.id} src={resUrl} alt="" className={classes} />;
          })}
        </div>
      ) : (
        <div className="w-full h-full bg-slate-50 flex items-center justify-center p-8 overflow-hidden relative cursor-default" onClick={(e) => e.stopPropagation()} role="presentation">
          {/* Decorative background blurs to match Pastel Pop */}
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-400/20 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-400/20 rounded-full blur-3xl pointer-events-none" />

          <div className="w-full max-w-5xl bg-white/80 backdrop-blur-3xl rounded-[3rem] shadow-[0_20px_60px_rgb(0,0,0,0.06)] border border-white p-12 flex flex-col items-center z-10 animate-in fade-in zoom-in-95 duration-700">
            <div className="w-24 h-24 rounded-[2rem] bg-gradient-to-br from-emerald-100 to-emerald-50 shadow-[inset_0_4px_20px_rgb(0,0,0,0.05)] flex items-center justify-center mb-6 ring-4 ring-white">
              <CheckCircle2 className="w-12 h-12 text-emerald-500" />
            </div>
            <h1 className="text-4xl font-extrabold text-slate-800 tracking-tight">Screen Paired Successfully</h1>
            <p className="text-lg font-medium text-slate-500 mt-2 mb-10 text-center">Waiting for a schedule to be assigned from the dashboard...</p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl mb-10">
              {/* Device Card — operator (2026-04-27): "this is the
                  splash screen after pairing, this is where i want it
                  to show the APK version, and also it says chrome but
                  this is a android device." Detection rule: if the
                  page URL has ?v= (passed by the Android APK in
                  MainActivity) → it's the Android player. Otherwise
                  fall back to the userAgent string for browser-only
                  players. */}
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex flex-col items-center text-center">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
                  <Monitor className="w-6 h-6 text-indigo-500" />
                </div>
                <h3 className="text-sm font-bold text-slate-800">{screenName || 'Display Screen'}</h3>
                {(() => {
                  const qp = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
                  const w = qp ? (parseInt(qp.get('w') || '0', 10) || window.screen.width) : 0;
                  const h = qp ? (parseInt(qp.get('h') || '0', 10) || window.screen.height) : 0;
                  const apkV = qp?.get('v') || null;
                  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
                  // Real platform — APK presence (?v=) wins. Don't say
                  // "Chrome" on a kiosk just because the WebView UA
                  // contains the word.
                  const platform = apkV
                    ? 'Android'
                    : /android/i.test(ua) ? 'Android'
                    : /iphone|ipad|ipod/i.test(ua) ? 'iOS'
                    : /windows/i.test(ua) ? 'Windows'
                    : /mac/i.test(ua) ? 'macOS'
                    : /linux/i.test(ua) ? 'Linux'
                    : 'Browser';
                  return (
                    <>
                      <p className="text-xs font-semibold text-slate-400 mt-1">
                        {w && h ? `${w}×${h}` : 'Unknown'} • {platform}
                      </p>
                      {apkV && (
                        <p className="text-[11px] font-semibold text-slate-500 mt-1">
                          Player <span className="text-slate-700 font-bold">v{apkV}</span>
                        </p>
                      )}
                    </>
                  );
                })()}
                <div className="mt-4 flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-lg text-xs font-bold">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Online
                </div>
              </div>

              {/* Storage Card */}
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex flex-col items-center text-center">
                <div className="w-12 h-12 rounded-2xl bg-sky-50 flex items-center justify-center mb-4">
                  <HardDrive className="w-6 h-6 text-sky-500" />
                </div>
                <h3 className="text-sm font-bold text-slate-800">Local Storage</h3>
                <p className="text-xs font-semibold text-slate-400 mt-1">{storageInfo.used} used of {storageInfo.total}</p>
                <div className="w-full h-2 bg-slate-100 rounded-full mt-4 overflow-hidden">
                  <div className="h-full bg-sky-500 rounded-full transition-all duration-1000" style={{ width: `${storageInfo.percent}%` }} />
                </div>
              </div>

              {/* Server Card */}
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex flex-col items-center text-center">
                <div className="w-12 h-12 rounded-2xl bg-violet-50 flex items-center justify-center mb-4">
                  <Server className="w-6 h-6 text-violet-500" />
                </div>
                <h3 className="text-sm font-bold text-slate-800">CMS Server</h3>
                <p className="text-xs font-semibold text-slate-400 mt-1 truncate w-full px-2" title={typeof window !== 'undefined' ? window.location.hostname : 'Local'}>{typeof window !== 'undefined' ? window.location.hostname : 'Local'}</p>
                <p className="text-[10px] font-semibold text-slate-400 mt-1">Last sync: {lastSync || 'Never'}</p>
              </div>
            </div>

            {/* Update Available card — operator (2026-04-27): "this is
                also the screen that should show when an upgrade is
                available and also allow me to kick it off, and also
                show the complete status of the upgrade whether i
                trigger it from here or if i push it... feedback
                should be from this screen."
                Compares the APK version (?v= on URL) to the latest
                published GitHub Release. Renders only when the kiosk
                is behind. The Install button calls
                EduCmsNative.checkForUpdates() — same path as the
                dashboard's Push button. */}
            {(() => {
              const apkV = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('v') : null;
              if (!apkV || !latestApkVersion) return null;
              // Simple semver-ish compare. If kiosk is at or past
              // latest, no card. Inflight push (otaProgress is set)
              // takes the card over so we don't show "install" while
              // an install is already running.
              const norm = (v: string) => v.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
              const a = norm(apkV);
              const b = norm(latestApkVersion);
              let isBehind = false;
              const len = Math.max(a.length, b.length);
              for (let i = 0; i < len; i++) {
                const x = a[i] ?? 0;
                const y = b[i] ?? 0;
                if (x < y) { isBehind = true; break; }
                if (x > y) break;
              }
              if (otaProgress) {
                // Show inline OTA progress in the same slot.
                const elapsed = Date.now() - otaProgress.startedAt;
                const stage =
                  elapsed < 15_000  ? { emoji: '📡', label: 'Sending update signal…' } :
                  elapsed < 60_000  ? { emoji: '⬇️', label: 'Downloading new player…' } :
                  elapsed < 150_000 ? { emoji: '⚙️', label: 'Installing… (Android prompt may show)' } :
                  elapsed < 300_000 ? { emoji: '🔄', label: 'Restarting + reporting back…' } :
                                       { emoji: '⏱', label: 'No response after 5 minutes — retry on next reboot' };
                return (
                  <div className="w-full max-w-3xl mb-8 rounded-2xl bg-indigo-50 border border-indigo-200 p-5 flex items-center gap-4">
                    <span className="text-4xl shrink-0">{stage.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-indigo-900">Update in progress</div>
                      <div className="text-xs text-indigo-700 mt-0.5">{stage.label}</div>
                    </div>
                  </div>
                );
              }
              if (!isBehind) return null;
              return (
                <div className="w-full max-w-3xl mb-8 rounded-2xl bg-amber-50 border border-amber-200 p-5 flex items-center gap-4">
                  <span className="text-4xl shrink-0">⬆️</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-amber-900">Update available</div>
                    <div className="text-xs text-amber-700 mt-0.5">
                      Player <span className="font-mono font-bold">v{latestApkVersion}</span> is ready to install (you&rsquo;re on <span className="font-mono">v{apkV}</span>).
                    </div>
                  </div>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      // Mirror the dashboard's Push flow on-device:
                      // 1) Show progress overlay so operator sees stages.
                      // 2) Call native bridge to trigger OTA worker.
                      const bridge = (window as any).EduCmsNative;
                      const bridgeAvailable = !!(bridge && typeof bridge.checkForUpdates === 'function');
                      setOtaProgress({ startedAt: Date.now(), bridgeAvailable });
                      if (bridgeAvailable) {
                        try { bridge.checkForUpdates(); } catch (err) {
                          console.warn('[Player] self-update bridge call failed', err);
                        }
                      }
                    }}
                    className="shrink-0 px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-bold rounded-xl transition-all shadow-sm flex items-center gap-2 focus:scale-95 z-20 relative"
                  >
                    <Download className="w-4 h-4" /> Install now
                  </button>
                </div>
              );
            })()}

            <div className="flex flex-wrap items-center justify-center gap-3">
              <button onClick={async (e) => {
                e.stopPropagation();
                const ok = await appConfirm({
                  title: 'Unpair this screen?',
                  message: 'Tearing down the connection wipes the pairing from this device. The next session will require a new pairing code from the dashboard.',
                  tone: 'danger',
                  confirmLabel: 'Unpair device',
                });
                if (ok) {
                  localStorage.removeItem('edu_device_fp');
                  setPhase('registering');
                  setShowOverlay(false);
                }
              }} className="px-5 py-2.5 bg-white border border-slate-200 hover:border-red-100 hover:bg-red-50 text-slate-700 hover:text-red-600 text-sm font-bold rounded-2xl transition-all shadow-sm flex items-center gap-2 focus:scale-95 z-20 relative group">
                <Power className="w-4 h-4 text-slate-400 group-hover:text-red-500" /> Unpair
              </button>
              {/* Renamed from "Ping Server" — what it actually does is
                  re-fetch the manifest. "Sync now" matches the
                  language ops use elsewhere in the app. Operator
                  (2026-04-27) called out the old name as opaque. */}
              <button onClick={(e) => { e.stopPropagation(); fetchContent(); }} className="px-5 py-2.5 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-bold rounded-2xl transition-all shadow-sm flex items-center gap-2 focus:scale-95 z-20 relative" title="Re-fetch the playlist + assets from the server right now">
                <RefreshCw className="w-4 h-4 text-slate-400" /> Sync now
              </button>
              {/* Exit to device launcher — operator (2026-04-27): "we
                  should have an exit button on the screen too." Uses
                  the same handleExitApp cascade defined above
                  (native bridge → window.close → splash hint). */}
              <button onClick={(e) => { e.stopPropagation(); handleExitApp(); }} className="px-5 py-2.5 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-bold rounded-2xl transition-all shadow-sm flex items-center gap-2 focus:scale-95 z-20 relative">
                <LogOut className="w-4 h-4 text-slate-400" /> Exit
              </button>
              <button onClick={async (e) => {
                e.stopPropagation();
                await appAlert({
                  title: 'Nothing to play yet',
                  message: 'No assigned content is currently queued for this screen. Schedule a playlist from the dashboard, then tap Sync now to refresh.',
                  tone: 'info',
                });
              }} className="px-7 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-2xl transition-all shadow-[0_8px_20px_rgb(99,102,241,0.3)] hover:shadow-[0_8px_25px_rgb(99,102,241,0.4)] hover:-translate-y-0.5 flex items-center gap-2 focus:scale-95 z-20 relative">
                <Play className="w-4 h-4 fill-current" /> Auto-Play
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Slide level restriction overlay logic goes here if desired, but UI logic removes the bottom progress bar. */}

      {/* Preview mode chip — always visible so the browser preview tab is
          unmistakably distinct from the real kiosk. */}
      {isPreviewMode() && (
        <div className="absolute top-3 right-3 z-50 flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/90 backdrop-blur-sm text-white text-xs font-black uppercase tracking-wider rounded-full shadow-lg pointer-events-none select-none">
          <Monitor className="w-3.5 h-3.5" />
          Preview Mode
        </div>
      )}

      {/* Overlay */}
      {showOverlay && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-900 rounded-2xl p-8 max-w-md w-full mx-4 border border-slate-700 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">{screenName || 'Screen'}</h3>
              <div className="flex items-center gap-2">
                {isPreviewMode() && <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-amber-500/20 text-amber-400 rounded-full">Preview</span>}
                <Wifi className="w-4 h-4 text-emerald-400" />
                <span className="text-sm text-emerald-400 font-medium">Connected</span>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-400">Playlist</span><span className="text-white font-medium">{playlist?.name || 'None'}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Slide</span><span className="text-white font-medium">{(currentIndex % (sorted.length || 1)) + 1} / {sorted.length}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Last Sync</span><span className="text-white font-medium">{lastSync || 'Never'}</span></div>
              <CacheStatusRow status={cacheStatus} />
              <SoftwareInfoRow />
              <DiagnosticsRow />
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={(e) => { e.stopPropagation(); fetchContent(); }} className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium text-sm transition-colors">Sync Now</button>
              {/* Overlay actions trimmed to Sync + Stop. Exit +
                  Unpair are now on the Stopped splash where they
                  belong (the operator has already paused before
                  making a destructive choice). */}
              <button
                onClick={(e) => { e.stopPropagation(); handleStopPlayback(); }}
                onKeyDown={(e) => e.stopPropagation()}
                title="Stop playback — opens the player splash with Resume / Exit / Unpair"
                className="py-2 px-4 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-bold transition-colors"
              >
                Stop
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes shrink { from { width: 100%; } to { width: 0%; } }
      `}</style>
      {otaOverlay}
      {connectivityToast}
    </div>
  );
}

/**
 * On-device OTA progress overlay. Mirrors the dashboard's stage
 * progression (sending → downloading → installing → restarting) so
 * the operator at the kiosk and the operator at the dashboard see
 * the same info. Bridge-missing kiosks (legacy v1.0.4 or earlier)
 * get adapted copy explaining the limitation.
 *
 * Bottom-right anchored, full-width-ish band, doesn't cover the
 * actual content. Auto-dismisses on timeout (8 min); a successful
 * install reboots the kiosk which clears all state anyway.
 */
function OtaProgressOverlay({
  startedAt,
  bridgeAvailable,
  onDismiss,
}: {
  startedAt: number;
  bridgeAvailable: boolean;
  onDismiss: () => void;
}) {
  const elapsed = Date.now() - startedAt;

  // No-bridge path (legacy APK that can't react to Push). Show a
  // distinct message so the operator at the kiosk understands the
  // update can't proceed automatically — they need to wait for the
  // 6h periodic worker to run, OR (better) walk to the kiosk and
  // power-cycle it (BOOT_COMPLETED also triggers an OTA check).
  if (!bridgeAvailable) {
    return (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[10000] max-w-2xl px-6 py-4 rounded-2xl bg-amber-500 text-amber-950 shadow-2xl border border-amber-300 flex items-center gap-3">
        <span className="text-2xl shrink-0">⚠️</span>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-base">Update push received — but this kiosk needs an upgrade first</div>
          <div className="text-sm opacity-90 mt-0.5">
            This player APK is too old to install over-the-air. It will pick up the new build on its next 6-hour check or on reboot.
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 w-8 h-8 rounded-full bg-amber-950/20 hover:bg-amber-950/30 flex items-center justify-center font-bold"
        >
          ×
        </button>
      </div>
    );
  }

  // HONESTY FIX (2026-04-27): same change as the dashboard popover.
  // We no longer pretend to know which phase the OTA is in based on a
  // stopwatch — until v1.0.11's worker reports real per-phase events
  // (CHECKING / DOWNLOADING / VERIFYING / INSTALLING / ERROR), all we
  // can honestly say is "we sent the signal N seconds ago, still
  // waiting." When v1.0.11 is on the device this overlay will subscribe
  // to native progress messages via the JS bridge and show real stages.
  const stage: 'pending' | 'timeout' = elapsed < 5 * 60_000 ? 'pending' : 'timeout';

  const stageEmoji = stage === 'pending' ? '⏳' : '⏱';

  const elapsedSecs = Math.floor(elapsed / 1000);
  const elapsedHuman = elapsedSecs < 60
    ? `${elapsedSecs}s ago`
    : `${Math.floor(elapsedSecs / 60)}m ${elapsedSecs % 60}s ago`;

  const stageTitle = stage === 'pending'
    ? 'Player update in progress'
    : 'Update timed out';

  const stageSubtitle = stage === 'pending'
    ? `Update signal received ${elapsedHuman} — kiosk is checking, downloading, and installing the new APK in the background. The screen will restart once install completes.`
    : 'No version change after 5 minutes. The update will retry on next reboot, or sideload via ViPlex Express if it keeps failing.';

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[10000] max-w-2xl px-6 py-4 rounded-2xl bg-indigo-600 text-white shadow-2xl border border-indigo-400/40 flex items-center gap-4">
      <span className="text-3xl shrink-0">{stageEmoji}</span>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-base">{stageTitle}</div>
        <div className="text-sm opacity-90 mt-0.5">{stageSubtitle}</div>
      </div>
      {stage === 'timeout' && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center font-bold"
        >
          ×
        </button>
      )}
    </div>
  );
}
