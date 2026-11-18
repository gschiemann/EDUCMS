/**
 * device-messages-rev - the device poll's "nothing changed" answer.
 *
 * Two halves. The first pins the algebra (revision, ETag, each refusal). The
 * second drives the two passes against a small world in which the REAL tenant
 * emergency epoch (`screens/emergency-rev.ts`) and the REAL tenant-state epoch
 * (`screens/manifest-hot-cache.ts`) are moved the way the emergency controller
 * moves them, a fake database commits when the test says so, and a fake
 * browser cache holds one representation per screen. Every case states what
 * the SCREEN ends up showing and how many database reads it cost.
 *
 * The rule under test, in one line: a 304 from memory may only ever tell a
 * screen something a database read at that instant would also have told it.
 */
import {
  DEVICE_MESSAGES_FAST_PATH_MAX_LISTED,
  DEVICE_MESSAGES_RECORD_MAX_AGE_MS,
  DEVICE_MESSAGES_SETTLE_MS,
  answerDeviceMessagesPoll,
  computeDeviceMessagesRev,
  deviceMessagesEtag,
  DEVICE_MESSAGES_STATS_EVERY_MS,
  noteDeviceMessagesWithoutRevision,
  takeDeviceMessagesStatsLine,
  deviceMessagesFastPathEnabled,
  deviceMessagesNotModified,
  earliestExpiryMs,
  isProvisionalRead,
  noteDeviceMessagesTenantInputs,
  peekDeviceMessagesRecord,
  recordDeviceMessagesRead,
  resetDeviceMessagesRevForTests,
  resolveDeviceMessagesRevision,
  type DeviceMessagesRevInputs,
} from './device-messages-rev';
import {
  bumpTenantEmergencyEpoch,
  emergencyRevOriginId,
  readTenantEmergencyEpoch,
  resetEmergencyRevForTests,
} from '../screens/emergency-rev';
import {
  invalidateTenantState,
  resetManifestCacheForTests,
  tenantStateEpoch,
} from '../screens/manifest-hot-cache';

const T0 = Date.parse('2026-11-16T12:00:00.000Z');
const POLL_MS = 10_000;

beforeEach(() => {
  jest.useFakeTimers({ now: T0 });
  resetDeviceMessagesRevForTests();
  resetEmergencyRevForTests('origin-a');
  resetManifestCacheForTests();
  delete process.env.EMERGENCY_MESSAGES_FAST_304;
});

afterEach(() => {
  jest.useRealTimers();
  delete process.env.EMERGENCY_MESSAGES_FAST_304;
});

const advance = (ms: number) => jest.setSystemTime(Date.now() + ms);

// ════════════════════════════════════════════════════════════════════════
// 1. The algebra
// ════════════════════════════════════════════════════════════════════════

describe('the switch', () => {
  const set = (v: string) => {
    process.env.EMERGENCY_MESSAGES_FAST_304 = v;
  };

  it('is off when unset or empty, for every screen', () => {
    expect(deviceMessagesFastPathEnabled('s1')).toBe(false);
    for (const v of ['', '   ', ',', ' , ']) {
      set(v);
      expect(deviceMessagesFastPathEnabled('s1')).toBe(false);
    }
  });

  it.each(['all', 'ALL', ' All '])('%p turns it on for every screen', (v) => {
    set(v);
    expect(deviceMessagesFastPathEnabled('s1')).toBe(true);
    expect(deviceMessagesFastPathEnabled('any-other-screen')).toBe(true);
  });

  it.each([
    '1',
    'true',
    'yes',
    'on',
    'enabled',
    'al',
    'alll',
    '*',
    'all all',
    'all,'.repeat(3),
  ])('FAILS CLOSED: %p is not the word that opens the fleet', (v) => {
    set(v);
    expect(deviceMessagesFastPathEnabled('s1')).toBe(false);
    expect(deviceMessagesFastPathEnabled('lobby')).toBe(false);
  });

  it('a list turns it on for exactly the listed screens', () => {
    set('bench-1, bench-2\n bench-3');
    for (const id of ['bench-1', 'bench-2', 'bench-3'])
      expect(deviceMessagesFastPathEnabled(id)).toBe(true);
    for (const id of ['bench-4', 'BENCH-1', 'bench', 'all', ''])
      expect(deviceMessagesFastPathEnabled(id)).toBe(false);
    expect(deviceMessagesFastPathEnabled(null)).toBe(false);
    expect(deviceMessagesFastPathEnabled(undefined)).toBe(false);
  });

  it('`all` beside a screen id is a list, never the fleet', () => {
    set('all, bench-1');
    expect(deviceMessagesFastPathEnabled('bench-1')).toBe(true);
    expect(deviceMessagesFastPathEnabled('lobby')).toBe(false);
  });

  it('honours at most the first 200 listed screens', () => {
    const ids = Array.from(
      { length: DEVICE_MESSAGES_FAST_PATH_MAX_LISTED + 5 },
      (_, i) => `s-${i}`,
    );
    set(ids.join(','));
    expect(
      deviceMessagesFastPathEnabled(
        `s-${DEVICE_MESSAGES_FAST_PATH_MAX_LISTED - 1}`,
      ),
    ).toBe(true);
    expect(
      deviceMessagesFastPathEnabled(
        `s-${DEVICE_MESSAGES_FAST_PATH_MAX_LISTED}`,
      ),
    ).toBe(false);
  });

  it('follows the variable when it changes', () => {
    set('bench-1');
    expect(deviceMessagesFastPathEnabled('bench-1')).toBe(true);
    set('bench-2');
    expect(deviceMessagesFastPathEnabled('bench-1')).toBe(false);
    delete process.env.EMERGENCY_MESSAGES_FAST_304;
    expect(deviceMessagesFastPathEnabled('bench-2')).toBe(false);
    set('all');
    expect(deviceMessagesFastPathEnabled('bench-1')).toBe(true);
  });
});

