/**
 * Who performed the action, in the shape `AuditLog` stores it.
 * ACC-06 follow-up, 2026-08-03.
 *
 * ── THE PROBLEM ───────────────────────────────────────────────────────────
 * Every audit writer in the app reads the actor off the request as
 * `req.user.id ?? req.user.userId` and stores it as `userId`. For a request
 * authenticated by a tenant API KEY there is no human principal —
 * JwtAuthGuard deliberately sets `id`/`userId` to null and puts the key on
 * `apiKeyId` — so that expression evaluates to null and the row lands
 * ANONYMOUS. "Which key deleted that playlist?" was answerable only by
 * correlating the anonymous row against the guard's separate
 * `API_KEY_REQUEST` row on (tenantId, timestamp): an inference, and a wrong
 * one as soon as two keys are active at once.
 *
 * ── WHY THIS IS AMBIENT AND NOT A PARAMETER ───────────────────────────────
 * There is no central audit writer to thread a parameter through: 195
 * `auditLog.create` call sites across 63 files, most of them inside
 * `$transaction` callbacks that never see the request object. Editing all of
 * them would be a 63-file blast radius on a live product, and every one of
 * them a place a future writer forgets. Instead the actor rides an
 * AsyncLocalStorage for the life of the request, and ONE Prisma middleware
 * fills the column on the way to the database. New audit writers are covered
 * on the day they are written, without knowing this file exists.
 *
 * ── THE `enterWith` TRAP (do not "simplify" this) ─────────────────────────
 * `als.run(store, fn)` scopes the store to `fn`'s async subtree and unwinds
 * cleanly. `als.enterWith(store)` does NOT: it mutates the store of the
 * CURRENT async resource, and under HTTP keep-alive that resource is the
 * socket, shared by every subsequent request on the same connection. Request
 * N's actor then leaks into request N+1 — which on a forensic-attribution
 * feature means confidently attributing an action to the WRONG credential.
 * That is strictly worse than the anonymous rows this replaces. See the
 * sequential-requests test in
 * `apps/api/src/auth/jwt-auth.guard.api-key-scopes.spec.ts`.
 */
import { AsyncLocalStorage } from 'async_hooks';

/** The actor columns of an `AuditLog` row. */
export interface AuditActorFields {
  /** The human principal, or null when the actor is a machine credential. */
  userId: string | null;
  /** The tenant API key, or null when the actor is a human. */
  apiKeyId: string | null;
}

/**
 * Read the actor off an authenticated request.
 *
 * A device-token identity (`kind: 'device'`) resolves to both-null: a screen
 * is neither a user nor an API key, and inventing an id for it here would put
 * a screen id in a column documented to hold a `TenantApiKey.id`.
 */
export function auditActorFields(req: unknown): AuditActorFields {
  const user = (req as { user?: Record<string, unknown> } | null | undefined)?.user;
  if (!user) return { userId: null, apiKeyId: null };

  if (user.kind === 'api-key') {
    const apiKeyId = typeof user.apiKeyId === 'string' ? user.apiKeyId : null;
    // Never both: an api-key request has no human principal, and letting a
    // stray `id` through would re-anonymize the row under a fake user.
    return { userId: null, apiKeyId };
  }
  if (user.kind === 'device') return { userId: null, apiKeyId: null };

  const id =
    typeof user.id === 'string'
      ? user.id
      : typeof user.userId === 'string'
        ? user.userId
        : null;
  return { userId: id, apiKeyId: null };
}

const storage = new AsyncLocalStorage<AuditActorFields>();

/**
 * Run `fn` with `actor` as the ambient audit actor.
 *
 * ALWAYS `run`, never `enterWith` — see the trap note in the file header.
 */
export function runWithAuditActor<T>(actor: AuditActorFields, fn: () => T): T {
  return storage.run(actor, fn);
}

/** The ambient audit actor, or null outside a request. */
export function currentAuditActor(): AuditActorFields | null {
  return storage.getStore() ?? null;
}

/**
 * Fill `apiKeyId` on an `AuditLog` write from the ambient actor.
 *
 * Rules, all deliberate:
 *   - only `AuditLog`, only `create` / `createMany`. Audit rows are
 *     append-only at the storage layer (§16 triggers), so there is no update
 *     path to cover;
 *   - only when the ambient actor IS an api-key. A human request has nothing
 *     to fill, and stamping one would be a lie;
 *   - NEVER overwrites a value the caller set explicitly. A writer that knows
 *     better — e.g. `API_KEY_CREATED`, where the key is the SUBJECT and a
 *     human admin is the actor — stays authoritative;
 *   - mutates `params.args.data` in place and returns nothing. Any throw here
 *     would break an unrelated write, so the caller wraps it.
 */
export function applyAuditActorToPrismaArgs(params: {
  model?: string;
  action?: string;
  args?: { data?: unknown };
}): void {
  if (params?.model !== 'AuditLog') return;
  if (params.action !== 'create' && params.action !== 'createMany') return;
  const actor = currentAuditActor();
  if (!actor?.apiKeyId) return;

  const stamp = (row: unknown) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return;
    const r = row as Record<string, unknown>;
    if (r.apiKeyId === undefined) r.apiKeyId = actor.apiKeyId;
  };

  const data = params.args?.data;
  if (Array.isArray(data)) data.forEach(stamp);
  else stamp(data);
}

/** Clients this hook is already armed on — arming twice would double-stamp. */
const armed = new WeakSet<object>();

/**
 * Register the middleware on a Prisma client. Idempotent.
 *
 * `$use` is deprecated-but-supported on Prisma 5.22 and is already the
 * mechanism the manifest content-rev hook uses (prisma.service.ts). If it
 * ever disappears, arming fails silently and api-key-driven action rows go
 * back to being anonymous — a loss of forensic detail, never a correctness or
 * availability failure, and the guard's own `API_KEY_REQUEST` row still
 * carries the key.
 */
export function armAuditActorPrismaHook(client: unknown): boolean {
  if (!client || typeof client !== 'object') return false;
  if (armed.has(client)) return true;
  const useFn = (client as { $use?: unknown }).$use;
  if (typeof useFn !== 'function') return false;

  (useFn as (mw: (p: any, next: (p: any) => Promise<any>) => Promise<any>) => void).call(
    client,
    async (params: any, next: (p: any) => Promise<any>) => {
      try {
        applyAuditActorToPrismaArgs(params);
      } catch {
        // Attribution is a nice-to-have on the write path; a bug here must
        // never fail somebody's playlist save.
      }
      return next(params);
    },
  );
  armed.add(client);
  return true;
}
