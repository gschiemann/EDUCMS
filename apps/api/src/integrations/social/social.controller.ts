/**
 * SocialController — the session + device surface for the social connector.
 *
 *   GET    /api/v1/integrations/social/status              — is this deploy configured?
 *   GET    /api/v1/integrations/social/connections         — the tenant's accounts
 *   POST   /api/v1/integrations/social/connections/:id/sync
 *   DELETE /api/v1/integrations/social/connections/:id     — disconnect
 *   GET    /api/v1/integrations/social/posts               — the cached posts a screen renders
 *
 * ── WHY `posts` HAS A DIFFERENT GUARD ──────────────────────────────────
 * Every other route is `JwtAuthGuard + RbacGuard` — an operator session with
 * an admin role. `posts` is `JwtAuthGuard` ALONE, because the caller may be a
 * PAIRED SCREEN: a device JWT carries `{ kind: 'device', tenantId }` and no
 * role, so RbacGuard would 403 it (see apps/api/src/auth/jwt-auth.guard.ts,
 * the `isDeviceToken` branch). This is the same lesson device-menu.ts records
 * for menu boards — a widget that reads a session-only endpoint demos
 * perfectly in the dashboard preview and is dead on the actual wall.
 *
 * Dropping RbacGuard does NOT widen tenant scope: the tenantId comes from the
 * verified token either way, and `listPosts` ANDs it into the query. A device
 * can read its own tenant's cached posts and nothing else — which is exactly
 * what it needs to draw the widget.
 */
import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AppRole } from '@cms/database';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RbacGuard } from '../../auth/rbac.guard';
import { RequireRoles } from '../../auth/roles.decorator';
import {
  SocialService,
  isSocialProviderId,
  type SocialProviderId,
} from './social.service';

@Controller('api/v1/integrations/social')
export class SocialController {
  constructor(private readonly svc: SocialService) {}

  /**
   * Dormant-deploy truth. Returns `{ enabled: false, missing: [...] }` when
   * the Meta keys are absent, so the Apps tab can say "ask your admin to add
   * INSTAGRAM_APP_ID / META_APP_ID" instead of showing a Connect button that
   * 503s. Never throws.
   */
  @Get('status')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
    AppRole.RESTRICTED_VIEWER,
  )
  status() {
    return this.svc.status();
  }

  @Get('connections')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  async listConnections(
    @Request() req: any,
    @Query('provider') provider?: string,
  ) {
    const p = isSocialProviderId(provider) ? provider : undefined;
    return this.svc.listConnections(req.user.tenantId, p);
  }

  @Post('connections/:id/sync')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
  )
  async sync(@Request() req: any, @Param('id') id: string) {
    return this.svc.triggerSync(req.user.tenantId, id, req.user.id ?? null);
  }

  @Delete('connections/:id')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
  )
  async disconnect(@Request() req: any, @Param('id') id: string) {
    return this.svc.disconnect(req.user.tenantId, id, req.user.id ?? null);
  }

  /** The screen read. See the guard note in this file's header. */
  @Get('posts')
  @UseGuards(JwtAuthGuard)
  async listPosts(
    @Request() req: any,
    @Query('connectionId') connectionId?: string,
    @Query('limit') limit?: string,
  ) {
    const tenantId = req.user.tenantId;
    const posts = await this.svc.listPosts(tenantId, {
      connectionId: connectionId || undefined,
      limit: limit ? Number(limit) : undefined,
    });
    // The widget renders an honest state from this: "@handle has posted
    // nothing" vs "this account's access expired — reconnect". Credential-
    // free and tenant-scoped, so a device may read it. `null` when the
    // caller named a connection that is not theirs (or does not exist) —
    // which is also what makes an empty `posts` unambiguous.
    const connection = connectionId
      ? await this.svc.connectionSummary(tenantId, connectionId)
      : null;
    return { posts, connection };
  }
}
