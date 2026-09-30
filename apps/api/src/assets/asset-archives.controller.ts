import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AppRole } from '@cms/database';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { auditActorFields } from '../audit/audit-actor';
import { AssetArchivesService } from './asset-archives.service';

@Controller('api/v1/assets/download-archive')
export class AssetArchivesController {
  constructor(private readonly archives: AssetArchivesService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
    AppRole.RESTRICTED_VIEWER,
  )
  prepare(
    @Request() req: { user: { tenantId: string; [key: string]: unknown } },
    @Body() body: { assetIds: string[] },
  ) {
    return this.archives.prepare(
      String(req.user.tenantId),
      auditActorFields(req),
      body?.assetIds,
    );
  }

  // Browser attachment requests cannot send the session's Authorization
  // header. This consumes a 60-second, single-use random capability issued
  // by the guarded POST; it never accepts file URLs or a user JWT in a URL.
  @Get(':ticket')
  download(@Param('ticket') ticket: string, @Res() res: Response) {
    return this.archives.download(ticket, res);
  }
}
