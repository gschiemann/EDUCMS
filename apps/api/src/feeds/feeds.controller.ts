/**
 * FeedsController — server-side RSS/Atom + iCalendar (ICS) fetch+parse.
 *
 *   GET /api/v1/feeds/rss?url=<https://...>
 *     → { title, items: [{ title, link, publishedAt, source }], cached }
 *   GET /api/v1/feeds/ics?url=<https://...>
 *     → { events: [{ title, start, end, location, allDay }], cached, meta }
 *
 * AUTH MODEL — deliberately the SAME as `ProxyController`'s `/proxy/web`,
 * NOT the JWT+RBAC model used by `DataSourceController`:
 *
 *   RSS_FEED / CALENDAR widgets render on TWO surfaces — the authed
 *   dashboard (builder preview) AND the unauthed player (a kiosk/LED board
 *   running a device token, not a user JWT, or an iframe/board route with
 *   no auth context at all). `DataSourceController`'s custom-data fetch is
 *   only ever called from the BUILDER (an authenticated operator wiring up
 *   a data source at configuration time) — feeds are fetched at RENDER
 *   TIME by the widget itself, which the player cannot do with a JWT.
 *   Gating this route behind JwtAuthGuard would 401 every player render.
 *
 *   So, like `/proxy/web`: NO guard, a per-IP `@Throttle` wall (NestJS's
 *   Redis-backed ThrottlerModule — see app.module.ts), the SSRF-safe
 *   `safeFetch` gate, and a per-upstream-host + global rate limiter
 *   (`FeedsRateLimiter`) as a second wall. There is no tenant/user identity
 *   to scope by on this route by design — the URL itself is the only input,
 *   exactly like the web proxy.
 *
 * AuditLog: deliberately NOT written per fetch. This is a read-only,
 * high-volume, cacheable GET (every screen showing a feed polls it every
 * few minutes) — logging every poll would flood the audit log with zero
 * forensic value (nothing privileged happens; the URL is public content
 * the operator already configured in the widget). This matches how
 * `/proxy/web` — the closest analog, another public un-authed fetch proxy
 * — has never written an AuditLog row either. Contrast with
 * `DataSourceController`, which DOES audit-log every call because it's a
 * privileged, tenant-scoped, low-volume, operator-initiated configuration
 * action, not a render-time poll.
 */

import { Controller, Get, Query, HttpException, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FeedsService, SsrfError, FetchTooLargeError, FeedParseError, IcsParseError } from './feeds.service';
import { FeedsRateLimiter } from './feeds-rate-limiter';

@Controller('api/v1/feeds')
export class FeedsController {
  constructor(
    private readonly feeds: FeedsService,
    private readonly rateLimiter: FeedsRateLimiter,
  ) {}

  @Get('rss')
  // Per-IP wall, same shape/generosity as /proxy/web (60/min) — a single
  // screen polling its own feed every 5 min is nowhere near this; it exists
  // to cap scripted abuse hitting our API directly.
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  async rss(@Query('url') url?: string) {
    const validated = this.validateUrl(url);
    try {
      this.rateLimiter.check(validated.host);
      return await this.feeds.getRssFeed(validated.url);
    } catch (err) {
      throw this.mapError(err);
    }
  }

  @Get('ics')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  async ics(@Query('url') url?: string) {
    const validated = this.validateUrl(url);
    try {
      this.rateLimiter.check(validated.host);
      return await this.feeds.getIcsFeed(validated.url);
    } catch (err) {
      throw this.mapError(err);
    }
  }

  private validateUrl(url: string | undefined): { url: string; host: string } {
    if (!url) {
      throw new HttpException(
        { message: 'Missing url parameter', code: 'FEEDS_MISSING_URL' },
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      return this.feeds.normalizeUrl(url);
    } catch {
      throw new HttpException(
        { message: 'Invalid feed URL', code: 'FEEDS_INVALID_URL' },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /** Mirrors DataSourceController's error-mapping style: SSRF rejections
   *  never echo the resolved IP or upstream body back to the caller. */
  private mapError(err: unknown): HttpException {
    if (err instanceof HttpException) return err; // already shaped (rate limiter)
    if (err instanceof SsrfError) {
      return new HttpException(
        { message: 'That feed URL could not be reached (blocked destination).', code: 'FEEDS_SSRF' },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (err instanceof FetchTooLargeError) {
      return new HttpException(
        { message: 'That feed is too large to display.', code: 'FEEDS_TOO_LARGE' },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    if (err instanceof FeedParseError || err instanceof IcsParseError) {
      return new HttpException(
        { message: err.message, code: 'FEEDS_PARSE_FAILED' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const message = err instanceof Error ? err.message : 'Could not fetch that feed';
    return new HttpException(
      { message: `Could not fetch that feed: ${message}`, code: 'FEEDS_FETCH_FAILED' },
      HttpStatus.BAD_GATEWAY,
    );
  }
}
