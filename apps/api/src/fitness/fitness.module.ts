import { Module } from '@nestjs/common';
import { StickControlController } from './stick-control.controller';
import { YoutubeLiveController } from './youtube-live.controller';

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
 * Dependencies:
 *   PrismaModule and RealtimeModule are both @Global(), so
 *   PrismaService, RedisService, and WebsocketSignerService are
 *   available here without explicit imports. JwtAuthGuard and
 *   RbacGuard are also provided globally in AppModule.
 *
 * Phase-2 additions (pending Prisma migration):
 *   • Import PrismaModule explicitly once the `Stick` model lands.
 *   • Add StickService to providers for business-logic isolation.
 *   • Add FitnessScheduleController for gym-zone schedule management.
 */
@Module({
  controllers: [StickControlController, YoutubeLiveController],
})
export class FitnessModule {}
