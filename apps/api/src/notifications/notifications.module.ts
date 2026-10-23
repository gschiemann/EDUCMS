import { Global, Module } from '@nestjs/common';
import { NotificationsController, NotificationsPublicController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { OfflineScreenScanner } from './offline-screen-scanner';
import { EmailModule } from '../email/email.module';
import { CustomerAlertEmailsService } from './customer-alerts/customer-alert-emails.service';

@Global()
@Module({
  // 2026-10-23 — customer alert emails need EmailService + PlatformAlertMailer.
  imports: [EmailModule],
  controllers: [NotificationsController, NotificationsPublicController],
  providers: [NotificationsService, OfflineScreenScanner, CustomerAlertEmailsService],
  exports: [NotificationsService, CustomerAlertEmailsService],
})
export class NotificationsModule {}
