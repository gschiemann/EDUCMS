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

import { nativeCall, nativeHas } from './nativeBridge';

/** localStorage key holding the last (screenId|appVersion) we reported. */
const MARKER_KEY = 'edu_display_caps_reported';

function markerFor(screenId: string, appVersion: string): string {
  return `${screenId}|${appVersion}`;
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
}): Promise<string> {
  const { screenId, apiRoot, token } = opts;
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
  // The probe reports `error` instead of a verdict when it fails wholesale.
  if (!parsed || typeof parsed !== 'object' || !parsed.verdict) {
    return 'skipped: probe has no verdict';
  }

  const appVersion =
    typeof (parsed.build as Record<string, unknown> | undefined)?.display === 'string'
      ? String((parsed.build as Record<string, unknown>).display)
      : 'unknown';
  const marker = markerFor(screenId, appVersion);
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
