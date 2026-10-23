import { Module } from '@nestjs/common';
import { KeyRotationRewrapService } from './key-rotation-rewrap.service';
import { KeyRotationController } from './key-rotation.controller';

/**
 * Secret-rotation window support (`security/key-ring.ts`): the leader-leased
 * boot re-wrap of stored credential envelopes plus the SUPER_ADMIN trigger.
 * PrismaModule and RealtimeModule (LeaderLeaseService) are both @Global.
 */
@Module({
  providers: [KeyRotationRewrapService],
  controllers: [KeyRotationController],
  exports: [KeyRotationRewrapService],
})
export class KeyRotationModule {}
