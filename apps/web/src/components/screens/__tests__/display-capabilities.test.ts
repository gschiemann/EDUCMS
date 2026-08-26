/**
 * Capability-truth tests for the display-control resolver.
 *
 * These exist because the whole feature's acceptance criterion is a
 * NEGATIVE one: "never render a control the hardware cannot perform."
 * That's exactly the kind of rule that rots silently — a UI regression
 * shows a working-looking slider and nobody notices until an operator on
 * a ladder does. Pinning the resolver means the honesty logic can't drift
 * even if the panel's markup is rewritten.
 */

import {
  MIN_SAFE_BRIGHTNESS_PERCENT,
  DISPLAY_RECOVERY_MIN_BRIGHTNESS_PERCENT,
  displayActionSupport,
  readStoredDisplayVerdict,
  type DisplayActionType,
} from '@cms/api-types';
import {
  resolveDisplayControls,
  parseDisplayCapabilities,
  derivePanelPowerState,
  panelPowerOffer,
  clampBrightness,
  clampVolume,
  serializeDays,
  parseDays,
  formatDays,
  isEveryDay,
  crossesMidnight,
  summarizeScheduleOffPaths,
  scheduleWindowsOverlap,
  MIN_SAFE_BRIGHTNESS,
  RECOVERY_MIN_BRIGHTNESS,
  ALL_DAY_INDEXES,
  WEEKDAY_INDEXES,
  DISPLAY_SCHEDULE_DAYS,
} from '../display-capabilities';

const FULL_VERDICT = {
  volume: 'audiomanager',
  brightness: 'sysfs',
  screenBlank: 'device-owner',
  reboot: 'device-owner',
  hardPowerOff: 'none',
  deviceOwnerPath: 'held',
};

/**
 * What the probe ACTUALLY emits on a modern APK: DisplayControlRegistry
 * provider ids, read out of the Kotlin (`override val id`) rather than
 * guessed. Contract C5 — the device's vocabulary is authoritative.
 */
const REGISTRY_VERDICT = {
  volume: 'audiomanager',
  brightness: 'sysfs-backlight',
  screenBlank: 'screen-timeout',
  reboot: 'none',
  hardPowerOff: 'none',
  deviceOwnerPath: 'provisionable-after-factory-reset',
};

/**
 * The shape `Screen.displayCapabilities` ACTUALLY holds: the probe document
 * with the verdict under a `verdict` key, exactly what
 * `normalizeCapabilityReport` writes. Every fixture below goes through this,
 * because as of the 2026-08-14 sweep the dashboard reads that column with
 * the SERVER's own reader — a bare verdict object is no longer accepted, so
 * a test that passed one would be testing a shape no row can have.
 */
const stored = (verdict: Record<string, unknown>) => ({
  schema: 1,
  probedAt: 1_760_000_000_000,
  reportedAt: 1_760_000_001_000,
  build: { manufacturer: 'Goodview', model: 'M43GUQ' },
  verdict,
});

describe('parseDisplayCapabilities', () => {
  it('returns null for anything that is not a verdict object', () => {
    expect(parseDisplayCapabilities(null)).toBeNull();
    expect(parseDisplayCapabilities(undefined)).toBeNull();
    expect(parseDisplayCapabilities('sysfs')).toBeNull();
    expect(parseDisplayCapabilities([])).toBeNull();
    expect(parseDisplayCapabilities({})).toBeNull();
  });

  /**
   * CHANGED 2026-08-14 (was: "accepts a bare verdict and a { verdict }
   * envelope alike"). The old assertion pinned the WRONG contract: the
   * dashboard accepted a bare verdict object that the API's own
   * `verdictFromStored` rejects, so a hand-seeded/migrated row rendered an
   * ENABLED Blank button that the API refuses with
   * DISPLAY_CAPABILITIES_UNKNOWN. `normalizeCapabilityReport` — the only
   * writer of this column — always emits the envelope, so nothing real
   * regresses; the permissive half only ever produced 409s.
   */
  it('reads the stored envelope, and REFUSES a bare verdict (server parity)', () => {
    expect(parseDisplayCapabilities(stored(FULL_VERDICT))?.brightness).toBe('sysfs');
    expect(parseDisplayCapabilities(FULL_VERDICT)).toBeNull();
  });

  /**
   * CHANGED 2026-08-14. Same reason: a document missing screenBlank (or any
   * other core axis) is NOT a partial verdict to the API — it is no verdict
   * at all. The narrowing behaviour it was written to pin is asserted below
   * on a complete document.
   */
  it('needs all four core axes before it counts as reported at all', () => {
    expect(
      parseDisplayCapabilities(stored({ volume: 'audiomanager', brightness: 'sysfs' })),
    ).toBeNull();
  });

  it('drops values outside the known enum instead of trusting them', () => {
    const v = parseDisplayCapabilities(
      stored({
        volume: 'audiomanager',
        brightness: 'root-shell',
        screenBlank: 'software-dim',
        reboot: 'su',
      }),
    );
    expect(v?.volume).toBe('audiomanager');
    expect(v?.brightness).toBeUndefined();
    expect(v?.reboot).toBeUndefined();
  });
});

