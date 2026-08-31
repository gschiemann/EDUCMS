import type { PrismaService } from '../prisma/prisma.service';

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
  try {
    // Resolve targets as (id, tenantId) PAIRS — events must carry each
    // screen's OWN tenant, never the pusher's (TEN-001).
    const targets = await prisma.client.screen.findMany({
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
      data: { pendingRefreshAt: opts.value },
    });

    await prisma.client.deployment.create({
      data: {
        tenantId: opts.tenantId,
        createdById: opts.createdById,
        label: (
          opts.label ??
          `Push update · ${targetIds.length} screen${targetIds.length === 1 ? '' : 's'}`
        ).slice(0, 200),
        value: opts.value,
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
}
