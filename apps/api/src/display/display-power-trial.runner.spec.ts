import { DisplayPowerTrialRunner, parsePowerTrialOnce, powerTrialReason } from './display-power-trial.runner';

jest.mock('./display-emergency-hold', () => ({ resolveEmergencyHold: jest.fn().mockResolvedValue({ active: false, source: null }) }));

const SCREEN = '1cff5eb0-a9af-43bb-82cf-f76ee66d72be';

describe('DISPLAY_POWER_TRIAL_ONCE', () => {
  it('parses screen|seconds|nonce and treats anything else as not set', () => {
    expect(parsePowerTrialOnce(`${SCREEN}|180|trial-1`)).toEqual({ screenId: SCREEN, wakeAfterMs: 180_000, nonce: 'trial-1' });
    for (const bad of [undefined, '', 'all', `${SCREEN}|180`, `not-a-uuid|180|trial-1`, `${SCREEN}|3m|trial-1`, `${SCREEN}|180|x`, `${SCREEN}|180|a b c d`]) {
      expect(parsePowerTrialOnce(bad)).toBeNull();
    }
  });

  const build = (seen: unknown, screen: unknown) => {
    const prisma = { client: { auditLog: { findFirst: jest.fn().mockResolvedValue(seen) }, screen: { findUnique: jest.fn().mockResolvedValue(screen) } } };
    const display = { applyAction: jest.fn().mockResolvedValue({ success: true, mechanism: 'screen-timeout' }) };
    return { prisma, display, runner: new DisplayPowerTrialRunner(prisma as never, display as never) };
  };
  const trial = { screenId: SCREEN, wakeAfterMs: 180_000, nonce: 'trial-1' };
  const row = { id: SCREEN, tenantId: 't1', displayCapabilities: { verdict: {} }, lastPushConnectedAt: new Date() };

  it('sends ONE trial through the same gate as the HTTP door, marked with its nonce', async () => {
    const { runner, display, prisma } = build(null, row);
    await expect(runner.runOnce(trial)).resolves.toBe('ran');
    expect(prisma.client.auditLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { targetId: SCREEN, details: { contains: 'nonce=trial-1' } },
    }));
    expect(display.applyAction).toHaveBeenCalledTimes(1);
    expect(display.applyAction).toHaveBeenCalledWith(expect.objectContaining({
      screenId: SCREEN, tenantId: 't1', userId: null, action: 'POWER_OFF', powerTrial: true,
      revertAfterMs: 180_000, reason: powerTrialReason('trial-1'), emergencyHold: { active: false, source: null },
    }));
  });

  it('does nothing when that nonce already has an audit row (a restart, a second replica)', async () => {
    const { runner, display } = build({ id: 'audit-1' }, row);
    await expect(runner.runOnce(trial)).resolves.toBe('already-ran');
    expect(display.applyAction).not.toHaveBeenCalled();
  });

  it('reports a missing screen and a refusal without throwing', async () => {
    const missing = build(null, null);
    await expect(missing.runner.runOnce(trial)).resolves.toBe('no-screen');
    const refused = build(null, row);
    refused.display.applyAction.mockRejectedValue(Object.assign(new Error('no'), { code: 'DISPLAY_POWER_TRIAL_REFUSED' }));
    await expect(refused.runner.runOnce(trial)).resolves.toBe('refused');
  });
});
