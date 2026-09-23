import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiKeyController } from './ai-key.controller';
import { AiAltTextService } from './ai-alt-text.service';
import { StockImageService } from './stock-image.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
// 2026-07-01 (launch-sprint #268 item 5, AUTO-GROUND) — the AI Designer
// enriches menu-ish briefs with the tenant's REAL, live-priced menu items
// instead of the model inventing plausible-sounding ones. PosModule exports
// MenuService (stateless — only depends on the global PrismaModule), and
// PosModule does NOT import AiModule, so this is a clean one-way import with
// no circular dependency.
import { PosModule } from '../pos/pos.module';
// 2026-09-22 — the live model catalog (data, not code), its daily vendor-feed sync, and the
// dollar-metered included allowance (per paired screen, pooled per organisation).
import { AiCatalogStoreService } from './ai-catalog-store.service';
import { AiModelSyncCron } from './ai-model-sync.cron';
import { AiCatalogController } from './ai-catalog.controller';
import { AiAllowanceService } from './ai-allowance.service';
import { AiUsageMeterService } from './ai-usage-meter.service';
// 2026-09-23 — the board renderer's client (the AI Designer's look-and-fix loop). Env-driven and
// stateless; OFF without RENDERER_URL (or with AI_DESIGN_REVIEW_DISABLED=1).
import { DesignerRendererClient } from './designer-renderer.client';

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
 *
 * 2026-06-28: IMAGERY wave. StockImageService gives EVERY tenant a free,
 * relevant stock photo (Pexels) by default on photo-archetype boards —
 * regardless of AI provider — with the AI photo as a one-tap upgrade. It's
 * stateless (reads PEXELS_API_KEY, plain fetch) and degrades to the themed
 * gradient when no key is set. Exported so the art-director path can resolve a
 * photo at generate time.
 */
@Module({
  imports: [PosModule],
  controllers: [AiController, AiKeyController, AiCatalogController],
  providers: [
    AiService,
    AiAltTextService,
    StockImageService,
    SupabaseStorageService,
    AiCatalogStoreService,
    AiModelSyncCron,
    AiAllowanceService,
    AiUsageMeterService,
    { provide: DesignerRendererClient, useFactory: () => new DesignerRendererClient() },
  ],
  exports: [AiService, AiAltTextService, StockImageService, AiAllowanceService, AiUsageMeterService],
})
export class AiModule {}
