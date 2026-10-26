/**
 * CUSTOM MESSAGE → SPECIFIC SCREENS (2026-10-26).
 *
 * The owner, on site: "broadcast should let me pick displays if i want as well
 * and not have to hit them all." This suite pins the contract:
 *
 *   • each targeted screen gets the message — and ONLY those screens (a screen
 *     that was not picked, in the same school or any other, never sees it);
 *   • a double-sided display is reached WHOLE;
 *   • the audit row records the exact targets (what was picked, every pane that
 *     carries it, the tenants);
 *   • clearing ends exactly that set, from any member of it, and nothing else;
 *   • the authority gate is the one every other emergency write uses — checked
 *     for every tenant a chosen screen sits in, before anything is written;
 *   • the order is the one every message write uses: commit, THEN revision,
 *     THEN publish (the lesson of the 2026-10-26 drill: nothing a screen can
 *     read may run ahead of the committed state).
 *
 * Driven through the REAL controller against one stateful in-memory store, so
 * the poll a screen makes is answered by the rows the send actually wrote.
 */

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { EmergencyController } from './emergency.controller';
import { RedisService } from '../realtime/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { WebhookDispatchService } from '../webhooks/webhook-dispatch.service';
import { GpioService } from '../screens/gpio.service';
import { invalidateAncestorTenantIds } from './tenant-ancestors';
import { sendRootIdOf } from './message-targets';

const mockEvents: string[] = [];
jest.mock('../screens/emergency-rev', () => {
  const actual = jest.requireActual('../screens/emergency-rev');
  return {
    ...actual,
    bumpTenantEmergencyEpoch: jest.fn((...args: unknown[]) => {
      mockEvents.push('revision');
      return (actual.bumpTenantEmergencyEpoch as (...a: unknown[]) => unknown)(...args);
    }),
  };
});

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

const DISTRICT = 'district';
const SCHOOL_A = 'school-a';
const SCHOOL_B = 'school-b';
const OTHER_DISTRICT = 'other-district';
const OTHER_SCHOOL = 'other-school';

interface ScreenRow {
  id: string;
  name: string;
  tenantId: string;
  faceOfScreenId: string | null;
  screenGroupId: string | null;
  status: string;
}

