import { Module } from '@nestjs/common';
import { PlayerOtaController } from './player-ota.controller';

@Module({ controllers: [PlayerOtaController] })
export class PlayerOtaModule {}
