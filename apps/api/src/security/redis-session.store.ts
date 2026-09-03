import { Logger } from '@nestjs/common';

/**
 * Redis-backed express-session store.
 *
 * WHY (efficiency/scale audit 2026-09-02, "Other efficiency findings"):
 * `main.ts` ran express-session on its DEFAULT MemoryStore. That store is
 * process-local, which means two things go wrong the moment the API is more
 * than one process:
 *
 *   - Every session dies on restart. A Railway redeploy silently wipes them.
 *   - A session created on replica A does not exist on replica B.
 *
 * Two live handshakes ride the session today, and BOTH are mid-flight
 * cross-origin redirects that can easily come back to a different replica:
 *
 *   - SSO OIDC (`sso.controller.ts`) stashes `ssoOidcState` / `ssoOidcNonce`
 *     at /oidc/login and reads them at /oidc/callback. There is already a
 *     Redis stash keyed by `state` as the primary (S9), with the session as
 *     the fallback — this makes the fallback work across replicas too rather
 *     than being dead weight.
 *   - Clever OAuth (`clever.controller.ts`) mirrors its `cleverOAuthNonce`
 *     into the session for browsers that refuse the third-party cookie. With
 *     a memory store, that mirror is the ONLY binding those browsers have and
 *     it evaporates on redeploy; the callback then refuses a legitimate
 *     district connect.
 *
 * CSRF does NOT use the session (it is a double-submit cookie —
 * `security/csrf.middleware.ts` + `csrf.controller.ts`), so nothing about
 * this change touches mutation protection.
 *
 * ── FAIL-SOFT CONTRACT (deliberate) ─────────────────────────────────────
 * Redis errors are SWALLOWED, never surfaced as request errors:
 *
 *   get      → callback(null, null). express-session treats it as "no
 *              session" and issues a fresh one. Returning an error here
 *              makes express-session call next(err) and 500 the request —
 *              a Redis blip must not take the dashboard down.
 *   set/touch/destroy → callback(null). A session write that did not land is
 *              not a reason to fail the request the user is making.
 *
 * "Session absent" is the safe direction for both consumers above: each has
 * a stronger primary binding (the Redis state stash, the nonce cookie) and
 * refuses rather than accepts when nothing proves the browser's identity.
 *
 * NOTE ON DEPENDENCIES: this is a hand-rolled ~1 KB store rather than
 * `connect-redis` on purpose — it reuses the ioredis client the app already
 * owns, adds no package (no lockfile churn, no Alpine/Docker build risk per
 * CLAUDE.md's deploy-reliability list), and lets the fail-soft semantics
 * above be explicit instead of inherited.
 */

/** The ioredis surface this store needs. Structural, so no `any` leaks in. */
export interface SessionRedisClient {
  status: string;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'PX', ttl: number): Promise<unknown>;
  pexpire(key: string, ttl: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

/** What express-session hands back through a store callback. */
type StoreCallback = (err?: unknown, session?: unknown) => void;

/**
 * The `Store` base class from express-session. It extends EventEmitter and
 * express-session checks `instanceof` nothing — it only calls the methods —
 * but extending the real base keeps `store.regenerate` / `store.load` and the
 * `disconnect`/`connect` event surface that middleware expects.
 */
export interface ExpressSessionStoreBase {
  new (): object;
}

/** Session objects carry a `cookie` with the rolling expiry we mirror as TTL. */
interface SessionWithCookie {
  cookie?: { maxAge?: number | null; originalMaxAge?: number | null };
}

export const SESSION_KEY_PREFIX = 'venueos:sess:';

/** Fallback TTL when a session carries no cookie maxAge. Matches main.ts (8h). */
export const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/** Resolve the TTL for one session from its cookie, in ms. */
export function sessionTtlMs(session: unknown, fallbackMs = DEFAULT_SESSION_TTL_MS): number {
  const cookie = (session as SessionWithCookie | null)?.cookie;
  const raw = cookie?.maxAge ?? cookie?.originalMaxAge;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return fallbackMs;
}

/**
 * Build the store class on top of express-session's own `Store`.
 *
 * `Base` is passed in (rather than imported) because express-session is
 * loaded with `require` in main.ts and ships no types in this workspace —
 * taking it as a parameter keeps this file typed and unit-testable with a
 * stand-in base class.
 */
export function createRedisSessionStore(
  Base: ExpressSessionStoreBase,
  getClient: () => SessionRedisClient | null,
  logger: Logger = new Logger('RedisSessionStore'),
): object {
  class RedisSessionStore extends Base {
    private warnedUnavailable = false;

    private client(): SessionRedisClient | null {
      const client = getClient();
      if (!client || client.status !== 'ready') {
        if (!this.warnedUnavailable) {
          this.warnedUnavailable = true;
          logger.warn(
            'Session store: Redis unavailable — sessions are not being persisted. ' +
              'SSO OIDC falls back to its state stash and Clever to its nonce cookie; ' +
              'both refuse rather than accept when neither is present.',
          );
        }
        return null;
      }
      this.warnedUnavailable = false;
      return client;
    }

    get(sid: string, cb: StoreCallback): void {
      const client = this.client();
      if (!client) {
        cb(null, null);
        return;
      }
      void client
        .get(SESSION_KEY_PREFIX + sid)
        .then((raw) => {
          if (!raw) {
            cb(null, null);
            return;
          }
          try {
            cb(null, JSON.parse(raw));
          } catch {
            // Unparseable payload (truncated write, format change). Treat as
            // absent rather than throwing into the middleware chain.
            cb(null, null);
          }
        })
        .catch((e: unknown) => {
          logger.debug(
            `Session read failed for ${sid}: ${e instanceof Error ? e.message : String(e)}`,
          );
          cb(null, null);
        });
    }

    set(sid: string, session: unknown, cb: StoreCallback): void {
      const client = this.client();
      if (!client) {
        cb(null);
        return;
      }
      let payload: string;
      try {
        payload = JSON.stringify(session);
      } catch {
        // A session that cannot be serialised (a cycle someone stashed on
        // req.session) is dropped rather than failing the request.
        cb(null);
        return;
      }
      void client
        .set(SESSION_KEY_PREFIX + sid, payload, 'PX', sessionTtlMs(session))
        .then(() => cb(null))
        .catch((e: unknown) => {
          logger.debug(
            `Session write failed for ${sid}: ${e instanceof Error ? e.message : String(e)}`,
          );
          cb(null);
        });
    }

    /**
     * `rolling: true` in main.ts means every authenticated request re-issues
     * the cookie; touch mirrors that on the stored copy so the Redis TTL
     * slides with the cookie instead of expiring mid-session.
     */
    touch(sid: string, session: unknown, cb: StoreCallback): void {
      const client = this.client();
      if (!client) {
        cb(null);
        return;
      }
      void client
        .pexpire(SESSION_KEY_PREFIX + sid, sessionTtlMs(session))
        .then(() => cb(null))
        .catch(() => cb(null));
    }

    destroy(sid: string, cb: StoreCallback): void {
      const client = this.client();
      if (!client) {
        cb(null);
        return;
      }
      void client
        .del(SESSION_KEY_PREFIX + sid)
        .then(() => cb(null))
        .catch(() => cb(null));
    }
  }

  return new RedisSessionStore();
}
