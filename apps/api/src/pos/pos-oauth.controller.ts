/**
 * Square OAuth + webhook receiver (2026-05-25).
 * ──────────────────────────────────────────────
 *
 * Three endpoints:
 *
 *   GET  /api/v1/pos/oauth/square/authorize  — JWT-auth; mints CSRF
 *        state, persists it briefly in the tenant row, and returns the
 *        Square authorize URL the front-end redirects the operator to.
 *
 *   GET  /api/v1/pos/oauth/square/callback   — Public; Square redirects
 *        the browser here with ?code=...&state=.... We exchange the
 *        code, persist the encrypted token bag, and redirect the
 *        operator back to /[schoolId]/settings/pos with a status flag.
 *
 *   POST /api/v1/pos/webhook/square          — Public; Square POSTs
 *        catalog / inventory events here. Verifies the HMAC signature,
 *        idempotency-claims the event id, then triggers a delta sync.
 *
 * Why three separate endpoints (vs. wedging everything into pos.controller
 * with @Public() guards) — keeps the JWT-guarded controller's auth model
 * uniform: every method requires a session. Public OAuth + webhook flow
 * lives here so a future audit can see at a glance which endpoints skip
 * auth and exactly why.
 */
import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { PrismaService } from '../prisma/prisma.service';
import { PosService } from './pos.service';
import {
  newOAuthStateToken,
  squareAuthorizeUrl,
  squareExchangeCode,
  verifySquareSignature,
} from './providers/square';

/** Where Square redirects the operator after they approve. Derived from
 *  the public web origin so dev + staging + prod all work without per-
 *  env config beyond the existing WEB_PUBLIC_URL / origin headers. */
function resolveRedirectUri(req: Request): string {
  // Prefer the explicit env var if set; otherwise reconstruct from the
  // incoming Host header (covers dev + Railway's tunnel hostnames).
  const apiBase =
    process.env.PUBLIC_API_BASE_URL ||
    `${req.protocol || 'https'}://${req.headers.host}`;
  return `${apiBase.replace(/\/$/, '')}/api/v1/pos/oauth/square/callback`;
}

