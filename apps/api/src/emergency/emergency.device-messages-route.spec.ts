/**
 * GET /emergency/messages - the ROUTE around `deviceMessages` (2026-11-16).
 *
 * `device-messages-rev.spec.ts` proves the two passes against a model world.
 * This file proves the wiring on the REAL controller, on the shared targeting
 * world, with the real tenant emergency epoch and the real credential
 * request-context:
 *   - switch off (the default): the response is what the route always sent,
 *     through `res.json`, with no header of its own, and three reads a poll;
 *   - switch on for a bench list: only the listed screen changes;
 *   - switch on, request not verified by the interceptor: the same;
 *   - switch on, verified: a 304 that makes NO Prisma call, only for the exact
 *     ETag this process last sent that screen;
 *   - a real broadcast, a real tenant trigger and a real all-clear each reach
 *     the screen's next poll through a database read;
 *   - the same three sent from the DISTRICT reach a screen of every school
 *     below it at its next poll, and cost an unrelated organisation nothing.
 */
import { ForbiddenException } from '@nestjs/common';
import {
  makeWorld,
  DISTRICT,
  SCHOOL,
  districtAdmin,
  schoolAdmin,
  trigger,
  clear,
  type Row,
} from './emergency.targeting.world';
import {
  invalidateDeviceCredentialCache,
  publishDeviceCredentialState,
} from '../screens/device-auth';
import { resetManifestCacheForTests } from '../screens/manifest-hot-cache';
import { resetEmergencyRevForTests } from '../screens/emergency-rev';
import {
  DEVICE_MESSAGES_RECORD_MAX_AGE_MS,
  peekDeviceMessagesRecord,
  resetDeviceMessagesRevForTests,
} from './device-messages-rev';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

const T0 = Date.parse('2026-11-16T12:00:00.000Z');
const POLL_MS = 10_000;
const advance = (ms: number) => jest.setSystemTime(Date.now() + ms);

