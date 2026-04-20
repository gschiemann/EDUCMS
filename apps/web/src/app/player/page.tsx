"use client";

import { useState, useEffect, useCallback, useRef, useMemo, Component, ReactNode } from 'react';
import '@/components/widgets/variants-register'; // Boot-time registration for custom themes
import { MonitorPlay, Wifi, WifiOff, AlertTriangle, Loader2, Settings, CheckCircle2, HardDrive, Cpu, Server, Network, Play, Monitor, Info, Power } from 'lucide-react';
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
//   1. URL ?fp= — passed by the Android APK using Settings.Secure.ANDROID_ID
//      which survives app uninstalls + reinstalls (it only rotates on
//      factory reset). This is what lets a re-sideloaded kiosk come back
//      paired without a fresh pairing dance.
//   2. URL ?deviceId= — legacy alias used by dev test paths
//   3. localStorage 'edu_device_fp' — fallback for pure browser players
//      (plain Chrome tab). Gets a random UUID on first run and sticks
//      as long as the browser profile lasts.
function getDeviceFingerprint(): string {
  const key = 'edu_device_fp';
  if (typeof window !== 'undefined') {
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
  static getDerivedStateFromError(err: any) { return { hasError: true, err }; }
  componentDidCatch(err: any, info: any) {
    console.error('[Player] FATAL render error', err, info);
    // Auto-recover after 8s. In the Android shell, ask the native side to do a
    // hard reload (clears WebView caches + GPU state).
    setTimeout(() => {
      if (isAndroidWebView()) nativeReload();
      else if (typeof window !== 'undefined') window.location.reload();
    }, 8_000);
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
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
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
  const wsFailCountRef = useRef(0);
  const lastWsMessageAtRef = useRef<number>(Date.now());
  // Audit fix #2 (partial): WebSocket message replay/dupe protection.
  // Tracks recent eventIds so an attacker who captures a signed message
  // can't replay it. Eviction is a soft cap to bound memory.
  const recentEventIdsRef = useRef<Map<string, number>>(new Map());
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

  // Report cache status to the server every 30s so admins can see in the
  // dashboard which screens actually have emergency content on disk.
  //
  // sec-fix(wave1) #5 made /cache-status require a device JWT whose `sub`
  // equals the screenId. Without a Bearer header the POST was 401-ing
  // silently, so the `lastCacheReport` column never populated and the
  // dashboard's cache pill was stuck on "?" forever. The device token is
  // minted at /register time and cached in localStorage as LS_TOKEN.
  useEffect(() => {
    if (!screenId) return;
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
        registerFailCountRef.current += 1;
        const delayMs = backoffMs(registerFailCountRef.current, 2_000, 30_000);
        console.warn(
          `[Player] register failed (#${registerFailCountRef.current}): ${e?.message || e} — retrying in ${Math.round(delayMs / 1000)}s`,
        );
        setError(e?.message || 'Cannot reach the server');
        setPhase('offline');
        // Schedule the re-attempt. phase flip to 'registering' re-runs
        // this useEffect and the whole dance starts over. Guard via
        // cancelled in case we unmount mid-timer.
        const targetAt = Date.now() + delayMs;
        setAutoRetryInSec(Math.ceil(delayMs / 1000));
        autoRetryIntervalRef.current = setInterval(() => {
          const remain = Math.max(0, Math.ceil((targetAt - Date.now()) / 1000));
          setAutoRetryInSec(remain);
          if (remain === 0 && autoRetryIntervalRef.current) {
            clearInterval(autoRetryIntervalRef.current);
            autoRetryIntervalRef.current = null;
          }
        }, 1000);
        registerRetryTimerRef.current = setTimeout(() => {
          if (!cancelled) setPhase('registering');
        }, delayMs);
      }
    };

    register();

    return () => {
      cancelled = true;
      if (registerRetryTimerRef.current) {
        clearTimeout(registerRetryTimerRef.current);
        registerRetryTimerRef.current = null;
      }
      if (autoRetryIntervalRef.current) {
        clearInterval(autoRetryIntervalRef.current);
        autoRetryIntervalRef.current = null;
      }
    };
  }, [phase]);

  // ─── Phase 2: Poll while showing pairing code (with backoff on errors) ───
  useEffect(() => {
    if (phase !== 'pairing') return;
    // Defensively clear any prior interval before scheduling a new one.
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }

    const fp = getDeviceFingerprint();
    let pollFails = 0;
    const tick = async () => {
      try {
        const res = await fetch(`${getApiRoot()}/api/v1/screens/status/${fp}`);
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
        if (pollRef.current) clearInterval(pollRef.current);
        const delay = backoffMs(pollFails, 3000, 30_000);
        pollRef.current = setTimeout(tick as any, delay) as any;
      }
    };
    pollRef.current = setInterval(tick, 3000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        clearTimeout(pollRef.current as any);
        pollRef.current = null;
      }
    };
  }, [phase]);

  // ─── Phase 3: Fetch playlist content ───
  const fetchContent = useCallback(async () => {
    if (!screenId) return;

    // Resolve auth token for this fetch:
    //   1. Device pairing token from URL/localStorage (production path)
    //   2. Cached short-lived admin JWT (cuts login round-trip on subsequent polls)
    //   3. Fresh admin login (dev fallback, kept so browser testing still works)
    const resolveAuthToken = async (): Promise<string> => {
      const deviceTok = getDeviceToken();
      if (deviceTok) return deviceTok;
      if (cachedAuthTokenRef.current) return cachedAuthTokenRef.current;
      const loginRes = await fetch(`${getApiRoot()}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@springfield.edu', password: 'admin123' }),
      });
      if (!loginRes.ok) throw new Error('Auth failed');
      const { access_token } = await loginRes.json();
      cachedAuthTokenRef.current = access_token;
      // Auto-expire the cached token after 50 minutes (JWTs in this app are 1h).
      setTimeout(() => { cachedAuthTokenRef.current = null; }, 50 * 60 * 1000);
      return access_token;
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
        const firstTemplate = manifest.playlists.find((pl: any) => pl.template);
        if (firstTemplate) {
          setPlaylist({ name: firstTemplate.template.name || 'Template Content', template: firstTemplate.template, items: [] });
          setCurrentIndex(0);
          return true;
        }
        const combinedItems: any[] = [];
        manifest.playlists.forEach((mp: any) => {
          mp.items.forEach((item: any) => {
            combinedItems.push({
              id: item.url + Math.random().toString(),
              durationMs: item.duration_ms,
              sequenceOrder: item.sequence,
              asset: { fileUrl: item.url, mimeType: item.url.match(/\.(mp4|webm)$/i) ? 'video/mp4' : 'image/jpeg' },
            });
          });
        });
        if (combinedItems.length > 0) {
          setPlaylist({
            name: manifest.playlists.length > 1 ? 'Scheduled Content (Combined)' : manifest.playlists[0].name || 'Scheduled Content',
            items: combinedItems,
          });
          setCurrentIndex(0);
          return true;
        }
      }
      setPlaylist(null);
      setCurrentIndex(0);
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
        if (playlist) {
          // Keep current playlist on screen — don't flip to 'offline' phase
          // which would freeze playback. A kiosk keeps playing across WiFi
          // outages.
          setError(`Reconnecting… (${fetchFailCountRef.current})`);
        } else {
          setError(e?.message || 'Network error — retrying');
          setPhase('offline');
        }
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
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const fp = getDeviceFingerprint();
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        await fetch(`${getApiRoot()}/api/v1/screens/status/${fp}`, {
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
        await fetch(`${getApiRoot()}/api/v1/screens/status/${fp}`, {
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
              if (typeof msg.timestamp !== 'number' || Math.abs(Date.now() - msg.timestamp) > 30_000) {
                console.warn('[Player WS] dropped stale/future event:', msg.type, msg.timestamp);
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
                try {
                  const bridge = (window as any).EduCmsNative;
                  if (bridge && typeof bridge.checkForUpdates === 'function') {
                    const v = bridge.checkForUpdates();
                    console.log('[Player] CHECK_FOR_UPDATES relayed to native, currentVersion=', v);
                  } else {
                    console.log('[Player] CHECK_FOR_UPDATES ignored — no native bridge (browser player)');
                  }
                } catch (e) {
                  console.warn('[Player] CHECK_FOR_UPDATES bridge call failed', e);
                }
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

  // ─── Render: Registering ───
  if (phase === 'registering') {
    return (
      <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center">
        <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mb-4" />
        <p className="text-xl text-white font-medium">Registering device...</p>
      </div>
    );
  }

  // ─── Render: Pairing Code Screen ───
  if (phase === 'pairing') {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 flex flex-col items-center justify-center">
        <div className="text-center max-w-lg px-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 mb-6">
            <MonitorPlay className="w-10 h-10 text-indigo-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">{brandName} Player</h1>
          <p className="text-slate-400 mb-8">Enter this code in your CMS dashboard to pair this screen</p>

          {/* Big pairing code */}
          <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-700/50 rounded-2xl px-12 py-8 mb-8 shadow-2xl shadow-indigo-500/10">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-[0.3em] mb-3">Pairing Code</p>
            <p className="text-6xl font-black text-white tracking-[0.3em] font-mono">
              {pairingCode}
            </p>
          </div>

          {/* Device info */}
          <div className="bg-slate-900/40 rounded-xl border border-slate-800 p-4 text-left space-y-2">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Device Info</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-slate-500">Resolution: </span>
                <span className="text-slate-300 font-medium">{typeof window !== 'undefined' ? (() => { const qp=new URLSearchParams(window.location.search); const w=parseInt(qp.get('w')||'0',10)||window.screen.width; const h=parseInt(qp.get('h')||'0',10)||window.screen.height; return `${w}×${h}`; })() : ''}</span>
              </div>
              <div>
                <span className="text-slate-500">Browser: </span>
                <span className="text-slate-300 font-medium">{typeof window !== 'undefined' ? (navigator.userAgent.includes('Chrome') ? 'Chrome' : 'Other') : ''}</span>
              </div>
              <div>
                <span className="text-slate-500">Platform: </span>
                <span className="text-slate-300 font-medium">{typeof navigator !== 'undefined' ? navigator.platform : ''}</span>
              </div>
              <div>
                <span className="text-slate-500">Status: </span>
                <span className="text-amber-400 font-medium flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
                  Waiting for pairing...
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Render: Connecting ───
  if (phase === 'connecting') {
    return (
      <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center">
        <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mb-4" />
        <p className="text-xl text-white font-medium">Loading content...</p>
        <p className="text-slate-500 text-sm mt-2">{screenName}</p>
      </div>
    );
  }

  // ─── Render: Offline ───
  // Still auto-reconnecting in the background — the registration
  // useEffect's retry timer + fetchContent's retry timer keep firing
  // regardless of what this screen says. The UI just surfaces the
  // countdown so the operator knows we're working on it and doesn't
  // need to touch anything. User ask: "make sure the player is
  // constantly checking in to get reconnected and not waiting for me".
  if (phase === 'offline') {
    const nextIn = autoRetryInSec != null && autoRetryInSec > 0 ? autoRetryInSec : null;
    return (
      <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center px-8">
        <WifiOff className="w-16 h-16 text-red-500 mb-4" />
        <h2 className="text-2xl text-white font-bold mb-2">Reconnecting…</h2>
        <p className="text-slate-400 mb-1 text-center max-w-xl">{error || 'Cannot reach the server right now.'}</p>
        <p className="text-slate-500 text-sm mb-6">
          {nextIn != null
            ? `Next attempt in ${nextIn}s — we'll keep trying.`
            : 'Retrying now…'}
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => {
              // Smart retry — if we never got a screenId through
              // registration (because /register failed), go all the
              // way back to 'registering'. Otherwise jump straight
              // to 'connecting' which re-fires fetchContent.
              setError(null);
              setAutoRetryInSec(null);
              if (registerRetryTimerRef.current) {
                clearTimeout(registerRetryTimerRef.current);
                registerRetryTimerRef.current = null;
              }
              if (autoRetryIntervalRef.current) {
                clearInterval(autoRetryIntervalRef.current);
                autoRetryIntervalRef.current = null;
              }
              setPhase(screenId ? 'connecting' : 'registering');
            }}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium"
          >
            Retry now
          </button>
          <button
            onClick={() => { localStorage.removeItem('edu_device_fp'); setPhase('registering'); }}
            className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-medium"
          >
            Reset Device
          </button>
        </div>
      </div>
    );
  }

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

    return (
      <div
        className={`fixed inset-0 ${isTouchTemplate ? '' : 'cursor-none'}`}
        role="button"
        tabIndex={0}
        aria-label="Toggle screen info overlay"
        onClick={isTouchTemplate ? undefined : () => setShowOverlay(!showOverlay)}
        onKeyDown={e => { if (!isTouchTemplate && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setShowOverlay(s => !s); } }}
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
          return (
          <div
            key={`${zone.id}-${isTouchTemplate ? sceneTick : 0}`}
            className="absolute overflow-hidden"
            onClick={onZoneClick}
            style={{
              left: `${zone.x}%`,
              top: `${zone.y}%`,
              width: `${zone.width}%`,
              height: `${zone.height}%`,
              zIndex: zone.zIndex || 0,
              cursor: zoneTouchAction ? 'pointer' : undefined,
            }}>
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

        {/* Info overlay */}
        {showOverlay && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[999]">
            <div className="bg-slate-900 rounded-2xl p-8 max-w-md w-full mx-4 border border-slate-700 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">{screenName || 'Screen'}</h3>
                <div className="flex items-center gap-2">
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
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={(e) => { e.stopPropagation(); fetchContent(); }} className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium text-sm transition-colors">Sync Now</button>
                <button onClick={(e) => { 
                  e.stopPropagation(); 
                  if(window.confirm('Are you sure you want to unpair this screen?')) {
                    localStorage.removeItem('edu_device_fp'); 
                    setPhase('registering'); 
                    setShowOverlay(false); 
                  }
                }} title="Unpair Device" className="py-2 px-4 bg-red-950/40 hover:bg-red-900 border border-red-900/50 text-red-200 hover:text-white rounded-lg text-sm transition-colors">
                  <Power className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
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
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowOverlay(s => !s); } }}
    >
      {currentItem ? (
        <div className="relative w-full h-full flex items-center justify-center pointer-events-none">
          {sorted.map((item, index) => {
            const isActive = index === (currentIndex % sorted.length);
            const isVid = item.asset?.mimeType?.startsWith('video/');
            const fileUrl = item.asset?.fileUrl || '';
            const resUrl = fileUrl.startsWith('http') ? fileUrl : `${getApiRoot()}${fileUrl}`;
            
            // Render video ONLY when active to preserve memory
            if (isVid && !isActive) return null;

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
              {/* Device Card */}
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex flex-col items-center text-center">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
                  <Monitor className="w-6 h-6 text-indigo-500" />
                </div>
                <h3 className="text-sm font-bold text-slate-800">{screenName || 'Display Screen'}</h3>
                <p className="text-xs font-semibold text-slate-400 mt-1">{typeof window !== 'undefined' ? (() => { const qp=new URLSearchParams(window.location.search); const w=parseInt(qp.get('w')||'0',10)||window.screen.width; const h=parseInt(qp.get('h')||'0',10)||window.screen.height; return `${w}×${h}`; })() : 'Unknown'} • {typeof navigator !== 'undefined' ? (navigator.userAgent.includes('Chrome') ? 'Chrome' : 'Other') : ''}</p>
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

            <div className="flex flex-wrap items-center justify-center gap-4">
              <button onClick={(e) => { 
                e.stopPropagation(); 
                if(window.confirm('Are you absolutely certain you want to tear down the connection? This will wipe the pairing from this device.')) {
                  localStorage.removeItem('edu_device_fp'); 
                  setPhase('registering'); 
                  setShowOverlay(false);
                }
              }} className="px-6 py-3 bg-white border border-slate-200 hover:border-red-100 hover:bg-red-50 text-slate-700 hover:text-red-600 text-sm font-bold rounded-2xl transition-all shadow-sm flex items-center gap-2 focus:scale-95 z-20 relative group">
                <Power className="w-5 h-5 text-slate-400 group-hover:text-red-500" /> Unpair Device
              </button>
              <button onClick={(e) => { e.stopPropagation(); fetchContent(); }} className="px-6 py-3 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-bold rounded-2xl transition-all shadow-sm flex items-center gap-2 focus:scale-95 z-20 relative">
                <Network className="w-5 h-5 text-slate-400" /> Ping Server
              </button>
              <button onClick={(e) => { e.stopPropagation(); alert('No assigned content currently queued.'); }} className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-2xl transition-all shadow-[0_8px_20px_rgb(99,102,241,0.3)] hover:shadow-[0_8px_25px_rgb(99,102,241,0.4)] hover:-translate-y-0.5 flex items-center gap-2 focus:scale-95 z-20 relative">
                <Play className="w-5 h-5 fill-current" /> Auto-Play
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Slide level restriction overlay logic goes here if desired, but UI logic removes the bottom progress bar. */}

      {/* Overlay */}
      {showOverlay && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-900 rounded-2xl p-8 max-w-md w-full mx-4 border border-slate-700 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">{screenName || 'Screen'}</h3>
              <div className="flex items-center gap-2">
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
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={(e) => { e.stopPropagation(); fetchContent(); }} className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium text-sm transition-colors">Sync Now</button>
              <button onClick={(e) => { 
                e.stopPropagation(); 
                if(window.confirm('Are you sure you want to completely unpair this device from the CMS?')) {
                  localStorage.removeItem('edu_device_fp'); 
                  setPhase('registering'); 
                  setShowOverlay(false);
                }
              }} title="Unpair Device" className="py-2 px-4 bg-red-950/40 hover:bg-red-900 border border-red-900/50 text-red-200 hover:text-white rounded-lg text-sm transition-colors group">
                <Power className="w-4 h-4 group-hover:text-red-100" />
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes shrink { from { width: 100%; } to { width: 0%; } }
      `}</style>
    </div>
  );
}
