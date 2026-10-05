/**
 * "This device holds a passkey for this account" — the per-device memory
 * behind the phone's sign-in choices (2026-10-05). See
 * `lib/passkey-on-device.ts` for why it exists and why what is stored is a
 * hash, never the address.
 */
import { createHash, webcrypto } from 'crypto';
import { TextEncoder as NodeTextEncoder } from 'util';
import {
  PASSKEY_ON_DEVICE_KEY,
  passkeyOnDeviceTag,
  passkeyRememberedOnDevice,
  rememberPasskeyOnDevice,
} from '../passkey-on-device';

// jsdom has neither WebCrypto's `subtle` nor TextEncoder; real browsers on a
// secure origin (the only place WebAuthn exists) have both.
const realSubtle = Object.getOwnPropertyDescriptor(globalThis.crypto, 'subtle');
const realEncoder = (globalThis as { TextEncoder?: unknown }).TextEncoder;
beforeAll(() => {
  Object.defineProperty(globalThis.crypto, 'subtle', { value: webcrypto.subtle, configurable: true });
  (globalThis as { TextEncoder?: unknown }).TextEncoder = NodeTextEncoder;
});
afterAll(() => {
  if (realSubtle) Object.defineProperty(globalThis.crypto, 'subtle', realSubtle);
  else delete (globalThis.crypto as { subtle?: unknown }).subtle;
  (globalThis as { TextEncoder?: unknown }).TextEncoder = realEncoder;
});

beforeEach(() => localStorage.clear());

const stored = (): unknown => JSON.parse(localStorage.getItem(PASSKEY_ON_DEVICE_KEY) ?? 'null');

describe('what is stored', () => {
  it('is an opaque SHA-256 tag — never the address', async () => {
    await rememberPasskeyOnDevice('owner@venueos.example');
    const raw = localStorage.getItem(PASSKEY_ON_DEVICE_KEY) ?? '';
    expect(raw).not.toContain('owner');
    expect(raw).not.toContain('venueos.example');
    const expected = createHash('sha256')
      .update('venueos-passkey-on-device:owner@venueos.example')
      .digest('base64url');
    expect(stored()).toEqual([expected]);
    expect(await passkeyOnDeviceTag('owner@venueos.example')).toBe(expected);
  });

  it('the same address however it was typed (case, spaces) is the same account', async () => {
    await rememberPasskeyOnDevice('  Owner@VenueOS.example ');
    expect(await passkeyRememberedOnDevice('owner@venueos.example')).toBe(true);
  });
});

describe('remember → the next sign-in on this device knows', () => {
  it('an account never seen here is not remembered', async () => {
    expect(await passkeyRememberedOnDevice('owner@venueos.example')).toBe(false);
  });

  it('remembered for THAT account only — another person on the same phone still gets both choices', async () => {
    await rememberPasskeyOnDevice('owner@venueos.example');
    expect(await passkeyRememberedOnDevice('owner@venueos.example')).toBe(true);
    expect(await passkeyRememberedOnDevice('front-desk@venueos.example')).toBe(false);
  });

  it('remembering twice keeps one entry; the most recent account comes first; the list is capped at 8', async () => {
    await rememberPasskeyOnDevice('a@x.example');
    await rememberPasskeyOnDevice('a@x.example');
    expect(stored()).toHaveLength(1);
    for (let i = 0; i < 10; i += 1) await rememberPasskeyOnDevice(`user${i}@x.example`);
    const list = stored() as string[];
    expect(list).toHaveLength(8);
    expect(list[0]).toBe(await passkeyOnDeviceTag('user9@x.example'));
    // The account least recently seen here is the one that fell off.
    expect(await passkeyRememberedOnDevice('a@x.example')).toBe(false);
    expect(await passkeyRememberedOnDevice('user2@x.example')).toBe(true);
  });
});

describe('never fails a sign-in', () => {
  it('no WebCrypto (an insecure origin — no WebAuthn there either): not remembered, nothing written, no throw', async () => {
    Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });
    try {
      await expect(rememberPasskeyOnDevice('owner@venueos.example')).resolves.toBeUndefined();
      expect(localStorage.length).toBe(0);
      await expect(passkeyRememberedOnDevice('owner@venueos.example')).resolves.toBe(false);
    } finally {
      Object.defineProperty(globalThis.crypto, 'subtle', { value: webcrypto.subtle, configurable: true });
    }
  });

  it('storage that THROWS (Safari private mode, a locked-down kiosk): not remembered, no throw', async () => {
    const get = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    const set = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    try {
      await expect(rememberPasskeyOnDevice('owner@venueos.example')).resolves.toBeUndefined();
      await expect(passkeyRememberedOnDevice('owner@venueos.example')).resolves.toBe(false);
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  it('garbage in storage reads as "not remembered" and is replaced by the next write', async () => {
    localStorage.setItem(PASSKEY_ON_DEVICE_KEY, '{not json');
    expect(await passkeyRememberedOnDevice('owner@venueos.example')).toBe(false);
    localStorage.setItem(PASSKEY_ON_DEVICE_KEY, JSON.stringify({ owner: true }));
    expect(await passkeyRememberedOnDevice('owner@venueos.example')).toBe(false);
    await rememberPasskeyOnDevice('owner@venueos.example');
    expect(await passkeyRememberedOnDevice('owner@venueos.example')).toBe(true);
  });

  it('no address → nothing remembered, nothing written', async () => {
    await rememberPasskeyOnDevice('   ');
    expect(localStorage.length).toBe(0);
    expect(await passkeyRememberedOnDevice('')).toBe(false);
  });
});
