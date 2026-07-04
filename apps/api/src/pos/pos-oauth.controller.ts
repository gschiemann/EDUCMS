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
import { newOAuthStateToken, verifySquareSignature } from './providers/square';
import { getConnector } from './providers/registry';
import { getPosProvider } from '@cms/api-types';

/** Where the provider redirects the operator after they approve. Derived
 *  from the public API origin so dev + staging + prod all work without per-
 *  env config beyond the existing PUBLIC_API_BASE_URL / origin headers. The
 *  `provider` segment must match what's registered in that provider's
 *  developer dashboard (e.g. Square → `.../oauth/square/callback`). */
function resolveRedirectUri(req: Request, provider: string): string {
  // Prefer the explicit env var if set; otherwise reconstruct from the
  // incoming Host header (covers dev + Railway's tunnel hostnames).
  const apiBase =
    process.env.PUBLIC_API_BASE_URL ||
    `${req.protocol || 'https'}://${req.headers.host}`;
  return `${apiBase.replace(/\/$/, '')}/api/v1/pos/oauth/${provider}/callback`;
}

function resolveWebReturnUrl(): string {
  return (process.env.WEB_PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');
}

/** Each provider module reads `{PREFIX}_CLIENT_ID` / `{PREFIX}_CLIENT_SECRET`
 *  (SQUARE_ / CLOVER_ / SHOPIFY_ / LIGHTSPEED_ — the connector's envPrefix,
 *  which differs from the provider id). True when both are set. */
function providerOAuthConfigured(envPrefix: string): boolean {
  return !!(process.env[`${envPrefix}_CLIENT_ID`] && process.env[`${envPrefix}_CLIENT_SECRET`]);
}

/** Normalize a Shopify shop domain. Accepts "acme", "acme.myshopify.com", or
 *  a full URL; returns the canonical "acme.myshopify.com" or null if invalid.
 *  Only the *.myshopify.com admin host is allowed (no arbitrary domains). */
function sanitizeShopDomain(raw?: string): string | null {
  if (!raw) return null;
  let s = String(raw).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!s) return null;
  if (!s.includes('.')) s = `${s}.myshopify.com`;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s)) return null;
  return s;
}

/** CSRF state lifetime — the operator has 10 min to complete the Square
 *  approve screen before the nonce is rejected. Used for both the Redis
 *  key TTL and the in-process fallback's expiry stamp. */
