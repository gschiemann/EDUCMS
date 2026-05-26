/**
 * MusicModule — backs MusicPlayerWidget config (SomaFM + NPR + OAuth
 * placeholders for Apple / Spotify for Business).
 *
 * Created 2026-05-25 (music-overhaul).
 */
import { Module } from '@nestjs/common';
import { MusicController } from './music.controller';
import { MusicService } from './music.service';

@Module({
  controllers: [MusicController],
  providers: [MusicService],
  exports: [MusicService],
})
export class MusicModule {}
