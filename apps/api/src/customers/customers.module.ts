import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { SampleDataModule } from '../sample-data/sample-data.module';
import { CustomerConsoleService } from './customer-console.service';
import { SuperCustomersController } from './super-customers.controller';
import { CustomerClaimController } from './customer-claim.controller';
import { CustomerBillingController } from './customer-billing.controller';
import { OrgSuspensionGate, OrgSuspensionInterceptor } from './org-suspension.interceptor';

/**
 * CUSTOMER MANAGEMENT CONSOLE (2026-10-10). LicenseService comes from the
 * @Global LicenseModule. The suspension interceptor is registered globally
 * here (APP_INTERCEPTOR may be provided by any module); it runs after each
 * route's guards, so it sees the verified principal.
 */
@Module({
  imports: [PrismaModule, AuthModule, OnboardingModule, SampleDataModule],
  controllers: [SuperCustomersController, CustomerClaimController, CustomerBillingController],
  providers: [
    CustomerConsoleService,
    OrgSuspensionGate,
    { provide: APP_INTERCEPTOR, useClass: OrgSuspensionInterceptor },
  ],
  exports: [CustomerConsoleService, OrgSuspensionGate],
})
export class CustomersModule {}