describe('custom message → specific screens', () => {
  let controller: EmergencyController;
  let redis: { publish: jest.Mock; sismember: jest.Mock; setString: jest.Mock };
  let signer: { signMessage: jest.Mock };
  let prisma: any;
  let tenants: Map<string, { id: string; parentId: string | null; name: string; archivedAt: Date | null; emergencyStatus: string; emergencyPlaylistId: string | null }>;
  let screens: Map<string, ScreenRow>;
  let messages: any[];
  let auditLogs: any[];

  const tenant = (id: string, parentId: string | null) => ({
    id, parentId, name: id, archivedAt: null, emergencyStatus: 'INACTIVE', emergencyPlaylistId: null,
  });
  const screen = (id: string, tenantId: string, extra: Partial<ScreenRow> = {}): ScreenRow => ({
    id, name: id.toUpperCase(), tenantId, faceOfScreenId: null, screenGroupId: null, status: 'ONLINE', ...extra,
  });

  const idMatches = (value: any, clause: any): boolean => {
    if (clause === undefined) return true;
    if (clause && typeof clause === 'object') {
      if (Array.isArray(clause.in)) return clause.in.includes(value);
      if (typeof clause.startsWith === 'string') return typeof value === 'string' && value.startsWith(clause.startsWith);
    }
    return value === clause;
  };
  const messageMatches = (row: any, where: any): boolean => {
    if (!where) return true;
    for (const key of ['id', 'tenantId', 'scopeType', 'scopeId', 'type']) {
      if (where[key] !== undefined && !idMatches(row[key], where[key])) return false;
    }
    if (where.clearedAt === null && row.clearedAt != null) return false;
    if (where.expiresAt !== undefined) {
      if (where.expiresAt === null) {
        if (row.expiresAt != null) return false;
      } else if (where.expiresAt.gt !== undefined) {
        if (!(row.expiresAt instanceof Date) || row.expiresAt.getTime() <= where.expiresAt.gt.getTime()) return false;
      }
    }
    if (Array.isArray(where.OR) && !where.OR.some((c: any) => messageMatches(row, c))) return false;
    if (Array.isArray(where.AND) && !where.AND.every((c: any) => messageMatches(row, c))) return false;
    return true;
  };
  const screenMatches = (row: ScreenRow, where: any): boolean => {
    if (!where) return true;
    if (where.id !== undefined && !idMatches(row.id, where.id)) return false;
    if (where.tenantId !== undefined && !idMatches(row.tenantId, where.tenantId)) return false;
    if (where.faceOfScreenId !== undefined && !idMatches(row.faceOfScreenId, where.faceOfScreenId)) return false;
    if (where.screenGroupId !== undefined && !idMatches(row.screenGroupId, where.screenGroupId)) return false;
    if (Array.isArray(where.OR) && !where.OR.some((c: any) => screenMatches(row, c))) return false;
    return true;
  };

  beforeEach(async () => {
    mockEvents.length = 0;
    invalidateAncestorTenantIds();
    tenants = new Map([
      tenant(DISTRICT, null), tenant(SCHOOL_A, DISTRICT), tenant(SCHOOL_B, DISTRICT),
      tenant(OTHER_DISTRICT, null), tenant(OTHER_SCHOOL, OTHER_DISTRICT),
    ].map((t) => [t.id, t]));
    screens = new Map([
      screen('lobby', SCHOOL_A),
      screen('lobby-back', SCHOOL_A, { faceOfScreenId: 'lobby', name: 'LOBBY (BACK)' }),
      screen('gym', SCHOOL_A),
      screen('cafe', SCHOOL_A),
      screen('b-hall', SCHOOL_B),
      screen('b-gym', SCHOOL_B),
      screen('other-hall', OTHER_SCHOOL),
    ].map((s) => [s.id, s]));
    messages = [];
    auditLogs = [];

    redis = {
      publish: jest.fn(async (ch: string) => { mockEvents.push(`publish:${ch}`); return true; }),
      sismember: jest.fn().mockResolvedValue(false),
      setString: jest.fn().mockResolvedValue(undefined),
    };
    signer = {
      signMessage: jest.fn((type: string, payload: unknown) => ({
        type, payload, eventId: `evt-${type}`, timestamp: Date.now(), signature: 'sig',
      })),
    };
    prisma = {
      client: {
        tenant: {
          findUnique: jest.fn(async ({ where }: any) => { const t = tenants.get(where.id); return t ? { ...t } : null; }),
          findMany: jest.fn(async ({ where }: any) => {
            const out: any[] = [];
            for (const t of tenants.values()) {
              if (where?.parentId !== undefined && !idMatches(t.parentId, where.parentId)) continue;
              if (where?.id !== undefined && !idMatches(t.id, where.id)) continue;
              if (where?.archivedAt === null && t.archivedAt !== null) continue;
              out.push({ ...t });
            }
            return out;
          }),
        },
        screen: {
          findUnique: jest.fn(async ({ where }: any) => { const s = screens.get(where.id); return s ? { ...s } : null; }),
          findMany: jest.fn(async ({ where }: any) => [...screens.values()].filter((s) => screenMatches(s, where)).map((s) => ({ ...s }))),
        },
        screenGroup: { findMany: jest.fn(async () => []) },
        screenEmergencyOverride: { findMany: jest.fn(async () => []) },
        auditLog: { create: jest.fn(async ({ data }: any) => { auditLogs.push(data); return data; }) },
        emergencyMessage: {
          create: jest.fn(async ({ data }: any) => {
            const row = { clearedAt: null, clearedByUserId: null, createdAt: new Date(), ...data };
            messages.push(row);
            return row;
          }),
          findMany: jest.fn(async ({ where, take }: any = {}) => {
            const out = messages.filter((m) => messageMatches(m, where)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map((m) => ({ ...m }));
            return typeof take === 'number' ? out.slice(0, take) : out;
          }),
          findUnique: jest.fn(async ({ where }: any) => { const m = messages.find((x) => x.id === where.id); return m ? { ...m } : null; }),
          updateMany: jest.fn(async ({ where, data }: any) => {
            let count = 0;
            for (const m of messages) if (messageMatches(m, where)) { Object.assign(m, data); count++; }
            return { count };
          }),
        },
        $transaction: jest.fn(async (ops: any) => {
          const out = await Promise.all(ops);
          mockEvents.push('committed');
          return out;
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmergencyController],
      providers: [
        { provide: RedisService, useValue: redis },
        { provide: PrismaService, useValue: prisma },
        { provide: WebsocketSignerService, useValue: signer },
        { provide: JwtService, useValue: { sign: jest.fn(), verifyAsync: jest.fn() } },
        { provide: WebhookDispatchService, useValue: { dispatch: jest.fn().mockResolvedValue(undefined) } },
        { provide: GpioService, useValue: { driveStatusLampForEmergency: jest.fn().mockResolvedValue({ touched: 0 }) } },
      ],
    }).compile();
    controller = module.get(EmergencyController);
  });

  const districtAdmin = { user: { id: 'dadmin', role: 'DISTRICT_ADMIN', tenantId: DISTRICT, schoolId: DISTRICT } };
  const schoolAAdmin = { user: { id: 'aadmin', role: 'SCHOOL_ADMIN', tenantId: SCHOOL_A, schoolId: SCHOOL_A } };
  const schoolBAdmin = { user: { id: 'badmin', role: 'SCHOOL_ADMIN', tenantId: SCHOOL_B, schoolId: SCHOOL_B } };
  const otherDistrictAdmin = { user: { id: 'oadmin', role: 'DISTRICT_ADMIN', tenantId: OTHER_DISTRICT, schoolId: OTHER_DISTRICT } };

  const send = (req: any, screenIds: string[], extra: Record<string, unknown> = {}) =>
    controller.broadcastText(
      { scopeType: 'tenant', scopeId: req.user.tenantId, text: 'Assembly moved to 2 pm.', severity: 'INFO', screenIds, ...extra } as any,
      req,
    );
  const deviceReq = (screenId: string) => ({ user: { kind: 'device', sub: screenId } });
  const pollFor = async (screenId: string) => (await controller.deviceMessages(deviceReq(screenId))).active;
  const publishedChannels = () => redis.publish.mock.calls.map((c) => c[0] as string);

  // ── 1. each targeted screen gets it — and only those ─────────────────────

  describe('delivery', () => {
    it('two picked screens get the message; the third screen in the same school never sees it', async () => {
      const res = await send(schoolAAdmin, ['gym', 'cafe']);
      expect(res.success).toBe(true);
      expect(res.affectedScreenIds.sort()).toEqual(['cafe', 'gym']);
      expect(res.affectedScreenCount).toBe(2);

      expect(await pollFor('gym')).toHaveLength(1);
      expect(await pollFor('cafe')).toHaveLength(1);
      expect(await pollFor('lobby')).toEqual([]);
      expect(await pollFor('lobby-back')).toEqual([]);
      expect(await pollFor('b-hall')).toEqual([]);
      expect(await pollFor('other-hall')).toEqual([]);
    });

    it('the poll returns each screen the id ITS push carried (the player reconciles on it)', async () => {
      await send(schoolAAdmin, ['gym', 'cafe']);
      for (const id of ['gym', 'cafe']) {
        const pushed = signer.signMessage.mock.calls
          .filter((c) => c[0] === 'TEXT_BROADCAST')
          .map((c) => c[1])
          .find((p: any) => messages.find((m) => m.id === p.messageId)?.scopeId === id);
        const polled = await pollFor(id);
        expect(polled.map((m: any) => m.id)).toEqual([pushed.messageId]);
        expect(polled[0].textBlob).toBe('Assembly moved to 2 pm.');
        expect(polled[0].severity).toBe('INFO');
      }
    });

    it('publishes on each picked screen’s own channel, and on NO tenant or group channel', async () => {
      await send(schoolAAdmin, ['gym', 'cafe']);
      expect(publishedChannels().sort()).toEqual(['device:cafe', 'device:gym']);
      for (const [type] of signer.signMessage.mock.calls) expect(type).toBe('TEXT_BROADCAST');
    });

    it('a double-sided display is reached WHOLE, whichever side was picked', async () => {
      const res = await send(schoolAAdmin, ['lobby-back']);
      expect(res.affectedScreenIds.sort()).toEqual(['lobby', 'lobby-back']);
      expect(res.affectedScreenCount).toBe(1); // one DISPLAY
      expect(await pollFor('lobby')).toHaveLength(1);
      expect(await pollFor('lobby-back')).toHaveLength(1);
      expect(publishedChannels().sort()).toEqual(['device:lobby', 'device:lobby-back']);
    });

    it('a district admin can pick screens in two different schools — each row lives under its own school', async () => {
      const res = await send(districtAdmin, ['gym', 'b-hall']);
      expect(res.affectedTenantIds.sort()).toEqual([SCHOOL_A, SCHOOL_B]);
      expect(messages.map((m) => [m.scopeId, m.tenantId]).sort()).toEqual([['b-hall', SCHOOL_B], ['gym', SCHOOL_A]]);
      expect(await pollFor('gym')).toHaveLength(1);
      expect(await pollFor('b-hall')).toHaveLength(1);
      expect(await pollFor('b-gym')).toEqual([]);
    });

    it('returns a messageId that is a REAL row, and every row shares its send root', async () => {
      const res = await send(schoolAAdmin, ['gym', 'cafe']);
      expect(messages.map((m) => m.id)).toContain(res.messageId);
      for (const m of messages) expect(sendRootIdOf(m.id)).toBe(res.messageId);
    });

    it('stores the same text, severity and expiry on every row', async () => {
      await send(schoolAAdmin, ['gym', 'cafe'], { severity: 'CRITICAL', durationMs: 120_000 });
      expect(messages).toHaveLength(2);
      for (const m of messages) {
        expect(m).toMatchObject({ type: 'TEXT_BROADCAST', severity: 'CRITICAL', textBlob: 'Assembly moved to 2 pm.', scopeType: 'device' });
      }
      const [a, b] = messages;
      expect(a.expiresAt.getTime()).toBe(b.expiresAt.getTime());
      expect(a.expiresAt.getTime() - Date.now()).toBeGreaterThan(110_000);
    });

    it('a request WITHOUT screenIds is the tenant-wide send, unchanged', async () => {
      const res = await controller.broadcastText(
        { scopeType: 'tenant', scopeId: SCHOOL_A, text: 'Everyone', severity: 'WARN' } as any,
        schoolAAdmin,
      );
      expect(res.success).toBe(true);
      expect(publishedChannels()).toEqual([`tenant:${SCHOOL_A}`]);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ scopeType: 'tenant', scopeId: SCHOOL_A });
    });
  });

  // ── 2. the audit row ─────────────────────────────────────────────────────

  describe('audit', () => {
    it('ONE row records what was picked, every pane that carries it, and the names', async () => {
      const res = await send(schoolAAdmin, ['lobby-back', 'gym']);
      expect(auditLogs).toHaveLength(1);
      const row = auditLogs[0];
      expect(row).toMatchObject({ action: 'BROADCAST_TEXT', tenantId: SCHOOL_A, userId: 'aadmin', targetId: res.messageId });
      const details = JSON.parse(row.details);
      expect(details.messageId).toBe(res.messageId);
      expect(details.severity).toBe('INFO');
      expect(details.screenIds.sort()).toEqual(['gym', 'lobby-back']);
      expect(details.paneIds.sort()).toEqual(['gym', 'lobby', 'lobby-back']);
      expect(details.screenCount).toBe(2);
      expect(details.targets.map((t: any) => t.name).sort()).toEqual(['GYM', 'LOBBY']);
      expect(details.affectedTenantIds).toEqual([SCHOOL_A]);
    });

    it('a send across schools is audited under the sender’s own tenant, naming both', async () => {
      await send(districtAdmin, ['gym', 'b-hall']);
      expect(auditLogs[0].tenantId).toBe(DISTRICT);
      expect(JSON.parse(auditLogs[0].details).affectedTenantIds.sort()).toEqual([SCHOOL_A, SCHOOL_B]);
    });

    it('the rows and the audit row are written in ONE transaction', async () => {
      await send(schoolAAdmin, ['gym', 'cafe']);
      expect(prisma.client.$transaction).toHaveBeenCalledTimes(1);
      const ops = prisma.client.$transaction.mock.calls[0][0] as unknown[];
      expect(ops).toHaveLength(3); // 2 rows + 1 audit
    });
  });

  // ── 3. authority — checked for EVERY tenant, before any write ───────────

  describe('authority', () => {
    const noWrites = () => {
      expect(messages).toEqual([]);
      expect(auditLogs).toEqual([]);
      expect(redis.publish).not.toHaveBeenCalled();
      expect(prisma.client.$transaction).not.toHaveBeenCalled();
    };

    it('a school admin cannot reach a sibling school’s screen — and nothing at all is written', async () => {
      await expect(send(schoolAAdmin, ['gym', 'b-hall'])).rejects.toThrow(ForbiddenException);
      noWrites();
    });

    it('a school admin cannot name another district’s screen', async () => {
      await expect(send(schoolAAdmin, ['other-hall'])).rejects.toThrow(ForbiddenException);
      noWrites();
    });

    it('a district admin cannot reach into another district', async () => {
      await expect(send(districtAdmin, ['gym', 'other-hall'])).rejects.toThrow(ForbiddenException);
      noWrites();
      await expect(send(otherDistrictAdmin, ['gym'])).rejects.toThrow(ForbiddenException);
      noWrites();
    });

    it('naming someone else’s organisation as the sender is refused', async () => {
      await expect(
        controller.broadcastText({ scopeType: 'tenant', scopeId: SCHOOL_B, text: 'x', severity: 'INFO', screenIds: ['gym'] } as any, schoolAAdmin),
      ).rejects.toThrow(ForbiddenException);
      noWrites();
    });

    it('an id the database does not know is a 404 that names it — nothing is guessed or dropped', async () => {
      await expect(send(schoolAAdmin, ['gym', 'ghost-screen'])).rejects.toThrow(NotFoundException);
      await expect(send(schoolAAdmin, ['gym', 'ghost-screen'])).rejects.toThrow(/ghost-screen/);
      noWrites();
    });

    it('a screen with no tenant is a 400', async () => {
      screens.set('unpaired', { ...screen('unpaired', SCHOOL_A), tenantId: null as any });
      await expect(send(schoolAAdmin, ['unpaired'])).rejects.toThrow(BadRequestException);
      noWrites();
    });

    it('a super admin may name any screen', async () => {
      const superAdmin = { user: { id: 'root', role: 'SUPER_ADMIN', tenantId: DISTRICT, schoolId: DISTRICT } };
      const res = await send(superAdmin, ['gym', 'other-hall']);
      expect(res.affectedScreenIds.sort()).toEqual(['gym', 'other-hall']);
    });
  });

  // ── 4. ordering — nothing a screen can read runs ahead of the commit ────

  it('commit first, THEN the revision, THEN every publish', async () => {
    await send(schoolAAdmin, ['gym', 'cafe']);
    const committed = mockEvents.indexOf('committed');
    expect(committed).toBeGreaterThanOrEqual(0);
    const firstRevision = mockEvents.indexOf('revision');
    const firstPublish = mockEvents.findIndex((e) => e.startsWith('publish:'));
    expect(firstRevision).toBeGreaterThan(committed);
    expect(firstPublish).toBeGreaterThan(firstRevision);
    // …and nothing was published before the commit.
    expect(mockEvents.slice(0, committed).some((e) => e.startsWith('publish:'))).toBe(false);
  });

  it('one screen’s Redis failure does not stop the rest (the poll tier covers it)', async () => {
    redis.publish.mockImplementationOnce(async () => { throw new Error('redis down'); });
    const res = await send(schoolAAdmin, ['gym', 'cafe']);
    expect(res.success).toBe(true);
    expect(redis.publish).toHaveBeenCalledTimes(2);
    expect(await pollFor('gym')).toHaveLength(1);
    expect(await pollFor('cafe')).toHaveLength(1);
  });

  // ── 5. clearing clears exactly that set ──────────────────────────────────

  describe('clear', () => {
    it('the id the send returned ends the WHOLE set — and an unrelated send stays up', async () => {
      const first = await send(schoolAAdmin, ['gym', 'cafe']);
      const other = await send(schoolAAdmin, ['lobby']);
      redis.publish.mockClear();

      const res = await controller.clearMessage(first.messageId, schoolAAdmin);
      expect(res.success).toBe(true);
      expect(res.clearedMessageIds).toHaveLength(2);

      expect(await pollFor('gym')).toEqual([]);
      expect(await pollFor('cafe')).toEqual([]);
      // the other send is untouched
      expect(await pollFor('lobby')).toHaveLength(1);
      expect(await pollFor('lobby-back')).toHaveLength(1);
      expect(messages.filter((m) => sendRootIdOf(m.id) === other.messageId).every((m) => m.clearedAt === null)).toBe(true);
    });

    it('a clear from ANY member ends the same set', async () => {
      const first = await send(schoolAAdmin, ['gym', 'cafe']);
      const nonRoot = messages.find((m) => m.id !== first.messageId);
      expect(nonRoot).toBeTruthy();
      const res = await controller.clearMessage(nonRoot.id, schoolAAdmin);
      expect(res.clearedMessageIds.sort()).toEqual(messages.map((m) => m.id).sort());
      expect(await pollFor('gym')).toEqual([]);
    });

    it('publishes ALL_CLEAR_MESSAGE on each screen’s own channel, with THAT row’s id, after the commit', async () => {
      const first = await send(schoolAAdmin, ['gym', 'cafe']);
      mockEvents.length = 0;
      signer.signMessage.mockClear();
      redis.publish.mockClear();

      await controller.clearMessage(first.messageId, schoolAAdmin);
      expect(publishedChannels().sort()).toEqual(['device:cafe', 'device:gym']);
      const signed = signer.signMessage.mock.calls.filter((c) => c[0] === 'ALL_CLEAR_MESSAGE').map((c) => c[1].messageId).sort();
      expect(signed).toEqual(messages.map((m) => m.id).sort());

      const committed = mockEvents.indexOf('committed');
      expect(committed).toBeGreaterThanOrEqual(0);
      expect(mockEvents.slice(0, committed).some((e) => e.startsWith('publish:'))).toBe(false);
      expect(mockEvents.indexOf('revision')).toBeGreaterThan(committed);
    });

    it('the clear’s audit row names exactly the screens it ended', async () => {
      const first = await send(schoolAAdmin, ['gym', 'cafe']);
      auditLogs.length = 0;
      await controller.clearMessage(first.messageId, schoolAAdmin);
      expect(auditLogs).toHaveLength(1);
      const details = JSON.parse(auditLogs[0].details);
      expect(auditLogs[0].action).toBe('CLEAR_EMERGENCY_MESSAGE');
      expect(details.sendId).toBe(first.messageId);
      expect(details.clearedScreenIds.sort()).toEqual(['cafe', 'gym']);
      expect(details.clearedMessageIds).toHaveLength(2);
    });

    it('a double-sided display’s two panes clear together', async () => {
      const first = await send(schoolAAdmin, ['lobby']);
      expect(await pollFor('lobby-back')).toHaveLength(1);
      await controller.clearMessage(first.messageId, schoolAAdmin);
      expect(await pollFor('lobby')).toEqual([]);
      expect(await pollFor('lobby-back')).toEqual([]);
    });

    it('the district admin who sent to screens in two schools can end it (downward authority)', async () => {
      const first = await send(districtAdmin, ['gym', 'b-hall']);
      const res = await controller.clearMessage(first.messageId, districtAdmin);
      expect(res.clearedMessageIds).toHaveLength(2);
      expect(res.affectedTenantIds.sort()).toEqual([SCHOOL_A, SCHOOL_B]);
      expect(await pollFor('gym')).toEqual([]);
      expect(await pollFor('b-hall')).toEqual([]);
    });

    it('a school admin clearing a cross-school send ends ONLY their own school’s rows', async () => {
      const first = await send(districtAdmin, ['gym', 'b-hall']);
      const gymRow = messages.find((m) => m.scopeId === 'gym');
      const res = await controller.clearMessage(gymRow.id, schoolAAdmin);
      expect(res.clearedMessageIds).toEqual([gymRow.id]);
      expect(await pollFor('gym')).toEqual([]);
      expect(await pollFor('b-hall')).toHaveLength(1); // school B's copy is not theirs to clear
      expect(first.messageId).toBeTruthy();
    });

    it('a school admin cannot clear a message that sits in a sibling school', async () => {
      await send(districtAdmin, ['gym', 'b-hall']);
      const bRow = messages.find((m) => m.scopeId === 'b-hall');
      await expect(controller.clearMessage(bRow.id, schoolAAdmin)).rejects.toThrow(ForbiddenException);
      expect(messages.every((m) => m.clearedAt === null)).toBe(true);
    });

    it('another district’s admin cannot clear it', async () => {
      const first = await send(districtAdmin, ['gym']);
      await expect(controller.clearMessage(first.messageId, otherDistrictAdmin)).rejects.toThrow(ForbiddenException);
    });

    it('a single-screen message sent the old way (scopeType device) clears exactly as before', async () => {
      const res = await controller.broadcastText({ scopeType: 'device', scopeId: 'gym', text: 'Only the gym', severity: 'WARN' } as any, schoolAAdmin);
      expect(messages).toHaveLength(1);
      const cleared = await controller.clearMessage(res.messageId, schoolAAdmin);
      expect(cleared.clearedMessageIds).toEqual([res.messageId]);
    });
  });

  // ── 6. the operator's list ───────────────────────────────────────────────

  describe('GET /status (operator list)', () => {
    it('shows ONE entry per send, with its screens named, and an id that clears the set', async () => {
      const first = await send(schoolAAdmin, ['lobby', 'gym']);
      const status = await controller.status(schoolAAdmin, SCHOOL_A);
      expect(status.active).toHaveLength(1);
      const entry: any = status.active[0];
      expect(entry.sendId).toBe(first.messageId);
      expect(entry.targetScreenCount).toBe(2);
      expect(entry.targetScreens.map((s: any) => s.name).sort()).toEqual(['GYM', 'LOBBY']);
      expect(entry.textBlob).toBe('Assembly moved to 2 pm.');
      const cleared = await controller.clearMessage(entry.id, schoolAAdmin);
      expect(cleared.clearedMessageIds).toHaveLength(3); // lobby + lobby-back + gym
    });

    it('the district admin sees a send that lives under the schools below them', async () => {
      await send(districtAdmin, ['gym', 'b-hall']);
      const status = await controller.status(districtAdmin, DISTRICT);
      expect(status.active).toHaveLength(1);
      expect((status.active[0] as any).targetScreenCount).toBe(2);
    });

    it('a school admin does not see another school’s rows', async () => {
      await send(districtAdmin, ['b-hall']);
      const status = await controller.status(schoolAAdmin, SCHOOL_A);
      expect(status.active).toEqual([]);
    });

    it('a device principal still gets plain per-row views (no grouping)', async () => {
      await send(schoolAAdmin, ['gym', 'cafe']);
      const status = await controller.status({ user: { kind: 'device', sub: 'gym', tenantId: SCHOOL_A } }, SCHOOL_A);
      expect(status.active).toHaveLength(1);
      expect((status.active[0] as any).sendId).toBeUndefined();
    });

    it('a cleared send leaves the list', async () => {
      const first = await send(schoolAAdmin, ['gym']);
      await controller.clearMessage(first.messageId, schoolAAdmin);
      expect((await controller.status(schoolAAdmin, SCHOOL_A)).active).toEqual([]);
    });
  });
});
