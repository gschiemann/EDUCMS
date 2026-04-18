import { Module, Global } from '@nestjs/common';
import { LicenseService } from './license.service';
import { LicenseController } from './license.controller';
import { SuperLicenseController } from './super-license.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [LicenseService],
  controllers: [LicenseController, SuperLicenseController],
  exports: [LicenseService],
})
export class LicenseModule {}
