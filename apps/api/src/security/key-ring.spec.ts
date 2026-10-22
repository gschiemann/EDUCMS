/**
 * The key ring (2026-10-22): `<NAME>_PREVIOUS` opens a rotation window in
 * which everything NEW uses the primary and verification/decryption also
 * accepts the previous value. With no `_PREVIOUS` the ring is one key and
 * every consumer behaves exactly as before.
 */
import {
  assertKeyRingsAtBoot,
  deviceJwtSecretRing,
  deviceSecretKeyCandidates,
  deviceSecretKeyCandidatesFromEnv,
  deviceSecretKeyRing,
  keyRingCandidates,
  masterKeyCandidates,
  masterKeysFor,
  previousSecretName,
} from './key-ring';

const VARS = [
  'NODE_ENV',
  'DEVICE_JWT_SECRET',
  'DEVICE_JWT_SECRET_PREVIOUS',
  'DEVICE_SECRET_KEY',
  'DEVICE_SECRET_KEY_PREVIOUS',
] as const;

const NEW_HEX = 'a'.repeat(64);
const OLD_HEX = 'b'.repeat(64);

describe('security/key-ring', () => {
  const saved: Record<string, string | undefined> = {};
  let warn: jest.SpyInstance;

  beforeEach(() => {
    for (const k of VARS) saved[k] = process.env[k];
    for (const k of VARS) delete process.env[k];
    process.env.NODE_ENV = 'test';
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    for (const k of VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    warn.mockRestore();
  });

  it('names the companion variable <NAME>_PREVIOUS', () => {
    expect(previousSecretName('DEVICE_JWT_SECRET')).toBe('DEVICE_JWT_SECRET_PREVIOUS');
    expect(previousSecretName('DEVICE_SECRET_KEY')).toBe('DEVICE_SECRET_KEY_PREVIOUS');
  });

  describe('with _PREVIOUS unset — one key, unchanged behaviour', () => {
    it('returns only the primary and the same dev fallback the call sites used', () => {
      process.env.DEVICE_JWT_SECRET = NEW_HEX;
      process.env.DEVICE_SECRET_KEY = NEW_HEX;
      expect(deviceJwtSecretRing()).toEqual({ primary: NEW_HEX });
      expect(deviceSecretKeyRing()).toEqual({ primary: NEW_HEX });
      expect(deviceSecretKeyCandidates()).toEqual([NEW_HEX]);

      delete process.env.DEVICE_JWT_SECRET;
      delete process.env.DEVICE_SECRET_KEY;
      expect(deviceJwtSecretRing().primary).toBe('dev_only_device_jwt_secret_CHANGE_ME');
      expect(deviceSecretKeyRing().primary).toBe('dev_only_device_secret_CHANGE_ME');
      expect(deviceSecretKeyRing('dev_only_beacon_secret_CHANGE_ME').primary).toBe(
        'dev_only_beacon_secret_CHANGE_ME',
      );
    });

    it('an EMPTY _PREVIOUS is the same as unset', () => {
      process.env.DEVICE_SECRET_KEY = NEW_HEX;
      process.env.DEVICE_SECRET_KEY_PREVIOUS = '   ';
      expect(deviceSecretKeyRing()).toEqual({ primary: NEW_HEX });
      expect(assertKeyRingsAtBoot()).toEqual([]);
    });

    it('the primary still goes through requireSecret (production refuses a missing primary)', () => {
      process.env.NODE_ENV = 'production';
      expect(() => deviceJwtSecretRing()).toThrow(/DEVICE_JWT_SECRET/);
      expect(() => deviceSecretKeyRing()).toThrow(/DEVICE_SECRET_KEY/);
    });
  });

  describe('with _PREVIOUS set — a rotation window', () => {
    it('returns [primary, previous] in that order', () => {
      process.env.DEVICE_JWT_SECRET = NEW_HEX;
      process.env.DEVICE_JWT_SECRET_PREVIOUS = OLD_HEX;
      process.env.DEVICE_SECRET_KEY = NEW_HEX;
      process.env.DEVICE_SECRET_KEY_PREVIOUS = OLD_HEX;
      expect(deviceJwtSecretRing()).toEqual({ primary: NEW_HEX, previous: OLD_HEX });
      expect(keyRingCandidates(deviceJwtSecretRing())).toEqual([NEW_HEX, OLD_HEX]);
      expect(deviceSecretKeyCandidates()).toEqual([NEW_HEX, OLD_HEX]);
      expect(assertKeyRingsAtBoot().sort()).toEqual(['DEVICE_JWT_SECRET', 'DEVICE_SECRET_KEY']);
    });

    it('at read time a previous that would fail boot validation is ignored, never honoured', () => {
      process.env.DEVICE_SECRET_KEY = NEW_HEX;
      process.env.DEVICE_SECRET_KEY_PREVIOUS = 'short';
      expect(deviceSecretKeyRing()).toEqual({ primary: NEW_HEX });
      process.env.DEVICE_SECRET_KEY_PREVIOUS = NEW_HEX; // identical to primary
      expect(deviceSecretKeyRing()).toEqual({ primary: NEW_HEX });
    });

    it('boot refuses a _PREVIOUS shorter than the primary rule, in every environment', () => {
      process.env.DEVICE_JWT_SECRET = NEW_HEX;
      process.env.DEVICE_JWT_SECRET_PREVIOUS = 'tooshort';
      expect(() => assertKeyRingsAtBoot()).toThrow(/DEVICE_JWT_SECRET_PREVIOUS is set but too short/);
      process.env.NODE_ENV = 'production';
      expect(() => assertKeyRingsAtBoot()).toThrow(/DEVICE_JWT_SECRET_PREVIOUS is set but too short/);
    });

    it('boot refuses a _PREVIOUS identical to the primary (the secret was not rotated)', () => {
      process.env.DEVICE_SECRET_KEY = NEW_HEX;
      process.env.DEVICE_SECRET_KEY_PREVIOUS = NEW_HEX;
      expect(() => assertKeyRingsAtBoot()).toThrow(/identical to DEVICE_SECRET_KEY/);
    });

    it('boot validation never prints a secret value', () => {
      process.env.DEVICE_SECRET_KEY = NEW_HEX;
      process.env.DEVICE_SECRET_KEY_PREVIOUS = NEW_HEX;
      let message = '';
      try {
        assertKeyRingsAtBoot();
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).not.toContain(NEW_HEX);
    });
  });

  describe('deviceSecretKeyCandidatesFromEnv (the OTA helpers that take env)', () => {
    it('empty primary ⇒ no candidates (the helpers already treat that as "no secret")', () => {
      expect(deviceSecretKeyCandidatesFromEnv({})).toEqual([]);
      expect(deviceSecretKeyCandidatesFromEnv({ DEVICE_SECRET_KEY_PREVIOUS: OLD_HEX })).toEqual([]);
    });
    it('primary only, and primary + previous, with the same short/identical guards', () => {
      expect(deviceSecretKeyCandidatesFromEnv({ DEVICE_SECRET_KEY: NEW_HEX })).toEqual([NEW_HEX]);
      expect(
        deviceSecretKeyCandidatesFromEnv({ DEVICE_SECRET_KEY: NEW_HEX, DEVICE_SECRET_KEY_PREVIOUS: OLD_HEX }),
      ).toEqual([NEW_HEX, OLD_HEX]);
      expect(
        deviceSecretKeyCandidatesFromEnv({ DEVICE_SECRET_KEY: NEW_HEX, DEVICE_SECRET_KEY_PREVIOUS: 'short' }),
      ).toEqual([NEW_HEX]);
      expect(
        deviceSecretKeyCandidatesFromEnv({ DEVICE_SECRET_KEY: NEW_HEX, DEVICE_SECRET_KEY_PREVIOUS: NEW_HEX }),
      ).toEqual([NEW_HEX]);
    });
  });

  describe('masterKeysFor (the envelope ciphers)', () => {
    it('derives the primary exactly as the three per-file copies did: first 64 hex chars → 32 bytes', () => {
      process.env.DEVICE_SECRET_KEY = NEW_HEX + 'ffff';
      const keys = masterKeysFor('test');
      expect(keys.primary).toEqual(Buffer.from(NEW_HEX, 'hex'));
      expect(keys.previous).toBeUndefined();
      expect(masterKeyCandidates(keys)).toHaveLength(1);
    });

    it('keeps the zero-padded dev fallback for a short value outside production', () => {
      process.env.DEVICE_SECRET_KEY = 'abcd';
      expect(masterKeysFor('test').primary).toEqual(Buffer.from(('abcd' + '0'.repeat(64)).slice(0, 64), 'hex'));
    });

    it('throws in production under 64 chars, naming the purpose (unchanged message shape)', () => {
      process.env.NODE_ENV = 'production';
      process.env.DEVICE_SECRET_KEY = 'abcd';
      expect(() => masterKeysFor('AI key encryption')).toThrow(
        'DEVICE_SECRET_KEY missing or too short for AI key encryption (need 64 hex chars).',
      );
    });

    it('adds the previous master key during a window, primary first', () => {
      process.env.DEVICE_SECRET_KEY = NEW_HEX;
      process.env.DEVICE_SECRET_KEY_PREVIOUS = OLD_HEX;
      const keys = masterKeysFor('test');
      expect(masterKeyCandidates(keys)).toEqual([Buffer.from(NEW_HEX, 'hex'), Buffer.from(OLD_HEX, 'hex')]);
    });

    it('drops a previous that derives to the same bytes as the primary', () => {
      process.env.DEVICE_SECRET_KEY = NEW_HEX + '1111';
      process.env.DEVICE_SECRET_KEY_PREVIOUS = NEW_HEX + '2222';
      expect(masterKeysFor('test').previous).toBeUndefined();
    });
  });
});
