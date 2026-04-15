import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

import { RedisService } from '../realtime/redis.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private redisService: RedisService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Authentication token missing');
    }

    try {
      // Decode and verify via standard NestJS JWT Service
      const payload = await this.jwtService.verifyAsync(token, {
          secret: process.env.JWT_SECRET || 'dev_only_jwt_secret_CHANGE_ME'
      });
      
      // RT-03 Mitigation: Check if the session is revoked
      const isRevoked = await this.redisService.sismember('jwt_revoked_list', token);
      if (isRevoked) {
        throw new UnauthorizedException('Session has been revoked due to role downgrade');
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
    } catch {
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
