import { Module, Global } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookDispatchService } from './webhook-dispatch.service';

/**
 * Global so the dispatch service can be injected wherever events fire
 * (emergency.controller, panic-content, future playlist publishes)
 * without each module re-importing it.
 */
@Global()
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookDispatchService],
  exports: [WebhooksService, WebhookDispatchService],
})
export class WebhooksModule {}
