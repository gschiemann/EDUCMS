import { Module, Global } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookDispatchService } from './webhook-dispatch.service';
import { WebhookRetryWorker } from './webhook-retry.worker';

/**
 * Global so the dispatch service can be injected wherever events fire
 * (emergency.controller, panic-content, future playlist publishes)
 * without each module re-importing it.
 *
 * WebhookRetryWorker is a process-internal background service (P1-5) that
 * re-delivers failed deliveries on a backoff. Not exported — nothing
 * injects it; it self-schedules via OnModuleInit.
 */
@Global()
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookDispatchService, WebhookRetryWorker],
  exports: [WebhooksService, WebhookDispatchService],
})
export class WebhooksModule {}