describe('the revision', () => {
  const base: DeviceMessagesRevInputs = {
    originId: 'o1',
    screenId: 's1',
    tenantId: 't1',
    groupId: 'g1',
    tenantEpochStamp: 1000,
    tenantStateEpoch: 7,
  };
  it('is stable for the same inputs and opaque', () => {
    const rev = computeDeviceMessagesRev(base);
    expect(computeDeviceMessagesRev({ ...base })).toBe(rev);
    expect(rev).toMatch(/^[0-9a-f]{20}$/);
    for (const part of ['o1', 's1', 't1', 'g1', '1000'])
      expect(rev).not.toContain(part);
  });
  it.each([
    ['a restart', { originId: 'o2' }],
    ['another screen', { screenId: 's2' }],
    ['a re-homed screen', { tenantId: 't2' }],
    ['a re-grouped screen', { groupId: 'g2' }],
    ['a screen taken out of its group', { groupId: null }],
    ['an emergency action on the tenant', { tenantEpochStamp: 1001 }],
    ['a tenant-state invalidation', { tenantStateEpoch: 8 }],
  ])('moves on %s', (_label, change) => {
    expect(
      computeDeviceMessagesRev({
        ...base,
        ...(change as Partial<DeviceMessagesRevInputs>),
      }),
    ).not.toBe(computeDeviceMessagesRev(base));
  });
  it('does not confuse adjacent fields', () => {
    const a = computeDeviceMessagesRev({
      ...base,
      screenId: 'ab',
      tenantId: 'c',
    });
    const b = computeDeviceMessagesRev({
      ...base,
      screenId: 'a',
      tenantId: 'bc',
    });
    expect(a).not.toBe(b);
  });
});

describe('the ETag', () => {
  it('is weak on the wire (the form that survives a compressing proxy), and two bodies under one revision never share one', () => {
    const one = deviceMessagesEtag('r', '{"active":[]}');
    const two = deviceMessagesEtag('r', '{"active":[1]}');
    expect(one).toMatch(/^W\/"m1\.r\.[0-9a-f]{12}"$/);
    expect(one).not.toBe(two);
    expect(deviceMessagesEtag('r', '{"active":[]}')).toBe(one);
    expect(deviceMessagesEtag('r2', '{"active":[]}')).not.toBe(one);
  });
});

describe('the earliest expiry', () => {
  it('is null when nothing expires', () => {
    expect(earliestExpiryMs([], T0)).toBeNull();
    expect(earliestExpiryMs([{ expiresAt: null }, {}], T0)).toBeNull();
  });
  it('is the smallest whole-second expiry, in ms', () => {
    expect(
      earliestExpiryMs(
        [{ expiresAt: 2000 }, { expiresAt: 1500 }, { expiresAt: null }],
        T0,
      ),
    ).toBe(1_500_000);
  });
  it.each(['soon', NaN, -5, 0, {}, Infinity])(
    'treats an unusable expiry (%p) as due now',
    (bad) => {
      expect(
        earliestExpiryMs(
          [{ expiresAt: 9_999_999_999 }, { expiresAt: bad }],
          T0,
        ),
      ).toBe(T0);
    },
  );
});

describe('a provisional read', () => {
  const settled = T0 - DEVICE_MESSAGES_SETTLE_MS;
  it('is one that began within the settle window of the first sighting', () => {
    expect(isProvisionalRead(T0, T0, 0)).toBe(true);
    expect(isProvisionalRead(T0, settled + 1, 0)).toBe(true);
    expect(isProvisionalRead(T0, settled, 0)).toBe(false);
  });
  it('or within the settle window of the epoch stamp, including a stamp in the future', () => {
    expect(isProvisionalRead(T0, settled, T0 - 1)).toBe(true);
    expect(isProvisionalRead(T0, settled, T0 + 60_000)).toBe(true);
    expect(isProvisionalRead(T0, settled, settled)).toBe(false);
  });
  it('never trusts a clock it cannot read', () => {
    expect(isProvisionalRead(NaN, settled, 0)).toBe(true);
    expect(isProvisionalRead(T0, NaN, 0)).toBe(true);
    expect(isProvisionalRead(T0, settled, NaN)).toBe(true);
  });
});

