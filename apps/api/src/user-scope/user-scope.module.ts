import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { UserScopeService } from './user-scope.service';
import { UserScopeInterceptor } from './user-scope.interceptor';
import { UserAccessController } from './user-access.controller';

/**
 * USER SCOPING (2026-10-11) — more than one location per person, and limits
 * to specific screens / screen groups.
 *
 * @Global so the switcher (TenantsController) and the People routes can inject
 * UserScopeService without importing this module, and so the APP_INTERCEPTOR
 * registered here is a single, always-on gate. `user-scope.module.spec.ts`
 * pins the registration and `app.module` importing it — a list route that
 * narrows with `req.userScope` relies on the interceptor having run.
 */
@Global()
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [UserAccessController],
  providers: [UserScopeService, { provide: APP_INTERCEPTOR, useClass: UserScopeInterceptor }],
  exports: [UserScopeService],
})
export class UserScopeModule {}
