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
import { API_KEY_SCOPE_FAMILIES, API_KEY_SCOPES } from './api-key-scopes';

@Controller('api/v1/api-keys')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN)
export class ApiKeysController {
  constructor(private readonly svc: ApiKeysService) {}

  /**
   * The scope vocabulary this build enforces, plus the expiry policy, for the
   * mint UI.
   *
   * Served rather than duplicated in the web bundle so the picker can never
   * offer a scope the guard does not understand (which would mint a key the
   * operator believes is scoped and which is silently unrestricted, or vice
   * versa) — and so the "expires in N days" copy can never drift from
   * `ApiKeysService`'s real default/ceiling. Static + non-sensitive.
   */
  @Get('scopes')
  scopeCatalog() {
    return {
      scopes: API_KEY_SCOPES,
      families: API_KEY_SCOPE_FAMILIES.map((f) => ({
        id: f.id,
        label: f.label,
        blurb: f.blurb,
        // `analytics` is read-only by design — see api-key-scopes.ts.
        access: API_KEY_SCOPES.includes(`${f.id}:write`)
          ? (['read', 'write'] as const)
          : (['read'] as const),
      })),
      defaultExpiryDays: ApiKeysService.DEFAULT_EXPIRY_DAYS,
      maxExpiryDays: ApiKeysService.MAX_EXPIRY_DAYS,
    };
  }

  /** List the tenant's API keys (never returns the secret). */
  @Get()
  async list(@Req() req: any) {
    return this.svc.list(req.user.tenantId);
  }

  /** Mint a new API key. Returns the plaintext token ONCE. */
  @Post()
  async mint(
    @Req() req: any,
    @Body()
    body: {
      name?: string;
      role?: string;
      expiresAt?: string | null;
      scopes?: string[] | null;
    },
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
      // Absent → unrestricted (unchanged behaviour for existing callers).
      // The service validates every entry and 400s on an unknown one.
      scopes: body.scopes ?? null,
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
