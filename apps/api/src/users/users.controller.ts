import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import * as argon2 from 'argon2';

@Controller('api/v1/users')
@UseGuards(JwtAuthGuard, RbacGuard)
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async list(@Request() req: any) {
    const tenantId = req.user.tenantId;
    const users = await this.prisma.client.user.findMany({
      where: { tenantId },
      select: { id: true, email: true, role: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return users;
  }

  @Post()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN)
  async create(@Request() req: any, @Body() body: { email: string; password: string; role: string }) {
    const tenantId = req.user.tenantId;
    const passwordHash = await argon2.hash(body.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    const user = await this.prisma.client.user.create({
      data: {
        tenantId,
        email: body.email,
        passwordHash,
        role: body.role,
      },
      select: { id: true, email: true, role: true, createdAt: true },
    });

    return user;
  }

  @Put(':id/role')
  @RequireRoles(AppRole.SUPER_ADMIN)
  async updateRole(@Request() req: any, @Param('id') id: string, @Body() body: { role: string }) {
    const tenantId = req.user.tenantId;

    // Ensure user belongs to same tenant
    const user = await this.prisma.client.user.findFirst({
      where: { id, tenantId },
    });
    if (!user) return { error: 'User not found' };

    const updated = await this.prisma.client.user.update({
      where: { id },
      data: { role: body.role },
      select: { id: true, email: true, role: true },
    });

    return updated;
  }

  @Delete(':id')
  @RequireRoles(AppRole.SUPER_ADMIN)
  async remove(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.user.tenantId;

    // Prevent self-deletion
    if (id === req.user.id) {
      return { error: 'Cannot delete your own account' };
    }

    const user = await this.prisma.client.user.findFirst({
      where: { id, tenantId },
    });
    if (!user) return { error: 'User not found' };

    await this.prisma.client.user.delete({ where: { id } });
    return { deleted: true };
  }
}
