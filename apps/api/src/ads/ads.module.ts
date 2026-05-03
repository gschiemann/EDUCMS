import { Module } from '@nestjs/common';
import { AdsController } from './ads.controller';
import { AdsService } from './ads.service';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * AdsModule — Sprint 8d. Programmatic display advertising. Operators
 * connect a network (Hivestack / Vistar / Place Exchange / etc.),
 * earn revenue per impression, we take a 10-15% transaction fee.
 *
 * K-12 tenants are blocked from connecting third-party ad networks
 * (k12Forbidden flag in ad-network.ts). They can still run "house-only"
 * ads (their own creatives, no rev share — same as the existing
 * StreamAdSlot path).
 */
@Module({
  imports: [PrismaModule],
  controllers: [AdsController],
  providers: [AdsService],
  exports: [AdsService],
})
export class AdsModule {}
