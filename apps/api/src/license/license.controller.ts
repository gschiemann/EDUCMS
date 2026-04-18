import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { LicenseService } from './license.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';

/** Tenant-facing license endpoint — current tier, seats used, expiry. */
@Controller('api/v1/license')
@UseGuards(JwtAuthGuard, RbacGuard)
export class LicenseController {
  constructor(private readonly license: LicenseService) {}

  @Get('me')
  async me(@Request() req: any) {
    return this.license.summary(req.user.tenantId);
  }
}