describe('resolveDisplayControls — tri-state', () => {
  it('treats "never reported" as unknown, NOT as unsupported', () => {
    const r = resolveDisplayControls(null);
    expect(r.reported).toBe(false);
    // Volume and reboot have no recovery direction — the API refuses both
    // on a null verdict, so neither may be offered or declared unsupported.
    expect(r.volume.available).toBe(false);
    expect(r.volume.noteKey).toBeNull();
    expect(r.reboot.available).toBe(false);
    expect(r.reboot.noteKey).toBeNull();
  });

  // ⚠️ REVERSED 2026-08-25 (the blank/power split). From 2026-08-13 this
  // asserted the opposite — that BLANK is WITHHELD before a verdict — and
  // that was right while BLANK could reach a device-admin lock. It cannot
  // any more: it is a black overlay drawn by the player's own page, so it is
  // exactly as safe on an unprobed screen as on a probed one, the API
  // accepts it on a null verdict, and withholding it re-creates the
  // dead-control problem on a fleet where every screen is unreported.
  // POWER_OFF inherited the fail-closed seat.
  it('offers BLANK and WAKE before a verdict — both are soft now', () => {
    const r = resolveDisplayControls(null);
    expect(r.blank.available).toBe(true);
    expect(r.blank.softwareOnly).toBe(true);
    expect(r.wake.available).toBe(true);
    // Panel POWER is what stays closed until the hardware is observed.
    expect(r.power.off.available).toBe(false);
    expect(r.power.on.available).toBe(false);
    expect(r.power.mechanism).toBeNull();
  });

  // The other half of C4's recovery direction: a RAISE is accepted on an
  // unreported screen, so the slider renders — with its floor lifted to the
  // exact value the API will take, so no position on the track can 409.
  it('offers a raise-only brightness slider before a verdict', () => {
    const r = resolveDisplayControls(null);
    expect(r.brightness.available).toBe(true);
    expect(r.brightness.recoveryOnly).toBe(true);
    expect(r.brightness.floor).toBe(RECOVERY_MIN_BRIGHTNESS);
    expect(r.brightness.kind).toBeNull();
    expect(r.brightness.noteKey).toBe('screens.display.note.brightnessRecoveryOnly');
  });

  /**
   * REWRITTEN 2026-08-14 — the old version asserted `reported === true` for
   * `{ volume: 'audiomanager' }`, i.e. the panel showing an enabled Blank
   * button on a document the API reads as no-verdict-at-all. That was the
   * exact 100%-failure control this wave exists to kill, pinned by a test.
   * A core axis missing now means the recovery-only layout, which is what
   * the API enforces anyway.
   */
  it('an INCOMPLETE verdict is not reported — recovery layout, not a dead Power', () => {
    const r = resolveDisplayControls(stored({ volume: 'audiomanager' }));
    expect(r.reported).toBe(false);
    expect(r.volume.available).toBe(false);
    // Panel power is the axis that must not light up on a half-document —
    // it is what the API refuses here (was BLANK before the 08-25 split).
    expect(r.power.off.available).toBe(false);
    expect(r.blank.available).toBe(true);
    expect(r.wake.available).toBe(true);
    expect(r.brightness.available).toBe(true);
    expect(r.brightness.recoveryOnly).toBe(true);
    expect(r.brightness.floor).toBe(RECOVERY_MIN_BRIGHTNESS);
  });

  it('a COMPLETE verdict with an unrecognised axis leaves that axis unknown', () => {
    const r = resolveDisplayControls(
      stored({ ...FULL_VERDICT, brightness: 'root-shell' }),
    );
    expect(r.reported).toBe(true);
    expect(r.volume.available).toBe(true);
    expect(r.brightness.available).toBe(false);
    expect(r.brightness.noteKey).toBeNull();
    // Once reported, brightness is back on the universal safety floor.
    expect(r.brightness.floor).toBe(MIN_SAFE_BRIGHTNESS);
    expect(r.brightness.recoveryOnly).toBe(false);
  });
});

// CONTRACT C5 — the device's DisplayControlRegistry provider ids are the
// authoritative vocabulary. Wave 2 changed the probe to emit them and left
// the dashboard resolver on the older heuristic words, so a screen running a
// current APK resolved to "not reported" on every axis and got the
// recovery-only layout forever. These pin the real ids, copied from
// `override val id` in apps/player/.../display/*Provider.kt.
describe('resolveDisplayControls — registry provider ids (contract C5)', () => {
  it('accepts every id DisplayControlRegistry can resolve', () => {
    const r = resolveDisplayControls(stored(REGISTRY_VERDICT));
    expect(r.reported).toBe(true);
    expect(r.volume.available).toBe(true);
    expect(r.brightness.kind).toBe('sysfs-backlight');
    expect(r.brightness.noteKey).toBe('screens.display.note.brightnessSysfs');
    expect(r.blank.available).toBe(true);
    // `screenBlank` no longer describes BLANK — it is the HARD power
    // mechanism now, and screen-timeout cannot reach panel power.
    expect(r.power.mechanism).toBe('screen-timeout');
    expect(r.power.off.available).toBe(false);
  });

  it('maps the vendor-recipe ids to their own copy', () => {
    const b = resolveDisplayControls(stored({ ...REGISTRY_VERDICT, brightness: 'vendor-recipe' }));
    expect(b.brightness.kind).toBe('vendor-recipe');
    expect(b.brightness.softwareOnly).toBe(false);
    expect(b.brightness.noteKey).toBe('screens.display.note.brightnessVendorRecipe');

    // vendor-recipe is the ONE proven power mechanism — the TC22 class,
    // whose backlight node is written and un-written by the same recipe.
    const k = resolveDisplayControls(stored({ ...REGISTRY_VERDICT, screenBlank: 'vendor-recipe' }));
    expect(k.power.off.available).toBe(true);
    expect(k.power.off.noteText).toMatch(/switches the panel/i);
  });

  it('treats software-dim as the floor on BOTH axes, honestly labelled', () => {
    const r = resolveDisplayControls(
      stored({
        ...REGISTRY_VERDICT,
        brightness: 'software-dim',
        screenBlank: 'software-dim',
      }),
    );
    expect(r.brightness.softwareOnly).toBe(true);
    expect(r.blank.softwareOnly).toBe(true);
    expect(r.power.off.available).toBe(false);
    expect(r.power.off.noteText).toMatch(/no remote power control/i);
  });

  it('still rejects a value that is not a real provider id', () => {
    const r = resolveDisplayControls(stored({ ...REGISTRY_VERDICT, brightness: 'sysfs-backlight-v2' }));
    expect(r.brightness.available).toBe(false);
    expect(r.brightness.kind).toBeNull();
  });
});

