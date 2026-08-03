/**
 * device-credentials.ts — the WRITE side of device-token revocation
 * (finding DT-01, 2026-08-03).
 *
 * Before this file there was no revocation path for a device token in any
 * layer. `Screen.status='REVOKED'` was read in eight places and written in
 * zero. `jwt_revoked_list` had exactly one writer (user logout) and carried
 * a 30-day Redis TTL — shorter than the token it would have had to outlive.
 * Deleting the Screen row was the only real kill switch, and it took the
 * screen's schedules and telemetry history with it.
 *
 * WHY AN EPOCH AND NOT A TOKEN DENYLIST
 * A denylist can only burn the ONE token string you happen to be holding.
 * An operator revoking a dumpstered screen is not holding its token, and a
 * self-renewing credential (DT-02) mints a fresh string every cycle. The
 * authority therefore has to be keyed on the SCREEN, not the string:
 * `Screen.credentialEpoch` is a monotonic counter that every device token
 * carries as an `ep` claim and every device-authenticated request checks.
 * Bump it and every token ever minted for that screen dies at once.
 *
 * TTL / DURABILITY (the explicit requirement): the epoch lives in Postgres
 * on a row we already read on every device-authenticated request. It has
 * NO expiry, so it cannot lapse before the 180-day token it revokes, and it
 * is unaffected by a Redis outage. Where we ALSO hold the raw token (the
 * device-initiated unpair presents it) we additionally write it to
 * `jwt_revoked_list` and to the durable Postgres `revoked_credentials`
 * mirror — whose expiry is derived from the JWT's own `exp` claim, i.e.
 * 180 days for a device token, not the 30-day user-session ceiling.
 */

import { invalidateDeviceCredentialCache } from './device-auth';

export type RevocationReason =
  | 'device_unpair'
  | 'admin_unpair'
  | 'admin_revoke'
  | 'repair_new_tenant'
  | 'tenant_archived'
  | 'rotation';

export interface RevokeDeps {
  prisma: { client: any };
  /** RedisService. Optional so unit tests and Redis-less dev still work. */
  redis?: {
    sadd?: (
      key: string,
      member: string,
      opts?: { ttlSeconds?: number },
    ) => Promise<unknown>;
    mirrorRevokedTokenDurable?: (token: string) => Promise<void>;
  } | null;
}

/** Device-token ceiling (DEVICE_TOKEN_TTL_PAIRED) as seconds, for TTL floors. */
const DEVICE_TOKEN_TTL_SECONDS = 180 * 24 * 60 * 60;

/**
 * Seconds this token still has to live, from its own `exp` claim. Used to
 * keep the shared `jwt_revoked_list` key alive at least as long as the
 * credential it is burning — the pre-existing 30-day key TTL is the
 * rememberMe ceiling for a USER session and is 6× too short for a 180-day
 * device credential. Decode only, never verify: we are revoking this string,
 * not trusting it, and an undecodable token just takes the ceiling.
 */
function remainingLifetimeSeconds(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (typeof payload?.exp === 'number' && Number.isFinite(payload.exp)) {
      const secs = Math.ceil(payload.exp - Date.now() / 1000);
      if (secs > 0) return Math.min(secs, DEVICE_TOKEN_TTL_SECONDS);
    }
  } catch {
    /* not a decodable JWT — fall through to the ceiling */
  }
  return DEVICE_TOKEN_TTL_SECONDS;
}

export interface RevokeOptions {
  screenId: string;
  reason: RevocationReason;
  /**
   * Also flip `Screen.status` to REVOKED (and stamp credentialRevokedAt).
   * TRUE for an explicit operator revoke — that is the state the manifest
   * endpoint has always checked and never had written to it.
   * FALSE for unpair / re-pair, where the screen is expected to come back
   * and PENDING/ONLINE is the correct status.
   */
  markRevokedStatus?: boolean;
  /** The raw bearer token, when the revoking request presented one. */
  presentedToken?: string | null;
  /** Tenant to attribute the AuditLog row to. */
  tenantId?: string | null;
  /** Operator who performed it, when there is one. */
  userId?: string | null;
  /** Extra forensic context merged into AuditLog.details. */
  details?: Record<string, unknown>;
  /** Optional Prisma transaction client to run the screen UPDATE inside. */
  tx?: any;
}

