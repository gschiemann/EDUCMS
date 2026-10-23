/**
 * Key-rotation re-wrap — move every stored credential envelope onto the
 * PRIMARY `DEVICE_SECRET_KEY` (2026-10-22, `security/key-ring.ts`).
 *
 * WHAT IT TOUCHES. Every table whose rows carry a data key wrapped with the
 * master key — and ONLY the wrapped data key. The three envelope ciphers all
 * expose a `rewrap*ToPrimary` that opens the 60-byte data-key envelope with
 * whichever ring key fits and re-wraps it with the primary; the inner
 * ciphertext (credential JSON, API key, TOTP secret, Wi-Fi passphrase) is
 * copied byte for byte and is NEVER decrypted by this job.
 *
 *   StreamProviderConnection.encryptedDataKey   streaming/creds-cipher.ts
 *   PosProviderConnection.encryptedDataKey      ″
 *   AdNetworkConnection.encryptedDataKey        ″
 *   SocialProviderConnection.encryptedDataKey   ″
 *   DesiredDeviceSettings.wifiSecret            ″  (JSON {encryptedCreds, encryptedDataKey})
 *   Tenant.aiKeyEncrypted                       ai/ai-key-cipher.ts
 *   User.mfaTotpSecret                          auth/mfa-secret-cipher.ts
 *
 * SAFETY PROPERTIES (each one tested in the spec):
 *   • NO-OP WITHOUT A WINDOW. `DEVICE_SECRET_KEY_PREVIOUS` unset ⇒ nothing is
 *     read, nothing is written, no audit row.
 *   • IDEMPOTENT. A row already on the primary answers `current` and is not
 *     written; a second run rewrites zero rows.
 *   • TENANT-SCOPED, GUARDED WRITES. Every update is `updateMany` on the row's
 *     id AND tenant AND the exact old ciphertext, so a concurrent re-seal by
 *     the operator (new creds, new MFA enrolment) can never be overwritten
 *     with a re-wrap of the stale value — the guard misses and the row is
 *     simply left on whatever the operator just wrote (which is the primary).
 *   • LEAVES WHAT IT CANNOT READ. A row neither key opens is counted as
 *     `unreadable` and untouched; it was unreadable before this job too.
 *   • COUNTS ONLY. Logs and the AuditLog row carry numbers per table — never
 *     a ciphertext, a key, or a tenant's secret.
 *   • ONE RUNNER. The boot pass is leader-leased (`LEASE.KEY_ROTATION_REWRAP`);
 *     the SUPER_ADMIN route runs on the replica that received it. Both go
 *     through the same single-flight `run()`, so two overlapping triggers on
 *     one process coalesce.
 *
 * WHY A BOOT PASS AND A ROUTE. The window opens the moment the deploy carrying
 * `_PREVIOUS` boots, so the boot pass starts the migration with no operator
 * step. The route exists for the runbook's "prove it is done" step
 * (`docs/SECRET-ROTATION.md`): a run that reports `rewrapped: 0` and
 * `unreadable: 0` everywhere is the signal that `_PREVIOUS` can be deleted.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LEASE, LeaderLeaseService, leadThisTick } from '../realtime/leader-lease.service';
import { rewrapDataKeyToPrimary } from '../streaming/creds-cipher';
import { rewrapAiKeyToPrimary } from '../ai/ai-key-cipher';
import { rewrapMfaSecretToPrimary } from '../auth/mfa-secret-cipher';
import { DEVICE_SECRET_KEY_NAME, deviceSecretKeyRing, previousSecretName } from './key-ring';
import { ensureSystemTenant, SYSTEM_TENANT_ID } from './system-tenant';

/** Per-table tally. Numbers only, by construction. */
export interface RewrapTableCounts {
  scanned: number;
  rewrapped: number;
  /** Already on the primary. */
  current: number;
  /** Neither ring key opens it; left untouched. */
  unreadable: number;
  /** The guarded write missed (row changed underneath) — left to the newer value. */
  skipped: number;
}