beforeEach(() => {
  // Only the clock is faked: the controller's own timers stay real.
  jest.useFakeTimers({
    now: T0,
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
  resetDeviceMessagesRevForTests();
  resetEmergencyRevForTests('origin-route');
  resetManifestCacheForTests();
  invalidateDeviceCredentialCache();
  delete process.env.EMERGENCY_MESSAGES_FAST_304;
});

afterEach(() => {
  jest.useRealTimers();
  delete process.env.EMERGENCY_MESSAGES_FAST_304;
});

function matches(row: Row, where: Row): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === 'OR') {
      if (!(v as Row[]).some((c) => matches(row, c))) return false;
      continue;
    }
    if (k === 'AND') {
      if (!(v as Row[]).every((c) => matches(row, c))) return false;
      continue;
    }
    const cell = row[k];
    if (v === null) {
      if (cell !== null && cell !== undefined) return false;
      continue;
    }
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const op = v as Row;
      if ('in' in op && !op.in.includes(cell)) return false;
      if ('has' in op && !(Array.isArray(cell) && cell.includes(op.has)))
        return false;
      if (
        'gt' in op &&
        !(cell instanceof Date && cell.getTime() > op.gt.getTime())
      )
        return false;
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
      const r = {
        createdAt: new Date(),
        clearedAt: null,
        mediaUrls: null,
        audioUrl: null,
        ...data,
      };
      rows.push(r);
      return r;
    }),
    findMany: jest.fn(async ({ where }: any) =>
      rows.filter((r) => matches(r, where)),
    ),
  });
  /** The three reads of one poll: the screen row, the messages, the tenant row. */
  const pollReads = () =>
    (w.client.screen.findUnique as jest.Mock).mock.calls.length +
    (w.client.emergencyMessage.findMany as jest.Mock).mock.calls.length +
    (w.client.tenant.findUnique as jest.Mock).mock.calls.length;

  const poll = async (
    screenId: string,
    opts: { verified?: boolean; etag?: string; liveRow?: Row | null } = {},
  ) => {
    const req: any = {
      user: { kind: 'device', sub: screenId },
      headers: opts.etag ? { 'if-none-match': opts.etag } : {},
    };
    if (opts.verified !== false) {
      // What the global DeviceIdentityInterceptor leaves on a request it verified.
      publishDeviceCredentialState(
        req,
        screenId,
        opts.liveRow === undefined
          ? (w.screens.get(screenId) ?? null)
          : opts.liveRow,
      );
    }
    const headers: Record<string, string> = {};
    const res: any = {
      statusCode: undefined as number | undefined,
      sent: undefined as string | undefined,
      json_: undefined as any,
    };
    res.setHeader = jest.fn((k: string, v: unknown) => {
      headers[k.toLowerCase()] = String(v);
      return res;
    });
    res.status = jest.fn((code: number) => {
      res.statusCode = code;
      return res;
    });
    res.end = jest.fn(() => res);
    res.send = jest.fn((b: string) => {
      res.sent = b;
      return res;
    });
    res.json = jest.fn((b: any) => {
      res.json_ = b;
      return res;
    });
    const before = pollReads();
    await w.emergency.deviceMessagesRoute(req, res);
    const body = res.sent !== undefined ? JSON.parse(res.sent) : res.json_;
    return { res, headers, reads: pollReads() - before, body };
  };

  /** Poll on the screen's cadence until the hot path answers; returns the ETag it holds. */
  const toHotPath = async (screenId: string): Promise<string> => {
    let etag: string | undefined;
    for (let i = 0; i < 4; i++) {
      const r = await poll(screenId, { etag });
      if (r.res.statusCode === 304) return etag as string;
      etag = r.headers.etag;
      advance(POLL_MS);
    }
    throw new Error(`screen ${screenId} never reached the hot path`);
  };

  /**
   * The same for several screens polling at the same instants, so that every
   * record is equally young when the test acts. (Reaching the hot path one
   * screen after another would age the first record past its maximum, and a
   * read forced by age proves nothing about the signal under test.)
   */
  const allToHotPath = async (
    screenIds: string[],
  ): Promise<Record<string, string>> => {
    const held: Record<string, string | undefined> = {};
    for (let round = 0; round < 4; round++) {
      let hot = 0;
      for (const id of screenIds) {
        const r = await poll(id, { etag: held[id] });
        if (r.res.statusCode === 304) hot++;
        else held[id] = r.headers.etag;
      }
      if (hot === screenIds.length) return held as Record<string, string>;
      advance(POLL_MS);
    }
    throw new Error(
      `screens ${screenIds.join(', ')} never all reached the hot path`,
    );
  };

  return { ...w, rows, poll, toHotPath, allToHotPath };
}

const send = (extra: Row = {}) =>
  ({
    scopeType: 'tenant',
    scopeId: SCHOOL,
    text: 'Early dismissal at 1 pm',
    severity: 'INFO',
    ...extra,
  }) as any;

const IDLE = {
  tenantId: SCHOOL,
  tenantStatus: 'INACTIVE',
  tenantPlaylistId: null,
  active: [],
};

describe('switch off (the default)', () => {
  it('answers what the route always answered, with no header of its own, reading the database every poll', async () => {
    const w = world();
    for (let i = 0; i < 3; i++) {
      const r = await w.poll('lobby', { etag: 'W/"m1.anything.atall"' });
      expect(r.res.status).toHaveBeenCalledWith(200);
      expect(r.res.json).toHaveBeenCalledTimes(1);
      expect(r.res.send).not.toHaveBeenCalled();
      expect(r.res.end).not.toHaveBeenCalled();
      expect(r.body).toEqual(IDLE);
      expect(r.headers).toEqual({});
      expect(r.reads).toBe(3);
      advance(POLL_MS);
    }
    expect(peekDeviceMessagesRecord('lobby')).toBeUndefined();
  });

  it('the body is the object `deviceMessages` returns, untouched', async () => {
    const w = world();
    await w.emergency.broadcastText(send(), schoolAdmin);
    const direct = await w.emergency.deviceMessages({
      user: { kind: 'device', sub: 'lobby' },
    } as any);
    const r = await w.poll('lobby');
    expect(r.body).toEqual(direct);
    expect(r.body.active).toHaveLength(1);
  });
});

