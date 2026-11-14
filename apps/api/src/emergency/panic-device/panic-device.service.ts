import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  eligibilityRefusal,
  hashPanicCredential,
  isPanicCredentialShape,
  mintPanicCredential,
  type LiveTenant,
  type LiveUser,
  type PanicRefusal,
} from './panic-device.policy';

/**
 * Panic phones (2026-11-14) — the rows and their audit trail. The rules are
 * in `panic-device.policy.ts`; this file only reads and writes.
 *
 * Every enrolment, every revoke, every refused trigger attempt and every
 * trigger sent with a phone writes an immutable `AuditLog` row naming the
 * person, the phone (`targetId` = the device id) and the client address the
 * web origin saw. The trigger itself is ALSO named on the emergency
 * controller's own TRIGGER_EMERGENCY row (`via: 'panic-device'`).
 */

export const PANIC_AUDIT = {
  ENROLLED: 'PANIC_DEVICE_ENROLLED',
  USED: 'PANIC_DEVICE_USED',
  REFUSED: 'PANIC_DEVICE_REFUSED',
  REVOKED: 'PANIC_DEVICE_REVOKED',
} as const;

export interface PanicDeviceRow {
  id: string;
  tenantId: string;
  userId: string;
  label: string;
  createdAt: Date;
  createdIp: string | null;
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  revokedAt: Date | null;
  revokedByUserId: string | null;
  revokedReason: string | null;
}

export interface PanicPerson extends LiveUser {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}

export interface PanicOrg extends LiveTenant {
  name: string | null;
  slug: string | null;
}

export type PanicAuthResult =
  | { ok: true; device: PanicDeviceRow; user: PanicPerson; tenant: PanicOrg }
  | { ok: false; refusal: PanicRefusal; device: PanicDeviceRow | null };

/** The columns that may leave this service — never `secretHash`. */
const DEVICE_SELECT = {
  id: true,
  tenantId: true,
  userId: true,
  label: true,
  createdAt: true,
  createdIp: true,
  lastUsedAt: true,
  lastUsedIp: true,
  revokedAt: true,
  revokedByUserId: true,
  revokedReason: true,
} as const;

/** `lastUsedAt` is a "last seen", not a log: written at most this often per phone. */
const TOUCH_EVERY_MS = 5 * 60 * 1000;

@Injectable()
export class PanicDeviceService {
  private readonly logger = new Logger('PanicDevice');
  private readonly lastTouch = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  private get db(): any {
    return this.prisma.client as any;
  }

