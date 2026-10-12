/**
 * The API's own public origin, for OAuth `redirect_uri`s and webhook
 * notification URLs (2026-10-11, launch security re-audit H-5).
 *
 * `PUBLIC_API_BASE_URL` is the answer. Before this, every caller fell back to
 * the request's `Host` / `X-Forwarded-Host` header when it was unset — a value
 * the CLIENT chooses, which then became the redirect target an identity
 * provider sends a code to. In production that fallback is gone: an unset
 * variable is a configuration error, answered 503 with a named code, never a
 * host taken from the request. Dev and test keep the header fallback so a
 * local stack needs no extra config.
 */
import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request } from 'express';

const log = new Logger('PublicApiBase');
let warned = false;

export function publicApiBase(req: Request): string {
  const envUrl = (process.env.PUBLIC_API_BASE_URL || '').trim();
  if (envUrl) return envUrl.replace(/\/+$/, '');
  if (process.env.NODE_ENV === 'production') {
    if (!warned) {
      warned = true;
      log.error('PUBLIC_API_BASE_URL is not set — OAuth redirect URIs refuse to derive from the Host header in production');
    }
    throw new HttpException(
      { code: 'PUBLIC_API_BASE_URL_NOT_CONFIGURED', message: 'This sign-in or connection is not configured on this server.' },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host;
  return `${proto}://${host}`;
}
