# Mobile "Keep me logged in" does not survive leaving the browser — investigation (2026-11-10)

Status: **root cause not proven**; narrowed to two candidates, and a fix that covers both is on this branch (below). Owner report: on iPhone, "Remember me" ticked, but after switching apps and returning the login page is back, every time.

## What production shows (read-only, `audit_logs` + `session_refresh_tokens`)

- The owner signed in from iPhone Safari five times on 2026-11-10 between 17:27 and 19:06 UTC (password, then passkey as the second step), and about twenty times on 2026-11-09 00:13–04:59 UTC, often minutes apart.
- Each of the five sign-ins on 2026-11-10 minted a remembered-session refresh token: 5 rows, 5 families, generation 0, **`used_at` null on all five, none revoked**. So `/api/session/adopt` → `/auth/session/issue` works (the shared-secret / `API_URL` misconfiguration theory is ruled out for these sign-ins).
- No `AUTH_SESSION_COOKIE_REFRESH` and no `AUTH_SESSION_REFRESH_REUSE` row for those families. The API never saw any of those five cookies come back.
- A different family (desktop) rotated normally through generation 27 between 2026-11-02 and 2026-11-09. The mechanism works somewhere.
- Signed out again within 11 minutes (18:28 → 18:39 UTC) while the 1 h access token was still valid, so the tab's `sessionStorage` was gone: a new browsing context (new tab, or a home-screen web app relaunch), not a reload of the same tab.

## The two candidates left

1. **The cookie is minted but never stored.** `completeLogin` (`apps/web/src/app/login/page.tsx`) calls `adoptRememberedSession` un-awaited and navigates on. If the document is torn down before the response's `Set-Cookie` is applied, the server has a token and the browser has nothing; `login()` has already set the `edu_cms_remember` marker, so the next cold start asks `/api/session/refresh`, gets `no-cookie` 401, clears the marker and lands on `/login`. Matches "issued, never used". Not proven: no hard navigation was found on the path after login.
2. **The cookie is stored but the browser never asks.** Requires the `edu_cms_remember` marker to be missing at cold start (cleared, or a different storage partition than the one that signed in).

**The evidence that decides it:** Vercel runtime logs for `POST /api/session/refresh` from the iPhone after a sign-in. `401 no-cookie` → candidate 1. No request at all → candidate 2. The Vercel connection in this session lacked the team grant when this was written.

## Defects found in code regardless of which candidate it is

(From the read-only code investigation; each verified in code, frequency in production not measured.)

- `apps/web/src/app/api/session/refresh/route.ts`: the comment says only a 401/403 from the API clears the cookie; the code clears it on **any** non-503 failure (429, 500, 502, 504). A transient API error during a deploy overlap signs a remembered user out for good.
- The server-to-server hop does not forward the client address (`bffForwardHeaders`), so the API's throttle keys every user's `/auth/session/refresh` (20/min) and `/auth/session/issue` (10/min) on Vercel's egress address.
- `adoptRememberedSession` swallows every failure; "remembered" silently becomes a one-hour, per-tab session with nothing shown or logged.
- `session-refresh.service.ts`: single-use rotation with no grace window. A response lost after the server rotated (page suspended mid-request) makes the next attempt a replay and revokes the family. One `AUTH_SESSION_REFRESH_REUSE` row exists (2026-11-05).
- A passkey used on the first step ignores the checkbox: it follows a per-account choice kept in `localStorage` (`keep-signed-in.ts`), default off.
- `/panic` (the panic home-screen app's `start_url`) redirects to `/login` on a missing token or a 401 without waiting for, or trying, the cookie restore. `app/dashboard/page.tsx` and the legacy `app/screens`, `app/schedules`, `app/assets` pages do the same.
- No test exercises the real adopt → cookie → refresh round trip; the mobile e2e mocks `/api/session/refresh`.
- `docs/CUSTOMER_PILOT_GUIDE.md` says a session lasts "up to 8 hours of idle time"; the code has no idle rule (30 days from sign-in when remembered).

## Ruled out

- A third-party-cookie / ITP block on the auth cookie: it is first-party on the web origin, `SameSite=Lax`, host-only, path `/api/session`.
- An idle timer or a visibility / focus sign-out: none exists in the dashboard auth code.

## What the logs could and could not say

Vercel runtime logs hold only requests that wrote a log line, and the session routes wrote none, so they could not pick the candidate. Railway shows nothing either (a `no-cookie` answer never reaches the API). The fix below therefore covers both candidates and makes the routes log one line per outcome, so the next occurrence is answerable from the Vercel log (`[session] refresh outcome=no-cookie` versus no line at all).

## The fix on this branch (web only; no API, schema or environment change)

- **The marker can no longer disagree with the cookie.** `/api/session/adopt` and `/api/session/refresh` set a second, readable cookie `venueos_rm=1` (path `/`, same lifetime, not a credential) in the same response as the HttpOnly `venueos_rt`, and every response that clears one clears both (`session-bff.ts` `setSessionCookies` / `clearSessionCookies`). `hasRememberMarker()` and the store's cold-start check read it, with the old `localStorage` flag as a second source. Covers candidate 2.
- **The cookie gets time to land.** `adoptRememberedSession` is sent with `keepalive`, and `completeLogin` waits for it — at most 4 s (`ADOPT_WAIT_MS`) — before it leaves the sign-in page. Covers candidate 1.
- **Only the API's decision clears the cookie.** `/api/session/refresh` clears on 401 / 403 only; 429, 5xx and an unreadable 200 answer 503 with the cookie kept.
- **The sign-in page stops asking someone who is already signed in.** When a session is present that the page did not just create (restored from the cookie), it goes to the dashboard, honouring `redirect` only inside that person's own organisation or `/panic`.
- **One log line per outcome** (`logSessionOutcome`): the outcome word and the upstream status; never a token, cookie value, address or user id.

Tests: `src/app/api/session/__tests__/session-routes.test.ts` (the real handlers — new), `session-client.test.ts` (marker cookie, `keepalive`), `sign-in-steps.test.tsx` (the wait, the already-signed-in redirect). Web unit suite: 10,057 tests pass; one file (`mp4-inspect.test.ts`) did not load because its worker was killed in this container — unrelated.

**Unverified:** on a real iPhone, and in WebKit end to end against a real API. The claim "this fixes the owner's phone" stands only when the owner signs in once after the deploy, leaves the browser, comes back and is still signed in — and, if not, the Vercel log now says why.

## Left open (not in this change)

- The throttle keyed on Vercel's egress address; no grace window on rotation; a first-step passkey ignoring the checkbox; `/panic` and the legacy `/dashboard`, `/screens`, `/schedules`, `/assets` pages redirecting without trying the restore; the "8 hours idle" line in `docs/CUSTOMER_PILOT_GUIDE.md`.
- Seen in the same Vercel log, unrelated to sign-in: content-security-policy reports for `connect-src` blocking Supabase storage URLs from the dashboard assets page (signed uploads) and from `sw-player.js`. Not investigated: whether the policy is enforcing or report-only decides whether uploads are affected.

Models: Claude Fable 5.2 (Anthropic, Claude Code on the web) — code investigation by a read-only sub-agent, production evidence by the lead session.
