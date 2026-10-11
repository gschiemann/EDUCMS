import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { SupportAccessService } from './support-access.service';
import { SupportAccessInterceptor } from './support-access.interceptor';
import { SupportAccessController } from './support-access.controller';
import { SuperSupportAccessController } from './super-support-access.controller';

/**
 * CUSTOMER-APPROVED SUPPORT ACCESS (2026-10-11).
 *
 * @Global so TenantsController (the switcher) and the customer console can
 * inject SupportAccessService without importing this module, and so the
 * APP_INTERCEPTOR registered here is a single, always-on gate. NotificationsModule
 * is @Global already. `support-access.module.spec.ts` pins the registration.
 */
@Global()
@Module({
  imports: [PrismaModule, AuthModule, EmailModule],
  controllers: [SupportAccessController, SuperSupportAccessController],
  providers: [SupportAccessService, { provide: APP_INTERCEPTOR, useClass: SupportAccessInterceptor }],
  exports: [SupportAccessService],
})
export class SupportAccessModule {}
