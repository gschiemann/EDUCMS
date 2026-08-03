import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AppRole } from '@cms/database';
import {
  API_KEY_SCOPES,
  normalizeRequestedScopes,
  parseApiKeyScopes,
} from './api-key-scopes';

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
   * Default key lifetime when the operator doesn't pick one (ACC-06,
   * 2026-08-01).
   *
   * `expiresAt` was nullable and the UI's "no expiry" was the path of least
   * resistance, so the common case was a bearer credential that NEVER expired
   * — pasted into a CI config or a vendor portal and valid forever, long after
   * the integration or the employee who created it was gone. Keys now expire
   * by default; an operator who wants a shorter life can still pass one, and
   * rotation is a two-click mint + revoke.
   */
  static readonly DEFAULT_EXPIRY_DAYS = 90;

  /**
   * Hard ceiling on a requested lifetime. Stops "expiry" from being defeated
   * by asking for the year 9999 — a credential this powerful should be
   * rotated at least annually.
   */
  static readonly MAX_EXPIRY_DAYS = 365;

  private static readonly DAY_MS = 24 * 60 * 60 * 1000;

  /**
   * Resolve the effective expiry: default when unset, clamped to the ceiling,
   * and rejected outright when already in the past (a key born expired is an
   * operator mistake worth surfacing, not silently honoring).
   */
  static resolveExpiry(requested?: Date | null, now: number = Date.now()): Date {
    const ceiling = new Date(now + ApiKeysService.MAX_EXPIRY_DAYS * ApiKeysService.DAY_MS);
    if (!requested) {
      return new Date(now + ApiKeysService.DEFAULT_EXPIRY_DAYS * ApiKeysService.DAY_MS);
    }
    if (requested.getTime() <= now) {
      throw new BadRequestException('Expiry must be in the future.');
    }
    return requested.getTime() > ceiling.getTime() ? ceiling : requested;
  }

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
    /**
     * Least-privilege grant (2026-08-03). `undefined`/`null` mints an
     * UNRESTRICTED key — the pre-scopes behaviour, kept so existing callers
     * and integrations are unaffected. An array narrows the key to those
     * route families; `[]` grants nothing. Emergency routes are unreachable
     * either way (there is no emergency scope, and JwtAuthGuard denies the
     * prefix for every api-key identity).
     */
    scopes?: string[] | null;
    actorUserId: string | null;
  }): Promise<{ id: string; token: string; prefix: string; scopes: string[] | null }> {
    const name = (opts.name || '').trim();
    if (!name) throw new BadRequestException('Name is required.');
    if (name.length > 80) throw new BadRequestException('Name must be 80 characters or fewer.');
    const role = String(opts.role || '').trim();
    if (!ApiKeysService.ALLOWED_ROLES.includes(role)) {
      throw new BadRequestException(
        `Role must be one of: ${ApiKeysService.ALLOWED_ROLES.join(', ')}`,
      );
    }

    // Reject an unrecognized scope loudly. Silently dropping it would hand the
    // operator a key with LESS access than the UI told them they granted, and
    // they would debug the resulting 403s against the wrong layer.
    const { json: scopesJson, unknown: unknownScopes } = normalizeRequestedScopes(opts.scopes);
    if (unknownScopes.length) {
      throw new BadRequestException(
        `Unknown scope(s): ${unknownScopes.join(', ')}. Valid scopes: ${API_KEY_SCOPES.join(', ')}`,
      );
    }

    // ACC-06 — every key gets a real expiry (default 90d, hard cap 365d).
    const expiresAt = ApiKeysService.resolveExpiry(opts.expiresAt);

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
          scopes: scopesJson,
          expiresAt,
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
          // The key MINTED is the subject here, not the actor — a human
          // admin created it, so `userId` (not `apiKeyId`) names who acted.
          details: JSON.stringify({
            name: row.name,
            prefix: row.prefix,
            role: row.role,
            expiresAt: row.expiresAt,
            scopes: parseApiKeyScopes(row.scopes),
          }),
        },
      });
      return row;
    });

    return {
      id: created.id,
      token: fullToken,
      prefix,
      scopes: parseApiKeyScopes(created.scopes),
    };
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
        scopes: true,
        expiresAt: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
        createdByUserId: true,
      },
    });
    // Hand the UI the parsed array (or null for an unrestricted key) rather
    // than the raw JSON string, so the client never re-implements the parse.
    return rows.map((r: any) => ({ ...r, scopes: parseApiKeyScopes(r.scopes) }));
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
   * Returns the loaded row (with role, tenantId and the parsed scope
   * grant) on success; null on any verification failure (unknown prefix,
   * hash mismatch, expired, revoked). Caller treats null as 401.
   *
   * `scopes` is `null` for an unrestricted key (every key minted before
   * 2026-08-03) and an array otherwise — the guard enforces it.
   *
   * Side effect on success: bumps `lastUsedAt` without blocking the
   * response — fire-and-forget so the auth path stays fast.
   */
  async verify(fullToken: string): Promise<{
    id: string;
    tenantId: string;
    role: string;
    scopes: string[] | null;
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

    return {
      id: row.id,
      tenantId: row.tenantId,
      role: row.role,
      scopes: parseApiKeyScopes((row as any).scopes),
    };
  }
}
