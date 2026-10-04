/**
 * "Keep me signed in" for a passkey sign-in — remembered PER ACCOUNT
 * (2026-10-04). See `lib/keep-signed-in.ts` for why it is per account, why it
 * defaults to off, and why what is stored is a hash.
 */
import { createHash, webcrypto } from 'crypto';
import { TextEncoder as NodeTextEncoder } from 'util';
import {
  KEEP_SIGNED_IN_KEY,
  keepSignedInForPasskey,
  passkeyUserHandleFor,
  rememberKeepSignedInChoice,
} from '../keep-signed-in';

/** What the API stores on the authenticator: `PasskeyController.userHandle`. */
const serverUserHandle = (userId: string) =>
  createHash('sha256').update(userId).digest('base64url');
/** What `@simplewebauthn/browser` hands the page for that account's passkey. */
const assertionFor = (userId: string) => ({
  id: 'cred-1',
  response: { userHandle: serverUserHandle(userId) },
});

// jsdom has neither WebCrypto's `subtle` nor TextEncoder; real browsers on a
// secure origin have both.
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

describe('the key is the account\'s WebAuthn user handle', () => {
  it('matches, byte for byte, what the API puts on the authenticator', async () => {
    for (const id of ['u1', '7b0d4c9e-1f7a-4d0a-9d3e-2f6b8c1a5e44']) {
      expect(await passkeyUserHandleFor(id)).toBe(serverUserHandle(id));
    }
  });

  it('is null — not a throw — where WebCrypto is unavailable', async () => {
    Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });
    try {
      expect(await passkeyUserHandleFor('u1')).toBeNull();
      await expect(rememberKeepSignedInChoice('u1', true)).resolves.toBeUndefined();
      expect(localStorage.length).toBe(0);
    } finally {
      Object.defineProperty(globalThis.crypto, 'subtle', { value: webcrypto.subtle, configurable: true });
    }
  });
});

describe('a passkey sign-in follows the choice ITS account last made on this browser', () => {
  it('defaults to OFF — an account that never used the checkbox here gets a normal session', () => {
    expect(keepSignedInForPasskey(assertionFor('u1'))).toBe(false);
  });

  it('ticked at a finished sign-in → that account\'s next passkey sign-in keeps it signed in', async () => {
    await rememberKeepSignedInChoice('u1', true);
    expect(keepSignedInForPasskey(assertionFor('u1'))).toBe(true);
  });

  it('PER ACCOUNT: one person\'s tick never makes another person\'s passkey sign-in durable', async () => {
    await rememberKeepSignedInChoice('front-desk-a', true);
    expect(keepSignedInForPasskey(assertionFor('front-desk-b'))).toBe(false);
  });

  it('the latest choice wins — signing in with the box unticked turns it off again', async () => {
    await rememberKeepSignedInChoice('u1', true);
    await rememberKeepSignedInChoice('u1', false);
    expect(keepSignedInForPasskey(assertionFor('u1'))).toBe(false);
    expect(localStorage.getItem(KEEP_SIGNED_IN_KEY)).toBeNull();
  });

  it('stores only hashes — never the id', async () => {
    await rememberKeepSignedInChoice('7b0d4c9e-1f7a-4d0a-9d3e-2f6b8c1a5e44', true);
    const stored = localStorage.getItem(KEEP_SIGNED_IN_KEY) as string;
    expect(stored).not.toContain('7b0d4c9e');
    expect(JSON.parse(stored)).toEqual([serverUserHandle('7b0d4c9e-1f7a-4d0a-9d3e-2f6b8c1a5e44')]);
  });

  it('keeps a handful of accounts, most recent first, without duplicates', async () => {
    for (let i = 0; i < 12; i += 1) await rememberKeepSignedInChoice(`u${i}`, true);
    await rememberKeepSignedInChoice('u11', true);
    const stored = JSON.parse(localStorage.getItem(KEEP_SIGNED_IN_KEY) as string) as string[];
    expect(stored).toHaveLength(8);
    expect(stored[0]).toBe(serverUserHandle('u11'));
    expect(new Set(stored).size).toBe(8);
    // The oldest fell off: back to the default.
    expect(keepSignedInForPasskey(assertionFor('u0'))).toBe(false);
  });

  it.each([
    ['no assertion', null],
    ['no response', {}],
    ['no user handle (a non-discoverable credential)', { response: {} }],
    ['a non-string handle', { response: { userHandle: 42 } }],
    ['an empty handle', { response: { userHandle: '' } }],
  ])('%s → off', async (_name, assertion) => {
    await rememberKeepSignedInChoice('u1', true);
    expect(keepSignedInForPasskey(assertion)).toBe(false);
  });

  it('ignores a sign-in response with no user id', async () => {
    await rememberKeepSignedInChoice(undefined, true);
    await rememberKeepSignedInChoice('', true);
    await rememberKeepSignedInChoice(42, true);
    expect(localStorage.length).toBe(0);
  });
});

describe('storage that is broken or hostile', () => {
  it('garbage under the key reads as "nobody chose it"', () => {
    for (const junk of ['not json', '{"a":1}', '"string"', '[1,2,{}]', 'null']) {
      localStorage.setItem(KEEP_SIGNED_IN_KEY, junk);
      expect(keepSignedInForPasskey(assertionFor('u1'))).toBe(false);
    }
  });

  it('storage that throws never throws out of here', async () => {
    const set = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    const get = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    try {
      expect(keepSignedInForPasskey(assertionFor('u1'))).toBe(false);
      await expect(rememberKeepSignedInChoice('u1', true)).resolves.toBeUndefined();
    } finally {
      set.mockRestore();
      get.mockRestore();
    }
  });
});
