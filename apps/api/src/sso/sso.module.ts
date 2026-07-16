import { Module } from '@nestjs/common';
import { SsoService } from './sso.service';
import { SsoController } from './sso.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  // RealtimeModule provides RedisService — used to make OIDC login state
  // multi-replica safe (S9). PrismaModule + AuthModule as before.
  imports: [PrismaModule, AuthModule, RealtimeModule],
  providers: [SsoService],
  controllers: [SsoController],
  exports: [SsoService],
})
export class SsoModule {}
