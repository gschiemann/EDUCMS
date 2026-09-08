import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * SEC-010 (2026-09-05) — the server half of the durable session credential.
 *
 * THE FINDING: "the remembered bearer remains JS-readable for up to 30 days."
 * `rememberMe` used to mean a THIRTY-DAY access JWT sitting in localStorage.
 * Now the access token is always <= 1h and the durable half is an OPAQUE,
 * SINGLE-USE, ROTATING secret that page JavaScript never touches — it lives
 * in an HttpOnly cookie set by the web origin's own route handlers.
 *
 * Properties this service is responsible for:
 *
 *  1. **Opaque, not a JWT.** Nothing in the token is readable or forgeable;
 *     it carries no claims. All state is the row.
 *  2. **Hashed at rest.** Only sha256(secret) is stored — a database dump
 *     must never contain a live credential (same rule as
 *     `RevokedCredential.key`).
 *  3. **Single use + rotation.** Every successful presentation marks the row
 *     `usedAt` and mints the NEXT generation in the same family, atomically:
 *     the `updateMany({ tokenHash, usedAt: null })` is the compare-and-set,
 *     so two concurrent presentations of the same row cannot both win.
 *  4. **Reuse detection.** Presenting a row that ALREADY carries `usedAt`
 *     means the token was replayed. We cannot tell a stolen copy from a
 *     client that raced, and we do not guess: the WHOLE FAMILY is revoked and
 *     the user re-authenticates. That is the property that makes theft of the
 *     cookie survivable — a thief who uses it burns the victim's session,
 *     which is loud, and a thief who does not use it gains nothing.
 *  5. **Anchored to the credential check.** `origIat` rides every row and
 *     every access token minted from it, so a family can never outlive
 *     `origIat + MAX_FAMILY_LIFETIME_SEC` (30 days), and the per-user
 *     invalid-before epoch (change-password, forced logout) kills it — see
 *     `SessionController`.
 *
 * Postgres is the store, not Redis, deliberately: this is the credential that
 * has to survive a Redis flush. Losing it silently signs out every remembered
 * operator on the fleet, which is precisely the "remember me" regression the
 * design is not allowed to introduce.
 */

/** 30 days from the ORIGINAL credential check. Matches the pre-SEC-010
 *  rememberMe ceiling exactly — the lifetime did not change, only where the
 *  credential lives and what a stolen page context can read. */
export const MAX_FAMILY_LIFETIME_SEC = 30 * 24 * 60 * 60;

/** Bytes of entropy in the opaque secret. 32 = 256 bits. */
const SECRET_BYTES = 32;

