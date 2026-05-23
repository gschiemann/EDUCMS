import { Body, Controller, HttpCode, HttpStatus, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { LoginInputSchema, type LoginInput } from '@cms/api-types';
import { AuthService } from './auth.service';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RedisService } from '../realtime/redis.service';
import type { Request } from 'express';

@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private redisService: RedisService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('login')
  // Per-IP rate limit: 10 attempts per minute. argon2's cost slows brute
  // force but doesn't stop it; without a per-IP gate, credential stuffing
  // against a leaked email list runs unbounded. Matches signup's pattern
  // (5/min) but a touch looser since legitimate users sometimes mistype
  // their password 3-4 times before resetting. The global 600/min default
  // throttle covers nothing for credential attacks because attackers
  // rotate IPs; this PER-IP one is the real defense.
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async login(
    // Bounded shape — email is format-checked + length-capped (max 254
    // per RFC 5321), password length-capped (max 256). Pre-Zod the
    // body was `Record<string, any>`, which let a 10MB string reach
    // argon2.verify() and DoS the request thread for ~30s.
    @Body(new ZodValidationPipe(LoginInputSchema)) body: LoginInput,
  ) {
    const user = await this.authService.validateUser(body.email, body.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.authService.login(user, body.rememberMe);
  }

  /**
   * Server-side logout: revokes the bearer token by adding it to the Redis
   * revocation set, so JwtAuthGuard rejects it on the next request. Lane-1
   * P0 fix — previously "logout" was a pure client-side cookie clear and
   * the JWT remained valid for up to 30 days (rememberMe ceiling) even
   * after the user clicked "Log out."
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async logout(@Req() req: Request) {
    const [type, token] = req.headers.authorization?.split(' ') ?? [];
    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('No bearer token');
    }
    const pub = this.redisService.publisher;
    if (pub) {
      try {
        await pub.sadd('jwt_revoked_list', token);
        // 30 days = rememberMe ceiling — the JWT itself expires by then,
        // so the set never grows unboundedly. Resets each logout (acceptable).
        await pub.expire('jwt_revoked_list', 60 * 60 * 24 * 30);
      } catch {
        // Best-effort — if Redis is unreachable, the client still clears
        // local state. The user may retry /logout once Redis recovers.
      }
    }
    return { success: true };
  }
}
