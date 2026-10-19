import { CustomerBusinessService } from './customer-business.service';
import { Controller, Get, Param, ParseUUIDPipe, Request, UseGuards } from '@nestjs/common';
import { AppRole } from '@cms/database';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { CustomerConsoleService } from './customer-console.service';

/**
 * GET /api/v1/billing/account — the customer's OWN billing arrangement, for
 * their Settings → Billing page: whether card checkout is offered at all
 * (CARD / no license) or the account is billed by invoice / purchase order
 * (ARC) or comp'd, plus — for an invoice-billed organisation — its PO number,
 * renewal date and the invoices ARC has sent.
 *
 * The organisation is ALWAYS the caller's own (req.user.tenantId, walked up to
 * its top-level organisation); there is no id to aim at anyone else's.
 */
@Controller('api/v1/billing')
@UseGuards(JwtAuthGuard, RbacGuard)
export class CustomerBillingController {
  constructor(private readonly customers: CustomerConsoleService, private readonly business?: CustomerBusinessService) {}

  @Get('account/invoices/:invoiceId/pdf')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  invoicePdf(@Param('invoiceId', new ParseUUIDPipe()) invoiceId: string, @Request() req: any) {
    return this.business!.ownDownloadPdf(req.user.tenantId, invoiceId, req.user.userId ?? req.user.id ?? null);
  }

  @Get('account')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  account(@Request() req: any) {
    return this.customers.billingAccount(req.user.tenantId);
  }
}
