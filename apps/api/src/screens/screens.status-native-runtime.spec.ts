jest.mock('../security/required-secret', () => ({
  requireSecret: (_n: string, o?: { devFallback?: string }) =>
    o?.devFallback ?? 'test_secret',
}));

import { ScreensController } from './screens.controller';
import { invalidateDeviceCredentialCache } from './device-auth';

const issued = new Date();
const runtime = {
  schema: 1,
  interactive: false,
  foreground: false,
  standbySinceMs: Date.now() - 60_000,
  elapsedRealtimeMs: 123456,
  powerOnAck: null,
};

function harness(proved = true, paired = true, id = 'wall') {
  const row = {
    id,
    nativeRuntimeReport: null as unknown,
    playerVersion: '1.1.24',
    playerVersionCode: 10124,
    tenantId: paired ? 'cleveland' : null,
    deviceFingerprint: 'android-wall',
    nativePowerOnAt: issued as Date | null,
    pairingCode: null,
    faceOfScreenId: null,
    forceApkUpdatePendingAt: null,
  };
  const screen = {
    findUnique: jest.fn().mockResolvedValue(row),
    update: jest
      .fn<Promise<typeof row>, [input: { data: Record<string, unknown> }]>()
      .mockResolvedValue(row),
    count: jest.fn().mockResolvedValue(0),
  };
  const auditLog = { create: jest.fn(async () => ({})) };
  const controller = new ScreensController(
    { client: { screen, auditLog } } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  jest
    .spyOn(
      controller as unknown as {
        heartbeatProvesDevice: () => Promise<{
          presented: boolean;
          proved: boolean;
        }>;
      },
      'heartbeatProvesDevice',
    )
    .mockResolvedValue({ presented: proved, proved });
  return { row, screen, controller, auditLog };
}

function poll(
  controller: ScreensController,
  header: unknown = JSON.stringify(runtime),
) {
  return controller.deviceStatus('android-wall', '1.1.24', '10124', undefined, {
    headers: { 'x-venueos-native-runtime': header },
  });
}

beforeEach(() => invalidateDeviceCredentialCache());

describe('native heartbeat wake backstop', () => {
  it('delivers an operator power-on with the web player suspended, without inventing render proof', async () => {
    const { controller, screen } = harness();
    expect(await poll(controller)).toMatchObject({
      nativeControl: { powerOnRequestedAt: issued.toISOString() },
    });
    const data = screen.update.mock.calls[0][0].data;
    expect(data.nativeRuntimeReport).toEqual(runtime);
    expect(data.nativeRuntimeReportAt).toBeInstanceOf(Date);
    expect(data).not.toHaveProperty('lastRenderedAt');
    expect(data).not.toHaveProperty('lastCacheReportAt');
  });
  it('withholds power intent and runtime writes from anonymous or unpaired callers', async () => {
    for (const [proved, paired] of [
      [false, true],
      [true, false],
    ]) {
      const { controller, screen } = harness(proved, paired);
      expect(await poll(controller)).not.toHaveProperty('nativeControl');
      for (const call of screen.update.mock.calls)
        expect(call[0].data).not.toHaveProperty('nativeRuntimeReport');
    }
  });
  it('withholds the command from old clients and malformed reports', async () => {
    const { controller } = harness();
    expect(await poll(controller, '{}')).not.toHaveProperty('nativeControl');
    expect(await poll(controller, null)).not.toHaveProperty('nativeControl');
  });
  it('acknowledges by identity without clearing a concurrently replaced wake', async () => {
    const { controller, screen } = harness();
    const result = await poll(
      controller,
      JSON.stringify({
        ...runtime,
        interactive: true,
        foreground: true,
        powerOnAck: issued.toISOString(),
      }),
    );
    expect(result).toMatchObject({
      nativeControl: { powerOnRequestedAt: null },
    });
    expect(screen.update.mock.calls[0][0].data).not.toHaveProperty(
      'nativePowerOnAt',
    );
  });
  it('never replays an expired wake or an absent wake on an ordinary heartbeat', async () => {
    const { controller, row } = harness();
    row.nativePowerOnAt = new Date(Date.now() - 300_000);
    expect(await poll(controller)).toMatchObject({
      nativeControl: { powerOnRequestedAt: null },
    });
    row.nativePowerOnAt = null;
    expect(await poll(controller)).toMatchObject({
      nativeControl: { powerOnRequestedAt: null },
    });
  });
});

describe('native heartbeat write debounce (review P2, 2026-10-10)', () => {
  it('an unchanged report rides the ping debounce; the wake command is still answered', async () => {
    const { controller, screen, row } = harness(true, true, 'wall-debounce-1');
    row.nativeRuntimeReport = runtime;
    await poll(controller); // first beat: the liveness write is due
    expect(screen.update).toHaveBeenCalledTimes(1);
    // Same panel state, new uptime counter, inside the debounce window.
    const again = await poll(
      controller,
      JSON.stringify({ ...runtime, elapsedRealtimeMs: runtime.elapsedRealtimeMs + 3000 }),
    );
    expect(screen.update).toHaveBeenCalledTimes(1);
    // POWER_ON never waits on the write: it comes from the fresh row read.
    expect(again).toMatchObject({
      nativeControl: { powerOnRequestedAt: issued.toISOString() },
    });
  });

  it('a power / wake change is written at once, even inside the debounce window', async () => {
    const { controller, screen, row } = harness(true, true, 'wall-debounce-2');
    row.nativeRuntimeReport = runtime;
    await poll(controller);
    expect(screen.update).toHaveBeenCalledTimes(1);
    const woke = { ...runtime, interactive: true, foreground: true, standbySinceMs: null };
    await poll(controller, JSON.stringify(woke));
    expect(screen.update).toHaveBeenCalledTimes(2);
    expect(screen.update.mock.calls[1][0].data.nativeRuntimeReport).toEqual(woke);
    // The identity acknowledgement is a change too.
    row.nativeRuntimeReport = woke;
    await poll(controller, JSON.stringify({ ...woke, powerOnAck: issued.toISOString() }));
    expect(screen.update).toHaveBeenCalledTimes(3);
  });

  it('a row with no stored report gets the first one written', async () => {
    const { controller, screen } = harness(true, true, 'wall-debounce-3');
    await poll(controller);
    await poll(controller);
    // 1st: debounce due (+ new report); 2nd: stored row (mock) still has
    // none, so it is still a change and is written.
    expect(screen.update).toHaveBeenCalledTimes(2);
  });
});

describe('native-first §4.4 — stream B\'s x-venueos-native-presenting header', () => {
  const presenting = JSON.stringify({ v: 1, faces: [{ face: 0, sha8: 'abcdef01', uniqueFrames: 900, ageMs: 40, v4: true, unattended: true }] });
  const pollWith = (controller: ScreensController, headers: Record<string, unknown>) =>
    controller.deviceStatus('android-wall', '1.1.24', '10124', undefined, { headers: { 'x-venueos-native-runtime': JSON.stringify(runtime), ...headers } });

  it('stores this face\'s entry inside the runtime report, under the same credential gate', async () => {
    const { controller, screen } = harness(true, true, 'wall-presenting-1');
    await pollWith(controller, { 'x-venueos-native-presenting': presenting });
    expect(screen.update.mock.calls[0][0].data.nativeRuntimeReport).toEqual({
      ...runtime,
      nativePresenting: { sha8: 'abcdef01', uniqueFrames: 900, ageMs: 40, v4: true, unattended: true },
    });
  });

  it('a malformed header, another face only or no frame yet stores nothing extra; an unproven caller stores nothing', async () => {
    for (const bad of [
      '{not json',
      JSON.stringify({ v: 2, faces: [] }),
      JSON.stringify({ v: 1, faces: [{ face: 1, sha8: 'abcdef01', uniqueFrames: 9, ageMs: 4, v4: true, unattended: false }] }),
      JSON.stringify({ v: 1, faces: [{ face: 0, sha8: 'abcdef01', uniqueFrames: 9, ageMs: -1, v4: true, unattended: false }] }),
      JSON.stringify({ v: 1, faces: [{ face: 0, sha8: 'https://x', uniqueFrames: 9, ageMs: 4, v4: true, unattended: false }] }),
    ]) {
      const { controller, screen } = harness(true, true, `wall-presenting-bad-${bad.length}`);
      await pollWith(controller, { 'x-venueos-native-presenting': bad });
      expect(screen.update.mock.calls[0][0].data.nativeRuntimeReport).toEqual(runtime);
    }
    const { controller, screen } = harness(false, true, 'wall-presenting-anon');
    await pollWith(controller, { 'x-venueos-native-presenting': presenting });
    for (const call of screen.update.mock.calls) expect(call[0].data).not.toHaveProperty('nativeRuntimeReport');
  });
});


describe('native emergency paint recovery reporting', () => {
  const challenge = '00000000-0000-4000-8000-000000000001';
  const episode = { face: 0, challenge, heldAtMs: 1000, status: 'unconfirmed', step: 4, events: [
    { step: 0, atMs: 1000, outcome: 'pending' },
    ...[1, 2, 3, 4].map(step => ({ step, atMs: 1000 + step * 1000, outcome: 'started' })),
    { step: 4, atMs: 11000, outcome: 'unconfirmed' },
  ] };
  const report = { ...runtime, emergencyProof: { faces: [episode] } };
  it('audits every escalation carried by one delayed heartbeat without inventing paint', async () => {
    const { controller, row, screen, auditLog } = harness(true, true, 'wall-emergency-audit');
    await poll(controller, JSON.stringify(report));
    expect(auditLog.create).toHaveBeenCalledTimes(6);
    expect(auditLog.create.mock.calls.every(c => c[0].data.action === 'PLAYER_EMERGENCY_RECOVERY')).toBe(true);
    expect(screen.update.mock.calls[0][0].data).toMatchObject({ lastRenderedHash: `pending|em:${challenge}` });
    expect(screen.update.mock.calls[0][0].data).not.toHaveProperty('lastRenderedAt');
    row.nativeRuntimeReport = report;
    await poll(controller, JSON.stringify(report));
    expect(auditLog.create).toHaveBeenCalledTimes(6);
  });
  it('an anonymous heartbeat cannot forge a recovery audit event', async () => {
    const { controller, auditLog } = harness(false, true, 'wall-emergency-anonymous');
    await poll(controller, JSON.stringify(report));
    expect(auditLog.create).not.toHaveBeenCalled();
  });
});
