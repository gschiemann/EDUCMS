import { Module } from '@nestjs/common';

import { DisplayModule } from '../display/display.module';
import { ScheduledRebootController } from './scheduled-reboot.controller';
import { ScheduledRebootService } from './scheduled-reboot.service';

/** Opt-in scheduled restarts (2026-11-08). Kill switch: SCHEDULED_REBOOTS_DISABLED=1. */
@Module({
  imports: [DisplayModule],
  controllers: [ScheduledRebootController],
  providers: [ScheduledRebootService],
})
export class ScheduledRebootModule {}
