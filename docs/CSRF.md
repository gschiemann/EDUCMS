# CSRF Protection

Double-submit cookie pattern. Mutations must carry an `X-CSRF-Token` header
whose value matches the `csrf-token` cookie the API minted for the client.

## How it works

1. Client calls `GET /api/v1/security/csrf` on first mutation.
2. API mints a random 32-byte token, sets it as `csrf-token` cookie (HttpOnly=false),
   and echoes the value in the JSON body.
3. Client caches the body value and sends it in `X-CSRF-Token` on every mutation.
4. Browser sends the cookie automatically because `credentials: 'include'` is set.
5. `CsrfMiddleware` (timing-safe compare) rejects mismatches with `403 CsrfError`
   when `CSRF_ENFORCE=true`. Otherwise it logs `CSRF_WOULD_BLOCK` and passes.

## Enforcement modes

| `CSRF_ENFORCE` | Behavior                                                    |
| -------------- | ----------------------------------------------------------- |
| `true`         | Strict — bad token returns 403 with `{ error: 'CsrfError'}` |
| (anything else) | Warn — logs would-block events, allows request             |

Warn mode is the default. It lets us roll out the middleware without breaking
flows that haven't yet been migrated to send the header.

## Exempt paths

Kept small and audited in `csrf.middleware.ts`:

- `GET`, `HEAD`, `OPTIONS` (safe methods)
- `POST /api/v1/auth/login` — initial handshake, no prior session
- `/api/v1/health/*` — health probes
- `GET /api/v1/security/csrf` — the mint endpoint

## Web client

`apiFetch()` in `apps/web/src/lib/api-client.ts` auto-attaches the header for
all non-safe methods, retries once on `403 CsrfError` after invalidating its
cache, and forces `credentials: 'include'` so the cookie roundtrips.

## Known gaps (flip to strict only after these land)

1. **Direct `fetch()` calls bypassing `apiFetch()`** — grep for `fetch(` under
   `apps/web/src` and route them through `apiFetch`, or inline
   `ensureCsrfToken()` + `credentials: 'include'`.
2. **Next.js server actions** (`apps/web/src/actions/*`) run server-to-server
   and have no browser cookies. Options: (a) mint/retain the token per request
   inside the action, (b) exempt via a shared `X-Service-Key` header bound to
   the Next.js server. Not yet decided.
3. **Playwright tests** need an initial `GET /api/v1/security/csrf` in the
   fixture to prime the cookie before mutations.

## Flipping to strict

1. Fix the three known gaps above.
2. Deploy with `CSRF_ENFORCE=true`.
3. Watch Sentry + API logs for `CSRF_BLOCK` events. Any block on a legitimate
   flow is a bug — fix the client, not the middleware.
