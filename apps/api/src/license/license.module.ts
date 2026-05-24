import { Module, Global } from '@nestjs/common';
import { LicenseService } from './license.service';
import { LicenseController } from './license.controller';
import { SuperLicenseController } from './super-license.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
// SuperLicenseController.wipeAllAssets needs SupabaseStorageService for
// the bulk-remove + path-extract helpers. SupabaseStorageService is also
// registered in AppModule's providers but Nest's DI doesn't share
// non-exported providers across modules, so we list it here too — same
// pattern BrandingModule uses (branding.module.ts:9).
import { SupabaseStorageService } from '../storage/supabase-storage.service';

@Global()
@Module({
  // AuthModule re-exports JwtModule so JwtAuthGuard resolves JwtService.
  // RedisService (also needed by JwtAuthGuard) comes from the now-@Global
  // RealtimeModule.
  imports: [PrismaModule, AuthModule],
  providers: [LicenseService, SupabaseStorageService],
  controllers: [LicenseController, SuperLicenseController],
  exports: [LicenseService],
})
export class LicenseModule {}
