/**
 * Tests for the console-profile registry — the serial-settings +
 * transport + decoder map the player-side bridge picks from.
 *
 * Guards the 2026-06-01 WTTC addition (water-polo pilot): the new
 * `cts-wttc` profile must coexist with the existing `cts-gen6` /
 * `daktronics-allsport` rows WITHOUT changing their behavior (every
 * existing install resolves identically), and the WTTC must carry the
 * USB-serial transport + /dev/ttyUSB0 default that distinguishes its
 * FTDI feed from the native-UART consoles.
 */

import {
  CONSOLE_PROFILES,
  DEFAULT_CONSOLE_PROFILE,
  resolveConsoleProfile,
} from '../console-profiles';

describe('console-profiles registry', () => {
  it('keeps the existing Gen 6 profile unchanged (native UART)', () => {
    const p = CONSOLE_PROFILES['cts-gen6'];
    expect(p.decoder).toBe('cts');
    expect(p.transport).toBe('uart');
    expect(p.defaultTty).toBe('/dev/ttyS1');
    expect(p.serial).toEqual({ baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'even' });
    expect(p.status).toBe('stable');
    expect(p.sports).toContain('water-polo');
  });

  it('adds the WTTC profile on the USB-serial path (/dev/ttyUSB0)', () => {
    const p = CONSOLE_PROFILES['cts-wttc'];
    expect(p).toBeDefined();
    // Uses the CTS decoder (provisionally — byte format pending capture).
    expect(p.decoder).toBe('cts');
    // The distinguishing bit: USB-serial via an FTDI adapter, not a UART.
    expect(p.transport).toBe('usb-serial');
    expect(p.defaultTty).toBe('/dev/ttyUSB0');
    // Honest maturity flag — not yet validated against real WTTC bytes.
    expect(p.status).toBe('provisional');
    // Water polo is the shipping target; swimming is future.
    expect(p.sports).toContain('water-polo');
    expect(p.sports).not.toContain('swimming');
  });

  it('keeps Daktronics on the native UART', () => {
    const p = CONSOLE_PROFILES['daktronics-allsport'];
    expect(p.decoder).toBe('daktronics');
    expect(p.transport).toBe('uart');
    expect(p.defaultTty).toBe('/dev/ttyS1');
  });

  it('defaults to cts-gen6 so pre-existing installs are unchanged', () => {
    expect(DEFAULT_CONSOLE_PROFILE).toBe('cts-gen6');
    // Unknown / empty / null all fall back to the default.
    expect(resolveConsoleProfile(undefined).id).toBe('cts-gen6');
    expect(resolveConsoleProfile(null).id).toBe('cts-gen6');
    expect(resolveConsoleProfile('').id).toBe('cts-gen6');
    expect(resolveConsoleProfile('nonsense').id).toBe('cts-gen6');
  });

  it('resolves a known id to its profile', () => {
    expect(resolveConsoleProfile('cts-wttc').id).toBe('cts-wttc');
    expect(resolveConsoleProfile('cts-wttc').transport).toBe('usb-serial');
    expect(resolveConsoleProfile('daktronics-allsport').decoder).toBe('daktronics');
  });

  it('every profile carries the fields the bridge needs', () => {
    for (const id of Object.keys(CONSOLE_PROFILES) as Array<keyof typeof CONSOLE_PROFILES>) {
      const p = CONSOLE_PROFILES[id];
      expect(p.id).toBe(id);
      expect(typeof p.label).toBe('string');
      expect(['uart', 'usb-serial']).toContain(p.transport);
      expect(p.defaultTty.startsWith('/dev/tty')).toBe(true);
      expect(['stable', 'provisional']).toContain(p.status);
      expect(p.serial.baudRate).toBeGreaterThan(0);
    }
  });
});
