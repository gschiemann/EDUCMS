/**
 * FIELD BUILD WINDOWS (2026-10-18) — /super/field-builds.
 *
 * A private field build of the Android player is offered only to a screen
 * inside a window — listed organisations, listed screens or every screen of
 * those organisations, at most 24 h from arming — and only after an operator
 * push to that exact screen. The window used to live in four Railway
 * variables; this service arms and cancels it in `field_build_windows` and
 * keeps the gate's view of it fresh. The variables stay the fallback.
 *
 * WHAT DOES NOT CHANGE — the gate itself. Device authentication, the
 * organisation and screen allow-lists, the ≤ 24 h expiry, the registry's
 * digest pin, the private mirror and the audited offer all live in
 * player-ota/ and run exactly as before; a window only changes where the
 * allow-list comes from. This service never offers anything.
 *
 * THE GATE'S READ. `refreshGateWindow()` reads the newest un-cancelled,
 * un-expired row and hands it to field-candidate.ts. FieldWindowGateMiddleware
 * calls it before an update check and a field download — and nothing else, so a
 * manifest poll never reads the table. One cached read per check: ≤ 10 s old,
 * one query in flight per process. A write here refreshes it at once on this
 * replica; another replica follows within 10 s, which is why a push waits
 * PUSH_SETTLE_MS after arming. A failed read keeps the last row read (a cancel
 * is missed no longer than the database is unreadable, and expiry is enforced
 * at the call whatever the cache holds).
 *
 * REACH. Arming and pushing touch organisations' screens, so they take the same
 * customer-approved support access as every other cross-organisation write
 * (support-access.context.ts): an internal organisation, the super admin's
 * own, or one under an active grant. Cancelling never needs it — stopping an
 * offer is always allowed.
 *
 * AUDIT. Every arm, cancel and push writes AuditLog rows carrying the
 * candidate, its digest, the screens and the actor, on each organisation the
 * action touches. Arm and cancel rows commit with the window change itself;
 * a push row is written before the push is armed, and no row means no push.
 */
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { FIELD_CANDIDATE_RELEASES, type FieldCandidateRelease } from '../player-ota/field-candidate-releases';
import {
  configuredFieldRelease,
  isFieldCandidateTarget,
  setActiveFieldWindow,
  type FieldBuildWindow,
} from '../player-ota/field-candidate';
import { evaluateReleaseForFleet } from '../player-ota/release-policy';
import { armScreenApkUpdate, cancelScreenApkUpdate, newCorrId } from '../screens/screen-commands';
import { assertSupportReach, hasSupportReach } from '../support-access/support-access.context';
import type { Principal } from '../support-access/support-access.service';
import { SCREEN_ONLINE_GRACE_MS } from '../telemetry/online-grace';
import { fieldMirrorStatus, MIRROR_BLOCKS_PUSH, type MirrorStatus } from './field-mirror';
import {
  FieldBuildInputError,
  GATE_TTL_MS,
  MAX_PUSH_SCREENS,
  MAX_WINDOW_MINUTES,
  MAX_WINDOW_TENANTS,
  MIN_WINDOW_MINUTES,
  PUSH_SETTLE_MS,
  envWindowView,
  parseArmInput,
  parseNote,
  parsePushInput,
  parseUuidList,
  pushReadyAt,
  windowState,
  type EnvWindowView,
  type WindowState,
} from './field-builds.policy';

/** A failed gate read is retried after this long, not on every update check. */
const GATE_RETRY_MS = 2_000;
const LOCK_KEY = 'field_build_windows';
const HISTORY = 20;
const SCREEN_LIST_CAP = 1_000;

export const FIELD_AUDIT = {
  ARM: 'FIELD_BUILD_WINDOW_ARM',
  CANCEL: 'FIELD_BUILD_WINDOW_CANCEL',
  PUSH: 'FIELD_BUILD_PUSH',
  PUSH_CANCEL: 'FIELD_BUILD_PUSH_CANCEL',
} as const;

