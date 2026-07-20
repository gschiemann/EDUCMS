import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AppRole } from '@cms/database';

/**
 * Tenant-scoped REST API keys (Developer area, 2026-05-25).
 *
 * Token format: `vos_<32-hex>` (35 chars total). Generated once, shown
 * to the operator ONCE, then only the SHA-256 hash is stored. The
 * first 8 chars of the hex portion are stored separately as `prefix`
 * for O(1) index lookup at request time.
 *
 * Why SHA-256 not bcrypt: API keys are high-entropy (128 bits of
 * random) so a fast hash is correct — bcrypt would add ~50ms of CPU
 * to every authenticated request for no security benefit. Same
 * pattern GitHub / Stripe / Slack use for their tokens.
 */
@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  /** Hash an issued token for at-rest storage + lookup verification. */
  static hashToken(fullToken: string): string {
    return createHash('sha256').update(fullToken).digest('hex');
  }

  /** Extract the 8-char prefix from a `vos_<32hex>` token. */
  static prefixOf(fullToken: string): string | null {
    const m = fullToken.match(/^vos_([0-9a-f]{8})[0-9a-f]{24}$/i);
    return m ? m[1].toLowerCase() : null;
  }

  /** Whitelist of roles operators are allowed to mint API keys for.
   *  We deliberately don't include SUPER_ADMIN — that's a platform-
   *  owner role and shouldn't be reachable via tenant-mint. */
  static ALLOWED_ROLES: readonly string[] = [
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
    AppRole.RESTRICTED_VIEWER,
  ];

  /**
   * Mint a new API key for a tenant. Returns the plaintext token
   * ONCE; the caller must surface it to the operator immediately
   * (clipboard-copy pattern) because the DB only stores the hash.
   */
  async mint(opts: {
    tenantId: string;
    name: string;
    role: string;
    expiresAt?: Date | null;
    actorUserId: string | null;
  }): Promise<{ id: string; token: string; prefix: string }> {
    const name = (opts.name || '').trim();
    if (!name) throw new BadRequestException('Name is required.');
    if (name.length > 80) throw new BadRequestException('Name must be 80 characters or fewer.');
    const role = String(opts.role || '').trim();
    if (!ApiKeysService.ALLOWED_ROLES.includes(role)) {
      throw new BadRequestException(
        `Role must be one of: ${ApiKeysService.ALLOWED_ROLES.join(', ')}`,
      );
    }

    // 16 random bytes = 32 hex chars = ~128 bits of entropy. Plenty.
    const hex = randomBytes(16).toString('hex');
    const fullToken = `vos_${hex}`;
    const prefix = hex.slice(0, 8);
    const hashedSecret = ApiKeysService.hashToken(fullToken);

    const created = await this.prisma.client.$transaction(async (tx: any) => {
      const row = await tx.tenantApiKey.create({
        data: {
          tenantId: opts.tenantId,
          name,
          prefix,
          hashedSecret,
          role,
          expiresAt: opts.expiresAt ?? null,
          createdByUserId: opts.actorUserId,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: opts.tenantId,
          userId: opts.actorUserId,
          action: 'API_KEY_CREATED',
          targetType: 'TenantApiKey',
          targetId: row.id,
          details: JSON.stringify({
            name: row.name,
            prefix: row.prefix,
            role: row.role,
            expiresAt: row.expiresAt,
          }),
        },
      });
      return row;
    });

    return { id: created.id, token: fullToken, prefix };
  }

  /** List API keys for a tenant. Never returns hashedSecret. */
  async list(tenantId: string) {
    const rows = await this.prisma.client.tenantApiKey.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        prefix: true,
        role: true,
        expiresAt: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
        createdByUserId: true,
      },
    });
    return rows;
  }

  /** Revoke an API key (soft delete — sets revokedAt). Idempotent. */
  async revoke(opts: { tenantId: string; id: string; actorUserId: string | null }) {
    const row = await this.prisma.client.tenantApiKey.findFirst({
      where: { id: opts.id, tenantId: opts.tenantId },
    });
    if (!row) throw new NotFoundException('API key not found.');
    if (row.revokedAt) return { ok: true, alreadyRevoked: true };

    await this.prisma.client.$transaction(async (tx: any) => {
      await tx.tenantApiKey.updateMany({
        where: { id: row.id, tenantId: opts.tenantId },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          tenantId: opts.tenantId,
          userId: opts.actorUserId,
          action: 'API_KEY_REVOKED',
          targetType: 'TenantApiKey',
          targetId: row.id,
          details: JSON.stringify({ name: row.name, prefix: row.prefix, role: row.role }),
        },
      });
    });

    return { ok: true, alreadyRevoked: false };
  }

  /**
   * Verify a Bearer API key at request time. Used by JwtAuthGuard's
   * fall-through path when the Bearer token doesn't parse as a JWT.
   *
   * Returns the loaded row (with role + tenantId) on success; null on
   * any verification failure (unknown prefix, hash mismatch, expired,
   * revoked). Caller treats null as 401.
   *
   * Side effect on success: bumps `lastUsedAt` without blocking the
   * response — fire-and-forget so the auth path stays fast.
   */
  async verify(fullToken: string): Promise<{
    id: string;
    tenantId: string;
    role: string;
  } | null> {
    const prefix = ApiKeysService.prefixOf(fullToken);
    if (!prefix) return null;
    const row = await this.prisma.client.tenantApiKey.findUnique({
      where: { prefix },
    });
    if (!row) return null;
    // Constant-time-ish comparison via crypto.timingSafeEqual would be
    // ideal but the hash is already a hex string and any difference
    // is rejected — for SHA-256 hashes of high-entropy inputs the
    // timing leak is academic. Keep simple.
    const incomingHash = ApiKeysService.hashToken(fullToken);
    if (incomingHash !== row.hashedSecret) return null;
    if (row.revokedAt) return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;

    // Fire-and-forget lastUsedAt update. We don't await — the request
    // path must not block on this audit-y write.
    this.prisma.client.tenantApiKey
      .updateMany({ where: { id: row.id, tenantId: row.tenantId }, data: { lastUsedAt: new Date() } })
      .catch(() => { /* non-fatal — next request retries */ });

    return { id: row.id, tenantId: row.tenantId, role: row.role };
  }
}
