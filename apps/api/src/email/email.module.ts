import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { PlatformAlertMailer } from './platform-alert-mailer.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [EmailService, PlatformAlertMailer],
  exports: [EmailService, PlatformAlertMailer],
})
export class EmailModule {}
