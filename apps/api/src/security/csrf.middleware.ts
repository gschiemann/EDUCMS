import { Injectable, NestMiddleware, Logger, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomBytes, timingSafeEqual } from 'crypto';
import { clientIpFromRequest } from './client-ip';

export const CSRF_COOKIE_NAME = 'csrf-token';
export const CSRF_HEADER_NAME = 'x-csrf-token';

const TOKEN_BYTES = 32;
const COOKIE_MAX_AGE = 2 * 60 * 60 * 1000; // 2h

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Paths that cannot carry a CSRF token. Keep small and audited.
// Login has no prior session, so no token roundtrip — we rely on rate
// limiting + argon2id cost to mitigate login-CSRF. Revisit once we
// wire the web client to pre-fetch tokens before auth calls.
const EXEMPT_PATHS: Array<(path: string) => boolean> = [
  (p) => p === '/api/v1/auth/login',
  (p) => p.startsWith('/api/v1/health'),
  (p) => p === '/api/v1/security/csrf',
  // Onboarding & auth-extras: requests arrive without any prior session,
  // so there is no CSRF cookie to round-trip. Rate limiting + argon2 cost
  // (+ hashed single-use tokens) mitigate abuse.
  (p) => p === '/api/v1/signup',
  (p) => p === '/api/v1/password-reset/request',
  (p) => p === '/api/v1/password-reset/complete',
  (p) => /^\/api\/v1\/invites\/[^/]+\/accept$/.test(p),
  // MFA step-up + forced enrollment (2026-09-04). SAME CLASS AS /auth/login
  // ABOVE, and they were missed when MFA landed: the caller has NO session
  // yet — that is the whole point — so there is no CSRF cookie to round-trip,
  // and `apps/web/src/app/login/page.tsx` calls all three with a bare `fetch`
  // (no credentials, no header), exactly as it calls /auth/login.
  //
  // THE BUG THIS FIXES, measured against production: a privileged user whose
  // login is held back by the MFA policy got `mfaRequired` from the exempt
  // /auth/login, then a 403 `CsrfError` from /required/enroll — blocked at
  // login and unable to enroll. That is a LOCKOUT, and it is why
  // MFA_REQUIRED_ENFORCE_AFTER could not simply be brought forward. It also
  // means /auth/mfa/challenge has never worked from the browser for an
  // already-enrolled user; nobody hit it because nobody was enrolled yet.
  //
  // Authenticity does not depend on CSRF here: all three are authorized by
  // the short-lived signed `mfaToken` in the BODY, which an attacker cannot
  // obtain cross-site (it is minted only in the response to a correct
  // password) and which a browser never attaches automatically. Same
  // reasoning as the hashed single-use tokens on password-reset/invite
  // accept. Abuse is bounded by @Throttle(10/60s) plus the per-user limiter.
  (p) => p === '/api/v1/auth/mfa/challenge',
  (p) => p === '/api/v1/auth/mfa/required/enroll',
  (p) => p === '/api/v1/auth/mfa/required/verify',
  // SEC-010 (2026-09-05) — durable-session endpoints. NOT browser-reachable
  // paths in the normal deploy: the dashboard calls its OWN origin
  // (`/api/session/*`, Next route handlers) and THOSE call these, server to
  // server, over a connection with no cookie jar.
  //
  // Why exempt, precisely: CSRF defends against a browser attaching a
  // credential IT holds to a request the ATTACKER composed. These two carry
  // no ambient credential at all — the refresh secret is in the BODY, put
  // there by our own server, and there is no session cookie for this origin
  // that could be replayed. Identical argument to /password-reset/complete
  // and the device endpoints above. `/issue` is NOT here: it is
  // Bearer-authenticated and already takes the Bearer bypass below.
  //
  // The browser-facing CSRF boundary for this feature is the WEB route
  // handler, which requires a same-origin `Origin` AND a custom header a
  // cross-site form post cannot set (see apps/web/src/lib/session-bff.ts and
  // its test) — plus `SameSite=Lax` on the cookie itself, which already
  // withholds it from any cross-site POST.
  (p) => p === '/api/v1/auth/session/refresh',
  (p) => p === '/api/v1/auth/session/revoke',
  // SSO callbacks: SAML POSTs come from the IdP, not our origin, so they
  // can't carry a CSRF cookie. Authenticity is established by the SAML
  // assertion signature (verified by passport-saml). Same for OIDC
  // form-post response_mode.
  (p) => /^\/api\/v1\/auth\/sso\/[^/]+\/saml\/callback$/.test(p),
  (p) => /^\/api\/v1\/auth\/sso\/[^/]+\/oidc\/callback$/.test(p),
  // Public device endpoints — no prior session; auth is the pairing code
  // or device fingerprint already pre-bound server-side.
  (p) => p === '/api/v1/devices/pair',
  (p) => p === '/api/v1/screens/register',
  (p) => /^\/api\/v1\/screens\/[^/]+\/cache-status$/.test(p),
  // Display capability report (display-control wave, 2026-08-13). The player
  // reports its read-only DisplayCapabilityProbe verdict from NATIVE KOTLIN
  // (HttpURLConnection — no cookie jar, so no CSRF token round-trip is
  // possible), authenticated by the device credential in an
  // `Authorization: Bearer` header, which a browser cannot attach cross-site
  // automatically. Same argument as /cache-status above and /stream-ticket
  // below. Exempted TOGETHER WITH the endpoint so it cannot repeat the
  // day-one 403 that broke /cts-snapshot (2026-05-28) and the swim-timing
  // ingest (2026-08-10).
  //
  // NOTE the deliberate asymmetry: the OPERATOR action route
  // `/screens/:id/display-control` — which can blank or REBOOT a physical
  // screen — is NOT listed here and stays fully CSRF-gated. It is a
  // dashboard call with an ambient session, which is exactly the threat
  // model CSRF exists for.
  (p) => /^\/api\/v1\/screens\/[^/]+\/display-capabilities$/.test(p),
  // SSE stream-ticket mint (DT-08, 2026-08-03). The player exchanges its
  // device credential — sent in an `Authorization: Bearer` header, which a
  // browser cannot attach cross-site automatically, so CSRF's ambient-cookie
  // threat model does not apply — for a 60-second single-scope ticket, so
  // the long-lived credential stops travelling in the SSE query string
  // (and therefore in HTTP access logs and WebView history). Same argument
  // as /player-logs/:id below. The route is device-authenticated and
  // throttled 60/min; it mints nothing for an unauthenticated caller.
  (p) => /^\/api\/v1\/screens\/[^/]+\/stream-ticket$/.test(p),
  (p) => /^\/api\/v1\/tenants\/me\/usb-ingest\/screens\/[^/]+\/event$/.test(p),
  // Native APK OTA poll — Kotlin HttpURLConnection has no cookie jar,
  // so a CSRF token round-trip is impossible. Previously every
  // OtaUpdateWorker POST got 403'd silently (kiosk logs "update-check
  // returned 403" and returns success per OtaUpdateWorker.kt:83) which
  // meant OTA updates NEVER rolled out, regardless of what tags were
  // published. CSRF's threat model doesn't apply here anyway — the
  // caller is a native app, not a browser with ambient cookies.
  (p) => p === '/api/v1/player/update-check',
  // Manager self-update poll (added 2026-04-28 for Manager v1.0.2).
  // Same Kotlin-no-cookies argument as /update-check above. Without
  // this exemption the new ManagerSelfUpdateWorker would get 403'd
  // forever and never upgrade Manager — which is the entire point
  // of v1.0.2.
  (p) => p === '/api/v1/player/manager-update-check',
  // Native APK OTA state + crash reports — Plan + Server audits
  // (2026-04-28) found these endpoints were SILENTLY 403'ing for
  // weeks because they were never exempted. Result: the dashboard
  // never saw DOWNLOADING / VERIFYING / INSTALLING / ERROR states
  // during installs (the entire reason lastOtaState columns exist).
  // The user's reported "dashboard spins for 5 min then says
  // failed" with no progress visibility was directly caused by
  // this. Same Kotlin-no-cookie argument as /update-check.
  (p) => /^\/api\/v1\/screens\/status\/[^/]+\/ota-state$/.test(p),
  (p) => /^\/api\/v1\/screens\/status\/[^/]+\/crash-report$/.test(p),
  // Public branding demo — no prior session; throttled + never persists.
  (p) => p === '/api/v1/branding/demo/scrape',
  // Android kiosk APK log upload — Kotlin HttpURLConnection has no cookie
  // jar, making a CSRF token round-trip impossible. The endpoint is
  // protected by device JWT (Authorization: Bearer) instead, which is
  // immune to CSRF by definition (browsers cannot attach Bearer headers
  // cross-site automatically). See player-logs.controller.ts.
  (p) => /^\/api\/v1\/player-logs\/[^/]+$/.test(p),
  // Phase D1 — touch builder "request help" action. Public endpoint
  // hit by an unauthenticated kiosk WebView when a visitor taps a
  // help button. No prior session → no CSRF cookie possible. Already
  // hardened via:
  //   - server-side tenant resolution from screenId (client can't
  //     spoof the target tenant)
  //   - 10/min/IP rate limit
  //   - 5-min per-screen dedupe bucket
  // CSRF threat model doesn't apply — the kiosk's WebView making this
  // call IS the legitimate caller; there's no ambient-cookie attack
  // surface to exploit.
  (p) => p === '/api/v1/notifications/help',
  // Stripe billing webhook — Stripe's servers POST here with no
  // cookies and no session, so a CSRF token round-trip is impossible.
  // Authenticity is the Stripe signature, verified against
  // STRIPE_WEBHOOK_SECRET in StripeService.constructWebhookEvent —
  // CSRF's ambient-cookie threat model does not apply.
  (p) => p === '/api/v1/billing/webhook',
  // External live score-feed ingest (Sprint 13 "two clocks" gap). A
  // Sportzcast/Scorebird box, console-reader bridge, or custom integration
  // POSTs live score/clock machine-to-machine — no browser, no session
  // cookie, so a CSRF token round-trip is impossible. Authenticity is the
  // stateless game-scoped HMAC feed token (X-Feed-Token header or ?token=),
  // verified constant-time in SportsBoardController.feed via verifyFeedToken.
  // CSRF's ambient-cookie threat model does not apply — same argument as
  // the Stripe webhook and native-APK OTA endpoints above.
  (p) => /^\/api\/v1\/sports\/board\/[^/]+\/feed$/.test(p),
  // CTS Gen 6 console snapshot ingest (Sprint 13 P0). Same machine-to-
  // machine argument as /feed above — the CtsBridge running on the
  // player APK posts the parsed RS232 stream from the physical console
  // here at ~5 Hz with no browser session. Authenticity is the same
  // HMAC feed-token (verifyFeedToken). Originally missed from the
  // exempt list — every snapshot POST got 403 CsrfError, so the live
  // CTS path was completely broken in production. Added 2026-05-28.
  (p) => /^\/api\/v1\/sports\/board\/[^/]+\/cts-snapshot$/.test(p),
  // CTS SWIM timing-snapshot ingest (Inputs-wave SWIM). Same machine-to-
  // machine argument as /cts-snapshot above — the dashboard's swim-bridge
  // WebSerial page (or a Node serialport fallback at the timing table)
  // POSTs the decoded scoreboard-serial state at ≤4 Hz with the game-
  // scoped HMAC feed token (assertFeedAuth), not an ambient session
  // cookie; the route is rate-limited 40/10s per game in
  // SportsBoardController. Exempted TOGETHER WITH the first consumer so
  // the bridge doesn't repeat the /cts-snapshot day-one bug (that route
  // shipped un-exempted and every snapshot POST 403'd in production
  // until 2026-05-28).
  (p) => /^\/api\/v1\/sports\/board\/[^/]+\/swim-timing-snapshot$/.test(p),
  // CTS celebration-fired forensic write (Sprint 13). The CTS orchestrator
  // on the kiosk player POSTs here fire-and-forget when it fires a cue —
  // no browser session, so a CSRF token round-trip is impossible. The
  // route is per-game rate-limited (40/10s) in SportsBoardController and
  // tenant-scoped via the game id. Same machine-to-machine argument as
  // /feed and /cts-snapshot. (Audit 37-infra R-2 — was 403'ing in enforce
  // mode, silently dropping proof-of-play forensic rows.)
  (p) => /^\/api\/v1\/sports\/board\/[^/]+\/cts-cue-fired$/.test(p),
  // Public sponsor proof-of-play impression beacon (Sprint 13 Phase 2).
  // The stadium board / ribbon / scorebug pages fire this from the kiosk
  // WebView each time a sponsor look enters view — no dashboard session,
  // so they send no CSRF cookie/header and (under enforce mode) every
  // cross-origin POST was 403'ing, leaving SponsorImpression empty and
  // gameReport all-zeros. Hardened instead via a per-game in-memory rate
  // limit in SponsorsController + server-side tenant-match validation in
  // recordImpression. (Audit 37-infra R-1/R-2 — exempt + throttle land
  // TOGETHER so the exemption doesn't open an unthrottled write path.)
  (p) => /^\/api\/v1\/sports\/sponsors\/[^/]+\/impression$/.test(p),
  // Scorekeeper console share-link mutations (Phase-2 Domain SHARE). The
  // /console/<token> pad is a public page a volunteer opens from a link/QR
  // with NO dashboard session — there is no CSRF cookie to round-trip
  // (cross-origin fetch without credentials), and auth is the game-scoped
  // console HMAC capability token IN THE PATH (sports-console-token.ts:
  // versioned + always-expiring + constant-time verified per request), not
  // an ambient cookie — so CSRF's threat model does not apply. Same
  // argument as the sports /feed + /cts-snapshot exemptions above. The
  // regex enumerates EXACTLY the SportsConsoleController mutation
  // allowlist (score|clock|segment|timeout|cue) — never a blanket prefix,
  // so a future route added to the controller does not silently inherit
  // the exemption without showing up here in review.
  (p) => /^\/api\/v1\/sports\/console\/[^/]+\/(score|clock|segment|timeout|cue)$/.test(p),
  // POS inbound webhooks (Square + custom-webhook bring-your-own POS).
  // External POS systems POST catalog/inventory/order events here
  // machine-to-machine — no browser, no session cookie — so a CSRF token
  // round-trip is impossible. Authenticity is each receiver's OWN auth:
  //   - /pos/webhook/square → Square HMAC signature (verifySquareSignature)
  //   - /pos/webhook/{custom-webhook} → X-Webhook-Secret matched to the
  //     PosProviderConnection (any other providerId 404s in-controller).
  // CSRF's ambient-cookie threat model does not apply — same argument as
  // the Stripe/billing webhook and the sports /feed + /cts-snapshot above.
  // Found 2026-06-26 final-beta audit: these routes were NEVER exempted, so
  // EVERY external POS POST got 403 CsrfError before its own auth ran —
  // bricking the only no-credential POS path AND the Square inbound webhook.
  (p) => /^\/api\/v1\/pos\/webhook\/[^/]+$/.test(p),
];

