import { Module } from '@nestjs/common';
import { DataSourceController } from './data-source.controller';
import { DataSourceService } from './data-source.service';
import { DataSourceRateLimiter } from './data-source-rate-limiter';

/**
 * Phase 3 — "Custom data" (REST/JSON + Google-Sheet CSV) feed proxy.
 * PrismaService is provided globally via PrismaModule (imported in
 * AppModule), so only the controller + the feature's own providers are
 * declared here — same shape as BrandingModule.
 */
@Module({
  controllers: [DataSourceController],
  providers: [DataSourceService, DataSourceRateLimiter],
})
export class DataSourceModule {}
