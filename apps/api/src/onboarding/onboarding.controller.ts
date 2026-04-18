import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Request, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { OnboardingService } from './onboarding.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';

@Controller('api/v1')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  // --- District signup --------------------------------------------------
  @Post('signup')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async signup(@Body() body: { districtName: string; slug: string; adminEmail: string; password: string }) {
    return this.onboarding.signup(body);
  }

  // --- Password reset ---------------------------------------------------
  // 3 requests per hour per IP to avoid abuse / mailbox flood.
  @Post('password-reset/request')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60 * 60 * 1000, limit: 3 } })
  async requestReset(@Body() body: { email: string }) {
    return this.onboarding.requestPasswordReset(body?.email);
  }

  @Post('password-reset/complete')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async completeReset(@Body() body: { token: string; newPassword: string }) {
    return this.onboarding.completePasswordReset(body);
  }

  // --- Invites (admin side) --------------------------------------------
  @Post('invites')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async createInvite(@Request() req: any, @Body() body: { email: string; role: string }) {
    return this.onboarding.createInvite({
      inviterId: req.user.id,
      tenantId: req.user.tenantId,
      email: body.email,
      role: body.role,
    });
  }

  // --- Invites (recipient side) ----------------------------------------
  @Get('invites/:token')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async inviteDetails(@Param('token') token: string) {
    return this.onboarding.getInvitePreview(token);
  }

  @Post('invites/:token/accept')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async acceptInvite(@Param('token') token: string, @Body() body: { password: string }) {
    return this.onboarding.acceptInvite({ token, password: body.password });
  }
}