export function isCsrfExempt(method: string, path: string): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return true;
  return EXEMPT_PATHS.some((fn) => fn(path));
}

export function mintCsrfToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

function issueCookie(res: Response, token: string) {
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
}

function safeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  private readonly logger = new Logger('CSRF');

  // sec-fix(wave1) #7: default to ENFORCE. Previously the middleware ran
  // in warn-mode unless CSRF_ENFORCE=true, which meant a forgotten env
  // var in any new environment silently disabled CSRF protection on
  // every mutation. Now:
  //   - CSRF_ENFORCE=false OR CSRF_WARN=true → warn-mode (legacy off-switch)
  //   - anything else (including missing env) → enforced
  // Cached per-instance; re-reads .env are unnecessary at runtime.
  private readonly enforce = !(
    process.env.CSRF_ENFORCE === 'false' || process.env.CSRF_WARN === 'true'
  );

  use(req: Request, res: Response, next: NextFunction) {
    // Always make sure a browser has a csrf-token cookie. First-touch GET
    // establishes it; subsequent mutations from that origin can match it.
    if (!req.cookies?.[CSRF_COOKIE_NAME]) {
      const token = mintCsrfToken();
      issueCookie(res, token);
      (req as any).csrfToken = token;
    }

    // Use originalUrl (stripped of query string) rather than `req.path` —
    // under some Nest middleware mount modes `req.path` can be relative to
    // the middleware's mount point and no longer equal the full
    // `/api/v1/...` prefix, which means the EXEMPT_PATHS list never
    // matches and public endpoints like /screens/register start 403'ing.
    // originalUrl is always the untouched request path from the client.
    const pathForCheck = (req.originalUrl || req.url || req.path || '').split('?')[0];
    if (isCsrfExempt(req.method, pathForCheck)) {
      return next();
    }

    // sec-fix(wave1.1): Requests bearing `Authorization: Bearer <jwt>` are
    // not vulnerable to CSRF. Browsers never attach a Bearer header
    // automatically to cross-site requests — only JS on the same origin
    // that has the token can do so. CSRF's threat model is ambient
    // credentials (cookies, HTTP basic, client certs), not explicit ones.
    //
    // This unblocks cross-origin deployments (Vercel web → Railway API)
    // where the `csrf-token` cookie is third-party and gets dropped by
    // Safari ITP / Chrome third-party-cookie phaseout — which surfaced
    // as "every mutation 403s" on production. Cookie-session flows still
    // get full CSRF enforcement.
    const authHeader = req.headers.authorization;
    if (typeof authHeader === 'string' && /^Bearer\s+\S+/i.test(authHeader)) {
      return next();
    }

    const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
    const headerRaw = req.headers[CSRF_HEADER_NAME];
    const headerToken = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;

    const valid =
      typeof cookieToken === 'string' &&
      typeof headerToken === 'string' &&
      cookieToken.length > 0 &&
      safeEquals(cookieToken, headerToken);

    if (valid) return next();

    const reason = !cookieToken
      ? 'missing_cookie'
      : !headerToken
        ? 'missing_header'
        : 'mismatch';

    const logPayload = {
      event: this.enforce ? 'CSRF_BLOCK' : 'CSRF_WOULD_BLOCK',
      reason,
      method: req.method,
      path: req.path,
      ip: clientIpFromRequest(req),
    };

    if (this.enforce) {
      this.logger.warn(JSON.stringify(logPayload));
      throw new ForbiddenException({
        error: 'CsrfError',
        message: 'Invalid or missing CSRF token',
      });
    }

    this.logger.warn(
      JSON.stringify({
        ...logPayload,
        note: 'CSRF warn-mode is active (CSRF_ENFORCE=false or CSRF_WARN=true). Unset those to enforce — enforce is the default.',
      }),
    );
    return next();
  }
}