/**
 * THE ANTI-DRIFT TEST. The reviewer's finding was not merely "Blank is
 * enabled too early" — it was that the dashboard and the API derive the same
 * gate independently, from two copies of the rules. This asserts the only
 * invariant that actually matters operationally, in ONE direction:
 *
 *   the panel never offers a control the server would refuse.
 *
 * (The reverse is allowed: tri-state discipline keeps the UI stricter than
 * the API on an axis the probe simply did not mention.)
 */
describe('UI gate ⊆ server gate (displayActionSupport)', () => {
  /**
   * Stored DOCUMENTS, not bare verdicts — both ends below are handed the
   * byte-identical value, which is the only way this suite proves anything.
   */
  const VERDICTS: unknown[] = [
    null,
    {},
    stored({}),
    stored(FULL_VERDICT),
    stored(REGISTRY_VERDICT),
    stored({ ...REGISTRY_VERDICT, volume: 'none' }),
    stored({ ...REGISTRY_VERDICT, screenBlank: 'software-dim' }),
    stored({ ...FULL_VERDICT, reboot: 'none', deviceOwnerPath: 'blocked-other-owner' }),
    // The document that used to slip through: one axis only. The dashboard
    // called it reported and lit Blank; the API calls it no verdict at all.
    stored({ volume: 'audiomanager' }),
    // Complete, but with junk on one axis — reported, axis unknown.
    stored({ ...FULL_VERDICT, brightness: 'root-shell' }),
    // A BARE verdict: the shape the dashboard used to accept and the API
    // never has. Both must now read it as "nothing reported".
    FULL_VERDICT,
  ];

  /**
   * THE SERVER'S OWN PATH — not a re-implementation, and not the dashboard's
   * parser wearing a server costume.
   *
   * THE BUG THIS FIXES (2026-08-14 sweep, P2). This helper used to call
   * `parseDisplayCapabilities` — the DASHBOARD's parser — and feed the result
   * into the server's gate. Both sides of every assertion therefore came from
   * the same parser, so the one place the two ends actually disagreed passed
   * silently: with fixture `{ volume: 'audiomanager' }` the real API
   * (`verdictFromStored` → null → `displayActionSupport('BLANK', null)`)
   * REFUSES Blank while the dashboard rendered it enabled. A test that cannot
   * fail on the defect it is named after is worse than no test.
   *
   * `readStoredDisplayVerdict` is literally what `verdictFromStored` in
   * apps/api/src/display/display.service.ts now is (that export is an alias),
   * so this crosses the real boundary.
   */
  const serverSays = (
    action: DisplayActionType,
    raw: unknown,
    percent?: number,
  ): boolean =>
    displayActionSupport(action, readStoredDisplayVerdict(raw), { percent })
      .supported;

  it.each(VERDICTS.map((v, i) => [i, v] as const))(
    'verdict #%i offers nothing the API refuses',
    (_i, raw) => {
      const ui = resolveDisplayControls(raw);
      if (ui.volume.available) expect(serverSays('SET_VOLUME', raw)).toBe(true);
      if (ui.blank.available) expect(serverSays('BLANK', raw)).toBe(true);
      if (ui.wake.available) expect(serverSays('WAKE', raw)).toBe(true);
      if (ui.reboot.available) expect(serverSays('REBOOT', raw)).toBe(true);
      // The 2026-08-25 pair. POWER_OFF is where fail-closed lives now, so it
      // is the one that most needs this invariant: a "Turn panel off" button
      // the API answers with DISPLAY_BLANK_MECHANISM_UNPROVEN is not a
      // cosmetic bug on the hardware that latched.
      if (ui.power.off.available) expect(serverSays('POWER_OFF', raw)).toBe(true);
      if (ui.power.on.available) expect(serverSays('POWER_ON', raw)).toBe(true);
      if (ui.brightness.available) {
        // Every position the slider can express, at both ends of its travel.
        expect(serverSays('SET_BRIGHTNESS', raw, ui.brightness.floor)).toBe(true);
        expect(serverSays('SET_BRIGHTNESS', raw, 100)).toBe(true);
      }
    },
  );

  it('uses the SAME recovery floor the server gate enforces', () => {
    expect(RECOVERY_MIN_BRIGHTNESS).toBe(DISPLAY_RECOVERY_MIN_BRIGHTNESS_PERCENT);
    // One below the floor is refused by the server — which is exactly why
    // the unreported slider's `min` is the floor and not MIN_SAFE_BRIGHTNESS.
    expect(serverSays('SET_BRIGHTNESS', null, RECOVERY_MIN_BRIGHTNESS - 1)).toBe(false);
  });
});