describe('the first sighting of a tenant', () => {
  it('is kept while the inputs stay the same and restarts when either moves', () => {
    expect(noteDeviceMessagesTenantInputs('t', 5, 1, T0)).toBe(T0);
    expect(noteDeviceMessagesTenantInputs('t', 5, 1, T0 + 500)).toBe(T0);
    expect(noteDeviceMessagesTenantInputs('t', 6, 1, T0 + 900)).toBe(T0 + 900);
    expect(noteDeviceMessagesTenantInputs('t', 6, 2, T0 + 950)).toBe(T0 + 950);
    expect(noteDeviceMessagesTenantInputs('other', 6, 2, T0 + 990)).toBe(
      T0 + 990,
    );
    expect(noteDeviceMessagesTenantInputs('t', 6, 2, T0 + 5000)).toBe(T0 + 950);
  });
});

describe('answering 304 from memory', () => {
  const rev = 'rev-1';
  const etag = deviceMessagesEtag(rev, '{}');
  const record = (
    over: Partial<Parameters<typeof recordDeviceMessagesRead>[0]> = {},
  ) =>
    recordDeviceMessagesRead({
      screenId: 's1',
      rev,
      etag,
      readAt: T0,
      boundaryAt: null,
      provisional: false,
      ...over,
    });
  const ask = (
    over: Partial<Parameters<typeof deviceMessagesNotModified>[0]> = {},
  ) =>
    deviceMessagesNotModified({
      screenId: 's1',
      rev,
      ifNoneMatch: etag,
      now: T0 + 1000,
      ...over,
    });

  it('is allowed for the exact representation, an unmoved revision and a settled, young record', () => {
    record();
    expect(ask()).toEqual({ ok: true, etag });
  });
  it('is refused with no record', () => {
    expect(ask()).toEqual({ ok: false, reason: 'no-record' });
  });
  it.each([undefined, null, '', 42, [etag], { etag }])(
    'is refused without one usable validator (%p)',
    (v) => {
      record();
      expect(ask({ ifNoneMatch: v })).toEqual({
        ok: false,
        reason: 'no-validator',
      });
    },
  );
  it('compares the way If-None-Match is defined to: the W/ prefix is ignored, the opaque tag must be equal', () => {
    record();
    const strongForm = etag.slice(2);
    expect(etag.startsWith('W/"')).toBe(true);
    // A proxy may hand the screen the tag with or without its W/ - same bytes either way.
    expect(ask({ ifNoneMatch: strongForm })).toEqual({ ok: true, etag });
    // ...and a record written from the strong form answers the weak one too.
    record({ etag: strongForm });
    expect(ask({ ifNoneMatch: etag })).toEqual({ ok: true, etag: strongForm });
  });
  it.each([
    ['another body', deviceMessagesEtag(rev, '{"x":1}')],
    ['a doubled prefix', `W/${etag}`],
    ['a list containing it', `${etag}, "other"`],
    ['the wildcard', '*'],
    ['the bare value without quotes', etag.slice(3, -1)],
    [
      'the tag Express would have made for the same body',
      'W/"2-vyGp6PvFo4RvsFtPoIWeCReyIC8"',
    ],
  ])('is refused for %s', (_label, v) => {
    record();
    expect(ask({ ifNoneMatch: v })).toEqual({
      ok: false,
      reason: 'different-representation',
    });
  });
  it('is refused once the revision has moved', () => {
    record();
    expect(ask({ rev: 'rev-2' })).toEqual({
      ok: false,
      reason: 'revision-moved',
    });
  });
  it('is refused on a provisional record, however fresh', () => {
    record({ provisional: true });
    expect(ask()).toEqual({ ok: false, reason: 'provisional' });
  });
  it('is refused when the clock is behind the record or unreadable', () => {
    record();
    expect(ask({ now: T0 - 1 })).toEqual({ ok: false, reason: 'clock' });
    expect(ask({ now: NaN })).toEqual({ ok: false, reason: 'clock' });
  });
  it('is refused from the instant the record reaches its maximum age', () => {
    record();
    expect(ask({ now: T0 + DEVICE_MESSAGES_RECORD_MAX_AGE_MS - 1 }).ok).toBe(
      true,
    );
    expect(ask({ now: T0 + DEVICE_MESSAGES_RECORD_MAX_AGE_MS })).toEqual({
      ok: false,
      reason: 'too-old',
    });
  });
  it('is refused from the instant a returned message expires', () => {
    record({ boundaryAt: T0 + 5000 });
    expect(ask({ now: T0 + 4999 }).ok).toBe(true);
    expect(ask({ now: T0 + 5000 })).toEqual({
      ok: false,
      reason: 'expiry-reached',
    });
  });
  it('is per screen', () => {
    record();
    expect(ask({ screenId: 's2' })).toEqual({ ok: false, reason: 'no-record' });
  });
});

