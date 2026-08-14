/**
 * DisplayModule — screen display control (volume / brightness / blank / wake
 * / reboot) + scheduled on-off windows + vendor recipes.
 *
 * ⚠️ BOOT TRAP — WebsocketSignerService is re-provided LOCALLY on purpose.
 * It is a top-level provider in app.module.ts but is NOT inside a module, so
 * a feature module that injects it must provide it itself or Nest fails at
 * boot with "can't resolve dependencies of the DisplayService (PrismaService,
 * RedisService, ?)". That exact mistake pinned the API at Railway for ~40
 * minutes on 2026-05-27 (see the header of gpio.module.ts). The service is
 * stateless — it reads DEVICE_SECRET_KEY at construction and computes HMACs
 * — so a second instance behaves identically to the app-level one.
 *
 * PrismaModule and RealtimeModule are @Global, so PrismaService and
 * RedisService resolve without explicit imports.
 *
 * DisplayService is exported so the manifest builder's siblings (and any
 * future scheduled-action path) can reach it without an HTTP hop.
 */

import { Module } from '@nestjs/common';

import { WebsocketSignerService } from '../security/websocket-signer.service';
import { DisplayVendorRecipesController } from './display-recipes.controller';
import { DisplaySchedulesController } from './display-schedules.controller';
import { DisplayController } from './display.controller';
import { DisplayService } from './display.service';

@Module({
  controllers: [
    DisplayController,
    DisplaySchedulesController,
    DisplayVendorRecipesController,
  ],
  providers: [DisplayService, WebsocketSignerService],
  exports: [DisplayService],
})
export class DisplayModule {}