describe('resolveDisplayControls — no-software-floor axes', () => {
  it('volume:none renders no control, but does explain itself', () => {
    const r = resolveDisplayControls(stored({ ...FULL_VERDICT, volume: 'none' }));
    expect(r.volume.available).toBe(false);
    expect(r.volume.noteKey).toBe('screens.display.note.volumeNone');
  });

  it('reboot:none renders no button, and names the blocker', () => {
    const blocked = resolveDisplayControls(
      stored({
        ...FULL_VERDICT,
        reboot: 'none',
        deviceOwnerPath: 'blocked-other-owner',
      }),
    );
    expect(blocked.reboot.available).toBe(false);
    expect(blocked.reboot.noteKey).toBe('screens.display.note.rebootBlockedOtherOwner');

    const provisionable = resolveDisplayControls(
      stored({
        ...FULL_VERDICT,
        reboot: 'none',
        deviceOwnerPath: 'provisionable-after-factory-reset',
      }),
    );
    expect(provisionable.reboot.noteKey).toBe('screens.display.note.rebootNeedsProvisioning');

    // deviceOwnerPath omitted entirely → `readStoredDisplayVerdict` fills the
    // least-capable default ('provisionable-after-factory-reset'), which is
    // what the API's own gate sees, so the copy names the factory-reset path
    // rather than the generic line. (The generic line stays reachable for a
    // row whose deviceOwnerPath is present but unrecognised — asserted below.)
    expect(
      resolveDisplayControls(
        stored({ ...FULL_VERDICT, reboot: 'none', deviceOwnerPath: undefined }),
      ).reboot.noteKey,
    ).toBe('screens.display.note.rebootNeedsProvisioning');

    expect(
      resolveDisplayControls(
        stored({ ...FULL_VERDICT, reboot: 'none', deviceOwnerPath: 'root-shell' }),
      ).reboot.noteKey,
    ).toBe('screens.display.note.rebootUnavailable');
  });
});

describe('resolveDisplayControls — software-floor axes stay actionable but honest', () => {
  it('brightness:software-dim is available AND flagged software-only', () => {
    const r = resolveDisplayControls(stored({ ...FULL_VERDICT, brightness: 'software-dim' }));
    expect(r.brightness.available).toBe(true);
    expect(r.brightness.softwareOnly).toBe(true);
    expect(r.brightness.kind).toBe('software-dim');
    expect(r.brightness.noteKey).toBe('screens.display.note.brightnessSoftware');
  });

  it('brightness:sysfs is real backlight control, not flagged', () => {
    const r = resolveDisplayControls(stored(FULL_VERDICT));
    expect(r.brightness.softwareOnly).toBe(false);
    expect(r.brightness.noteKey).toBe('screens.display.note.brightnessSysfs');
  });

  it('screenBlank:none still blanks (soft overlay) and still wakes', () => {
    const r = resolveDisplayControls(stored({ ...FULL_VERDICT, screenBlank: 'none' }));
    expect(r.blank.available).toBe(true);
    expect(r.blank.softwareOnly).toBe(true);
    expect(r.wake.available).toBe(true);
    // …and there is no panel power to offer on a box with no mechanism.
    expect(r.power.off.available).toBe(false);
  });

  // ═══════════════════════════════════════════════════════════════════
  // THE BLANK/POWER SPLIT (live field incident, 2026-08-25)
  //
  // ⚠️ THIS REPLACES 'device-admin blanking is hedged, device-owner is
  // absolute'. That test described BLANK's copy per hard mechanism, which
  // is no longer a thing BLANK has — blank is soft and identical on every
  // model. The hard mechanisms now describe POWER, and the copy stopped
  // hedging and started REFUSING, because hedged copy is what shipped the
  // night two panels latched.
  //
  // Evidence: a device-admin BLANK latched a Goodview G43 and a Mobile
  // A-Frame into a vendor standby (glass dark, IR remote and power button
  // dead, WAKE useless, mains-pull required) — and the A-Frame then woke
  // itself back up minutes later, unprompted. An L55VEC with a
  // byte-identical verdict recovered normally. Vendor firmware owns that
  // state, in both directions, unpredictably.
  // ═══════════════════════════════════════════════════════════════════
  it('BLANK is soft and identical on every hard mechanism', () => {
    for (const screenBlank of [
      'device-admin',
      'device-owner',
      'vendor-recipe',
      'screen-timeout',
      'software-dim',
      'none',
    ]) {
      const r = resolveDisplayControls(stored({ ...FULL_VERDICT, screenBlank }));
      expect(r.blank.available).toBe(true);
      expect(r.blank.softwareOnly).toBe(true);
      expect(r.wake.available).toBe(true);
    }
  });

  it('POWER_OFF renders ONLY on the proven mechanism', () => {
    expect(
      resolveDisplayControls(stored({ ...FULL_VERDICT, screenBlank: 'vendor-recipe' })).power.off
        .available,
    ).toBe(true);
    for (const screenBlank of [
      'device-admin',
      'device-owner',
      'screen-timeout',
      'software-dim',
      'none',
    ]) {
      expect(
        resolveDisplayControls(stored({ ...FULL_VERDICT, screenBlank })).power.off.available,
      ).toBe(false);
    }
  });

  it('the admin-lock refusal tells the operator what to DO, not what went wrong', () => {
    // ⚠️ REVERSED 2026-08-25 (second pass). This test used to REQUIRE the
    // incident narrative in the visible copy — "both directions", "woke
    // itself back up", "supervised on-site" — and that is exactly what the
    // operator saw in his gear popover and called out: a date, an internal
    // incident story, and jargon, where a single actionable sentence
    // belonged. Design-doc prose is not product copy. The engineering detail
    // now lives in a code comment on `powerOffNote`, where the next
    // maintainer needs it and the operator does not.
    const admin = resolveDisplayControls(stored({ ...FULL_VERDICT, screenBlank: 'device-admin' }));
    expect(admin.power.off.available).toBe(false);
    // Says what to do instead…
    expect(admin.power.off.noteText).toMatch(/blank/i);
    // …and stays short enough to read at a glance in a popover.
    expect(admin.power.off.noteText!.length).toBeLessThan(120);
  });

  it('POWER_ON is offered on EVERY reported verdict — even where OFF is refused', () => {
    // The recovery asymmetry. On the incident panels this is the only
    // hardware control left, and a dark panel must always have a path back.
    for (const screenBlank of [
      'device-admin',
      'device-owner',
      'vendor-recipe',
      'screen-timeout',
      'software-dim',
      'none',
    ]) {
      const r = resolveDisplayControls(stored({ ...FULL_VERDICT, screenBlank }));
      expect(r.power.on.available).toBe(true);
    }
  });
});

