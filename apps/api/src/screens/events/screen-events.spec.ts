/**
 * The interruption ledger's pure rules (2026-10-18): vocabulary, bounds, the
 * summary the launch gate reads, and the transition detectors every writer
 * uses. No Nest, no database.
 */
import {
  LEDGER_DETAIL_MAX_BYTES,
  LEDGER_IDENTITY_DEDUP_MS,
  LEDGER_KINDS,
  LEDGER_KIND_LIST,
  NATIVE_START_DEDUP_MS,
  NATIVE_SWAP_WINDOW_MS,
  boundDetail,
  countsAsInterruption,
  isDrillRow,
  ledgerDedupKey,
  ledgerRow,
  ledgerToken,
  nativeEngineEvents,
  otaLedgerKind,
  otaStateEvent,
  procRelaunchEvent,
  summarizeLedger,
  summarizeLedgerRows,
  versionChangeEvent,
  type NativeVideoLike,
} from './screen-events';

const NOW = Date.parse('2026-10-18T12:00:00.000Z');
const SHA = 'a'.repeat(64);
const SHA2 = 'b'.repeat(64);
const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const ref = { screenId: 'scr-1', tenantId: 'ten-1', versionCode: 10141 };
const iso = (ms: number) => new Date(ms).toISOString();

describe('vocabulary', () => {
  it('names the fourteen kinds the plan asks for, and which of them count', () => {
    expect(LEDGER_KIND_LIST).toEqual([
      'page-reload', 'app-relaunch', 'engine-start', 'engine-stop', 'engine-swap', 'rendition-swap',
      'demotion', 'ota-download', 'ota-install', 'ota-installed', 'ota-needs-tap', 'ota-failed',
      'emergency-start', 'emergency-clear',
    ]);
    const informational = LEDGER_KIND_LIST.filter((k) => !LEDGER_KINDS[k].interruption);
    expect(informational).toEqual(['engine-start', 'ota-download', 'ota-installed', 'emergency-clear']);
  });

  it('tokens are short, lowercase and never empty', () => {
    expect(ledgerToken('FAILED_ABORTED')).toBe('failed_aborted');
    expect(ledgerToken('  Wedge Detector!! ')).toBe('wedge-detector');
    expect(ledgerToken('x'.repeat(200))).toHaveLength(64);
    expect(ledgerToken('')).toBe('unknown');
    expect(ledgerToken(null, 'failed')).toBe('failed');
  });
});

describe('detail is bounded to 2 KB', () => {
  it('a small object is stored as-is', () => {
    expect(boundDetail({ a: 1, b: 'x' })).toEqual({ a: 1, b: 'x' });
    expect(boundDetail(null)).toBeNull();
  });

  it('a large one keeps its scalar fields, marked truncated, and stays under the bound', () => {
    const out = boundDetail({ keep: 7, flag: true, big: 'y'.repeat(5000), nested: { deep: 'z'.repeat(5000) } })!;
    expect(out).toMatchObject({ truncated: true, keep: 7, flag: true });
    expect(out.nested).toBeUndefined();
    expect((out.big as string).length).toBe(120);
    expect(Buffer.byteLength(JSON.stringify(out))).toBeLessThanOrEqual(LEDGER_DETAIL_MAX_BYTES);
  });

  it('even thousands of fields stop at the bound', () => {
    const wide: Record<string, string> = {};
    for (let i = 0; i < 3000; i++) wide[`field${i}`] = 'v'.repeat(40);
    expect(Buffer.byteLength(JSON.stringify(boundDetail(wide)))).toBeLessThanOrEqual(LEDGER_DETAIL_MAX_BYTES);
  });
});

describe('a row', () => {
  it('needs a tenant (screen_events.tenant_id is NOT NULL) and a known kind', () => {
    expect(ledgerRow({ ...ref, tenantId: null, kind: 'page-reload', cause: 'operator', source: 'operator' })).toBeNull();
    expect(ledgerRow({ ...ref, kind: 'nope' as any, cause: 'x', source: 'device' })).toBeNull();
  });

  it('is dated on the server clock: never in the future, never more than 7 days back', () => {
    const now = new Date(NOW);
    expect(ledgerRow({ ...ref, kind: 'page-reload', cause: 'operator', source: 'operator', at: new Date(NOW + 60_000) }, now)!.createdAt.getTime()).toBe(NOW);
    expect(ledgerRow({ ...ref, kind: 'page-reload', cause: 'operator', source: 'operator', at: new Date(0) }, now)!.createdAt.getTime()).toBe(NOW - 7 * 86_400_000);
  });

  it('carries cause, source, session and build', () => {
    expect(ledgerRow({ ...ref, kind: 'engine-stop', cause: 'Activity-Paused', source: 'device', sessionId: S1 }, new Date(NOW))).toMatchObject({
      screenId: 'scr-1', tenantId: 'ten-1', kind: 'engine-stop', cause: 'activity-paused', source: 'device', sessionId: S1, versionCode: 10141,
    });
  });

  it('dedups per (screen, kind, session or cause) unless the writer names an identity', () => {
    expect(ledgerDedupKey({ ...ref, kind: 'page-reload', cause: 'operator', source: 'operator' })).toBe('scr-1:page-reload:operator');
    expect(ledgerDedupKey({ ...ref, kind: 'engine-stop', cause: 'x', source: 'device', sessionId: S1 })).toBe(`scr-1:engine-stop:${S1}`);
    expect(ledgerDedupKey({ ...ref, kind: 'ota-installed', cause: 'x', source: 'device', dedupKey: 'v1' })).toBe('scr-1:v1');
  });
});

