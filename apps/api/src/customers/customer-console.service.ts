import { HttpException, HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { AppRole, Prisma } from '@cms/database';
import { isReservedTenantSlug, isVertical } from '@cms/api-types';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { LicenseService } from '../license/license.service';
import { SampleDataService } from '../sample-data/sample-data.service';
import { StarterBoardService } from '../onboarding/starter-board.service';
import { hashToken, INVITE_TTL_MS } from '../onboarding/onboarding.service';
import { derivePalette } from '../branding/color-utils';
import { OrgSuspensionGate } from './org-suspension.interceptor';
import {
  assertPatchAllowed,
  cardCheckoutAllowed,
  changedFields,
  customerStatusOf,
  filterSortPage,
  invoiceIsOverdue,
  isInvoiceBilled,
  licenseDataFromPatch,
  licenseSnapshot,
  normalizeInvoiceWrite,
  parseCreateCustomer,
  parseInvoice,
  parseLicensePatch,
  PolicyError,
  renewalDateOf,
  slugify,
  STARTER_EMAIL_DOMAIN,
  type CustomerRow,
  type ListQuery,
} from './customer-console.policy';

/** Throw a policy error as the HTTP error the console shows. */
export function asHttp(e: unknown): never {
  if (e instanceof PolicyError) {
    throw new HttpException({ code: e.code, message: e.message }, e.status);
  }
  throw e;
}

const notFound = () =>
  new HttpException({ code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found.' }, HttpStatus.NOT_FOUND);

/** The web origin the one-time owner link points at. Same resolution as the invite links. */
export function webBaseUrl(): string {
  return (
    process.env.PUBLIC_WEB_URL ||
    process.env.NEXT_PUBLIC_WEB_URL ||
    process.env.ALLOWED_ORIGINS?.split(',')[0]?.trim() ||
    ''
  ).replace(/\/$/, '');
}

export function claimUrlFor(token: string): string {
  return `${webBaseUrl()}/claim-account/${token}`;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * CUSTOMER MANAGEMENT CONSOLE — the data side. SUPER_ADMIN-only callers (see
 * SuperCustomersController); every write is one transaction with its AuditLog
 * row, and every AuditLog row on a license carries `before` / `after` / `changed`.
 */
/**
 * Organisations that are never customers and never belong in the customer
 * roster: the security-event sink and the "VenueOS automated checks" org the
 * CI production smoke signs into (seeded as Springfield; renamed 2026-10-11).
 */
const NOT_CUSTOMER_SLUGS = new Set(['__system__', 'springfield-district']);

@Injectable()
export class CustomerConsoleService {
  private readonly logger = new Logger(CustomerConsoleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly license: LicenseService,
    private readonly gate: OrgSuspensionGate,
    @Optional() private readonly sampleData?: SampleDataService,
    @Optional() private readonly starterBoard?: StarterBoardService,
  ) {}

  // ─── List ────────────────────────────────────────────────────────────────

  /**
   * Every top-level organisation, filtered / sorted / paged on the server.
   * Four queries regardless of page: the tenant tree (light select), paired
   * screens per tenant, open invoices per organisation, and the newest audit
   * row per tenant (one index probe each on audit_logs(tenant_id, created_at)).
   * At hundreds — low thousands — of tenants that is a few milliseconds of
   * work, and it lets every filter (seats over limit, renewal due, status)
   * be exact across the WHOLE roster rather than the current page.
   */
  async list(q: ListQuery, now = new Date()) {
    const rows = await this.buildRows(now);
    return filterSortPage(rows, q, now);
  }

  private async buildRows(now: Date): Promise<CustomerRow[]> {
    const client = this.prisma.client;
    const tenants: any[] = await client.tenant.findMany({
      select: {
        id: true, parentId: true, name: true, slug: true, vertical: true, createdAt: true, archivedAt: true,
        license: {
          select: {
            tier: true, status: true, billingMode: true, seatLimit: true, monthlyPriceCents: true,
            renewalDate: true, currentPeriodEnd: true, expiresAt: true,
          },
        },
      },
    });
    const ids = tenants.map((t) => t.id);
    const [screens, invoices, activity] = await Promise.all([
      (client.screen.groupBy as any)({
        by: ['tenantId'],
        where: { tenantId: { not: null }, pairedAt: { not: null } },
        _count: { _all: true },
      }) as Promise<any[]>,
      client.customerInvoice.findMany({
        where: { status: { in: ['SENT', 'PAST_DUE'] } },
        select: { tenantId: true, amountCents: true, status: true, dueAt: true },
      }),
      ids.length
        ? (client.$queryRaw<Array<{ id: string; last: Date | null }>>(
            Prisma.sql`SELECT t.id, (SELECT max(a.created_at) FROM audit_logs a WHERE a.tenant_id = t.id) AS last
                       FROM unnest(${ids}::text[]) AS t(id)`,
          ) as Promise<Array<{ id: string; last: Date | null }>>)
        : Promise.resolve([] as Array<{ id: string; last: Date | null }>),
    ]);

    const byId = new Map(tenants.map((t) => [t.id, t]));
    const rootOf = (id: string): string => {
      let cur = byId.get(id);
      for (let i = 0; cur?.parentId && i < 10; i++) {
        const parent = byId.get(cur.parentId);
        if (!parent) break;
        cur = parent;
      }
      return cur?.id ?? id;
    };
    const seats = new Map<string, number>();
    for (const s of screens) {
      if (!s.tenantId) continue;
      const root = rootOf(s.tenantId);
      seats.set(root, (seats.get(root) ?? 0) + (s._count?._all ?? 0));
    }
    const locations = new Map<string, number>();
    for (const t of tenants) {
      if (t.parentId && !t.archivedAt) {
        const root = rootOf(t.id);
        locations.set(root, (locations.get(root) ?? 0) + 1);
      }
    }
    const lastActivity = new Map<string, number>();
    for (const a of activity) {
      if (!a.last) continue;
      const root = rootOf(a.id);
      const t = new Date(a.last).getTime();
      if (t > (lastActivity.get(root) ?? 0)) lastActivity.set(root, t);
    }
    const open = new Map<string, { cents: number; overdue: number }>();
    for (const inv of invoices) {
      const root = rootOf(inv.tenantId);
      const cur = open.get(root) ?? { cents: 0, overdue: 0 };
      cur.cents += inv.amountCents;
      if (invoiceIsOverdue(inv, now)) cur.overdue += 1;
      open.set(root, cur);
    }

    return tenants
      .filter((t) => !t.parentId && !NOT_CUSTOMER_SLUGS.has(t.slug))
      .map((t): CustomerRow => {
        const lic = t.license ?? null;
        const inv = open.get(t.id) ?? { cents: 0, overdue: 0 };
        const last = lastActivity.get(t.id);
        return {
          id: t.id,
          name: t.name,
          slug: t.slug,
          vertical: t.vertical,
          createdAt: new Date(t.createdAt).toISOString(),
          archived: !!t.archivedAt,
          plan: lic?.tier ?? null,
          billingMode: lic?.billingMode ?? null,
          licenseStatus: lic?.status ?? null,
          status: customerStatusOf(lic, inv.overdue > 0),
          seatLimit: lic ? lic.seatLimit : null,
          seatsUsed: seats.get(t.id) ?? 0,
          locations: locations.get(t.id) ?? 0,
          monthlyPriceCents: lic?.monthlyPriceCents ?? null,
          renewalDate: iso(renewalDateOf(lic)),
          lastActivityAt: last ? new Date(last).toISOString() : null,
          openInvoiceCents: inv.cents,
          overdueInvoices: inv.overdue,
        };
      });
  }

  // ─── Detail ──────────────────────────────────────────────────────────────

  /** Loads a top-level organisation or answers 404. A school / location id is not a customer. */
  private async loadOrg(id: string, client: any = this.prisma.client) {
    const org = await client.tenant.findUnique({
      where: { id },
      select: { id: true, parentId: true, name: true, slug: true, vertical: true, createdAt: true, archivedAt: true, license: true },
    });
    if (!org) throw notFound();
    if (org.parentId) {
      throw new HttpException(
        { code: 'CUSTOMER_NOT_TOP_LEVEL', message: 'That is a location inside another organization.', rootId: (await this.license.orgAccount(id)).rootTenantId },
        HttpStatus.BAD_REQUEST,
      );
    }
    return org;
  }

  async detail(id: string, now = new Date()) {
    const org = await this.loadOrg(id);
    const client = this.prisma.client;
    const children: any[] = await client.tenant.findMany({
      where: { parentId: id },
      select: { id: true, name: true, slug: true, archivedAt: true },
      orderBy: { name: 'asc' },
    });
    const grand: any[] = children.length
      ? await client.tenant.findMany({ where: { parentId: { in: children.map((c) => c.id) } }, select: { id: true, parentId: true } })
      : [];
    const treeIds = [id, ...children.map((c) => c.id), ...grand.map((g) => g.id)];
    const [screens, invoices, users, starterInvites, recent, branding] = await Promise.all([
      (client.screen.groupBy as any)({
        by: ['tenantId'],
        where: { tenantId: { in: treeIds }, pairedAt: { not: null } },
        _count: { _all: true },
      }) as Promise<any[]>,
      client.customerInvoice.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 200 }),
      client.user.findMany({
        where: { tenantId: { in: treeIds }, deletedAt: null, role: { in: [AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN] } },
        select: { id: true, email: true, role: true, status: true, firstName: true, lastName: true, tenantId: true, mustSetupCredentials: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: 50,
      }),
      client.userInvite.findMany({
        where: { tenantId: id, email: { endsWith: `@${STARTER_EMAIL_DOMAIN}` } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, expiresAt: true, acceptedAt: true, createdAt: true, userId: true, user: { select: { email: true, mustSetupCredentials: true, status: true } } },
      }),
      client.auditLog.findMany({
        where: { tenantId: id, OR: [{ action: { startsWith: 'CUSTOMER_' } }, { action: { startsWith: 'LICENSE_' } }] },
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: { id: true, action: true, details: true, createdAt: true, user: { select: { email: true } } },
      }),
      client.tenantBranding.findUnique({ where: { tenantId: id }, select: { displayName: true, palette: true, logoUrl: true } }),
    ]);
    const seatsByTenant = new Map<string, number>(screens.map((s: any) => [s.tenantId, s._count?._all ?? 0]));
    const childSeats = (cid: string) =>
      (seatsByTenant.get(cid) ?? 0) + grand.filter((g) => g.parentId === cid).reduce((n, g) => n + (seatsByTenant.get(g.id) ?? 0), 0);
    const seatsUsed = treeIds.reduce((n, t) => n + (seatsByTenant.get(t) ?? 0), 0);
    const lic = org.license ?? null;
    const overdue = invoices.some((i: any) => invoiceIsOverdue(i, now));
    const starter = starterInvites[0] ?? null;
    const starterState = !starter
      ? null
      : starter.user?.mustSetupCredentials === false
        ? 'set_up'
        : starter.acceptedAt
          ? 'claimed'
          : starter.expiresAt.getTime() < now.getTime()
            ? 'expired'
            : 'pending';
    const palette = (branding?.palette ?? null) as any;
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      vertical: org.vertical,
      createdAt: iso(org.createdAt),
      archived: !!org.archivedAt,
      status: customerStatusOf(lic, overdue),
      seatsUsed,
      license: lic
        ? {
            plan: lic.tier,
            status: lic.status,
            billingMode: lic.billingMode,
            seatLimit: lic.seatLimit,
            monthlyPriceCents: lic.monthlyPriceCents,
            renewalDate: iso(renewalDateOf(lic)),
            contractRenewalDate: iso(lic.renewalDate),
            poNumber: lic.poNumber,
            notes: lic.notes,
            suspendedAt: iso(lic.suspendedAt),
            suspendReason: lic.suspendReason,
            stripeManaged: !!lic.stripeSubscriptionId && lic.status !== 'CANCELLED' && lic.billingMode === 'CARD',
          }
        : null,
      cardCheckout: cardCheckoutAllowed(lic),
      locations: children.map((c) => ({ id: c.id, name: c.name, slug: c.slug, archived: !!c.archivedAt, seatsUsed: childSeats(c.id) })),
      admins: users.map((u: any) => ({
        id: u.id,
        email: u.email.endsWith(`@${STARTER_EMAIL_DOMAIN}`) ? null : u.email,
        name: [u.firstName, u.lastName].filter(Boolean).join(' ') || null,
        role: u.role,
        status: u.status,
        awaitingSetup: !!u.mustSetupCredentials,
        atLocation: u.tenantId !== id,
      })),
      starterLogin: starter
        ? {
            state: starterState,
            createdAt: iso(starter.createdAt),
            expiresAt: iso(starter.expiresAt),
            claimedAt: iso(starter.acceptedAt),
            ownerEmail: starter.user && !starter.user.email.endsWith(`@${STARTER_EMAIL_DOMAIN}`) ? starter.user.email : null,
          }
        : null,
      invoices: invoices.map((i: any) => this.invoiceView(i, now)),
      branding: branding ? { displayName: branding.displayName, primary: palette?.primary ?? null, accent: palette?.accent ?? null, logoUrl: branding.logoUrl } : null,
      activity: recent.map((r: any) => ({ id: r.id, action: r.action, at: iso(r.createdAt), by: r.user?.email ?? null, details: safeJson(r.details) })),
    };
  }

  invoiceView(i: any, now = new Date()) {
    return {
      id: i.id,
      number: i.number,
      amountCents: i.amountCents,
      currency: i.currency,
      poNumber: i.poNumber,
      periodStart: iso(i.periodStart),
      periodEnd: iso(i.periodEnd),
      sentAt: iso(i.sentAt),
      dueAt: iso(i.dueAt),
      paidAt: iso(i.paidAt),
      status: i.status,
      overdue: invoiceIsOverdue(i, now),
      notes: i.notes,
    };
  }

  // ─── License edit ────────────────────────────────────────────────────────

  async updateLicense(id: string, body: unknown, actorId: string | null) {
    let patch;
    try {
      patch = parseLicensePatch(body);
    } catch (e) {
      asHttp(e);
    }
    return this.prisma.client.$transaction(async (tx: any) => {
      const org = await this.loadOrg(id, tx);
      const current = org.license ?? null;
      try {
        assertPatchAllowed(current, patch);
      } catch (e) {
        asHttp(e);
      }
      const data = licenseDataFromPatch(patch);
      const before = licenseSnapshot(current);
      const lic = current
        ? await tx.license.update({ where: { tenantId: id }, data })
        : await tx.license.create({
            data: {
              tenantId: id,
              // A first license from the console: the owner is setting it up by hand, so it is
              // invoice-billed annual by default unless the edit says otherwise.
              tier: 'ANNUAL',
              billingMode: 'INVOICE',
              status: 'ACTIVE',
              seatLimit: 0,
              ...data,
            },
          });
      const after = licenseSnapshot(lic);
      await tx.auditLog.create({
        data: {
          tenantId: id,
          userId: actorId,
          action: 'CUSTOMER_LICENSE_UPDATED',
          targetType: 'License',
          targetId: lic.id,
          details: JSON.stringify({ before, after, changed: changedFields(before, after) }),
        },
      });
      return { ok: true, license: after };
    });
  }

  // ─── Suspend / reactivate ────────────────────────────────────────────────

  async setSuspended(id: string, suspend: boolean, reason: unknown, actorId: string | null) {
    const why = typeof reason === 'string' ? reason.trim().slice(0, 500) || null : null;
    const result = await this.prisma.client.$transaction(async (tx: any) => {
      const org = await this.loadOrg(id, tx);
      const current = org.license ?? null;
      if (!current) {
        throw new HttpException(
          { code: 'CUSTOMER_NO_LICENSE', message: 'Set up this customer’s license before suspending it.' },
          HttpStatus.CONFLICT,
        );
      }
      if (suspend && current.status === 'SUSPENDED') {
        throw new HttpException({ code: 'CUSTOMER_ALREADY_SUSPENDED', message: 'This customer is already suspended.' }, HttpStatus.CONFLICT);
      }
      if (!suspend && current.status !== 'SUSPENDED') {
        throw new HttpException({ code: 'CUSTOMER_NOT_SUSPENDED', message: 'This customer is not suspended.' }, HttpStatus.CONFLICT);
      }
      const before = licenseSnapshot(current);
      const lic = await tx.license.update({
        where: { tenantId: id },
        data: suspend
          ? { status: 'SUSPENDED', suspendedAt: new Date(), suspendReason: why }
          : { status: 'ACTIVE', suspendedAt: null, suspendReason: null },
      });
      const after = licenseSnapshot(lic);
      await tx.auditLog.create({
        data: {
          tenantId: id,
          userId: actorId,
          action: suspend ? 'CUSTOMER_SUSPENDED' : 'CUSTOMER_REACTIVATED',
          targetType: 'License',
          targetId: lic.id,
          details: JSON.stringify({ before, after, changed: changedFields(before, after), reason: why }),
        },
      });
      return { ok: true, license: after };
    });
    this.gate.invalidate();
    return result;
  }

  // ─── Invoices ────────────────────────────────────────────────────────────

  async createInvoice(id: string, body: unknown, actorId: string | null, now = new Date()) {
    let input;
    try {
      input = normalizeInvoiceWrite(parseInvoice(body, 'create'), now);
    } catch (e) {
      asHttp(e);
    }
    try {
      return await this.prisma.client.$transaction(async (tx: any) => {
        const org = await this.loadOrg(id, tx);
        if (!isInvoiceBilled(org.license?.billingMode)) {
          throw new HttpException(
            { code: 'CUSTOMER_NOT_INVOICE_BILLED', message: 'Invoices are recorded only for customers billed by invoice or purchase order.' },
            HttpStatus.CONFLICT,
          );
        }
        const inv = await tx.customerInvoice.create({
          data: {
            tenantId: id,
            number: input.number!,
            amountCents: input.amountCents!,
            poNumber: input.poNumber !== undefined ? input.poNumber : org.license?.poNumber ?? null,
            periodStart: input.periodStart ?? null,
            periodEnd: input.periodEnd ?? null,
            sentAt: input.sentAt !== undefined ? input.sentAt : now,
            dueAt: input.dueAt ?? null,
            paidAt: input.paidAt ?? null,
            status: input.status ?? 'SENT',
            notes: input.notes ?? null,
            createdById: actorId,
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId: id,
            userId: actorId,
            action: 'CUSTOMER_INVOICE_CREATED',
            targetType: 'CustomerInvoice',
            targetId: inv.id,
            details: JSON.stringify({ before: null, after: invoiceSnapshot(inv) }),
          },
        });
        return this.invoiceView(inv, now);
      });
    } catch (e: any) {
      throw duplicateInvoice(e);
    }
  }

  async updateInvoice(id: string, invoiceId: string, body: unknown, actorId: string | null, now = new Date()) {
    let input;
    try {
      input = normalizeInvoiceWrite(parseInvoice(body, 'update'), now);
    } catch (e) {
      asHttp(e);
    }
    try {
      return await this.prisma.client.$transaction(async (tx: any) => {
        await this.loadOrg(id, tx);
        // TENANT ISOLATION: the invoice must belong to the customer in the URL. An id from
        // another customer answers 404, exactly like an id that does not exist.
        const current = await tx.customerInvoice.findFirst({ where: { id: invoiceId, tenantId: id } });
        if (!current) {
          throw new HttpException({ code: 'INVOICE_NOT_FOUND', message: 'Invoice not found.' }, HttpStatus.NOT_FOUND);
        }
        const before = invoiceSnapshot(current);
        const data: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(input)) if (v !== undefined) data[k] = v;
        const updated = await tx.customerInvoice.update({ where: { id: current.id, tenantId: id }, data });
        const after = invoiceSnapshot(updated);
        await tx.auditLog.create({
          data: {
            tenantId: id,
            userId: actorId,
            action: 'CUSTOMER_INVOICE_UPDATED',
            targetType: 'CustomerInvoice',
            targetId: updated.id,
            details: JSON.stringify({ before, after, changed: changedFields(before, after) }),
          },
        });
        return this.invoiceView(updated, now);
      });
    } catch (e: any) {
      throw duplicateInvoice(e);
    }
  }

  // ─── Create customer + starter owner login ───────────────────────────────

  async createCustomer(body: unknown, actorId: string | null) {
    let input;
    try {
      input = parseCreateCustomer(body, (v) => isVertical(v));
    } catch (e) {
      asHttp(e);
    }
    const slug = input.slug ?? slugify(input.name);
    if (!slug) {
      throw new HttpException({ code: 'CUSTOMER_SLUG_INVALID', message: 'The account URL needs letters or numbers.' }, HttpStatus.BAD_REQUEST);
    }
    if (isReservedTenantSlug(slug) || (await this.prisma.client.tenant.findUnique({ where: { slug }, select: { id: true } }))) {
      throw new HttpException({ code: 'CUSTOMER_SLUG_TAKEN', message: 'That account URL is already taken — choose another.', slug }, HttpStatus.CONFLICT);
    }
    const token = randomBytes(32).toString('base64url');
    const placeholderHash = await this.auth.hashPassword(randomBytes(32).toString('base64url'));
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const palette = input.primaryColor ? derivePalette(input.primaryColor, input.accentColor ?? undefined) : null;

    let created: { tenantId: string; ownerId: string };
    try {
      created = await this.prisma.client.$transaction(async (tx: any) => {
        const tenant = await tx.tenant.create({ data: { name: input.name, slug, vertical: input.vertical } });
        const lic = await tx.license.create({
          data: {
            tenantId: tenant.id,
            tier: input.plan,
            billingMode: input.billingMode,
            status: 'ACTIVE',
            seatLimit: input.seatLimit,
            monthlyPriceCents: input.monthlyPriceCents,
            poNumber: input.poNumber,
            renewalDate: input.renewalDate,
            notes: input.notes,
          },
        });
        if (input.displayName || palette) {
          await tx.tenantBranding.create({
            data: { tenantId: tenant.id, displayName: input.displayName ?? input.name, ...(palette ? { palette: palette as any } : {}) },
          });
        }
        const owner = await this.createStarterOwner(tx, tenant.id, token, expiresAt, actorId, input);
        await tx.auditLog.create({
          data: {
            tenantId: tenant.id,
            userId: actorId,
            action: 'CUSTOMER_CREATED',
            targetType: 'Tenant',
            targetId: tenant.id,
            // Never the token — only that a single-use owner link was issued, and until when.
            details: JSON.stringify({
              name: input.name,
              slug,
              vertical: input.vertical,
              license: { before: null, after: licenseSnapshot(lic) },
              branding: { displayName: input.displayName, primary: input.primaryColor, accent: input.accentColor },
              starterOwnerUserId: owner.id,
              starterLinkExpiresAt: expiresAt.toISOString(),
            }),
          },
        });
        return { tenantId: tenant.id, ownerId: owner.id };
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new HttpException({ code: 'CUSTOMER_SLUG_TAKEN', message: 'That account URL is already taken — choose another.', slug }, HttpStatus.CONFLICT);
      }
      throw e;
    }

    // Same first-run content a self-signup gets: vertical sample data + a first real board. Both
    // are fire-and-forget and swallow their own errors (see OnboardingService.signup) — a seed
    // failure must never fail the account the owner just created.
    void this.sampleData?.seedForNewTenant(created.tenantId, created.ownerId, input.vertical);
    void this.starterBoard?.seedForNewTenant(created.tenantId, created.ownerId, input.vertical, input.name);

    return {
      id: created.tenantId,
      slug,
      starterLink: { url: claimUrlFor(token), expiresAt: expiresAt.toISOString() },
    };
  }

  /**
   * The starter owner: a DISTRICT_ADMIN with a placeholder email nobody can receive, a random
   * password nobody knows, `mustSetupCredentials` (so the first sign-in is forced through
   * first-login setup: their own email + their own password) and `mfaRequired` (so every sign-in
   * after that one requires two-step). The ONLY way into it is the single-use link.
   */
  private async createStarterOwner(
    tx: any,
    tenantId: string,
    token: string,
    expiresAt: Date,
    actorId: string | null,
    names: { ownerFirstName?: string | null; ownerLastName?: string | null },
  ) {
    const email = `owner-${randomBytes(6).toString('hex')}@${STARTER_EMAIL_DOMAIN}`;
    const owner = await tx.user.create({
      data: {
        tenantId,
        email,
        passwordHash: await this.auth.hashPassword(randomBytes(32).toString('base64url')),
        role: AppRole.DISTRICT_ADMIN,
        status: 'INVITED',
        mustSetupCredentials: true,
        mfaRequired: true,
        canTriggerPanic: true,
        firstName: names.ownerFirstName ?? null,
        lastName: names.ownerLastName ?? null,
      },
    });
    await tx.userInvite.create({
      data: {
        tenantId,
        email,
        role: AppRole.DISTRICT_ADMIN,
        tokenHash: hashToken(token),
        // UserInvite.invitedById is required; a SUPER_ADMIN always has an id here.
        invitedById: actorId as string,
        userId: owner.id,
        expiresAt,
      },
    });
    return owner;
  }

  /**
   * A fresh single-use owner link. Re-issues for the starter owner that has not finished setup
   * (and expires every earlier link for it), or — for an organisation that has none, e.g. one
   * that signed up on its own and lost its admin — creates a new starter owner.
   */
  async issueStarterLink(id: string, actorId: string | null) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    await this.prisma.client.$transaction(async (tx: any) => {
      await this.loadOrg(id, tx);
      const pending = await tx.user.findFirst({
        where: { tenantId: id, deletedAt: null, mustSetupCredentials: true, email: { endsWith: `@${STARTER_EMAIL_DOMAIN}` } },
        orderBy: { createdAt: 'desc' },
      });
      let ownerId: string;
      let reissued = false;
      if (pending && pending.status !== 'DISABLED') {
        // Every earlier link for this owner stops working: expired, and unbound from the user
        // (UserInvite.userId is unique, and a link with no user can never be redeemed).
        await tx.userInvite.updateMany({
          where: { tenantId: id, userId: pending.id },
          data: { userId: null, expiresAt: new Date() },
        });
        await tx.userInvite.create({
          data: {
            tenantId: id,
            email: pending.email,
            role: pending.role,
            tokenHash: hashToken(token),
            invitedById: actorId as string,
            userId: pending.id,
            expiresAt,
          },
        });
        ownerId = pending.id;
        reissued = true;
      } else {
        ownerId = (await this.createStarterOwner(tx, id, token, expiresAt, actorId, {})).id;
      }
      await tx.auditLog.create({
        data: {
          tenantId: id,
          userId: actorId,
          action: 'CUSTOMER_STARTER_LINK_ISSUED',
          targetType: 'User',
          targetId: ownerId,
          details: JSON.stringify({ reissued, expiresAt: expiresAt.toISOString() }),
        },
      });
    });
    return { url: claimUrlFor(token), expiresAt: expiresAt.toISOString() };
  }

  // ─── Claim (public, single-use) ──────────────────────────────────────────

  private async findClaimable(token: string) {
    if (!token || token.length > 200) return null;
    const invite: any = await this.prisma.client.userInvite.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true, tenant: { select: { name: true } } },
    });
    if (!invite || !invite.email?.endsWith(`@${STARTER_EMAIL_DOMAIN}`)) return null;
    return invite;
  }

  async claimPreview(token: string) {
    const invite = await this.findClaimable(token);
    const invalid = new HttpException({ code: 'CLAIM_LINK_INVALID', message: 'This link is not valid.' }, HttpStatus.NOT_FOUND);
    if (!invite) throw invalid;
    if (invite.acceptedAt) throw new HttpException({ code: 'CLAIM_LINK_USED', message: 'This link has already been used.' }, HttpStatus.GONE);
    if (invite.expiresAt.getTime() < Date.now()) {
      throw new HttpException({ code: 'CLAIM_LINK_EXPIRED', message: 'This link has expired. Ask VenueOS for a new one.' }, HttpStatus.GONE);
    }
    return { organizationName: invite.tenant?.name ?? '', expiresAt: invite.expiresAt.toISOString() };
  }

  /**
   * Redeem a starter-owner link: ONE sign-in, then first-login setup takes over (the session
   * carries `msc`, so the API refuses everything but setup until the person has set their own
   * email + password). Fail-closed: every mismatch is the same "no longer valid".
   */
  async claim(token: string) {
    const invite = await this.findClaimable(token);
    const invalid = new HttpException({ code: 'CLAIM_LINK_INVALID', message: 'This link is no longer valid.' }, HttpStatus.BAD_REQUEST);
    if (!invite) throw invalid;
    if (invite.acceptedAt || invite.expiresAt.getTime() < Date.now()) throw invalid;
    const user = invite.user;
    if (!user || user.deletedAt) throw invalid;
    if (user.tenantId !== invite.tenantId) throw invalid;
    if (String(user.email).toLowerCase() !== String(invite.email).toLowerCase()) throw invalid;
    if (!user.mustSetupCredentials) throw invalid;
    if (user.status !== 'INVITED' && user.status !== 'ACTIVE') throw invalid;

    const live = await this.prisma.client.$transaction(async (tx: any) => {
      // Single use, race-safe: only the request that flips acceptedAt from NULL wins.
      const spent = await tx.userInvite.updateMany({
        where: { id: invite.id, tenantId: invite.tenantId, acceptedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (spent.count !== 1) throw invalid;
      const u = await tx.user.update({ where: { id: user.id, tenantId: invite.tenantId }, data: { status: 'ACTIVE' } });
      await tx.auditLog.create({
        data: {
          tenantId: invite.tenantId,
          userId: user.id,
          action: 'CUSTOMER_STARTER_LINK_CLAIMED',
          targetType: 'User',
          targetId: user.id,
          details: JSON.stringify({ inviteId: invite.id }),
        },
      });
      return u;
    });
    // `skipPolicyGate`: this is an account-CREATION path in exactly the sense LoginOptions
    // documents — the starter account has no password anyone knows and no second factor yet, and
    // this page has no enrollment UI. The session is 1 hour, the API holds it to first-login setup
    // (msc), and `mfaRequired` on the row puts the very next sign-in through two-step enrollment.
    return this.auth.login(live, false, { skipPolicyGate: true });
  }

  // ─── Customer-facing billing account ─────────────────────────────────────

  /** What the customer's own Billing page needs to decide between card checkout and "billed by invoice". */
  async billingAccount(tenantId: string, now = new Date()) {
    const acct = await this.license.orgAccount(tenantId);
    const gov = acct.governing;
    const invoiceBilled = isInvoiceBilled(gov?.billingMode);
    const invoices = invoiceBilled
      ? await this.prisma.client.customerInvoice.findMany({
          where: { tenantId: acct.rootTenantId, status: { not: 'VOID' } },
          orderBy: { createdAt: 'desc' },
          take: 50,
        })
      : [];
    return {
      billingMode: gov?.billingMode ?? null,
      cardCheckout: cardCheckoutAllowed(gov),
      invoiceBilled,
      comp: gov?.billingMode === 'COMP',
      poNumber: invoiceBilled ? gov?.poNumber ?? null : null,
      renewalDate: iso(renewalDateOf(gov)),
      invoices: invoices.map((i: any) => ({
        number: i.number,
        amountCents: i.amountCents,
        currency: i.currency,
        sentAt: iso(i.sentAt),
        dueAt: iso(i.dueAt),
        paidAt: iso(i.paidAt),
        status: i.status,
        overdue: invoiceIsOverdue(i, now),
      })),
    };
  }
}

function invoiceSnapshot(i: any) {
  return {
    number: i.number,
    amountCents: i.amountCents,
    status: i.status,
    poNumber: i.poNumber ?? null,
    sentAt: iso(i.sentAt),
    dueAt: iso(i.dueAt),
    paidAt: iso(i.paidAt),
    periodStart: iso(i.periodStart),
    periodEnd: iso(i.periodEnd),
    notes: i.notes ?? null,
  };
}

function duplicateInvoice(e: any) {
  if (e?.code === 'P2002') {
    return new HttpException({ code: 'INVOICE_NUMBER_TAKEN', message: 'That invoice number is already recorded.' }, HttpStatus.CONFLICT);
  }
  return e;
}

function safeJson(s: string | null) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