describe('safety clamps', () => {
  it('never lets a remote brightness go below the safe floor', () => {
    expect(clampBrightness(0)).toBe(MIN_SAFE_BRIGHTNESS);
    expect(clampBrightness(-40)).toBe(MIN_SAFE_BRIGHTNESS);
    expect(clampBrightness(Number.NaN)).toBe(MIN_SAFE_BRIGHTNESS);
    expect(clampBrightness(4.4)).toBe(MIN_SAFE_BRIGHTNESS);
    expect(clampBrightness(60)).toBe(60);
    expect(clampBrightness(1000)).toBe(100);
  });

  it('clamps to the RECOVERY floor when the caller passes it (unreported screen)', () => {
    expect(clampBrightness(10, RECOVERY_MIN_BRIGHTNESS)).toBe(RECOVERY_MIN_BRIGHTNESS);
    expect(clampBrightness(Number.NaN, RECOVERY_MIN_BRIGHTNESS)).toBe(RECOVERY_MIN_BRIGHTNESS);
    expect(clampBrightness(80, RECOVERY_MIN_BRIGHTNESS)).toBe(80);
    // A bogus floor can never lower the universal safety floor or exceed 100.
    expect(clampBrightness(50, 0)).toBe(50);
    expect(clampBrightness(1, 0)).toBe(MIN_SAFE_BRIGHTNESS);
    expect(clampBrightness(1, 500)).toBe(100);
  });

  it('clamps volume to 0..100 (silence is recoverable, darkness is not)', () => {
    expect(clampVolume(-5)).toBe(0);
    expect(clampVolume(0)).toBe(0);
    expect(clampVolume(250)).toBe(100);
  });

  it('uses the SHARED floor, so the API and the dashboard cannot drift', () => {
    expect(MIN_SAFE_BRIGHTNESS).toBe(MIN_SAFE_BRIGHTNESS_PERCENT);
  });
});

