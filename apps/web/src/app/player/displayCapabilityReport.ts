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
 * REPORT ONCE PER (screen × app version × VERDICT STATE), NOT PER LOAD.
 * The player page reloads on a watchdog, on REFRESH_WEB pushes, and on
 * network recovery. POSTing on every load would write the Screen row at
 * page-load frequency across the fleet. That write is safe for the manifest
 * hot cache today — `displayCapabilities` / `displayCapabilitiesAt` are both
 * listed in SCREEN_TELEMETRY_ONLY_FIELDS (see manifest-hot-cache.ts, which
 * documents exactly why and when that must change) — but "safe for the cache"
 * is not a licence to write it constantly.
 *
 * WHY THE VERDICT STATE IS PART OF THE KEY (2026-08-17, found on the FIRST
 * real install). The verdict changes on exactly two events: an APK update, and
 * an operator granting a permission (WRITE_SETTINGS appop, device-admin
 * activation). The original key was app-version-only, so a grant made AFTER
 * the first report left `Screen.displayCapabilities` stale until the next APK
 * — observed live on TC22 the day the fleet moved to 1.1.2: the box reported
 * `software-dim` before its grants landed, and nothing would ever have
 * refreshed it. Folding a signature of the verdict into the marker means the
 * next natural reload after a grant re-reports, with zero extra writes in the
 * steady state: an unchanged verdict still dedupes exactly as before.
 *
 * The signature covers ONLY `verdict` — never the whole probe payload, which
 * carries `probedAt` and would re-POST on every single reload, the exact
 * write-frequency bug this marker exists to prevent.
 *
 * BEST-EFFORT, ALWAYS. This is admin visibility, never safety-critical. Every
 * failure path is swallowed: an old APK without `probeDisplay`, a bridge that
 * never attached, a 4xx, an offline screen. None of it may interfere with
 * playback or with the emergency path.
 */

import { bridgeTransport, nativeCall, nativeCallOr, nativeHas } from './nativeBridge';
import type { DeviceIdentity } from './displayControl';

/** localStorage key: last (screenId|appVersion|verdictSig|transport) reported. */
const MARKER_KEY = 'edu_display_caps_reported';

/**
 * ── PER-COMMAND OUTCOMES (2026-08-25, v1.1.5) ────────────────────────────
 *
 * THE HOLE THIS FILLS. The dashboard's `delivered:true` means the Redis
 * fan-out was up — never that the screen acted (`ApplyActionResult.delivered`
 * in display.service.ts says so in as many words). Everything downstream of
 * that was equally blind: the APK returns a JSON verdict rather than throwing,
 * `dispatchDisplayControl` returns before that promise settles, and the verdict
 * ended its life in a console on a wall-mounted kiosk. So a command that ran a
 * mechanism which did nothing was INDISTINGUISHABLE from one that worked. That
 * is the exact confusion behind the 2026-08-25 field night.
 *
 * Now every executed command leaves a record: the `actionId` the server issued,
 * the mechanism the APK actually ran, applied/failed, the failure reason, and
 * the before/after backlight sample that says whether the glass moved.
 *
 * WHY IT RIDES THE CAPABILITY REPORT INSTEAD OF A NEW ENDPOINT.
 *   * `POST /screens/:id/display-capabilities` is already the device→server
 *     channel for "what this hardware can do", device-authenticated by the
 *     same `verifyDeviceForScreen` gate, and already throttled.
 *   * It lands in `screen_device_inventory` — a table that is deliberately NOT
 *     in MANIFEST_FED_MODELS and is read on demand only, so these writes can
 *     never bust the per-screen manifest hot cache. A new Screen column would
 *     have had to be argued onto SCREEN_TELEMETRY_ONLY_FIELDS; this needs no
 *     such argument because it never touches the Screen row's manifest fields.
 *   * The report carries a fresh probe anyway, so the outcome arrives WITH the
 *     hardware picture that produced it — which is the pairing that makes it
 *     answer "which mechanism works on which model".
 *
 * A RING, NOT A SINGLE VALUE. The row is replaced wholesale on each upsert, so
 * sending only the newest outcome would erase the history that shows a
 * mechanism failing repeatedly. Ten is enough to see a pattern and small enough
 * to stay far inside the endpoint's 32 KB inventory ceiling.
 */
