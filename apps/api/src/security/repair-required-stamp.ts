/**
 * "This screen needs re-pairing" — stamped where the credential is REFUSED
 * (2026-09-04, SEC-012 follow-up).
 *
 * THE BUG THIS CLOSES. `Screen.authState` was written in exactly one place:
 * the paired re-register branch of `POST /screens/register`, which sets
 * `REPAIR_REQUIRED` when it hands out a downgraded 1-hour token. Everything
 * downstream — the fleet chip, `deriveRenderTrustGrade`, the detail drawer's
 * "Restore trust" action — reads that column.
 *
 * After the device signing key was rotated in production, every stored device
 * token became unverifiable, so screens re-registered into the `unproven`
 * state and SEC-001's refusals started firing: `verifyDeviceForScreen` returns
 * `credential_unproven`, and `DeviceIdentityInterceptor` refuses unproven
 * WRITES. Both refuse BEFORE any code that could stamp the column, and
 * `POST /screens/:id/render-proof` — the fleet's proof-of-display — is one of
 * the refused writes. Measured on production: 17 screens pinging, 0 writing
 * render proofs, 0 marked `REPAIR_REQUIRED`. The dashboard read that as "no
 * picture confirmed" — a render fault — when the truth was a credential
 * problem with a one-click operator fix.
 *
 * THE RULE. A screen that presents an unproven credential is recorded as
 * needing re-pair, at the point of refusal, as ONE STATE TRANSITION — never a
 * row write per refused request. Three things enforce that:
 *
 *   1. a per-process, per-screen suppression window (`STAMP_ATTEMPT_DEDUPE_MS`)
 *      bounds this to at most one STATEMENT per screen per 10 minutes, even
 *      while a refused player retries every 60 s;
 *   2. the UPDATE is conditional (`authState` is not already
 *      `REPAIR_REQUIRED`), so the ROW write happens once per real transition
 *      and a repeat costs `count: 0`;
 *   3. `authState` / `authStateChangedAt` are both in
 *      `SCREEN_TELEMETRY_ONLY_FIELDS`, so this write never busts a manifest
 *      hot-cache entry (the 25 GB/mo egress failure that list exists to
 *      prevent).
 *
 * THE OPERATOR ALWAYS WINS. The UPDATE also refuses to contradict a trust
 * verdict written in the last `RECENT_TRUST_CHANGE_GRACE_MS`. Without that,
 * an operator re-pair (which stamps `PROVEN`) could be flipped straight back
 * to `REPAIR_REQUIRED` by a stale unproven token still in flight from the same
 * screen — and the one-shot `unproven-restorable` renewal window
 * (deep-audit B-P1-7) would never get the chance to heal it.
 */

import { Logger } from '@nestjs/common';

export const SCREEN_AUTH_STATE_REPAIR_REQUIRED = 'REPAIR_REQUIRED';

/**
 * At most one stamp STATEMENT per screen per this window, per replica.
 * Ten minutes matches the player's proactive re-register cadence, so a
 * legitimately-downgraded screen is marked within one cycle and a refused
 * screen retrying every 60 s (SEC-001 §6.4) still costs one query.
 */
export const STAMP_ATTEMPT_DEDUPE_MS = 10 * 60 * 1000;

/**
 * Never contradict a trust verdict this fresh. Fifteen minutes covers the
 * operator-repair convergence window: the operator pairs (→ `PROVEN`), the
 * screen's next register — proactive at 10 minutes, or immediate on its next
 * 401 — restores its credential. A stale unproven request arriving in between
 * must not undo the operator's action.
 */
export const RECENT_TRUST_CHANGE_GRACE_MS = 15 * 60 * 1000;

/** Bound the suppression map so a fingerprint-scanning caller cannot grow it. */
const DEDUPE_MAX_ENTRIES = 5_000;

/**
 * The exact `where` this issues. Spelled out rather than typed as a loose
 * record so the real generated `PrismaService` structurally satisfies the
 * interface (a `Record<string, unknown>` does not narrow to
 * `ScreenWhereInput` and the assignment is refused).
 */
export interface RepairStampWhere {
  id: string;
  OR: Array<{ authState: null } | { authState: { not: string } }>;
  AND: Array<{
    OR: Array<{ authStateChangedAt: null } | { authStateChangedAt: { lt: Date } }>;
  }>;
}

/**
 * The credential-timeline detail payload — a flat, JSON-safe object.
 *
 * A type ALIAS, not an interface, and that matters: only an object-literal
 * type alias gets an implicit index signature, which is what lets this
 * satisfy the generated client Json input type.
 */
export type RepairStampEventDetail = {
  authState: string;
  trigger: string;
};