describe('switch on for a bench list', () => {
  it('only the listed screen takes the hot path; the rest of the fleet is untouched', async () => {
    process.env.EMERGENCY_MESSAGES_FAST_304 = 'lobby';
    const w = world();
    const etag = await w.toHotPath('lobby');
    advance(POLL_MS);
    expect((await w.poll('lobby', { etag })).reads).toBe(0);
    for (let i = 0; i < 4; i++) {
      const r = await w.poll('gym-1');
      expect(r.res.json).toHaveBeenCalledTimes(1);
      expect(r.headers).toEqual({});
      expect(r.reads).toBe(3);
      advance(POLL_MS);
    }
    expect(peekDeviceMessagesRecord('gym-1')).toBeUndefined();
  });

  it.each(['1', 'true', 'yes'])(
    '%p is not a way to turn the fleet on',
    async (v) => {
      process.env.EMERGENCY_MESSAGES_FAST_304 = v;
      const w = world();
      for (let i = 0; i < 4; i++) {
        const r = await w.poll('lobby');
        expect(r.headers).toEqual({});
        expect(r.reads).toBe(3);
        advance(POLL_MS);
      }
    },
  );
});

describe('switch on', () => {
  beforeEach(() => {
    process.env.EMERGENCY_MESSAGES_FAST_304 = 'all';
  });

  it('a request the interceptor did not verify is answered the old way, every time', async () => {
    const w = world();
    for (let i = 0; i < 4; i++) {
      const r = await w.poll('lobby', { verified: false });
      expect(r.res.json).toHaveBeenCalledTimes(1);
      expect(r.headers).toEqual({});
      expect(r.reads).toBe(3);
      advance(POLL_MS);
    }
    expect(peekDeviceMessagesRecord('lobby')).toBeUndefined();
  });

  it('the first reads carry the ETag; once settled, a poll with that ETag makes no Prisma call', async () => {
    const w = world();

    const first = await w.poll('lobby');
    expect(first.reads).toBe(3);
    expect(first.res.status).toHaveBeenCalledWith(200);
    expect(first.res.send).toHaveBeenCalledTimes(1);
    expect(first.res.json).not.toHaveBeenCalled();
    expect(first.body).toEqual(IDLE);
    expect(first.headers.etag).toMatch(/^W\/"m1\.[0-9a-f]{20}\.[0-9a-f]{12}"$/);
    expect(first.headers['cache-control']).toBe('private, no-cache');
    expect(first.headers['content-type']).toBe(
      'application/json; charset=utf-8',
    );
    const etag = first.headers.etag;

    // One poll later: still inside the settle window of the first sighting,
    // so the record above was provisional and this is a database read too.
    advance(POLL_MS);
    const second = await w.poll('lobby', { etag });
    expect(second.reads).toBe(3);
    expect(second.headers.etag).toBe(etag);

    // From now on the hot path answers.
    advance(POLL_MS);
    const third = await w.poll('lobby', { etag });
    expect(third.reads).toBe(0);
    expect(third.res.status).toHaveBeenCalledWith(304);
    expect(third.res.end).toHaveBeenCalledTimes(1);
    expect(third.res.send).not.toHaveBeenCalled();
    expect(third.res.json).not.toHaveBeenCalled();
    expect(third.headers).toEqual({
      etag,
      'cache-control': 'private, no-cache',
    });

    // A client with nothing cached, or with someone else's ETag, is a read.
    advance(1000);
    expect((await w.poll('lobby')).reads).toBe(3);
    advance(1000);
    expect((await w.poll('lobby', { etag: 'W/"m1.0000.0000"' })).reads).toBe(3);
  });

  it('five polls in six are free while nothing moves', async () => {
    const w = world();
    const etag = await w.toHotPath('lobby');
    let reads = 0;
    let held = etag;
    for (let i = 0; i < 12; i++) {
      advance(POLL_MS);
      const r = await w.poll('lobby', { etag: held });
      reads += r.reads;
      if (r.headers.etag) held = r.headers.etag;
    }
    // 12 polls = 2 minutes = 2 records reaching DEVICE_MESSAGES_RECORD_MAX_AGE_MS.
    expect(DEVICE_MESSAGES_RECORD_MAX_AGE_MS).toBe(60_000);
    expect(reads).toBe(2 * 3);
  });

  it('a real broadcast is in the very next poll, under a new ETag', async () => {
    const w = world();
    const etag = await w.toHotPath('lobby');
    await w.emergency.broadcastText(send(), schoolAdmin);
    advance(POLL_MS);
    const r = await w.poll('lobby', { etag });
    expect(r.reads).toBe(3);
    expect(r.res.send).toHaveBeenCalledTimes(1);
    expect(r.body.active).toHaveLength(1);
    expect(r.body.active[0].type).toBe('TEXT_BROADCAST');
    expect(String(r.body.active[0].textBlob)).toContain('Early dismissal');
    expect(r.headers.etag).not.toBe(etag);
  });

  it('a real tenant lockdown, then its all-clear, each reach the next poll', async () => {
    const w = world();
    let etag = await w.toHotPath('lobby');

    const fired: any = await w.emergency.triggerEmergency(
      trigger('tenant', SCHOOL),
      schoolAdmin,
    );
    advance(POLL_MS);
    const raised = await w.poll('lobby', { etag });
    expect(raised.reads).toBeGreaterThanOrEqual(3);
    expect(raised.body.tenantStatus).not.toBe('INACTIVE');

    etag = await w.toHotPath('lobby');
    await w.emergency.clearEmergency(
      fired.overrideId,
      clear('tenant', SCHOOL),
      schoolAdmin,
    );
    advance(POLL_MS);
    const released = await w.poll('lobby', { etag });
    expect(released.reads).toBeGreaterThanOrEqual(3);
    expect(released.body.tenantStatus).toBe('INACTIVE');
  });

  it("a district-wide broadcast is in the next poll of a screen in every school below, and in the district's own", async () => {
    const w = world();
    const held = await w.allToHotPath([
      'lobby',
      'sib-1',
      'district-1',
      'other-1',
    ]);

    await w.emergency.broadcastText(
      send({ scopeId: DISTRICT, text: 'All schools: early release' }),
      districtAdmin,
    );
    advance(POLL_MS);
    // Young enough that only the signal, never the record's age, can force a read.
    for (const id of Object.keys(held)) {
      expect(Date.now() - peekDeviceMessagesRecord(id)!.readAt).toBeLessThan(
        DEVICE_MESSAGES_RECORD_MAX_AGE_MS / 2,
      );
    }

    for (const id of ['lobby', 'sib-1', 'district-1']) {
      const r = await w.poll(id, { etag: held[id] });
      expect(r.reads).toBeGreaterThanOrEqual(3);
      expect(r.res.send).toHaveBeenCalledTimes(1);
      expect(r.body.active).toHaveLength(1);
      expect(String(r.body.active[0].textBlob)).toContain('early release');
      expect(r.headers.etag).not.toBe(held[id]);
    }
    // Another organisation's screen is still answered from memory.
    const other = await w.poll('other-1', { etag: held['other-1'] });
    expect(other.reads).toBe(0);
    expect(other.res.status).toHaveBeenCalledWith(304);
  });

  it('a district-wide lockdown, then its all-clear, each reach the next poll of a school screen below', async () => {
    const w = world();
    let etag = await w.toHotPath('lobby');

    const fired: any = await w.emergency.triggerEmergency(
      trigger('tenant', DISTRICT),
      districtAdmin,
    );
    advance(POLL_MS);
    const raised = await w.poll('lobby', { etag });
    expect(raised.reads).toBeGreaterThanOrEqual(3);
    expect(raised.body.tenantId).toBe(SCHOOL);
    expect(raised.body.tenantStatus).not.toBe('INACTIVE');

    etag = await w.toHotPath('lobby');
    await w.emergency.clearEmergency(
      fired.overrideId,
      clear('tenant', DISTRICT),
      districtAdmin,
    );
    advance(POLL_MS);
    const released = await w.poll('lobby', { etag });
    expect(released.reads).toBeGreaterThanOrEqual(3);
    expect(released.body.tenantStatus).toBe('INACTIVE');
  });

  it("one school's broadcast costs a screen of another tenant nothing", async () => {
    const w = world();
    const etag = await w.toHotPath('other-1');
    await w.emergency.broadcastText(send(), schoolAdmin);
    advance(POLL_MS);
    const r = await w.poll('other-1', { etag });
    expect(r.reads).toBe(0);
    expect(r.res.status).toHaveBeenCalledWith(304);
  });

  it('a screen revoked since its snapshot gets the empty answer, the old way, and is forgotten', async () => {
    const w = world();
    await w.toHotPath('lobby');
    const stale = { ...w.screens.get('lobby')! };
    w.screens.get('lobby')!.status = 'REVOKED';
    advance(DEVICE_MESSAGES_RECORD_MAX_AGE_MS);
    const r = await w.poll('lobby', { liveRow: stale });
    expect(r.res.json).toHaveBeenCalledTimes(1);
    expect(r.body).toEqual({
      tenantId: null,
      tenantStatus: 'INACTIVE',
      tenantPlaylistId: null,
      active: [],
    });
    expect(r.headers).toEqual({});
    expect(peekDeviceMessagesRecord('lobby')).toBeUndefined();
  });
});

