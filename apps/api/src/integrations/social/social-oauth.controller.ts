/**
 * Social OAuth handshake — Instagram + Facebook Page (2026-09-12).
 * ────────────────────────────────────────────────────────────────
 *
 * Two endpoints, deliberately in their own controller (the same reason
 * pos-oauth.controller.ts is separate): one of them is PUBLIC, and an auditor
 * should be able to see at a glance which one and why.
 *
 *   GET /api/v1/integrations/social/oauth/:provider/authorize
 *       JWT + admin roles. Mints a single-use CSRF nonce, stores it
 *       SERVER-SIDE with a TTL, returns `{ url }` for the web to open.
 *
 *   GET /api/v1/integrations/social/oauth/:provider/callback
 *       PUBLIC — Meta redirects the operator's BROWSER here, and a browser
 *       redirect cannot carry our bearer token. Everything we trust about
 *       the caller (tenantId, userId) comes from the server-side state
 *       record, never from the query string.
 *
 * ── THE STATE NONCE ────────────────────────────────────────────────────
 * 32 random bytes, stored in REDIS with a 10-minute TTL and read back with an
 * atomic MULTI(GET, DEL) so it is genuinely single-use across replicas. A
 * replay — a second callback with the same `state` — finds nothing and is
 * refused. The in-process Map is the FALLBACK for a Redis-less deploy only,
 * and it enforces the same read-and-delete. Copied from
 * pos-oauth.controller.ts, which is the shape this repo has already reviewed.
 */
import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { AppRole } from '@cms/database';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RbacGuard } from '../../auth/rbac.guard';
import { RequireRoles } from '../../auth/roles.decorator';
import { RedisService } from '../../realtime/redis.service';
import {
  SocialService,
  SOCIAL_PROVIDER_LABEL,
  isSocialProviderId,
  type SocialProviderId,
} from './social.service';
import * as instagram from './instagram';
import * as facebook from './facebook';

/** The operator has 10 minutes to finish Meta's approve screen. */
const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_REDIS_PREFIX = 'social:oauth_state:';

interface StateEntry {
  tenantId: string;
  userId: string;
  provider: SocialProviderId;
  expiresAt: number;
}

/**
 * Where Meta redirects the operator after they approve. Derived from the
 * public API origin, so dev / staging / prod all work without another env var
 * — identical to resolveRedirectUri in pos-oauth.controller.ts. THIS EXACT
 * STRING must be registered in the Meta app dashboard (see the README note in
 * .env.example).
 */
function resolveRedirectUri(req: Request, provider: string): string {
  const apiBase =
    process.env.PUBLIC_API_BASE_URL ||
    `${req.protocol || 'https'}://${req.headers.host}`;
  return `${apiBase.replace(/\/$/, '')}/api/v1/integrations/social/oauth/${provider}/callback`;
}

/** Where we send the operator's browser when the handshake finishes. Same
 *  `/connect/:provider/done` landing the POS callback uses, so there is one
 *  place in the web app that renders "you're connected". */
function resolveWebReturnUrl(): string {
  return (process.env.WEB_PUBLIC_URL || 'http://localhost:3000').replace(
    /\/$/,
    '',
  );
}

@Controller('api/v1/integrations/social')
export class SocialOAuthController {
  private readonly logger = new Logger(SocialOAuthController.name);

  /** Fallback state store — single-pod / no-Redis deploy only. */
  private readonly stateCache = new Map<string, StateEntry>();

  constructor(
    private readonly svc: SocialService,
    private readonly redis: RedisService,
  ) {}

  // ─── authorize ────────────────────────────────────────────────────

