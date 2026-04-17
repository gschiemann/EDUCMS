import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RbacGuard } from '../../auth/rbac.guard';
import { RequireRoles } from '../../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { CleverService } from './clever.service';

interface AuthedRequest extends Request {
  user?: { tenantId?: string };
}

@Controller('api/v1/integrations/clever')
export class CleverController {
  constructor(private readonly clever: CleverService) {}

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
  connect(@Req() req: AuthedRequest) {
    const tenantId = req.user?.tenantId ?? '';
    const url = this.clever.buildAuthorizeUrl(tenantId, this.redirectUri(req));
    return { url };
  }

  /**
   * OAuth callback from Clever. Public endpoint (no session cookie may be
   * attached during the redirect) — the `state` parameter carries tenantId
   * and is signed indirectly via its presence in the initiating request.
   * Follow-up: add HMAC signature over state to prevent tenant spoofing.
   */
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!code || !state) {
      res.status(400).send('Missing code or state');
      return;
    }
    try {
      const { tenantId } = this.clever.decodeState(state);
      await this.clever.completeOAuth(tenantId, code, this.redirectUri(req));
      const dest = process.env.CLEVER_POST_CONNECT_URL ?? '/';
      res.redirect(dest);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).send(`Clever connect failed: ${msg}`);
    }
  }

  @Post('disconnect')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.DISTRICT_ADMIN)
  async disconnect(@Req() req: AuthedRequest) {
    const tenantId = req.user?.tenantId ?? '';
    await this.clever.disconnect(tenantId);
    return { ok: true };
  }

  @Post('sync')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.DISTRICT_ADMIN)
  async sync(@Req() req: AuthedRequest) {
    const tenantId = req.user?.tenantId ?? '';
    return this.clever.syncTenant(tenantId);
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
  @RequireRoles(AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async status(@Req() req: AuthedRequest) {
    const tenantId = req.user?.tenantId ?? '';
    return this.clever.getStatus(tenantId);
  }
}
