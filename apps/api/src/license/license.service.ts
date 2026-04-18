import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Per-tenant license enforcement.
 *
 * Pilot tier (no License row):
 *   - 3 seats, perpetual, COMP billing.
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

  static readonly PILOT_SEAT_LIMIT = 3;

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
    return {
      tier: lic.tier,
      seatLimit: lic.seatLimit,
      status: lic.status,
      expiresAt: lic.expiresAt ?? lic.currentPeriodEnd ?? null,
      isPilot: false,
    };
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
      throw new HttpException(
        {
          code: 'LICENSE_EXHAUSTED',
          message: eff.isPilot
            ? `You've reached the Pilot tier limit of ${eff.seatLimit} screens. Upgrade to add more.`
            : `Your ${eff.tier} license includes ${eff.seatLimit} screens; you've claimed ${used}. Upgrade or unpair an existing screen first.`,
          tier: eff.tier,
          seatLimit: eff.seatLimit,
          seatsUsed: used,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }
}
