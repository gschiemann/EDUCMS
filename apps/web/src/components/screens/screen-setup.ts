/**
 * screen-setup.ts — reading a panel's SETUP telemetry (2026-08-25, v1.1.6).
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 *
 * v1.1.5 already ships a `setup` section inside the device-inventory probe
 * (`SetupCeremony.telemetryJson` → `POST /screens/:id/display-capabilities`
 * → `screen_device_inventory.report.setup`). Nothing read it. So the one
 * question a wide rollout has to answer — *did somebody walk away from that
 * panel half-provisioned, and where did it get stuck?* — was answerable
 * only by standing in front of the screen.
 *
 * The operator hit exactly that on the first install: the completion card
 * auto-dismissed over two untouched optional grants and there was no way,
 * from anywhere, to find out.
 *
 * ── THE FLEET-KNOWLEDGE HALF ──────────────────────────────────────────
 *
 * The genuinely valuable field is `launch`, which records what happened
 * when the panel tried to open a grant's system page:
 *
 *   'direct'   — the exact Settings page opened.
 *   'fallback' — THIS SKU HIDES THAT PAGE; a broader page opened instead.
 *   'failed'   — nothing opened at all.
 *
 * `fallback`/`failed` is the "one menu wasnt even visible i had to guess
 * where all admin permissions was" case, recorded per model. That is
 * knowledge about the NEXT fifty panels, not just this one.
 *
 * Pure functions, no React — same discipline as `renderTrust.ts` and
 * `display-capabilities.ts`, so the parsing of an untrusted device document
 * is unit-tested without mounting the 3k-line Screens page.
 */

/** One grant, as `SetupCeremony.telemetryJson` reports it. */
export interface SetupStep {
  key: string;
  name: string;
  /** Is this step meaningful on this box at all? */
  applies: boolean;
  /**
   * Is the grant held?
   *
   * ⚠️ ALWAYS FALSE for `managerInstallPromptShown` — no unprivileged API
   * can read another package's appop, so the APK cannot tell. Read it with
   * `offered`/`launch`, never alone. `describeStep` below encodes that.
   */
  held: boolean;
  /** Has the panel put this step's page in front of a human at least once? */
  offered: boolean;
  /** ADVANCED — listed and tappable on the panel, never armed, never counted. */
  optional: boolean;
  /** 'direct' | 'fallback' | 'failed', or null when never launched. */
  launch: string | null;
}

export interface SetupTelemetry {
  granted: number;
  required: number;
  complete: boolean;
  /** Wall-clock ms of the last "Not now" / Back on the panel, or null. */
  dismissedAtMs: number | null;
  steps: SetupStep[];
  /** Applicable ADVANCED grants that are not held. */
  optionalOutstanding: number;
  /** Applicable steps whose Settings page this SKU hides or refuses. */
  vendorLost: SetupStep[];
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;
const bool = (v: unknown): boolean => v === true;
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * Parse the `setup` section out of a device-inventory report.
 *
 * Returns null when the section is absent or unusable — an older APK, a
 * panel that has never reported, or a probe that threw. The caller MUST
 * render nothing in that case: "we do not know" is not "nothing is
 * outstanding", and a setup panel that claims a screen is fully
 * provisioned on no evidence is worse than no panel at all.
 */
export function parseSetupTelemetry(report: unknown): SetupTelemetry | null {
  if (!report || typeof report !== 'object') return null;
  const setup = (report as Record<string, unknown>).setup;
  if (!setup || typeof setup !== 'object' || Array.isArray(setup)) return null;
  const s = setup as Record<string, unknown>;
  // The APK reports `{ error: ... }` when the probe itself threw.
  if (!Array.isArray(s.steps)) return null;

  const steps: SetupStep[] = (s.steps as unknown[])
    .map((raw): SetupStep | null => {
      if (!raw || typeof raw !== 'object') return null;
      const r = raw as Record<string, unknown>;
      const key = str(r.key);
      if (!key) return null;
      return {
        key,
        name: str(r.name) ?? key,
        applies: bool(r.applies),
        held: bool(r.held),
        offered: bool(r.offered),
        optional: bool(r.optional),
        launch: str(r.launch),
      };
    })
    .filter((x): x is SetupStep => x !== null);

  if (steps.length === 0) return null;

  const applicable = steps.filter((x) => x.applies);
  return {
    granted: num(s.granted) ?? applicable.filter((x) => !x.optional && x.held).length,
    required: num(s.required) ?? applicable.filter((x) => !x.optional).length,
    complete: bool(s.complete),
    dismissedAtMs: num(s.dismissedAtMs),
    steps,
    optionalOutstanding: applicable.filter((x) => x.optional && !x.held).length,
    // 'fallback' = the direct page does not exist on this SKU; 'failed' =
    // nothing opened. Both are facts about the MODEL, which is why they are
    // worth surfacing on a rollout rather than only on this screen.
    vendorLost: applicable.filter(
      (x) => x.launch === 'fallback' || x.launch === 'failed',
    ),
  };
}

/**
 * One row's honest one-liner.
 *
 * The `managerInstallPromptShown` carve-out is the whole reason this is a
 * function and not a ternary at the call site: that row's `held` is a hard
 * false on every panel, so rendering it as "Needed" would tell an operator
 * to go fix something that may already be done.
 */
export function describeStep(step: SetupStep): {
  label: 'Granted' | 'Needed' | 'Unknown';
  tone: 'ok' | 'warn' | 'muted';
} {
  if (step.held) return { label: 'Granted', tone: 'ok' };
  if (step.key === 'managerInstallPromptShown') {
    // Android exposes no way to read another package's appop.
    return { label: 'Unknown', tone: 'muted' };
  }
  return { label: 'Needed', tone: step.optional ? 'muted' : 'warn' };
}

/**
 * Is this panel's APK new enough to receive an `OPEN_SETUP` push?
 *
 * `openSetupChecklist` landed in the v1.1.6 APK. Below that the frame is
 * signed, delivered and then dropped as `no-bridge` on the panel — a button
 * with a 100% failure rate, which is the one thing this codebase's display
 * panel is not allowed to render (CLAUDE.md §20 / the null-verdict rule in
 * ScreenDisplayControls).
 *
 * Unparseable or absent → false. A screen that has not told us its version
 * has not earned the button.
 */
export const SETUP_PUSH_MIN_VERSION = '1.1.6';

export function supportsSetupPush(playerVersion: unknown): boolean {
  const v = str(playerVersion);
  if (!v) return false;
  const parts = v.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return false;
  const [maj, min, pat] = parts;
  const code = maj * 10000 + min * 100 + pat;
  return code >= 10106;
}