function resolveWebReturnUrl(): string {
  return (process.env.WEB_PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');
}

@Controller('api/v1/pos')
export class PosOAuthController {
  private readonly logger = new Logger(PosOAuthController.name);

  // In-memory CSRF state cache. 10-min TTL. Keyed by state token. This
  // does NOT need to persist across pods — a single-node OAuth handshake
  // is the standard pattern, and even on a 2-pod Railway redeploy the
  // worst case is the operator re-clicks "Connect" once.
  private readonly stateCache = new Map<string, { tenantId: string; userId: string; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly svc: PosService,
  ) {}

  // ─── OAuth: kick off ───────────────────────────────────────────────

  @Get('oauth/square/authorize')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async authorize(@Req() req: any) {
    if (!process.env.SQUARE_CLIENT_ID) {
      throw new HttpException(
        'Square OAuth not configured for this deploy. Set SQUARE_CLIENT_ID / SQUARE_CLIENT_SECRET.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    this.gcStateCache();
    const state = newOAuthStateToken();
    this.stateCache.set(state, {
      tenantId: req.user.tenantId,
      userId: req.user.id,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    const redirectUri = resolveRedirectUri(req);
    const url = squareAuthorizeUrl({ state, redirectUri });
    return { url };
  }

  // ─── OAuth: callback ──────────────────────────────────────────────

  @Get('oauth/square/callback')
  async callback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') errorParam?: string,
  ) {
    const webReturn = resolveWebReturnUrl();
    const failRedirect = (reason: string) => {
      const u = new URL(`${webReturn}/connect/square/done`);
      u.searchParams.set('status', 'error');
      u.searchParams.set('reason', reason.slice(0, 200));
      return res.redirect(u.toString());
    };

    if (errorParam) return failRedirect(`square-error:${errorParam}`);
    if (!code || !state) return failRedirect('missing-code-or-state');

    this.gcStateCache();
    const entry = this.stateCache.get(state);
    if (!entry || entry.expiresAt < Date.now()) {
      return failRedirect('expired-state-token');
    }
    this.stateCache.delete(state);

    const redirectUri = resolveRedirectUri(req);
    let tokens;
    try {
      tokens = await squareExchangeCode({ code, redirectUri });
    } catch (err: any) {
      this.logger.warn(`Square token exchange failed: ${err?.message || err}`);
      return failRedirect('token-exchange-failed');
    }

    try {
      const conn = await this.svc.upsertSquareConnection({
        tenantId: entry.tenantId,
        userId: entry.userId,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        merchantId: tokens.merchantId,
        scope: tokens.scope,
      });
      // Fire an initial sync — fire-and-forget so the redirect snaps back fast.
      void this.svc.syncSquare(entry.tenantId, conn, entry.userId).catch((err) => {
        this.logger.warn(`initial Square sync failed: ${err?.message || err}`);
      });

      const u = new URL(`${webReturn}/connect/square/done`);
      u.searchParams.set('status', 'ok');
      return res.redirect(u.toString());
    } catch (err: any) {
      this.logger.error(`Square upsertConnection failed: ${err?.message || err}`);
      return failRedirect('persist-failed');
    }
  }

  // ─── Webhook receiver ─────────────────────────────────────────────

  @Post('webhook/square')
  @HttpCode(200)
  async webhook(
    @Req() req: Request,
    @Headers('x-square-hmacsha256-signature') sigHeader: string | undefined,
    @Headers('x-square-signature') legacySigHeader: string | undefined,
  ) {
    const signingKey = process.env.SQUARE_WEBHOOK_SIG_KEY;
    if (!signingKey) {
      this.logger.warn('Square webhook hit but SQUARE_WEBHOOK_SIG_KEY unset; rejecting');
      throw new HttpException('Webhook signing not configured', HttpStatus.SERVICE_UNAVAILABLE);
    }

    // Body must be the raw bytes Square sent; if a global json middleware
    // already parsed it, fall back to JSON.stringify of req.body which
    // works in practice because Square uses compact JSON. The cleaner
    // solution is a raw-body interceptor, but mirroring the Stripe
    // webhook's existing pattern keeps churn low.
    const rawBody = (req as any).rawBody
      ? Buffer.isBuffer((req as any).rawBody)
        ? (req as any).rawBody.toString('utf8')
        : String((req as any).rawBody)
      : JSON.stringify((req as any).body || {});
    const notificationUrl =
      process.env.PUBLIC_API_BASE_URL
        ? `${process.env.PUBLIC_API_BASE_URL.replace(/\/$/, '')}/api/v1/pos/webhook/square`
        : `${req.protocol || 'https'}://${req.headers.host}/api/v1/pos/webhook/square`;

    // Try SHA256 first (current Square webhook subscriptions API);
    // fall back to SHA1 for legacy subscriptions that still use it.
    const okSha256 = verifySquareSignature({
      signatureHeader: sigHeader,
      notificationUrl,
      body: rawBody,
      signingKey,
      algo: 'sha256',
    });
    const okSha1 =
      !okSha256 &&
      verifySquareSignature({
        signatureHeader: legacySigHeader,
        notificationUrl,
        body: rawBody,
        signingKey,
        algo: 'sha1',
      });
    if (!okSha256 && !okSha1) {
      this.logger.warn('Square webhook signature verification failed');
      throw new HttpException('Invalid signature', HttpStatus.UNAUTHORIZED);
    }

    let evt: any;
    try {
      evt = JSON.parse(rawBody);
    } catch {
      throw new BadRequestException('Body is not valid JSON');
    }
    const eventId = String(evt.event_id || evt.eventId || '');
    const eventType = String(evt.type || evt.event_type || 'unknown');
    const merchantId = String(evt.merchant_id || '');
    if (!eventId || !merchantId) {
      throw new BadRequestException('Missing event_id or merchant_id');
    }

    // Idempotency: first delivery wins, replays no-op.
    const first = await this.svc.claimWebhookEvent('square', eventId, eventType);
    if (!first) {
      this.logger.log(`Square webhook duplicate event_id=${eventId} (ignored)`);
      return { ok: true, deduped: true };
    }

    const conn = await this.svc.findConnectionByMerchantId(merchantId);
    if (!conn) {
      this.logger.warn(`Square webhook for unknown merchant_id=${merchantId}; ignoring`);
      return { ok: true, unknownMerchant: true };
    }

    // Catalog / inventory changes → re-sync the snapshot. We could be
    // smarter (only re-sync the affected item) — initial impl is a
    // full delta to keep the surface honest. Fire-and-forget; Square
    // expects a fast 200.
    if (
      eventType.startsWith('catalog.') ||
      eventType.startsWith('inventory.') ||
      eventType === 'item.updated'
    ) {
      void this.svc
        .syncSquare(conn.tenantId, conn, null)
        .catch((err) =>
          this.logger.warn(`webhook-triggered Square sync failed: ${err?.message || err}`),
        );
    }
    return { ok: true };
  }

  // ─── helpers ───────────────────────────────────────────────────────

  private gcStateCache() {
    const now = Date.now();
    for (const [k, v] of this.stateCache.entries()) {
      if (v.expiresAt < now) this.stateCache.delete(k);
    }
  }
}
