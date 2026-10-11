/**
 * Automatic Player APK updates — who may be offered one WITHOUT an operator
 * asking (2026-10-11, owner decisions).
 *
 * THE PROBLEM. An automatic update on a panel that cannot install silently
 * pops Android's "Install?" prompt OVER playing content and leaves it there
 * until someone walks up to the screen. That breaks the never-interrupt rule,
 * so an unattended offer has to be one the panel will take without a prompt,
 * at an hour nobody is watching.
 *
 * THE RULES (all must hold for an AUTOMATIC offer):
 *   1. OPT-IN. Off unless enabled for the organisation
 *      (Tenant.autoUpdatePlayerEnabled) or for this one screen
 *      (Screen.autoUpdatePlayerOverride). The screen setting wins:
 *      true = on even when the org is off; false = off even when the org is
 *      on; null = inherit. Default everywhere stays OFF.
 *   2. SILENT ONLY. The screen's latest device inventory must say
 *      `app.silentUpdateArmed === true` (Android 12+ AND the Player is its own
 *      installer-of-record — `DisplayCapabilityProbe.appIdentity`), and that
 *      report must describe the build the screen is running now (its
 *      `app.versionCode` equals the version the screen reports). An inventory
 *      that predates the current install proves nothing about it.
 *   3. THE PLAYER'S OWN CHECK. Only the Player's own update worker (no
 *      `source`, or `player`) — never the Manager companion's check, which
 *      installs through the MANAGER's session, where the Player's
 *      installer-of-record fact does not apply and the prompt would appear.
 *   4. OFF-HOURS. Inside the organisation's OTA window when one is set,
 *      otherwise 03:00–04:00 local. "Local" = the org window's timezone,
 *      else the screen's own on/off schedule timezone. No usable timezone →
 *      no automatic offer (03:00 UTC is evening in the Americas).
 *
 * What this does NOT touch: an operator's explicit "Send update"
 * (forceApkUpdatePendingAt) and a tap on the panel's own Update button keep
 * working for any screen — a person chose to show the prompt. Canary pacing
 * still applies after this gate, unchanged.
 *
 * Pure: the controller gathers the facts, this decides. Fail closed on every
 * malformed input — the old window check defaults to "inside" on bad config,
 * which is right for an operator push and wrong for an unattended one.
 */

export const DEFAULT_AUTO_UPDATE_WINDOW = { start: '03:00', end: '04:00' } as const;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export type SilentReadiness = 'silent' | 'needs-tap' | 'unknown';

export interface SilentReadinessResult {
  readiness: SilentReadiness;
  /** Stable reason code, shown to operators through i18n keys. */
  reason:
    | 'armed'
    | 'no-report'
    | 'report-predates-install'
    | 'android-too-old'
    | 'installed-by-another-app'
    | 'not-armed';
}

const rec = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x);

/**
 * Can this screen take an update without the Android prompt?
 * `installedVersionCode` is the build the screen runs now (its update-check
 * `versionCode`, or `Screen.playerVersionCode` for the dashboard).
 */
export function silentUpdateReadiness(
  inventoryReport: unknown,
  installedVersionCode: number | null | undefined,
): SilentReadinessResult {
  const app = rec(inventoryReport) ? inventoryReport.app : undefined;
  if (!rec(app) || typeof app.silentUpdateArmed !== 'boolean') {
    return { readiness: 'unknown', reason: 'no-report' };
  }
  const reported = typeof app.versionCode === 'number' ? app.versionCode : null;
  const installed =
    typeof installedVersionCode === 'number' && installedVersionCode > 0 ? installedVersionCode : null;
  if (reported === null || installed === null || reported !== installed) {
    return { readiness: 'unknown', reason: 'report-predates-install' };
  }
  if (app.silentUpdateArmed === true) return { readiness: 'silent', reason: 'armed' };
  if (typeof app.sdkInt === 'number' && app.sdkInt < 31) {
    return { readiness: 'needs-tap', reason: 'android-too-old' };
  }
  if (app.selfIsInstallerOfRecord === false) {
    return { readiness: 'needs-tap', reason: 'installed-by-another-app' };
  }
  return { readiness: 'needs-tap', reason: 'not-armed' };
}

