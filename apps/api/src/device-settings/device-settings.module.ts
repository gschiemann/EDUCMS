/**
 * DeviceSettingsModule — basic Android settings without device owner
 * (2026-10-18). The operator controller only; the heartbeat half is a plain
 * function (`device-settings.heartbeat.ts`) that `ScreensController` calls
 * with its own PrismaService, so the heartbeat route takes no new dependency.
 *
 * PrismaModule is @Global, so PrismaService resolves without an import.
 */

import { Module } from '@nestjs/common';

import { DeviceSettingsController } from './device-settings.controller';

@Module({
  controllers: [DeviceSettingsController],
})
export class DeviceSettingsModule {}
