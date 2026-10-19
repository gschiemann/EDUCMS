import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AppRole, Prisma } from '@cms/database';
import { isReservedTenantSlug } from '@cms/api-types';
import { isValidEmail } from '../common/is-valid-email';
import { PrismaService } from '../prisma/prisma.service';
import { withDbRetry } from '../prisma/with-db-retry';
import {
  assertPoolCapacity,
  customerTree,
  poolUsage,
} from '../license/license-pool';
import { EmailService } from '../email/email.service';
import { LicenseService } from '../license/license.service';
import { StripeService, SeatChangeError } from '../billing/stripe.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import {
  SupportAccessService,
  Principal,
} from '../support-access/support-access.service';
import { derivePalette } from '../branding/color-utils';
import { CustomerConsoleService, asHttp } from './customer-console.service';
import {
  CustomerInvoiceStorageService,
  validateInvoicePdf,
} from './customer-invoice-storage.service';
import {
  INVOICE_STATUSES,
  parseCustomerLogoUrl,
  slugify,
} from './customer-console.policy';

function object(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new BadRequestException('A request body is required.');
  return body as Record<string, unknown>;
}
function text(value: unknown, max: number, required = false): string | null {
  if (value == null && !required) return null;
  if (
    typeof value !== 'string' ||
    value.trim().length > max ||
    (required && !value.trim())
  )
    throw new BadRequestException(
      `Text must be ${required ? '1' : '0'}–${max} characters.`,
    );
  return value.trim() || null;
}
const actorId = (actor: Principal) => actor.userId ?? actor.id ?? null;

