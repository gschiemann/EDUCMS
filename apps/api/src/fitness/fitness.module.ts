import { Module } from '@nestjs/common';
import { StickControlController } from './stick-control.controller';
import { WebsocketSignerService } from '../security/websocket-signer.service';

/**
 * FitnessModule — backend scaffolding for the gym fitness features.
 *
 * Phase-1 scope:
 *   • StickControlController — in-memory stick registry + signed
 *     STICK_COMMAND pub/sub relay for Roku ECP / Fire TV ADB /
 *     Apple TV remote control via the kiosk's LAN relay.
 *
 * REMOVED 2026-08-24 — YoutubeLiveController. It served
 * `GET /api/v1/fitness/youtube-live/resolve`, which fetched a YouTube
 * channel page server-side and regex-extracted the current live video id
 * out of the `ytInitialData` blob ("the same approach used by yt-dlp") so
 * a gym screen could embed it. That is scraping a consumer service to
 * obtain venue programming: YouTube's terms prohibit public screening,
 * so no gym could lawfully show the result. The provider catalog now
 * marks `youtube-live` BLOCKED, and the widget stopped calling the route
 * — but leaving it mounted meant the API still brokered the exact thing
 * the catalog refuses. Removed rather than deprecated, because a route
 * that exists is a route someone re-wires.
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
  controllers: [StickControlController],
  providers: [WebsocketSignerService],
})
export class FitnessModule {}
