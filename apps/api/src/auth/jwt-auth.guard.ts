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
      // Decode and verify via standard NestJS JWT Service
      const payload = await this.jwtService.verifyAsync(token, {
        // sec-fix(wave1) #2: throws at boot in prod if JWT_SECRET is unset.
        secret: requireSecret('JWT_SECRET', { devFallback: 'dev_only_jwt_secret_CHANGE_ME' }),
      });

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