import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { assertPoolCapacity, customerTree, poolUsage } from './license-pool';
import { PrismaService } from '../prisma/prisma.service';
import { billingStateOf, cardBillingReady, isFreeTrialTier } from '../billing/trial-policy';

/**
 * Per-tenant license enforcement.
 *
 * Pilot tier (no License row):
 *   - INTERNAL testing accommodation. Seat ceiling = env `PILOT_SEAT_LIMIT`
 *     (default 1000), status ACTIVE, no expiry. This is NOT the plan we
 *     advertise — the advertised customer trial is 14 days / 3 screens
 *     (`FREE_TRIAL` in @cms/api-types billing catalog). A real trial is
 *     enforced once a License/Trial row exists; until the PLAN-001A
 *     entitlement backfill lands, no-license tenants stay on this generous
 *     internal default so the test fleet isn't gated. Set PILOT_SEAT_LIMIT
 *     lower (e.g. 3) to enforce the real trial cap.
 *
 * Standard / Enterprise / vertical tiers:
 *   - whatever License.seatLimit says, expires per License.expiresAt /
 *     currentPeriodEnd.
 *
 * Seat counting: every paired Screen (Screen.tenantId IS NOT NULL AND
 * pairedAt IS NOT NULL) consumes one seat. Unpairing frees a seat. Pending
 * (PENDING / not yet paired) screens DO NOT count — only successful pairs
 * meter against billing.
 */
@Injectable()
export class LicenseService {
  constructor(private readonly prisma: PrismaService) {}

  // 2026-05-04 — operator (testing fleet, no paying customers yet):
  // "bro WTF, your keeping me from testing". The no-license default seat
  // ceiling exists primarily for billing; gating it low blocked internal
  // testing.
  //
  // 2026-07-13 (audit W0-07/PLAN-001A): the ceiling used to be a silent
  // hardcoded 1000 while the doc claimed "3 seats" — a product-truth lie.
  // It is now an EXPLICIT env override (`PILOT_SEAT_LIMIT`, default 1000)
  // logged at boot, so nobody mistakes it for the advertised 3-screen /
  // 14-day trial. The real trial cap is enforced by a Trial/License row
  // (PLAN-001A backfill); until then this stays generous so the test fleet
  // keeps pairing. To enforce the advertised cap early, set PILOT_SEAT_LIMIT=3.
  static readonly PILOT_SEAT_LIMIT = LicenseService.resolvePilotSeatLimit();

