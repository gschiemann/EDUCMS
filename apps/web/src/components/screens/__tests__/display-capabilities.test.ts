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
  resolveDisplayControls,
  parseDisplayCapabilities,
  clampBrightness,
  clampVolume,
  serializeDays,
  parseDays,
  crossesMidnight,
  MIN_SAFE_BRIGHTNESS,
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
    // Nothing may render: not a control, and not a "not supported" claim.
    expect(r.volume.available).toBe(false);
    expect(r.volume.noteKey).toBeNull();
    expect(r.brightness.available).toBe(false);
    expect(r.blank.available).toBe(false);
    expect(r.reboot.available).toBe(false);
    expect(r.reboot.noteKey).toBeNull();
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

  it('device-admin blanking counts as a real screen-off', () => {
    const r = resolveDisplayControls({ ...FULL_VERDICT, screenBlank: 'device-admin' });
    expect(r.blank.softwareOnly).toBe(false);
    expect(r.blank.noteKey).toBe('screens.display.note.blankHardware');
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
});

describe('schedule day round-trip', () => {
  it('collapses "all days" and "no days" to null (= every day)', () => {
    expect(serializeDays([...DISPLAY_SCHEDULE_DAYS])).toBeNull();
    expect(serializeDays([])).toBeNull();
  });

  it('keeps a subset in canonical Mon→Sun order regardless of click order', () => {
    expect(serializeDays(['Fri', 'Mon', 'Wed'])).toBe('Mon,Wed,Fri');
  });

  it('parses null as every day and ignores junk entries', () => {
    expect(parseDays(null)).toEqual([...DISPLAY_SCHEDULE_DAYS]);
    expect(parseDays('Mon, Tue ,Funday')).toEqual(['Mon', 'Tue']);
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
