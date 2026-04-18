import { Controller, Get, Post, Param, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

@Controller('api/v1/notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  async list(@Request() req: any, @Query('limit') limit?: string) {
    const userId = req.user.id;
    const tenantId = req.user.tenantId;
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    const [items, unreadCount] = await Promise.all([
      this.service.listForUser({ tenantId, userId, limit: parsedLimit }),
      this.service.unreadCount(tenantId, userId),
    ]);
    return { items, unreadCount };
  }

  @Post(':id/read')
  async markRead(@Request() req: any, @Param('id') id: string) {
    return this.service.markRead(id, req.user.tenantId, req.user.id);
  }

  @Post('read-all')
  async markAll(@Request() req: any) {
    return this.service.markAllRead(req.user.tenantId, req.user.id);
  }
}
