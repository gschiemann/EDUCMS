# CSRF Protection

Double-submit cookie pattern. Mutations must carry an `X-CSRF-Token` header
whose value matches the `csrf-token` cookie the API minted for the client.

**Enforcement is ON by default.** A bad or missing token returns `403 CsrfError`
unless you explicitly opt out. See [Enforcement modes](#enforcement-modes).

Everything below is code in `apps/api/src/security/csrf.middleware.ts`, mounted
on `forRoutes('*')` ahead of `AnomalyMiddleware` so blocked requests don't skew
anomaly stats (`apps/api/src/app.module.ts:336-338`).

## How it works

1. Every request that arrives without a `csrf-token` cookie gets one minted and
   set (`csrf.middleware.ts:277-281`) — so a first-touch `GET` establishes it.
   The cookie is `httpOnly: false` (page JS must read it back), 2-hour max-age,
   and in production `secure: true` + `SameSite=None` (`csrf.middleware.ts:242-250`).
2. `GET /api/v1/security/csrf` echoes that value in a JSON body: the
   just-minted token, else the existing cookie, else `''`
   (`csrf.controller.ts:8-11`).
3. Client caches the body value and sends it in `X-CSRF-Token` on every mutation.
4. Browser sends the cookie automatically because `credentials: 'include'` is set.
5. `CsrfMiddleware` compares cookie and header with `timingSafeEqual`
   (`csrf.middleware.ts:314-318`). A match calls `next()`. **A mismatch, a
   missing cookie, or a missing header is rejected with `403 { error:
   'CsrfError' }`** (`csrf.middleware.ts:336-342`) — unless the request took one
   of the two escapes below (exempt path, Bearer header), or the deploy is in
   warn mode.

The path the exempt check runs against is `req.originalUrl` (query stripped),
not `req.path` — under some Nest mount modes `req.path` loses the `/api/v1`
prefix, which would make every exemption silently stop matching
(`csrf.middleware.ts:282-289`). Note the log line reports `req.path`
(`csrf.middleware.ts:333`), so under such a mount the logged path and the
matched path can differ.

## Enforcement modes

Computed once per middleware instance at construction
(`csrf.middleware.ts:270-272`), so a change requires an API restart, not just
an env edit.

| Env                    | Behavior                                             |
| ---------------------- | ---------------------------------------------------- |
| *(both unset)*         | **Enforced** — bad token returns 403 `CsrfError`      |
| `CSRF_ENFORCE=false`   | Warn — logs `CSRF_WOULD_BLOCK`, allows the request    |
| `CSRF_WARN=true`       | Warn — alias for the above                            |
| anything else          | **Enforced** (a typo'd value fails closed)            |

Enforce became the default in `7b7d7b69` (sec-fix wave1 #7). Before that, a
forgotten env var in any new environment silently disabled CSRF on every
mutation. `CLAUDE.md:115-116` and `.env.example:234-241` carry the same rule.

## The Bearer bypass

A request carrying `Authorization: Bearer <token>` skips the cookie/header
check entirely (`csrf.middleware.ts:305-308`). This is not a gap — CSRF's
threat model is *ambient* credentials (cookies, HTTP basic, client certs), and
a browser never attaches a Bearer header to a cross-site request on its own.

It is also load-bearing for this deploy shape: the web origin (Vercel) and the
API (Railway) are different sites, so the `csrf-token` cookie is third-party
and gets dropped by Safari ITP and Chrome's third-party-cookie phaseout. Before
the bypass landed (`ef3fde75`) that surfaced in production as *every mutation
403s*. Cookie-session flows still get full enforcement.

## Exempt paths

`GET`, `HEAD` and `OPTIONS` are always exempt (`csrf.middleware.ts:234`). Beyond
that, `EXEMPT_PATHS` holds 35 path predicates (`csrf.middleware.ts:18-231`) —
that array is the list of record, and each entry carries its own justification
comment. The classes:

- **Pre-session auth + onboarding** — the caller has no session, so there is no
  cookie to round-trip: `/auth/login`, `/signup`, `/password-reset/request`,
  `/password-reset/complete`, `/invites/:token/accept`.
- **Pre-session MFA** (`csrf.middleware.ts:49-51`) — `/auth/mfa/challenge`,
  `/auth/mfa/required/enroll`, `/auth/mfa/required/verify`. ⚠️ These were missed
  when MFA landed and it was a real **lockout**, measured against production: a
  privileged user got `mfaRequired` from the exempt `/auth/login`, then a 403
  `CsrfError` from `/required/enroll` — blocked at login and unable to enroll.
  Authenticity here is the short-lived signed `mfaToken` in the body, which a
  browser never attaches automatically. The **session-gated** MFA routes
  (`/auth/mfa/enroll`, `/verify`, `/disable`) are deliberately NOT exempt and
  a test asserts it (`csrf.middleware.spec.ts:56-58`).
- **Durable session (SEC-010)** — `/auth/session/refresh`, `/auth/session/revoke`.
  Called server-to-server by the web origin's own route handlers, over a
  connection with no cookie jar. `/auth/session/issue` is NOT listed: it is
  Bearer-authenticated and takes the bypass above.
- **SSO callbacks** — `/auth/sso/:id/saml/callback`, `/auth/sso/:id/oidc/callback`.
  The IdP POSTs these, not our origin; the SAML assertion signature is the auth.
- **Health + the mint endpoint** — `/health*`, `/security/csrf`.
- **Native player / device endpoints** — Kotlin `HttpURLConnection` has no cookie
  jar, so a token round-trip is impossible: `/devices/pair`, `/screens/register`,
  `/screens/:id/cache-status`, `/screens/:id/display-capabilities`,
  `/screens/:id/stream-ticket`, `/player/update-check`,
  `/player/manager-update-check`, `/screens/status/:id/ota-state`,
  `/screens/status/:id/crash-report`, `/player-logs/:id`, `/notifications/help`,
  `/tenants/me/usb-ingest/screens/:id/event`.
- **Machine-to-machine webhooks** — `/billing/webhook` (Stripe signature) and
  `/pos/webhook/:providerId` (Square HMAC or `X-Webhook-Secret`).
- **Sports ingest + console** — `/sports/board/:id/{feed,cts-snapshot,swim-timing-snapshot,cts-cue-fired}`,
  `/sports/sponsors/:id/impression`, and `/sports/console/:token/(score|clock|segment|timeout|cue)`.
  Each is authenticated by a game-scoped HMAC token verified constant-time. The
  console regex enumerates exactly the mutation allowlist rather than using a
  blanket prefix, so a new controller route cannot silently inherit the exemption.
- **Public branding demo** — `/branding/demo/scrape`.

**The deliberate asymmetry to preserve** (`csrf.middleware.ts:93-97`): the
operator route `/screens/:id/display-control` — which can blank or reboot a
physical screen — is NOT exempt. It is a dashboard call with an ambient session,
which is exactly the threat model CSRF exists for. Do not "fix" a 403 there by
adding it to the list.

Every exemption is a real hole if the route's own auth is weak — but the
recurring failure here has been the opposite one. At least six exemptions were
added *after* the route shipped un-exempted and 403'd silently in production:
the OTA state/crash endpoints (2026-04-28), `/cts-snapshot` (2026-05-28), the
POS webhooks (2026-06-26), the MFA trio (2026-09-04), plus `/cts-cue-fired` and
`/sports/sponsors/:id/impression` (audit 37-infra R-1/R-2, date not recorded at
the site). The OTA ones 403'd for weeks with no dashboard progress; the MFA one
was a login lockout. So: exempt a machine-to-machine route **together with** its
own auth + rate limit, in the same change as the route itself.

## Web client

`apiFetch()` in `apps/web/src/lib/api-client.ts` attaches the header for all
non-safe methods (`:147`, `:192`), forces `credentials: 'include'` so the cookie
round-trips (`:150`, `:218`), and on a `403` retries once after invalidating its
token cache (`:312-326`). The retry matches `body.code === 'CsrfError'` *or*
`body.error === 'CsrfError'` — the interceptor reshapes errors to `{ error:
true, code, message }`, so the legacy `error === 'CsrfError'` check alone could
never match (`api-client.ts:315-324`).

`ensureCsrfToken()` / `invalidateCsrfToken()` in `apps/web/src/lib/csrf.ts` hold
the single-flight bootstrap against `GET /security/csrf`.

## Opting out for debugging

Warn mode is a diagnostic tool, not a deploy state. Use it when a legitimate
flow is 403'ing and you need to see the whole request reach its controller:

1. Set `CSRF_ENFORCE=false` (or `CSRF_WARN=true`) and restart the API — the flag
   is read at construction, so a live env edit does nothing.
2. Reproduce. Every request that *would* have been blocked logs
   `{"event":"CSRF_WOULD_BLOCK","reason":"missing_cookie"|"missing_header"|"mismatch", …}`
   with method, path and client IP (`csrf.middleware.ts:322-334`).
3. `reason` names the fix: `missing_header` means the caller isn't going through
   `apiFetch`; `missing_cookie` usually means a cross-origin request without
   `credentials: 'include'`, or a browser dropping the third-party cookie (the
   caller should use a Bearer token); `mismatch` means a stale cached token.
4. **Unset the var and restart.** Fix the caller, not the middleware — and never
   leave a production deploy in warn mode.

The three gaps that originally gated the default flip are closed. Verified two
ways — a `method: 'POST'|'PUT'|'PATCH'|'DELETE'` grep, and a scan of the window
after every `fetch(` call site in `apps/web/src` — raw mutating `fetch()` calls
now sit only on exempt paths, carry a Bearer header, or target Supabase Storage
directly (`AssetPicker.tsx:150`, `PropertiesPanel.tsx:10276` are signed-URL PUTs
to Supabase, not to this API); the one server action
(`apps/web/src/actions/trigger-emergency.ts`) sends `Authorization: Bearer`; and
no Playwright test issues a bare cookie-session mutation
(`apps/web/tests/cross-browser/prod-smoke.cjs:306` sets a Bearer header
globally).

One loose end that is *not* a CSRF gap: `FitnessAdBannerWidget.tsx:142`
fire-and-forgets a `POST` to `/api/v1/ads/impressions` with no CSRF header and
no Bearer. That route does not exist — `AdsController` declares no
`impressions` handler (`apps/api/src/ads/ads.controller.ts:24`) — so the write
is dead on arrival regardless of CSRF. Fix the endpoint or delete the call;
do not add an exemption for it.