// ════════════════════════════════════════════════════════════════════════
// 2. The two passes, in a world
// ════════════════════════════════════════════════════════════════════════

type Message = { id: string; scope: string; expiresAt: number | null };
type Body = {
  tenantId: string | null;
  tenantStatus: string;
  tenantPlaylistId: string | null;
  active: Message[];
};

/**
 * One tenant tree's worth of state, a database that only shows what has been
 * committed, and the controller's own signalling order.
 */
function makeWorld() {
  const committed = new Map<string, { status: string; messages: Message[] }>();
  const tenant = (id: string) => {
    if (!committed.has(id))
      committed.set(id, { status: 'INACTIVE', messages: [] });
    return committed.get(id)!;
  };
  /** screen -> where the LIVE row says it is. */
  const liveRow = new Map<
    string,
    { tenantId: string | null; groupId: string | null; status: string }
  >();
  /** screen -> where the verified credential snapshot says it is. */
  const snapshot = new Map<
    string,
    { tenantId: string | null; groupId: string | null; status: string } | null
  >();
  const place = (
    screenId: string,
    tenantId: string | null,
    groupId: string | null = null,
    status = 'ONLINE',
  ) => {
    liveRow.set(screenId, { tenantId, groupId, status });
    snapshot.set(screenId, { tenantId, groupId, status });
  };

  let reads = 0;
  let redisAnswers = true;
  const deps = { redis: null as any };

  const readLive = async (screenId: string): Promise<Body> => {
    reads += 1;
    const row = liveRow.get(screenId);
    if (!row || !row.tenantId || row.status === 'REVOKED') {
      return {
        tenantId: null,
        tenantStatus: 'INACTIVE',
        tenantPlaylistId: null,
        active: [],
      };
    }
    const t = tenant(row.tenantId);
    const nowSec = Date.now() / 1000;
    return {
      tenantId: row.tenantId,
      tenantStatus: t.status,
      tenantPlaylistId: null,
      active: t.messages
        .filter((m) => m.expiresAt === null || m.expiresAt > nowSec)
        .filter(
          (m) =>
            m.scope === 'tenant' ||
            m.scope === `group:${row.groupId}` ||
            m.scope === `device:${screenId}`,
        )
        .map((m) => ({ ...m })),
    };
  };

  /** A browser's private cache: one stored representation per screen. */
  const browser = new Map<string, { etag: string | null; body: Body }>();

  /** One poll, switch ON. Returns what the screen now shows and how the server answered. */
  const poll = async (
    screenId: string,
    opts: {
      enabled?: boolean;
      cache?: Map<string, { etag: string | null; body: Body }>;
    } = {},
  ) => {
    const cache = opts.cache ?? browser;
    const held = cache.get(screenId);
    const enabled = opts.enabled ?? true;
    const revision = enabled
      ? await resolveDeviceMessagesRevision({
          screenId,
          identity: snapshot.get(screenId) ?? null,
          readEpochStamp: async (tenantId, now) =>
            redisAnswers
              ? (await readTenantEmergencyEpoch(deps, tenantId, now)).stamp
              : null,
          tenantStateEpochOf: tenantStateEpoch,
          originId: emergencyRevOriginId(),
          now: Date.now(),
        })
      : null;
    const before = reads;
    const answer = await answerDeviceMessagesPoll<Body>({
      screenId,
      ifNoneMatch: held?.etag ?? undefined,
      revision,
      readLive: () => readLive(screenId),
    });
    if (answer.kind === 'fresh')
      cache.set(screenId, { etag: answer.etag, body: JSON.parse(answer.json) });
    else if (answer.kind === 'plain')
      cache.set(screenId, { etag: null, body: answer.body });
    return {
      kind: answer.kind,
      read: reads - before,
      shows: cache.get(screenId)!.body,
    };
  };

  /** Poll every `POLL_MS` until the settle window is behind us and the hot path holds. */
  const settle = async (screenId: string) => {
    for (let i = 0; i < 4; i++) {
      const r = await poll(screenId);
      if (r.kind === 'not-modified') return;
      advance(POLL_MS);
    }
    throw new Error(`screen ${screenId} never reached the hot path`);
  };

  // The controller's signalling, in the orders it really uses.
  const writers = {
    /** SOS / broadcast / media alert / message clear: commit, THEN bump. */
    messageWrite(
      tenantId: string,
      change: (t: { status: string; messages: Message[] }) => void,
    ) {
      change(tenant(tenantId));
      bumpTenantEmergencyEpoch(deps, tenantId);
    },
    /** Trigger / all-clear, first half: signal BEFORE the commit. */
    signalBeforeCommit(tenantId: string) {
      invalidateTenantState(tenantId);
      bumpTenantEmergencyEpoch(deps, tenantId);
    },
    commit(
      tenantId: string,
      change: (t: { status: string; messages: Message[] }) => void,
    ) {
      change(tenant(tenantId));
    },
    /** Trigger / all-clear, second half. */
    signalAfterCommit(tenantId: string) {
      invalidateTenantState(tenantId);
    },
  };

  return {
    place,
    liveRow,
    snapshot,
    tenant,
    poll,
    settle,
    writers,
    browser,
    reads: () => reads,
    setRedisAnswers: (v: boolean) => {
      redisAnswers = v;
    },
  };
}

