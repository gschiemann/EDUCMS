/**
 * SSO email-domain verification (2026-10-11, launch security re-audit V-2).
 *
 * A tenant's `allowedEmailDomain` decides where the PUBLIC sign-in page sends
 * everyone who types an address at that domain, and which addresses the
 * tenant's IdP may auto-create. Typing a domain proves nothing, so a claim
 * now routes and provisions only once VERIFIED:
 *   - DNS: a TXT record `venueos-verification=<token>` on the domain itself
 *     (the industry-standard proof, same shape Google / Microsoft / Okta use);
 *   - or MANUAL: a SUPER_ADMIN override with a written reason, audited.
 * At most one tenant can hold a verified claim on a domain.
 */
import { randomBytes } from 'crypto';
import { promises as dnsPromises } from 'dns';

export const TXT_PREFIX = 'venueos-verification=';

const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Canonical lower-case domain, or null when it is not a plain DNS domain. */
export function normalizeEmailDomain(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase().replace(/^@/, '').replace(/\.$/, '');
  if (!s) return null;
  return DOMAIN_RE.test(s) ? s : null;
}

export function newDomainVerificationToken(): string {
  return randomBytes(16).toString('hex');
}

export function txtRecordFor(token: string): string {
  return `${TXT_PREFIX}${token}`;
}

export type TxtResolver = (domain: string) => Promise<string[][]>;

/**
 * True when the domain publishes the exact TXT value. A lookup failure
 * (NXDOMAIN, timeout, no TXT records) is "not verified", never an error.
 */
export async function domainHasVerificationRecord(
  domain: string,
  token: string,
  resolver: TxtResolver = (d) => dnsPromises.resolveTxt(d),
  timeoutMs = 5000,
): Promise<boolean> {
  if (!token) return false;
  const want = txtRecordFor(token);
  let timer: NodeJS.Timeout | undefined;
  try {
    const records = await Promise.race([
      resolver(domain),
      new Promise<string[][]>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
    // A TXT record can arrive split into 255-byte chunks — join each record.
    return records.some((chunks) => chunks.join('').trim() === want);
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