/** Effective automatic-update switch: the screen's override, else the org's. */
export function autoUpdateEnabledFor(
  orgEnabled: boolean | null | undefined,
  screenOverride: boolean | null | undefined,
): { enabled: boolean; source: 'screen' | 'org' } {
  if (screenOverride === true || screenOverride === false) {
    return { enabled: screenOverride, source: 'screen' };
  }
  return { enabled: orgEnabled === true, source: 'org' };
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface ResolvedWindow {
  start: string;
  end: string;
  timezone: string;
  /** 'org' = the organisation's own window hours; 'default' = 03:00–04:00. */
  hoursSource: 'org' | 'default';
  /** Where the timezone came from. */
  zoneSource: 'org' | 'schedule';
}

/**
 * The window an automatic offer must land in. The org's hours when BOTH are
 * set and well-formed; otherwise the 03:00–04:00 default. Timezone: the org's
 * window timezone, else the screen's own on/off schedule timezone, else none
 * (→ null, no automatic offer).
 */
export function resolveAutoUpdateWindow(input: {
  orgStart?: string | null;
  orgEnd?: string | null;
  orgTimezone?: string | null;
  scheduleTimezone?: string | null;
}): ResolvedWindow | null {
  let timezone: string | null = null;
  let zoneSource: ResolvedWindow['zoneSource'] = 'org';
  if (isValidTimeZone(input.orgTimezone)) {
    timezone = input.orgTimezone;
  } else if (isValidTimeZone(input.scheduleTimezone)) {
    timezone = input.scheduleTimezone;
    zoneSource = 'schedule';
  }
  if (!timezone) return null;
  const orgHours =
    typeof input.orgStart === 'string' && typeof input.orgEnd === 'string' &&
    HHMM.test(input.orgStart) && HHMM.test(input.orgEnd) && input.orgStart !== input.orgEnd;
  return orgHours
    ? { start: input.orgStart!, end: input.orgEnd!, timezone, hoursSource: 'org', zoneSource }
    : { ...DEFAULT_AUTO_UPDATE_WINDOW, timezone, hoursSource: 'default', zoneSource };
}

/** Strict: malformed anything → false (never "inside"). Wraparound windows supported. */
export function isInsideWindowStrict(w: { start: string; end: string; timezone: string }, now: Date): boolean {
  if (!HHMM.test(w.start) || !HHMM.test(w.end) || !isValidTimeZone(w.timezone)) return false;
  let hh: number;
  let mm: number;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: w.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now);
    hh = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '', 10) % 24;
    mm = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '', 10);
  } catch {
    return false;
  }
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return false;
  const nowMin = hh * 60 + mm;
  const [sh, sm] = w.start.split(':').map(Number);
  const [eh, em] = w.end.split(':').map(Number);
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  if (s === e) return false;
  return s < e ? nowMin >= s && nowMin < e : nowMin >= s || nowMin < e;
}

export interface AutomaticOfferFacts {
  orgEnabled: boolean | null | undefined;
  screenOverride: boolean | null | undefined;
  /** `source` on the update-check body ('' for the Player's own worker). */
  callerSource: string;
  callerVersionCode: number;
  inventoryReport: unknown;
  window: ResolvedWindow | null;
  now: Date;
}

export interface AutomaticOfferDecision {
  offer: boolean;
  /** Greppable `[ota]` reason. */
  reason: string;
}

export function decideAutomaticOffer(f: AutomaticOfferFacts): AutomaticOfferDecision {
  const sw = autoUpdateEnabledFor(f.orgEnabled, f.screenOverride);
  if (!sw.enabled) return { offer: false, reason: `auto-off-${sw.source}` };
  const src = (f.callerSource || '').trim();
  if (src !== '' && src !== 'player') return { offer: false, reason: `auto-not-player-worker-${src}` };
  const ready = silentUpdateReadiness(f.inventoryReport, f.callerVersionCode);
  if (ready.readiness !== 'silent') return { offer: false, reason: `auto-not-silent-${ready.reason}` };
  if (!f.window) return { offer: false, reason: 'auto-no-timezone' };
  if (!isInsideWindowStrict(f.window, f.now)) {
    return {
      offer: false,
      reason: `auto-outside-window-${f.window.start}-${f.window.end}-${f.window.timezone}`,
    };
  }
  return {
    offer: true,
    reason: `auto-${sw.source}-silent-inside-${f.window.hoursSource}-window-${f.window.start}-${f.window.end}-${f.window.timezone}`,
  };
}
