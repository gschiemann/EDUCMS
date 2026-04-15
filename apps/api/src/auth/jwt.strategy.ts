import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'dev_only_jwt_secret_CHANGE_ME',
    });
  }

  async validate(payload: any) {
    // Expose these via req.user
    return { userId: payload.sub, tenantId: payload.tenantId, role: payload.role };
  }
}
