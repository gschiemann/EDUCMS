/**
 * upload-renew-ticket.ts — the capability that lets ONE in-flight direct upload
 * ask for a fresh storage token for ITS OWN object path (2026-09-23).
 *
 * WHY IT EXISTS. Large files go browser → Supabase over the TUS resumable
 * protocol (`/storage/v1/upload/resumable/sign`), authorised by the signed
 * upload token `POST /assets/presign` mints. Supabase re-verifies that token —
 * including its `exp` — on EVERY chunk (tus/lifecycle.ts `onIncomingRequest`),
 * not once at the start the way the single signed PUT does. A 1.5 GB video on
 * hotel Wi-Fi can outlive the token, and every chunk after that fails. So the
 * browser needs a way to get a new token for the SAME path mid-upload.
 *
 * WHY NOT "mint a token for whatever path the client names". Presign only ever
 * mints FRESH uuid paths. A renew endpoint that took a bare path would be a
 * brand-new capability: upload bytes to a client-chosen object. The dangerous
 * case is an object whose Asset row was deleted while a template still embeds
 * its URL BY VALUE (template zone configs store raw URLs) — a contributor could
 * write new content under that old URL and it would appear on screens without
 * ever passing the review queue. The ticket closes that: it is minted BY
 * presign, next to the path it names, and binds
 *
 *   • the tenant and the user who presigned (a colleague cannot renew it),
 *   • the exact storage path (it cannot be pointed at another object),
 *   • an expiry (24 h — the lifetime of a Supabase TUS upload URL; after that
 *     the upload cannot resume anyway).
 *
 * Stateless (an HMAC, no table, works on every replica), same shape as
 * screens/stream-ticket.ts. The key is DERIVED from JWT_SECRET with a fixed
 * label, so a renew ticket and a session JWT can never be confused for one
 * another even though they share a root secret.
 */
import * as crypto from 'crypto';
import { requireSecret } from '../security/required-secret';

/** How long a presign's renew ticket stays usable. Matches Supabase's TUS upload-URL lifetime. */
export const UPLOAD_RENEW_TICKET_TTL_MS = 24 * 60 * 60 * 1000;

const TICKET_VERSION = 'ur1';
const KEY_LABEL = 'venueos:asset-upload-renew-ticket:v1';

function ticketKey(): Buffer {
  const root = requireSecret('JWT_SECRET', {
    devFallback: 'dev_only_jwt_secret_CHANGE_ME_for_upload_tickets',
  });
  return crypto.createHmac('sha256', root).update(KEY_LABEL).digest();
}

function sign(body: string): string {
  return crypto
    .createHmac('sha256', ticketKey())
    .update(body)
    .digest('base64url');
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString('utf8');

export interface UploadRenewSubject {
  tenantId: string;
  userId: string;
  storagePath: string;
}

/** Mint the ticket that presign returns next to the path it just minted. */
export function mintUploadRenewTicket(
  subject: UploadRenewSubject,
  now = Date.now(),
): { ticket: string; expiresAt: number } {
  const expiresAt = now + UPLOAD_RENEW_TICKET_TTL_MS;
  const nonce = crypto.randomBytes(9).toString('base64url');
  const body = [
    TICKET_VERSION,
    b64(subject.tenantId),
    b64(subject.userId),
    b64(subject.storagePath),
    String(expiresAt),
    nonce,
  ].join('.');
  return { ticket: `${body}.${sign(body)}`, expiresAt };
}

export type UploadRenewVerdict =
  | { ok: true; expiresAt: number }
  | {
      ok: false;
      reason:
        | 'malformed'
        | 'version'
        | 'signature'
        | 'expired'
        | 'tenant'
        | 'user'
        | 'path';
    };

/**
 * Verify a ticket against the CALLER (tenant + user from the session, never
 * from the body) and the path the body names. Every mismatch is a refusal;
 * the reason is for logs/tests, not for the client.
 */
export function verifyUploadRenewTicket(
  ticket: unknown,
  expected: UploadRenewSubject,
  now = Date.now(),
): UploadRenewVerdict {
  if (typeof ticket !== 'string' || ticket.length === 0 || ticket.length > 2048)
    return { ok: false, reason: 'malformed' };
  const parts = ticket.split('.');
  if (parts.length !== 7) return { ok: false, reason: 'malformed' };
  const [version, tenant64, user64, path64, expStr, nonce, sig] = parts;
  if (version !== TICKET_VERSION) return { ok: false, reason: 'version' };

  const body = [version, tenant64, user64, path64, expStr, nonce].join('.');
  const want = Buffer.from(sign(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got))
    return { ok: false, reason: 'signature' };

  const expiresAt = Number(expStr);
  if (!Number.isFinite(expiresAt)) return { ok: false, reason: 'malformed' };
  if (now >= expiresAt) return { ok: false, reason: 'expired' };

  let tenantId: string;
  let userId: string;
  let storagePath: string;
  try {
    tenantId = unb64(tenant64);
    userId = unb64(user64);
    storagePath = unb64(path64);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!expected.tenantId || tenantId !== expected.tenantId)
    return { ok: false, reason: 'tenant' };
  if (!expected.userId || userId !== expected.userId)
    return { ok: false, reason: 'user' };
  if (!expected.storagePath || storagePath !== expected.storagePath)
    return { ok: false, reason: 'path' };
  return { ok: true, expiresAt };
}
