/**
 * "THIS DEVICE HOLDS A PASSKEY FOR THIS ACCOUNT" — remembered per device
 * (2026-10-05).
 *
 * Owner, on his iPhone: "I just want to create a passkey on my phone and get
 * logged in." His only passkey was on his Mac, so "Use your passkey" on the
 * phone opened iOS's cross-device QR code. On a phone the second sign-in step
 * now starts with two equal choices — "Use your passkey" and "Set up a passkey
 * on this iPhone". Once this device HAS a passkey for the account the second
 * choice is noise, so later sign-ins here show only "Use your passkey". This
 * file is how the page knows.
 *
 * Written when a passkey is created on this device (the set-up path or the
 * post-sign-in offer), when the browser refuses a duplicate because this
 * device already holds one, and when "Use your passkey" just worked here.
 * Never cleared by a miss: a dismissed sheet and "no passkey here" are the
 * same error, and the list of other ways after a miss leads with "Set up a
 * passkey on this phone" either way — a stale entry costs one extra tap,
 * never a dead end.
 *
 * ── WHAT IS STORED ────────────────────────────────────────────────────────
 * Not the address: SHA-256 of a purpose prefix + the normalized email,
 * base64url, in a short capped list — the same "opaque value, capped, every
 * access wrapped" shape as `keep-signed-in.ts`. It decides which button is
 * shown and nothing else: it is not a credential, forging or deleting an
 * entry only changes which choices appear, and the server still decides
 * every sign-in.
 *
 * Every storage access is wrapped — Safari private mode and locked-down
 * kiosks THROW on storage, and a sign-in must never fail over a hint.
 */

export const PASSKEY_ON_DEVICE_KEY = 'venueos_passkey_on_device.v1';
/** A device is used by a handful of accounts at most; cap what is kept. */
const MAX_ENTRIES = 8;
/** Domain separation: this hash is only ever this hint. */
const PURPOSE = 'venueos-passkey-on-device:';

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The opaque tag for an account on this device, or `null` where WebCrypto is
 * unavailable (an insecure origin — which has no WebAuthn either, so nothing
 * is lost) or there is no address.
 */
export async function passkeyOnDeviceTag(email: string): Promise<string | null> {
  try {
    const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const subtle = globalThis.crypto?.subtle;
    if (!normalized || !subtle) return null;
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(PURPOSE + normalized));
    return toBase64Url(new Uint8Array(digest));
  } catch {
    return null;
  }
}

function readTags(): string[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage.getItem(PASSKEY_ON_DEVICE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function writeTags(tags: string[]): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(PASSKEY_ON_DEVICE_KEY, JSON.stringify(tags.slice(0, MAX_ENTRIES)));
  } catch {
    /* no storage — the next sign-in here simply offers both choices again */
  }
}

/** This device now holds (or just used) a passkey for this account. */
export async function rememberPasskeyOnDevice(email: string): Promise<void> {
  const tag = await passkeyOnDeviceTag(email);
  if (!tag) return;
  // Most recent first, so the cap drops the account least recently seen here.
  writeTags([tag, ...readTags().filter((t) => t !== tag)]);
}

/** Has this device held a passkey for this account? `false` when unknown. */
export async function passkeyRememberedOnDevice(email: string): Promise<boolean> {
  const tag = await passkeyOnDeviceTag(email);
  return !!tag && readTags().includes(tag);
}
