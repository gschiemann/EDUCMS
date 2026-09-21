/**
 * A SOFTWARE WEBAUTHN AUTHENTICATOR, FOR TESTS THAT USE REAL CRYPTOGRAPHY.
 *
 * The passkey specs do NOT stub `verifyRegistrationResponse` /
 * `verifyAuthenticationResponse`. A mocked verifier proves that the
 * controller calls a function; it proves nothing about whether a forged
 * signature, a replayed challenge, a wrong origin or a cleared
 * user-verification flag would actually be refused — which is the entire
 * security claim of this feature. So this file builds the byte-exact
 * structures a real platform authenticator produces, signs them with a real
 * P-256 key from `node:crypto`, and lets the library do its real work.
 *
 * Every knob a negative test needs is a parameter: sign with the wrong
 * origin, the wrong rpID, a stale challenge, the UV flag clear, or a
 * regressed counter, and watch the verification fail for the right reason.
 *
 * ── THE STRUCTURES (WebAuthn L2 §6.1) ────────────────────────────────────
 *
 *   authenticatorData = rpIdHash(32) ‖ flags(1) ‖ signCount(4 BE)
 *                       [‖ attestedCredentialData, only at registration]
 *   attestedCredentialData = aaguid(16) ‖ credIdLen(2 BE) ‖ credId ‖ COSEKey
 *   attestationObject = CBOR{ fmt, attStmt, authData }
 *   assertion signature = ECDSA-SHA256( authenticatorData ‖ SHA256(clientDataJSON) )
 *
 * The signature is ASN.1 DER, which is what `crypto.sign` emits for an EC key
 * and what WebAuthn specifies for ES256 — no raw-r‖s conversion needed.
 */

import {
  createHash,
  createSign,
  generateKeyPairSync,
  type KeyObject,
} from 'crypto';

import { isoCBOR } from '@simplewebauthn/server/helpers';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

/** Authenticator data flag bits. */
const FLAG_UP = 0x01; // user present
const FLAG_UV = 0x04; // user verified (biometric / PIN)
const FLAG_AT = 0x40; // attested credential data included

const COSE_KTY = 1;
const COSE_ALG = 3;
const COSE_CRV = -1;
const COSE_X = -2;
const COSE_Y = -3;
const COSE_KTY_EC2 = 2;
const COSE_ALG_ES256 = -7;
const COSE_CRV_P256 = 1;

function b64url(bytes: Uint8Array | Buffer): string {
  return Buffer.from(bytes).toString('base64url');
}

function sha256(input: Uint8Array | Buffer | string): Buffer {
  return createHash('sha256')
    .update(input as any)
    .digest();
}

/** A COSE_Key for an ES256 public key, as a CBOR map with integer labels. */
function coseKeyFor(x: Buffer, y: Buffer): Uint8Array {
  const map = new Map<string | number, any>([
    [COSE_KTY, COSE_KTY_EC2],
    [COSE_ALG, COSE_ALG_ES256],
    [COSE_CRV, COSE_CRV_P256],
    [COSE_X, new Uint8Array(x)],
    [COSE_Y, new Uint8Array(y)],
  ]);
  return isoCBOR.encode(map as any);
}

function flagsByte(opts: {
  userVerified: boolean;
  attested: boolean;
  userPresent?: boolean;
}): number {
  let flags = 0;
  // User presence is what a physical tap sets. It is separate from user
  // verification and the library checks them independently.
  if (opts.userPresent !== false) flags |= FLAG_UP;
  if (opts.userVerified) flags |= FLAG_UV;
  if (opts.attested) flags |= FLAG_AT;
  return flags;
}

function authenticatorData(opts: {
  rpID: string;
  flags: number;
  signCount: number;
  attested?: { aaguid: Buffer; credentialId: Buffer; coseKey: Uint8Array };
}): Buffer {
  const head = Buffer.alloc(37);
  sha256(opts.rpID).copy(head, 0); // rpIdHash
  head.writeUInt8(opts.flags, 32);
  head.writeUInt32BE(opts.signCount >>> 0, 33);
  if (!opts.attested) return head;

  const { aaguid, credentialId, coseKey } = opts.attested;
  const credIdLen = Buffer.alloc(2);
  credIdLen.writeUInt16BE(credentialId.length, 0);
  return Buffer.concat([
    head,
    aaguid,
    credIdLen,
    credentialId,
    Buffer.from(coseKey),
  ]);
}

function clientDataJSON(
  type: 'webauthn.create' | 'webauthn.get',
  challenge: string,
  origin: string,
): string {
  // Field order is irrelevant to the verifier (it JSON-parses), but this is
  // the order real browsers emit, which keeps the fixture honest.
  return JSON.stringify({ type, challenge, origin, crossOrigin: false });
}

export interface CeremonyOverrides {
  /** Sign a DIFFERENT challenge than the server issued (replay / mismatch). */
  challenge?: string;
  /** Claim a different origin than the one the ceremony was pinned to. */
  origin?: string;
  /** Hash a different rpID into authenticatorData. */
  rpID?: string;
  /** Clear the UV bit — the "possession only, no biometric" case. */
  userVerified?: boolean;
  /** Clear the UP bit. */
  userPresent?: boolean;
  /** Force an exact counter value instead of the natural increment. */
  signCount?: number;
}