const WINDOW_SELECT = {
  id: true,
  candidate: true,
  candidateSha256: true,
  tenantIds: true,
  screenIds: true,
  allScreens: true,
  armedAt: true,
  expiresAt: true,
  armedByUserId: true,
  armedByEmail: true,
  cancelledAt: true,
  cancelledByUserId: true,
  cancelledByEmail: true,
  note: true,
} as const;

interface WindowRow {
  id: string;
  candidate: string;
  candidateSha256: string;
  tenantIds: string[];
  screenIds: string[];
  allScreens: boolean;
  armedAt: Date;
  expiresAt: Date;
  armedByUserId: string | null;
  armedByEmail: string | null;
  cancelledAt: Date | null;
  cancelledByUserId: string | null;
  cancelledByEmail: string | null;
  note: string | null;
}

export interface CandidateView {
  versionName: string;
  versionCode: number;
  sha256: string;
  size: number;
  sourceUrl: string;
  /** Passes the registry's shape and the fleet policy (quarantine, floor, URL) today. */
  allowed: boolean;
  blockedReason: string | null;
  mirror: MirrorStatus;
}

export interface WindowView {
  id: string;
  candidate: string;
  candidateSha256: string;
  versionCode: number | null;
  tenants: Array<{ id: string; name: string | null }>;
  allScreens: boolean;
  screenIds: string[];
  armedAt: string;
  expiresAt: string;
  armedBy: { userId: string | null; email: string | null };
  cancelledAt: string | null;
  cancelledBy: { userId: string | null; email: string | null } | null;
  note: string | null;
  state: WindowState;
  pushReadyAt: string;
}

export interface WindowsView {
  now: string;
  /** Which source the gate admits by right now. */
  effective: 'window' | 'variables' | 'none';
  active: WindowView | null;
  windows: WindowView[];
  variables: EnvWindowView;
  limits: { minMinutes: number; maxMinutes: number; maxPushScreens: number; pushSettleMs: number; gateTtlMs: number };
}

export interface FieldScreenView {
  id: string;
  name: string;
  tenantId: string;
  tenantName: string | null;
  status: string;
  online: boolean;
  lastPingAt: string | null;
  playerVersion: string | null;
  playerVersionCode: number | null;
  playerVersionAt: string | null;
  /** The tracked push, in the dashboard's own row shape (web: trackedPush.ts deriveTrackedPush). */
  forceApkUpdatePendingAt: string | null;
  forceApkUpdateHold: string | null;
  forceApkUpdateHoldAt: string | null;
  forceApkUpdateHoldReason: string | null;
  forceApkUpdateOfferCount: number;
  forceApkUpdateLastOfferAt: string | null;
  forceApkUpdateTargetVersion: string | null;
}

export interface PushResult {
  screenId: string;
  name: string;
  armed: boolean;
  published: boolean;
  corrId: string;
  pushAt: string;
}

const actorId = (u: Principal | null | undefined): string | null =>
  (typeof u?.userId === 'string' && u.userId) || (typeof u?.id === 'string' && u.id) || null;
const actorEmail = (u: Principal | null | undefined): string | null =>
  typeof u?.email === 'string' && u.email ? u.email : null;

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

function http(status: HttpStatus, code: string, message: string, extra?: Record<string, unknown>): HttpException {
  return new HttpException({ code, message, ...(extra ?? {}) }, status);
}

/** Pure input errors are 400s with their own code. */
function asHttp(e: unknown): never {
  if (e instanceof FieldBuildInputError) throw http(HttpStatus.BAD_REQUEST, e.code, e.message);
  throw e;
}

export function toGateWindow(row: WindowRow): FieldBuildWindow {
  return {
    id: row.id,
    candidate: row.candidate,
    candidateSha256: row.candidateSha256,
    tenantIds: row.tenantIds ?? [],
    screenIds: row.screenIds ?? [],
    allScreens: row.allScreens === true,
    armedAt: row.armedAt,
    expiresAt: row.expiresAt,
    cancelledAt: row.cancelledAt,
  };
}

/**
 * What the registry entry would be for a window armed on `r` right now: the
 * same validation the offer path runs (shape, version code, fleet policy).
 */
