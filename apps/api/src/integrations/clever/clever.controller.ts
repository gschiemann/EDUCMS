import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RbacGuard } from '../../auth/rbac.guard';
import { RequireRoles } from '../../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { CleverService } from './clever.service';

interface AuthedRequest extends Request {
  user?: { tenantId?: string; userId?: string; id?: string };
}

/**
 * CLV-01 — the browser half of the OAuth state binding.
 *
 * Name is deliberately boring and scoped to this integration. `HttpOnly` so
 * no page script can read it; `Path` scoped to the Clever routes so it is not
 * attached to any other API call.
 *
 * SameSite: this API and the dashboard are DIFFERENT SITES in production
 * (Vercel web → Railway API), and a `Lax`/`Strict` cookie is dropped by the
 * browser when it is set from a cross-site request — which `/connect` is (an
 * XHR from the dashboard). So production uses `None; Secure`, exactly like the
 * express-session cookie this API already issues for the same reason
 * (`main.ts`: "'none' needed for cross-origin (Vercel→Railway)"). Dev is
 * same-site, so `Lax` there. The cookie is not a credential: it carries only a
 * 96-bit random nonce that is worthless without the matching signed `state`
 * AND the single-use server record.
 */
const STATE_COOKIE = 'venueos_clever_state';
const STATE_COOKIE_PATH = '/api/v1/integrations/clever';
const STATE_COOKIE_MAX_AGE_MS = 15 * 60 * 1000;

function stateCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'none' | 'lax';
  path: string;
} {
  const prod = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: prod,
    sameSite: prod ? 'none' : 'lax',
    path: STATE_COOKIE_PATH,
  };
}

@Controller('api/v1/integrations/clever')
export class CleverController {
  private readonly logger = new Logger(CleverController.name);

  constructor(private readonly clever: CleverService) {}

  /**
   * The nonce this browser is carrying, from the cookie, or — when the cookie
   * was blocked (a browser that refuses third-party cookie writes) — from the
   * express-session copy, which is a binding of exactly the same strength:
   * both prove "the browser that finished this is the browser that started
   * it", neither is guessable, and both are server-issued. Absent BOTH, the
   * callback is refused.
   */
  private browserNonce(req: Request): string | null {
    const cookies = (req as Request & { cookies?: Record<string, unknown> }).cookies;
    const fromCookie = cookies?.[STATE_COOKIE];
    if (typeof fromCookie === 'string' && fromCookie) return fromCookie;
    const session = (req as Request & { session?: Record<string, unknown> }).session;
    const fromSession = session?.cleverOAuthNonce;
    return typeof fromSession === 'string' && fromSession ? fromSession : null;
  }

  /** The acting admin's id, or null when the principal carries neither shape. */
  private actorUserId(req: AuthedRequest): string | null {
    return req.user?.userId ?? req.user?.id ?? null;
  }

  private redirectUri(req: Request): string {
    const base = process.env.CLEVER_REDIRECT_URI;
    if (base) return base;
    const proto = (req.headers['x-forwarded-proto'] as string) || 'http';
    const host = req.headers.host ?? 'localhost:8080';
    return `${proto}://${host}/api/v1/integrations/clever/callback`;
  }

  @Get('connect')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.DISTRICT_ADMIN)
  async connect(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const tenantId = req.user?.tenantId ?? '';
    const userId = this.actorUserId(req);
    // 2026-05-23 launch audit P0: catch the "not configured" throw from
    // buildAuthorizeUrl and surface a clean 503 with actionable copy so
    // the UI can render a "Clever not configured for this deploy"
    // banner instead of pretending the OAuth handshake started.
    try {
      // CLV-01: mints the URL AND persists a single-use server record bound to
      // {tenantId, userId}; the nonce goes back to the browser as a cookie so
      // the (unauthenticated) callback can prove it is the same browser.
      const { url, nonce } = await this.clever.beginConnect(tenantId, this.redirectUri(req), userId);
      res.cookie(STATE_COOKIE, nonce, {
        ...stateCookieOptions(),
        maxAge: STATE_COOKIE_MAX_AGE_MS,
      });
      const session = (req as Request & { session?: Record<string, unknown> }).session;
      if (session) session.cleverOAuthNonce = nonce;
      return { url };
    } catch (err: unknown) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Clever integration is not configured for this deploy.';
      throw new HttpException(
        { code: 'CLEVER_NOT_CONFIGURED', message },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  // Note: the existing /status endpoint at line 119 has been extended
  // to include `configured: boolean` (see clever.service.ts getStatus),
  // so a dedicated config-only endpoint isn't needed — the UI's
  // existing /status fetch now carries deployment-level state alongside
  // tenant-level connection state.

  /**
   * OAuth callback from Clever. Unauthenticated by necessity — it is a
   * top-level redirect from clever.com, so no bearer token can be attached.
   *
   * CLV-01: the `state` HMAC alone proved only that WE minted the envelope,
   * never that it belongs to the browser presenting it — so a phished state
   * bound the victim district's Clever token to the attacker's tenant.
   * `consumeState` now additionally requires the nonce cookie this browser
   * received at `/connect` AND a single-use server record naming the same
   * tenant. A cross-site `Lax`-style forced navigation gains nothing: the
   * attacker's browser has the cookie but not the victim's authorization code,
   * and the victim's browser has the code but not the cookie.
   */
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // The handshake is over either way — never leave a usable nonce behind.
    res.clearCookie(STATE_COOKIE, stateCookieOptions());
    const session = (req as Request & { session?: Record<string, unknown> }).session;
    const browserNonce = this.browserNonce(req);
    if (session) delete session.cleverOAuthNonce;

    if (!code || !state) {
      res.status(400).send('Missing code or state');
      return;
    }
    try {
      const { tenantId } = await this.clever.consumeState(state, browserNonce);
      await this.clever.completeOAuth(tenantId, code, this.redirectUri(req));
      const dest = process.env.CLEVER_POST_CONNECT_URL ?? '/';
      res.redirect(dest);
    } catch (err) {
      // CLV-03 hygiene: a FIXED string on the wire, detail to the log. The
      // reachable messages are all constants today, but reflecting an error
      // into a text/html response is one refactor away from being an XSS —
      // same `SsrfError.publicMessage` discipline used elsewhere here.
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Clever callback rejected: ${msg}`);
      res
        .status(400)
        .send('Clever connect failed. Start the connection again from Settings → Integrations.');
    }
  }

  @Post('disconnect')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.DISTRICT_ADMIN)
  async disconnect(@Req() req: AuthedRequest) {
    const tenantId = req.user?.tenantId ?? '';
    await this.clever.disconnect(tenantId, this.actorUserId(req));
    return { ok: true };
  }

  @Post('sync')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.DISTRICT_ADMIN)
  async sync(@Req() req: AuthedRequest) {
    const tenantId = req.user?.tenantId ?? '';
    // CLV-02: pass the acting admin through so every role rewrite this sync
    // performs carries real forensic attribution. The nightly cron passes
    // null (the actor IS the system) — see `recordRoleChange`.
    return this.clever.syncTenant(tenantId, this.actorUserId(req));
  }

  @Get('preview')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.DISTRICT_ADMIN)
  async preview(@Req() req: AuthedRequest) {
    const tenantId = req.user?.tenantId ?? '';
    return this.clever.previewSync(tenantId);
  }

  @Get('status')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async status(@Req() req: AuthedRequest) {
    const tenantId = req.user?.tenantId ?? '';
    return this.clever.getStatus(tenantId);
  }
}
