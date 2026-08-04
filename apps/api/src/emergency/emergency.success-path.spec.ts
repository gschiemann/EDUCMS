import { Test, TestingModule } from '@nestjs/testing';
import { EmergencyController } from './emergency.controller';
import { RedisService } from '../realtime/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { WebhookDispatchService } from '../webhooks/webhook-dispatch.service';
import { GpioService } from '../screens/gpio.service';
import { JwtService } from '@nestjs/jwt';

// ──────────────────────────────────────────────────────────────────────────
// Emergency-broadcast SUCCESS PATH — end-to-end at the API level (task #206).
//
// emergency.controller.spec.ts pins each method's CONTRACT in isolation
// (audit row written, payload signed, published to the right channel), and a
// long block of FAILURE-path tests (cross-tenant 403, unknown scope 404, bad
// scopeType 400, device-auth rejection). What it never proved was the happy
// path flowing END-TO-END THROUGH STATE:
//
//   trigger an alert  →  it shows up as ACTIVE on the poll read
//                     →  all-clear  →  it is gone from the poll read.
//
// Every existing test feeds the read path a one-shot `mockResolvedValueOnce`,
// so a regression that wrote the row but never let the poll read it back (or
// an all-clear that logged but never flipped `clearedAt`) would slip through.
//
// To close that gap, this suite backs the controller with a STATEFUL
// in-memory EmergencyMessage / Tenant store. `create` writes a row,
// `findMany`/`findUnique` read the live store, `update` mutates it. The exact
// same store backs the writes (broadcast/SOS/media + all-clear) and the reads
// (GET /status user-session poll, GET /messages device-JWT poll), so an
// alert genuinely round-trips from dispatch to wall and back to cleared.
//
// Runtime emergency logic is NOT touched — this is test-only coverage of the
// already-shipped success path.
// ──────────────────────────────────────────────────────────────────────────

const SUPABASE_IMG = 'https://proj.supabase.co/storage/v1/object/public/media/alert.jpg';

interface MsgRow {
  id: string;
  tenantId: string;
  triggeredByUserId: string | null;
  type: string;
  severity: string;
  textBlob: string | null;
  mediaUrls: string | null;
  audioUrl: string | null;
  scopeType: string;
  scopeId: string;
  expiresAt: Date | null;
  createdAt: Date;
  clearedAt: Date | null;
  clearedByUserId: string | null;
}

/** Minimal but faithful Prisma-where evaluator for the fields the poll reads use. */
function rowMatches(row: MsgRow, where: any): boolean {
  if (!where) return true;
  if (where.tenantId !== undefined && row.tenantId !== where.tenantId) return false;
  if (where.clearedAt === null && row.clearedAt !== null) return false;
  if (where.scopeType !== undefined && row.scopeType !== where.scopeType) return false;
  if (where.scopeId !== undefined && row.scopeId !== where.scopeId) return false;

  // Top-level OR (expiry window): [{ expiresAt: null }, { expiresAt: { gt: now } }]
  if (Array.isArray(where.OR)) {
    const okExpiry = where.OR.some((clause: any) => {
      if (clause.expiresAt === null) return row.expiresAt === null;
      if (clause.expiresAt?.gt) return row.expiresAt !== null && row.expiresAt > clause.expiresAt.gt;
      return false;
    });
    if (!okExpiry) return false;
  }

  // AND[].OR — the device-poll per-scope membership filter.
  if (Array.isArray(where.AND)) {
    for (const andClause of where.AND) {
      if (Array.isArray(andClause.OR)) {
        const okScope = andClause.OR.some(
          (s: any) => s.scopeType === row.scopeType && s.scopeId === row.scopeId,
        );
        if (!okScope) return false;
      }
    }
  }
  return true;
}

