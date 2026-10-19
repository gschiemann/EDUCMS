import type { PrismaService } from '../prisma/prisma.service';
import { writeLedgerRows } from './events/screen-events.service';

/**
 * recordPushDeployment — the shared "a push becomes an object you can point
 * at" implementation (2026-08-31). Extracted from ScreensController so the
 * playlist publish-to-fleet flow mints the SAME tracked deployments the
 * refresh-web endpoints do — one Deployment vocabulary for the convergence
 * card, whatever started the push.
 *
 * Three writes, all best-effort inside one try/catch:
 *   1. stamp `pendingRefreshAt = value` on every target (the durable
 *      manifest ride — reaches a push-dead screen),
 *   2. ONE Deployment row keyed by the same value,
 *   3. one ScreenEvent per target (skipped past the fan-out cap).
 * Plus, as its own statement, one interruption-ledger row per target
 * (`page-reload`, cause `operator`; screens/events/screen-events.ts): the
 * player always honours an operator's durable refresh, so every target
 * reloads. Not skipped at the timeline's fan-out cap — the launch gate is
 * read per screen — but capped and chunked by `writeLedgerRows`.
 * NOTHING here may throw into the caller: the triggering action has already
 * succeeded, so a failed record degrades to the pre-record behavior rather
 * than a failed operator click.
 */
export interface RecordPushDeploymentOpts {
  /** Owner of the Deployment row — the pushing tenant (HQ for a fleet push). */
  tenantId: string;
  /** The tenant set the push may touch (self + direct non-archived children). */
  targetTenantIds: string[];
  createdById: string | null;
  value: Date;
  corrId: string;
  scope: 'tenant' | 'screen';
  /** Omitted for a tenant-wide push — the targets are resolved here. */
  screenIds?: string[];
  /** Omitted for a tenant-wide push — the label is built from the count. */
  label?: string;
  /** Set when this push IS a content publish — the playlist it carried
   *  (Playlists Operations v1). Plain reload pushes leave it null. */
  playlistId?: string;
}

const DEFAULT_TARGET_ID_CAP = 1000;
const DEFAULT_EVENT_FANOUT_CAP = 200;

export async function recordPushDeployment(
  prisma: PrismaService,
  opts: RecordPushDeploymentOpts,
  caps: { targetIdCap?: number; eventFanoutCap?: number } = {},
): Promise<void> {
  const targetIdCap = caps.targetIdCap ?? DEFAULT_TARGET_ID_CAP;
  const eventFanoutCap = caps.eventFanoutCap ?? DEFAULT_EVENT_FANOUT_CAP;
  let targets: Array<{ id: string; tenantId: string | null }> = [];
  let stamped = false;
  try {
    // Resolve targets as (id, tenantId) PAIRS — events must carry each
    // screen's OWN tenant, never the pusher's (TEN-001).
    targets = await prisma.client.screen.findMany({
      where: opts.screenIds
        ? { id: { in: opts.screenIds }, tenantId: { in: opts.targetTenantIds } }
        : { tenantId: { in: opts.targetTenantIds } },
      select: { id: true, tenantId: true },
    });
    const targetIds = targets.map((r) => r.id);
    if (targetIds.length === 0) return;

    await prisma.client.screen.updateMany({
      // Re-asserts tenant ownership so a racing unpair/re-tenant can never
      // let this write cross a tenant boundary.
      where: { id: { in: targetIds }, tenantId: { in: opts.targetTenantIds } },
      // A person asked (Refresh / Resync / publish) — the player always
      // honours an operator's refresh (`refresh-request-origin.ts`).
      data: { pendingRefreshAt: opts.value, pendingRefreshSource: 'operator' },
    });
    stamped = true;

    await prisma.client.deployment.create({
      data: {
        tenantId: opts.tenantId,
        createdById: opts.createdById,
        label: (
          opts.label ??
          `Push update · ${targetIds.length} screen${targetIds.length === 1 ? '' : 's'}`
        ).slice(0, 200),
        value: opts.value,
        playlistId: opts.playlistId ?? null,
        // targetCount is the REAL count; the stored id array is capped so
        // one click on a 5000-screen fleet can't write a megabyte of JSON.
        targetIds: targetIds.slice(0, targetIdCap),
        targetCount: targetIds.length,
      },
    });

    // Per-screen events are skipped on a big fan-out — the Deployment row
    // already records the push in full.
    if (targetIds.length <= eventFanoutCap) {
      await prisma.client.screenEvent.createMany({
        data: targets.map((t) => ({
          screenId: t.id,
          tenantId: t.tenantId as string,
          kind: 'refresh-requested',
          detail: { scope: opts.scope, corrId: opts.corrId, valueMs: opts.value.getTime() },
        })),
      });
    }
  } catch (e) {
    console.warn(
      `[push-record ${opts.corrId}] deployment record failed:`,
      (e as Error).message,
    );
  }

  // Interruption ledger — once the durable refresh is stamped (the one
  // delivery a publish-to-fleet has; the refresh routes' Redis push is
  // best-effort), and independent of the Deployment / timeline rows after it:
  // those failing must not lose the reload. Never throws.
  if (stamped && targets.length > 0) {
    await writeLedgerRows(
      prisma,
      targets.map((t) => ({
        screenId: t.id,
        tenantId: t.tenantId,
        kind: 'page-reload' as const,
        cause: 'operator',
        source: 'operator' as const,
        at: opts.value,
        detail: {
          scope: opts.scope,
          corrId: opts.corrId,
          ...(opts.playlistId ? { publish: true, playlistId: opts.playlistId } : {}),
        },
      })),
      opts.value,
    );
  }
}