describe('the summary the launch gate reads', () => {
  it('counts interruptions, leaves drills out and counts them apart', () => {
    const s = summarizeLedgerRows([
      { kind: 'page-reload', cause: 'operator' },
      { kind: 'app-relaunch', cause: 'reboot' },
      { kind: 'emergency-start', cause: 'lockdown', detail: { drill: true } },
      { kind: 'emergency-clear', cause: 'all-clear', detail: { drill: true } },
      { kind: 'emergency-start', cause: 'weather', detail: { drill: false } },
      { kind: 'engine-start', cause: 'native' },
      { kind: 'ota-download', cause: 'downloading' },
    ]);
    expect(s).toEqual({
      interruptions: 3,
      drills: 1,
      byKind: { 'page-reload': 1, 'app-relaunch': 1, 'emergency-start': 2, 'emergency-clear': 1, 'engine-start': 1, 'ota-download': 1 },
    });
  });

  it('an empty window is zero, not missing', () => {
    expect(summarizeLedger([], 0)).toEqual({ interruptions: 0, drills: 0, byKind: {} });
  });

  it('a native stop for a content change, an alert or an app restart already counted is not counted again', () => {
    for (const cause of ['content-changed', 'emergency-held', 'process-ended', 'device-rebooted']) {
      expect(countsAsInterruption({ kind: 'engine-stop', cause })).toBe(false);
    }
    expect(countsAsInterruption({ kind: 'engine-stop', cause: 'activity-paused' })).toBe(true);
    expect(countsAsInterruption({ kind: 'engine-stop', cause: 'output-stalled' })).toBe(true);
  });

  it('works from grouped counts exactly as from rows (the database shape)', () => {
    const s = summarizeLedger(
      [
        { kind: 'engine-stop', cause: 'activity-paused', count: 4 },
        { kind: 'engine-stop', cause: 'content-changed', count: 9 },
        { kind: 'emergency-start', cause: 'lockdown', count: 3 },
        { kind: 'refresh-acked', cause: null, count: 50 },
      ],
      2,
    );
    expect(s).toEqual({ interruptions: 4 + 3 - 2, drills: 2, byKind: { 'engine-stop': 13, 'emergency-start': 3 } });
  });

  it('can never report more drills than alert starts, nor a negative count', () => {
    expect(summarizeLedger([{ kind: 'emergency-start', cause: 'lockdown', count: 1 }], 5)).toEqual({
      interruptions: 0, drills: 1, byKind: { 'emergency-start': 1 },
    });
  });

  it('only an explicit drill: true is a drill', () => {
    expect(isDrillRow({ kind: 'emergency-start', detail: { drill: true } })).toBe(true);
    expect(isDrillRow({ kind: 'emergency-start', detail: { drill: 'true' } })).toBe(false);
    expect(isDrillRow({ kind: 'page-reload', detail: { drill: true } })).toBe(false);
  });
});

const native = (over: Partial<NativeVideoLike> = {}): NativeVideoLike => ({
  state: 'presenting', sessionId: S1, sha256: SHA, faceIndex: 0, ...over,
});
const stored = (nativeBlock: Record<string, unknown> | null, web: Record<string, unknown> = {}) => ({
  ...web,
  ...(nativeBlock ? { native: nativeBlock } : {}),
});

