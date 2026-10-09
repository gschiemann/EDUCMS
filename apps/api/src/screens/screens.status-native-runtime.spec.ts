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

function harness(proved = true, paired = true) {
  const row = {
    id: 'wall',
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
  const controller = new ScreensController(
    { client: { screen } } as never,
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
  return { row, screen, controller };
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
