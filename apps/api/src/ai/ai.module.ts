import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

/**
 * AiModule — Claude-backed content generation. Direct fetch to
 * Anthropic's REST API; no SDK install. See ai.service.ts for the
 * intent catalog + cost / rate-limit guardrails.
 */
@Module({
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