/**
 * Retire every device credential ever issued for `screenId`.
 *
 * Returns the new epoch. Never throws on the best-effort legs (audit row,
 * Redis denylist) — the epoch bump is the load-bearing write and it is the
 * only one allowed to fail the caller.
 */
export async function revokeScreenCredentials(
  deps: RevokeDeps,
  opts: RevokeOptions,
): Promise<{ credentialEpoch: number }> {
  const db = opts.tx ?? deps.prisma.client;
  const now = new Date();

  const updated = await db.screen.update({
    where: { id: opts.screenId },
    data: {
      credentialEpoch: { increment: 1 },
      credentialEpochRotatedAt: now,
      ...(opts.markRevokedStatus
        ? { status: 'REVOKED', credentialRevokedAt: now }
        : {}),
    } as any,
    select: { id: true, credentialEpoch: true } as any,
  });

  // This replica must see the revocation immediately — the 5 s snapshot
  // cache is a throughput device, not a correctness one.
  invalidateDeviceCredentialCache(opts.screenId);

  // Belt-and-braces: burn the exact token string too, when we have it, so
  // the JwtAuthGuard / SSE / WS revocation checks catch it even on a path
  // that somehow skips the epoch comparison.
  //
  // TWO tiers, deliberately, and neither may fail the revocation:
  //   • Redis `jwt_revoked_list` — the hot set every request checks first.
  //     Until 2026-08-03 `RedisService` had no `sadd`, so this optional call
  //     resolved to `undefined` and the hot tier was never written.
  //   • Postgres `revoked_credentials` — the durable mirror `sismember`
  //     falls back to whenever Redis is down. It is what makes a Redis
  //     outage incapable of un-revoking anything.
  let redisDenylisted = false;
  let durableMirrored = false;
  if (opts.presentedToken && deps.redis) {
    try {
      redisDenylisted = (await deps.redis.sadd?.('jwt_revoked_list', opts.presentedToken, {
        ttlSeconds: remainingLifetimeSeconds(opts.presentedToken),
      })) === true;
    } catch {
      /* Redis blip — the epoch bump above is already authoritative. */
    }
    try {
      await deps.redis.mirrorRevokedTokenDurable?.(opts.presentedToken);
      durableMirrored = true;
    } catch {
      /* durable mirror is best-effort by contract */
    }
  }

  try {
    await deps.prisma.client.auditLog.create({
      data: {
        tenantId: opts.tenantId || 'unknown',
        userId: opts.userId ?? null,
        action: 'SCREEN_CREDENTIAL_REVOKED',
        targetType: 'Screen',
        targetId: opts.screenId,
        details: JSON.stringify({
          reason: opts.reason,
          credentialEpoch: updated.credentialEpoch,
          statusRevoked: !!opts.markRevokedStatus,
          tokenDenylisted: !!opts.presentedToken,
          // Which tiers actually took the write. `tokenDenylisted` alone used
          // to be the only signal and it only said "we had a token to burn" —
          // it read TRUE even while the Redis write was a silent no-op. A
          // forensic reader needs to know which store held the revocation.
          redisDenylisted,
          durableMirrored,
          ...(opts.details ?? {}),
        }),
      },
    });
  } catch {
    /* audit best-effort — never block a revocation on the audit write */
  }

  return { credentialEpoch: Number(updated.credentialEpoch ?? 0) || 0 };
}

/**
 * Rotate WITHOUT the revocation semantics: used by `/screens/register`
 * when a kiosk proves possession of its current credential and receives a
 * fresh one (DT-02 refresh-token rotation). Same counter, no REVOKED
 * status, no AuditLog noise on the routine path — the caller writes its
 * own `SCREEN_TOKEN_RENEWED` row with richer context.
 */
export async function rotateScreenCredentialEpoch(
  deps: RevokeDeps,
  screenId: string,
  tx?: any,
): Promise<number> {
  const db = tx ?? deps.prisma.client;
  const updated = await db.screen.update({
    where: { id: screenId },
    data: {
      credentialEpoch: { increment: 1 },
      credentialEpochRotatedAt: new Date(),
    } as any,
    select: { credentialEpoch: true } as any,
  });
  invalidateDeviceCredentialCache(screenId);
  return Number(updated.credentialEpoch ?? 0) || 0;
}
