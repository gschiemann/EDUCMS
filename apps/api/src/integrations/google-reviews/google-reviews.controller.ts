/**
 * GoogleReviewsController — the only way the GOOGLE_REVIEWS widget reaches
 * Google. Three routes, all authed, none of which can leak the key.
 *
 *   GET  /api/v1/integrations/google-reviews/status         → { enabled }
 *   POST /api/v1/integrations/google-reviews/places/search  → { candidates }
 *   GET  /api/v1/integrations/google-reviews/reviews?placeId=…
 *
 * ── AUTH MODEL (and why it is NOT the feeds/proxy model) ─────────────────
 * `FeedsController` is deliberately un-guarded because an RSS URL is public
 * content and the player has no session. This is the opposite case: every call
 * spends money on OUR metered Google key, so an anonymous route here would be
 * a free, unauthenticated spend endpoint for the internet. Both surfaces that
 * need it already carry a credential — the builder has an operator session,
 * a wall screen has a paired-device JWT — and `JwtAuthGuard` accepts both. So
 * the guard is on, and the widget's player path sends `Authorization: Bearer
 * <device token>` exactly like `lib/menu/device-menu.ts` does for menus.
 *
 * `places/search` is SESSION-ONLY: it is an operator configuring a widget, and
 * a screen on a wall has no business driving a Text Search against our key.
 * A device token is refused there explicitly rather than by omission.
 *
 * ── RATE LIMITING: TWO WALLS ─────────────────────────────────────────────
 * `@Throttle` is the per-IP/per-device wall every route in this app already
 * has (`ClientIpThrottlerGuard`). On top of it, `google-reviews-cap.ts` adds a
 * PER-TENANT hourly window — the same sliding window the AI surfaces use, with
 * its own key prefix. The reviews cap is charged only on a cache MISS; see
 * that file for why.
 *
 * ── UNSET KEY IS A 200, NOT A 500 ────────────────────────────────────────
 * A deploy with no `GOOGLE_MAPS_API_KEY` is a normal, supported deploy (the
 * geocode proxy has degraded gracefully on exactly this for a year). Every
 * route here answers `{ enabled: false }` with a 200 and an empty payload, so
 * the widget can say "ask your admin" instead of rendering an error, and so a
 * missing key can never look like an outage.
 */

import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RedisService } from '../../realtime/redis.service';
import {
  GoogleReviewsProviderError,
  GoogleReviewsService,
  type GoogleReviewCandidate,
  type GoogleReviewsPayload,
} from './google-reviews.service';
import {
  reviewsFetchHourlyCap,
  reviewsFetchRecordEvent,
  reviewsFetchWindowCount,
  reviewsSearchHourlyCap,
  reviewsSearchRecordEvent,
  reviewsSearchWindowCount,
} from './google-reviews-cap';
import { getCachedReviews } from './google-reviews-cache';

interface ReviewsResponse {
  enabled: boolean;
  place: GoogleReviewsPayload['place'] | null;
  reviews: GoogleReviewsPayload['reviews'];
  fetchedAt: string | null;
  /** True when these bytes came from the 6-hour cache rather than Google. */
  cached: boolean;
}

