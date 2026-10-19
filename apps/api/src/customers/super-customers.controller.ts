import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CustomerBusinessService } from './customer-business.service';
import { INVOICE_PDF_LIMIT } from './customer-invoice-storage.service';
import { Throttle } from '@nestjs/throttler';
import { AppRole } from '@cms/database';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { CustomerConsoleService } from './customer-console.service';
import { parseListQuery } from './customer-console.policy';

const actorOf = (req: any): string | null => req?.user?.userId ?? req?.user?.id ?? null;

/**
 * CUSTOMER MANAGEMENT CONSOLE (2026-10-10) — /api/v1/super/customers/*.
 *
 * SUPER_ADMIN ONLY, at the class: JwtAuthGuard proves who is calling, RbacGuard
 * refuses every other role (DISTRICT_ADMIN included — a customer can never
 * read another customer's roster, licenses or invoices through here).
 *
 * Every write lands in ONE transaction with an AuditLog row carrying
 * before / after / changed (CUSTOMER_* actions, on the customer's own tenant).
 */
@Controller('api/v1/super/customers')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles(AppRole.SUPER_ADMIN)
export class SuperCustomersController {
  constructor(private readonly customers: CustomerConsoleService, private readonly business?: CustomerBusinessService) {}

  /** The roster: server-side search, filters, sort and pagination. */
  @Get()
  list(@Query() query: Record<string, unknown>) {
    return this.customers.list(parseListQuery(query ?? {}));
  }

  /** Create an organisation + its license + a single-use owner link. */
  @Post()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  create(@Body() body: unknown, @Req() req: any) {
    return this.customers.createCustomer(body, actorOf(req));
  }

  @Get('invoices')
  invoices(@Query() query: Record<string, unknown>) { return this.business!.listInvoices(query ?? {}); }

  @Post(':id/card-seats')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  cardSeats(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown, @Req() req: any) { return this.business!.cardSeats(id, body, req.user); }

  @Get(':id/payment-summary')
  paymentSummary(@Param('id', new ParseUUIDPipe()) id: string) { return this.business!.paymentSummary(id); }

  @Patch(':id/branding')
  branding(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown, @Req() req: any) { return this.business!.updateBranding(id, body, req.user); }

  @Post(':id/starter-link/email')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  emailStarterLink(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown, @Req() req: any) { return this.business!.emailStarterLink(id, body, req.user); }

  @Post(':id/invites')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  invite(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown, @Req() req: any) { return this.business!.invite(id, body, req.user); }

  @Post(':id/locations')
  createLocation(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown, @Req() req: any) { return this.business!.createLocation(id, body, req.user); }

  @Patch(':id/locations/:locationId/allocation')
  allocate(@Param('id', new ParseUUIDPipe()) id: string, @Param('locationId', new ParseUUIDPipe()) locationId: string, @Body() body: unknown, @Req() req: any) { return this.business!.allocate(id, locationId, body, actorOf(req)); }

  @Post(':id/invoices/:invoiceId/pdf')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: INVOICE_PDF_LIMIT, files: 1 } }))
  uploadPdf(@Param('id', new ParseUUIDPipe()) id: string, @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string, @UploadedFile() file: Express.Multer.File, @Req() req: any) { return this.business!.uploadPdf(id, invoiceId, file, actorOf(req)); }

  @Get(':id/invoices/:invoiceId/pdf')
  downloadPdf(@Param('id', new ParseUUIDPipe()) id: string, @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string, @Req() req: any) { return this.business!.downloadPdf(id, invoiceId, actorOf(req)); }

  @Get(':id/invoices/:invoiceId/document')
  invoiceDocument(@Param('id', new ParseUUIDPipe()) id: string, @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string) { return this.business!.invoiceDocument(id, invoiceId); }

  @Get(':id')
  detail(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.customers.detail(id);
  }

  /** Licenses, price per screen, plan, billing method, renewal date, PO number, notes, status (not suspension). */
  @Patch(':id/license')
  updateLicense(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown, @Req() req: any) {
    return this.customers.updateLicense(id, body, actorOf(req));
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  suspend(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: { reason?: unknown } | undefined, @Req() req: any) {
    return this.customers.setSuspended(id, true, body?.reason, actorOf(req));
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  reactivate(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: any) {
    return this.customers.setSuspended(id, false, null, actorOf(req));
  }

  @Post(':id/invoices')
  createInvoice(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown, @Req() req: any) {
    return this.customers.createInvoice(id, body, actorOf(req));
  }

  @Patch(':id/invoices/:invoiceId')
  updateInvoice(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    return this.customers.updateInvoice(id, invoiceId, body, actorOf(req));
  }

  /** A fresh single-use owner link (earlier links for the same owner stop working). */
  @Post(':id/starter-link')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  starterLink(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: any) {
    return this.customers.issueStarterLink(id, actorOf(req), req?.user ?? null);
  }
}