/** The Prisma surface this needs — narrow, so every caller stays unit-testable. */
export interface RepairStampPrisma {
  client: {
    screen: {
      updateMany?: (args: {
        where: RepairStampWhere;
        data: { authState: string; authStateChangedAt: Date };
      }) => Promise<{ count: number }>;
    };
    screenEvent?: {
      create: (args: {
        data: {
          screenId: string;
          tenantId: string;
          kind: string;
          detail: RepairStampEventDetail;
        };
      }) => Promise<unknown>;
    };
  };
}

export type RepairStampOutcome =
  /** The verdict flipped — one row written, one timeline row when we knew the tenant. */
  | 'stamped'
  /** Already `REPAIR_REQUIRED`, or a fresh verdict we refuse to contradict. */
  | 'unchanged'
  /** Inside this screen's suppression window — no statement issued at all. */
  | 'suppressed'
  /** No screen id, or no Prisma surface wired (unit contexts). */
  | 'unavailable'
  /** The write threw. Best-effort by design: the caller's 401 is unaffected. */
  | 'failed';

const logger = new Logger('RepairRequiredStamp');
const lastAttemptAt = new Map<string, number>();

/** Test seam — the suppression window is process-wide by design. */
export function resetRepairRequiredStampForTests(): void {
  lastAttemptAt.clear();
}

/**
 * Record that `screenId` presented a credential we refused as unproven.
 *
 * Best-effort in every direction: it never throws, and the caller's refusal
 * is never conditional on it.
 */
export async function stampRepairRequired(
  prisma: RepairStampPrisma | null | undefined,
  screenId: string | null | undefined,
  opts: {
    /** Where the refusal happened — recorded on the timeline row. */
    trigger: string;
    /** Live tenant, when the caller already knows it. Timeline row needs it. */
    tenantId?: string | null;
    /** Injectable clock for tests. */
    now?: number;
  },
): Promise<RepairStampOutcome> {
  if (!screenId) return 'unavailable';

  const now = opts.now ?? Date.now();
  const last = lastAttemptAt.get(screenId);
  if (last !== undefined && now - last < STAMP_ATTEMPT_DEDUPE_MS) return 'suppressed';

  const updateMany = prisma?.client?.screen?.updateMany;
  if (typeof updateMany !== 'function') return 'unavailable';

  // Claim the window BEFORE the write: a burst of concurrent refusals from
  // the same screen must collapse to one statement, not race into several.
  if (lastAttemptAt.size >= DEDUPE_MAX_ENTRIES) lastAttemptAt.clear();
  lastAttemptAt.set(screenId, now);

  const trustChangeCutoff = new Date(now - RECENT_TRUST_CHANGE_GRACE_MS);
  try {
    const res = await updateMany({
      where: {
        id: screenId,
        // Written as an explicit OR rather than `{ not: … }` so the NULL
        // rows — the entire fleet that predates this column — are certainly
        // included, without depending on how the query engine treats NULL
        // under a negated equality.
        OR: [
          { authState: null },
          { authState: { not: SCREEN_AUTH_STATE_REPAIR_REQUIRED } },
        ],
        AND: [
          {
            OR: [
              { authStateChangedAt: null },
              { authStateChangedAt: { lt: trustChangeCutoff } },
            ],
          },
        ],
      },
      data: {
        authState: SCREEN_AUTH_STATE_REPAIR_REQUIRED,
        authStateChangedAt: new Date(now),
      },
    });

    if (!res || res.count < 1) return 'unchanged';

    logger.warn(
      `Screen ${screenId} presented an unproven credential (${opts.trigger}) — ` +
        'marked REPAIR_REQUIRED. The fleet UI now says "re-pair required" instead of ' +
        'reporting a render fault.',
    );

    // Credential timeline — TRANSITIONS ONLY, same contract as the register
    // path. Skipped when the tenant is unknown (the device-auth refusal
    // deliberately runs before any live-row read) because `ScreenEvent.tenantId`
    // is required; the `authState` column is what every fleet surface reads.
    const tenantId = opts.tenantId ?? null;
    const create = prisma?.client?.screenEvent?.create;
    if (tenantId && typeof create === 'function') {
      try {
        await create({
          data: {
            screenId,
            tenantId,
            kind: 'repair-required',
            detail: { authState: SCREEN_AUTH_STATE_REPAIR_REQUIRED, trigger: opts.trigger },
          },
        });
      } catch {
        /* timeline best-effort — never fails the refusal path */
      }
    }
    return 'stamped';
  } catch (e) {
    logger.warn(
      `Could not stamp REPAIR_REQUIRED for screen ${screenId} (${opts.trigger}): ` +
        `${e instanceof Error ? e.message : String(e)}`,
    );
    return 'failed';
  }
}
