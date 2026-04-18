import { Global, Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './jwt.strategy';
import { PrismaModule } from '../prisma/prisma.module';

// @Global so JwtService (re-exported via JwtModule) is available
// everywhere JwtAuthGuard is used. Pairs with the @Global on
// RealtimeModule (provides RedisService — the guard's other dep).
// Without these, every feature module that gates an endpoint would
// have to import AuthModule + RealtimeModule explicitly — easy to
// forget and produces opaque "UnknownDependenciesException" at boot.
@Global()
@Module({
  imports: [
    PrismaModule,
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'dev_only_jwt_secret_CHANGE_ME',
      signOptions: { expiresIn: '1h' },
    }),
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
