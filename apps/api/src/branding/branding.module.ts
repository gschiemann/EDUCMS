import { Module } from '@nestjs/common';
import { BrandingController } from './branding.controller';
import { BrandingScraperService } from './branding-scraper.service';
import { BrandingRateLimiter } from './branding-rate-limiter';
import { SupabaseStorageService } from '../storage/supabase-storage.service';

@Module({
  controllers: [BrandingController],
  providers: [BrandingScraperService, BrandingRateLimiter, SupabaseStorageService],
  // 2026-06-28 — export the scraper so TemplatesController (registered in
  // app.module.ts, which already imports BrandingModule) can inject it for the
  // Signage Concierge's POST /templates/concierge/reference/url endpoint
  // (paste a URL → scraped brand summary → ConciergeReference).
  exports: [BrandingScraperService],
})
export class BrandingModule {}
