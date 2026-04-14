import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RbacGuard } from './rbac.guard';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || (() => {
        if (process.env.NODE_ENV === 'production') throw new Error('CRITICAL: JWT_SECRET missing in production');
        return 'dev_secret';
      })(),
      signOptions: { expiresIn: '15m' }, // Short-lived AT mapping
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RbacGuard],
  exports: [AuthService, JwtAuthGuard, RbacGuard, JwtModule],
})
export class AuthModule {}
