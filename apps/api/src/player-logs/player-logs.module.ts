import { Module } from '@nestjs/common';
import { PlayerLogsController } from './player-logs.controller';

/**
 * PlayerLogsModule — ingests diagnostic log uploads from the Android kiosk APK.
 *
 * DI notes:
 *   - PrismaModule is @Global(), so PrismaService resolves automatically.
 *   - This controller does NOT need WebsocketSignerService (unlike
 *     FitnessModule which crashed on boot for exactly this reason on
 *     2026-04-22). Do not add it here unless a future endpoint requires it.
 *   - ThrottlerGuard is APP_GUARD in AppModule — applies globally.
 *
 * Registration: added to AppModule.imports array.
 */
@Module({
  controllers: [PlayerLogsController],
})
export class PlayerLogsModule {}
