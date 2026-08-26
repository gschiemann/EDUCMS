/**
 * Reading a panel's SETUP telemetry (2026-08-25, v1.1.6).
 *
 * The document under test is written by an APK in the field and stored
 * verbatim-ish in `screen_device_inventory.report`, so every case here is a
 * shape the dashboard can genuinely receive: an older build with no `setup`
 * block at all, a probe that threw and reported `{error}`, and the real
 * six-step document from a half-provisioned Goodview.
 *
 * The load-bearing assertion is the FIRST one: absence must render nothing.
 * A setup panel that reports "complete" because it found no evidence is the
 * same class of lie as the completion card that auto-dismissed over two
 * untouched optional grants — which is the bug this whole wave exists for.
 */

import {
  parseSetupTelemetry,
  describeStep,
  supportsSetupPush,
  type SetupStep,
} from '../screen-setup';

const step = (over: Partial<SetupStep> & { key: string }): SetupStep => ({
  name: over.key,
  applies: true,
  held: false,
  offered: false,
  optional: false,
  launch: null,
  ...over,
});

/** The real v1.1.5 document from a panel that finished the core four. */
const REAL_REPORT = {
  setup: {
    granted: 4,
    required: 4,
    complete: true,
    dismissedAtMs: null,
    steps: [
      { key: 'installPromptShown', name: 'Install updates', applies: true, held: true, offered: true, optional: false, launch: 'direct' },
      { key: 'managerInstallPromptShown', name: 'Background updates', applies: true, held: false, offered: false, optional: true, launch: null },
      { key: 'writeSettingsPromptShown', name: 'Brightness control', applies: true, held: true, offered: true, optional: false, launch: 'fallback' },
      { key: 'batteryExemptPromptShown', name: 'Keep Venue OS running', applies: true, held: true, offered: true, optional: false, launch: 'direct' },
      { key: 'deviceAdminPromptShown', name: 'Turn the screen off (advanced)', applies: true, held: false, offered: false, optional: true, launch: null },
      { key: 'homeSetupPromptShown', name: 'Come back after updates', applies: true, held: true, offered: true, optional: false, launch: 'direct' },
    ],
  },
};

describe('parseSetupTelemetry', () => {
  it('returns null when there is no evidence at all', () => {
    // ⚠️ THE RULE THE WHOLE SECTION RESTS ON. An older APK, a screen that has
    // never probed, and a probe that threw must all render NOTHING — never a
    // clean bill of health computed from an empty object.
    expect(parseSetupTelemetry(null)).toBeNull();
    expect(parseSetupTelemetry(undefined)).toBeNull();
    expect(parseSetupTelemetry({})).toBeNull();
    expect(parseSetupTelemetry({ admin: {}, brightness: {} })).toBeNull();
    expect(parseSetupTelemetry({ setup: { error: 'probe threw' } })).toBeNull();
    expect(parseSetupTelemetry({ setup: { steps: [] } })).toBeNull();
    expect(parseSetupTelemetry('not an object')).toBeNull();
  });

  it('reads the real half-provisioned document', () => {
    const t = parseSetupTelemetry(REAL_REPORT)!;
    expect(t).not.toBeNull();
    expect(t.granted).toBe(4);
    expect(t.required).toBe(4);
    expect(t.complete).toBe(true);
    // THE OPERATOR'S COMPLAINT, as a number: "required" is finished and two
    // optional grants were never touched.
    expect(t.optionalOutstanding).toBe(2);
  });

  it('names the Settings pages THIS MODEL hides — the fleet-knowledge bit', () => {
    // `launch:'fallback'` is the "one menu wasnt even visible i had to guess
    // where all admin permissions was" case, recorded per SKU. It is the
    // reason to surface this at all rather than only counting grants.
    const t = parseSetupTelemetry(REAL_REPORT)!;
    expect(t.vendorLost.map((s) => s.key)).toEqual(['writeSettingsPromptShown']);
  });

  it('ignores steps that do not apply to this box', () => {
    const t = parseSetupTelemetry({
      setup: {
        steps: [
          { key: 'a', name: 'A', applies: true, held: true, optional: false },
          { key: 'b', name: 'B', applies: false, held: false, optional: true, launch: 'failed' },
        ],
      },
    })!;
    // b does not apply here, so it is neither outstanding nor vendor-lost.
    expect(t.optionalOutstanding).toBe(0);
    expect(t.vendorLost).toEqual([]);
    // …but it is still carried, so the UI can decide for itself.
    expect(t.steps).toHaveLength(2);
  });

  it('survives a malformed step without losing the good ones', () => {
    const t = parseSetupTelemetry({
      setup: { steps: [null, 42, { name: 'no key' }, { key: 'ok', applies: true, held: true }] },
    })!;
    expect(t.steps.map((s) => s.key)).toEqual(['ok']);
  });

  it('derives the counts when the APK omits them', () => {
    const t = parseSetupTelemetry({
      setup: {
        steps: [
          { key: 'a', applies: true, held: true, optional: false },
          { key: 'b', applies: true, held: false, optional: false },
          { key: 'c', applies: true, held: false, optional: true },
        ],
      },
    })!;
    expect(t.granted).toBe(1);
    expect(t.required).toBe(2);
    expect(t.optionalOutstanding).toBe(1);
  });
});

describe('describeStep', () => {
  it('never tells an operator to go re-grant something we cannot read', () => {
    // ⚠️ `managerInstallPromptShown.held` is a HARD false on every panel —
    // no unprivileged API can read another package's appop. Rendering it as
    // "Needed" would send somebody to a Settings page that may already be
    // switched on. "Unknown" is the only honest word.
    expect(describeStep(step({ key: 'managerInstallPromptShown', optional: true })))
      .toEqual({ label: 'Unknown', tone: 'muted' });
  });

  it('grades a held grant, a missing required one and a missing optional one', () => {
    expect(describeStep(step({ key: 'x', held: true }))).toEqual({ label: 'Granted', tone: 'ok' });
    expect(describeStep(step({ key: 'x' }))).toEqual({ label: 'Needed', tone: 'warn' });
    expect(describeStep(step({ key: 'x', optional: true })))
      .toEqual({ label: 'Needed', tone: 'muted' });
  });
});

describe('supportsSetupPush', () => {
  it('gates the button on an APK that actually carries the bridge method', () => {
    // `openSetupChecklist` shipped in v1.1.6. Below it the frame is signed,
    // delivered and then dropped as `no-bridge` on the panel — a button with
    // a 100% failure rate, which this page is not allowed to render.
    expect(supportsSetupPush('1.1.6')).toBe(true);
    expect(supportsSetupPush('1.1.7')).toBe(true);
    expect(supportsSetupPush('1.2.0')).toBe(true);
    expect(supportsSetupPush('2.0.0')).toBe(true);
    expect(supportsSetupPush('1.1.5')).toBe(false);
    expect(supportsSetupPush('1.0.63')).toBe(false);
  });

  it('refuses anything it cannot parse — an unreported version earns nothing', () => {
    expect(supportsSetupPush(null)).toBe(false);
    expect(supportsSetupPush(undefined)).toBe(false);
    expect(supportsSetupPush('')).toBe(false);
    expect(supportsSetupPush('1.1')).toBe(false);
    expect(supportsSetupPush('v1.1.6')).toBe(false);
    expect(supportsSetupPush(116)).toBe(false);
  });
});
