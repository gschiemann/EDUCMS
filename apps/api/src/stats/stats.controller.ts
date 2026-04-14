import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('api/v1/stats')
export class StatsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('overview')
  async getOverview() {
    const totalScreens = await this.prisma.client.screen.count();
    const onlineScreens = await this.prisma.client.screen.count({ where: { status: 'ONLINE' } });
    const offlineScreens = totalScreens - onlineScreens;
    const activePlaylists = await this.prisma.client.playlist.count();

    const emergencyStatus = 'CLEAR';

    return {
      totalScreens,
      onlineScreens,
      offlineScreens,
      activePlaylists,
      emergencyStatus
    };
  }
}
