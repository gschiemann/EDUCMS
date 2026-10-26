import { Global, Module } from '@nestjs/common';
import { NotificationsController, NotificationsPublicController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { OfflineScreenScanner } from './offline-screen-scanner';
import { EmailModule } from '../email/email.module';
import { CustomerAlertEmailsService } from './customer-alerts/customer-alert-emails.service';
import { PostRestartFleetCheckService } from './fleet-alarms/post-restart-fleet-check.service';
import { DeviceCredentialRefusalAlarmService } from './fleet-alarms/device-credential-refusal-alarm.service';
import { ScreenAttentionService } from './screen-attention/screen-attention.service';

@Global()
@Module({
  // 2026-10-23 — customer alert emails need EmailService + PlatformAlertMailer.
  imports: [EmailModule],
  controllers: [NotificationsController, NotificationsPublicController],
  providers: [
    NotificationsService,
    OfflineScreenScanner,
    CustomerAlertEmailsService,
    // 2026-10-23 — the owner's fleet alarms (owner-only, PlatformAlertMailer).
    PostRestartFleetCheckService,
    DeviceCredentialRefusalAlarmService,
    // 2026-10-24 — down / resting / dormant for the dashboard and the bell.
    ScreenAttentionService,
  ],
  exports: [NotificationsService, CustomerAlertEmailsService, ScreenAttentionService],
})
export class NotificationsModule {}