const OUTCOMES_KEY = 'edu_display_command_outcomes';
const MAX_OUTCOMES = 10;
/** How many of the newest entries keep their raw before/after samples. */
const EVIDENCE_KEEP = 3;

export interface DisplayCommandOutcome {
  /** The server-issued action id, so a row here pairs with its audit row. */
  actionId: string | null;
  /** What the operator asked for (the WIRE verb, pre-translation). */
  action: string | null;
  /** 'WS' | 'SSE' — which transport carried it. */
  via: string;
  /** ISO timestamp, device clock. */
  at: string;
  /** How this player handled it: sent / soft / no-bridge / dropped / … */
  status: string;
  /** The mechanism the APK actually ran, e.g. 'sysfs-backlight'. */
  mechanism?: string | null;
  /** Did the mechanism report success? */
  applied?: boolean;
  /** Refusal code on failure: unsupported / failed / insecure-transport / … */
  code?: string | null;
  /** Human-readable failure reason. */
  message?: string | null;
  /**
   * Did anything this uid can READ actually change? The silent-no-op
   * detector — `applied:true` with `changed:false` is a mechanism that
   * reported success and moved nothing.
   */
  changed?: boolean | null;
  /** The raw before/after sample, for per-model forensics. */
  evidence?: unknown;
}

/** The device-local ring as it stands right now. Total; never throws. */
export function readCommandOutcomes(): DisplayCommandOutcome[] {
  return readOutcomes();
}

function readOutcomes(): DisplayCommandOutcome[] {
  try {
    const raw = window.localStorage.getItem(OUTCOMES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed.slice(-MAX_OUTCOMES) as DisplayCommandOutcome[]) : [];
  } catch {
    return [];
  }
}

/**
 * Append one outcome to the device-local ring and return the whole ring.
 * Total: storage being unavailable degrades to "report just this one",
 * which is still strictly better than the nothing we had.
 */
export function recordCommandOutcome(
  outcome: DisplayCommandOutcome,
): DisplayCommandOutcome[] {
  const next = [...readOutcomes(), outcome].slice(-MAX_OUTCOMES);
  // ⚠️ KEEP THE RAW SAMPLES ONLY ON THE NEWEST FEW. The verdict itself
  // (`mechanism` / `applied` / `changed`) is a handful of bytes and is what
  // shows a pattern across the ring; the before/after backlight dumps are
  // the bulky part and are only needed for forensics on what just happened.
  //
  // This is not tidiness. The server stores the whole inventory under a
  // 32 KB ceiling and drops SECTIONS from the back to fit — so an outcome
  // list that grew fat would silently evict `serial` / `vendorPackages` /
  // `control`, which is exactly the recipe-authoring evidence this wide
  // rollout exists to collect. Bounding here keeps both.
  const trimmed = next.map((entry, i) =>
    i < next.length - EVIDENCE_KEEP ? { ...entry, evidence: undefined } : entry,
  );
  try {
    window.localStorage.setItem(OUTCOMES_KEY, JSON.stringify(trimmed));
  } catch {
    /* private mode / quota — the in-memory copy still gets reported */
  }
  return trimmed;
}

/**
 * `transport` is part of the key because it is part of the capability picture:
 * the SAME box on the legacy every-frame bridge can only perform
 * recovery-direction actions, so a screen that flips channel↔legacy has
 * genuinely changed what it can do even though its verdict is byte-identical.
 * Including it also means a fleet that has already reported re-reports exactly
 * once when this field is introduced, instead of staying silent behind a stale
 * marker.
 */
