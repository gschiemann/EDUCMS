/**
 * BugsModule — wires the one-click Bug Reporter backend together.
 *
 * Controller is registered via the AppModule's controllers array,
 * NOT here, to match the rest of the codebase's pattern (audit /
 * screens / playlists / templates are all registered the same way).
 * This module exists so the two services (BugEnrichmentService +
 * BugAnalyzerService) can be provided + exported for any future
 * caller (e.g. a cron-driven bulk re-analyzer) without duplicating
 * DI wiring.
 */

import { Module } from '@nestjs/common';

import { BugAnalyzerService } from './bug-analyzer.service';
import { BugEnrichmentService } from './bug-enrichment.service';
// 2026-05-27 — operator-facing email notifications on bug file /
// fix-proposed / fix-shipped. EmailModule already exports its
// service so we just import to make the DI graph resolve when
// BugsController injects EmailService.
import { EmailModule } from '../email/email.module';

@Module({
  imports: [EmailModule],
  providers: [BugEnrichmentService, BugAnalyzerService],
  exports: [BugEnrichmentService, BugAnalyzerService],
})
export class BugsModule {}
