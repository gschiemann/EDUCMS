import {
  CONFIRM_WINDOW_MS,
  COMMAND_RELEVANCE_MS,
  deriveSleepAwakeState,
  nativeReportAsleep,
  type SleepAwakeInput,
} from '../sleep-awake';

const NOW = 1_800_000_000_000;
const base: SleepAwakeInput = {
  panelState: 'unknown',
  hardOff: false,
  lastCommand: null,
  inFlight: null,
  now: NOW,
};

describe('deriveSleepAwakeState — which button is highlighted', () => {
  it('awake: online and showing', () => {
    expect(deriveSleepAwakeState({ ...base, panelState: 'on' })).toEqual({
      current: 'awake', pending: null, unconfirmed: null,
    });
  });

  it('sleeping: render proof says not lit (blank or off)', () => {
    expect(deriveSleepAwakeState({ ...base, panelState: 'dark' }).current).toBe('sleep');
  });

  it('sleeping: the native report beats a page that keeps painting', () => {
    expect(deriveSleepAwakeState({ ...base, panelState: 'on', hardOff: true }).current).toBe('sleep');
    expect(deriveSleepAwakeState({ ...base, panelState: 'on', reportAsleep: true }).current).toBe('sleep');
  });

  it('unknown: no evidence highlights neither', () => {
    expect(deriveSleepAwakeState(base)).toEqual({ current: 'unknown', pending: null, unconfirmed: null });
  });

  it('pending: a command in flight marks the pressed button, highlight unchanged', () => {
    const s = deriveSleepAwakeState({ ...base, panelState: 'on', inFlight: 'sleep' });
    expect(s).toEqual({ current: 'awake', pending: 'sleep', unconfirmed: null });
  });

  it('pending: accepted but not yet confirmed inside the 30 s window', () => {
    const s = deriveSleepAwakeState({
      ...base, panelState: 'on',
      lastCommand: { target: 'sleep', at: NOW - 5_000 },
    });
    expect(s).toEqual({ current: 'awake', pending: 'sleep', unconfirmed: null });
  });

  it('confirmed: the highlight moves once the report agrees, pending clears', () => {
    const s = deriveSleepAwakeState({
      ...base, panelState: 'dark',
      lastCommand: { target: 'sleep', at: NOW - 5_000 },
    });
    expect(s).toEqual({ current: 'sleep', pending: null, unconfirmed: null });
  });

  it('unconfirmed: still disagreeing after the window says so, highlight stays on the evidence', () => {
    const s = deriveSleepAwakeState({
      ...base, panelState: 'on',
      lastCommand: { target: 'sleep', at: NOW - CONFIRM_WINDOW_MS - 1 },
    });
    expect(s).toEqual({ current: 'awake', pending: null, unconfirmed: 'sleep' });
  });

  it('an old command stops explaining the row', () => {
    const s = deriveSleepAwakeState({
      ...base, panelState: 'on',
      lastCommand: { target: 'sleep', at: NOW - COMMAND_RELEVANCE_MS - 1 },
    });
    expect(s).toEqual({ current: 'awake', pending: null, unconfirmed: null });
  });
});

describe('nativeReportAsleep', () => {
  const at = new Date(NOW - 60_000).toISOString();
  it('reads interactive:false from a fresh report only', () => {
    expect(nativeReportAsleep({ interactive: false }, at, NOW)).toBe(true);
    expect(nativeReportAsleep({ interactive: true }, at, NOW)).toBe(false);
    expect(nativeReportAsleep({ interactive: false }, new Date(NOW - 3_600_000).toISOString(), NOW)).toBe(false);
    expect(nativeReportAsleep(null, at, NOW)).toBe(false);
  });
});