export interface RewrapReport {
  /** `false` when no rotation window is open (`DEVICE_SECRET_KEY_PREVIOUS` unset): nothing ran. */
  ran: boolean;
  trigger: 'boot' | 'manual';
  startedAt: string;
  elapsedMs: number;
  tables: Record<string, RewrapTableCounts>;
  totals: RewrapTableCounts;
}

export const KEY_ROTATION_REWRAP_AUDIT_ACTION = 'KEY_ROTATION_REWRAP';

const PAGE = 200;

function emptyCounts(): RewrapTableCounts {
  return { scanned: 0, rewrapped: 0, current: 0, unreadable: 0, skipped: 0 };
}

/**
 * One table's worth of work, described declaratively so the loop below is the
 * only place that pages, writes and counts.
 */
interface SealedTable {
  name: string;
  /** Page of rows after `cursorId` (by id asc). Each row carries id, tenant and the sealed value. */
  page(prisma: any, cursorId: string | null): Promise<Array<{ id: string; tenantId: string; sealed: string | null }>>;
  /** `null` ⇒ leave the row (current / unreadable). */
  rewrap(sealed: string): { status: 'current' | 'unreadable' } | { status: 'rewrapped'; next: string };
  /** Guarded write: must match id + tenant + the exact old sealed value. Returns rows written. */
  write(prisma: any, row: { id: string; tenantId: string }, oldSealed: string, next: string): Promise<number>;
}

function credsTable(name: string, delegate: string): SealedTable {
  return {
    name,
    page: async (prisma, cursorId) =>
      (
        await prisma[delegate].findMany({
          select: { id: true, tenantId: true, encryptedDataKey: true },
          orderBy: { id: 'asc' },
          take: PAGE,
          ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
        })
      ).map((r: any) => ({ id: r.id, tenantId: r.tenantId, sealed: r.encryptedDataKey })),
    rewrap: (sealed) => {
      const r = rewrapDataKeyToPrimary(sealed);
      return r.status === 'rewrapped' ? { status: 'rewrapped', next: r.encryptedDataKey } : r;
    },
    write: async (prisma, row, oldSealed, next) =>
      (
        await prisma[delegate].updateMany({
          where: { id: row.id, tenantId: row.tenantId, encryptedDataKey: oldSealed },
          data: { encryptedDataKey: next },
        })
      ).count,
  };
}

/**
 * `DesiredDeviceSettings.wifiSecret` holds `JSON.stringify(SealedCredentials)`.
 * Only `encryptedDataKey` inside it changes; the JSON is re-serialised with the
 * same keys in the same order.
 */
const wifiSecretTable: SealedTable = {
  name: 'DesiredDeviceSettings.wifiSecret',
  page: async (prisma, cursorId) =>
    (
      await prisma.desiredDeviceSettings.findMany({
        where: { wifiSecret: { not: null } },
        select: { screenId: true, tenantId: true, wifiSecret: true },
        orderBy: { screenId: 'asc' },
        take: PAGE,
        ...(cursorId ? { cursor: { screenId: cursorId }, skip: 1 } : {}),
      })
    ).map((r: any) => ({ id: r.screenId, tenantId: r.tenantId, sealed: r.wifiSecret })),
  rewrap: (sealed) => {
    let parsed: any;
    try {
      parsed = JSON.parse(sealed);
    } catch {
      return { status: 'unreadable' };
    }
    if (!parsed || typeof parsed.encryptedDataKey !== 'string') return { status: 'unreadable' };
    const r = rewrapDataKeyToPrimary(parsed.encryptedDataKey);
    if (r.status !== 'rewrapped') return r;
    return { status: 'rewrapped', next: JSON.stringify({ ...parsed, encryptedDataKey: r.encryptedDataKey }) };
  },
  write: async (prisma, row, oldSealed, next) =>
    (
      await prisma.desiredDeviceSettings.updateMany({
        where: { screenId: row.id, tenantId: row.tenantId, wifiSecret: oldSealed },
        data: { wifiSecret: next },
      })
    ).count,
};