// NOTE: this app has NO global prefix — every controller bakes in `api/v1`
// itself (enforced by `controller-prefix.spec.ts`).
@Controller('api/v1/integrations/google-reviews')
@UseGuards(JwtAuthGuard)
export class GoogleReviewsController {
  constructor(
    private readonly reviews: GoogleReviewsService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Is the integration usable on this deploy? The widget and the Apps config
   * form both branch on this so an unconfigured tenant is told what to ask
   * their admin for, instead of watching a search box return nothing forever.
   */
  @Get('status')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  status(): { enabled: boolean } {
    return { enabled: this.reviews.enabled() };
  }

  /**
   * Operator-facing "find my business". Session only — see the class doc.
   */
  @Post('places/search')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async searchPlaces(
    @Request() req: any,
    @Body() body: { query?: string },
  ): Promise<{ enabled: boolean; candidates: GoogleReviewCandidate[] }> {
    const user = req.user || {};
    if (user.kind === 'device' || user.kind === 'api-key') {
      // A wall screen (or a machine credential in a vendor's CI) has no
      // business driving a paid text search against our key.
      throw new ForbiddenException('Place search needs a signed-in operator.');
    }
    if (!this.reviews.enabled()) return { enabled: false, candidates: [] };

    const tenantId = String(user.tenantId || '');
    if (tenantId) {
      const used = await reviewsSearchWindowCount(this.redis.publisher, tenantId);
      if (used >= reviewsSearchHourlyCap()) {
        throw new HttpException(
          {
            code: 'GOOGLE_REVIEWS_SEARCH_CAP',
            message: 'That’s a lot of business searches this hour. Try again shortly.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    try {
      const candidates = await this.reviews.searchPlaces(String(body?.query ?? ''));
      if (tenantId) await reviewsSearchRecordEvent(this.redis.publisher, tenantId);
      return { enabled: true, candidates };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  /**
   * Reviews for one business. Reachable by an operator session AND by a paired
   * screen's device JWT, because the widget renders on both surfaces.
   *
   * `fetchedAt` comes out of the payload, which was stamped at the moment
   * Google was actually called — so a cache hit reports the real age of the
   * data rather than the age of the response. That is the only value anything
   * downstream may build a freshness label from.
   */
  @Get('reviews')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async getReviews(@Request() req: any, @Query('placeId') placeId?: string): Promise<ReviewsResponse> {
    if (!this.reviews.enabled()) {
      return { enabled: false, place: null, reviews: [], fetchedAt: null, cached: false };
    }
    const id = (placeId || '').trim();
    if (!id) {
      throw new HttpException(
        { code: 'GOOGLE_REVIEWS_NO_PLACE', message: 'Pick your business first.' },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Charge the per-tenant cap ONLY when we are about to actually spend. A
    // warm cache is free, and a fleet polling a warm cache must never trip a
    // limit that exists to bound Google spend.
    const tenantId = String(req.user?.tenantId || '');
    if (tenantId) {
      const warm = await getCachedReviews(this.redis.publisher, id);
      if (!warm) {
        const used = await reviewsFetchWindowCount(this.redis.publisher, tenantId);
        if (used >= reviewsFetchHourlyCap()) {
          throw new HttpException(
            {
              code: 'GOOGLE_REVIEWS_FETCH_CAP',
              message: 'Google reviews are refreshing too often for this account. They’ll be back shortly.',
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
      }
    }

    try {
      const { payload, cached } = await this.reviews.getReviews(id);
      if (tenantId && !cached) await reviewsFetchRecordEvent(this.redis.publisher, tenantId);
      return {
        enabled: true,
        place: payload.place,
        reviews: payload.reviews,
        fetchedAt: payload.fetchedAt,
        cached,
      };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  /**
   * Provider failures become a 502 with a PLAIN sentence. The upstream body is
   * never forwarded and never logged: a Google error body can echo the request
   * it is complaining about, and that request carried our key.
   *
   * Everything from the provider maps to 502 — including "no such place". The
   * caller supplied a place id we ourselves handed them from a search, so a
   * 404 here is the integration being wrong about the world, not the client
   * being wrong about the request; one status with a specific sentence is
   * easier to reason about than a status matrix that invites guessing.
   */
  private mapError(err: unknown): HttpException {
    if (err instanceof HttpException) return err;
    if (err instanceof GoogleReviewsProviderError) {
      return new HttpException(
        { code: `GOOGLE_REVIEWS_${err.code}`, message: err.message },
        HttpStatus.BAD_GATEWAY,
      );
    }
    return new HttpException(
      { code: 'GOOGLE_REVIEWS_FAILED', message: 'Could not reach Google reviews right now.' },
      HttpStatus.BAD_GATEWAY,
    );
  }
}
