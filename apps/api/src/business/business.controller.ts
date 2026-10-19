import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AppRole } from '@cms/database';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { BusinessService, type BusinessActor } from './business.service';
import { ProviderUsageService } from './provider-usage.service';

interface BusinessRequest {
  user?: { userId?: string; id?: string; tenantId?: string };
}
function actorOf(request: BusinessRequest): BusinessActor {
  const userId = request.user?.userId ?? request.user?.id;
  const tenantId = request.user?.tenantId;
  if (!userId || !tenantId)
    throw new ForbiddenException('A verified owner session is required.');
  return { userId, tenantId };
}

/** Platform finance is owner-only. Cost records belong to the business, never to a customer. */
@Controller('api/v1/super/business')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles(AppRole.SUPER_ADMIN)
export class BusinessController {
  constructor(
    private readonly business: BusinessService,
    private readonly providers: ProviderUsageService,
  ) {}

  @Get()
  report() {
    return this.business.report();
  }

  @Get('provider-usage')
  providerUsage() {
    return this.providers.getReport();
  }

  @Post('costs')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  createCost(@Body() body: unknown, @Req() request: BusinessRequest) {
    return this.business.createCost(body, actorOf(request));
  }

  @Patch('costs/:id')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  updateCost(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() request: BusinessRequest,
  ) {
    return this.business.updateCost(id, body, actorOf(request));
  }
}
