import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AiModule } from '../../ai/ai.module';
import { DesignerJobsService } from './designer-jobs.service';
import { DesignerJobsWorker } from './designer-jobs.worker';

/**
 * DesignerJobsModule — background AI Designer generation (2026-09-23).
 *
 * `DesignerJobsService` is exported for TemplatesController (registered in AppModule), which owns
 * the four `generate-designer/jobs` endpoints. `DesignerJobsWorker` runs the queue in-process on
 * every replica; it needs AiService, which AiModule exports (the same singleton the sync endpoint
 * uses — Nest modules are singletons, importing AiModule twice does not make a second one).
 */
@Module({
  imports: [PrismaModule, AiModule],
  providers: [DesignerJobsService, DesignerJobsWorker],
  exports: [DesignerJobsService],
})
export class DesignerJobsModule {}