describe('the summary line', () => {
  const lines = (spy: jest.SpyInstance) =>
    spy.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.startsWith('[Emergency] device message poll'));

  it('is written about once every ten minutes while the switch is on, with counts only', async () => {
    process.env.EMERGENCY_MESSAGES_FAST_304 = 'all';
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const w = world();
      let held: string | undefined;
      // 61 polls, ten seconds apart: ten minutes of one idle screen.
      for (let i = 0; i <= 60; i++) {
        const r = await w.poll('lobby', { etag: held });
        if (r.headers.etag) held = r.headers.etag;
        advance(POLL_MS);
      }
      const written = lines(log);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatch(
        /last 10 min: \d+ answered from memory, \d+ read the database \(.+\), 0 had no revision$/,
      );
      const [, fromMemory, read] =
        /: (\d+) answered from memory, (\d+) read/.exec(
          written[0],
        ) as RegExpExecArray;
      // About five in six, and nothing identifying in the line.
      expect(Number(fromMemory)).toBeGreaterThanOrEqual(45);
      expect(Number(fromMemory) + Number(read)).toBe(60);
      expect(written[0]).not.toMatch(/lobby|school/);
    } finally {
      log.mockRestore();
    }
  });

  it('is never written while the switch is off', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const w = world();
      for (let i = 0; i <= 61; i++) {
        await w.poll('lobby');
        advance(POLL_MS);
      }
      expect(lines(log)).toEqual([]);
    } finally {
      log.mockRestore();
    }
  });
});

describe('either way', () => {
  it.each(['', 'all'])(
    'a caller that is not a device is refused (switch %p)',
    async (flag) => {
      if (flag) process.env.EMERGENCY_MESSAGES_FAST_304 = flag;
      const w = world();
      const res: any = {
        setHeader: jest.fn(),
        status: jest.fn(() => res),
        end: jest.fn(),
        send: jest.fn(),
        json: jest.fn(),
      };
      await expect(
        w.emergency.deviceMessagesRoute(
          {
            user: { id: 'u-school', role: 'SCHOOL_ADMIN', tenantId: SCHOOL },
            headers: {},
          } as any,
          res,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.setHeader).not.toHaveBeenCalled();
    },
  );
});
