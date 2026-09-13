import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../../auth/auth.module';
import { SocialController } from './social.controller';
import { SocialOAuthController } from './social-oauth.controller';
import { SocialService } from './social.service';
import { SocialSyncCron } from './social-sync.cron';

/**
 * SocialModule (2026-09-12) — Instagram + Facebook Page.
 *
 * Replaces the two "Coming soon" App-Library stubs with a real connector.
 * DORMANT UNTIL CONFIGURED, the same way BillingModule is dormant without
 * STRIPE_SECRET_KEY: with no INSTAGRAM_APP_ID / META_APP_ID the module still
 * loads, `/status` answers `{ enabled: false, missing: [...] }`, `/authorize`
 * answers 503 with a sentence an operator can act on, and nothing throws at
 * boot.
 *
 * RedisService (for the OAuth state nonce) and LeaderLeaseService (for the
 * cron) both come from the @Global RealtimeModule, so neither needs importing
 * here — same as CleverModule.
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [SocialController, SocialOAuthController],
  providers: [SocialService, SocialSyncCron],
  exports: [SocialService],
})
export class SocialModule {}
