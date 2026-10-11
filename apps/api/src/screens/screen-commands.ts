/**
 * SINGLE-SCREEN OPERATOR COMMANDS — the one implementation of each command
 * (2026-10-11, bulk screen actions).
 *
 * Greg: "If I want to manually push a resync, an update of the player, allow me
 * to do a select-all and push". The per-screen endpoints in ScreensController
 * (`POST /screens/:id/refresh-web`, `POST /screens/:id/force-update`,
 * `PUT /screens/:id/auto-update`) and the bulk endpoints
 * (`screens-bulk.controller.ts`) BOTH call these functions, so the signed
 * message, the durable flag and the audit vocabulary are byte-for-byte the same
 * whether an operator pushes one screen or five hundred. Never re-implement a
 * command in the bulk path — add a parameter here instead.
 *
 * Every write carries the screen's tenant in its `where` (SEC-009). The caller
 * has already proved the screen belongs to a tenant the caller may act in.
 */
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../realtime/redis.service';
import type { WebsocketSignerService } from '../security/websocket-signer.service';
import { modeToOverride, overrideToMode, type AutoUpdateOverride } from '../player-ota/auto-update-report';

export interface CommandScreen {
  id: string;
  tenantId: string;
  name?: string | null;
}

export interface CommandDeps {
  signer: Pick<WebsocketSignerService, 'signMessage'>;
  redis: Pick<RedisService, 'publish'>;
}

/** `rw-…` / `ota-…` / `bulk-…` — one greppable id per push. */
export function newCorrId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * REFRESH_WEB for ONE screen over the realtime path. The durable half (the
 * manifest's `refreshRequestedAt`, CLAUDE.md player rule 6) is stamped by
 * `recordPushDeployment` — once per push, so a bulk push is ONE deployment
 * acknowledged by value identity, not N.
 *
 * Returns whether the publish call returned. Never throws: a dead Redis must
 * not fail the click, because the durable ride still reaches the screen.
 */
export async function publishScreenRefresh(
  deps: CommandDeps,
  screen: CommandScreen,
  opts: { requestedBy: string | null; corrId: string; jitterMs: number },
): Promise<boolean> {
  const signed = deps.signer.signMessage('REFRESH_WEB', {
    scope: 'screen',
    scopeId: screen.id,
    tenantId: screen.tenantId,
    requestedBy: opts.requestedBy,
    jitterMs: opts.jitterMs,
    corrId: opts.corrId,
  });
  try {
    await deps.redis.publish(`tenant:${screen.tenantId}`, signed);
    return true;
  } catch (e) {
    console.warn(`[refresh-web ${opts.corrId}] redis publish failed for screen ${screen.id}:`, (e as Error).message);
    return false;
  }
}

/**
 * "Send update" for ONE screen: arm the per-screen force flag (the next
 * update-check from this kiosk is offered the latest APK) and nudge it over the
 * realtime path with CHECK_FOR_UPDATES.
 *
 * `armed` is the DB write — the durable half: a screen with no live socket
 * still picks the push up on its periodic update-check. `published` is the
 * realtime nudge. A push is real when the flag is armed.
 */
export async function armScreenApkUpdate(
  deps: CommandDeps & { prisma: PrismaService },
  screen: CommandScreen,
  opts: { requestedBy: string | null; corrId: string; overrideWindow: boolean },
): Promise<{ armed: boolean; published: boolean }> {
  let armed = true;
  await deps.prisma.client.screen.update({
    // SEC-009: tenant predicate in the write.
    where: { id: screen.id, tenantId: screen.tenantId },
    data: {
      forceApkUpdatePendingAt: new Date(),
      forceApkUpdateOverrideWindow: opts.overrideWindow,
      // OTA-02: an operator deliberately re-pushing IS the "resolved, try
      // again" signal; it clears the sticky failure stamp.
      lastOtaErrorAt: null,
      lastOtaErrorMessage: null,
      lastOtaErrorAuthenticated: false,
    } as any,
  }).catch((e: unknown) => {
    armed = false;
    console.warn(`[OTA ${opts.corrId}] forceApkUpdatePendingAt write FAILED for ${screen.id}: ${(e as Error).message}`);
  });

  const signed = deps.signer.signMessage('CHECK_FOR_UPDATES', {
    scope: 'screen',
    scopeId: screen.id,
    tenantId: screen.tenantId,
    requestedBy: opts.requestedBy,
    // The kiosk stamps corrId into ITS logs + later /ota-state POSTs.
    corrId: opts.corrId,
  });
  let published = true;
  try {
    // Tenant channel — every kiosk receives it, only scopeId acts.
    await deps.redis.publish(`tenant:${screen.tenantId}`, signed);
  } catch (e) {
    published = false;
    console.warn(`[OTA ${opts.corrId}] redis publish FAILED for ${screen.id}: ${(e as Error).message}`);
  }
  return { armed, published };
}

/**
 * Automatic Player updates for ONE screen: 'on' / 'off' override the
 * organisation, 'inherit' follows it. Writes the SCREEN_AUTO_UPDATE_SET audit
 * row. Returns null when the screen is not in `tenantId`.
 *
 * `mode` must already be validated with `modeToOverride` (callers answer 400).
 */
export async function setScreenAutoUpdateMode(
  prisma: PrismaService,
  input: {
    tenantId: string;
    screenId: string;
    mode: AutoUpdateOverride;
    userId: string | null;
    /** Extra audit details (the bulk push's corrId). */
    auditExtra?: Record<string, unknown>;
  },
): Promise<{ from: AutoUpdateOverride; to: AutoUpdateOverride; changed: boolean } | null> {
  const next = modeToOverride(input.mode);
  if (next === undefined) throw new Error(`invalid auto-update mode ${String(input.mode)}`);
  const screen = (await prisma.client.screen.findFirst({
    where: { id: input.screenId, tenantId: input.tenantId },
    select: { id: true, name: true, autoUpdatePlayerOverride: true } as any,
  })) as any;
  if (!screen) return null;
  const from = overrideToMode(screen.autoUpdatePlayerOverride);
  const to = overrideToMode(next);
  await prisma.client.screen.update({
    where: { id: input.screenId, tenantId: input.tenantId },
    data: { autoUpdatePlayerOverride: next } as any,
  });
  await prisma.client.auditLog.create({
    data: {
      action: 'SCREEN_AUTO_UPDATE_SET',
      targetType: 'screen',
      targetId: input.screenId,
      tenantId: input.tenantId,
      userId: input.userId,
      details: JSON.stringify({ screenName: screen.name, from, to, ...(input.auditExtra ?? {}) }),
    },
  });
  return { from, to, changed: from !== to };
}
