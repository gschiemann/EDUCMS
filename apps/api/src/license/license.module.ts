import { Module, Global } from '@nestjs/common';
import { LicenseService } from './license.service';
import { LicenseController } from './license.controller';
import { SuperLicenseController } from './super-license.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Global()
@Module({
  // AuthModule re-exports JwtModule so JwtAuthGuard resolves JwtService.
  // RedisService (also needed by JwtAuthGuard) comes from the now-@Global
  // RealtimeModule.
  imports: [PrismaModule, AuthModule],
  providers: [LicenseService],
  controllers: [LicenseController, SuperLicenseController],
  exports: [LicenseService],
})
export class LicenseModule {}