const aiKeyTable: SealedTable = {
  name: 'Tenant.aiKeyEncrypted',
  page: async (prisma, cursorId) =>
    (
      await prisma.tenant.findMany({
        where: { aiKeyEncrypted: { not: null } },
        select: { id: true, aiKeyEncrypted: true },
        orderBy: { id: 'asc' },
        take: PAGE,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      })
    ).map((r: any) => ({ id: r.id, tenantId: r.id, sealed: r.aiKeyEncrypted })),
  rewrap: (sealed) => {
    const r = rewrapAiKeyToPrimary(sealed);
    return r.status === 'rewrapped' ? { status: 'rewrapped', next: r.sealed } : r;
  },
  write: async (prisma, row, oldSealed, next) =>
    (
      await prisma.tenant.updateMany({
        where: { id: row.id, aiKeyEncrypted: oldSealed },
        data: { aiKeyEncrypted: next },
      })
    ).count,
};

const mfaTable: SealedTable = {
  name: 'User.mfaTotpSecret',
  page: async (prisma, cursorId) =>
    (
      await prisma.user.findMany({
        where: { mfaTotpSecret: { not: null } },
        select: { id: true, tenantId: true, mfaTotpSecret: true },
        orderBy: { id: 'asc' },
        take: PAGE,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      })
    ).map((r: any) => ({ id: r.id, tenantId: r.tenantId, sealed: r.mfaTotpSecret })),
  rewrap: (sealed) => {
    const r = rewrapMfaSecretToPrimary(sealed);
    return r.status === 'rewrapped' ? { status: 'rewrapped', next: r.sealed } : r;
  },
  write: async (prisma, row, oldSealed, next) =>
    (
      await prisma.user.updateMany({
        where: { id: row.id, tenantId: row.tenantId, mfaTotpSecret: oldSealed },
        data: { mfaTotpSecret: next },
      })
    ).count,
};

export const SEALED_TABLES: readonly SealedTable[] = [
  credsTable('StreamProviderConnection', 'streamProviderConnection'),
  credsTable('PosProviderConnection', 'posProviderConnection'),
  credsTable('AdNetworkConnection', 'adNetworkConnection'),
  credsTable('SocialProviderConnection', 'socialProviderConnection'),
  wifiSecretTable,
  aiKeyTable,
  mfaTable,
];

