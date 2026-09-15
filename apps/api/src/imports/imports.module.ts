import { Module } from '@nestjs/common';
import { ImportsController } from './imports.controller';
import { ImportJobsController } from './import-jobs.controller';
import { ImportPrepareService } from './import-prepare.service';
import { ImportCommitService } from './import-commit.service';
import { RasterModule } from './raster/raster.module';
import { ImportStagingSweepCron } from './import-staging-sweep.cron';
import { PrismaModule } from '../prisma/prisma.module';
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
  controllers: [ImportsController, ImportJobsController],
  providers: [SupabaseStorageService, ImportStagingSweepCron, ImportPrepareService, ImportCommitService],
})
export class ImportsModule {}
