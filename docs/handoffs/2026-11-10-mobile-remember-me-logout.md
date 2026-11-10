# Mobile "Keep me logged in" does not survive leaving the browser — investigation (2026-11-10)

Status: **root cause not yet proven**; narrowed to two candidates. No code changed. Owner report: on iPhone, "Remember me" ticked, but after switching apps and returning the login page is back, every time.

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

## Next step

Read the Vercel logs to pick the candidate, then fix on a branch of its own (auth is a consequential change: owner's go, different-vendor review, the whole API suite before the push, WebKit before "done").

Models: Claude Fable 5.2 (Anthropic, Claude Code on the web) — code investigation by a read-only sub-agent, production evidence by the lead session.
