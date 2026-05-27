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

@Module({
  providers: [BugEnrichmentService, BugAnalyzerService],
  exports: [BugEnrichmentService, BugAnalyzerService],
})
export class BugsModule {}
