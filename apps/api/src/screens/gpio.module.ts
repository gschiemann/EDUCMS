/**
 * GpioModule — Goodview EP6N GPIO IN/OUT REST + service surface.
 *
 * Service is exported so EmergencyController can call
 * GpioService.driveStatusLampForEmergency() on tenant-wide
 * trigger / all-clear without an HTTP round-trip.
 *
 * 2026-05-27 — Boot-fix: GpioService injects WebsocketSignerService
 * (constructor param 3). WebsocketSignerService is provided at the
 * top level of app.module.ts but not inside its own module — so
 * GpioModule has to re-provide it locally for Nest DI to resolve.
 * The service is stateless (just reads DEVICE_SECRET_KEY at instance
 * time + computes HMACs) so a second instance is identical behavior
 * to the app-level one. PrismaModule + RealtimeModule are @Global so
 * PrismaService + RedisService resolve without explicit imports.
 *
 * Previous failure mode (deployment d2ef8bd7, 72b46a8b): API boot
 * threw "Nest can't resolve dependencies of the GpioService
 * (PrismaService, RedisService, ?)" — the ? was WebsocketSignerService.
 * Every commit after Agent C (df71ef6) failed at Railway boot until
 * this fix landed; the API stayed pinned on 4a229288 (Agent D) for
 * ~40 minutes.
 */

import { Module } from '@nestjs/common';

import { WebsocketSignerService } from '../security/websocket-signer.service';
import { GpioController } from './gpio.controller';
import { GpioService } from './gpio.service';

@Module({
  controllers: [GpioController],
  providers: [GpioService, WebsocketSignerService],
  exports: [GpioService],
})
export class GpioModule {}
