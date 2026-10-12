import { Module } from '@nestjs/common';
import { TelemetryController } from './telemetry.controller';
import { PlaybackCapabilityController } from './playback-capability.controller';
import { PlaybackDemotionService } from './playback-demotion.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { EmailModule } from '../email/email.module';

/**
 * Unified player telemetry (2026-09-02, efficiency program P0-1).
 *
 * `PrismaService`, `RedisService` and `NotificationsService` come from
 * `@Global()` modules (PrismaModule / RealtimeModule / NotificationsModule),
 * the same way `ScreensController` gets them. Registered from
 * `app.module.ts` — this codebase has no `screens.module.ts`; every
 * controller is listed there directly, and every `@Controller()` carries its
 * own `api/v1` prefix (there is no `setGlobalPrefix`; see
 * controller-prefix.spec.ts).
 *
 * WebsocketSignerService is provided LOCALLY (it is only provided at the
 * AppModule level, which a feature module cannot see — same boot trap the
 * display / gpio / fitness modules document). EmailModule supplies the
 * PlatformAlertMailer for the platform-owner stutter alert.
 */
@Module({
  imports: [EmailModule],
  // PlaybackCapabilityController (2026-10-11): the per-screen playback
  // evidence + capability profile (video guarantee step 4), plus the
  // "Try full quality again" action (2026-10-12, steps 6/7).
  controllers: [TelemetryController, PlaybackCapabilityController],
  providers: [PlaybackDemotionService, WebsocketSignerService],
  exports: [PlaybackDemotionService],
})
export class TelemetryModule {}