const msg = (
  id: string,
  scope = 'tenant',
  expiresInMs: number | null = null,
): Message => ({
  id,
  scope,
  expiresAt:
    expiresInMs === null ? null : Math.floor((Date.now() + expiresInMs) / 1000),
});

describe('the device poll, switch off', () => {
  it('reads the database on every poll and remembers nothing', async () => {
    const w = makeWorld();
    w.place('s1', 'school');
    for (let i = 0; i < 5; i++) {
      const r = await w.poll('s1', { enabled: false });
      expect(r).toMatchObject({ kind: 'plain', read: 1 });
      advance(POLL_MS);
    }
    expect(peekDeviceMessagesRecord('s1')).toBeUndefined();
  });
});

describe('the device poll, switch on', () => {
  it('an idle screen pays for one poll in six', async () => {
    const w = makeWorld();
    w.place('s1', 'school');
    // Boot: the first two reads are inside the settle window of the first sighting.
    expect(await w.poll('s1')).toMatchObject({ kind: 'fresh', read: 1 });
    advance(POLL_MS);
    expect(await w.poll('s1')).toMatchObject({ kind: 'fresh', read: 1 });
    // From here: 5 polls from memory, then the record is a minute old.
    const kinds: string[] = [];
    const before = w.reads();
    for (let i = 0; i < 12; i++) {
      advance(POLL_MS);
      kinds.push((await w.poll('s1')).kind);
    }
    expect(kinds).toEqual([
      'not-modified',
      'not-modified',
      'not-modified',
      'not-modified',
      'not-modified',
      'fresh',
      'not-modified',
      'not-modified',
      'not-modified',
      'not-modified',
      'not-modified',
      'fresh',
    ]);
    expect(w.reads() - before).toBe(2);
  });

  it('a broadcast is on the screen at its very next poll', async () => {
    const w = makeWorld();
    w.place('s1', 'school');
    await w.settle('s1');
    w.writers.messageWrite('school', (t) => t.messages.push(msg('m1')));
    advance(POLL_MS);
    const r = await w.poll('s1');
    expect(r).toMatchObject({ kind: 'fresh', read: 1 });
    expect(r.shows.active.map((m) => m.id)).toEqual(['m1']);
  });

  it('a cleared message is gone at the very next poll, and stays gone', async () => {
    const w = makeWorld();
    w.place('s1', 'school');
    w.writers.messageWrite('school', (t) => t.messages.push(msg('m1')));
    await w.settle('s1');
    expect(w.browser.get('s1')!.body.active).toHaveLength(1);
    w.writers.messageWrite('school', (t) => {
      t.messages.length = 0;
    });
    for (let i = 0; i < 8; i++) {
      advance(POLL_MS);
      expect((await w.poll('s1')).shows.active).toEqual([]);
    }
  });

  it('a poll that lands between a commit and its bump is no later than one that landed just before the commit', async () => {
    const w = makeWorld();
    w.place('s1', 'school');
    await w.settle('s1');
    // The row is committed; the bump is the next statement and has not run yet.
    w.writers.commit('school', (t) => t.messages.push(msg('m1')));
    advance(1);
    await w.poll('s1');
    bumpTenantEmergencyEpoch({ redis: null as any }, 'school');
    advance(POLL_MS);
    expect((await w.poll('s1')).shows.active.map((m) => m.id)).toEqual(['m1']);
  });

  it('THE RACE: a read that lands before a trigger commits can never pin the old state', async () => {
    const w = makeWorld();
    w.place('s1', 'school');
    await w.settle('s1');
    // A trigger signals first, so the push is never behind the database...
    w.writers.signalBeforeCommit('school');
    // ...and a poll arrives in the gap, reading the state from before the commit.
    advance(50);
    const early = await w.poll('s1');
    expect(early).toMatchObject({ kind: 'fresh', read: 1 });
    expect(early.shows.tenantStatus).toBe('INACTIVE');
    // The commit lands. WORST CASE: nothing signals after it.
    w.writers.commit('school', (t) => {
      t.status = 'LOCKDOWN';
    });
    // The screen's next poll must be a database read, and must see the alert.
    advance(POLL_MS);
    const next = await w.poll('s1');
    expect(next).toMatchObject({ kind: 'fresh', read: 1 });
    expect(next.shows.tenantStatus).toBe('LOCKDOWN');
  });

  it('the same race with the post-commit invalidation the controller really sends', async () => {
    const w = makeWorld();
    w.place('s1', 'school');
    await w.settle('s1');
    w.writers.signalBeforeCommit('school');
    advance(50);
    expect((await w.poll('s1')).shows.tenantStatus).toBe('INACTIVE');
    w.writers.commit('school', (t) => {
      t.status = 'LOCKDOWN';
    });
    w.writers.signalAfterCommit('school');
    advance(POLL_MS);
    expect((await w.poll('s1')).shows.tenantStatus).toBe('LOCKDOWN');
  });

  it('an all-clear releases at the very next poll', async () => {
    const w = makeWorld();
    w.place('s1', 'school');
    w.writers.signalBeforeCommit('school');
    w.writers.commit('school', (t) => {
      t.status = 'LOCKDOWN';
    });
    w.writers.signalAfterCommit('school');
    await w.settle('s1');
    expect(w.browser.get('s1')!.body.tenantStatus).toBe('LOCKDOWN');
    w.writers.signalBeforeCommit('school');
    w.writers.commit('school', (t) => {
      t.status = 'INACTIVE';
    });
    w.writers.signalAfterCommit('school');
    advance(POLL_MS);
    expect((await w.poll('s1')).shows.tenantStatus).toBe('INACTIVE');
  });

  it('every poll while anything tenant-level is still settling is a database read', async () => {
    const w = makeWorld();
    w.place('s1', 'school');
    await w.settle('s1');
    w.writers.messageWrite('school', (t) => t.messages.push(msg('m1')));
    advance(1000);
    expect(await w.poll('s1')).toMatchObject({ kind: 'fresh', read: 1 });
    advance(DEVICE_MESSAGES_SETTLE_MS - 2000);
    // Still inside the window of the bump: the record above was provisional.
    expect(await w.poll('s1')).toMatchObject({ kind: 'fresh', read: 1 });
  });

  it('an expiry with no write at all takes the message down on time', async () => {
    const w = makeWorld();
    w.place('s1', 'school');
    w.writers.messageWrite('school', (t) =>
      t.messages.push(msg('m1', 'tenant', 45_000)),
    );
    const expiresAtMs = w.tenant('school').messages[0].expiresAt! * 1000;
    await w.settle('s1');
    expect(w.browser.get('s1')!.body.active).toHaveLength(1);
    // Poll until just before the expiry: memory may answer, the message stays.
    while (Date.now() + POLL_MS < expiresAtMs) {
      advance(POLL_MS);
      expect((await w.poll('s1')).shows.active).toHaveLength(1);
    }
    // First poll at or after the expiry: a database read, and the message is gone.
    jest.setSystemTime(expiresAtMs);
    const r = await w.poll('s1');
    expect(r).toMatchObject({ kind: 'fresh', read: 1 });
    expect(r.shows.active).toEqual([]);
  });

  it('a write nobody signalled is seen within the maximum record age', async () => {
    const w = makeWorld();
    w.place('s1', 'school');
    await w.settle('s1');
    const changedAt = Date.now();
    // Supabase Studio, a script, a future writer that forgot: no signal.
    w.writers.commit('school', (t) => t.messages.push(msg('silent')));
    let seenAt: number | null = null;
    for (let i = 0; i < 12 && seenAt === null; i++) {
      advance(POLL_MS);
      if ((await w.poll('s1')).shows.active.length === 1) seenAt = Date.now();
    }
    expect(seenAt).not.toBeNull();
    expect(seenAt! - changedAt).toBeLessThanOrEqual(
      DEVICE_MESSAGES_RECORD_MAX_AGE_MS + POLL_MS,
    );
  });

  it('a group message reaches the group and costs the rest of the tenant one extra read each', async () => {
    const w = makeWorld();
    w.place('gym-1', 'school', 'gym');
    w.place('lobby', 'school', null);
    await w.settle('gym-1');
    await w.settle('lobby');
    w.writers.messageWrite('school', (t) =>
      t.messages.push(msg('g1', 'group:gym')),
    );
    advance(POLL_MS);
    expect((await w.poll('gym-1')).shows.active.map((m) => m.id)).toEqual([
      'g1',
    ]);
    const lobby = await w.poll('lobby');
    expect(lobby).toMatchObject({ kind: 'fresh', read: 1 });
    expect(lobby.shows.active).toEqual([]);
  });

  it("one tenant's alert costs another tenant nothing", async () => {
    const w = makeWorld();
    w.place('a1', 'school-a');
    w.place('b1', 'school-b');
    await w.settle('a1');
    await w.settle('b1');
    w.writers.messageWrite('school-a', (t) => t.messages.push(msg('m1')));
    advance(POLL_MS);
    expect(await w.poll('a1')).toMatchObject({ kind: 'fresh', read: 1 });
    expect(await w.poll('b1')).toMatchObject({ kind: 'not-modified', read: 0 });
  });

  it('a re-grouped screen reads the database at once', async () => {
    const w = makeWorld();
    w.place('s1', 'school', 'gym');
    await w.settle('s1');
    w.place('s1', 'school', 'front');
    advance(POLL_MS);
    expect(await w.poll('s1')).toMatchObject({ kind: 'fresh', read: 1 });
  });

  it("a screen whose live row has left the snapshot's tenant is answered the old way and forgotten", async () => {
    const w = makeWorld();
    w.place('s1', 'school');
    await w.settle('s1');
    // Re-homed; the snapshot has not caught up (its invalidation failed).
    w.liveRow.set('s1', {
      tenantId: 'elsewhere',
      groupId: null,
      status: 'ONLINE',
    });
    w.writers.messageWrite('school', (t) => t.messages.push(msg('m1')));
    advance(POLL_MS);
    const r = await w.poll('s1');
    expect(r).toMatchObject({ kind: 'plain', read: 1 });
    expect(r.shows.tenantId).toBe('elsewhere');
    expect(r.shows.active).toEqual([]);
    expect(peekDeviceMessagesRecord('s1')).toBeUndefined();
  });

  it.each([
    ['no verified identity (a request that skipped the interceptor)', null],
    ['an unpaired screen', { tenantId: null, groupId: null, status: 'ONLINE' }],
    [
      'a revoked screen',
      { tenantId: 'school', groupId: null, status: 'REVOKED' },
    ],
  ])('%s never takes the hot path', async (_label, identity) => {
    const w = makeWorld();
    w.place('s1', 'school');
    w.snapshot.set('s1', identity);
    for (let i = 0; i < 4; i++) {
      expect(await w.poll('s1')).toMatchObject({ kind: 'plain', read: 1 });
      advance(POLL_MS);
    }
  });

  it('a slow Redis means a database read, not a wait and not a guess', async () => {
    const w = makeWorld();
    w.place('s1', 'school');
    await w.settle('s1');
    w.setRedisAnswers(false);
    advance(POLL_MS);
    expect(await w.poll('s1')).toMatchObject({ kind: 'plain', read: 1 });
  });

  it('a second copy of the page with an older body is not told "not modified"', async () => {
    const w = makeWorld();
    w.place('s1', 'school');
    const otherTab = new Map<string, { etag: string | null; body: Body }>();
    await w.poll('s1', { cache: otherTab });
    w.writers.messageWrite('school', (t) => t.messages.push(msg('m1')));
    await w.settle('s1');
    advance(POLL_MS);
    const r = await w.poll('s1', { cache: otherTab });
    expect(r.read).toBe(1);
    expect(r.shows.active.map((m) => m.id)).toEqual(['m1']);
  });

  it('a clock that steps backwards costs a database read', async () => {
    const w = makeWorld();
    w.place('s1', 'school');
    await w.settle('s1');
    jest.setSystemTime(Date.now() - 5 * 60_000);
    expect((await w.poll('s1')).read).toBe(1);
  });

  it('nothing survives a restart', async () => {
    const w = makeWorld();
    w.place('s1', 'school');
    await w.settle('s1');
    // A new process: empty memory, a new origin.
    resetDeviceMessagesRevForTests();
    resetEmergencyRevForTests('origin-b');
    resetManifestCacheForTests();
    advance(POLL_MS);
    expect(await w.poll('s1')).toMatchObject({ kind: 'fresh', read: 1 });
  });

  it('the revision a response is filed under is the one from before its read began', async () => {
    const w = makeWorld();
    w.place('s1', 'school');
    await w.settle('s1');
    advance(DEVICE_MESSAGES_RECORD_MAX_AGE_MS);
    // Pass 1 runs, then the tenant moves while the read is in flight.
    const revision = await resolveDeviceMessagesRevision({
      screenId: 's1',
      identity: w.snapshot.get('s1')!,
      readEpochStamp: async (t, now) =>
        (await readTenantEmergencyEpoch({ redis: null as any }, t, now)).stamp,
      tenantStateEpochOf: tenantStateEpoch,
      originId: emergencyRevOriginId(),
      now: Date.now(),
    });
    const answer = await answerDeviceMessagesPoll<Body>({
      screenId: 's1',
      ifNoneMatch: undefined,
      revision,
      readLive: async () => {
        w.writers.messageWrite('school', (t) => t.messages.push(msg('m1')));
        // The read itself still returns the state from before that write.
        return {
          tenantId: 'school',
          tenantStatus: 'INACTIVE',
          tenantPlaylistId: null,
          active: [],
        };
      },
    });
    expect(answer.kind).toBe('fresh');
    expect(peekDeviceMessagesRecord('s1')!.rev).toBe(revision!.rev);
    // So the next poll, under the moved revision, reads the database.
    if (answer.kind === 'fresh')
      w.browser.set('s1', { etag: answer.etag, body: JSON.parse(answer.json) });
    advance(POLL_MS);
    const r = await w.poll('s1');
    expect(r.read).toBe(1);
    expect(r.shows.active.map((m) => m.id)).toEqual(['m1']);
  });

  it('a throwing port is a database read', async () => {
    const revision = await resolveDeviceMessagesRevision({
      screenId: 's1',
      identity: { tenantId: 'school', groupId: null, status: 'ONLINE' },
      readEpochStamp: async () => {
        throw new Error('redis exploded');
      },
      tenantStateEpochOf: tenantStateEpoch,
      originId: emergencyRevOriginId(),
      now: Date.now(),
    });
    expect(revision).toBeNull();
  });

  it("an error from the live read is the caller's error, and nothing is remembered", async () => {
    const w = makeWorld();
    w.place('s1', 'school');
    await w.settle('s1');
    advance(DEVICE_MESSAGES_RECORD_MAX_AGE_MS);
    const before = peekDeviceMessagesRecord('s1');
    await expect(
      answerDeviceMessagesPoll<Body>({
        screenId: 's1',
        ifNoneMatch: undefined,
        revision: {
          rev: 'x',
          tenantId: 'school',
          now: Date.now(),
          provisional: false,
        },
        readLive: async () => {
          throw new Error('database down');
        },
      }),
    ).rejects.toThrow('database down');
    expect(peekDeviceMessagesRecord('s1')).toBe(before);
  });
});