  /**
   * Who is this credential, as the database says NOW? A refusal for the
   * account (disabled, removed, authority lost, moved organisation, archived)
   * also REVOKES the row, so re-enabling the account never silently brings an
   * old phone back. A database error propagates — the caller answers 503 and
   * the phone keeps its cookie (could not find out ≠ refused).
   */
  async authenticate(credential: unknown, meta: { ip: string | null }): Promise<PanicAuthResult> {
    if (!isPanicCredentialShape(credential)) return { ok: false, refusal: 'unknown', device: null };
    // ten-ok: identity-derived — the presented 256-bit credential IS the
    // principal; its sha256 is unique and the row it finds names the tenant.
    const device = (await this.db.panicDevice.findUnique({
      where: { secretHash: hashPanicCredential(credential) },
      select: DEVICE_SELECT,
    })) as PanicDeviceRow | null;
    if (!device) return { ok: false, refusal: 'unknown', device: null };
    if (device.revokedAt) return { ok: false, refusal: 'revoked', device };

    const [user, tenant] = await Promise.all([
      // ten-ok: identity SELF-lookup — the device row names its person; the
      // tenant is compared against the row's own tenant just below.
      this.db.user.findUnique({
        where: { id: device.userId },
        select: {
          id: true,
          tenantId: true,
          role: true,
          status: true,
          deletedAt: true,
          canTriggerPanic: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      }) as Promise<PanicPerson | null>,
      this.db.tenant.findUnique({
        where: { id: device.tenantId },
        select: { id: true, archivedAt: true, name: true, slug: true },
      }) as Promise<PanicOrg | null>,
    ]);

    const refusal = eligibilityRefusal(device, user, tenant);
    if (refusal) {
      await this.revoke({ device, byUserId: null, reason: `ineligible:${refusal}`, ip: meta.ip });
      return { ok: false, refusal, device: { ...device, revokedAt: new Date() } };
    }
    return { ok: true, device, user: user as PanicPerson, tenant: tenant as PanicOrg };
  }

  /** "Last seen" — fire-and-forget, at most every five minutes per phone. */
  touch(device: PanicDeviceRow, ip: string | null): void {
    const now = Date.now();
    const last = this.lastTouch.get(device.id) ?? 0;
    if (now - last < TOUCH_EVERY_MS) return;
    this.lastTouch.set(device.id, now);
    if (this.lastTouch.size > 10_000) this.lastTouch.clear();
    try {
      void this.db.panicDevice
        .updateMany({
          where: { id: device.id, tenantId: device.tenantId, revokedAt: null },
          data: { lastUsedAt: new Date(now), lastUsedIp: ip },
        })
        .catch((e: any) => this.logger.warn(`lastUsedAt write skipped: ${e?.message ?? e}`));
    } catch (e: any) {
      this.logger.warn(`lastUsedAt write unavailable: ${e?.message ?? e}`);
    }
  }

  async countActiveForUser(userId: string, tenantId: string): Promise<number> {
    return this.db.panicDevice.count({ where: { userId, tenantId, revokedAt: null } });
  }

  /**
   * Mint one credential for this person's phone. The secret is returned ONCE,
   * to the web origin's server, which puts it in the HttpOnly cookie and
   * nowhere else. The row and its audit row commit together.
   */
  async enroll(input: {
    user: { id: string; tenantId: string; email: string };
    label: string;
    ip: string | null;
    userAgent: string | null;
  }): Promise<{ credential: string; device: PanicDeviceRow }> {
    const credential = mintPanicCredential();
    const device = (await this.prisma.client.$transaction(async (tx: any) => {
      const row = await tx.panicDevice.create({
        data: {
          tenantId: input.user.tenantId,
          userId: input.user.id,
          secretHash: hashPanicCredential(credential),
          label: input.label,
          createdIp: input.ip,
        },
        select: DEVICE_SELECT,
      });
      await tx.auditLog.create({
        data: {
          tenantId: input.user.tenantId,
          userId: input.user.id,
          action: PANIC_AUDIT.ENROLLED,
          targetType: 'panicDevice',
          targetId: row.id,
          details: JSON.stringify({
            label: input.label,
            ip: input.ip,
            ua: (input.userAgent ?? '').slice(0, 256),
            email: input.user.email,
          }),
        },
      });
      return row;
    })) as PanicDeviceRow;
    return { credential, device };
  }

  /**
   * Turn one phone off. Idempotent: an already-revoked row changes nothing
   * and writes no second row. Returns whether THIS call revoked it.
   */
  async revoke(input: {
    device: Pick<PanicDeviceRow, 'id' | 'tenantId' | 'userId' | 'label'>;
    byUserId: string | null;
    reason: string;
    ip: string | null;
  }): Promise<boolean> {
    const { device } = input;
    return this.prisma.client.$transaction(async (tx: any) => {
      const res = await tx.panicDevice.updateMany({
        where: { id: device.id, tenantId: device.tenantId, userId: device.userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedByUserId: input.byUserId, revokedReason: input.reason.slice(0, 120) },
      });
      if (res.count !== 1) return false;
      await tx.auditLog.create({
        data: {
          tenantId: device.tenantId,
          // The person who turned it off; null = the server, for an account
          // that is no longer eligible (details.reason says which).
          userId: input.byUserId,
          action: PANIC_AUDIT.REVOKED,
          targetType: 'panicDevice',
          targetId: device.id,
          details: JSON.stringify({ reason: input.reason, ownerUserId: device.userId, label: device.label, ip: input.ip }),
        },
      });
      return true;
    });
  }

  /** Every phone of one person, in one organisation (the admin's 2FA reset). */
  async revokeAllForUser(input: { userId: string; tenantId: string; byUserId: string | null; reason: string; ip: string | null }): Promise<number> {
    const rows = (await this.db.panicDevice.findMany({
      where: { userId: input.userId, tenantId: input.tenantId, revokedAt: null },
      select: DEVICE_SELECT,
    })) as PanicDeviceRow[];
    let n = 0;
    for (const device of rows) {
      // eslint-disable-next-line no-await-in-loop
      if (await this.revoke({ device, byUserId: input.byUserId, reason: input.reason, ip: input.ip })) n += 1;
    }
    return n;
  }

  /** One person's phones in one organisation, newest first, revoked included. */
  async listForUser(userId: string, tenantId: string): Promise<PanicDeviceRow[]> {
    return this.db.panicDevice.findMany({
      where: { userId, tenantId },
      select: DEVICE_SELECT,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /** One phone of one person in one organisation, or null. */
  async findForUser(deviceId: string, userId: string, tenantId: string): Promise<PanicDeviceRow | null> {
    return this.db.panicDevice.findFirst({
      where: { id: deviceId, userId, tenantId },
      select: DEVICE_SELECT,
    });
  }

  /** The phone's own trail: a trigger sent with it, or refused. Best-effort; never fails the caller. */
  async auditUse(input: {
    action: typeof PANIC_AUDIT.USED | typeof PANIC_AUDIT.REFUSED;
    device: Pick<PanicDeviceRow, 'id' | 'tenantId' | 'userId' | 'label'>;
    details: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.db.auditLog.create({
        data: {
          tenantId: input.device.tenantId,
          userId: input.device.userId,
          action: input.action,
          targetType: 'panicDevice',
          targetId: input.device.id,
          details: JSON.stringify({ label: input.device.label, ...input.details }),
        },
      });
    } catch (e: any) {
      this.logger.warn(`audit(${input.action}) failed for panic device ${input.device.id}: ${e?.message ?? e}`);
    }
  }
}
