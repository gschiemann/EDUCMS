/**
 * GpioModule — Goodview EP6N GPIO IN/OUT REST + service surface.
 *
 * Service is exported so EmergencyController can call
 * GpioService.driveStatusLampForEmergency() on tenant-wide
 * trigger / all-clear without an HTTP round-trip.
 */

import { Module } from '@nestjs/common';

import { GpioController } from './gpio.controller';
import { GpioService } from './gpio.service';

@Module({
  controllers: [GpioController],
  providers: [GpioService],
  exports: [GpioService],
})
export class GpioModule {}