  @Get('oauth/:provider/authorize')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
  )
  async authorize(@Req() req: any, @Param('provider') provider: string) {
    if (!isSocialProviderId(provider)) {
      throw new HttpException(
        {
          code: 'SOCIAL_PROVIDER_UNKNOWN',
          message: `Unknown social provider: ${provider}`,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!this.svc.isConfigured(provider)) {
      const missing = this.svc.missingEnvFor(provider);
      // 503, not 500: the deploy is fine, the keys are simply absent. The
      // web surface turns this into "Ask your admin to add the Meta app
      // keys" rather than a stack trace.
      throw new HttpException(
        {
          code: 'SOCIAL_OAUTH_NOT_CONFIGURED',
          message:
            `${SOCIAL_PROVIDER_LABEL[provider]} isn't set up on this deploy yet. ` +
            `An administrator needs to add ${missing.join(' and ')}.`,
          missing,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const state = randomBytes(32).toString('hex');
    await this.putState(state, {
      tenantId: req.user.tenantId,
      userId: req.user.id,
      provider,
      expiresAt: Date.now() + STATE_TTL_MS,
    });
    const redirectUri = resolveRedirectUri(req, provider);
    const url =
      provider === 'instagram'
        ? instagram.instagramAuthorizeUrl({ state, redirectUri })
        : facebook.facebookAuthorizeUrl({ state, redirectUri });
    return { url };
  }

  // ─── callback (PUBLIC) ────────────────────────────────────────────

  @Get('oauth/:provider/callback')
  async callback(
    @Req() req: Request,
    @Res() res: Response,
    @Param('provider') provider: string,
    @Query() query: Record<string, string>,
  ) {
    const webReturn = resolveWebReturnUrl();
    // The provider segment lands in a Location header — never reflect an
    // unvalidated path segment.
    const safeProvider = isSocialProviderId(provider) ? provider : 'unknown';
    const done = (params: Record<string, string>) => {
      const u = new URL(`${webReturn}/connect/${safeProvider}/done`);
      for (const [k, v] of Object.entries(params))
        u.searchParams.set(k, v.slice(0, 200));
      return res.redirect(u.toString());
    };
    const fail = (reason: string) =>
      done({ status: 'error', social: 'error', reason });

    if (!isSocialProviderId(provider)) return fail('unknown-provider');
    if (query.error) return fail(`oauth-error:${String(query.error)}`);

    const code = query.code;
    const state = query.state;
    if (!code || !state) return fail('missing-code-or-state');

    // Single-use CSRF check. A missing / expired / already-consumed nonce is
    // a refusal — this is the replay defence, and it must stay read-and-DELETE.
    const entry = await this.takeState(state);
    if (!entry) return fail('expired-state-token');
    // A nonce minted for Instagram cannot be replayed at the Facebook
    // callback.
    if (entry.provider !== provider) return fail('provider-mismatch');

    const redirectUri = resolveRedirectUri(req, provider);
    try {
      const created =
        provider === 'instagram'
          ? await this.completeInstagram(entry, code, redirectUri)
          : await this.completeFacebook(entry, code, redirectUri);
      if (created.length === 0) {
        return fail(
          provider === 'facebook' ? 'no-pages-found' : 'no-account-found',
        );
      }
      // Kick a first sync so the operator sees posts immediately. Fire and
      // forget — the redirect must snap back.
      for (const conn of created) {
        void this.svc.syncConnection(conn, entry.userId).catch((err) => {
          this.logger.warn(
            `initial ${provider} sync failed: ${err?.name || 'Error'}`,
          );
        });
      }
      return done({
        status: 'ok',
        social: 'connected',
        accounts: String(created.length),
      });
    } catch (err: any) {
      // NEVER the provider's message — it can carry the token. The class
      // name plus our own sanitised MetaHttpError text is the whole log.
      this.logger.warn(
        `${provider} OAuth callback failed for tenant ${entry.tenantId}: ${err?.message || err?.name || 'Error'}`,
      );
      return fail('connect-failed');
    }
  }

  // ─── per-provider completion ──────────────────────────────────────

  /** code → short-lived → long-lived → profile → ONE connection. */
  private async completeInstagram(
    entry: StateEntry,
    code: string,
    redirectUri: string,
  ) {
    const short = await instagram.instagramExchangeCode(
      { code, redirectUri },
      this.svc.fetchImpl,
    );
    const long = await instagram.instagramExchangeLongLived(
      short.accessToken,
      this.svc.fetchImpl,
    );
    const profile = await instagram.instagramFetchProfile(
      long.accessToken,
      this.svc.fetchImpl,
    );
    const accountId = profile.accountId || short.userId;
    if (!accountId) return [];
    const conn = await this.svc.upsertConnection({
      tenantId: entry.tenantId,
      userId: entry.userId,
      providerId: 'instagram',
      accountId,
      displayName: profile.username ? `@${profile.username}` : 'Instagram',
      accessToken: long.accessToken,
      expiresAt: long.expiresAt,
      scope: [...instagram.INSTAGRAM_SCOPES],
    });
    return [conn];
  }

  /**
   * code → short-lived user → long-lived user → EVERY Page that person
   * administers, one connection each.
   *
   * Storing all of them (rather than making the operator re-run the dance per
   * Page) is deliberate: `/me/accounts` already returned every Page token in
   * one response, and the operator then picks the Page they want from a list
   * in the Apps tab instead of guessing which one the dialog will bind to.
   */
  private async completeFacebook(
    entry: StateEntry,
    code: string,
    redirectUri: string,
  ) {
    const short = await facebook.facebookExchangeCode(
      { code, redirectUri },
      this.svc.fetchImpl,
    );
    const long = await facebook.facebookExchangeLongLived(
      short.accessToken,
      this.svc.fetchImpl,
    );
    const pages = await facebook.facebookFetchPages(
      long.accessToken,
      this.svc.fetchImpl,
    );
    const out: any[] = [];
    for (const page of pages) {
      const conn = await this.svc.upsertConnection({
        tenantId: entry.tenantId,
        userId: entry.userId,
        providerId: 'facebook',
        accountId: page.pageId,
        displayName: page.name || 'Facebook Page',
        accessToken: page.accessToken,
        // Page tokens derived from a long-lived user token do not expire.
        expiresAt: null,
        scope: [...facebook.FACEBOOK_SCOPES],
      });
      out.push(conn);
    }
    return out;
  }

  // ─── state store ──────────────────────────────────────────────────

  private async putState(state: string, entry: StateEntry): Promise<void> {
    const pub = (this.redis as any)?.publisher;
    if (pub) {
      try {
        await pub.set(
          `${STATE_REDIS_PREFIX}${state}`,
          JSON.stringify({
            tenantId: entry.tenantId,
            userId: entry.userId,
            provider: entry.provider,
          }),
          'PX',
          STATE_TTL_MS,
        );
        return;
      } catch (err: any) {
        this.logger.warn(
          `Redis putState failed; using in-process state cache: ${err?.name || 'Error'}`,
        );
      }
    }
    this.gcStateCache();
    this.stateCache.set(state, entry);
  }

  /**
   * Read-and-DELETE. Returns null for missing / expired / already-used, and
   * null MUST be treated by the caller as a CSRF failure.
   *
   * Redis path uses MULTI(GET, DEL) so two concurrent callbacks with the same
   * nonce cannot both pass — GETDEL would do as well but is not on older
   * Redis. When Redis is REACHABLE and has no such key we return null rather
   * than falling through to the Map: on a Redis deploy, Redis is the
   * authority, and "not there" means never issued or already consumed.
   */
  private async takeState(state: string): Promise<StateEntry | null> {
    const pub = (this.redis as any)?.publisher;
    if (pub) {
      try {
        const key = `${STATE_REDIS_PREFIX}${state}`;
        const res = await pub.multi().get(key).del(key).exec();
        const raw = res && res[0] && res[0][1];
        if (typeof raw === 'string' && raw.length > 0) {
          try {
            const parsed = JSON.parse(raw);
            if (
              parsed &&
              typeof parsed.tenantId === 'string' &&
              typeof parsed.userId === 'string' &&
              isSocialProviderId(parsed.provider)
            ) {
              return {
                tenantId: parsed.tenantId,
                userId: parsed.userId,
                provider: parsed.provider,
                expiresAt: 0,
              };
            }
          } catch {
            /* corrupt value — treat as a miss */
          }
        }
        return null;
      } catch (err: any) {
        this.logger.warn(
          `Redis takeState failed; using in-process state cache: ${err?.name || 'Error'}`,
        );
        // Fall through so a transient Redis blip on the callback still lets a
        // same-node handshake complete.
      }
    }
    this.gcStateCache();
    const local = this.stateCache.get(state);
    if (!local || local.expiresAt < Date.now()) {
      this.stateCache.delete(state);
      return null;
    }
    this.stateCache.delete(state);
    return local;
  }

  private gcStateCache() {
    const now = Date.now();
    for (const [k, v] of this.stateCache.entries()) {
      if (v.expiresAt < now) this.stateCache.delete(k);
    }
  }
}
