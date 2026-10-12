/**
 * The closed loop (video guarantee steps 6/7, 2026-10-12) — owner decisions:
 *   A: 3 visibly stuttering, cached minutes on an original with a lighter copy
 *      → a sticky, audited demotion + a signed SYNC to that one screen (never
 *      a reload); "Try full quality again" clears it, audited, streak reset.
 *   B: a two-sided unit is recorded, never demoted.
 *   C: no lighter copy → keeps playing; tenant notification + platform alert,
 *      once per screen × file per day.
 *   Emergency content is never touched (fail-closed).
 */
import { PlaybackDemotionService, VIDEO_PLAYBACK_DEMOTED, VIDEO_PLAYBACK_DEMOTION_CLEARED, VIDEO_PLAYBACK_STUTTER_TWO_SIDED, VIDEO_PLAYBACK_STUTTER_UNRESOLVED } from './playback-demotion.service';
import { ingestFilePlayback } from './file-playback';

const T = 'tenant-a';
const S = 'screen-1';
const SHA = 'a'.repeat(64);
const COPY_SHA = 'b'.repeat(64);
const NOW = new Date('2026-10-12T12:00:00Z');

type Row = Record<string, any>;

function world(over: Partial<{
  screen: Row | null;
  faces: number;
  asset: Row | null;
  renditionAsset: Row | null;
  emergency: 'none' | 'protected' | 'throws';
  demotions: Row[];
  playback: Row[];
}> = {}) {
  const w = {
    screen: { id: S, name: 'Lobby 4K', faceOfScreenId: null, tenantId: T } as Row | null,
    faces: 0,
    asset: {
      id: 'asset-1', originalName: 'promo.mp4', fileUrl: 'https://cdn/promo.mp4', fileHash: SHA, fileSize: 40_000_000,
      mimeType: 'video/mp4',
      processingMeta: { renditions: { '1080p': { url: 'https://cdn/promo-1080.mp4', sha256: COPY_SHA, size: 4_000_000 } } },
    } as Row | null,
    renditionAsset: null as Row | null,
    emergency: 'none' as 'none' | 'protected' | 'throws',
    demotions: [] as Row[],
    playback: [{ screenId: S, tenantId: T, fileSha256: SHA, stutterAlertedAt: null, visibleBadStreak: 3, consecutiveBad: 3 }] as Row[],
    audits: [] as Row[],
    ...over,
  };
  const db: any = {
    screen: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where?.OR) return null; // emergency per-screen media / playlist lookups
        return w.screen && where.id === w.screen.id && where.tenantId === T ? w.screen : null;
      }),
      count: jest.fn(async () => w.faces),
    },
    asset: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.tenantId !== T) return null;
        if (where.fileHash) return w.asset && w.asset.fileHash === where.fileHash ? w.asset : null;
        if (where.id) return w.renditionAsset && w.renditionAsset.id === where.id ? w.renditionAsset : null;
        return null;
      }),
    },
    $queryRaw: jest.fn(async () => (w.renditionAsset ? [{ id: w.renditionAsset.id }] : [])),
    playlistItem: {
      findMany: jest.fn(async () => {
        if (w.emergency === 'throws') throw new Error('pool timeout');
        return [{ playlistId: 'pl-1' }];
      }),
    },
    playlist: { findFirst: jest.fn(async () => (w.emergency === 'protected' ? { id: 'pl-1' } : null)) },
    tenant: { findFirst: jest.fn(async () => null) },
    screenEmergencyOverride: { findFirst: jest.fn(async () => null) },
    emergencyMessage: { findFirst: jest.fn(async () => null) },
    screenPlaybackDemotion: {
      findFirst: jest.fn(async ({ where }: any) =>
        w.demotions.find((d) => (where.id ? d.id === where.id : true) && d.screenId === where.screenId && d.tenantId === where.tenantId && (where.sourceSha256 ? d.sourceSha256 === where.sourceSha256 : true) && !d.clearedAt) ?? null),
      findMany: jest.fn(async ({ where }: any) => w.demotions.filter((d) => d.screenId === where.screenId && d.tenantId === where.tenantId && !d.clearedAt)),
      create: jest.fn(async ({ data }: any) => {
        if (w.demotions.some((d) => d.screenId === data.screenId && d.sourceSha256 === data.sourceSha256 && !d.clearedAt)) {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        const row = { id: `dem-${w.demotions.length + 1}`, clearedAt: null, createdAt: NOW, ...data };
        w.demotions.push(row);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const d of w.demotions) if (d.id === where.id && d.screenId === where.screenId && d.tenantId === where.tenantId && !d.clearedAt) { Object.assign(d, data); count++; }
        return { count };
      }),
    },
    screenFilePlayback: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const r of w.playback) {
          if (r.screenId !== where.screenId || r.tenantId !== where.tenantId || r.fileSha256 !== where.fileSha256) continue;
          if (where.OR) {
            const cutoff = where.OR[1].stutterAlertedAt.lt as Date;
            if (!(r.stutterAlertedAt === null || r.stutterAlertedAt < cutoff)) continue;
          }
          Object.assign(r, data);
          count++;
        }
        return { count };
      }),
    },
    auditLog: { create: jest.fn(async ({ data }: any) => { w.audits.push(data); return data; }) },
  };
  db.$transaction = jest.fn(async (fn: any) => fn(db));
  const redis = { publish: jest.fn(async () => undefined) };
  const signer = { signMessage: jest.fn((type: string, payload: any) => JSON.stringify({ type, payload, signature: 'sig' })) };
  const notifications = { notify: jest.fn(async () => ({})) };
  const mailer = { sendAlert: jest.fn(async () => undefined) };
  const svc = new PlaybackDemotionService({ client: db } as any, redis as any, signer as any, notifications as any, mailer as any);
  return { w, db, redis, signer, notifications, mailer, svc };
}

