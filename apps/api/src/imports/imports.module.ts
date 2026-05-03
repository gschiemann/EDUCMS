import { Module } from '@nestjs/common';
import { ImportsController } from './imports.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { SupabaseStorageService } from '../storage/supabase-storage.service';

/**
 * ImportsModule — Canva / Slides / PowerPoint / Figma design-import
 * pipeline. See imports.controller.ts header for the stage-1 vs
 * stage-2 split + docs/CANVA_INTEGRATION.md for the full plan.
 */
@Module({
  imports: [PrismaModule],
  controllers: [ImportsController],
  providers: [SupabaseStorageService],
})
export class ImportsModule {}