@Injectable()
export class KeyRotationRewrapService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KeyRotationRewrapService.name);
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<RewrapReport> | null = null;

  /** Boot delay: after the pool is warm and the health check is green. */
  static readonly BOOT_DELAY_MS = 45_000;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly lease?: LeaderLeaseService,
  ) {}

  /** True when `DEVICE_SECRET_KEY_PREVIOUS` is set and valid — i.e. there is something to migrate. */
  static windowOpen(): boolean {
    return deviceSecretKeyRing().previous !== undefined;
  }

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    if (!KeyRotationRewrapService.windowOpen()) return;
    this.logger.warn(
      `${previousSecretName(DEVICE_SECRET_KEY_NAME)} is set — a ${DEVICE_SECRET_KEY_NAME} rotation window is open. ` +
        `Stored credential envelopes will be re-wrapped onto the primary key shortly after boot (leader only).`,
    );
    this.bootTimer = setTimeout(() => {
      void this.runAtBoot().catch((e) =>
        this.logger.warn(`boot re-wrap failed: ${(e as Error).message}`),
      );
    }, KeyRotationRewrapService.BOOT_DELAY_MS);
  }

  onModuleDestroy(): void {
    if (this.bootTimer) clearTimeout(this.bootTimer);
  }

  /** The leased boot pass. Public so the spec can drive it. */
  async runAtBoot(): Promise<RewrapReport | null> {
    if (!KeyRotationRewrapService.windowOpen()) return null;
    const status = await leadThisTick(this.lease, LEASE.KEY_ROTATION_REWRAP, { ttlMs: 10 * 60_000 });
    if (!status.leader) return null;
    try {
      return await this.run('boot');
    } finally {
      await this.lease?.release(LEASE.KEY_ROTATION_REWRAP).catch(() => undefined);
    }
  }

  /**
   * Re-wrap every sealed row onto the primary. Single-flight per process.
   * Safe to call with no window open: answers `{ ran: false }` and touches
   * nothing.
   */
  run(trigger: 'boot' | 'manual', actorUserId: string | null = null): Promise<RewrapReport> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.execute(trigger, actorUserId).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async execute(trigger: 'boot' | 'manual', actorUserId: string | null): Promise<RewrapReport> {
    const startedAt = new Date();
    const report: RewrapReport = {
      ran: false,
      trigger,
      startedAt: startedAt.toISOString(),
      elapsedMs: 0,
      tables: {},
      totals: emptyCounts(),
    };
    if (!KeyRotationRewrapService.windowOpen()) return report;
    report.ran = true;

    const prisma: any = this.prisma.client;
    for (const table of SEALED_TABLES) {
      const counts = emptyCounts();
      report.tables[table.name] = counts;
      let cursor: string | null = null;
      // Paged by id so a long table never holds a big result set; the
      // guarded write means a page can be re-read safely after a crash.
      for (;;) {
        const rows = await table.page(prisma, cursor);
        if (rows.length === 0) break;
        for (const row of rows) {
          cursor = row.id;
          if (typeof row.sealed !== 'string' || row.sealed.length === 0) continue;
          counts.scanned++;
          const verdict = table.rewrap(row.sealed);
          if (verdict.status !== 'rewrapped') {
            if (verdict.status === 'current') counts.current++;
            else counts.unreadable++;
            continue;
          }
          const written = await table.write(prisma, row, row.sealed, verdict.next);
          if (written === 1) counts.rewrapped++;
          else counts.skipped++;
        }
        if (rows.length < PAGE) break;
      }
      for (const k of Object.keys(counts) as Array<keyof RewrapTableCounts>) {
        report.totals[k] += counts[k];
      }
    }

    report.elapsedMs = Date.now() - startedAt.getTime();
    const t = report.totals;
    this.logger.log(
      `[key-rotation] re-wrap (${trigger}) scanned=${t.scanned} rewrapped=${t.rewrapped} ` +
        `current=${t.current} unreadable=${t.unreadable} skipped=${t.skipped} in ${report.elapsedMs}ms` +
        (t.unreadable > 0
          ? ' — unreadable rows were wrapped under a key that is in neither slot; they were left untouched'
          : ''),
    );
    await this.audit(report, actorUserId);
    return report;
  }

  /** One AuditLog row per run, under the system tenant. Counts only. */
  private async audit(report: RewrapReport, actorUserId: string | null): Promise<void> {
    try {
      const prisma: any = this.prisma.client;
      await ensureSystemTenant(prisma);
      await prisma.auditLog.create({
        data: {
          action: KEY_ROTATION_REWRAP_AUDIT_ACTION,
          targetType: 'secret',
          targetId: DEVICE_SECRET_KEY_NAME,
          tenantId: SYSTEM_TENANT_ID,
          userId: actorUserId,
          details: JSON.stringify({
            trigger: report.trigger,
            startedAt: report.startedAt,
            elapsedMs: report.elapsedMs,
            totals: report.totals,
            tables: report.tables,
          }),
        },
      });
    } catch (e) {
      this.logger.warn(`[key-rotation] audit write failed: ${(e as Error).message}`);
    }
  }
}
