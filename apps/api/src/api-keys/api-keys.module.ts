import { Module, Global } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { AuditActorInterceptor } from '../audit/audit-actor.interceptor';
import { AuditActorPrismaHook } from '../audit/audit-actor.hook';

/**
 * Global so JwtAuthGuard can inject ApiKeysService for the
 * `vos_<32hex>` Bearer-token fall-through path without each
 * controller's module re-importing it.
 *
 * It also carries the API-key AUDIT ATTRIBUTION wiring (ACC-06 follow-up,
 * 2026-08-03) — the request-scoped actor interceptor and the Prisma hook that
 * stamps `AuditLog.apiKeyId`. Both belong to the api-key identity, and an
 * `APP_INTERCEPTOR` provider registered from any module is global in Nest, so
 * hanging them here keeps `app.module.ts` untouched.
 */
@Global()
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ApiKeysController],
  providers: [
    ApiKeysService,
    AuditActorPrismaHook,
    { provide: APP_INTERCEPTOR, useClass: AuditActorInterceptor },
  ],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}