/**
 * Server-side report schema revision, part of the marker for the same
 * fleet-re-reports-exactly-once reason as `transport` above. Bump when the
 * API starts persisting MORE of the probe document than before, so already-
 * reported screens send the newly-wanted data once instead of staying
 * silent behind a stale marker.
 *
 *   rev 2 (2026-08-24): the API now persists the full bounded inventory
 *   (vendor packages, settings keys, serial nodes, admin/device-owner
 *   state) to screen_device_inventory — the evidence vendor power recipes
 *   are authored from.
 */
const REPORT_SCHEMA_REV = '2';

function markerFor(
  screenId: string,
  appVersion: string,
  verdictSig: string,
  transport: string,
): string {
  return `${screenId}|${appVersion}|${verdictSig}|${transport}|r${REPORT_SCHEMA_REV}`;
}

/**
 * Tiny stable signature of the verdict object. Not cryptographic and does not
 * need to be — it only has to differ when the verdict differs, so a
 * permission grant (brightness "software-dim" → "settings", blank →
 * "device-admin") busts the dedup marker. djb2 over the JSON string; a hash
 * collision merely skips one re-report until the next APK bump, which is
 * exactly the pre-2026-08-17 behaviour.
 */
function verdictSignature(verdict: unknown): string {
  let s: string;
  try {
    s = JSON.stringify(verdict) ?? '';
  } catch {
    s = '';
  }
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
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
  /**
   * Per-command outcomes to ship with this report (see the ring above).
   *
   * ⚠️ PASSING THIS BYPASSES THE ONCE-PER-VERSION DEDUP, deliberately: an
   * outcome is a per-EVENT fact, not a per-version one, and the marker
   * exists to stop page-load-frequency writes, not operator-click-frequency
   * ones. Clicks are rare, human-paced, and the endpoint is throttled at
   * 30/min per screen — which is the actual bound on this path.
   */
  commandOutcomes?: DisplayCommandOutcome[];
}): Promise<string> {
  const { screenId, apiRoot, token, onIdentity, commandOutcomes } = opts;
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

  const transport = bridgeTransport();
  const marker = markerFor(
    screenId,
    await appVersionKey(),
    verdictSignature(parsed.verdict),
    transport,
  );
  const carryingOutcomes = !!commandOutcomes?.length;
  if (!carryingOutcomes && alreadyReported(marker)) {
    return 'skipped: already reported this version';
  }

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    // ⚠️ Stamp the transport we actually reached the APK over. The APK marks
    // every caller on the legacy every-frame surface as UNTRUSTED, and
    // untrusted callers get only recovery-direction actions — SET_VOLUME is
    // refused outright, SET_BRIGHTNESS only survives when raising. That
    // refusal returns as a JSON string rather than throwing, so the API
    // audits `delivered:true` and the dashboard paints success while the
    // panel does nothing. Without this field the only way to tell "refused at
    // the bridge" from "never arrived" was to walk to the screen and read its
    // log. Sent as a sibling of the probe payload; the endpoint's schema is
    // passthrough, so an older API simply ignores it.
    let body = raw;
    try {
      body = JSON.stringify({
        ...parsed,
        bridgeTransport: transport,
        ...(carryingOutcomes ? { commandOutcomes } : {}),
      });
    } catch {
      /* keep the verbatim probe string — reporting beats not reporting */
    }
    const res = await fetch(
      `${apiRoot}/api/v1/screens/${encodeURIComponent(screenId)}/display-capabilities`,
      { method: 'POST', headers, body },
    );
    if (!res.ok) return `failed: HTTP ${res.status}`;
    // Only remember on a confirmed 2xx, so a transient 5xx re-reports on the
    // next load instead of being silently skipped until the next APK.
    rememberReported(marker);
    return carryingOutcomes ? 'reported (with command outcomes)' : 'reported';
  } catch {
    return 'failed: network';
  }
}
