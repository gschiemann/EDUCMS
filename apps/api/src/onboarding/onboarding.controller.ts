import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Request, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  PasswordResetRequestSchema, type PasswordResetRequest,
  PasswordResetCompleteSchema, type PasswordResetComplete,
  SignupInputSchema, type SignupInput,
  CreateInviteInputSchema, type CreateInviteInput,
  CreateUserDirectInputSchema, type CreateUserDirectInput,
  AcceptInviteInputSchema, type AcceptInviteInput,
} from '@cms/api-types';
import { OnboardingService } from './onboarding.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { AppRole } from '@cms/database';

@Controller('api/v1')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  // --- District signup --------------------------------------------------
  @Post('signup')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async signup(@Body(new ZodValidationPipe(SignupInputSchema)) body: SignupInput) {
    // 2026-05-03 — VenueOS pivot: vertical is now part of signup so
    // a new tenant is created with the right industry context (drives
    // template library, terminology, default emergency types).
    return this.onboarding.signup(body);
  }

  // --- Password reset ---------------------------------------------------
  // 3 requests per hour per IP to avoid abuse / mailbox flood.
  @Post('password-reset/request')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60 * 60 * 1000, limit: 3 } })
  async requestReset(
    @Body(new ZodValidationPipe(PasswordResetRequestSchema)) body: PasswordResetRequest,
  ) {
    return this.onboarding.requestPasswordReset(body.email);
  }

  @Post('password-reset/complete')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async completeReset(
    // Token: bounded length 16..256 (sha256 tokens are 64 hex). New
    // password: enforced 8-char minimum (NewPasswordString) — first
    // server-side enforcement of password length on this endpoint.
    @Body(new ZodValidationPipe(PasswordResetCompleteSchema)) body: PasswordResetComplete,
  ) {
    return this.onboarding.completePasswordReset(body);
  }

  // --- Invites (admin side) --------------------------------------------
  @Post('invites')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async createInvite(@Request() req: any, @Body(new ZodValidationPipe(CreateInviteInputSchema)) body: CreateInviteInput) {
    return this.onboarding.createInvite({
      inviterId: req.user.id,
      tenantId: req.user.tenantId,
      email: body.email,
      role: body.role,
      // 2026-05-11 — names captured at invite time so the new user's
      // first dashboard load reads "Hi Pat" not "Hi Pjones."
      firstName: body.firstName,
      lastName: body.lastName,
    });
  }

  // Admin-sets-password path — skips the email invite round-trip. Useful
  // until a transactional email provider is wired up; lets the admin hand
  // credentials to a user in-person or over chat.
  @Post('users')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async createUserDirect(
    @Request() req: any,
    @Body(new ZodValidationPipe(CreateUserDirectInputSchema)) body: CreateUserDirectInput,
  ) {
    return this.onboarding.createUserDirect({
      inviterId: req.user.id,
      tenantId: req.user.tenantId,
      email: body.email,
      role: body.role,
      password: body.password,
      firstName: body.firstName,
      lastName: body.lastName,
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
  async acceptInvite(@Param('token') token: string, @Body(new ZodValidationPipe(AcceptInviteInputSchema)) body: AcceptInviteInput) {
    return this.onboarding.acceptInvite({ token, password: body.password });
  }
}
