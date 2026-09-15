import { Module } from '@nestjs/common';
import { ImportJobsController } from './import-jobs.controller';
import { ImportPrepareService } from './import-prepare.service';
import { ImportCommitService } from './import-commit.service';
import { RasterModule } from './raster/raster.module';
import { ImportStagingSweepCron } from './import-staging-sweep.cron';
import { PrismaModule } from '../prisma/prisma.module';
import { SupabaseStorageService } from '../storage/supabase-storage.service';

/**
 * ImportsModule — the design-import pipeline (PowerPoint / PDF / image →
 * editable or appearance-preserving templates).
 *
 * The single-call `POST /imports/design` endpoint is gone. It converted and
 * committed in one request, which is why it could report "2 editable templates
 * (one per page)" for a three-page document: nothing ever showed the operator
 * the conversion, so nothing could contradict it. `ImportJobsController` is
 * prepare-then-commit, with the review in between. The audit that drove this
 * is under `docs/design/proposals/2026-09-15-template-import-audit/`.
 *
 * LeaderLeaseService is not imported here: RealtimeModule is @Global and
 * exports it, so the sweep's @Optional() injection resolves without this
 * module depending on realtime. That also keeps the sweep constructible bare
 * in a spec.
 */
@Module({
  imports: [PrismaModule, RasterModule],
  controllers: [ImportJobsController],
  providers: [SupabaseStorageService, ImportStagingSweepCron, ImportPrepareService, ImportCommitService],
})
export class ImportsModule {}
