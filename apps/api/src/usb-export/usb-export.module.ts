import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { UsbExportController } from './usb-export.controller';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [UsbExportController],
})
export class UsbExportModule {}