describe('native engine transitions (telemetry)', () => {
  const run = (storedReport: unknown, cur: NativeVideoLike | null, webSha: string | null = null) =>
    nativeEngineEvents({ ...ref, storedReport, native: cur, webSample: webSha ? { sha256: webSha } : null, nowMs: NOW });

  it('engine-start: when a session reaches presenting — kept once per face × file per 6 h (a mixed playlist starts one per item)', () => {
    const [ev] = run(null, native());
    expect(ev).toMatchObject({
      kind: 'engine-start', cause: 'native', sessionId: S1,
      dedupKey: `engine-start:0:${SHA.slice(0, 8)}`, dedupMs: NATIVE_START_DEDUP_MS,
    });
    expect(run(null, native({ sessionId: S2 }))[0].dedupKey).toBe(ev.dedupKey);
    expect(run(null, native({ faceIndex: 1 }))[0].dedupKey).not.toBe(ev.dedupKey);
    expect(run(stored({ sessionId: S1, state: 'presenting', sha256: SHA, at: iso(NOW - 60_000) }), native())).toEqual([]);
    expect(run(stored({ sessionId: S1, state: 'preparing', sha256: SHA, at: iso(NOW - 60_000) }), native())[0]).toMatchObject({ kind: 'engine-start' });
    expect(run(null, native({ state: 'preparing' }))).toEqual([]);
  });

  it('engine-swap web→native: the browser was playing this very file a moment ago', () => {
    const fresh = run(stored(null, { sha256: SHA, at: iso(NOW - 60_000) }), native());
    expect(fresh.map((e) => `${e.kind}:${e.cause}`)).toEqual(['engine-start:native', 'engine-swap:web-to-native']);
    expect(fresh[1]).toMatchObject({ dedupKey: `engine-swap:w2n:0:${SHA.slice(0, 8)}`, dedupMs: NATIVE_START_DEDUP_MS });
    // a stale web sample, or another file, is not a swap
    expect(run(stored(null, { sha256: SHA, at: iso(NOW - NATIVE_SWAP_WINDOW_MS - 1) }), native()).map((e) => e.kind)).toEqual(['engine-start']);
    expect(run(stored(null, { sha256: SHA2, at: iso(NOW) }), native()).map((e) => e.kind)).toEqual(['engine-start']);
    // native→native restart on the same file is a start, not a swap
    const restart = run(stored({ sessionId: S2, state: 'presenting', sha256: SHA, at: iso(NOW - 30_000) }, { sha256: SHA, at: iso(NOW - 30_000) }), native());
    expect(restart.map((e) => e.kind)).toEqual(['engine-start']);
  });

  it('engine-stop: a failed state, with the APK reason, once per session', () => {
    const [ev] = run(null, native({ state: 'failed', reason: 'output-stalled', elapsedMs: 5000 }));
    expect(ev).toMatchObject({ kind: 'engine-stop', cause: 'output-stalled', sessionId: S1, dedupMs: LEDGER_IDENTITY_DEDUP_MS });
    // the playlist moving on is not an interruption, and is not recorded
    expect(run(null, native({ state: 'failed', reason: 'content-changed' }))).toEqual([]);
    expect(run(stored({ sessionId: S1, state: 'failed', sha256: SHA, at: iso(NOW - 30_000) }), native({ state: 'failed' }))).toEqual([]);
  });

  it('engine-stop: each NEW entry of the persisted session history, dated inside what the server saw', () => {
    const prevAt = NOW - 120_000;
    const old = { at: NOW - 900_000, face: 0, reason: 'content-changed' };
    const prev = stored({ sessionId: S2, state: 'presenting', sha256: SHA, at: iso(prevAt), timing: { history: { entries: [old], overflow: 0 } } });
    const ended = { at: prevAt - 5_000, face: 0, reason: 'activity-paused', sha8: 'aaaaaaaa', elapsedMs: 900000, recovered: false };
    const moved = { at: prevAt + 1_000, face: 0, reason: 'content-changed', sha8: 'aaaaaaaa' };
    const evs = run(prev, native({ timing: { history: { entries: [old, ended, moved] } } }));
    const stops = evs.filter((e) => e.kind === 'engine-stop');
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ cause: 'activity-paused', sessionId: null, dedupKey: `engine-stop:h:0:${ended.at}` });
    // device clock before the previous report → clamped to it
    expect(stops[0].at!.getTime()).toBe(prevAt);
  });

  it('a first report is a baseline: history the server never saw end is not imported', () => {
    const evs = run(null, native({ timing: { history: { entries: [{ at: NOW - 5_000, face: 0, reason: 'activity-paused' }] } } }));
    expect(evs.map((e) => e.kind)).toEqual(['engine-start']);
  });

  it('engine-swap native→web: the browser now plays the file native was presenting', () => {
    const prev = stored({ sessionId: S1, state: 'presenting', sha256: SHA, faceIndex: 0, at: iso(NOW - 60_000) });
    expect(run(prev, null, SHA)).toEqual([
      expect.objectContaining({ kind: 'engine-swap', cause: 'native-to-web', sessionId: S1, dedupKey: `engine-swap:n2w:${S1}` }),
    ]);
    // still presenting natively → no swap; long gone → no swap; another file → no swap
    expect(run(prev, native(), SHA).map((e) => e.kind)).toEqual([]);
    expect(run(stored({ sessionId: S1, state: 'presenting', sha256: SHA, at: iso(NOW - NATIVE_SWAP_WINDOW_MS - 1) }), null, SHA)).toEqual([]);
    expect(run(prev, null, SHA2)).toEqual([]);
  });
});

