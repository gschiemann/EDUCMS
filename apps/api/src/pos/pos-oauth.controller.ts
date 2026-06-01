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
  Param,
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
import { RedisService } from '../realtime/redis.service';
import { PosService } from './pos.service';
import { MenuService } from './menu.service';
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

/** CSRF state lifetime — the operator has 10 min to complete the Square
 *  approve screen before the nonce is rejected. Used for both the Redis
 *  key TTL and the in-process fallback's expiry stamp. */
const STATE_TTL_MS = 10 * 60 * 1000;
/** Redis key prefix for the per-handshake CSRF state nonce. */
const STATE_REDIS_PREFIX = 'pos:square:oauth_state:';

@Controller('api/v1/pos')
export class PosOAuthController {
  private readonly logger = new Logger(PosOAuthController.name);

  // In-memory CSRF state cache — the FALLBACK store, used only when Redis
  // is unavailable (local dev / Redis-less deploy). On a multi-replica
  // deploy this Map is per-pod, so the OAuth callback can land on a
  // different replica than the one that issued `state` and the CSRF check
  // would intermittently fail. The primary store is therefore Redis
  // (shared across replicas); see putState/takeState below. We mirror the
  // app's Redis-optional convention so a no-Redis deploy still works (worst
  // case on a multi-pod no-Redis deploy: the operator re-clicks "Connect").
  private readonly stateCache = new Map<string, { tenantId: string; userId: string; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly svc: PosService,
    private readonly menu: MenuService,
    private readonly redis: RedisService,
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
    const state = newOAuthStateToken();
    await this.putState(state, {
      tenantId: req.user.tenantId,
      userId: req.user.id,
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

    // CSRF check: the `state` nonce must match one we issued in /authorize
    // and is single-use (read-and-delete). takeState reads from Redis
    // first (shared across replicas) and only falls back to the in-process
    // Map when Redis is unavailable — so on a multi-pod deploy the callback
    // verifies against the issuing handshake regardless of which replica it
    // lands on. Missing / expired / unknown → reject (CSRF semantics intact).
    const entry = await this.takeState(state);
    if (!entry) {
      return failRedirect('expired-state-token');
    }

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

    // Auto-86 (menu-mgmt-at-scale 2026-05-29): an inventory.count.updated
    // event carries `inventory_counts[]` with the variation
    // (catalog_object_id), location_id, and quantity. Flip the per-
    // location MenuLocationOverride availability straight from the
    // payload — no extra Square API call, sub-second latency. The
    // hide-filter in resolveMenuForLocation already drops 86'd items.
    if (eventType === 'inventory.count.updated') {
      const counts: any[] = Array.isArray(evt?.data?.object?.inventory_counts)
        ? evt.data.object.inventory_counts
        : [];
      if (counts.length > 0) {
        void this.menu
          .applySquareInventoryCounts(conn, counts)
          .catch((err) =>
            this.logger.warn(`Square auto-86 failed: ${err?.message || err}`),
          );
      }
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

  // ─── Custom-webhook receiver (bring-your-own POS) ──────────────────
  //
  // The `custom-webhook` provider is the universal escape hatch: any POS
  // / internal system that can POST JSON can push its catalog here. The
  // operator sets a shared secret when they connect (sealed on the
  // PosProviderConnection row) and includes it as `X-Webhook-Secret` on
  // every push. We resolve the connection — and therefore the tenant —
  // ENTIRELY from that secret (constant-time compared); the request body
  // never carries a tenantId and we never trust one if it did.
  //
  // Path matches exactly what the connect wizard tells the operator to
  // POST to (settings/pos/page.tsx): /api/v1/pos/webhook/{provider.id}.
  // The Square receiver above (`webhook/square`, a static route declared
  // first) takes precedence; this param route only ever serves
  // `custom-webhook`. Any other providerId → 404, so this can never
  // shadow or mishandle a real per-provider receiver.
  //
  // Three payload shapes, routed by key (menu-mgmt-at-scale 2026-05-29):
  //   1. { menu: [ { externalId, name, defaultPriceCents|price,
  //        category?, allergens?, tags?, locations?:[{ locationTenantId,
  //        priceCents?, isAvailable?, soldOutUntil?, isHidden? }] } ] }
  //        → design-once catalog + per-location overrides (MenuService).
  //   2. { availability: [ { externalId, available, soldOutUntil?,
  //        locationTenantId? } ] }  (alias: { eightySix: [...] })
  //        → auto-86 only; flips MenuLocationOverride.isAvailable.
  //   3. { items: [ ... ] }  → LEGACY flat PosMenuItem catalog (the
  //        original 2026-05-28 shape). Preserved verbatim for
  //        backward-compat. An `{items}` push whose entries all carry an
  //        explicit `available` and NO `name`/`price` is treated as an
  //        auto-86 push instead (a pure availability ping).
  //
  // Optional `eventId` on any shape enables replay-safe idempotency via
  // ProcessedPosEvent (same dedup the Square receiver uses).
  @Post('webhook/:providerId')
  @HttpCode(200)
  async customWebhook(
    @Param('providerId') providerId: string,
    @Req() req: Request,
    @Headers('x-webhook-secret') secret: string | undefined,
  ) {
    if (providerId !== 'custom-webhook') {
      // Unknown / unsupported provider for the generic receiver.
      throw new HttpException('Unknown webhook provider', HttpStatus.NOT_FOUND);
    }
    if (!secret) {
      throw new HttpException('Missing X-Webhook-Secret header', HttpStatus.UNAUTHORIZED);
    }

    const conn = await this.svc.findCustomWebhookConnectionBySecret(secret);
    if (!conn) {
      // Don't leak whether the secret was wrong vs. the connection
      // missing — both are "we can't authenticate this push."
      this.logger.warn('Custom POS webhook: no connection matched the supplied secret');
      throw new HttpException('Invalid webhook secret', HttpStatus.UNAUTHORIZED);
    }

    const body = (req as any).body;
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Body must be JSON: { "menu": [ ... ] } | { "items": [ ... ] } | { "availability": [ ... ] }.');
    }

    // Optional replay-safe idempotency: if the caller stamps an eventId,
    // first-delivery wins, replays no-op. Scoped per (provider, eventId)
    // like the Square receiver. No eventId → process every push (the
    // original behaviour; many simple senders won't supply one).
    const eventId = String((body as any).eventId ?? (body as any).event_id ?? '').trim();
    if (eventId) {
      const eventType = String(
        Array.isArray((body as any).menu)
          ? 'menu'
          : Array.isArray((body as any).availability) || Array.isArray((body as any).eightySix)
            ? 'availability'
            : 'items',
      );
      const first = await this.svc.claimWebhookEvent('custom-webhook', eventId, eventType);
      if (!first) {
        this.logger.log(`Custom POS webhook duplicate eventId=${eventId} (ignored)`);
        return { ok: true, deduped: true };
      }
    }

    // ── Shape 1: { menu: [...] } — catalog + per-location overrides ──
    if (Array.isArray((body as any).menu)) {
      const result = await this.menu.ingestCustomWebhookMenu(conn, body as any);
      this.logger.log(
        `Custom POS menu push: tenant=${conn.tenantId} conn=${conn.id} ` +
          `items=${result.itemsUpserted} overrides=${result.overridesUpserted} skipped=${result.skipped}`,
      );
      return {
        ok: true,
        itemsUpserted: result.itemsUpserted,
        overridesUpserted: result.overridesUpserted,
        skipped: result.skipped,
        catalogId: result.catalogId,
      };
    }

    // ── Shape 2: { availability: [...] } / { eightySix: [...] } — 86 ──
    const availabilityList =
      (Array.isArray((body as any).availability) && (body as any).availability) ||
      (Array.isArray((body as any).eightySix) && (body as any).eightySix) ||
      null;
    // ── Shape 3-as-86: an { items: [...] } push that is purely an
    //    availability ping (every entry has `available` and no name/price).
    const items86 =
      !availabilityList &&
      Array.isArray((body as any).items) &&
      (body as any).items.length > 0 &&
      (body as any).items.every(
        (it: any) =>
          it && typeof it === 'object' && 'available' in it && it.name == null && it.price == null && it.priceCents == null,
      )
        ? (body as any).items
        : null;

    const eightySixEntries = availabilityList || items86;
    if (eightySixEntries) {
      const entries = (eightySixEntries as any[]).map((e) => ({
        externalId: String(e?.externalId ?? e?.id ?? '').trim(),
        available: e?.available === true,
        soldOutUntil: e?.soldOutUntil ?? null,
        locationTenantId: e?.locationTenantId ?? e?.locationId ?? null,
      }));
      const result = await this.menu.applyAutoEightySix(conn, entries);
      this.logger.log(
        `Custom POS 86 push: tenant=${conn.tenantId} conn=${conn.id} ` +
          `matched=${result.itemsMatched} overrides=${result.overridesUpdated} skipped=${result.skipped}`,
      );
      return {
        ok: true,
        itemsMatched: result.itemsMatched,
        overridesUpdated: result.overridesUpdated,
        skipped: result.skipped,
      };
    }

    // ── Shape 3: { items: [...] } — LEGACY flat PosMenuItem catalog ──
    const result = await this.svc.ingestCustomWebhookCatalog(conn, body);
    this.logger.log(
      `Custom POS webhook: tenant=${conn.tenantId} conn=${conn.id} upserted=${result.upserted} skipped=${result.skipped}`,
    );
    return {
      ok: true,
      upserted: result.upserted,
      skipped: result.skipped,
    };
  }

  // ─── CSRF state store (Redis-first, in-process fallback) ────────────
  //
  // The OAuth `state` nonce MUST survive the round-trip from /authorize on
  // one replica to /callback on (potentially) another. Redis is the shared
  // store; the in-process Map is the dev / Redis-less fallback. We mirror
  // the app's Redis-optional convention used elsewhere (e.g.
  // efficiency-metrics.service.ts, ai.service.ts): reach for
  // `this.redis.publisher`, null-guard it, and degrade gracefully.

  /** Persist a freshly-minted CSRF state nonce with a 10-min TTL. Writes
   *  to Redis when available (shared across replicas, authoritative) and
   *  only falls back to the in-process Map when Redis is absent or the
   *  write throws — keeping a single source of truth so a nonce can't live
   *  in one pod's Map while the callback lands on another. */
  private async putState(
    state: string,
    entry: { tenantId: string; userId: string },
  ): Promise<void> {
    const pub = this.redis?.publisher;
    if (pub) {
      try {
        // PX = TTL in ms; the key expires itself, so no GC pass is needed
        // on the Redis path. Value is the (tenantId, userId) we trust on
        // callback — never read from the request.
        await pub.set(
          `${STATE_REDIS_PREFIX}${state}`,
          JSON.stringify({ tenantId: entry.tenantId, userId: entry.userId }),
          'PX',
          STATE_TTL_MS,
        );
        return;
      } catch (err: any) {
        this.logger.warn(
          `Redis putState failed; falling back to in-process state cache: ${err?.message || err}`,
        );
      }
    }
    // Fallback: in-process Map (single-pod / no-Redis deploy).
    this.gcStateCache();
    this.stateCache.set(state, {
      tenantId: entry.tenantId,
      userId: entry.userId,
      expiresAt: Date.now() + STATE_TTL_MS,
    });
  }

  /** Read-and-delete the CSRF state nonce (single-use). Returns the issuing
   *  handshake's (tenantId, userId) or null if it's missing / expired —
   *  null MUST be treated by the caller as a CSRF failure. Tries Redis
   *  first (atomic GET+DEL via MULTI so a double-callback can't reuse a
   *  nonce across replicas), then the in-process Map. */
  private async takeState(
    state: string,
  ): Promise<{ tenantId: string; userId: string } | null> {
    const pub = this.redis?.publisher;
    if (pub) {
      try {
        const key = `${STATE_REDIS_PREFIX}${state}`;
        // Atomic single-use: fetch + delete in one round-trip so two
        // concurrent callbacks (e.g. double-clicked / replayed) can't both
        // pass the CSRF check. GETDEL would also work but isn't available
        // on older Redis; MULTI(GET,DEL) is portable.
        const res = await pub.multi().get(key).del(key).exec();
        // ioredis exec() → [[err, getResult], [err, delResult]]
        const raw = res && res[0] && res[0][1];
        if (typeof raw === 'string' && raw.length > 0) {
          try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.tenantId === 'string' && typeof parsed.userId === 'string') {
              return { tenantId: parsed.tenantId, userId: parsed.userId };
            }
          } catch {
            // Corrupt value — treat as a miss (reject).
          }
        }
        // Not in Redis. On a Redis deploy that's authoritative → reject.
        // (We don't silently fall through to the Map: if Redis is the
        // shared store, a missing key means the nonce never existed or was
        // already consumed.)
        return null;
      } catch (err: any) {
        this.logger.warn(
          `Redis takeState failed; falling back to in-process state cache: ${err?.message || err}`,
        );
        // Fall through to the in-process Map below so a transient Redis
        // blip on the callback still lets a same-node handshake complete.
      }
    }
    // Fallback: in-process Map (single-pod / no-Redis deploy, or Redis
    // read error above). Read-and-delete with an explicit expiry check.
    this.gcStateCache();
    const local = this.stateCache.get(state);
    if (!local || local.expiresAt < Date.now()) {
      this.stateCache.delete(state);
      return null;
    }
    this.stateCache.delete(state);
    return { tenantId: local.tenantId, userId: local.userId };
  }

  // ─── helpers ───────────────────────────────────────────────────────

  private gcStateCache() {
    const now = Date.now();
    for (const [k, v] of this.stateCache.entries()) {
      if (v.expiresAt < now) this.stateCache.delete(k);
    }
  }
}