/** Shape a presented token must have before we spend a database round trip
 *  on it: `<familyId>.<secret>`, both base64url. The family id is carried in
 *  the clear so a reuse event can be attributed even when the secret half no
 *  longer matches any row. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{16,64}\.[A-Za-z0-9_-]{32,128}$/;

export function hashRefreshSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export type RotateOutcome =
  | { ok: true; token: string; userId: string; origIat: number; familyId: string; expiresAt: Date }
  | { ok: false; reason: 'malformed' | 'unknown' | 'expired' | 'revoked' | 'reused' };

export interface IssueMeta {
  userAgent?: string | null;
  ipAddress?: string | null;
}

@Injectable()
export class SessionRefreshService {
  private readonly logger = new Logger('SessionRefresh');
  private lastPruneAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Opportunistic cleanup of rows past their family ceiling.
   *
   * Expired rows are INERT — `rotate` refuses them on `expiresAt` before it
   * can mint anything — but one row is written per rotation, so without a
   * prune this table grows forever. Deliberately the same shape as
   * `RedisService.pruneExpiredMirrorRows`: fire-and-forget from a write,
   * gated to once an hour per process, best-effort, and a failure only
   * defers cleanup.
   *
   * NO LEADER LEASE, DELIBERATELY. `deleteMany` on an expiry predicate is
   * idempotent and commutative, so N replicas running it concurrently is
   * indistinguishable from one replica running it N times — leasing would
   * add a Redis dependency to a query that does not need one, and a replica
   * that lost Redis would then stop pruning for no benefit.
   *
   * It does NOT cost forensics: the incident record for a replayed token is
   * the immutable `AuditLog` row (`AUTH_SESSION_REFRESH_REUSE`), not these
   * rows, and a token whose family has been purged grades `unknown` rather
   * than `reused` — which is correct, since nothing about it can be attested
   * any more.
   */
  private prunePastCeiling(): void {
    const now = Date.now();
    if (now - this.lastPruneAt < 60 * 60 * 1000) return;
    this.lastPruneAt = now;
    try {
      this.prisma.client.sessionRefreshToken
        .deleteMany({ where: { expiresAt: { lt: new Date(now) } } })
        .then((res: { count: number }) => {
          if (res.count > 0) this.logger.log(`Pruned ${res.count} expired session refresh rows`);
        })
        .catch((e: any) => {
          this.logger.warn(`Expired session-refresh prune failed (deferred): ${e?.message ?? e}`);
        });
    } catch (e: any) {
      // A SYNCHRONOUS throw here (a degraded client, a stale generated
      // Prisma client that predates this model) must not be able to fail the
      // login or the refresh it is riding along with. Housekeeping never
      // breaks the credential path.
      this.logger.warn(`Expired session-refresh prune unavailable: ${e?.message ?? e}`);
    }
  }

  /** `<familyId>.<secret>` — the only form that ever leaves this service. */
  private mint(familyId: string): { token: string; secret: string } {
    const secret = randomBytes(SECRET_BYTES).toString('base64url');
    return { token: `${familyId}.${secret}`, secret };
  }

  private split(token: string): { familyId: string; secret: string } | null {
    if (typeof token !== 'string' || !TOKEN_SHAPE.test(token)) return null;
    const dot = token.indexOf('.');
    return { familyId: token.slice(0, dot), secret: token.slice(dot + 1) };
  }

  /**
   * Open a NEW family for a session that has just proved itself.
   *
   * `origIat` is the caller's `origIat` claim (the original credential
   * check), NOT `now` — a session that has already been sliding for 20 days
   * gets a cookie that dies in 10, never a fresh 30.
   */
  async issueFamily(
    userId: string,
    origIat: number,
    meta: IssueMeta = {},
  ): Promise<{ token: string; expiresAt: Date } | null> {
    const expiresAt = new Date((origIat + MAX_FAMILY_LIFETIME_SEC) * 1000);
    // Nothing to hand out for a session already past its ceiling.
    if (expiresAt.getTime() - Date.now() < 60_000) return null;

    const familyId = randomBytes(16).toString('base64url');
    const { token, secret } = this.mint(familyId);
    await this.prisma.client.sessionRefreshToken.create({
      data: {
        familyId,
        userId,
        tokenHash: hashRefreshSecret(secret),
        generation: 0,
        origIat,
        expiresAt,
        userAgent: (meta.userAgent || '').slice(0, 256) || null,
        ipAddress: meta.ipAddress || null,
      },
    });
    this.prunePastCeiling();
    return { token, expiresAt };
  }

  /**
   * Spend a refresh token and hand back its successor.
   *
   * Every failure mode is reported to the caller rather than thrown, because
   * they map to DIFFERENT operator-visible outcomes (a reuse is a security
   * event that gets audited; an expiry is just "log in again") and because a
   * refusal must never be confused with an infrastructure error.
   */
  async rotate(presented: string, meta: IssueMeta = {}): Promise<RotateOutcome> {
    const parts = this.split(presented);
    if (!parts) return { ok: false, reason: 'malformed' };

    const tokenHash = hashRefreshSecret(parts.secret);
    const row = await this.prisma.client.sessionRefreshToken.findUnique({ where: { tokenHash } });

    // Unknown hash. Two cases, and they are NOT the same: a token whose
    // family we can still see (the row was pruned, or the secret was
    // tampered with) is treated as a reuse event against that family —
    // fail loud on the family, not silently on the request.
    if (!row) {
      const familyAlive = await this.prisma.client.sessionRefreshToken.findFirst({
        where: { familyId: parts.familyId, revokedAt: null },
        select: { id: true },
      });
      if (familyAlive) {
        await this.revokeFamily(parts.familyId, 'unknown-secret-in-live-family');
        return { ok: false, reason: 'reused' };
      }
      return { ok: false, reason: 'unknown' };
    }

    // Defence in depth: the row we found was looked up BY the hash, so this
    // can only differ if two hashes collided. Constant-time anyway — this
    // file is the one place a timing signal would be worth mounting.
    if (!safeEquals(row.tokenHash, tokenHash)) return { ok: false, reason: 'unknown' };

    if (row.revokedAt) return { ok: false, reason: 'revoked' };

    // ── REUSE DETECTION ──────────────────────────────────────────────────
    // The row has already been rotated away. Either an attacker replayed a
    // stolen cookie or the legitimate client raced itself. We cannot tell,
    // and the safe answer to both is the same: burn the family.
    if (row.usedAt) {
      await this.revokeFamily(row.familyId, 'replayed-refresh-token');
      this.logger.warn(
        JSON.stringify({
          event: 'SESSION_REFRESH_REUSE_DETECTED',
          familyId: row.familyId,
          userId: row.userId,
          generation: row.generation,
          ip: meta.ipAddress ?? null,
        }),
      );
      return { ok: false, reason: 'reused' };
    }

    if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' };

    // Compare-and-set: exactly one concurrent presentation flips usedAt.
    const claimed = await this.prisma.client.sessionRefreshToken.updateMany({
      where: { id: row.id, usedAt: null, revokedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) {
      // Someone else won the race between the read and the write — which is
      // the same observable event as a replay. Same verdict.
      await this.revokeFamily(row.familyId, 'concurrent-refresh-claim');
      return { ok: false, reason: 'reused' };
    }

    const { token, secret } = this.mint(row.familyId);
    await this.prisma.client.sessionRefreshToken.create({
      data: {
        familyId: row.familyId,
        userId: row.userId,
        tokenHash: hashRefreshSecret(secret),
        generation: row.generation + 1,
        origIat: row.origIat,
        // The successor NEVER outlives the family ceiling.
        expiresAt: row.expiresAt,
        userAgent: (meta.userAgent || '').slice(0, 256) || null,
        ipAddress: meta.ipAddress || null,
      },
    });

    // ── The successor must not survive a revoke that raced our INSERT ────
    // `revokeFamily` only touches rows that exist when it runs. A loser of
    // the compare-and-set above (or a concurrent replay from a thief) can
    // burn the family in the window between our claim and our insert, and
    // the freshly-created row would come out unrevoked — the one hole that
    // would let a detected reuse leave a live credential behind. Re-read the
    // row we spent: if it is revoked now, the burn happened during our write,
    // so re-run it (idempotent, and it covers the new row) and refuse.
    const after = await this.prisma.client.sessionRefreshToken.findUnique({
      where: { id: row.id },
      select: { revokedAt: true },
    });
    if (after?.revokedAt) {
      await this.revokeFamily(row.familyId, 'family-burned-during-rotation');
      return { ok: false, reason: 'reused' };
    }

    // One row per rotation, so this is the write that would grow the table
    // without bound. Hourly-gated and fire-and-forget — never on the path
    // the caller awaits.
    this.prunePastCeiling();

    return {
      ok: true,
      token,
      userId: row.userId,
      origIat: row.origIat,
      familyId: row.familyId,
      expiresAt: row.expiresAt,
    };
  }

  /** Kill every generation of one login. Idempotent. */
  async revokeFamily(familyId: string, reason: string): Promise<void> {
    try {
      await this.prisma.client.sessionRefreshToken.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } catch (e: any) {
      // Never silent (2026-05-21 lesson). A failed revoke is a real security
      // event, and the caller still refuses the request.
      this.logger.warn(`revokeFamily(${familyId}, ${reason}) failed: ${e?.message ?? e}`);
    }
  }

  /**
   * Sign-out path: revoke the family a presented token belongs to WITHOUT
   * treating an already-spent token as an attack. Logging out twice, or
   * logging out with the cookie the last refresh replaced, is normal.
   */
  async revokeByPresentedToken(presented: string): Promise<boolean> {
    const parts = this.split(presented);
    if (!parts) return false;
    await this.revokeFamily(parts.familyId, 'logout');
    return true;
  }

  /** Every live family for one user — used by the "sign out everywhere"
   *  side of a password change. */
  async revokeAllForUser(userId: string, reason: string): Promise<void> {
    try {
      await this.prisma.client.sessionRefreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } catch (e: any) {
      this.logger.warn(`revokeAllForUser(${userId}, ${reason}) failed: ${e?.message ?? e}`);
    }
  }
}

function safeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