// CONTRACT C2 — daysOfWeek is Int[], 0=Sun..6=Sat, matching schema.prisma's
// existing Schedule / PlaylistItem convention. These tests REPLACE the old
// comma-joined-label round-trip, which produced a payload the API's
// `z.array(z.number().int().min(0).max(6)).min(1)` rejected on every single
// save — and whose "0 or 7 selected → null (= every day)" collapse silently
// INVERTED the operator's intent when they switched every day off.
describe('schedule day encoding (contract C2 — Int[], 0=Sun..6=Sat)', () => {
  it('maps the chip labels to the DB/Prisma day indexes', () => {
    expect(DISPLAY_SCHEDULE_DAYS.map((d) => [d.label, d.index])).toEqual([
      ['Mon', 1],
      ['Tue', 2],
      ['Wed', 3],
      ['Thu', 4],
      ['Fri', 5],
      ['Sat', 6],
      ['Sun', 0],
    ]);
    expect([...WEEKDAY_INDEXES]).toEqual([1, 2, 3, 4, 5]);
    expect([...ALL_DAY_INDEXES]).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('serializes to a deduped, canonically sorted number[] — never null', () => {
    expect(serializeDays([5, 1, 3])).toEqual([1, 3, 5]);
    expect(serializeDays([2, 2, 2])).toEqual([2]);
    expect(serializeDays([...ALL_DAY_INDEXES])).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('NEVER collapses an empty selection to "every day" — it stays empty', () => {
    // The old behaviour turned "never auto-power-off" into "blank every
    // night". Empty is now simply invalid, which is also what the API says.
    expect(serializeDays([])).toEqual([]);
    expect(isEveryDay([])).toBe(false);
    expect(isEveryDay([...ALL_DAY_INDEXES])).toBe(true);
  });

  it('parses the API shape (number[]) and drops out-of-range junk', () => {
    expect(parseDays([1, 2, 3, 4, 5])).toEqual([1, 2, 3, 4, 5]);
    expect(parseDays([6, 0, 6])).toEqual([0, 6]);
    expect(parseDays([9, -1, 2.5, 'Mon' as unknown as number, 4])).toEqual([4]);
  });

  it('degrades gracefully on a legacy comma-joined row instead of throwing', () => {
    // A row written by the pre-fix build, or a hand-seeded fixture. The old
    // code called String.replace on a number[] and threw a TypeError DURING
    // RENDER, unmounting the modal; this direction must be equally total.
    expect(parseDays('Mon,Wed,Fri')).toEqual([1, 3, 5]);
    expect(parseDays('1,3,5')).toEqual([1, 3, 5]);
    expect(parseDays(null)).toEqual([]);
    expect(parseDays(undefined)).toEqual([]);
    expect(parseDays({} as unknown)).toEqual([]);
  });

  it('formats a summary in the operator-readable Mon→Sun order', () => {
    expect(formatDays([5, 1, 3])).toBe('Mon Wed Fri');
    expect(formatDays([0, 6])).toBe('Sat Sun');
    expect(formatDays([])).toBe('');
  });
});

describe('crossesMidnight', () => {
  it('is false for a normal daytime window', () => {
    expect(crossesMidnight('07:00', '22:00')).toBe(false);
  });
  it('is true when the off time is at or before the on time', () => {
    expect(crossesMidnight('18:00', '02:00')).toBe(true);
    expect(crossesMidnight('08:00', '08:00')).toBe(true);
  });
  it('is false for malformed input rather than throwing', () => {
    expect(crossesMidnight('', '22:00')).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// PANEL POWER STATE — offer the verb that matches the glass
//
// Operator, looking at a screen that was ONLINE and actively painting and
// being offered exactly one button, "Turn panel on": *"thats not correct
// really, the screen is already on...it should know that and say power
// off....or sleep, or whatever its doing."*
//
// Capability answers "what can this hardware do". State answers "what is it
// doing right now". Rendering both power verbs at once meant one of them was
// always contradicting the screen in front of the operator — which teaches
// them to distrust the whole panel.
// ═════════════════════════════════════════════════════════════════════════
describe('derivePanelPowerState — render proof decides, never a guess', () => {
  it('a painting screen is ON', () => {
    expect(derivePanelPowerState('painting')).toBe('on');
  });

  it.each(['not-painting', 'checking', 'stale-chronic'] as const)(
    'a reachable screen with no fresh paint (%s) is DARK',
    (grade) => {
      expect(derivePanelPowerState(grade)).toBe('dark');
    },
  );

  it('offline or never-proved is UNKNOWN — we do not guess at panel state', () => {
    expect(derivePanelPowerState('offline')).toBe('unknown');
    expect(derivePanelPowerState('unknown')).toBe('unknown');
  });
});

describe('panelPowerOffer — one verb, and only when it is true', () => {
  const proven = resolveDisplayControls(
    stored({ ...FULL_VERDICT, screenBlank: 'vendor-recipe' }),
  ).power;
  const unproven = resolveDisplayControls(
    stored({ ...FULL_VERDICT, screenBlank: 'device-admin' }),
  ).power;
  const unreported = resolveDisplayControls(null).power;

  it('PAINTING + proven power → offers OFF only', () => {
    // THE OPERATOR'S COMPLAINT, pinned. A screen that is visibly painting
    // must never be offered "Turn panel on".
    const o = panelPowerOffer(proven, 'on');
    expect(o.showOff).toBe(true);
    expect(o.showOn).toBe(false);
  });

  it('PAINTING + unproven power → offers NOTHING, and says what to use', () => {
    const o = panelPowerOffer(unproven, 'on');
    expect(o.showOff).toBe(false);
    expect(o.showOn).toBe(false);
    expect(o.note).toMatch(/blank/i);
  });

  it('DARK → offers ON only, on proven AND unproven hardware alike', () => {
    // Recovery is never gated (C4). On the admin-lock panels POWER_ON is the
    // only hardware control left — the soft Wake button never reaches the
    // bridge, so a panel darkened by its own nightly schedule would have no
    // way back from this dashboard at all.
    for (const power of [proven, unproven]) {
      const o = panelPowerOffer(power, 'dark');
      expect(o.showOff).toBe(false);
      expect(o.showOn).toBe(true);
    }
  });

  it('UNKNOWN state → no buttons, one honest line', () => {
    const o = panelPowerOffer(proven, 'unknown');
    expect(o.showOff).toBe(false);
    expect(o.showOn).toBe(false);
    expect(o.note).toMatch(/can’t tell|cannot tell/i);
  });

  it('an unreported screen has no power buttons in ANY state', () => {
    for (const state of ['on', 'dark', 'unknown'] as const) {
      const o = panelPowerOffer(unreported, state);
      expect(o.showOff).toBe(false);
      expect(o.showOn).toBe(false);
      expect(o.note.length).toBeGreaterThan(0);
    }
  });

  it('always returns a note — a silent row is a row that explains nothing', () => {
    for (const power of [proven, unproven, unreported]) {
      for (const state of ['on', 'dark', 'unknown'] as const) {
        expect(panelPowerOffer(power, state).note.length).toBeGreaterThan(0);
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
// COPY HYGIENE — engineering prose must never reach the glass
//
// The `powerOffNote` copy shipped with a date, a two-panel incident
// narrative and the phrase "supervised on-site off/on test" in it, and the
// operator read all of that in a popover. Design-doc prose is not product
// copy. This pins the rule so it cannot leak back in.
// ═════════════════════════════════════════════════════════════════════════
describe('operator-facing copy stays operator-facing', () => {
  /** Every literal string this resolver can put in front of an operator. */
  const visibleCopy = (): string[] => {
    const out: string[] = [];
    const verdicts: unknown[] = [
      null,
      stored({ ...FULL_VERDICT, screenBlank: 'vendor-recipe' }),
      stored({ ...FULL_VERDICT, screenBlank: 'device-admin' }),
      stored({ ...FULL_VERDICT, screenBlank: 'device-owner' }),
      stored({ ...FULL_VERDICT, screenBlank: 'screen-timeout' }),
      stored({ ...FULL_VERDICT, screenBlank: 'software-dim' }),
      stored({ ...FULL_VERDICT, screenBlank: 'none' }),
    ];
    for (const raw of verdicts) {
      const r = resolveDisplayControls(raw);
      for (const axis of [r.volume, r.brightness, r.blank, r.wake, r.reboot, r.power.off, r.power.on]) {
        if (axis.noteText) out.push(axis.noteText);
      }
      for (const state of ['on', 'dark', 'unknown'] as const) {
        out.push(panelPowerOffer(r.power, state).note);
      }
    }
    return out.filter(Boolean);
  };

  it('contains no dates — an incident timestamp is not operator copy', () => {
    // Catches 2026-08-25, 08/25/2026, "August 25", "Aug 25".
    const DATE_LIKE =
      /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i;
    const offenders = visibleCopy().filter((s) => DATE_LIKE.test(s));
    expect(offenders).toEqual([]);
  });

  it('tells no incident stories', () => {
    // The specific prose the operator was shown, plus its neighbours. If a
    // future note needs one of these words it almost certainly belongs in a
    // code comment instead.
    const STORY =
      /woke itself|mains|power(?:-| )pull|pulled the power|supervised|vendor standby|IR remote|device-admin|latched/i;
    const offenders = visibleCopy().filter((s) => STORY.test(s));
    expect(offenders).toEqual([]);
  });

  it('stays short enough to read at a glance in a popover', () => {
    const tooLong = visibleCopy().filter((s) => s.length > 200);
    expect(tooLong).toEqual([]);
  });

  // The schedule editor's warning is CATALOG copy, not resolver output, so
  // the three rules above have to be applied to it separately — in every
  // locale, since a Spanish operator is owed the same discipline.
  describe('the schedule editor’s soft-off note obeys the same three rules', () => {
    const KEYS = ['scheduleSoftOffAll', 'scheduleSoftOffSome'] as const;
    const catalogs = {
      en: require('@/i18n/messages/en.json'),
      es: require('@/i18n/messages/es.json'),
      zh: require('@/i18n/messages/zh.json'),
    } as Record<string, any>;

    const lines = (): Array<[string, string]> =>
      Object.entries(catalogs).flatMap(([loc, c]) =>
        KEYS.map((k) => [`${loc}.${k}`, String(c.screens.display[k] ?? '')] as [string, string]),
      );

    it('exists in every locale', () => {
      for (const [label, s] of lines()) expect([label, s.length > 0]).toEqual([label, true]);
    });

    it('contains no dates', () => {
      const DATE_LIKE =
        /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i;
      expect(lines().filter(([, s]) => DATE_LIKE.test(s))).toEqual([]);
    });

    it('tells no incident stories and names no mechanism', () => {
      const STORY =
        /woke itself|mains|power(?:-| )pull|pulled the power|supervised|vendor standby|IR remote|device-admin|vendor-recipe|latched/i;
      expect(lines().filter(([, s]) => STORY.test(s))).toEqual([]);
    });

    it('stays short enough to read at a glance', () => {
      expect(lines().filter(([, s]) => s.length > 200)).toEqual([]);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════
// summarizeScheduleOffPaths — what the editor promises about "off"
//
// 2026-08-25: one on/off window saved on a GROUP produced four different
// outcomes across five panels, because the schedule path ignored what each
// panel's power mechanism could actually do. The editor now resolves it per
// panel, with the SERVER's gate, before the operator commits.
// ═════════════════════════════════════════════════════════════════════════
describe('summarizeScheduleOffPaths', () => {
  const panel = (mech: string | null) => ({
    displayCapabilities: mech
      ? stored({ ...REGISTRY_VERDICT, screenBlank: mech })
      : null,
  });

  it('counts a never-reported panel as soft — the schedule editor must not promise power it has never seen', () => {
    expect(summarizeScheduleOffPaths([panel(null)])).toEqual({
      total: 1,
      soft: 1,
      hard: 0,
    });
  });

  it.each([
    ['device-admin', 'soft'],
    ['device-owner', 'soft'],
    ['screen-timeout', 'soft'],
    ['software-dim', 'soft'],
    ['none', 'soft'],
    ['vendor-recipe', 'hard'],
  ] as const)('%s → %s', (mech, expected) => {
    const s = summarizeScheduleOffPaths([panel(mech)]);
    expect(expected === 'soft' ? s.soft : s.hard).toBe(1);
  });

  it('never disagrees with the API gate the manifest uses', () => {
    // Same function, imported at both ends — this pins that the UI keeps
    // ASKING rather than re-deriving. A copy would drift the first time the
    // proven allowlist grows.
    for (const mech of ['vendor-recipe', 'device-admin', 'screen-timeout', 'none']) {
      const caps = stored({ ...REGISTRY_VERDICT, screenBlank: mech });
      const uiSaysHard = summarizeScheduleOffPaths([{ displayCapabilities: caps }]).hard === 1;
      const apiAllowsPowerOff = displayActionSupport(
        'POWER_OFF',
        readStoredDisplayVerdict(caps) as any,
      ).supported;
      expect(uiSaysHard).toBe(apiAllowsPowerOff);
    }
  });

  it('resolves a MIXED group per member, so the note can say "N of these"', () => {
    // The incident group's real shape: one hypothetically-proven panel among
    // four that are not, all under a single group-level window.
    const s = summarizeScheduleOffPaths([
      panel('vendor-recipe'),
      panel('device-admin'),
      panel('device-admin'),
      panel('screen-timeout'),
      panel(null),
    ]);
    expect(s).toEqual({ total: 5, soft: 4, hard: 1 });
  });

  it('is empty-safe — a group whose screens have not loaded yet warns about nothing', () => {
    expect(summarizeScheduleOffPaths([])).toEqual({ total: 0, soft: 0, hard: 0 });
  });
});

/**
 * OVERLAPPING ACTIVE WINDOWS.
 *
 * The device unions them (`DisplayScheduleMath.desiredOnAt` is
 * `schedules.any { covers(…) }`), so the operator's second window can only
 * extend the on-time. The editor now says so — but ONLY on a real collision,
 * because a banner that fires on every second window is a banner nobody
 * reads. These pin both halves: it fires when it should, and it stays quiet
 * when it should.
 */
describe('scheduleWindowsOverlap', () => {
  const TZ = 'America/Chicago';
  const w = (
    daysOfWeek: number[],
    onTime: string,
    offTime: string,
    timezone = TZ,
  ) => ({ daysOfWeek, onTime, offTime, timezone });

  it('is TRUE for the operator’s own pair — 07:00→14:45 inside 07:00→22:00', () => {
    // The exact shape from the screenshot. If both were active the 14:45
    // off would never fire; the screen would run to 22:00.
    expect(
      scheduleWindowsOverlap(
        w(ALL_DAY_INDEXES as number[], '07:00', '14:45'),
        w(ALL_DAY_INDEXES as number[], '07:00', '22:00'),
      ),
    ).toBe(true);
  });

  it('is FALSE for two windows that merely share a target', () => {
    // Mon–Fri days plus a Saturday evening window is a perfectly ordinary
    // fleet configuration and must warn about nothing.
    expect(
      scheduleWindowsOverlap(
        w(WEEKDAY_INDEXES as number[], '07:00', '16:00'),
        w([6], '18:00', '22:00'),
      ),
    ).toBe(false);
  });

  it('is FALSE for back-to-back windows — the end minute is exclusive', () => {
    // 07:00→12:00 then 12:00→18:00 tile the day; they do not collide.
    expect(
      scheduleWindowsOverlap(
        w(ALL_DAY_INDEXES as number[], '07:00', '12:00'),
        w(ALL_DAY_INDEXES as number[], '12:00', '18:00'),
      ),
    ).toBe(false);
  });

  it('follows a window PAST MIDNIGHT into the next day, as the device does', () => {
    // Friday 22:00 → 07:00 runs into Saturday morning, so it collides with a
    // Saturday 06:00 → 09:00 window even though they share no day index.
    expect(scheduleWindowsOverlap(w([5], '22:00', '07:00'), w([6], '06:00', '09:00'))).toBe(true);
    // …and not with one that starts after it has ended.
    expect(scheduleWindowsOverlap(w([5], '22:00', '07:00'), w([6], '08:00', '09:00'))).toBe(false);
  });

  it('wraps Saturday night into Sunday morning', () => {
    // Index 6 → index 0 is the wrap the modulo exists for.
    expect(scheduleWindowsOverlap(w([6], '23:00', '02:00'), w([0], '01:00', '05:00'))).toBe(true);
  });

  it('makes NO claim across different timezones', () => {
    // Aligning two zones needs a real date; guessing here would fire a
    // warning we cannot stand behind.
    expect(
      scheduleWindowsOverlap(
        w(ALL_DAY_INDEXES as number[], '07:00', '22:00'),
        w(ALL_DAY_INDEXES as number[], '07:00', '22:00', 'Europe/Madrid'),
      ),
    ).toBe(false);
  });

  it('makes NO claim about a window that can never run', () => {
    const good = w(ALL_DAY_INDEXES as number[], '07:00', '22:00');
    // No days — the device drops the row outright.
    expect(scheduleWindowsOverlap(w([], '07:00', '22:00'), good)).toBe(false);
    // The ambiguous equal pair the API refuses (0h or 24h — unknowable).
    expect(scheduleWindowsOverlap(w(ALL_DAY_INDEXES as number[], '07:00', '07:00'), good)).toBe(
      false,
    );
    // Unparseable times.
    expect(scheduleWindowsOverlap(w(ALL_DAY_INDEXES as number[], '', 'later'), good)).toBe(false);
  });

  it('is symmetric', () => {
    const a = w([1, 2], '07:00', '14:45');
    const b = w(ALL_DAY_INDEXES as number[], '07:00', '22:00');
    expect(scheduleWindowsOverlap(a, b)).toBe(scheduleWindowsOverlap(b, a));
  });
});