describe('the summary line', () => {
  const revision = { rev: 'rev-1', tenantId: 't', now: T0, provisional: false };
  const body = { tenantId: 't', active: [] as Array<{ expiresAt?: unknown }> };
  const pollOnce = (ifNoneMatch: unknown, now: number) =>
    answerDeviceMessagesPoll({
      screenId: 's1',
      ifNoneMatch,
      revision: { ...revision, now },
      readLive: async () => body,
    });

  it('says nothing until its interval has passed, then counts memory answers and reads by reason, and starts over', async () => {
    expect(takeDeviceMessagesStatsLine(T0)).toBeNull(); // starts the clock
    const first = await pollOnce(undefined, T0); // no record yet
    const etag = first.kind === 'fresh' ? first.etag : '';
    await pollOnce(etag, T0 + 1000); // from memory
    await pollOnce(etag, T0 + 2000); // from memory
    await pollOnce('W/"someone-else"', T0 + 3000); // a read
    noteDeviceMessagesWithoutRevision();

    expect(
      takeDeviceMessagesStatsLine(T0 + DEVICE_MESSAGES_STATS_EVERY_MS - 1),
    ).toBeNull();
    const line = takeDeviceMessagesStatsLine(
      T0 + DEVICE_MESSAGES_STATS_EVERY_MS,
    );
    expect(line).toBe(
      '[Emergency] device message poll, last 10 min: 2 answered from memory, ' +
        '2 read the database (no-record 1, different-representation 1), 1 had no revision',
    );
    // Taken once: the counts are gone, and an idle interval says nothing.
    expect(
      takeDeviceMessagesStatsLine(T0 + 2 * DEVICE_MESSAGES_STATS_EVERY_MS),
    ).toBeNull();
  });

  it('names no screen, no tenant and no message', async () => {
    takeDeviceMessagesStatsLine(T0);
    await pollOnce(undefined, T0);
    const line =
      takeDeviceMessagesStatsLine(T0 + DEVICE_MESSAGES_STATS_EVERY_MS) ?? '';
    expect(line).not.toMatch(/s1|rev-1|"t"/);
    expect(line).toMatch(
      /^\[Emergency\] device message poll, last 10 min: 0 answered from memory, 1 read the database \(no-record 1\), 0 had no revision$/,
    );
  });

  it('does not count a poll that never had a revision (the switch is off for that screen)', async () => {
    takeDeviceMessagesStatsLine(T0);
    await answerDeviceMessagesPoll({
      screenId: 's1',
      ifNoneMatch: undefined,
      revision: null,
      readLive: async () => body,
    });
    expect(
      takeDeviceMessagesStatsLine(T0 + DEVICE_MESSAGES_STATS_EVERY_MS),
    ).toBeNull();
  });

  it('survives a clock that is unreadable or runs backwards', () => {
    expect(takeDeviceMessagesStatsLine(Number.NaN)).toBeNull();
    takeDeviceMessagesStatsLine(T0);
    expect(takeDeviceMessagesStatsLine(T0 - 5000)).toBeNull();
  });
});
