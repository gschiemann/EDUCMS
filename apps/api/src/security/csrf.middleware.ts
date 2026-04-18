import { Injectable, NestMiddleware, Logger, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomBytes, timingSafeEqual } from 'crypto';

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
  (p) => /^\/api\/v1\/tenants\/me\/usb-ingest\/screens\/[^/]+\/event$/.test(p),
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

  // Cached per-instance; re-reads .env are unnecessary at runtime.
  private readonly enforce = process.env.CSRF_ENFORCE === 'true';

  use(req: Request, res: Response, next: NextFunction) {
    // Always make sure a browser has a csrf-token cookie. First-touch GET
    // establishes it; subsequent mutations from that origin can match it.
    if (!req.cookies?.[CSRF_COOKIE_NAME]) {
      const token = mintCsrfToken();
      issueCookie(res, token);
      (req as any).csrfToken = token;
    }

    if (isCsrfExempt(req.method, req.path)) {
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
      ip: req.ip,
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
        note: 'CSRF_ENFORCE is not true — request allowed. Set CSRF_ENFORCE=true in production to enforce.',
      }),
    );
    return next();
  }
}
