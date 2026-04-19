import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { requireSecret } from '../security/required-secret';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // sec-fix(wave1) #2: no silent default in production.
      secretOrKey: requireSecret('JWT_SECRET', {
        devFallback: 'dev_only_jwt_secret_CHANGE_ME',
      }),
    });
  }

  async validate(payload: any) {
    // Expose these via req.user
    return { userId: payload.sub, tenantId: payload.tenantId, role: payload.role };
  }
}
