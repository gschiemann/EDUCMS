import { Module } from '@nestjs/common';
import { StickControlController } from './stick-control.controller';
import { YoutubeLiveController } from './youtube-live.controller';
import { WebsocketSignerService } from '../security/websocket-signer.service';

/**
 * FitnessModule — backend scaffolding for the gym fitness features.
 *
 * Phase-1 scope:
 *   • StickControlController — in-memory stick registry + signed
 *     STICK_COMMAND pub/sub relay for Roku ECP / Fire TV ADB /
 *     Apple TV remote control via the kiosk's LAN relay.
 *   • YoutubeLiveController — server-side YouTube Live stream resolver
 *     at GET /api/v1/fitness/youtube-live/resolve. No API key required;
 *     extracts the live video ID from ytInitialData using regex strategies.
 *
 * DI notes (important):
 *   PrismaModule + RealtimeModule are both `@Global()`, so PrismaService
 *   and RedisService resolve automatically across modules. BUT
 *   WebsocketSignerService is only provided at the AppModule level —
 *   it has no `@Global()` marker — so any controller outside AppModule
 *   that injects it must also list it in its own module's providers.
 *   Missing this is what crashed Nest during bootstrap (before
 *   "API listening" could be logged) and tripped the Deploy Reliability
 *   docker-build smoke test on commit 212c542.
 *
 * Phase-2 additions (pending Prisma migration):
 *   • Import PrismaModule explicitly once the `Stick` model lands.
 *   • Add StickService to providers for business-logic isolation.
 *   • Add FitnessScheduleController for gym-zone schedule management.
 */
@Module({
  controllers: [StickControlController, YoutubeLiveController],
  providers: [WebsocketSignerService],
})
export class FitnessModule {}
