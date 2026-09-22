/**
 * F-02 (launch re-audit 2026-09-21): a browser player's device identity must
 * come from a CSPRNG, never from `Math.random` — the fingerprint is what
 * `POST /screens/register` stamps `status:'ONLINE'` on.
 */
import { freshDeviceIdentity } from '../deviceIdentity';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('freshDeviceIdentity', () => {
  const realCrypto = globalThis.crypto;
  afterEach(() => {
    Object.defineProperty(globalThis, 'crypto', { value: realCrypto, configurable: true, writable: true });
    jest.restoreAllMocks();
  });

  it('uses crypto.randomUUID and never touches Math.random when a CSPRNG exists', () => {
    const rand = jest.spyOn(Math, 'random');
    const id = freshDeviceIdentity('device');
    expect(id.startsWith('device-')).toBe(true);
    expect(id.slice('device-'.length)).toMatch(UUID);
    expect(rand).not.toHaveBeenCalled();
  });

  it('keeps the preview- prefix the server keys off', () => {
    expect(freshDeviceIdentity('preview')).toMatch(/^preview-/);
  });

  it('falls back to getRandomValues (the Chromium-83 shape) when randomUUID is absent', () => {
    const bytes = jest.fn((arr: Uint8Array) => { arr.fill(0xab); return arr; });
    Object.defineProperty(globalThis, 'crypto', {
      value: { getRandomValues: bytes }, configurable: true, writable: true,
    });
    const rand = jest.spyOn(Math, 'random');
    const id = freshDeviceIdentity('device');
    expect(id).toBe(`device-${'ab'.repeat(16)}`);
    expect(bytes).toHaveBeenCalledTimes(1);
    expect(rand).not.toHaveBeenCalled();
  });

  it('two identities never collide', () => {
    expect(freshDeviceIdentity('device')).not.toBe(freshDeviceIdentity('device'));
  });

  it('never throws even with no crypto at all (last resort only)', () => {
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
    expect(freshDeviceIdentity('device')).toMatch(/^device-\d+-[a-z0-9]+$/);
  });
});
