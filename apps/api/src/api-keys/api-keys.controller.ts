import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { ApiKeysService } from './api-keys.service';

@Controller('api/v1/api-keys')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN)
export class ApiKeysController {
  constructor(private readonly svc: ApiKeysService) {}

  /** List the tenant's API keys (never returns the secret). */
  @Get()
  async list(@Req() req: any) {
    return this.svc.list(req.user.tenantId);
  }

  /** Mint a new API key. Returns the plaintext token ONCE. */
  @Post()
  async mint(
    @Req() req: any,
    @Body() body: { name?: string; role?: string; expiresAt?: string | null },
  ) {
    let expiresAt: Date | null = null;
    if (body.expiresAt) {
      const t = Date.parse(body.expiresAt);
      if (Number.isFinite(t)) expiresAt = new Date(t);
    }
    const actorUserId = req.user?.userId ?? req.user?.id ?? null;
    return this.svc.mint({
      tenantId: req.user.tenantId,
      name: String(body.name || ''),
      role: String(body.role || ''),
      expiresAt,
      actorUserId,
    });
  }

  /** Revoke (soft delete) an API key. Idempotent. */
  @Delete(':id')
  async revoke(@Req() req: any, @Param('id') id: string) {
    const actorUserId = req.user?.userId ?? req.user?.id ?? null;
    return this.svc.revoke({
      tenantId: req.user.tenantId,
      id,
      actorUserId,
    });
  }
}
