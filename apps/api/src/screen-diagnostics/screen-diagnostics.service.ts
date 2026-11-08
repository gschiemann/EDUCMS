/**
 * ScreenDiagnosticsService (2026-11-08) — self-test, network diagnostics,
 * logs on demand and storage health for one screen. The policy is in
 * `diagnostics-policy.ts`; this file does the reads and writes.
 *
 * Every tenant-owned read and write constrains `tenantId` (CLAUDE.md §4): the
 * operator side takes the tenant from the caller-scoped screen load, the
 * device side from the shared device verifier's LIVE row (never a claim).
 */
import { HttpException, HttpStatus, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import type { Request as ExpressReq } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { SupabaseStorageService, DEVICE_LOGS_BUCKET } from '../storage/supabase-storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { verifyDeviceForScreen } from '../screens/device-auth';
import { assertSupportReach } from '../support-access/support-access.context';
import {
  DIAGNOSTICS_AUDIT,
  DIAGNOSTICS_WS_TYPE,
  LOG_UPLOAD_MAX_BYTES,
  UPLOAD_TICKET_TTL_MS,
  clampMinutes,
  diagnosticsDisabled,
  encodePendingKind,
  gradeSelfTest,
  isRequestId,
  logRetentionDays,
  mayRequest,
  parseKind,
  sanitizeNativeSelfTest,
  sanitizePageSelfTest,
  signUploadTicket,
  ttlFor,
  verifyUploadTicket,
  viewStatus,
  type Check,
  type DiagnosticsKind,
  type NativeSelfTest,
  type PageSelfTest,
  type ViewStatus,
} from './diagnostics-policy';
import { redactLogText } from './diagnostics-redact';
import { expireOpenRequest } from './diagnostics-heartbeat';
import { gradeStorage, parsePageStorage, recordStorageHealth, registerStorageNotifier, storageWarningsDisabled, type NativeStorage, type PageStorage, type StorageWarning } from './storage-health';

export interface RequestView {
  id: string;
  kind: DiagnosticsKind;
  status: ViewStatus;
  createdAt: string;
  completedAt: string | null;
  verdict: 'pass' | 'warn' | 'fail' | null;
  checks: Check[];
  /** LOGS only. */
  minutes?: number | null;
  logBytes?: number | null;
  logAvailable?: boolean;
  logPurged?: boolean;
  failureReason?: string | null;
  /** Which halves answered (self-test). */
  answered?: { native: boolean; page: boolean };
}

export interface DiagnosticsView {
  enabled: boolean;
  canRequestLogs: boolean;
  retentionDays: number;
  storage: {
    warning: StorageWarning;
    native: (NativeStorage & { at: string }) | null;
    page: (PageStorage & { at: string }) | null;
  } | null;
  selfTest: RequestView | null;
  logs: RequestView[];
}

type Row = Awaited<ReturnType<PrismaService['client']['screenDiagnosticsRequest']['findFirst']>> & {};

@Injectable()
export class ScreenDiagnosticsService {
  private readonly logger = new Logger(ScreenDiagnosticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly signer: WebsocketSignerService,
    private readonly storage: SupabaseStorageService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {
    // The native heartbeat's storage half reaches the bell through this.
    registerStorageNotifier(notifications ?? null);
  }

  // ─── Operator side ────────────────────────────────────────────────────

  /** The caller-scoped screen: own tenant + direct children, support reach asserted. */
  async loadOperatorScreen(screenId: string, user: any) {
    const callerTenantId: string | null = user?.tenantId || user?.schoolId || user?.districtId || null;
    if (!callerTenantId) throw new NotFoundException({ code: 'SCREEN_NOT_FOUND', message: 'Screen not found' });
    const children = await this.prisma.client.tenant.findMany({
      where: { parentId: callerTenantId, archivedAt: null },
      select: { id: true },
    });
    const readable = [callerTenantId, ...children.map((c: { id: string }) => c.id)];
    const screen = await this.prisma.client.screen.findFirst({
      where: { id: screenId, tenantId: { in: readable } },
      select: {
        id: true, tenantId: true, name: true, faceOfScreenId: true, lastPingAt: true,
        pendingDiagnosticsId: true, pendingDiagnosticsKind: true, pendingDiagnosticsAt: true,
      },
    });
    if (!screen || !screen.tenantId) throw new NotFoundException({ code: 'SCREEN_NOT_FOUND', message: 'Screen not found' });
    await assertSupportReach(user, screen.tenantId);
    return screen as typeof screen & { tenantId: string };
  }

  async request(user: any, screenId: string, body: { kind?: unknown; minutes?: unknown }, ip: string | null): Promise<RequestView> {
    const kind = parseKind(body?.kind);
    if (!kind) throw new HttpException({ code: 'DIAGNOSTICS_KIND_INVALID', message: 'kind must be SELF_TEST or LOGS' }, HttpStatus.BAD_REQUEST);
    if (!mayRequest(user?.role, kind)) {
      throw new HttpException({ code: 'DIAGNOSTICS_FORBIDDEN', message: 'Your role cannot request this' }, HttpStatus.FORBIDDEN);
    }
    if (diagnosticsDisabled()) {
      throw new HttpException({ code: 'SCREEN_DIAGNOSTICS_DISABLED', message: 'Screen diagnostics are turned off' }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    const screen = await this.loadOperatorScreen(screenId, user);
    if (screen.faceOfScreenId) {
      throw new HttpException({ code: 'DIAGNOSTICS_ON_PRIMARY_SIDE', message: 'Run diagnostics on the main side of this double-sided screen.' }, HttpStatus.CONFLICT);
    }
    const now = new Date();
    // One open request per screen. An expired one is closed first.
    if (screen.pendingDiagnosticsId) {
      const kindOpen = parseKind(String(screen.pendingDiagnosticsKind ?? '').split(':')[0]);
      const at = screen.pendingDiagnosticsAt?.getTime() ?? 0;
      if (kindOpen && at && now.getTime() - at <= ttlFor(kindOpen)) {
        throw new HttpException({ code: 'DIAGNOSTICS_IN_PROGRESS', message: 'A diagnostics request is already running on this screen', requestId: screen.pendingDiagnosticsId }, HttpStatus.CONFLICT);
      }
      await expireOpenRequest(this.prisma, screen.id, screen.tenantId, screen.pendingDiagnosticsId, now);
    }
    const minutes = kind === 'LOGS' ? clampMinutes(body?.minutes) : null;
    const userId: string | null = user?.id ?? user?.userId ?? null;
    const row = await this.prisma.client.screenDiagnosticsRequest.create({
      data: {
        tenantId: screen.tenantId, screenId: screen.id, kind, minutes, requestedById: userId,
        createdAt: now, expiresAt: new Date(now.getTime() + ttlFor(kind)),
      },
    });
    // The audit row is written BEFORE anything reaches the screen. For a logs
    // request it is mandatory: no row, no request (a privileged read of a
    // device's records is never unaudited).
    const audited = await this.audit(screen.tenantId, userId, DIAGNOSTICS_AUDIT.REQUESTED, screen.id, {
      requestId: row.id, kind, minutes, screenName: screen.name, ip, role: user?.role ?? null,
      supportGrantId: user?.supportGrantId ?? null,
    });
    if (!audited && kind === 'LOGS') {
      await this.prisma.client.screenDiagnosticsRequest.updateMany({
        where: { id: row.id, tenantId: screen.tenantId }, data: { status: 'FAILED', failureReason: 'audit-unavailable', completedAt: now },
      });
      throw new HttpException({ code: 'DIAGNOSTICS_AUDIT_UNAVAILABLE', message: 'Could not record the request; try again' }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    // The durable half: manifest + native heartbeat. Conditional on the
    // marker being empty, so two clicks racing cannot both arm.
    const armed = await this.prisma.client.screen.updateMany({
      where: { id: screen.id, tenantId: screen.tenantId, pendingDiagnosticsId: null },
      data: { pendingDiagnosticsId: row.id, pendingDiagnosticsKind: encodePendingKind(kind, minutes), pendingDiagnosticsAt: now },
    });
    if (armed.count !== 1) {
      await this.prisma.client.screenDiagnosticsRequest.updateMany({
        where: { id: row.id, tenantId: screen.tenantId }, data: { status: 'FAILED', failureReason: 'superseded', completedAt: now },
      });
      throw new HttpException({ code: 'DIAGNOSTICS_IN_PROGRESS', message: 'A diagnostics request is already running on this screen' }, HttpStatus.CONFLICT);
    }
    // The fast half: signed pub/sub on the screen's own channel. A dead
    // fan-out must not fail the click — the durable rides still reach it.
    try {
      const signed = this.signer.signMessage(DIAGNOSTICS_WS_TYPE, {
        screenId: screen.id, requestId: row.id, kind, ...(minutes ? { minutes } : {}),
      });
      await this.redis.publish(`device:${screen.id}`, signed);
    } catch (e) {
      this.logger.warn(`[diagnostics ${row.id}] publish failed for ${screen.id}: ${(e as Error).message}`);
    }
    return this.toView(row, now, null);
  }

  async view(user: any, screenId: string): Promise<DiagnosticsView> {
    const screen = await this.loadOperatorScreen(screenId, user);
    const now = new Date();
    const [rows, health] = await Promise.all([
      this.prisma.client.screenDiagnosticsRequest.findMany({
        where: { tenantId: screen.tenantId, screenId: screen.id },
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
      this.prisma.client.screenStorageHealth.findFirst({ where: { screenId: screen.id, tenantId: screen.tenantId } }),
    ]);
    const hbAge = screen.lastPingAt ? now.getTime() - screen.lastPingAt.getTime() : null;
    const finalised: Row[] = [];
    for (const r of rows) finalised.push(await this.finaliseIfDone(r, now, hbAge));
    const selfRow = finalised.find((r) => r.kind === 'SELF_TEST') ?? null;
    const canLogs = mayRequest(user?.role, 'LOGS');
    const nativeH = (health?.native as unknown as NativeStorage | null) ?? null;
    const pageH = (health?.page as unknown as PageStorage | null) ?? null;
    return {
      enabled: !diagnosticsDisabled(),
      canRequestLogs: canLogs,
      retentionDays: logRetentionDays(),
      storage: health ? {
        warning: storageWarningsDisabled() ? null
          : gradeStorage({ native: nativeH, nativeAt: health.nativeAt, page: pageH, pageAt: health.pageAt, nowMs: now.getTime() }),
        native: nativeH && health.nativeAt ? { ...nativeH, at: health.nativeAt.toISOString() } : null,
        page: pageH && health.pageAt ? { ...pageH, at: health.pageAt.toISOString() } : null,
      } : null,
      selfTest: selfRow ? this.toView(selfRow, now, hbAge) : null,
      logs: canLogs ? finalised.filter((r) => r.kind === 'LOGS').slice(0, 5).map((r) => this.toView(r, now, hbAge)) : [],
    };
  }

  async logsUrl(user: any, screenId: string, requestId: string, ip: string | null): Promise<{ url: string; expiresInSeconds: number }> {
    if (!mayRequest(user?.role, 'LOGS')) {
      throw new HttpException({ code: 'DIAGNOSTICS_FORBIDDEN', message: 'Your role cannot read device logs' }, HttpStatus.FORBIDDEN);
    }
    const screen = await this.loadOperatorScreen(screenId, user);
    if (!isRequestId(requestId)) throw new NotFoundException({ code: 'DIAGNOSTICS_NOT_FOUND', message: 'Not found' });
    const row = await this.prisma.client.screenDiagnosticsRequest.findFirst({
      where: { id: requestId, tenantId: screen.tenantId, screenId: screen.id, kind: 'LOGS' },
    });
    if (!row || !row.logObjectKey || row.logPurgedAt) {
      throw new NotFoundException({ code: 'DIAGNOSTICS_LOGS_UNAVAILABLE', message: 'These logs are not available (never uploaded or past retention)' });
    }
    const expiresInSeconds = 300;
    const audited = await this.audit(screen.tenantId, user?.id ?? user?.userId ?? null, DIAGNOSTICS_AUDIT.LOGS_DOWNLOADED, screen.id, {
      requestId: row.id, ip, role: user?.role ?? null, supportGrantId: user?.supportGrantId ?? null,
    });
    if (!audited) throw new HttpException({ code: 'DIAGNOSTICS_AUDIT_UNAVAILABLE', message: 'Could not record the download; try again' }, HttpStatus.SERVICE_UNAVAILABLE);
    const url = await this.storage.createSignedUrl(row.logObjectKey, expiresInSeconds, DEVICE_LOGS_BUCKET);
    if (!url) throw new HttpException({ code: 'DIAGNOSTICS_STORAGE_UNAVAILABLE', message: 'Storage did not answer; try again' }, HttpStatus.BAD_GATEWAY);
    return { url, expiresInSeconds };
  }

  // ─── Device side ──────────────────────────────────────────────────────

  private async device(req: ExpressReq, screenId: string): Promise<{ screenId: string; tenantId: string }> {
    // Strict: a paired, proven credential bound to THIS screen (SEC-001).
    const auth = await verifyDeviceForScreen({ prisma: this.prisma as any, redis: this.redis as any }, req, screenId, { allowUnpaired: false });
    if (!auth.ok || !auth.tenantId) {
      throw new HttpException({ code: 'SCREEN_DEVICE_AUTH_REQUIRED', message: 'Device auth failed' }, HttpStatus.UNAUTHORIZED);
    }
    return { screenId: auth.sub, tenantId: auth.tenantId };
  }

  /** The open request this device may answer, or a refusal the device treats as "stop". */
  private async openRow(dev: { screenId: string; tenantId: string }, requestId: string, kind: DiagnosticsKind, now: Date): Promise<Row> {
    if (!isRequestId(requestId)) throw new NotFoundException({ code: 'DIAGNOSTICS_NOT_FOUND', message: 'Not found' });
    const row = await this.prisma.client.screenDiagnosticsRequest.findFirst({
      where: { id: requestId, tenantId: dev.tenantId, screenId: dev.screenId, kind },
    });
    if (!row) throw new NotFoundException({ code: 'DIAGNOSTICS_NOT_FOUND', message: 'Not found' });
    if (row.status !== 'PENDING' || now.getTime() > row.expiresAt.getTime()) {
      throw new HttpException({ code: 'DIAGNOSTICS_CLOSED', message: 'This request is no longer open' }, HttpStatus.GONE);
    }
    return row;
  }

  async acceptNative(req: ExpressReq, screenId: string, requestId: string, body: unknown): Promise<{ ok: true }> {
    const dev = await this.device(req, screenId);
    const now = new Date();
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    // A LOGS request the device could not fulfil is reported here too.
    if (b.kind === 'LOGS') {
      const row = await this.openRow(dev, requestId, 'LOGS', now);
      const reason = typeof b.error === 'string' && /^[a-z0-9-]{1,48}$/.test(b.error) ? b.error : 'device-error';
      await this.prisma.client.screenDiagnosticsRequest.updateMany({
        where: { id: row.id, tenantId: dev.tenantId, status: 'PENDING' },
        data: { status: 'FAILED', failureReason: reason, completedAt: now, deliveredAt: row.deliveredAt ?? now },
      });
      await this.clearMarker(dev, row.id);
      return { ok: true };
    }
    const row = await this.openRow(dev, requestId, 'SELF_TEST', now);
    const native = sanitizeNativeSelfTest(b);
    if (!native) throw new HttpException({ code: 'DIAGNOSTICS_BODY_INVALID', message: 'Unreadable result' }, HttpStatus.BAD_REQUEST);
    await this.prisma.client.screenDiagnosticsRequest.updateMany({
      where: { id: row.id, tenantId: dev.tenantId, status: 'PENDING', nativeAt: null },
      data: { nativeResult: native as any, nativeAt: now, deliveredAt: row.deliveredAt ?? now },
    });
    await this.completeIfBoth(dev, row.id, now);
    return { ok: true };
  }

  async acceptPage(req: ExpressReq, screenId: string, requestId: string, body: unknown): Promise<{ ok: true }> {
    const dev = await this.device(req, screenId);
    const now = new Date();
    const row = await this.openRow(dev, requestId, 'SELF_TEST', now);
    const page = sanitizePageSelfTest(body);
    if (!page) throw new HttpException({ code: 'DIAGNOSTICS_BODY_INVALID', message: 'Unreadable result' }, HttpStatus.BAD_REQUEST);
    await this.prisma.client.screenDiagnosticsRequest.updateMany({
      where: { id: row.id, tenantId: dev.tenantId, status: 'PENDING', pageAt: null },
      data: { pageResult: page as any, pageAt: now, deliveredAt: row.deliveredAt ?? now },
    });
    await this.completeIfBoth(dev, row.id, now);
    return { ok: true };
  }

  async issueTicket(req: ExpressReq, screenId: string, requestId: string): Promise<{ ticket: string; expiresAt: string; maxBytes: number; minutes: number }> {
    const dev = await this.device(req, screenId);
    const now = new Date();
    const row = await this.openRow(dev, requestId, 'LOGS', now);
    const exp = Math.min(now.getTime() + UPLOAD_TICKET_TTL_MS, row.expiresAt.getTime());
    const ticket = signUploadTicket(dev.screenId, row.id, exp);
    if (!ticket) throw new HttpException({ code: 'DIAGNOSTICS_TICKET_UNAVAILABLE', message: 'Upload signing is not configured' }, HttpStatus.SERVICE_UNAVAILABLE);
    await this.prisma.client.screenDiagnosticsRequest.updateMany({
      where: { id: row.id, tenantId: dev.tenantId, deliveredAt: null }, data: { deliveredAt: now },
    });
    return { ticket, expiresAt: new Date(exp).toISOString(), maxBytes: LOG_UPLOAD_MAX_BYTES, minutes: row.minutes ?? 15 };
  }

  async acceptLogs(req: ExpressReq, screenId: string, requestId: string, ticket: unknown, body: unknown): Promise<{ ok: true; bytes: number }> {
    const dev = await this.device(req, screenId);
    const now = new Date();
    const row = await this.openRow(dev, requestId, 'LOGS', now);
    if (!verifyUploadTicket(ticket, dev.screenId, row.id, now.getTime())) {
      throw new HttpException({ code: 'DIAGNOSTICS_TICKET_INVALID', message: 'Upload ticket invalid or expired' }, HttpStatus.FORBIDDEN);
    }
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const player = typeof b.player === 'string' ? b.player : '';
    const manager = typeof b.manager === 'string' ? b.manager : '';
    if (Buffer.byteLength(player, 'utf8') + Buffer.byteLength(manager, 'utf8') > LOG_UPLOAD_MAX_BYTES) {
      throw new HttpException({ code: 'DIAGNOSTICS_LOGS_TOO_LARGE', message: 'Log bundle too large' }, HttpStatus.PAYLOAD_TOO_LARGE);
    }
    const managerStatus = typeof b.managerStatus === 'string' && /^[a-z0-9-]{1,48}$/.test(b.managerStatus) ? b.managerStatus : (manager ? 'ok' : 'unavailable');
    const header = [
      `# VenueOS device logs — screen ${dev.screenId}`,
      `# request ${row.id} · last ${row.minutes ?? 15} minutes · uploaded ${now.toISOString()}`,
      `# redacted on the device and again by the API (tokens, Wi-Fi credentials, e-mail addresses, URL secrets)`,
      '',
    ].join('\n');
    const text = header
      + '===== Player (com.educms.player) =====\n' + redactLogText(player)
      + '\n\n===== Manager (com.educms.manager) — ' + managerStatus + ' =====\n' + redactLogText(manager) + '\n';
    const buf = Buffer.from(text, 'utf8');
    const sha = createHash('sha256').update(buf).digest('hex');
    const key = `${dev.tenantId}/${dev.screenId}/${row.id}.txt`;
    try {
      await this.storage.uploadToBucket(DEVICE_LOGS_BUCKET, key, buf, 'text/plain');
    } catch (e) {
      this.logger.warn(`[diagnostics ${row.id}] log upload to storage failed: ${(e as Error).message}`);
      throw new HttpException({ code: 'DIAGNOSTICS_STORAGE_UNAVAILABLE', message: 'Storage did not accept the logs; retry' }, HttpStatus.BAD_GATEWAY);
    }
    const done = await this.prisma.client.screenDiagnosticsRequest.updateMany({
      where: { id: row.id, tenantId: dev.tenantId, status: 'PENDING' },
      data: { status: 'COMPLETE', completedAt: now, logObjectKey: key, logBytes: buf.length, logSha256: sha },
    });
    await this.clearMarker(dev, row.id);
    if (done.count === 1) {
      await this.audit(dev.tenantId, null, DIAGNOSTICS_AUDIT.LOGS_UPLOADED, dev.screenId, {
        requestId: row.id, bytes: buf.length, sha256: sha, minutes: row.minutes, managerStatus,
        requestedById: row.requestedById,
      });
    }
    return { ok: true, bytes: buf.length };
  }

  async acceptPageStorage(req: ExpressReq, screenId: string, body: unknown): Promise<{ ok: true; warning: StorageWarning }> {
    const dev = await this.device(req, screenId);
    const page = parsePageStorage(body);
    if (!page) throw new HttpException({ code: 'STORAGE_HEALTH_INVALID', message: 'Unreadable report' }, HttpStatus.BAD_REQUEST);
    const screen = await this.prisma.client.screen.findFirst({ where: { id: dev.screenId, tenantId: dev.tenantId }, select: { name: true } });
    const warning = await recordStorageHealth(
      { prisma: this.prisma, notifications: this.notifications ?? null },
      { id: dev.screenId, tenantId: dev.tenantId, name: screen?.name ?? null },
      { page },
    );
    return { ok: true, warning: warning ?? null };
  }

  // ─── Internals ───────────────────────────────────────────────────────

  private async completeIfBoth(dev: { screenId: string; tenantId: string }, requestId: string, now: Date) {
    const row = await this.prisma.client.screenDiagnosticsRequest.findFirst({ where: { id: requestId, tenantId: dev.tenantId } });
    if (!row || !row.nativeAt || !row.pageAt) return;
    const screen = await this.prisma.client.screen.findFirst({ where: { id: dev.screenId, tenantId: dev.tenantId }, select: { lastPingAt: true } });
    const hb = screen?.lastPingAt ? now.getTime() - screen.lastPingAt.getTime() : null;
    await this.finalise(row, now, hb);
  }

  /** Persist COMPLETE + the verdict once the read-time state says the test is done. */
  private async finaliseIfDone(row: Row, now: Date, hbAge: number | null): Promise<Row> {
    if (row.status !== 'PENDING') return row;
    const st = viewStatus(row, now.getTime());
    if (st === 'complete' && row.kind === 'SELF_TEST') return this.finalise(row, now, hbAge);
    if (st === 'expired') {
      await expireOpenRequest(this.prisma, row.screenId, row.tenantId, row.id, now);
      return { ...row, status: 'EXPIRED', completedAt: now };
    }
    return row;
  }

  private async finalise(row: Row, now: Date, hbAge: number | null): Promise<Row> {
    const graded = gradeSelfTest({
      native: (row.nativeResult as unknown as NativeSelfTest | null) ?? null,
      page: (row.pageResult as unknown as PageSelfTest | null) ?? null,
      heartbeatAgeMs: hbAge,
    });
    await this.prisma.client.screenDiagnosticsRequest.updateMany({
      where: { id: row.id, tenantId: row.tenantId, status: 'PENDING' },
      data: { status: 'COMPLETE', verdict: graded.verdict, completedAt: now },
    });
    await this.clearMarker({ screenId: row.screenId, tenantId: row.tenantId }, row.id);
    return { ...row, status: 'COMPLETE', verdict: graded.verdict, completedAt: now };
  }

  /** Clear the screen's marker only while it still names THIS request. */
  private async clearMarker(dev: { screenId: string; tenantId: string }, requestId: string) {
    await this.prisma.client.screen.updateMany({
      where: { id: dev.screenId, tenantId: dev.tenantId, pendingDiagnosticsId: requestId },
      data: { pendingDiagnosticsId: null, pendingDiagnosticsKind: null, pendingDiagnosticsAt: null },
    });
  }

  toView(row: Row, now: Date, hbAge: number | null): RequestView {
    const kind = row.kind as DiagnosticsKind;
    const status = viewStatus(row, now.getTime());
    const base: RequestView = {
      id: row.id, kind, status,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      verdict: null, checks: [],
    };
    if (kind === 'LOGS') {
      return {
        ...base, minutes: row.minutes, logBytes: row.logBytes,
        logAvailable: !!row.logObjectKey && !row.logPurgedAt, logPurged: !!row.logPurgedAt,
        failureReason: row.failureReason,
      };
    }
    const answered = { native: !!row.nativeAt, page: !!row.pageAt };
    if (!answered.native && !answered.page) return { ...base, answered };
    const graded = gradeSelfTest({
      native: (row.nativeResult as unknown as NativeSelfTest | null) ?? null,
      page: (row.pageResult as unknown as PageSelfTest | null) ?? null,
      heartbeatAgeMs: hbAge,
    });
    return { ...base, answered, checks: graded.checks, verdict: status === 'complete' ? ((row.verdict as any) ?? graded.verdict) : null };
  }

  private async audit(tenantId: string, userId: string | null, action: string, screenId: string, details: Record<string, unknown>): Promise<boolean> {
    try {
      await this.prisma.client.auditLog.create({
        data: { tenantId, userId, action, targetType: 'Screen', targetId: screenId, details: JSON.stringify(details) },
      });
      return true;
    } catch (e) {
      // Logged loudly, never silently dropped; the logs paths refuse on it.
      this.logger.error(`[diagnostics] audit ${action} for ${screenId} FAILED: ${(e as Error).message}`);
      return false;
    }
  }
}
