/**
 * Display-capability self-report (2026-08-13).
 *
 * WHY THIS EXISTS
 * ---------------
 * `DisplayCapabilityProbe` (Kotlin) knows exactly what this box can drive —
 * backlight nodes, Settings keys, admin state, serial ports, and the
 * capability→provider map the control layer actually resolved. The dashboard
 * needs that to gate its per-screen controls honestly: never render a
 * brightness slider on a panel whose only mechanism is a software dim.
 *
 * The native side exposes it, and the API accepts it at
 * `POST /screens/:id/display-capabilities` — but nothing connected the two.
 * Without this module the probe is reachable only over an adb cable, which
 * does not scale past a bench unit. This is the last mile: every screen
 * reports its own capabilities on boot, so a fleet of any size is
 * self-describing and we never need physical access to answer "what can this
 * screen do?".
 *
 * REPORT ONCE PER (screen × app version), NOT PER LOAD.
 * The player page reloads on a watchdog, on REFRESH_WEB pushes, and on
 * network recovery. POSTing on every load would write the Screen row at
 * page-load frequency across the fleet. That write is safe for the manifest
 * hot cache today — `displayCapabilities` / `displayCapabilitiesAt` are both
 * listed in SCREEN_TELEMETRY_ONLY_FIELDS (see manifest-hot-cache.ts, which
 * documents exactly why and when that must change) — but "safe for the cache"
 * is not a licence to write it constantly. The verdict only changes when the
 * APK changes or an operator grants a permission, so the app version is the
 * right cache key. `DisplayControlRegistry.invalidate()` on the native side
 * handles the permission-grant case within a session; the next version bump
 * re-reports regardless.
 *
 * BEST-EFFORT, ALWAYS. This is admin visibility, never safety-critical. Every
 * failure path is swallowed: an old APK without `probeDisplay`, a bridge that
 * never attached, a 4xx, an offline screen. None of it may interfere with
 * playback or with the emergency path.
 */

import { nativeCall, nativeCallOr, nativeHas } from './nativeBridge';
import type { DeviceIdentity } from './displayControl';

/** localStorage key holding the last (screenId|appVersion) we reported. */
const MARKER_KEY = 'edu_display_caps_reported';

function markerFor(screenId: string, appVersion: string): string {
  return `${screenId}|${appVersion}`;
}

/**
 * The APK's `versionName`, which is what "report once per app version"
 * actually means.
 *
 * ⚠️ THE BUG THIS FIXES (2026-08-13 review). This used to read
 * `probeDisplay().build.display`, which is `Build.DISPLAY` — the OS build
 * id of the Android image, set by the box vendor and unchanged for the life
 * of the firmware. So the cache key never moved when the APK was updated:
 * a screen that reported once kept its marker forever, and every later APK
 * — new providers, new mechanisms, a whole new capability — was NEVER
 * re-reported. The dashboard's capability gating would keep gating on a
 * verdict from an APK that is no longer installed. `deviceInfo()` is the
 * only bridge method that exposes `appVersion` (BuildConfig.VERSION_NAME).
 *
 * FALLBACK. On the vanishingly rare box where `deviceInfo` is unreadable we
 * fall back to a UTC day bucket rather than a constant. A constant would
 * re-create the never-re-report bug; omitting the marker entirely would POST
 * on every watchdog reload. One write per screen per day is neither.
 */
async function appVersionKey(now: () => number = Date.now): Promise<string> {
  const raw = await nativeCallOr<string>('', 'deviceInfo');
  if (raw) {
    try {
      const info = JSON.parse(raw) as { appVersion?: unknown };
      if (typeof info?.appVersion === 'string' && info.appVersion.trim()) {
        return info.appVersion.trim();
      }
    } catch {
      /* fall through to the day bucket */
    }
  }
  return `unknown@${new Date(now()).toISOString().slice(0, 10)}`;
}

function alreadyReported(marker: string): boolean {
  try {
    return window.localStorage.getItem(MARKER_KEY) === marker;
  } catch {
    // Private mode / storage disabled — fall through and report. A duplicate
    // POST is far cheaper than never reporting at all.
    return false;
  }
}

function rememberReported(marker: string): void {
  try {
    window.localStorage.setItem(MARKER_KEY, marker);
  } catch {
    /* non-fatal */
  }
}

/**
 * Probe this device and POST the verdict. Resolves to a short status string
 * for logging; never rejects.
 */
export async function reportDisplayCapabilities(opts: {
  screenId: string;
  apiRoot: string;
  token: string | null;
  /**
   * Called with this box's `Build.MANUFACTURER/MODEL/BOARD` as soon as the
   * probe parses — BEFORE the once-per-version marker check, so a screen
   * that has already reported still hands its identity to the caller.
   *
   * The player uses it to pick which vendor recipe out of the manifest's
   * catalog to install (see displayControl.ts). The probe is the only
   * bridge surface that reports `board`, which is why this rides along
   * here instead of re-probing.
   */
  onIdentity?: (identity: DeviceIdentity) => void;
}): Promise<string> {
  const { screenId, apiRoot, token, onIdentity } = opts;
  if (!screenId || !apiRoot) return 'skipped: no screen/api';

  // Older APKs have no probe at all. `nativeHas` covers both transports.
  if (!nativeHas('probeDisplay')) return 'skipped: no native probe';

  let raw: string;
  try {
    raw = await nativeCall<string>('probeDisplay');
  } catch {
    return 'skipped: probe threw';
  }
  if (!raw) return 'skipped: empty probe';

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return 'skipped: probe not json';
  }
  // Hand the caller this box's Build identity even when the probe has no
  // verdict — recipe matching does not depend on the verdict, and a screen
  // whose probe partially failed should still get its vendor recipe.
  if (onIdentity && parsed && typeof parsed === 'object') {
    const build = parsed.build as Record<string, unknown> | undefined;
    if (build && typeof build === 'object') {
      const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
      try {
        onIdentity({
          manufacturer: str(build.manufacturer),
          model: str(build.model),
          board: str(build.board),
        });
      } catch {
        /* a throwing callback must not cost us the report */
      }
    }
  }

  // The probe reports `error` instead of a verdict when it fails wholesale.
  if (!parsed || typeof parsed !== 'object' || !parsed.verdict) {
    return 'skipped: probe has no verdict';
  }

  const marker = markerFor(screenId, await appVersionKey());
  if (alreadyReported(marker)) return 'skipped: already reported this version';

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(
      `${apiRoot}/api/v1/screens/${encodeURIComponent(screenId)}/display-capabilities`,
      { method: 'POST', headers, body: raw },
    );
    if (!res.ok) return `failed: HTTP ${res.status}`;
    // Only remember on a confirmed 2xx, so a transient 5xx re-reports on the
    // next load instead of being silently skipped until the next APK.
    rememberReported(marker);
    return 'reported';
  } catch {
    return 'failed: network';
  }
}
