/**
 * stream-ticket.ts — short-lived, single-purpose SSE stream tickets
 * (finding DT-08, 2026-08-03).
 *
 * THE PROBLEM. `GET /api/v1/realtime/sse?token=<device JWT>` puts a
 * 180-day fleet credential into a URL. URLs land in Railway/Vercel HTTP
 * access logs, in on-path proxy logs, and in Android WebView history —
 * none of which are treated as credential stores. Whoever can read those
 * logs holds device credentials for the whole fleet.
 *
 * WHY NOT "just use a header". `EventSource` cannot set request headers.
 * That constraint is real and is why the token ended up in the query
 * string in the first place. The correct answer is not to move the same
 * credential somewhere else — it is to STOP PUTTING THE LONG-LIVED
 * CREDENTIAL IN THE URL AT ALL and put a bearer-ticket there instead:
 *
 *   1. The player POSTs `/api/v1/screens/:id/stream-ticket` with its
 *      device token in the `Authorization` header (a normal fetch — no
 *      EventSource limitation applies), and gets back an opaque ticket.
 *   2. The player opens `…/sse?ticket=<ticket>`.
 *
 * The ticket is:
 *   • short-lived   — 60 s, so a log line is stale before anyone reads it;
 *   • single-scope  — it names exactly one screenId and grants nothing but
 *                     "open the event stream for that screen";
 *   • stateless     — an HMAC over (screenId, epoch, nonce, expiry) keyed
 *                     on DEVICE_SECRET_KEY, so it needs no Redis round
 *                     trip and works on every replica;
 *   • epoch-bound   — it carries the screen's `credentialEpoch`, so
 *                     revoking a screen's credential also invalidates any
 *                     ticket already minted for it.
 *
 * INTEGRATION STATUS (updated 2026-08-03).
 * WIRED. `apps/api/src/realtime/sse.controller.ts` accepts `?ticket=`,
 * re-reads the live `Screen` row, refuses a REVOKED screen and requires the
 * ticket's epoch to EQUAL the row's current `credentialEpoch` (strict — no
 * rotation grace window; a 60-second ticket is cheap to re-mint, and the
 * grace window would otherwise outlive a revocation).
 *
 * The controller still ALSO accepts the legacy `?token=<deviceJwt>` leg,
 * because `apps/web`'s player has no code that mints a ticket yet and
 * removing the leg would take its SSE tier offline. See the header of
 * `sse.controller.ts` for exactly what `apps/web` must change before that
 * leg can be deleted.
 */

import * as crypto from 'crypto';
import { requireSecret } from '../security/required-secret';

/** Ticket validity. Long enough to survive a slow kiosk, short enough to be worthless in a log. */
export const STREAM_TICKET_TTL_MS = 60_000;

const TICKET_VERSION = 'st1';

function ticketSecret(): string {
  return requireSecret('DEVICE_SECRET_KEY', { devFallback: 'dev_only_device_secret_CHANGE_ME' });
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', ticketSecret()).update(payload).digest('base64url');
}

/**
 * Mint a stream ticket. Caller MUST have already device-authenticated the
 * request (see `verifyDeviceForScreen`) — this function performs no
 * authorization of its own.
 */
export function mintStreamTicket(screenId: string, credentialEpoch: number, now = Date.now()): {
  ticket: string;
  expiresAt: number;
} {
  const expiresAt = now + STREAM_TICKET_TTL_MS;
  const nonce = crypto.randomBytes(9).toString('base64url');
  const body = `${TICKET_VERSION}.${screenId}.${credentialEpoch}.${expiresAt}.${nonce}`;
  return { ticket: `${body}.${sign(body)}`, expiresAt };
}

export type StreamTicketResult =
  | { ok: true; screenId: string; credentialEpoch: number; expiresAt: number }
  | { ok: false; reason: string };

/**
 * Verify a stream ticket. Returns the screenId + the epoch it was minted
 * against; the caller compares that epoch to the live `Screen` row so a
 * revoked credential also kills tickets already in flight.
 */
export function verifyStreamTicket(ticket: unknown, now = Date.now()): StreamTicketResult {
  if (typeof ticket !== 'string' || ticket.length === 0 || ticket.length > 512) {
    return { ok: false, reason: 'ticket_malformed' };
  }
  const parts = ticket.split('.');
  if (parts.length !== 6) return { ok: false, reason: 'ticket_malformed' };
  const [version, screenId, epochStr, expStr, nonce, sig] = parts;
  if (version !== TICKET_VERSION) return { ok: false, reason: 'ticket_version' };

  const body = `${version}.${screenId}.${epochStr}.${expStr}.${nonce}`;
  const expected = sign(body);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'ticket_signature' };
  }

  const expiresAt = Number(expStr);
  if (!Number.isFinite(expiresAt)) return { ok: false, reason: 'ticket_malformed' };
  if (now >= expiresAt) return { ok: false, reason: 'ticket_expired' };

  const credentialEpoch = Number(epochStr);
  if (!Number.isFinite(credentialEpoch)) return { ok: false, reason: 'ticket_malformed' };

  return { ok: true, screenId, credentialEpoch, expiresAt };
}
