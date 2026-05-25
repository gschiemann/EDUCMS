import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { WebhooksService } from './webhooks.service';

@Controller('api/v1/webhooks')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN)
export class WebhooksController {
  constructor(private readonly svc: WebhooksService) {}

  @Get()
  async list(@Req() req: any) {
    return this.svc.list(req.user.tenantId);
  }

  @Post()
  async create(
    @Req() req: any,
    @Body() body: { name?: string; url?: string; events?: string[] },
  ) {
    const actorUserId = req.user?.userId ?? req.user?.id ?? null;
    return this.svc.create({
      tenantId: req.user.tenantId,
      name: String(body.name || ''),
      url: String(body.url || ''),
      events: Array.isArray(body.events) ? body.events : [],
      actorUserId,
    });
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    const actorUserId = req.user?.userId ?? req.user?.id ?? null;
    return this.svc.remove({
      tenantId: req.user.tenantId,
      id,
      actorUserId,
    });
  }
}
