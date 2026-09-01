/**
 * Where an installed launch or a deep link should go — as pure data.
 *
 * Mobile design package M01 ("Launch router") lists five outcomes, and §6.4
 * adds the rule that makes the route necessary at all:
 *
 *   > Installed launch routes through `/launch`, not the public marketing
 *   > homepage.
 *
 * Today the web manifest's `start_url` is `/`, so tapping the home-screen
 * icon opens the MARKETING SITE — hero, pricing, "Book a demo" — to an
 * operator who has been running this fleet for months. M01 names that
 * outcome explicitly: "Do not show the marketing homepage after launching
 * the installed application."
 *
 * The decision is separated from the page so it can be tested without a
 * router, a network or a DOM, and so the "safe destination" rule (§6.4:
 * "Deep links preserve the intended destination through login") is enforced
 * in ONE place rather than re-derived per caller.
 */

export type LaunchDecision =
  /**
   * Navigate. `path` is either the deep link the operator asked for or the
   * selected location's Home — one field, so the page has one navigate call
   * and cannot accidentally drop a destination on one branch.
   */
  | { kind: 'go'; path: string }
  /** Authenticated, but no location is selected — M01's chooser. */
  | { kind: 'choose-location' }
  /** Not signed in. `redirect` is the destination to restore afterwards. */
  | { kind: 'sign-in'; redirect: string | null }
  /** Signed in once, but the session is no longer valid. */
  | { kind: 'expired'; redirect: string | null }
  /** The session could not be checked at all — network, not authorization. */
  | { kind: 'offline' };

export interface LaunchInput {
  /** A token exists in this tab/browser. */
  hasToken: boolean;
  /** The tenant slug the session belongs to, when known. */
  slug: string | null | undefined;
  /**
   * The result of asking the server who we are.
   *   'ok'        — session valid
   *   'expired'   — the server answered, and said no (401/403)
   *   'unreachable' — no answer at all (offline, DNS, timeout, 5xx)
   *   'skipped'   — we never asked (no token to ask with)
   */
  verify: 'ok' | 'expired' | 'unreachable' | 'skipped';
  /** `?next=` from the URL — where the operator was actually trying to go. */
  next?: string | null;
}

/**
 * Is `next` a destination we are willing to send someone to after login?
 *
 * Mirrors the login page's own allow-list discipline: same-origin, absolute,
 * single-slash. `//evil.example` is a protocol-relative URL that browsers
 * treat as cross-origin — it is the classic open-redirect payload, and it
 * starts with `/`, so a naive `startsWith('/')` check waves it through.
 */
export function isSafeNext(next: string | null | undefined): next is string {
  if (!next) return false;
  if (!next.startsWith('/')) return false;
  if (next.startsWith('//')) return false;
  if (next.includes('\\')) return false; // some parsers fold \ to /
  return true;
}

export function decideLaunch(input: LaunchInput): LaunchDecision {
  const next = isSafeNext(input.next) ? input.next : null;

  if (!input.hasToken) return { kind: 'sign-in', redirect: next };

  switch (input.verify) {
    case 'expired':
      // The server ANSWERED and refused. Say so, rather than bouncing the
      // operator to a login form with no explanation (M01: "Expired session →
      // explain expiration, then Sign in").
      return { kind: 'expired', redirect: next };
    case 'unreachable':
      // We hold a token and simply could not check it. That is NOT an
      // authorization failure and must never be presented as one — §13
      // ("API unavailable" / "Offline") wants last-known state and a retry,
      // not a sign-out.
      return { kind: 'offline' };
    case 'ok':
    case 'skipped':
    default:
      break;
  }

  // A safe deep link outranks the default home — that IS the destination the
  // operator asked for (§6.4: "Deep links preserve the intended destination
  // through login").
  if (next) return { kind: 'go', path: next };
  if (input.slug) return { kind: 'go', path: `/${input.slug}/dashboard` };
  return { kind: 'choose-location' };
}
