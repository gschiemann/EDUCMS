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

import { MIN_SAFE_BRIGHTNESS_PERCENT } from '@cms/api-types';
import {
  resolveDisplayControls,
  parseDisplayCapabilities,
  clampBrightness,
  clampVolume,
  serializeDays,
  parseDays,
  formatDays,
  isEveryDay,
  crossesMidnight,
  MIN_SAFE_BRIGHTNESS,
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

describe('parseDisplayCapabilities', () => {
  it('returns null for anything that is not a verdict object', () => {
    expect(parseDisplayCapabilities(null)).toBeNull();
    expect(parseDisplayCapabilities(undefined)).toBeNull();
    expect(parseDisplayCapabilities('sysfs')).toBeNull();
    expect(parseDisplayCapabilities([])).toBeNull();
    expect(parseDisplayCapabilities({})).toBeNull();
  });

  it('accepts a bare verdict and a { verdict } envelope alike', () => {
    expect(parseDisplayCapabilities(FULL_VERDICT)?.brightness).toBe('sysfs');
    expect(parseDisplayCapabilities({ verdict: FULL_VERDICT })?.brightness).toBe('sysfs');
  });

  it('drops values outside the known enum instead of trusting them', () => {
    const v = parseDisplayCapabilities({
      volume: 'audiomanager',
      brightness: 'root-shell',
      reboot: 'su',
    });
    expect(v?.volume).toBe('audiomanager');
    expect(v?.brightness).toBeUndefined();
    expect(v?.reboot).toBeUndefined();
  });
});

describe('resolveDisplayControls — tri-state', () => {
  it('treats "never reported" as unknown, NOT as unsupported', () => {
    const r = resolveDisplayControls(null);
    expect(r.reported).toBe(false);
    // Nothing may be GUESSED at: not a control, and not a "not supported"
    // claim, for every axis that has a hardware precondition.
    expect(r.volume.available).toBe(false);
    expect(r.volume.noteKey).toBeNull();
    expect(r.brightness.available).toBe(false);
    expect(r.reboot.available).toBe(false);
    expect(r.reboot.noteKey).toBeNull();
  });

  // CONTRACT C3/C4 (lead, 2026-08-13). This REPLACES the old assertion that
  // `blank.available === false` before a probe lands. Blank/Wake ride the
  // player's unconditional software floor, and WAKE is the fleet's only
  // remote recovery from a dark screen — withholding it pending a probe
  // makes "a dark screen that cannot be recovered from the dashboard", which
  // the lead named as the worst outcome in this whole feature.
  it('keeps blank/wake available even before the screen has ever reported', () => {
    const r = resolveDisplayControls(null);
    expect(r.blank.available).toBe(true);
    expect(r.blank.softwareOnly).toBe(true);
    expect(r.blank.noteKey).toBe('screens.display.note.blankUnknown');
  });

  it('a partially-reported verdict leaves the missing axes unknown', () => {
    const r = resolveDisplayControls({ volume: 'audiomanager' });
    expect(r.reported).toBe(true);
    expect(r.volume.available).toBe(true);
    expect(r.brightness.available).toBe(false);
    expect(r.brightness.noteKey).toBeNull();
  });
});

describe('resolveDisplayControls — no-software-floor axes', () => {
  it('volume:none renders no control, but does explain itself', () => {
    const r = resolveDisplayControls({ ...FULL_VERDICT, volume: 'none' });
    expect(r.volume.available).toBe(false);
    expect(r.volume.noteKey).toBe('screens.display.note.volumeNone');
  });

  it('reboot:none renders no button, and names the blocker', () => {
    const blocked = resolveDisplayControls({
      ...FULL_VERDICT,
      reboot: 'none',
      deviceOwnerPath: 'blocked-other-owner',
    });
    expect(blocked.reboot.available).toBe(false);
    expect(blocked.reboot.noteKey).toBe('screens.display.note.rebootBlockedOtherOwner');

    const provisionable = resolveDisplayControls({
      ...FULL_VERDICT,
      reboot: 'none',
      deviceOwnerPath: 'provisionable-after-factory-reset',
    });
    expect(provisionable.reboot.noteKey).toBe('screens.display.note.rebootNeedsProvisioning');

    // No deviceOwnerPath reported at all → generic, still never a button.
    expect(
      resolveDisplayControls({ volume: 'none', reboot: 'none' }).reboot.noteKey,
    ).toBe('screens.display.note.rebootUnavailable');
  });
});

describe('resolveDisplayControls — software-floor axes stay actionable but honest', () => {
  it('brightness:software-dim is available AND flagged software-only', () => {
    const r = resolveDisplayControls({ ...FULL_VERDICT, brightness: 'software-dim' });
    expect(r.brightness.available).toBe(true);
    expect(r.brightness.softwareOnly).toBe(true);
    expect(r.brightness.kind).toBe('software-dim');
    expect(r.brightness.noteKey).toBe('screens.display.note.brightnessSoftware');
  });

  it('brightness:sysfs is real backlight control, not flagged', () => {
    const r = resolveDisplayControls(FULL_VERDICT);
    expect(r.brightness.softwareOnly).toBe(false);
    expect(r.brightness.noteKey).toBe('screens.display.note.brightnessSysfs');
  });

  it('screenBlank:none still blanks (black overlay) but says the backlight stays lit', () => {
    const r = resolveDisplayControls({ ...FULL_VERDICT, screenBlank: 'none' });
    expect(r.blank.available).toBe(true);
    expect(r.blank.softwareOnly).toBe(true);
    expect(r.blank.noteKey).toBe('screens.display.note.blankSoftware');
  });

  // The probe sets screenBlank:'device-admin' from `dpm.activeAdmins`, which
  // counts EVERY admin on the box — routinely a district MDM (Hexnode,
  // Meraki SM, Knox) rather than us. lockNow() from a non-admin app throws
  // SecurityException and the player falls back to the software floor, so
  // the dashboard must not promise a hardware screen-off it can't support.
  // Only device-OWNER keeps the absolute wording.
  it('device-admin blanking is hedged, device-owner is absolute', () => {
    const admin = resolveDisplayControls({ ...FULL_VERDICT, screenBlank: 'device-admin' });
    expect(admin.blank.available).toBe(true);
    expect(admin.blank.noteKey).toBe('screens.display.note.blankDeviceAdmin');

    const owner = resolveDisplayControls({ ...FULL_VERDICT, screenBlank: 'device-owner' });
    expect(owner.blank.softwareOnly).toBe(false);
    expect(owner.blank.noteKey).toBe('screens.display.note.blankHardware');
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
