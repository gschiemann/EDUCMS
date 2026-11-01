/**
 * TARGETED BROADCASTS — "all screens, a group, or specific screens" (2026-10-31).
 *
 * `POST /emergency/broadcast` takes the same `scopeType` / `scopeId` as the
 * lockdown trigger. This suite drives the REAL controller against the shared
 * targeting world with a STATEFUL EmergencyMessage store and proves, per scope:
 *   - validation: a target outside the sender's subtree is refused and writes
 *     nothing (tenant isolation);
 *   - delivery: the screens that SEE the message through the device poll
 *     (`GET /emergency/messages`, the fallback tier) are exactly the chosen
 *     ones, and the push goes out on the chosen channel only;
 *   - clear: clearing removes it from exactly those screens and publishes the
 *     all-clear on the same channel.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  makeWorld, SCHOOL, DISTRICT, SIBLING, OTHER, GYM, SIB_GROUP, OTHER_GROUP,
  EVERY_SCREEN, schoolAdmin, districtAdmin,
} from './emergency.targeting.world';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

type Row = Record<string, any>;

/** The slice of Prisma's where-language the emergency message reads use. */
function matches(row: Row, where: Row): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === 'OR') { if (!(v as Row[]).some((c) => matches(row, c))) return false; continue; }
    if (k === 'AND') { if (!(v as Row[]).every((c) => matches(row, c))) return false; continue; }
    const cell = row[k];
    if (v === null) { if (cell !== null && cell !== undefined) return false; continue; }
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const op = v as Row;
      if ('in' in op && !op.in.includes(cell)) return false;
      if ('gt' in op && !(cell instanceof Date && cell.getTime() > op.gt.getTime())) return false;
      continue;
    }
    if (cell !== v) return false;
  }
  return true;
}

function world() {
  const w = makeWorld();
  const rows: Row[] = [];
  Object.assign(w.client.emergencyMessage, {
    create: jest.fn(async ({ data }: any) => {
      const r = { createdAt: new Date(), clearedAt: null, mediaUrls: null, audioUrl: null, ...data };
      rows.push(r);
      return r;
    }),
    findUnique: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
    findMany: jest.fn(async ({ where }: any) => rows.filter((r) => matches(r, where))),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    }),
  });
  const sees = async (screenId: string): Promise<string[]> => {
    const res: any = await w.emergency.deviceMessages({ user: { kind: 'device', sub: screenId } } as any);
    return res.active.map((m: Row) => m.id);
  };
  const seenBy = async (id: string) => {
    const out: string[] = [];
    for (const s of EVERY_SCREEN) if ((await sees(s)).includes(id)) out.push(s);
    return out.sort();
  };
  return { ...w, rows, seenBy };
}

const bcast = (scopeType: 'tenant' | 'group' | 'device', scopeId: string) =>
  ({ scopeType, scopeId, text: 'Assembly moved to 2 pm', severity: 'WARN' }) as any;

describe('targeted broadcast', () => {
  it('default (All screens) reaches every screen of the tenant, nothing outside it', async () => {
    const w = world();
    const r: any = await w.emergency.broadcastText(bcast('tenant', SCHOOL), schoolAdmin);
    expect(await w.seenBy(r.messageId)).toEqual(['back', 'front', 'gym-1', 'gym-2', 'lobby', 'office']);
    expect(w.published).toEqual([`tenant:${SCHOOL}`]);
  });

  it('a group reaches exactly that group', async () => {
    const w = world();
    const r: any = await w.emergency.broadcastText(bcast('group', GYM), schoolAdmin);
    expect(await w.seenBy(r.messageId)).toEqual(['gym-1', 'gym-2']);
    expect(w.published).toEqual([`group:${GYM}`]);
  });

  it('a single screen reaches exactly that screen', async () => {
    const w = world();
    const r: any = await w.emergency.broadcastText(bcast('device', 'lobby'), schoolAdmin);
    expect(await w.seenBy(r.messageId)).toEqual(['lobby']);
    expect(w.published).toEqual(['device:lobby']);
  });

  it('refuses a group or screen outside the sender subtree and writes nothing', async () => {
    const w = world();
    await expect(w.emergency.broadcastText(bcast('group', OTHER_GROUP), schoolAdmin)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(w.emergency.broadcastText(bcast('device', 'other-1'), schoolAdmin)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(w.emergency.broadcastText(bcast('group', SIB_GROUP), schoolAdmin)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(w.emergency.broadcastText(bcast('device', 'no-such-screen'), schoolAdmin)).rejects.toBeInstanceOf(NotFoundException);
    expect(w.rows).toHaveLength(0);
    expect(w.published).toHaveLength(0);
  });

  it('a district admin may aim at one screen of a school below, and no further', async () => {
    const w = world();
    const r: any = await w.emergency.broadcastText(bcast('device', 'gym-1'), districtAdmin);
    expect(await w.seenBy(r.messageId)).toEqual(['gym-1']);
    await expect(w.emergency.broadcastText(bcast('device', 'other-1'), districtAdmin)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('clearing a group broadcast clears exactly those screens and publishes on the same channel', async () => {
    const w = world();
    const grp: any = await w.emergency.broadcastText(bcast('group', GYM), schoolAdmin);
    const one: any = await w.emergency.broadcastText(bcast('device', 'lobby'), schoolAdmin);
    w.published.length = 0;

    await w.emergency.clearMessage(grp.messageId, schoolAdmin);
    expect(await w.seenBy(grp.messageId)).toEqual([]);
    expect(await w.seenBy(one.messageId)).toEqual(['lobby']);
    expect(w.published).toEqual([`group:${GYM}`]);
  });

  it("refuses to clear another school's message", async () => {
    const w = world();
    const r: any = await w.emergency.broadcastText(bcast('device', 'sib-1'), { user: { id: 'u-sib', role: 'SCHOOL_ADMIN', tenantId: SIBLING } });
    await expect(w.emergency.clearMessage(r.messageId, schoolAdmin)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await w.seenBy(r.messageId)).toEqual(['sib-1']);
  });

  it('a district admin can list and clear a broadcast aimed at one screen of a school below', async () => {
    const w = world();
    const r: any = await w.emergency.broadcastText(bcast('device', 'gym-1'), districtAdmin);
    const listed: any = await w.emergency.status(districtAdmin as any, DISTRICT);
    expect(listed.active.map((m: Row) => m.id)).toContain(r.messageId);

    await w.emergency.clearMessage(r.messageId, districtAdmin);
    expect(await w.seenBy(r.messageId)).toEqual([]);
    const after: any = await w.emergency.status(districtAdmin as any, DISTRICT);
    expect(after.active.map((m: Row) => m.id)).not.toContain(r.messageId);
  });

  it('a district admin cannot clear a message in another organisation', async () => {
    const w = world();
    const r: any = await w.emergency.broadcastText(bcast('device', 'other-1'), { user: { id: 'u-o', role: 'SCHOOL_ADMIN', tenantId: OTHER } });
    await expect(w.emergency.clearMessage(r.messageId, districtAdmin)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
