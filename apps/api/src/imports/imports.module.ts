import { Module } from '@nestjs/common';
import { ImportsController } from './imports.controller';
import { ImportStagingSweepCron } from './import-staging-sweep.cron';
import { PrismaModule } from '../prisma/prisma.module';
import { RasterModule } from './raster/raster.module';
import { SupabaseStorageService } from '../storage/supabase-storage.service';

/**
 * ImportsModule — the design-import pipeline (PowerPoint / PDF / image →
 * editable or appearance-preserving templates). See imports.controller.ts for
 * the request path and `docs/design/proposals/2026-09-15-template-import-audit/`
 * for the audit and plan this module is being rebuilt against.
 *
 * LeaderLeaseService is not imported here: RealtimeModule is @Global and
 * exports it, so the sweep's @Optional() injection resolves without this
 * module depending on realtime. That also keeps the sweep constructible bare
 * in a spec.
 */
@Module({
  imports: [PrismaModule, RasterModule],
  controllers: [ImportsController],
  providers: [SupabaseStorageService, ImportStagingSweepCron],
})
export class ImportsModule {}