@Injectable()
export class CustomerBusinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly console: CustomerConsoleService,
    private readonly license: LicenseService,
    private readonly onboarding: OnboardingService,
    private readonly support: SupportAccessService,
    private readonly stripe: StripeService,
    private readonly storage: CustomerInvoiceStorageService,
    private readonly email: EmailService,
  ) {}

  private async org(
    id: string,
    client: Prisma.TransactionClient = this.prisma.client,
  ) {
    const org = await client.tenant.findUnique({
      where: { id },
      include: { license: true },
    });
    if (!org || org.parentId)
      throw new NotFoundException('Customer not found.');
    return org;
  }
  private audit(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string | null,
    action: string,
    targetId: string,
    details: unknown,
  ) {
    return tx.auditLog.create({
      data: {
        tenantId,
        userId,
        action,
        targetType: 'Customer',
        targetId,
        details: JSON.stringify(details),
      },
    });
  }

  async updateBranding(id: string, raw: unknown, actor: Principal) {
    await this.org(id);
    await this.support.assertReach(actor, id);
    const b = object(raw);
    const data: {
      displayName?: string | null;
      logoUrl?: string | null;
      palette?: Prisma.InputJsonValue;
    } = {};
    if ('displayName' in b) data.displayName = text(b.displayName, 120);
    if ('logoUrl' in b) {
      try {
        data.logoUrl = parseCustomerLogoUrl(b.logoUrl);
      } catch (error) {
        asHttp(error);
      }
    }
    for (const field of ['primaryColor', 'accentColor'])
      if (
        field in b &&
        (typeof b[field] !== 'string' || !/^#[\da-f]{6}$/i.test(b[field]))
      )
        throw new BadRequestException(`${field} must be a #rrggbb color.`);
    if (
      !Object.keys(data).length &&
      !('primaryColor' in b) &&
      !('accentColor' in b)
    )
      throw new BadRequestException('Nothing to change.');
    return this.prisma.client.$transaction(async (tx) => {
      const before = await tx.tenantBranding.findUnique({
        where: { tenantId: id },
      });
      if ('primaryColor' in b || 'accentColor' in b) {
        const palette =
          before?.palette &&
          typeof before.palette === 'object' &&
          !Array.isArray(before.palette)
            ? before.palette
            : {};
        const primary =
          typeof b.primaryColor === 'string'
            ? b.primaryColor
            : typeof palette.primary === 'string'
              ? palette.primary
              : '#2563eb';
        const accent =
          typeof b.accentColor === 'string'
            ? b.accentColor
            : typeof palette.accent === 'string'
              ? palette.accent
              : undefined;
        data.palette = derivePalette(
          primary,
          accent,
        ) as unknown as Prisma.InputJsonValue;
      }
      await tx.tenantBranding.upsert({
        where: { tenantId: id },
        create: { tenantId: id, ...data },
        update: data,
      });
      await this.audit(
        tx,
        id,
        actorId(actor),
        'CUSTOMER_BRANDING_UPDATED',
        id,
        {
          before: {
            displayName: before?.displayName,
            logoUrl: before?.logoUrl,
            palette: before?.palette,
          },
          after: data,
        },
      );
      return { ok: true };
    });
  }

  async invite(id: string, raw: unknown, actor: Principal) {
    await this.org(id);
    const b = object(raw);
    const tenantId = b.tenantId == null ? id : text(b.tenantId, 100, true)!;
    const tree = await customerTree(this.prisma.client, id);
    if (!tree.some((t) => t.id === tenantId))
      throw new NotFoundException('Location not found in this customer.');
    // Explicit here as well as OnboardingService's request-frame guard: this is never a consent bypass.
    await this.support.assertReach(actor, tenantId);
    const inviterId = actorId(actor);
    if (!inviterId)
      throw new BadRequestException('An authenticated inviter is required.');
    return this.onboarding.createInvite({
      inviterId,
      tenantId,
      email: text(b.email, 254, true)!,
      role: tenantId === id ? AppRole.DISTRICT_ADMIN : AppRole.SCHOOL_ADMIN,
      firstName: text(b.firstName, 80) ?? undefined,
      lastName: text(b.lastName, 80) ?? undefined,
    });
  }

  async emailStarterLink(id: string, raw: unknown, actor: Principal) {
    const org = await this.org(id);
    const to = text(object(raw).email, 254, true)!;
    if (!isValidEmail(to))
      throw new BadRequestException('A valid email is required.');
    // Reuse the exact claimed-owner/consent gate and token lifecycle; never mint a second credential path.
    const link = await this.console.issueStarterLink(id, actorId(actor), actor);
    await this.audit(
      this.prisma.client,
      id,
      actorId(actor),
      'CUSTOMER_STARTER_EMAIL_REQUESTED',
      id,
      { email: to },
    );
    let emailDelivered = false;
    try {
      const result = await this.email.sendBillingNotice({
        to,
        kind: 'CUSTOMER_OWNER_INVITE',
        subject: `Set up your ${org.name} account`,
        body: `You have been invited to set up your VenueOS organization. This single-use link expires ${link.expiresAt}:\n\n${link.url}\n\nChoose your own email and password when you sign in.`,
      });
      emailDelivered = result === 'SENT' && this.email.isConfigured();
    } catch {
      /* The committed single-use link remains usable; report delivery failure honestly. */
    }
    return { ...link, email: to, emailDelivered };
  }

  async createLocation(id: string, raw: unknown, actor: Principal) {
    const b = object(raw);
    const name = text(b.name, 120, true)!;
    const slug = slugify(text(b.slug, 60) ?? name);
    if (!slug || isReservedTenantSlug(slug))
      throw new BadRequestException('Choose another location URL.');
    const parentId = b.parentId == null ? id : text(b.parentId, 100, true)!;
    await this.org(id);
    await this.support.assertReach(actor, parentId);
    try {
      return await withDbRetry(
        () =>
          this.prisma.client.$transaction(
            async (tx) => {
              const org = await this.org(id, tx);
              const tree = await customerTree(tx, id);
              const parent = tree.find((t) => t.id === parentId);
              if (!parent)
                throw new NotFoundException(
                  'Parent location not found in this customer.',
                );
              if (parent.archivedAt || org.archivedAt)
                throw new BadRequestException(
                  'Cannot add a location under an archived organization.',
                );
              if (parent.depth >= 20)
                throw new BadRequestException(
                  'Location hierarchy is too deep.',
                );
              const location = await tx.tenant.create({
                data: { name, slug, parentId, vertical: org.vertical },
                select: { id: true, name: true, slug: true, parentId: true },
              });
              await this.audit(
                tx,
                id,
                actorId(actor),
                'CUSTOMER_LOCATION_CREATED',
                location.id,
                { name, slug, parentId },
              );
              return location;
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
          ),
        { label: 'customer-location' },
      );
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'code' in e && e.code === 'P2002')
        throw new HttpException(
          {
            code: 'CUSTOMER_SLUG_TAKEN',
            message: 'That location URL is already taken.',
          },
          409,
        );
      throw e;
    }
  }

  async allocate(
    id: string,
    locationId: string,
    raw: unknown,
    userId: string | null,
  ) {
    const b = object(raw);
    const limit = b.seatLimit;
    if (
      limit !== null &&
      (typeof limit !== 'number' ||
        !Number.isInteger(limit) ||
        limit < 0 ||
        limit > 100_000)
    )
      throw new BadRequestException(
        'seatLimit must be null or a whole number from 0 to 100000.',
      );
    return withDbRetry(
      () =>
        this.prisma.client.$transaction(
          async (tx) => {
            const org = await this.org(id, tx);
            if (!org.license?.pooledSeats)
              throw new HttpException(
                {
                  code: 'CUSTOMER_POOL_DISABLED',
                  message: 'Enable corporate pooled licenses first.',
                },
                409,
              );
            const tree = await customerTree(tx, id);
            const target = tree.find((t) => t.id === locationId && t.id !== id);
            if (!target)
              throw new NotFoundException(
                'Location not found in this customer.',
              );
            const { used } = await poolUsage(tx, tree);
            if (limit !== null && limit < (used.get(locationId) ?? 0))
              throw new HttpException(
                {
                  code: 'CUSTOMER_ALLOCATION_BELOW_USAGE',
                  message:
                    'Allocation cannot be lower than the location’s paired screens.',
                },
                409,
              );
            const before = target.allocatedSeats;
            target.allocatedSeats = limit;
            assertPoolCapacity(tree, used, org.license.seatLimit);
            await tx.tenant.update({
              where: { id: locationId, parentId: target.parentId },
              data: { allocatedSeats: limit },
            });
            await this.audit(
              tx,
              id,
              userId,
              'CUSTOMER_ALLOCATION_UPDATED',
              locationId,
              { before, after: limit },
            );
            return { ok: true, seatLimit: limit };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      { label: 'customer-allocation' },
    );
  }

  async cardSeats(id: string, raw: unknown, actor: Principal) {
    await this.org(id);
    await this.support.assertReach(actor, id);
    const body = object(raw);
    if (body.confirmProration !== true)
      throw new BadRequestException(
        'Confirm the prorated change on the next invoice.',
      );
    if (typeof body.quantity !== 'number' || !Number.isInteger(body.quantity))
      throw new BadRequestException('quantity must be a whole number.');
    try {
      const result = await this.stripe.setSeatQuantity({
        tenantId: id,
        quantity: body.quantity,
        actorUserId: actorId(actor),
      });
      return { ok: true, ...result, proration: 'next_invoice' };
    } catch (e) {
      if (e instanceof SeatChangeError)
        throw new HttpException({ code: e.code, message: e.message }, 409);
      throw new HttpException(
        {
          code: 'CUSTOMER_CARD_CHANGE_FAILED',
          message:
            'The card subscription could not be updated. Refresh its status before retrying.',
        },
        502,
      );
    }
  }

  async paymentSummary(id: string) {
    const org = await this.org(id);
    const license = org.license;
    const base = {
      card: null,
      nextPayment: null,
      observedAt: new Date().toISOString(),
    };
    if (license?.billingMode && license.billingMode !== 'CARD')
      return { ...base, state: 'not_applicable' };
    if (!license?.stripeSubscriptionId)
      return { ...base, state: 'not_subscribed' };
    const stripe = this.stripe.getClient();
    if (!stripe)
      return {
        ...base,
        state: 'unavailable',
        reason: 'Card billing is not configured.',
      };
    try {
      const subscription = await stripe.subscriptions.retrieve(
        license.stripeSubscriptionId,
        {
          expand: [
            'default_payment_method',
            'customer.invoice_settings.default_payment_method',
          ],
        },
      );
      const customer =
        typeof subscription.customer === 'object' &&
        !subscription.customer.deleted
          ? subscription.customer
          : null;
      const method =
        subscription.default_payment_method ??
        customer?.invoice_settings?.default_payment_method;
      const paymentMethod =
        typeof method === 'string'
          ? await stripe.paymentMethods.retrieve(method)
          : method;
      const card = paymentMethod?.card
        ? {
            brand: paymentMethod.card.brand,
            last4: paymentMethod.card.last4,
            expMonth: paymentMethod.card.exp_month,
            expYear: paymentMethod.card.exp_year,
          }
        : null;
      let nextPayment: {
        amountCents: number;
        currency: string;
        at: string | null;
      } | null = null;
      let reason: string | undefined;
      if (
        !['canceled', 'incomplete_expired'].includes(subscription.status) &&
        !subscription.cancel_at_period_end
      ) {
        try {
          const invoice = await stripe.invoices.createPreview({
            subscription: subscription.id,
          });
          const at =
            invoice.next_payment_attempt ??
            invoice.due_date ??
            invoice.period_end;
          nextPayment = {
            amountCents: invoice.amount_due,
            currency: invoice.currency,
            at: at ? new Date(at * 1000).toISOString() : null,
          };
        } catch {
          reason = 'The next invoice preview is unavailable.';
        }
      }
      return {
        ...base,
        state: reason ? 'unavailable' : 'available',
        ...(reason ? { reason } : {}),
        card,
        nextPayment,
        subscriptionStatus: subscription.status,
      };
    } catch {
      return {
        ...base,
        state: 'unavailable',
        reason: 'Stripe could not be reached. Try again later.',
      };
    }
  }

  async listInvoices(query: Record<string, unknown>) {
    const page = Math.max(1, Math.min(100_000, Number(query.page) || 1)) | 0;
    const pageSize =
      Math.max(1, Math.min(100, Number(query.pageSize) || 25)) | 0;
    const q = typeof query.q === 'string' ? query.q.trim().slice(0, 120) : '';
    const status = typeof query.status === 'string' ? query.status : '';
    if (status && !(INVOICE_STATUSES as readonly string[]).includes(status))
      throw new BadRequestException('Invalid invoice status.');
    const where: Prisma.CustomerInvoiceWhereInput = {
      ...(status ? { status } : {}),
      ...(q
        ? {
            OR: [
              { number: { contains: q, mode: 'insensitive' } },
              { tenant: { name: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.client.customerInvoice.count({ where }),
      this.prisma.client.customerInvoice.findMany({
        where,
        include: { tenant: { select: { name: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      rows: rows.map((i) => ({
        ...this.console.invoiceView(i),
        customerId: i.tenantId,
        customerName: i.tenant.name,
      })),
      total,
      page,
      pageSize,
      pages: Math.ceil(total / pageSize),
    };
  }

  private async invoice(
    id: string,
    invoiceId: string,
    client: Prisma.TransactionClient = this.prisma.client,
  ) {
    const invoice = await client.customerInvoice.findFirst({
      where: { id: invoiceId, tenantId: id },
    });
    if (!invoice) throw new NotFoundException('Invoice not found.');
    return invoice;
  }

  async uploadPdf(
    id: string,
    invoiceId: string,
    file: Express.Multer.File | undefined,
    userId: string | null,
  ) {
    await this.org(id);
    await this.invoice(id, invoiceId);
    const meta = validateInvoicePdf(file);
    const path = await this.storage.upload(id, invoiceId, file!.buffer);
    let oldPath: string | null = null;
    try {
      const result = await withDbRetry(
        () =>
          this.prisma.client.$transaction(
            async (tx) => {
              const before = await this.invoice(id, invoiceId, tx);
              oldPath = before.pdfStoragePath;
              const updated = await tx.customerInvoice.update({
                where: { id: invoiceId, tenantId: id },
                data: {
                  pdfStoragePath: path,
                  pdfFileName: meta.fileName,
                  pdfSizeBytes: meta.sizeBytes,
                  pdfUploadedAt: new Date(),
                },
              });
              await this.audit(
                tx,
                id,
                userId,
                'CUSTOMER_INVOICE_PDF_ATTACHED',
                invoiceId,
                meta,
              );
              return this.console.invoiceView(updated);
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
          ),
        { label: 'customer-invoice-pdf' },
      );
      if (oldPath) await this.storage.remove(oldPath).catch(() => undefined);
      return result;
    } catch (e) {
      await this.storage.remove(path).catch(() => undefined);
      throw e;
    }
  }

  async downloadPdf(id: string, invoiceId: string, userId: string | null) {
    const invoice = await this.invoice(id, invoiceId);
    if (!invoice.pdfStoragePath)
      throw new NotFoundException('No PDF is attached to this invoice.');
    await this.audit(
      this.prisma.client,
      id,
      userId,
      'CUSTOMER_INVOICE_PDF_DOWNLOADED',
      invoiceId,
      {},
    );
    return this.storage.download(
      invoice.pdfStoragePath,
      id,
      invoiceId,
      invoice.pdfFileName ?? 'invoice.pdf',
    );
  }

  async ownDownloadPdf(
    tenantId: string,
    invoiceId: string,
    userId: string | null,
  ) {
    const { rootTenantId } = await this.license.orgAccount(tenantId);
    return this.downloadPdf(rootTenantId, invoiceId, userId);
  }

  async invoiceDocument(id: string, invoiceId: string) {
    const org = await this.org(id);
    const invoice = await this.invoice(id, invoiceId);
    const branding = await this.prisma.client.tenantBranding.findUnique({
      where: { tenantId: id },
      select: { displayName: true, logoUrl: true, palette: true },
    });
    // The invoice's saved amount is authoritative, even if the contract was edited later.
    return {
      seller: { name: 'VenueOS' },
      customer: { name: org.name, slug: org.slug },
      invoice: this.console.invoiceView(invoice),
      branding,
      lines: [
        {
          descriptionCode: 'subscription',
          description: 'VenueOS subscription services',
          quantity: 1,
          unitAmountCents: invoice.amountCents,
          totalCents: invoice.amountCents,
        },
      ],
    };
  }
}
