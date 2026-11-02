/**
 * Self-serve sign-up switch (2026-11-02, owner).
 *
 * The public site is information-only for now: every "Start free trial" /
 * "Create a workspace" link becomes "Request info" (an email to sales), and
 * /signup shows a request-info panel instead of the form.
 *
 * TO TURN SIGN-UP BACK ON: set `NEXT_PUBLIC_SIGNUP_OPEN=1` on the Vercel web
 * project and redeploy (it is baked in at build time, like NEXT_PUBLIC_API_URL).
 * Every link and the form come back exactly as they were. Any other value,
 * or unset, keeps sign-up closed.
 */
import { LEGAL_CONTACTS } from './legal-entity';

export const SIGNUP_OPEN = process.env.NEXT_PUBLIC_SIGNUP_OPEN === '1';

export const REQUEST_INFO_HREF =
  `mailto:${LEGAL_CONTACTS.sales}?subject=${encodeURIComponent('VenueOS — request for information')}`;

/** Where a "get started" call to action points: the sign-up form when open, else the request-info email. */
export function signupHref(query = ''): string {
  return SIGNUP_OPEN ? `/signup${query}` : REQUEST_INFO_HREF;
}
