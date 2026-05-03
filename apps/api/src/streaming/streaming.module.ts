import { Module } from '@nestjs/common';
import { StreamingController } from './streaming.controller';
import { StreamingService } from './streaming.service';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * StreamingModule — Sprint 8c.
 *
 * Wires the streaming framework into the API. Imported from
 * `app.module.ts`. Adds /streaming/* endpoints under /api/v1.
 */
@Module({
  imports: [PrismaModule],
  controllers: [StreamingController],
  providers: [StreamingService],
  exports: [StreamingService],
})
export class StreamingModule {}
