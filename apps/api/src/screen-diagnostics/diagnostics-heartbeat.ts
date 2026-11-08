/**
 * The native status heartbeat's diagnostics half (2026-11-08), called from
 * `ScreensController.deviceStatus` (`GET /screens/status/:fp`) ONLY for a
 * paired screen whose caller proved the screen's own device credential — the
 * same gate as the device-settings half.
 *
 *   IN  — `x-venueos-storage`: the native storage report (at most every
 *         30 minutes; storage-health.ts).
 *   OUT — `diagnostics: { id, kind, minutes? }` while a request is open: the
 *         third ride of the command (pub/sub and the manifest are the other
 *         two), the one that reaches a panel whose page is dead or asleep.
 *         The device runs an id once (persisted) — acknowledgement is the
 *         result it posts for that id, never a clock comparison.
 *
 * COST: an idle screen pays nothing — the heartbeat already loaded the row;
 * no header and no open request means no query at all.
 *
 * ⚠️ NEVER FAILS THE HEARTBEAT. Every fault degrades to "say nothing".
 */
import { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { decodePending, diagnosticsDisabled, ttlFor, type WireRequest } from './diagnostics-policy';
import { STORAGE_HEADER, parseNativeStorage, recordStorageHealth } from './storage-health';

const logger = new Logger('ScreenDiagnostics');

export interface DiagnosticsHeartbeatScreen {
  id: string;
  tenantId: string | null;
  name?: string | null;
  pendingDiagnosticsId?: string | null;
  pendingDiagnosticsKind?: string | null;
  pendingDiagnosticsAt?: Date | null;
}

export async function diagnosticsHeartbeat(
  deps: { prisma: PrismaService; notifications?: Pick<NotificationsService, 'notify'> | null },
  screen: DiagnosticsHeartbeatScreen,
  headers: Record<string, unknown> | undefined,
  now: Date = new Date(),
): Promise<{ diagnostics?: WireRequest }> {
  const tenantId = screen.tenantId;
  if (!tenantId) return {};
  try {
    const storage = parseNativeStorage(headers?.[STORAGE_HEADER]);
    if (storage) {
      await recordStorageHealth(deps, { id: screen.id, tenantId, name: screen.name }, { native: storage }, now);
    }

    const req = decodePending(screen.pendingDiagnosticsId, screen.pendingDiagnosticsKind);
    if (!req) return {};
    const at = screen.pendingDiagnosticsAt ? new Date(screen.pendingDiagnosticsAt).getTime() : 0;
    const expired = !at || now.getTime() - at > ttlFor(req.kind);
    if (expired || diagnosticsDisabled()) {
      if (expired) await expireOpenRequest(deps.prisma, screen.id, tenantId, req.id, now);
      return {};
    }
    // First delivery is recorded once; later beats match nothing.
    await deps.prisma.client.screenDiagnosticsRequest.updateMany({
      where: { id: req.id, tenantId, screenId: screen.id, status: 'PENDING', deliveredAt: null },
      data: { deliveredAt: now },
    });
    return { diagnostics: req };
  } catch (e) {
    logger.warn(`diagnostics heartbeat for ${screen.id} said nothing: ${(e as Error).message}`);
    return {};
  }
}

/**
 * Close an open request whose window passed: the screen's marker is cleared
 * ONLY while it still names this id (a newer request is never wiped), and the
 * row is marked EXPIRED only while still PENDING (a result that landed in
 * between wins).
 */
export async function expireOpenRequest(prisma: PrismaService, screenId: string, tenantId: string, requestId: string, now: Date): Promise<void> {
  await prisma.client.screen.updateMany({
    where: { id: screenId, tenantId, pendingDiagnosticsId: requestId },
    data: { pendingDiagnosticsId: null, pendingDiagnosticsKind: null, pendingDiagnosticsAt: null },
  });
  await prisma.client.screenDiagnosticsRequest.updateMany({
    where: { id: requestId, tenantId, screenId, status: 'PENDING', nativeAt: null, pageAt: null },
    data: { status: 'EXPIRED', completedAt: now },
  });
}
