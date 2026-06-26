import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiKeyController } from './ai-key.controller';
import { AiAltTextService } from './ai-alt-text.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';

/**
 * AiModule — multi-provider content generation + BYOK key management.
 *
 * 2026-05-04: AiKeyController added so tenants can configure their own
 * Anthropic / OpenAI key in Settings → Integrations and route AI calls
 * through their account at their cost. AiService consults the tenant's
 * key first via PrismaService (global module — no providers entry
 * needed), falling back to ANTHROPIC_API_KEY.
 *
 * 2026-05-28: AiAltTextService added (audit P1-2). Vision-driven
 * alt-text generation for image assets. Imported by AssetsController
 * which hooks it into the upload completion path. Exported so the
 * controller can call it directly without re-wiring DI.
 *
 * 2026-06-26: AI image generation. AiService.generateImage persists the
 * decoded image as a normal Asset via SupabaseStorageService, so the
 * storage service is provided here (it's stateless — reads env, lazily
 * creates the client — same as the branding/license/imports modules that
 * provide it locally rather than from a shared module).
 */
@Module({
  controllers: [AiController, AiKeyController],
  providers: [AiService, AiAltTextService, SupabaseStorageService],
  exports: [AiService, AiAltTextService],
})
export class AiModule {}