function releaseAllowed(r: FieldCandidateRelease, now: number): boolean {
  const probe: FieldBuildWindow = {
    id: 'probe',
    candidate: r.versionName,
    candidateSha256: r.sha256,
    tenantIds: [],
    screenIds: [],
    allScreens: false,
    armedAt: now,
    expiresAt: now + 60_000,
  };
  return configuredFieldRelease(process.env, FIELD_CANDIDATE_RELEASES, probe, now) !== null;
}

@Injectable()
export class FieldBuildsService {
  private readonly logger = new Logger('FieldBuilds');
  private gateReadAt = 0;
  private gateFlight: Promise<void> | null = null;
  private gateWarnedAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly signer: WebsocketSignerService,
  ) {}

  // ─── The gate's read ─────────────────────────────────────────────────────

  /**
   * Keep field-candidate.ts's window at most GATE_TTL_MS old. `force` (after a
   * write here) waits out a read already in flight — it may predate the write
   * — and reads again.
   */
  async refreshGateWindow(force = false): Promise<void> {
    if (force) {
      await this.gateFlight?.catch(() => undefined);
      return this.readGateWindow();
    }
    if (Date.now() - this.gateReadAt < GATE_TTL_MS) return;
    return this.gateFlight ?? this.readGateWindow();
  }

  private readGateWindow(): Promise<void> {
    const task = (async () => {
      try {
        const row = (await this.prisma.client.fieldBuildWindow.findFirst({
          where: { cancelledAt: null, expiresAt: { gt: new Date() } },
          orderBy: [{ armedAt: 'desc' }, { id: 'desc' }],
          select: WINDOW_SELECT,
        })) as WindowRow | null;
        setActiveFieldWindow(row ? toGateWindow(row) : null);
        this.gateReadAt = Date.now();
      } catch (e: any) {
        // Keep the last row read; try again shortly rather than on every check.
        this.gateReadAt = Date.now() - GATE_TTL_MS + GATE_RETRY_MS;
        if (Date.now() - this.gateWarnedAt > 60_000) {
          this.gateWarnedAt = Date.now();
          this.logger.warn(`[field-builds] window read failed — keeping the last window read: ${e?.message ?? e}`);
        }
      }
    })();
    this.gateFlight = task;
    void task.finally(() => {
      if (this.gateFlight === task) this.gateFlight = null;
    });
    return task;
  }

  // ─── Reads for the panel ─────────────────────────────────────────────────

  async listCandidates(): Promise<{ candidates: CandidateView[] }> {
    const now = Date.now();
    const releases = Object.values(FIELD_CANDIDATE_RELEASES).sort((a, b) => b.versionCode - a.versionCode);
    const candidates: CandidateView[] = [];
    // A handful of HEADs at a time; each answer is remembered for 30 s.
    for (let i = 0; i < releases.length; i += 4) {
      const batch = await Promise.all(
        releases.slice(i, i + 4).map(async (r): Promise<CandidateView> => {
          const allowed = releaseAllowed(r, now);
          let blockedReason: string | null = null;
          if (!allowed) {
            const verdict = evaluateReleaseForFleet({ versionName: r.versionName, apkUrl: r.sourceUrl, computedSha: r.sha256 });
            blockedReason = verdict.allowed ? 'registry-record-invalid' : (verdict.reason ?? 'fleet-policy');
          }
          return {
            versionName: r.versionName,
            versionCode: r.versionCode,
            sha256: r.sha256,
            size: r.size,
            sourceUrl: r.sourceUrl,
            allowed,
            blockedReason,
            mirror: await fieldMirrorStatus(r),
          };
        }),
      );
      candidates.push(...batch);
    }
    return { candidates };
  }

  async listWindows(): Promise<WindowsView> {
    const now = Date.now();
    const client = this.prisma.client;
    const [history, active] = await Promise.all([
      client.fieldBuildWindow.findMany({
        orderBy: [{ armedAt: 'desc' }, { id: 'desc' }],
        take: HISTORY,
        select: WINDOW_SELECT,
      }) as Promise<WindowRow[]>,
      client.fieldBuildWindow.findFirst({
        where: { cancelledAt: null, expiresAt: { gt: new Date(now) } },
        orderBy: [{ armedAt: 'desc' }, { id: 'desc' }],
        select: WINDOW_SELECT,
      }) as Promise<WindowRow | null>,
    ]);
    const tenantIds = [...new Set([...history, ...(active ? [active] : [])].flatMap((w) => w.tenantIds ?? []))];
    const tenants = tenantIds.length
      ? await client.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } })
      : [];
    const names = new Map(tenants.map((t) => [t.id, t.name]));
    const variables = envWindowView(process.env, now);
    return {
      now: new Date(now).toISOString(),
      effective: active ? 'window' : variables.live ? 'variables' : 'none',
      active: active ? this.view(active, names, now) : null,
      windows: history.map((w) => this.view(w, names, now)),
      variables,
      limits: {
        minMinutes: MIN_WINDOW_MINUTES,
        maxMinutes: MAX_WINDOW_MINUTES,
        maxPushScreens: MAX_PUSH_SCREENS,
        pushSettleMs: PUSH_SETTLE_MS,
        gateTtlMs: GATE_TTL_MS,
      },
    };
  }

  /**
   * The screens of the listed organisations the caller may reach — names,
   * reported player versions and push state — for the arm form and the
   * active window's table. An organisation without reach is named in
   * `unreachable`, its screens left out.
   */
  async listScreens(user: Principal, rawTenantIds: unknown): Promise<{ screens: FieldScreenView[]; unreachable: string[] }> {
    let ids: string[];
    try {
      const raw = typeof rawTenantIds === 'string' ? rawTenantIds.split(',').map((s) => s.trim()).filter(Boolean) : rawTenantIds;
      ids = parseUuidList(raw, { max: MAX_WINDOW_TENANTS, code: 'FIELD_BUILD_TENANTS_INVALID', what: 'tenantIds' });
    } catch (e) {
      asHttp(e);
    }
    if (ids.length === 0) return { screens: [], unreachable: [] };
    const client = this.prisma.client;
    const tenants = await client.tenant.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    const reachable: string[] = [];
    const unreachable: string[] = [];
    for (const t of tenants) ((await hasSupportReach(user, t.id)) ? reachable : unreachable).push(t.id);
    if (reachable.length === 0) return { screens: [], unreachable };
    const names = new Map(tenants.map((t) => [t.id, t.name]));
    const rows = (await client.screen.findMany({
      where: { tenantId: { in: reachable } },
      select: {
        id: true,
        name: true,
        tenantId: true,
        status: true,
        lastPingAt: true,
        playerVersion: true,
        playerVersionCode: true,
        playerVersionAt: true,
        forceApkUpdatePendingAt: true,
        forceApkUpdateHold: true,
        forceApkUpdateHoldAt: true,
        forceApkUpdateHoldReason: true,
        forceApkUpdateOfferCount: true,
        forceApkUpdateLastOfferAt: true,
        forceApkUpdateTargetVersion: true,
      } as any,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: SCREEN_LIST_CAP,
    })) as any[];
    const now = Date.now();
    return {
      unreachable,
      screens: rows.map((s) => ({
        id: s.id,
        name: s.name,
        tenantId: s.tenantId,
        tenantName: names.get(s.tenantId) ?? null,
        status: s.status,
        online:
          s.status !== 'REVOKED' && !!s.lastPingAt && now - new Date(s.lastPingAt).getTime() < SCREEN_ONLINE_GRACE_MS,
        lastPingAt: iso(s.lastPingAt),
        playerVersion: s.playerVersion ?? null,
        playerVersionCode: typeof s.playerVersionCode === 'number' ? s.playerVersionCode : null,
        playerVersionAt: iso(s.playerVersionAt),
        forceApkUpdatePendingAt: iso(s.forceApkUpdatePendingAt),
        forceApkUpdateHold: s.forceApkUpdateHold ?? null,
        forceApkUpdateHoldAt: iso(s.forceApkUpdateHoldAt),
        forceApkUpdateHoldReason: s.forceApkUpdateHoldReason ?? null,
        forceApkUpdateOfferCount: Number(s.forceApkUpdateOfferCount) || 0,
        forceApkUpdateLastOfferAt: iso(s.forceApkUpdateLastOfferAt),
        forceApkUpdateTargetVersion: s.forceApkUpdateTargetVersion ?? null,
      })),
    };
  }

  // ─── Arm ─────────────────────────────────────────────────────────────────

  async arm(user: Principal, body: unknown): Promise<WindowView> {
    let input: ReturnType<typeof parseArmInput>;
    try {
      input = parseArmInput(body);
    } catch (e) {
      asHttp(e);
    }
    const now = Date.now();
    const release = FIELD_CANDIDATE_RELEASES[input.candidate];
    if (!release || !releaseAllowed(release, now)) {
      throw http(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'FIELD_BUILD_CANDIDATE_UNAVAILABLE',
        'That field build is not registered, or the fleet policy does not allow it.',
      );
    }
    const client = this.prisma.client;
    const tenants = await client.tenant.findMany({
      where: { id: { in: input.tenantIds } },
      select: { id: true, name: true },
    });
    if (tenants.length !== input.tenantIds.length) {
      throw http(HttpStatus.UNPROCESSABLE_ENTITY, 'FIELD_BUILD_TENANT_NOT_FOUND', 'One of those organizations does not exist.');
    }
    for (const id of input.tenantIds) await assertSupportReach(user, id);
    if (!input.allScreens) {
      const screens = (await client.screen.findMany({
        where: { id: { in: input.screenIds }, tenantId: { in: input.tenantIds } },
        select: { id: true, status: true },
      })) as Array<{ id: string; status: string }>;
      if (screens.length !== input.screenIds.length) {
        throw http(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'FIELD_BUILD_SCREEN_NOT_IN_TENANTS',
          'Every screen must belong to one of the chosen organizations.',
        );
      }
      if (screens.some((s) => s.status === 'REVOKED')) {
        throw http(HttpStatus.UNPROCESSABLE_ENTITY, 'FIELD_BUILD_SCREEN_REVOKED', 'A revoked screen cannot be in a window.');
      }
    }

    const armedAt = new Date(now);
    const expiresAt = new Date(now + input.durationMinutes * 60_000);
    const by = actorId(user);
    const email = actorEmail(user);
    const row = (await client.$transaction(
      async (tx: any) => {
        // One live window at a time: two arms cannot both pass the check.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${LOCK_KEY}, 0))`;
        const live = await tx.fieldBuildWindow.findFirst({
          where: { cancelledAt: null, expiresAt: { gt: armedAt } },
          select: { id: true, candidate: true, expiresAt: true },
        });
        if (live) {
          throw http(HttpStatus.CONFLICT, 'FIELD_BUILD_WINDOW_ACTIVE', 'A window is already open. Cancel it before arming another.', {
            windowId: live.id,
          });
        }
        const created = await tx.fieldBuildWindow.create({
          data: {
            candidate: release.versionName,
            candidateSha256: release.sha256,
            tenantIds: input.tenantIds,
            screenIds: input.allScreens ? [] : input.screenIds,
            allScreens: input.allScreens,
            armedAt,
            expiresAt,
            armedByUserId: by,
            armedByEmail: email,
            note: input.note,
          },
          select: WINDOW_SELECT,
        });
        const details = JSON.stringify({
          windowId: created.id,
          candidate: release.versionName,
          sha256: release.sha256,
          versionCode: release.versionCode,
          tenantIds: input.tenantIds,
          screens: input.allScreens ? 'all' : input.screenIds,
          armedAt: armedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          durationMinutes: input.durationMinutes,
          note: input.note,
          actorEmail: email,
        });
        for (const tenantId of input.tenantIds) {
          await tx.auditLog.create({
            data: {
              tenantId,
              userId: by,
              action: FIELD_AUDIT.ARM,
              targetType: 'field_build_window',
              targetId: created.id,
              details,
            },
          });
        }
        return created;
      },
      { maxWait: 5_000, timeout: 10_000 },
    )) as WindowRow;
    this.logger.log(
      `[field-builds] armed window=${row.id} candidate=${row.candidate} sha=${row.candidateSha256.slice(0, 12)} ` +
        `tenants=${row.tenantIds.length} screens=${row.allScreens ? 'all' : row.screenIds.length} ` +
        `expires=${row.expiresAt.toISOString()} by=${by ?? '-'}`,
    );
    await this.refreshGateWindow(true);
    return this.view(row, new Map(tenants.map((t) => [t.id, t.name])), Date.now());
  }

  // ─── Cancel ──────────────────────────────────────────────────────────────

  async cancel(
    user: Principal,
    id: string,
    body: unknown,
  ): Promise<{ window: WindowView; cancelled: boolean; pushesCancelled: string[] }> {
    let reason: string | null;
    try {
      reason = parseNote((body as any)?.reason, 'reason');
    } catch (e) {
      asHttp(e);
    }
    const client = this.prisma.client;
    const now = Date.now();
    const by = actorId(user);
    const email = actorEmail(user);
    const outcome = (await client.$transaction(
      async (tx: any) => {
        const w = (await tx.fieldBuildWindow.findUnique({ where: { id }, select: WINDOW_SELECT })) as WindowRow | null;
        if (!w) throw http(HttpStatus.NOT_FOUND, 'FIELD_BUILD_WINDOW_NOT_FOUND', 'That window does not exist.');
        if (windowState(w, now) !== 'active') return { row: w, cancelled: false };
        const cancelledAt = new Date(Math.max(now, w.armedAt.getTime()));
        // Guarded on "still open", so a double click writes one set of rows.
        const done = await tx.fieldBuildWindow.updateMany({
          where: { id, cancelledAt: null },
          data: { cancelledAt, cancelledByUserId: by, cancelledByEmail: email },
        });
        if (!done.count) {
          const again = (await tx.fieldBuildWindow.findUnique({ where: { id }, select: WINDOW_SELECT })) as WindowRow;
          return { row: again, cancelled: false };
        }
        const details = JSON.stringify({
          windowId: w.id,
          candidate: w.candidate,
          sha256: w.candidateSha256,
          tenantIds: w.tenantIds,
          screens: w.allScreens ? 'all' : w.screenIds,
          armedAt: w.armedAt.toISOString(),
          expiresAt: w.expiresAt.toISOString(),
          cancelledAt: cancelledAt.toISOString(),
          reason,
          actorEmail: email,
        });
        for (const tenantId of w.tenantIds) {
          await tx.auditLog.create({
            data: {
              tenantId,
              userId: by,
              action: FIELD_AUDIT.CANCEL,
              targetType: 'field_build_window',
              targetId: w.id,
              details,
            },
          });
        }
        return { row: { ...w, cancelledAt, cancelledByUserId: by, cancelledByEmail: email }, cancelled: true };
      },
      { maxWait: 5_000, timeout: 10_000 },
    )) as { row: WindowRow; cancelled: boolean };

    let pushesCancelled: string[] = [];
    if (outcome.cancelled) {
      this.logger.log(`[field-builds] cancelled window=${id} candidate=${outcome.row.candidate} by=${by ?? '-'}`);
      await this.refreshGateWindow(true);
      pushesCancelled = await this.cancelWindowPushes(outcome.row, by, email);
    }
    const tenants = await client.tenant.findMany({
      where: { id: { in: outcome.row.tenantIds } },
      select: { id: true, name: true },
    });
    return {
      window: this.view(outcome.row, new Map(tenants.map((t) => [t.id, t.name])), Date.now()),
      cancelled: outcome.cancelled,
      pushesCancelled,
    };
  }

  /**
   * A push this window armed and that is still waiting would, with the window
   * gone, be answered as an ordinary update — the stable build. Cancel exactly
   * those pushes (by their recorded identity, never anyone else's) and audit
   * each. Best-effort per screen: the window is already closed.
   */
  private async cancelWindowPushes(w: WindowRow, by: string | null, email: string | null): Promise<string[]> {
    const client = this.prisma.client;
    let rows: Array<{ tenantId: string; targetId: string | null; details: string | null }> = [];
    try {
      rows = (await client.auditLog.findMany({
        where: {
          action: FIELD_AUDIT.PUSH,
          targetType: 'screen',
          tenantId: { in: w.tenantIds },
          details: { contains: `"windowId":"${w.id}"` },
        },
        select: { tenantId: true, targetId: true, details: true },
      })) as any[];
    } catch (e: any) {
      this.logger.warn(`[field-builds] could not list the pushes of window=${w.id}: ${e?.message ?? e}`);
      return [];
    }
    const cancelled: string[] = [];
    for (const r of rows) {
      let pushAt: Date | null = null;
      try {
        const d = JSON.parse(r.details ?? '{}');
        if (d?.windowId === w.id && typeof d.pushAt === 'string') pushAt = new Date(d.pushAt);
      } catch {
        /* not ours */
      }
      if (!r.targetId || !pushAt || !Number.isFinite(pushAt.getTime())) continue;
      try {
        const done = await cancelScreenApkUpdate(
          this.prisma,
          { id: r.targetId, tenantId: r.tenantId },
          { onlyPushAt: pushAt },
        );
        if (!done.cancelled) continue;
        cancelled.push(r.targetId);
        await client.auditLog.create({
          data: {
            tenantId: r.tenantId,
            userId: by,
            action: FIELD_AUDIT.PUSH_CANCEL,
            targetType: 'screen',
            targetId: r.targetId,
            details: JSON.stringify({
              windowId: w.id,
              candidate: w.candidate,
              sha256: w.candidateSha256,
              pushAt: done.pushAt,
              hold: done.hold,
              offers: done.offers,
              reason: 'window-cancelled',
              actorEmail: email,
            }),
          },
        });
      } catch (e: any) {
        this.logger.warn(`[field-builds] push cleanup failed screen=${r.targetId} window=${w.id}: ${e?.message ?? e}`);
      }
    }
    return cancelled;
  }

  // ─── Push now ────────────────────────────────────────────────────────────

  async push(user: Principal, id: string, body: unknown): Promise<{ results: PushResult[] }> {
    let input: ReturnType<typeof parsePushInput>;
    try {
      input = parsePushInput(body);
    } catch (e) {
      asHttp(e);
    }
    const client = this.prisma.client;
    const now = Date.now();
    const w = (await client.fieldBuildWindow.findUnique({ where: { id }, select: WINDOW_SELECT })) as WindowRow | null;
    if (!w) throw http(HttpStatus.NOT_FOUND, 'FIELD_BUILD_WINDOW_NOT_FOUND', 'That window does not exist.');
    if (windowState(w, now) !== 'active') {
      throw http(HttpStatus.CONFLICT, 'FIELD_BUILD_WINDOW_ENDED', 'This window has ended. Arm a new one to push.');
    }
    // The gate follows the newest open window; a push for any other would
    // install something else.
    const newest = (await client.fieldBuildWindow.findFirst({
      where: { cancelledAt: null, expiresAt: { gt: new Date(now) } },
      orderBy: [{ armedAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    })) as { id: string } | null;
    if (newest?.id !== w.id) {
      throw http(HttpStatus.CONFLICT, 'FIELD_BUILD_WINDOW_SUPERSEDED', 'A newer window is open. Push from that one.');
    }
    const readyAt = pushReadyAt(w);
    if (now < readyAt) {
      throw http(HttpStatus.CONFLICT, 'FIELD_BUILD_WINDOW_SETTLING', 'The window is still reaching every server. Try again in a few seconds.', {
        retryAfterMs: readyAt - now,
      });
    }
    const gate = toGateWindow(w);
    const release = configuredFieldRelease(process.env, FIELD_CANDIDATE_RELEASES, gate, now);
    if (!release) {
      throw http(
        HttpStatus.CONFLICT,
        'FIELD_BUILD_CANDIDATE_UNAVAILABLE',
        'This build is no longer allowed (the fleet policy or its registry record changed). Cancel the window.',
      );
    }
    const mirror = await fieldMirrorStatus(release);
    if (MIRROR_BLOCKS_PUSH.has(mirror.state)) {
      throw http(
        HttpStatus.CONFLICT,
        'FIELD_BUILD_MIRROR_MISSING',
        'The private copy of this build is not in storage, so a screen would stay on its current build.',
        { mirror },
      );
    }
    const screens = (await client.screen.findMany({
      where: { id: { in: input.screenIds }, tenantId: { in: w.tenantIds } },
      select: { id: true, tenantId: true, name: true, status: true },
    })) as Array<{ id: string; tenantId: string; name: string; status: string }>;
    // Inside the window is decided by the gate itself, not re-derived here.
    const inside = screens.filter((s) => s.status !== 'REVOKED' && isFieldCandidateTarget(s.id, s.tenantId, {}, now, gate));
    if (inside.length !== input.screenIds.length) {
      throw http(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'FIELD_BUILD_SCREEN_OUTSIDE_WINDOW',
        'Every screen must be inside this window (and not revoked).',
      );
    }
    for (const s of inside) await assertSupportReach(user, s.tenantId);

    const by = actorId(user);
    const email = actorEmail(user);
    const deps = { prisma: this.prisma, signer: this.signer, redis: this.redis };
    const results: PushResult[] = [];
    for (const id of input.screenIds) {
      const s = inside.find((x) => x.id === id)!;
      const corrId = newCorrId('field');
      const pushAt = new Date();
      // No row, no push.
      await client.auditLog.create({
        data: {
          tenantId: s.tenantId,
          userId: by,
          action: FIELD_AUDIT.PUSH,
          targetType: 'screen',
          targetId: s.id,
          details: JSON.stringify({
            windowId: w.id,
            candidate: release.versionName,
            sha256: release.sha256,
            versionCode: release.versionCode,
            screenName: s.name,
            corrId,
            pushAt: pushAt.toISOString(),
            overrideWindow: input.overrideWindow,
            actorEmail: email,
          }),
        },
      });
      const pushed = await armScreenApkUpdate(
        deps,
        { id: s.id, tenantId: s.tenantId, name: s.name },
        { requestedBy: by, corrId, overrideWindow: input.overrideWindow, at: pushAt },
      );
      this.logger.log(
        `[field-builds] push ${corrId} window=${w.id} screen=${s.id} candidate=${release.versionName} ` +
          `armed=${pushed.armed} published=${pushed.published} overrideWindow=${input.overrideWindow}`,
      );
      results.push({
        screenId: s.id,
        name: s.name,
        armed: pushed.armed,
        published: pushed.published,
        corrId,
        pushAt: pushed.pushAt.toISOString(),
      });
    }
    return { results };
  }

  // ─── Shape ───────────────────────────────────────────────────────────────

  private view(w: WindowRow, names: Map<string, string>, now: number): WindowView {
    const r = FIELD_CANDIDATE_RELEASES[w.candidate];
    return {
      id: w.id,
      candidate: w.candidate,
      candidateSha256: w.candidateSha256,
      versionCode: r && r.sha256 === w.candidateSha256 ? r.versionCode : null,
      tenants: (w.tenantIds ?? []).map((id) => ({ id, name: names.get(id) ?? null })),
      allScreens: w.allScreens,
      screenIds: w.screenIds ?? [],
      armedAt: w.armedAt.toISOString(),
      expiresAt: w.expiresAt.toISOString(),
      armedBy: { userId: w.armedByUserId, email: w.armedByEmail },
      cancelledAt: iso(w.cancelledAt),
      cancelledBy: w.cancelledAt ? { userId: w.cancelledByUserId, email: w.cancelledByEmail } : null,
      note: w.note,
      state: windowState(w, now),
      pushReadyAt: new Date(pushReadyAt(w)).toISOString(),
    };
  }
}
