import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { OfflineScreenScanner } from './offline-screen-scanner';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, OfflineScreenScanner],
  exports: [NotificationsService],
})
export class NotificationsModule {}