export interface RegistrationCeremony {
  challenge: string;
  origin: string;
  rpID: string;
}

export class SoftAuthenticator {
  readonly credentialIdBytes: Buffer;
  /** base64url — the `id` the browser reports and the DB column stores. */
  readonly credentialId: string;
  readonly aaguid: Buffer;
  private readonly privateKey: KeyObject;
  private readonly x: Buffer;
  private readonly y: Buffer;
  /** The counter this authenticator will report next. */
  signCount: number;

  constructor(
    opts: { credentialId?: Buffer; aaguid?: Buffer; signCount?: number } = {},
  ) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    // JWK coordinates are base64url of the 32-byte big-endian field elements.
    this.x = Buffer.from(jwk.x, 'base64url');
    this.y = Buffer.from(jwk.y, 'base64url');
    this.credentialIdBytes =
      opts.credentialId ??
      Buffer.from(sha256(`${this.x.toString('hex')}:cred`).subarray(0, 32));
    this.credentialId = b64url(this.credentialIdBytes);
    // All-zero AAGUID is what a `none`-attestation platform authenticator
    // reports; it deliberately identifies no make or model.
    this.aaguid = opts.aaguid ?? Buffer.alloc(16, 0);
    this.signCount = opts.signCount ?? 0;
  }

  /** The COSE public key bytes, for asserting against what the server stored. */
  cosePublicKey(): Uint8Array {
    return coseKeyFor(this.x, this.y);
  }

  /** `navigator.credentials.create()` — the registration response. */
  register(
    ceremony: RegistrationCeremony,
    overrides: CeremonyOverrides = {},
  ): RegistrationResponseJSON {
    const challenge = overrides.challenge ?? ceremony.challenge;
    const origin = overrides.origin ?? ceremony.origin;
    const rpID = overrides.rpID ?? ceremony.rpID;
    const signCount = overrides.signCount ?? this.signCount;

    const authData = authenticatorData({
      rpID,
      flags: flagsByte({
        userVerified: overrides.userVerified !== false,
        userPresent: overrides.userPresent,
        attested: true,
      }),
      signCount,
      attested: {
        aaguid: this.aaguid,
        credentialId: this.credentialIdBytes,
        coseKey: this.cosePublicKey(),
      },
    });

    // `fmt: 'none'` with an EMPTY attStmt map. The library refuses a `none`
    // attestation that carries any statement at all (`attStmt.size > 0`).
    const attestationObject = isoCBOR.encode(
      new Map<string | number, any>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', new Uint8Array(authData)],
      ]) as any,
    );

    return {
      id: this.credentialId,
      rawId: this.credentialId,
      response: {
        clientDataJSON: b64url(
          Buffer.from(
            clientDataJSON('webauthn.create', challenge, origin),
            'utf8',
          ),
        ),
        attestationObject: b64url(attestationObject),
        transports: ['internal', 'hybrid'],
      },
      clientExtensionResults: {},
      type: 'public-key',
    } as RegistrationResponseJSON;
  }

  /** `navigator.credentials.get()` — the assertion. */
  authenticate(
    ceremony: RegistrationCeremony,
    overrides: CeremonyOverrides & { userHandle?: string } = {},
  ): AuthenticationResponseJSON {
    const challenge = overrides.challenge ?? ceremony.challenge;
    const origin = overrides.origin ?? ceremony.origin;
    const rpID = overrides.rpID ?? ceremony.rpID;
    // A real authenticator increments on every assertion; a synced passkey
    // reports 0 forever. `signCount: 0` on this instance models the latter.
    const signCount =
      overrides.signCount ??
      (this.signCount === 0 ? 0 : (this.signCount = this.signCount + 1));

    const authData = authenticatorData({
      rpID,
      flags: flagsByte({
        userVerified: overrides.userVerified !== false,
        userPresent: overrides.userPresent,
        attested: false,
      }),
      signCount,
    });

    const clientData = Buffer.from(
      clientDataJSON('webauthn.get', challenge, origin),
      'utf8',
    );
    // THE SIGNED BYTES: authenticatorData ‖ SHA-256(clientDataJSON). Nothing
    // else. That is why swapping the origin or the rpID breaks the signature
    // check rather than merely failing a string comparison.
    const signature = createSign('SHA256')
      .update(Buffer.concat([authData, sha256(clientData)]))
      .sign(this.privateKey);

    return {
      id: this.credentialId,
      rawId: this.credentialId,
      response: {
        clientDataJSON: b64url(clientData),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
        ...(overrides.userHandle ? { userHandle: overrides.userHandle } : {}),
      },
      clientExtensionResults: {},
      type: 'public-key',
      authenticatorAttachment: 'platform',
    } as AuthenticationResponseJSON;
  }
}

/** Convenience: a fresh authenticator per test. */
export function softAuthenticator(
  opts?: ConstructorParameters<typeof SoftAuthenticator>[0],
): SoftAuthenticator {
  return new SoftAuthenticator(opts);
}
