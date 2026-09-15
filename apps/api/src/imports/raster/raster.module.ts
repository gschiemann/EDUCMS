import { Module } from '@nestjs/common';
import { PdfRasterService } from './pdf-raster.service';

/**
 * Server-side page rasterization for design imports.
 *
 * Its own module rather than a provider bolted onto `ImportsModule` because
 * nothing about it is import-specific: a job runner, a preview endpoint or a
 * thumbnail backfill all want the same service, and none of them should have
 * to drag the imports controller's dependencies in to get it.
 */
@Module({
  providers: [PdfRasterService],
  exports: [PdfRasterService],
})
export class RasterModule {}
