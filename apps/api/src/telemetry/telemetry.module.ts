import { Module } from '@nestjs/common';
import { TelemetryController } from './telemetry.controller';

/**
 * Unified player telemetry (2026-09-02, efficiency program P0-1).
 *
 * No providers of its own: `PrismaService` and `RedisService` both come
 * from `@Global()` modules (PrismaModule / RealtimeModule), the same way
 * `ScreensController` gets them. Registered from `app.module.ts` — this
 * codebase has no `screens.module.ts`; every controller is listed there
 * directly, and every `@Controller()` carries its own `api/v1` prefix
 * (there is no `setGlobalPrefix`; see controller-prefix.spec.ts).
 */
@Module({
  controllers: [TelemetryController],
})
export class TelemetryModule {}