const STATE_TTL_MS = 10 * 60 * 1000;
/** Redis key prefix for the per-handshake CSRF state nonce. */
const STATE_REDIS_PREFIX = 'pos:oauth_state:';

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
  private readonly stateCache = new Map<string, { tenantId: string; userId: string; provider: string; storeId?: string; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly svc: PosService,
    private readonly menu: MenuService,
    private readonly redis: RedisService,
  ) {}

  // ─── OAuth: kick off ───────────────────────────────────────────────

  @Get('oauth/:provider/authorize')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async authorize(
    @Req() req: any,
    @Param('provider') provider: string,
    @Query('shop') shop?: string,
  ) {
    const connector = getConnector(provider);
    const meta = getPosProvider(provider);
    // Only DIRECT-tier OAuth providers with a registered connector can be
    // self-serve connected (square / clover / shopify / lightspeed). Anything
    // else — unknown id, custom-webhook (no connector), or a PARTNER provider
    // not yet live — is rejected here.
    if (!connector || !meta || meta.integrationTier !== 'DIRECT') {
      throw new HttpException(
        { code: 'POS_OAUTH_PROVIDER_NOT_SELF_SERVE', message: `${meta?.name || provider} is not available for self-serve OAuth connect.` },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!providerOAuthConfigured(connector.envPrefix)) {
      throw new HttpException(
        { code: 'POS_OAUTH_NOT_CONFIGURED', message: `${meta.name} OAuth not configured for this deploy. Set ${connector.envPrefix}_CLIENT_ID / ${connector.envPrefix}_CLIENT_SECRET.` },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // Shopify's authorize URL is per-shop, so the shop domain must be known
    // BEFORE we redirect. Other providers learn the store id on the callback
    // (Clover merchant_id, Lightspeed domain_prefix) or token (Square).
    let storeId: string | undefined;
    if (connector.needsStoreIdAtAuthorize) {
      const shopDomain = sanitizeShopDomain(shop);
      if (!shopDomain) {
        throw new HttpException(
          { code: 'POS_OAUTH_SHOP_DOMAIN_REQUIRED', message: `${meta.name} requires a store domain — pass ?shop=your-store.myshopify.com` },
          HttpStatus.BAD_REQUEST,
        );
      }
      storeId = shopDomain;
    }

    const state = newOAuthStateToken();
    await this.putState(state, {
      tenantId: req.user.tenantId,
      userId: req.user.id,
      provider,
      storeId,
    });
    const redirectUri = resolveRedirectUri(req, provider);
    const url = connector.authorizeUrl({ state, redirectUri, storeId });
    return { url };
  }

  // ─── OAuth: callback ──────────────────────────────────────────────

  @Get('oauth/:provider/callback')
  async callback(
    @Req() req: Request,
    @Res() res: Response,
    @Param('provider') provider: string,
    @Query() query: Record<string, string>,
  ) {
    const code = query.code;
    const state = query.state;
    const errorParam = query.error;
    const webReturn = resolveWebReturnUrl();
    // The provider is part of the redirect URL — sanitize so a junk path
    // segment can't be reflected into the Location header.
    const safeProvider = /^[a-z0-9-]+$/.test(provider) ? provider : 'unknown';
    const failRedirect = (reason: string) => {
      const u = new URL(`${webReturn}/connect/${safeProvider}/done`);
      u.searchParams.set('status', 'error');
      u.searchParams.set('reason', reason.slice(0, 200));
      return res.redirect(u.toString());
    };

    const connector = getConnector(provider);
    if (!connector) return failRedirect('unknown-provider');
    if (errorParam) return failRedirect(`oauth-error:${errorParam}`);
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
    // Defense-in-depth: the nonce was minted for a specific provider; the
    // callback path's provider must match (a clover nonce can't be replayed
    // against the square callback).
    if (entry.provider && entry.provider !== provider) {
      return failRedirect('provider-mismatch');
    }

    // Resolve the store id: known at authorize-time (Shopify shop), carried on
    // the provider's callback query (Clover merchant_id / Lightspeed
    // domain_prefix), or only on the token response (Square — stays empty
    // here and is filled from `tokens.storeId` below).
    let storeId = entry.storeId || '';
    if (connector.callbackStoreIdParam) {
      const fromQuery = String(query[connector.callbackStoreIdParam] || '');
      if (fromQuery) storeId = fromQuery;
    }

    const redirectUri = resolveRedirectUri(req, provider);
    let tokens;
    try {
      tokens = await connector.exchangeCode({ code, redirectUri, storeId });
    } catch (err: any) {
      this.logger.warn(`${provider} token exchange failed: ${err?.message || err}`);
      return failRedirect('token-exchange-failed');
    }

    // Square returns the merchant id on the token; prefer it when present.
    const finalStoreId = tokens.storeId || storeId;

    try {
      const conn = await this.svc.upsertConnection({
        tenantId: entry.tenantId,
        userId: entry.userId,
        providerId: provider,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        storeId: finalStoreId,
        scope: tokens.scope,
      });
      // Fire an initial sync — fire-and-forget so the redirect snaps back fast.
      void this.svc.syncConnection(entry.tenantId, conn, entry.userId).catch((err) => {
        this.logger.warn(`initial ${provider} sync failed: ${err?.message || err}`);
      });

      const u = new URL(`${webReturn}/connect/${safeProvider}/done`);
      u.searchParams.set('status', 'ok');
      return res.redirect(u.toString());
    } catch (err: any) {
      this.logger.error(`${provider} upsertConnection failed: ${err?.message || err}`);
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
      throw new HttpException({ code: 'POS_WEBHOOK_SIGNING_NOT_CONFIGURED', message: 'Webhook signing not configured' }, HttpStatus.SERVICE_UNAVAILABLE);
    }

    // Body MUST be the exact raw bytes Square sent — Square computes its
    // HMAC over (notificationUrl + the exact bytes it POSTed). main.ts
    // mounts a path-scoped express.raw() for this exact route (mirroring
    // the Stripe billing webhook mount) so req.rawBody is a Buffer here,
    // never the globally-parsed JSON object.
    //
    // 2026-07-03 fix: this used to fall back to JSON.stringify(req.body)
    // when rawBody was missing — but that re-serializes the ALREADY-PARSED
    // object, which is NOT guaranteed byte-identical to what Square sent
    // (non-ASCII item names, Square's own key order / whitespace /
    // escaping all survive a round-trip differently). That silently 401'd
    // real catalog.*/inventory.* events in prod because the raw-body mount
    // didn't previously cover this path (global express.json() consumed
    // the body first) — see main.ts. We now REQUIRE rawBody; if it's
    // somehow missing (e.g. a misconfigured proxy strips it), reject with
    // a clear 400 instead of silently verifying against reconstructed
    // (and untrustworthy) bytes.
    const rawBodyBuf: Buffer | undefined = Buffer.isBuffer((req as any).rawBody)
      ? (req as any).rawBody
      : undefined;
    if (!rawBodyBuf) {
      this.logger.warn('Square webhook missing raw body (raw-body mount not applied to this request)');
      throw new HttpException({ code: 'POS_WEBHOOK_RAW_BODY_MISSING', message: 'Missing raw request body' }, HttpStatus.BAD_REQUEST);
    }
    const rawBody = rawBodyBuf.toString('utf8');
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
      throw new HttpException({ code: 'POS_WEBHOOK_SIGNATURE_INVALID', message: 'Invalid signature' }, HttpStatus.UNAUTHORIZED);
    }

    let evt: any;
    try {
      evt = JSON.parse(rawBody);
    } catch {
      throw new BadRequestException({ code: 'POS_WEBHOOK_BODY_NOT_JSON', message: 'Body is not valid JSON' });
    }
    const eventId = String(evt.event_id || evt.eventId || '');
    const eventType = String(evt.type || evt.event_type || 'unknown');
    const merchantId = String(evt.merchant_id || '');
    if (!eventId || !merchantId) {
      throw new BadRequestException({ code: 'POS_WEBHOOK_EVENT_FIELDS_MISSING', message: 'Missing event_id or merchant_id' });
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
        .syncConnection(conn.tenantId, conn, null)
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
      throw new HttpException({ code: 'POS_WEBHOOK_PROVIDER_UNKNOWN', message: 'Unknown webhook provider' }, HttpStatus.NOT_FOUND);
    }
    if (!secret) {
      throw new HttpException({ code: 'POS_WEBHOOK_SECRET_HEADER_MISSING', message: 'Missing X-Webhook-Secret header' }, HttpStatus.UNAUTHORIZED);
    }

    const conn = await this.svc.findCustomWebhookConnectionBySecret(secret);
    if (!conn) {
      // Don't leak whether the secret was wrong vs. the connection
      // missing — both are "we can't authenticate this push."
      this.logger.warn('Custom POS webhook: no connection matched the supplied secret');
      throw new HttpException({ code: 'POS_WEBHOOK_SECRET_INVALID', message: 'Invalid webhook secret' }, HttpStatus.UNAUTHORIZED);
    }

    const body = (req as any).body;
    if (!body || typeof body !== 'object') {
      throw new BadRequestException({ code: 'POS_WEBHOOK_CUSTOM_BODY_INVALID', message: 'Body must be JSON: { "menu": [ ... ] } | { "items": [ ... ] } | { "availability": [ ... ] }.' });
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
    entry: { tenantId: string; userId: string; provider: string; storeId?: string },
  ): Promise<void> {
    const pub = this.redis?.publisher;
    if (pub) {
      try {
        // PX = TTL in ms; the key expires itself, so no GC pass is needed
        // on the Redis path. Value is the (tenantId, userId, provider,
        // storeId) we trust on callback — never read from the request.
        await pub.set(
          `${STATE_REDIS_PREFIX}${state}`,
          JSON.stringify({
            tenantId: entry.tenantId,
            userId: entry.userId,
            provider: entry.provider,
            storeId: entry.storeId || '',
          }),
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
      provider: entry.provider,
      storeId: entry.storeId,
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
  ): Promise<{ tenantId: string; userId: string; provider: string; storeId?: string } | null> {
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
              return {
                tenantId: parsed.tenantId,
                userId: parsed.userId,
                provider: String(parsed.provider || ''),
                storeId: parsed.storeId ? String(parsed.storeId) : undefined,
              };
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
    return { tenantId: local.tenantId, userId: local.userId, provider: local.provider, storeId: local.storeId };
  }

  // ─── helpers ───────────────────────────────────────────────────────

  private gcStateCache() {
    const now = Date.now();
    for (const [k, v] of this.stateCache.entries()) {
      if (v.expiresAt < now) this.stateCache.delete(k);
    }
  }
}