describe('app relaunch (status heartbeat, native proc)', () => {
  const report = (pid: number, at: number, boot?: number) => ({ schema: 1, proc: { pid, at, ...(boot !== undefined ? { boot } : {}) } });
  const run = (prev: unknown, next: unknown, versionChanged = false) =>
    procRelaunchEvent({ ...ref, storedReport: prev, storedReportAt: new Date(NOW - 60_000), report: next, versionChanged, nowMs: NOW });

  it('a new boot count is a reboot', () => {
    expect(run(report(10, NOW - 9e6, 4), report(11, NOW - 30_000, 5))).toMatchObject({
      kind: 'app-relaunch', cause: 'reboot', dedupKey: `app-relaunch:11:${NOW - 30_000}`, detail: { bootFrom: 4, bootTo: 5 },
    });
  });

  it('a new process on the same boot is a restart — or an update install when the build moved too', () => {
    expect(run(report(10, NOW - 9e6, 4), report(12, NOW - 30_000, 4))!.cause).toBe('process-restart');
    expect(run(report(10, NOW - 9e6), report(12, NOW - 30_000), true)!.cause).toBe('update-install');
  });

  it('the same process, or no stored baseline, is nothing', () => {
    expect(run(report(10, NOW - 9e6, 4), report(10, NOW - 9e6, 4))).toBeNull();
    expect(run(null, report(10, NOW - 9e6, 4))).toBeNull();
    expect(run({ schema: 1 }, report(10, NOW - 9e6, 4))).toBeNull();
  });

  it('is dated at the process start, clamped after the last report the server saw', () => {
    expect(run(report(10, NOW - 9e6, 4), report(12, NOW - 30_000, 4))!.at!.getTime()).toBe(NOW - 30_000);
    expect(run(report(10, NOW - 9e6, 4), report(12, NOW - 9e6 + 1, 4))!.at!.getTime()).toBe(NOW - 60_000);
  });
});

describe('OTA state transitions', () => {
  it('maps the device states that touch the glass or the build', () => {
    expect(otaLedgerKind('DOWNLOADING')).toBe('ota-download');
    expect(otaLedgerKind('INSTALLING')).toBe('ota-install');
    expect(otaLedgerKind('NEEDS_TAP')).toBe('ota-needs-tap');
    for (const s of ['ERROR', 'RELAUNCH_BLOCKED', 'FAILED_ABORTED']) expect(otaLedgerKind(s)).toBe('ota-failed');
    for (const s of ['CHECKING', 'UP_TO_DATE', 'VERIFYING', 'INSTALLED']) expect(otaLedgerKind(s)).toBeNull();
  });

  it('only a transition writes a row (progress inside one state does not)', () => {
    const ev = (prev: string | null, state: string) =>
      otaStateEvent({ ...ref, previousState: prev, state, progress: 40, authenticated: false });
    expect(ev('CHECKING', 'DOWNLOADING')).toMatchObject({ kind: 'ota-download', cause: 'downloading', detail: { from: 'CHECKING', progress: 40, authenticated: false } });
    expect(ev('DOWNLOADING', 'DOWNLOADING')).toBeNull();
    expect(ev('INSTALLING', 'FAILED_ABORTED')).toMatchObject({ kind: 'ota-failed', cause: 'failed_aborted' });
  });
});

describe('a new Player build reported', () => {
  const ev = (prev: number | null, next: number | null, pushSatisfied = false) =>
    versionChangeEvent({ ...ref, previousCode: prev, reportedCode: next, versionName: '1.1.41', pushSatisfied });

  it('a changed version code is an install landing (a rollback says so)', () => {
    expect(ev(10129, 10141)).toMatchObject({ kind: 'ota-installed', cause: 'version-change', versionCode: 10141, dedupKey: 'ota-installed:10141', detail: { from: 10129, to: 10141 } });
    expect(ev(10141, 10129)!.detail).toMatchObject({ rollback: true });
  });

  it('the offered build running is one too, even when the stored version already moved', () => {
    expect(ev(10141, 10141, true)).toMatchObject({ cause: 'push-satisfied' });
  });

  it('the same build, a first report, or nothing reported is no row', () => {
    expect(ev(10141, 10141)).toBeNull();
    expect(ev(null, 10141)).toBeNull();
    expect(ev(10141, null)).toBeNull();
  });
});
