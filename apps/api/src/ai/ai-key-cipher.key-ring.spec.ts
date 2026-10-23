/**
 * ai-key-cipher during a DEVICE_SECRET_KEY rotation window (2026-10-22).
 * Same four-way contract as creds-cipher.key-ring.spec.ts.
 */
import { openAiKey, rewrapAiKeyToPrimary, sealAiKey } from './ai-key-cipher';

const NEW_HEX = '44'.repeat(32);
const OLD_HEX = '55'.repeat(32);
const UNRELATED_HEX = '66'.repeat(32);
const VARS = ['NODE_ENV', 'DEVICE_SECRET_KEY', 'DEVICE_SECRET_KEY_PREVIOUS'] as const;
const saved: Record<string, string | undefined> = {};

function withKeys<T>(primary: string, previous: string | undefined, fn: () => T): T {
  process.env.DEVICE_SECRET_KEY = primary;
  if (previous === undefined) delete process.env.DEVICE_SECRET_KEY_PREVIOUS;
  else process.env.DEVICE_SECRET_KEY_PREVIOUS = previous;
  return fn();
}

beforeAll(() => {
  for (const k of VARS) saved[k] = process.env[k];
  process.env.NODE_ENV = 'test';
});
afterAll(() => {
  for (const k of VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const API_KEY = 'sk-ant-api03-test-key-0123456789abcdef';

describe('ai-key-cipher + key ring', () => {
  it('(a) previous unset: an old-key blob does not open; a primary blob does', () => {
    const old = withKeys(OLD_HEX, undefined, () => sealAiKey(API_KEY));
    withKeys(NEW_HEX, undefined, () => {
      expect(openAiKey(sealAiKey(API_KEY))).toBe(API_KEY);
      expect(() => openAiKey(old)).toThrow();
    });
  });

  it('(b) during the window an old-key blob opens', () => {
    const old = withKeys(OLD_HEX, undefined, () => sealAiKey(API_KEY));
    withKeys(NEW_HEX, OLD_HEX, () => expect(openAiKey(old)).toBe(API_KEY));
  });

  it('(c) seal in the window uses the PRIMARY; rewrap moves an old blob onto it, keeps the inner ciphertext, and is idempotent', () => {
    const inWindow = withKeys(NEW_HEX, OLD_HEX, () => sealAiKey(API_KEY));
    withKeys(NEW_HEX, undefined, () => expect(openAiKey(inWindow)).toBe(API_KEY));
    withKeys(OLD_HEX, undefined, () => expect(() => openAiKey(inWindow)).toThrow());

    const old = withKeys(OLD_HEX, undefined, () => sealAiKey(API_KEY));
    withKeys(NEW_HEX, OLD_HEX, () => {
      const r = rewrapAiKeyToPrimary(old);
      expect(r.status).toBe('rewrapped');
      if (r.status !== 'rewrapped') return;
      // Outer 60-byte envelope changed, inner bytes identical.
      expect(Buffer.from(r.sealed, 'base64').subarray(60)).toEqual(Buffer.from(old, 'base64').subarray(60));
      expect(openAiKey(r.sealed)).toBe(API_KEY);
      expect(rewrapAiKeyToPrimary(r.sealed)).toEqual({ status: 'current' });
      withKeys(NEW_HEX, undefined, () => expect(openAiKey(r.sealed)).toBe(API_KEY));
    });
  });

  it('(d) a blob under an unrelated key is refused / unreadable, window or not', () => {
    const unrelated = withKeys(UNRELATED_HEX, undefined, () => sealAiKey(API_KEY));
    withKeys(NEW_HEX, undefined, () => {
      expect(() => openAiKey(unrelated)).toThrow();
      expect(rewrapAiKeyToPrimary(unrelated)).toEqual({ status: 'unreadable' });
    });
    withKeys(NEW_HEX, OLD_HEX, () => {
      expect(() => openAiKey(unrelated)).toThrow();
      expect(rewrapAiKeyToPrimary(unrelated)).toEqual({ status: 'unreadable' });
    });
    expect(rewrapAiKeyToPrimary('AAAA')).toEqual({ status: 'unreadable' });
  });
});
