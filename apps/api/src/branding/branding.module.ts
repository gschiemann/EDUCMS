import { Module } from '@nestjs/common';
import { BrandingController } from './branding.controller';
import { BrandingScraperService } from './branding-scraper.service';
import { BrandingRateLimiter } from './branding-rate-limiter';
import { SupabaseStorageService } from '../storage/supabase-storage.service';

@Module({
  controllers: [BrandingController],
  providers: [BrandingScraperService, BrandingRateLimiter, SupabaseStorageService],
})
export class BrandingModule {}
