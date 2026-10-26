import { billingStatus, emergencyStatus, homeAttention, type HomeReadiness } from '../home-attention';

const prices = { monthlyCents: 0, annualCents: 0 };
const report = (verdict: HomeReadiness['verdict'], items: HomeReadiness['items']): HomeReadiness => ({ verdict, items });

describe('homeAttention', () => {
  it('says nothing while nothing has answered, or when all is well', () => {
    expect(homeAttention(null, null)).toEqual([]);
    expect(homeAttention(report('READY', []), { state: 'active', prices } as any)).toEqual([]);
  });

  it('a turned-off alert capability is not a problem', () => {
    expect(homeAttention(report('DISABLED', []), null)).toEqual([]);
  });

  it('a broken delivery chain leads, and sends the operator to Emergency', () => {
    const lines = homeAttention(
      report('NOT_CONFIGURED', [
        { key: 'delivery', status: 'missing', code: 'delivery.down' },
        { key: 'staff', status: 'warn', code: 'staff.one' },
      ]),
      null,
    );
    expect(lines.map((l) => l.id)).toEqual(['delivery', 'oneSender']);
    expect(lines[0]).toMatchObject({ severity: 'error', href: 'settings/emergency' });
  });

  it('a realtime fallback still delivers — not the operator’s to fix', () => {
    expect(homeAttention(report('NEEDS_ATTENTION', [{ key: 'delivery', status: 'warn', code: 'delivery.fallback' }]), null)).toEqual([]);
  });

  it('tells "no screens yet" apart from "screens offline"', () => {
    const none = homeAttention(report('NEEDS_ATTENTION', [{ key: 'screens', status: 'missing', code: 'screens.none' }]), null);
    const off = homeAttention(report('NEEDS_ATTENTION', [{ key: 'screens', status: 'warn', code: 'screens.someOffline' }]), null);
    expect(none[0]).toMatchObject({ id: 'noScreens', href: 'screens' });
    expect(off[0]).toMatchObject({ id: 'screensOffline', href: 'screens?filter=offline' });
  });

  it('caps the list at three, errors first, then by impact', () => {
    const lines = homeAttention(
      report('NEEDS_ATTENTION', [
        { key: 'screens', status: 'missing', code: 'screens.none' },
        { key: 'staff', status: 'missing', code: 'staff.none' },
        { key: 'exercise', status: 'warn', code: 'exercise.never' },
      ]),
      { state: 'past_due', prices } as any,
    );
    expect(lines.map((l) => l.id)).toEqual(['noSender', 'paymentProblem', 'noScreens']);
  });

  it('a trial asks only in its last week; an ended plan always asks', () => {
    expect(homeAttention(null, { state: 'trial', daysLeft: 12, prices } as any)).toEqual([]);
    expect(homeAttention(null, { state: 'trial', daysLeft: 5, prices } as any)[0]).toMatchObject({ id: 'trialEnds', values: { days: 5 } });
    expect(homeAttention(null, { state: 'trial_ended', prices } as any)[0]).toMatchObject({ id: 'planEnded', severity: 'error' });
  });
});

describe('card status lines', () => {
  it('emergency: the verdict, never a guess', () => {
    expect(emergencyStatus(undefined, true)).toEqual({ key: 'checking', tone: 'muted' });
    expect(emergencyStatus(undefined, false)).toBeNull();
    expect(emergencyStatus(report('READY', []), false)?.key).toBe('emergencyReady');
    expect(emergencyStatus(report('DISABLED', []), false)?.key).toBe('emergencyOff');
  });

  it('billing: trial days, active, or a problem', () => {
    expect(billingStatus({ state: 'trial', daysLeft: 9, prices } as any)).toMatchObject({ key: 'trial', values: { days: 9 } });
    expect(billingStatus({ state: 'active', prices } as any)?.key).toBe('active');
    expect(billingStatus({ state: 'past_due', prices } as any)?.tone).toBe('bad');
    expect(billingStatus({ state: 'none', prices } as any)).toBeNull();
  });
});
