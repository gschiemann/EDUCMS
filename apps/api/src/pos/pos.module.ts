import { Module } from '@nestjs/common';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * PosModule — Sprint 8d. POS catalog sync framework. Connects gym /
 * bar / restaurant / retail tenants to their POS so menu boards
 * auto-update from the live catalog. Per-provider sync handlers slot
 * into `apps/api/src/pos/providers/<id>.ts` once OAuth apps are
 * registered with each vendor.
 */
@Module({
  imports: [PrismaModule],
  controllers: [PosController],
  providers: [PosService],
  exports: [PosService],
})
export class PosModule {}
