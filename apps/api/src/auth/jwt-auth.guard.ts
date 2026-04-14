import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Authentication token missing');
    }

    try {
      // Decode and verify via standard NestJS JWT Service
      const payload = await this.jwtService.verifyAsync(token, {
          secret: process.env.JWT_SECRET || 'dev_secret'
      });
      
      // Assign the structured payload to Request object for RbacGuard to consume
      request['user'] = {
        id: payload.id,
        email: payload.email,
        role: payload.role,
        districtId: payload.districtId,
        schoolId: payload.schoolId,
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