const input = (over: Record<string, any> = {}) => ({
  screenId: S, tenantId: T, sha256: SHA, fileUrl: 'https://cdn/promo.mp4',
  sampleClass: 'bad' as const, visibleBadStreak: 3, unitConcurrentMax: 1, lastPct: 22.5, settledSamples: 3, now: NOW,
  ...over,
});

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
});

describe('PlaybackDemotionService.evaluate', () => {
  it('2 BAD minutes: nothing (no query at all); the 3rd demotes, audited, SYNC to that one screen', async () => {
    const { svc, db, w, redis, signer } = world();
    expect(await svc.evaluate(input({ visibleBadStreak: 2 }))).toEqual({ kind: 'none', why: 'below-threshold' });
    expect(db.screen.findFirst).not.toHaveBeenCalled();
    expect(await svc.evaluate(input())).toEqual({ kind: 'demote' });
    expect(w.demotions).toHaveLength(1);
    expect(w.demotions[0]).toMatchObject({ tenantId: T, screenId: S, sourceSha256: SHA, assetId: 'asset-1', fromRung: 'native', toRung: '1080p', reason: 'visible-stutter' });
    expect(w.audits.map((a) => a.action)).toEqual([VIDEO_PLAYBACK_DEMOTED]);
    expect(redis.publish).toHaveBeenCalledWith(`device:${S}`, expect.any(String));
    expect(signer.signMessage).toHaveBeenCalledWith('SYNC', expect.objectContaining({ screenId: S }));
    // never a reload command
    expect(signer.signMessage).not.toHaveBeenCalledWith('REFRESH_WEB', expect.anything());
  });

  it('a GOOD or ignored sample never acts, whatever the stored streak', async () => {
    const { svc, db } = world();
    expect((await svc.evaluate(input({ sampleClass: 'good', visibleBadStreak: 0 }))).kind).toBe('none');
    expect((await svc.evaluate(input({ sampleClass: 'ignored', visibleBadStreak: 5 }))).kind).toBe('none');
    expect(db.screen.findFirst).not.toHaveBeenCalled();
  });

  it('sticky: a 4th BAD minute does not create a second demotion or a second audit row', async () => {
    const { svc, w } = world();
    await svc.evaluate(input());
    expect(await svc.evaluate(input({ visibleBadStreak: 4 }))).toEqual({ kind: 'none', why: 'already-demoted' });
    expect(w.demotions).toHaveLength(1);
    expect(w.audits).toHaveLength(1);
  });

  it('a race on the partial unique index (P2002) is "already demoted", not an error', async () => {
    const { svc, w, db, redis } = world();
    w.demotions.push({ id: 'dem-x', tenantId: T, screenId: S, sourceSha256: SHA, clearedAt: null });
    db.screenPlaybackDemotion.findFirst.mockResolvedValueOnce(null); // the race: read said none
    expect(await svc.evaluate(input())).toEqual({ kind: 'demote' });
    expect(w.demotions).toHaveLength(1);
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it('emergency content is never touched — and a check that cannot run counts as emergency', async () => {
    for (const emergency of ['protected', 'throws'] as const) {
      const { svc, w, notifications } = world({ emergency });
      expect(await svc.evaluate(input())).toEqual({ kind: 'none', why: 'emergency' });
      expect(w.demotions).toHaveLength(0);
      expect(w.audits).toHaveLength(0);
      expect(notifications.notify).not.toHaveBeenCalled();
    }
  });

  it('B: a face of a double-sided unit is recorded (once a day), never demoted, no tenant notification', async () => {
    for (const shape of [{ faces: 1 }, { screen: { id: S, name: 'Back', faceOfScreenId: 'primary', tenantId: T } }]) {
      const { svc, w, notifications, mailer } = world(shape as any);
      expect(await svc.evaluate(input())).toEqual({ kind: 'record-two-sided' });
      expect(w.demotions).toHaveLength(0);
      expect(w.audits.map((a) => a.action)).toEqual([VIDEO_PLAYBACK_STUTTER_TWO_SIDED]);
      expect(notifications.notify).not.toHaveBeenCalled();
      expect(mailer.sendAlert).not.toHaveBeenCalled();
    }
  });

  it('C: no lighter copy → keeps playing; tenant notification + platform alert, once per screen × file per day', async () => {
    const { svc, w, notifications, mailer } = world();
    w.asset!.processingMeta = {};
    expect(await svc.evaluate(input())).toEqual({ kind: 'alert', reason: 'no-lighter-copy' });
    expect(w.demotions).toHaveLength(0);
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect((notifications.notify.mock.calls[0] as any[])[0]).toMatchObject({ tenantId: T, link: '/screens', dedupeKey: `video-stutter:${S}:${SHA}:2026-10-12` });
    expect(mailer.sendAlert).toHaveBeenCalledTimes(1);
    expect(w.audits.map((a) => a.action)).toEqual([VIDEO_PLAYBACK_STUTTER_UNRESOLVED]);
    // the next bad minute the same day: silent
    await svc.evaluate(input({ visibleBadStreak: 4, now: new Date(NOW.getTime() + 60_000) }));
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(mailer.sendAlert).toHaveBeenCalledTimes(1);
    // a day later: again
    await svc.evaluate(input({ visibleBadStreak: 900, now: new Date(NOW.getTime() + 24 * 3_600_000 + 1) }));
    expect(notifications.notify).toHaveBeenCalledTimes(2);
  });

  it('C: already on the 1080p copy → alert (already-lighter); concurrency → alert, never a demotion', async () => {
    const a = world({ asset: null, renditionAsset: { id: 'asset-1', fileUrl: 'https://cdn/promo.mp4', fileHash: 'c'.repeat(64), processingMeta: {} } });
    expect(await a.svc.evaluate(input({ sha256: COPY_SHA }))).toEqual({ kind: 'alert', reason: 'already-lighter' });
    const b = world();
    expect(await b.svc.evaluate(input({ unitConcurrentMax: 2 }))).toEqual({ kind: 'alert', reason: 'concurrency' });
    expect(b.w.demotions).toHaveLength(0);
  });

  it('VIDEO_PLAYBACK_DEMOTION=observe logs only; =off does nothing; env thresholds apply', async () => {
    process.env.VIDEO_PLAYBACK_DEMOTION = 'observe';
    const o = world();
    expect(await o.svc.evaluate(input())).toEqual({ kind: 'observe' });
    expect(o.w.demotions).toHaveLength(0);
    process.env.VIDEO_PLAYBACK_DEMOTION = 'off';
    const f = world();
    expect(await f.svc.evaluate(input())).toEqual({ kind: 'none', why: 'demotion-off' });
    delete process.env.VIDEO_PLAYBACK_DEMOTION;
    process.env.VIDEO_DEMOTION_STREAK = '5';
    const s = world();
    expect((await s.svc.evaluate(input({ visibleBadStreak: 4 }))).kind).toBe('none');
    expect((await s.svc.evaluate(input({ visibleBadStreak: 5 }))).kind).toBe('demote');
  });

  it('a screen of another tenant is never acted on', async () => {
    const { svc, w } = world();
    expect((await svc.evaluate(input({ tenantId: 'tenant-b' }))).kind).toBe('none');
    expect(w.demotions).toHaveLength(0);
  });
});

describe('PlaybackDemotionService.clear ("Try full quality again")', () => {
  it('clears, resets the streak and the alert claim, audits with the user, SYNCs the screen', async () => {
    const { svc, w, redis } = world({ demotions: [{ id: 'dem-1', tenantId: T, screenId: S, sourceSha256: SHA, assetId: 'asset-1', clearedAt: null }] });
    w.playback[0].stutterAlertedAt = NOW;
    expect(await svc.clear({ tenantId: T, screenId: S, demotionId: 'dem-1', userId: 'user-9' })).toEqual({ cleared: true, sourceSha256: SHA });
    expect(w.demotions[0].clearedAt).toBeInstanceOf(Date);
    expect(w.demotions[0].clearedByUserId).toBe('user-9');
    expect(w.playback[0]).toMatchObject({ visibleBadStreak: 0, consecutiveBad: 0, stutterAlertedAt: null });
    expect(w.audits).toEqual([expect.objectContaining({ action: VIDEO_PLAYBACK_DEMOTION_CLEARED, userId: 'user-9', targetId: S })]);
    expect(redis.publish).toHaveBeenCalledWith(`device:${S}`, expect.any(String));
  });

  it('404 for another tenant, another screen, or an already-cleared row — nothing written', async () => {
    for (const args of [
      { tenantId: 'tenant-b', screenId: S, demotionId: 'dem-1' },
      { tenantId: T, screenId: 'screen-2', demotionId: 'dem-1' },
      { tenantId: T, screenId: S, demotionId: 'nope' },
    ]) {
      const { svc, w } = world({ demotions: [{ id: 'dem-1', tenantId: T, screenId: S, sourceSha256: SHA, clearedAt: null }] });
      await expect(svc.clear({ ...args, userId: 'u' })).rejects.toMatchObject({ status: 404 });
      expect(w.demotions[0].clearedAt).toBeNull();
      expect(w.audits).toHaveLength(0);
    }
  });
});

describe('ingest → evaluate: only VISIBLE stutter, 3 in a row', () => {
  function ingestDb() {
    let row: Row | null = null;
    return {
      db: {
        $queryRaw: jest.fn(async () => [{ build: { model: 'M65GUQ', manufacturer: 'goodview', sdk: 30 }, siblings: 0 }]),
        screenFilePlayback: {
          findUnique: jest.fn(async () => row),
          upsert: jest.fn(async ({ create, update }: any) => {
            row = row ? { ...row, ...update } : { ...create };
            return { screenId: S };
          }),
        },
      } as any,
      row: () => row,
    };
  }
  const sample = (over: Record<string, any> = {}) => ({
    url: 'https://cdn/promo.mp4', sha256: SHA, totalFrames: 1800, droppedFrames: 0, stalls: 0, stalledMs: 0,
    cached: true, first: false, concurrent: 1, width: 3840, height: 2160, ...over,
  });
  const go = (db: any, s: any) => ingestFilePlayback(db, { screenId: S, tenantId: T, sample: s, playerVersionCode: 30, webviewMajor: 120, now: NOW });

  it('bad, bad, good, bad, bad → streak 2 (never demotes); a third consecutive bad → 3', async () => {
    const { db, row } = ingestDb();
    const seq = [sample({ droppedFrames: 900 }), sample({ droppedFrames: 900 }), sample({ droppedFrames: 3 }), sample({ droppedFrames: 900 }), sample({ droppedFrames: 900 })];
    let last: any = null;
    for (const s of seq) last = await go(db, s);
    expect(last.visibleBadStreak).toBe(2);
    expect(row()!.visibleBadStreak).toBe(2);
    last = await go(db, sample({ stalls: 1, stalledMs: 300 }));
    expect(last).toMatchObject({ visibleClass: 'bad', visibleBadStreak: 3 });
  });

  it('uncached, first-lap and short samples never move the streak; 4.9 % never counts', async () => {
    const { db } = ingestDb();
    await go(db, sample({ droppedFrames: 900 }));
    expect((await go(db, sample({ cached: false, droppedFrames: 1800, stalls: 9, stalledMs: 30_000 })))!.visibleBadStreak).toBe(1);
    expect((await go(db, sample({ first: true, droppedFrames: 900 })))!.visibleBadStreak).toBe(1);
    expect((await go(db, sample({ totalFrames: 900, droppedFrames: 900 })))!.visibleBadStreak).toBe(1);
    expect((await go(db, sample({ totalFrames: 2000, droppedFrames: 98 })))!).toMatchObject({ visibleClass: 'good', visibleBadStreak: 0 });
  });
});
