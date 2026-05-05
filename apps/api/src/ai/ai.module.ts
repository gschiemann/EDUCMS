import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiKeyController } from './ai-key.controller';

/**
 * AiModule — multi-provider content generation + BYOK key management.
 *
 * 2026-05-04: AiKeyController added so tenants can configure their own
 * Anthropic / OpenAI key in Settings → Integrations and route AI calls
 * through their account at their cost. AiService consults the tenant's
 * key first via PrismaService (global module — no providers entry
 * needed), falling back to ANTHROPIC_API_KEY.
 */
@Module({
  controllers: [AiController, AiKeyController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
