import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

import { RedisService } from '../realtime/redis.service';
import { requireSecret } from '../security/required-secret';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private redisService: RedisService
  ) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Authentication token missing');
    }

    try {
      // Decode header WITHOUT verifying to learn which secret to use.
      // Device JWTs are signed with DEVICE_JWT_SECRET (kind: 'device');
      // user JWTs are signed with JWT_SECRET. Before this fix the guard
      // only tried JWT_SECRET, so /screens/:id/manifest requests carrying
      // a device token 401'd with 'Invalid or expired' — which surfaced
      // as 'unable to connect' on the paired browser player.
      const parts = token.split('.');
      let unverifiedKind: string | undefined;
      if (parts.length === 3) {
        try {
          const raw = Buffer.from(parts[1], 'base64url').toString('utf8');
          unverifiedKind = JSON.parse(raw)?.kind;
        } catch { /* malformed header — let verify throw below */ }
      }

      const isDeviceToken = unverifiedKind === 'device';
      const secret = isDeviceToken
        ? requireSecret('DEVICE_JWT_SECRET', { devFallback: 'dev_only_device_jwt_secret_CHANGE_ME' })
        : requireSecret('JWT_SECRET', { devFallback: 'dev_only_jwt_secret_CHANGE_ME' });

      const payload = await this.jwtService.verifyAsync(token, { secret });

      // THE BYPASS: Only check Redis if we are deployed to production.
      // Your start-dev.bat sets NODE_ENV=development, so this will safely skip locally.
      if (process.env.NODE_ENV === 'production') {
        try {
          const isRevoked = await this.redisService.sismember('jwt_revoked_list', token);
          if (isRevoked) {
            throw new UnauthorizedException('Session has been revoked due to role downgrade');
          }
        } catch (redisError) {
          // If the error is our own UnauthorizedException, re-throw it
          if (redisError instanceof UnauthorizedException) {
            throw redisError;
          }
          // Otherwise, Redis probably crashed or is unreachable.
          // Log it, but DO NOT block the user from logging in.
          console.warn('[JwtAuthGuard] Redis check failed, allowing token:', redisError.message);
        }
      }

      if (isDeviceToken) {
        // Device identity — consumed by controllers that care (manifest,
        // cache-status, emergency-assets). kind='device' + sub=screenId
        // is the contract; no role / tenant assumptions here.
        request['user'] = {
          id: payload.sub,
          sub: payload.sub,
          kind: 'device',
          tenantId: payload.tenantId,
          fp: payload.fp,
        };
      } else {
        // Assign the structured payload to Request object for RbacGuard to consume
        // Token contains: { sub: user.id, tenantId, role } — see auth.service.ts
        request['user'] = {
          id: payload.sub,
          email: payload.email,
          role: payload.role,
          tenantId: payload.tenantId,
          districtId: payload.districtId,
          schoolId: payload.schoolId || payload.tenantId,
          canTriggerPanic: payload.canTriggerPanic,
        };
      }
    } catch (error) {
      // Catching the specific error allows us to see if it was a token issue or a Redis crash
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired authentication token');
    }
    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    // Standard Bearer token extraction
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}