  private static resolvePilotSeatLimit(): number {
    const raw = process.env.PILOT_SEAT_LIMIT;
    const parsed = raw != null ? Number(raw) : NaN;
    const limit = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1000;
    // One-time boot visibility so the generous internal ceiling is never
    // silent again (it is NOT the advertised 3-screen trial).
    if (raw == null) {
      // eslint-disable-next-line no-console
      console.warn(
        `[license] PILOT_SEAT_LIMIT unset — no-license tenants get the internal ${limit}-screen ` +
          'pilot ceiling (NOT the advertised 14-day/3-screen trial). Set PILOT_SEAT_LIMIT=3 to enforce the real cap.',
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(`[license] PILOT_SEAT_LIMIT=${limit} (no-license tenant seat ceiling).`);
    }
    return limit;
  }

  /** Effective limit + tier for a tenant, falling back to PILOT defaults.
   *  Optionally takes a Prisma transaction client — callers inside a
   *  $transaction MUST pass it, otherwise they'll deadlock on the
   *  connection pool (the transaction holds the only connection and
   *  findUnique can't acquire a second one). */
  async getEffective(tenantId: string, tx?: any): Promise<{
    tier: string;
    seatLimit: number;
    status: string;
    expiresAt: Date | null;
    isPilot: boolean;
    /** 2026-10-11 — a self-serve free trial (no card yet). */
    isTrial?: boolean;
    /** 2026-10-11 — a live Stripe card subscription bills these seats (one tap adds another). */
    cardSubscription?: boolean;
    monthlyPriceCents?: number | null;
  }> {
    const client = tx ?? this.prisma.client;
    const lic = await client.license.findUnique({ where: { tenantId } });
    if (!lic) {
      return {
        tier: 'PILOT',
        seatLimit: LicenseService.PILOT_SEAT_LIMIT,
        status: 'ACTIVE',
        expiresAt: null,
        isPilot: true,
      };
    }
    const isTrial = isFreeTrialTier(lic.tier) && !lic.stripeSubscriptionId;
    return {
      tier: lic.tier,
      // A trial's 3-screen cap only binds while a customer could pay to lift it.
      seatLimit: isTrial && !cardBillingReady() ? Math.max(lic.seatLimit, LicenseService.PILOT_SEAT_LIMIT) : lic.seatLimit,
      status: lic.status,
      expiresAt: lic.expiresAt ?? lic.currentPeriodEnd ?? null,
      isPilot: false,
      isTrial,
      cardSubscription:
        !!lic.stripeSubscriptionId && (lic.billingMode ?? 'CARD') === 'CARD' && lic.status !== 'CANCELLED',
      monthlyPriceCents: lic.monthlyPriceCents ?? null,
    };
  }

  /**
   * CUSTOMER CONSOLE (2026-10-10) — the organisation-level billing facts for a
   * tenant: its own License and every ancestor's, including deeper location
   * hierarchies. A corporate pool always governs from the organisation root.
   *
   *   - `governing`  the License that decides HOW this tenant is billed: its
   *                  own row if it has one, else the nearest ancestor's. A
   *                  school inside an invoice-billed district has no License
   *                  of its own, and must not be offered card checkout.
   *   - `suspended`  true when this tenant's OR any ancestor's License is
   *                  SUSPENDED — suspending an organisation covers all of its
   *                  schools / locations.
   *   - `rootTenantId` the top-level organisation (the "customer").
   *
   * One query for the usual three-level tree, then bounded batches for deeper
   * chains. Optionally takes a transaction client (same deadlock reason as getEffective).
   */
  async orgAccount(tenantId: string, tx?: any): Promise<{
    rootTenantId: string;
    governing: Record<string, any> | null;
    suspended: boolean;
  }> {
    const client = tx ?? this.prisma.client;
    const chain: any[] = [];
    const seen = new Set<string>();
    // Keep the common organisation/location path in one round trip. Deeper
    // hierarchies continue in batches without truncating the governing root.
    const read = (id: string): Promise<any> => client.tenant.findUnique({
      where: { id },
      select: { id: true, parentId: true, license: true, parent: {
        select: { id: true, parentId: true, license: true, parent: {
          select: { id: true, parentId: true, license: true },
        } },
      } },
    });
    let row: any = await read(tenantId);
    while (row) {
      if (seen.has(row.id) || seen.size >= 100) throw new HttpException({ code: 'CUSTOMER_TREE_INVALID', message: 'Invalid organization hierarchy.' }, 409);
      seen.add(row.id);
      chain.push(row);
      if (!row.parentId) break;
      row = row.parent ?? await read(row.parentId);
    }
    if (!chain.length) return { rootTenantId: tenantId, governing: null, suspended: false };
    const rootLicense = chain[chain.length - 1].license;
    const governing = rootLicense?.pooledSeats ? rootLicense : chain.find((t) => t.license)?.license ?? null;
    const suspended = chain.some((t) => t.license?.status === 'SUSPENDED');
    return { rootTenantId: chain[chain.length - 1].id, governing, suspended };
  }

  /** Count of seats currently in use by this tenant. Optionally takes a
   *  Prisma transaction client so the count + downstream write are
   *  serialized together (used by ScreensController.pair to close the
   *  TOCTOU window between check and claim). */
  async usedSeats(tenantId: string, tx?: any): Promise<number> {
    const client = tx ?? this.prisma.client;
    return client.screen.count({
      where: { tenantId, pairedAt: { not: null } },
    });
  }

  /** Public summary for the dashboard "License" card. */
  async summary(tenantId: string) {
    const [eff, used] = await Promise.all([this.getEffective(tenantId), this.usedSeats(tenantId)]);
    return {
      tier: eff.tier,
      seatLimit: eff.seatLimit,
      seatsUsed: used,
      seatsAvailable: Math.max(0, eff.seatLimit - used),
      status: eff.status,
      expiresAt: eff.expiresAt,
      isPilot: eff.isPilot,
      atLimit: used >= eff.seatLimit,
    };
  }

  /**
   * Throw a clear error when an admin attempts to pair a Screen that would
   * push the tenant over its seat limit. Called by ScreensController.pair
   * (admin-side claim) — the device-side /devices/pair already operates
   * against an admin-claimed Screen so the limit was checked at claim time.
   */
  async assertSeatAvailable(tenantId: string, tx?: any): Promise<void> {
    // CUSTOMER CONSOLE (2026-10-10): a SUSPENDED organisation pairs no new
    // screens — at the organisation itself OR any of its schools / locations
    // (the per-tenant status check below only sees a school's own License,
    // which a school inside a suspended district usually does not have).
    // Screens already paired keep playing; this gate is only on NEW pairs.
    const org = await this.orgAccount(tenantId, tx);
    if (org.suspended) {
      throw new HttpException(
        {
          code: 'ORG_SUSPENDED',
          message: 'This organization is suspended. Contact VenueOS to reactivate it before pairing new screens.',
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    // 2026-10-11 — SELF-SERVE TRIAL. A trial that ended with no card (or a
    // grace period that ran out) pairs no NEW screens until a card is added —
    // the organisation's own trial or its parent's. Screens already paired keep
    // playing. Never enforced while card billing is not live (trial-policy.ts).
    const billing = billingStateOf(org.governing as any, new Date(), cardBillingReady());
    if ((billing.state === 'trial_ended' || billing.state === 'locked') && billing.pairingBlocked) {
      throw new HttpException(
        {
          code: 'TRIAL_ENDED',
          message:
            'Your free trial has ended. Add a payment method to pair more screens — the screens you already have keep playing.',
          canUpgrade: true,
          trialEndsAt: billing.trialEndsAt,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    const client = tx ?? this.prisma.client;
    if (org.governing?.pooledSeats) {
      const governing = org.governing;
      if (governing.status !== 'ACTIVE') throw new HttpException({ code: 'LICENSE_INACTIVE', message: 'The corporate license is not active.' }, 402);
      const expiry = governing.expiresAt ?? governing.currentPeriodEnd;
      if (expiry && new Date(expiry) < new Date()) throw new HttpException({ code: 'LICENSE_EXPIRED', message: 'The corporate license has expired.' }, 402);
      const tree = await customerTree(client, org.rootTenantId);
      const { used } = await poolUsage(client, tree);
      assertPoolCapacity(tree, used, governing.seatLimit, tenantId);
      return;
    }
    const eff = await this.getEffective(tenantId, tx);
    if (eff.status !== 'ACTIVE') {
      throw new HttpException(
        {
          code: 'LICENSE_INACTIVE',
          message: `Your license is ${eff.status.toLowerCase()}. Renew or contact support to claim more screens.`,
          tier: eff.tier,
          status: eff.status,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    // Audit fix #13: enforce expiry. Previously we only checked status,
    // so a license whose expiresAt or currentPeriodEnd had passed but
    // status was never flipped to PAST_DUE/CANCELLED would silently
    // continue allowing new pairs.
    if (eff.expiresAt && eff.expiresAt < new Date()) {
      throw new HttpException(
        {
          code: 'LICENSE_EXPIRED',
          message: `Your ${eff.tier} license expired on ${eff.expiresAt.toISOString().slice(0, 10)}. Renew to claim more screens.`,
          tier: eff.tier,
          expiresAt: eff.expiresAt,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    const used = await this.usedSeats(tenantId, tx);
    if (used >= eff.seatLimit) {
      // 2026-10-11 — never a dead end. The payload says what ONE tap fixes it:
      //  - a card subscriber adds a screen to the plan (POST /billing/seats,
      //    prorated) — `canAddSeat` + the per-screen price;
      //  - a trial adds a payment method (trial days are kept) — `canUpgrade`.
      const canAddSeat = !!eff.cardSubscription && cardBillingReady();
      const canUpgrade = !!eff.isTrial && cardBillingReady();
      throw new HttpException(
        {
          code: 'LICENSE_EXHAUSTED',
          message: eff.isPilot
            ? `You've reached the free-trial limit of ${eff.seatLimit} screens. Choose a plan to add more.`
            : canAddSeat
              ? `Your plan covers ${eff.seatLimit} screen${eff.seatLimit === 1 ? '' : 's'}. Add a screen to your plan to pair this one.`
              : canUpgrade
                ? `Your free trial includes ${eff.seatLimit} screens. Add a payment method to pair more — you still won't be charged until your trial ends.`
                : `Your ${eff.tier} license includes ${eff.seatLimit} screens; you've claimed ${used}. Upgrade or unpair an existing screen first.`,
          tier: eff.tier,
          seatLimit: eff.seatLimit,
          seatsUsed: used,
          ...(canAddSeat ? { canAddSeat: true, perScreenMonthlyCents: eff.monthlyPriceCents ?? null } : {}),
          ...(canUpgrade ? { canUpgrade: true } : {}),
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }
}
