import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../realtime/redis.service';

/**
 * CLV-01 (2026-09-02) — SERVER-SIDE RECORD FOR ONE CLEVER OAUTH HANDSHAKE.
 *
 * ── THE ATTACK THIS CLOSES ────────────────────────────────────────────────
 * `buildAuthorizeUrl` used to mint a nonce it never stored, and `decodeState`
 * only re-verified the HMAC. The nonce was therefore decorative: not
 * single-use, and nothing tied the (necessarily unauthenticated) callback to
 * the browser that started the flow.
 *
 * So a DISTRICT_ADMIN of their own tenant A could call `/connect`, take the
 * `state` out of the authorize URL, and phish it to an admin of victim
 * district V. V authenticates with V's OWN Clever credentials, Clever
 * redirects to `/callback?code=<V's code>&state=<A's state>`, the HMAC
 * verifies (it is a real state, just not V's), and V's Clever access token
 * plus district id land on tenant A. `POST /sync` then imports V's staff
 * roster — names, emails, roles — into the attacker's tenant. Cross-district
 * PII in a K-12 product.
 *
 * ── THE FIX ───────────────────────────────────────────────────────────────
 * Two independent bindings, BOTH required at `/callback`:
 *   1. **Browser binding** — the nonce is mirrored into a short-lived
 *      HttpOnly cookie at `/connect` (see `clever.controller.ts`). V's
 *      browser never received A's cookie, so V's callback is refused.
 *   2. **Server binding** — this store holds `{tenantId, userId}` keyed by
 *      the nonce, SINGLE USE. A replayed state finds nothing and is refused,
 *      and the tenant is read from the server record rather than trusted
 *      from the envelope alone.
 *
 * Same shape as the OIDC state stash in `sso.controller.ts` (Redis keyed by
 * the unguessable value so any replica can complete the flow, plus an
 * in-process copy so a single-replica deploy still works with no Redis).
 *
 * ── FAIL CLOSED, NEVER OPEN ───────────────────────────────────────────────
 * The in-process map is consulted ONLY when Redis is absent or erroring at
 * read time. When Redis ANSWERS and has no record, that is authoritative and
 * the callback is refused — deliberately, because the alternative (falling
 * through to the local map on an authoritative miss) re-opens replay on a
 * multi-replica deploy: replica B consumes the Redis record, then the same
 * state replayed at replica A would still find A's local copy.
 *
 * The cost of that strictness is one real edge case: if Redis is down for the
 * `/connect` write and back up for the `/callback` read, the handshake is
 * refused and the operator clicks Connect again. A refused connect is the
 * correct direction of error for an OAuth binding.
 */

/** How long a minted state stays usable. OAuth round-trips finish in seconds. */
export const CLEVER_STATE_TTL_MS = 15 * 60 * 1000;

export interface CleverOAuthStateRecord {
  /** The tenant that initiated the connect — the ONLY tenant this code may bind to. */
  tenantId: string;
  /** The admin who initiated it, for the audit trail. Null when unknown. */
  userId: string | null;
  /** Epoch ms the record was minted (diagnostics only; TTL does the expiry). */
  createdAt: number;
}

interface LocalEntry {
  record: CleverOAuthStateRecord;
  expiresAt: number;
}

function isRecord(value: unknown): value is CleverOAuthStateRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { tenantId?: unknown; userId?: unknown };
  if (typeof v.tenantId !== 'string' || !v.tenantId) return false;
  return v.userId === null || typeof v.userId === 'string' || typeof v.userId === 'undefined';
}

@Injectable()
export class CleverOAuthStateStore {
  private readonly logger = new Logger(CleverOAuthStateStore.name);

  /** Redis-down / single-replica fallback. Bounded by the sweep + the TTL. */
  private readonly local = new Map<string, LocalEntry>();

  constructor(private readonly redis: RedisService) {}

  private key(nonce: string): string {
    return `clever:oauth:state:${nonce}`;
  }

  /** Drop expired local entries so a dead flow can never grow the map forever. */
  private sweep(): void {
    const now = Date.now();
    for (const [nonce, entry] of this.local) {
      if (entry.expiresAt <= now) this.local.delete(nonce);
    }
  }

  /** Persist one pending handshake. Called from `/connect`. */
  async put(nonce: string, record: CleverOAuthStateRecord): Promise<void> {
    this.sweep();
    this.local.set(nonce, { record, expiresAt: Date.now() + CLEVER_STATE_TTL_MS });
    const pub = this.redis.publisher;
    if (!pub) return; // no Redis on this deploy — the local copy is the store
    try {
      await pub.set(
        this.key(nonce),
        JSON.stringify(record),
        'EX',
        Math.floor(CLEVER_STATE_TTL_MS / 1000),
      );
    } catch (e: unknown) {
      // Best-effort: the local copy still covers a same-replica callback. A
      // callback that lands elsewhere is refused, which is the safe outcome.
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`could not stash Clever OAuth state in Redis: ${msg}`);
    }
  }

  /**
   * Read **and delete** one pending handshake — single use by construction.
   *
   * @returns the record, or null when the nonce is unknown, expired or has
   *          already been consumed. Null ALWAYS means "refuse the callback".
   */
  async take(nonce: string): Promise<CleverOAuthStateRecord | null> {
    this.sweep();
    if (!nonce) return null;
    const pub = this.redis.publisher;
    if (pub) {
      try {
        const raw = await pub.get(this.key(nonce));
        if (!raw) {
          // Authoritative miss — never fall through to the local map (see the
          // header: that is exactly how multi-replica replay comes back).
          this.local.delete(nonce);
          return null;
        }
        await pub.del(this.key(nonce));
        this.local.delete(nonce);
        const parsed: unknown = JSON.parse(raw);
        if (!isRecord(parsed)) return null;
        return {
          tenantId: parsed.tenantId,
          userId: parsed.userId ?? null,
          createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : 0,
        };
      } catch (e: unknown) {
        // Redis ERRORED (not "answered no") — the local copy is the fallback.
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`Clever OAuth state read failed, falling back to in-process store: ${msg}`);
      }
    }
    const hit = this.local.get(nonce);
    this.local.delete(nonce); // consume on hit AND miss
    if (!hit || hit.expiresAt <= Date.now()) return null;
    return hit.record;
  }
}
