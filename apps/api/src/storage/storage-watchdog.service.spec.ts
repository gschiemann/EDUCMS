/**
 * StorageWatchdog — confirm before paging (2026-10-24).
 *
 * Both "STORAGE UPLOADS FAILING — customer impact" pages of 2026-10-23/24
 * were ONE probe upload hanging 60 s inside Supabase Storage (a 504), with no
 * customer upload attempted: 15:34Z on a process 3 h past boot (no deploy for
 * hours either side) and 00:53Z five minutes after a deploy whose own first
 * probe had passed. The second time, the follow-up probe also failed only
 * because it queued behind the stuck upload's row lock on the SAME object.
 * So a failed probe is now confirmed on a separate object before it counts;
 * a real outage fails both and still pages.
 */
import { StorageWatchdogService, STORAGE_CONFIRM_DELAY_MS, STORAGE_CONFIRM_PROBE_PATH } from './storage-watchdog.service';
import { degradedPlatformComponents, resetPlatformDegradationForTests } from '../health/platform-degradation';

const OK = { ok: true, transport: 'primary', upload: 'ok', read: 'ok', ms: 900 };
const FALLBACK = { ok: true, transport: 'fallback', upload: 'ok', read: 'ok', ms: 1_400 };
// The probe exactly as production recorded it at 00:53:50Z.
const STALLED = {
  ok: false,
  transport: 'none',
  upload: 'fail: Storage upload failed (504): <html>\r\n<head><title>504 Gateway Time-out</title></head>',
  read: 'skipped',
  ms: 60_371,
};

function build(probes: Array<typeof OK>) {
  const storageHealthProbe = jest.fn(async (_path?: string) => {
    const next = probes.shift();
    if (!next) throw new Error('test: no probe result left');
    return next;
  });
  const sendAlert = jest.fn(async (_subject: string, _body: string, _kind: string) => undefined);
  const svc = new StorageWatchdogService({ storageHealthProbe } as any, { sendAlert } as any);
  // Assigned (not spied) so this file also runs against the pre-fix watchdog
  // and fails there for the behaviour, not for a missing method.
  const pause = jest.fn(async (_ms: number) => undefined);
  (svc as any).pause = pause;
  (svc as any).logger = { log: jest.fn(), warn: jest.fn() };
  const tick = () => (svc as any).tick() as Promise<void>;
  return { svc, storageHealthProbe, sendAlert, pause, tick, logger: (svc as any).logger };
}

beforeEach(() => resetPlatformDegradationForTests());

describe('a failed probe is confirmed on a separate object before anyone is paged', () => {
  it('one stalled upload, confirmation passes → NO page, storage stays ok for the platform register', async () => {
    const { tick, storageHealthProbe, sendAlert, pause, logger } = build([STALLED, OK]);
    await tick();
    expect(sendAlert).not.toHaveBeenCalled();
    expect(pause).toHaveBeenCalledWith(STORAGE_CONFIRM_DELAY_MS);
    expect(storageHealthProbe.mock.calls).toEqual([[], [STORAGE_CONFIRM_PROBE_PATH]]);
    expect(STORAGE_CONFIRM_PROBE_PATH).not.toBe('health/storage-probe.png');
    expect(STORAGE_CONFIRM_PROBE_PATH.startsWith('health/storage-probe')).toBe(true); // keeps the upload log quiet
    // The customer alert emails read this register; a blip must not stand them down.
    expect(degradedPlatformComponents()).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/probe failed but its confirmation passed 15s later/));
  });

  it('a REAL outage — both probes fail → ONE page naming both probes; no repeat while it lasts; all-clear on recovery', async () => {
    const { tick, sendAlert } = build([STALLED, STALLED, STALLED, STALLED, OK]);
    await tick();
    expect(sendAlert).toHaveBeenCalledTimes(1);
    const [subject, body, kind] = sendAlert.mock.calls[0];
    expect(subject).toBe('[VenueOS] STORAGE UPLOADS FAILING — customer impact');
    expect(kind).toBe('STORAGE_TRANSPORT_ALERT');
    expect(body).toContain('Probe: upload=fail: Storage upload failed (504)');
    expect(body).toContain('Confirmed 15s later on a separate object: upload=fail: Storage upload failed (504)');
    expect(degradedPlatformComponents()).toEqual(['storage:down']);

    await tick(); // still down (both fail again): inside the 6 h re-alert window
    expect(sendAlert).toHaveBeenCalledTimes(1);

    await tick(); // healthy first probe → all-clear, no confirmation needed
    expect(sendAlert).toHaveBeenCalledTimes(2);
    expect(sendAlert.mock.calls[1][2]).toBe('STORAGE_TRANSPORT_RECOVERED');
    expect(degradedPlatformComponents()).toEqual([]);
  });

  it('a healthy probe is never re-probed', async () => {
    const { tick, storageHealthProbe, pause, sendAlert } = build([OK]);
    await tick();
    expect(storageHealthProbe).toHaveBeenCalledTimes(1);
    expect(pause).not.toHaveBeenCalled();
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it('a fallback-transport blip that confirms on the primary transport → no DEGRADED page', async () => {
    const { tick, sendAlert } = build([FALLBACK, OK]);
    await tick();
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it('a confirmed fallback → the DEGRADED page (uploads work, the primary transport does not)', async () => {
    const { tick, sendAlert } = build([STALLED, FALLBACK]);
    await tick();
    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect(sendAlert.mock.calls[0][0]).toBe('[VenueOS] Storage uploads DEGRADED — riding node:https fallback');
    expect(degradedPlatformComponents()).toEqual(['storage:degraded']);
  });
});