describe('Emergency broadcast SUCCESS path (end-to-end, stateful)', () => {
  let controller: EmergencyController;
  let redisService: jest.Mocked<RedisService>;
  let signerService: any;
  let messages: MsgRow[];
  let tenants: Record<string, any>;

  beforeEach(async () => {
    messages = [];
    tenants = {
      t1: { id: 't1', emergencyStatus: 'INACTIVE', emergencyPlaylistId: null },
    };

    redisService = {
      publish: jest.fn().mockResolvedValue(true),
      sismember: jest.fn().mockResolvedValue(false),
    } as any;

    const emergencyMessage = {
      create: jest.fn().mockImplementation(({ data }: any) => {
        const row: MsgRow = {
          mediaUrls: null,
          audioUrl: null,
          textBlob: null,
          expiresAt: null,
          clearedAt: null,
          clearedByUserId: null,
          createdAt: new Date(),
          ...data,
        };
        messages.push(row);
        return Promise.resolve(row);
      }),
      findMany: jest.fn().mockImplementation(({ where }: any) => {
        const out = messages.filter((m) => rowMatches(m, where));
        out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return Promise.resolve(out);
      }),
      findUnique: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(messages.find((m) => m.id === where.id) || null),
      ),
      update: jest.fn().mockImplementation(({ where, data }: any) => {
        const row = messages.find((m) => m.id === where.id);
        if (row) Object.assign(row, data);
        return Promise.resolve(row);
      }),
      updateMany: jest.fn().mockImplementation(({ where, data }: any) => {
        const rows = messages.filter(
          (m) => m.id === where.id && (where.tenantId === undefined || m.tenantId === where.tenantId),
        );
        rows.forEach((row) => Object.assign(row, data));
        return Promise.resolve({ count: rows.length });
      }),
    };

    const prismaService: any = {
      client: {
        tenant: {
          findUnique: jest.fn().mockImplementation(({ where }: any) =>
            Promise.resolve(tenants[where.id] || null),
          ),
          // District fan-out (2026-08-03) — 't1' is a leaf school here.
          findMany: jest.fn().mockResolvedValue([]),
          update: jest.fn().mockResolvedValue({}),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        screen: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'kiosk1', tenantId: 't1', screenGroupId: null, status: 'ACTIVE',
          }),
          findMany: jest.fn().mockResolvedValue([]),
        },
        screenGroup: { findUnique: jest.fn().mockResolvedValue({ tenantId: 't1' }) },
        screenEmergencyOverride: {
          upsert: jest.fn().mockResolvedValue({}),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        playlist: { findFirst: jest.fn().mockResolvedValue({ id: 'pl-ok' }) },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
        emergencyMessage,
        // trigger/all-clear wrap writes in a $transaction (array or callback form).
        $transaction: jest.fn().mockImplementation((opsOrFn: any) => {
          if (typeof opsOrFn === 'function') return opsOrFn(prismaService.client);
          return Promise.all(opsOrFn);
        }),
      },
    };

    signerService = {
      signMessage: jest.fn().mockImplementation((type, payload) => ({
        type, payload, eventId: 'evt-' + type, timestamp: Date.now(), signature: 'sig',
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmergencyController],
      providers: [
        { provide: RedisService, useValue: redisService },
        { provide: PrismaService, useValue: prismaService },
        { provide: WebsocketSignerService, useValue: signerService },
        { provide: JwtService, useValue: { sign: jest.fn(), verifyAsync: jest.fn() } },
        { provide: WebhookDispatchService, useValue: { dispatch: jest.fn().mockResolvedValue(undefined) } },
        { provide: GpioService, useValue: { driveStatusLampForEmergency: jest.fn().mockResolvedValue({ touched: 0 }) } },
      ],
    }).compile();

    controller = module.get<EmergencyController>(EmergencyController);
  });

  const admin = { user: { id: 'admin1', role: 'SCHOOL_ADMIN', tenantId: 't1', schoolId: 't1' } };

  it('broadcast → /status shows it active → all-clear → /status is empty', async () => {
    // 1. Broadcast an alert. It must persist + sign + publish.
    const sent = await controller.broadcastText(
      { scopeType: 'tenant', scopeId: 't1', text: 'All staff to the gym', severity: 'WARN', durationMs: 120_000 } as any,
      admin,
    );
    expect(sent.success).toBe(true);
    expect(sent.messageId).toMatch(/^bcast_/);
    expect(signerService.signMessage).toHaveBeenCalledWith('TEXT_BROADCAST', expect.any(Object));
    expect(redisService.publish).toHaveBeenCalledWith('tenant:t1', expect.objectContaining({ type: 'TEXT_BROADCAST' }));

    // 2. The user-session poll read MUST now return it as active — proves the
    //    write actually landed in a row the read path can see.
    const live = await controller.status(admin, 't1');
    expect(live.active).toHaveLength(1);
    expect(live.active[0]).toEqual(
      expect.objectContaining({
        id: sent.messageId,
        type: 'TEXT_BROADCAST',
        severity: 'WARN',
        textBlob: 'All staff to the gym',
      }),
    );

    // 3. All-clear that exact message.
    const cleared = await controller.clearMessage(sent.messageId, admin);
    expect(cleared.success).toBe(true);
    expect(signerService.signMessage).toHaveBeenCalledWith(
      'ALL_CLEAR_MESSAGE',
      expect.objectContaining({ messageId: sent.messageId }),
    );

    // 4. The poll read MUST now be empty — proves all-clear flipped clearedAt
    //    in the same store the read filters on (regression guard for an
    //    all-clear that audit-logs but never actually clears).
    const after = await controller.status(admin, 't1');
    expect(after.active).toHaveLength(0);
  });

  it('SOS round-trips to BOTH the user-session /status and the device-JWT /messages poll', async () => {
    const teacher = { user: { id: 'teacher1', email: 'teacher@school.edu', role: 'CONTRIBUTOR', tenantId: 't1', schoolId: 't1' } };
    const sent = await controller.triggerSos({ location: 'Room 203' }, teacher);
    expect(sent.success).toBe(true);

    // User-session poll sees it.
    const userView = await controller.status(admin, 't1');
    expect(userView.active.map((m: any) => m.type)).toContain('SOS');

    // Device-JWT poll (the kiosk fallback tier) sees the SAME tenant-scoped row.
    const deviceView = await controller.deviceMessages({ user: { kind: 'device', sub: 'kiosk1' } });
    expect(deviceView.tenantId).toBe('t1');
    expect(deviceView.active).toHaveLength(1);
    expect(deviceView.active[0]).toEqual(
      expect.objectContaining({ id: sent.messageId, type: 'SOS', severity: 'CRITICAL' }),
    );
  });

  it('media-alert persists media urls and the poll read parses them back into an array', async () => {
    const sent = await controller.mediaAlert(
      {
        scopeType: 'tenant', scopeId: 't1',
        mediaUrls: [SUPABASE_IMG],
        textBlob: 'SHELTER IN PLACE',
        severity: 'CRITICAL',
      } as any,
      admin,
    );
    expect(sent.success).toBe(true);

    const live = await controller.status(admin, 't1');
    expect(live.active).toHaveLength(1);
    // mediaUrls is stored as a JSON string and must come back out as a real array
    // in the wire shape <EmergencyOverlay> parses.
    expect(live.active[0].mediaUrls).toEqual([SUPABASE_IMG]);
    expect(live.active[0].type).toBe('MEDIA_ALERT');
  });

  it('two active alerts both show, clearing one leaves the other active', async () => {
    const a = await controller.broadcastText(
      { scopeType: 'tenant', scopeId: 't1', text: 'Drill at noon', severity: 'WARN' } as any, admin,
    );
    const b = await controller.broadcastText(
      { scopeType: 'tenant', scopeId: 't1', text: 'Buses delayed', severity: 'INFO' } as any, admin,
    );

    expect((await controller.status(admin, 't1')).active).toHaveLength(2);

    await controller.clearMessage(a.messageId, admin);

    const remaining = (await controller.status(admin, 't1')).active;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(b.messageId);
  });

  it('an expired broadcast is NOT returned by the poll read', async () => {
    // Past expiry → write the row directly via the create mock, then read.
    await controller.broadcastText(
      {
        scopeType: 'tenant', scopeId: 't1', text: 'Old notice', severity: 'INFO',
        // expiresAt in the past (unix seconds) → controller sets expiresAtDate in the past.
        expiresAt: Math.floor((Date.now() - 60_000) / 1000),
      } as any,
      admin,
    );
    const live = await controller.status(admin, 't1');
    expect(live.active).toHaveLength(0);
  });
});
