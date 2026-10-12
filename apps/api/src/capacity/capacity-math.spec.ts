import {
  DAY_MS,
  DEFAULT_LIMITS,
  decideAlert,
  levelWithHysteresis,
  memoryLimitFromNodeOptions,
  parseLimits,
  parseThresholds,
  pctOf,
  projectDaysToLimit,
  rawLevel,
} from './capacity-math';

const T = parseThresholds({} as NodeJS.ProcessEnv);
const NOW = new Date('2026-10-12T12:00:00Z');

describe('thresholds + limits parsing', () => {
  it('defaults to 70 / 85', () => {
    expect(T.warnPct).toBe(70);
    expect(T.criticalPct).toBe(85);
  });
  it('honours env, and refuses an inverted pair', () => {
    expect(parseThresholds({ CAPACITY_WARN_PCT: '60', CAPACITY_CRITICAL_PCT: '90' } as any)).toMatchObject({ warnPct: 60, criticalPct: 90 });
    expect(parseThresholds({ CAPACITY_WARN_PCT: '95', CAPACITY_CRITICAL_PCT: '80' } as any)).toMatchObject({ warnPct: 70, criticalPct: 85 });
  });
  it('CAPACITY_LIMITS overrides per key; garbage is ignored', () => {
    expect(parseLimits('{"dbBytes":1000,"pairedScreens":"2500","storageBytes":-1,"bogus":5}')).toMatchObject({
      dbBytes: 1000,
      pairedScreens: 2500,
      storageBytes: DEFAULT_LIMITS.storageBytes,
    });
    expect(parseLimits('not json')).toEqual(DEFAULT_LIMITS);
    expect(parseLimits(undefined)).toEqual(DEFAULT_LIMITS);
  });
  it('reads the memory ceiling from NODE_OPTIONS', () => {
    expect(memoryLimitFromNodeOptions('--max-old-space-size=4096')).toBe(4096 * 1024 * 1024);
    expect(memoryLimitFromNodeOptions('--trace-warnings')).toBeNull();
    expect(memoryLimitFromNodeOptions(undefined)).toBeNull();
  });
});

describe('levels', () => {
  it('pctOf', () => {
    expect(pctOf(50, 200)).toBe(25);
    expect(pctOf(5, null)).toBeNull();
    expect(pctOf(5, 0)).toBeNull();
  });
  it('rawLevel boundaries are inclusive', () => {
    expect(rawLevel(69.9, T)).toBe('ok');
    expect(rawLevel(70, T)).toBe('warn');
    expect(rawLevel(84.9, T)).toBe('warn');
    expect(rawLevel(85, T)).toBe('critical');
    expect(rawLevel(null, T)).toBe('ok');
  });
});

describe('hysteresis', () => {
  it('rises immediately', () => {
    expect(levelWithHysteresis(71, 'ok', T)).toBe('warn');
    expect(levelWithHysteresis(90, 'ok', T)).toBe('critical');
    expect(levelWithHysteresis(86, 'warn', T)).toBe('critical');
  });
  it('does not flap: warn holds until 5 points under the threshold', () => {
    expect(levelWithHysteresis(68, 'warn', T)).toBe('warn');
    expect(levelWithHysteresis(65, 'warn', T)).toBe('warn');
    expect(levelWithHysteresis(64.9, 'warn', T)).toBe('ok');
  });
  it('critical steps down to warn only below 80, and to ok only below 65', () => {
    expect(levelWithHysteresis(83, 'critical', T)).toBe('critical');
    expect(levelWithHysteresis(80, 'critical', T)).toBe('critical');
    expect(levelWithHysteresis(79.9, 'critical', T)).toBe('warn');
    expect(levelWithHysteresis(66, 'critical', T)).toBe('warn');
    expect(levelWithHysteresis(60, 'critical', T)).toBe('ok');
  });
  it('a metric that vanished (null pct) clears', () => {
    expect(levelWithHysteresis(null, 'critical', T)).toBe('ok');
  });
});

describe('decideAlert: once per metric per day', () => {
  const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

  it('never alerts while ok', () => {
    expect(decideAlert(40, 'ok', null, NOW, T)).toMatchObject({ level: 'ok', alert: false });
  });
  it('alerts on first crossing', () => {
    expect(decideAlert(72, 'ok', null, NOW, T)).toEqual({ level: 'warn', alert: true, stampAlert: true });
  });
  it('is silent while the level persists within a day', () => {
    expect(decideAlert(73, 'warn', hoursAgo(1), NOW, T)).toMatchObject({ level: 'warn', alert: false, stampAlert: false });
    expect(decideAlert(73, 'warn', hoursAgo(23), NOW, T).alert).toBe(false);
  });
  it('repeats after a day while still over', () => {
    expect(decideAlert(73, 'warn', hoursAgo(24), NOW, T).alert).toBe(true);
  });
  it('escalation to critical alerts immediately even inside the day', () => {
    expect(decideAlert(88, 'warn', hoursAgo(1), NOW, T)).toEqual({ level: 'critical', alert: true, stampAlert: true });
  });
  it('a warn that is re-crossed inside the day after dipping (hysteresis hold) does not re-alert', () => {
    // 72 -> alert; next hour 68 holds warn (no alert); next 72 is still warn -> silent
    const first = decideAlert(72, 'ok', null, hoursAgo(2), T);
    const dip = decideAlert(68, first.level, hoursAgo(2), hoursAgo(1), T);
    expect(dip).toMatchObject({ level: 'warn', alert: false });
    expect(decideAlert(72, dip.level, hoursAgo(2), NOW, T).alert).toBe(false);
  });
  it('after a true clear, a new warn crossing inside the day stays quiet (once per day) but critical does not', () => {
    expect(decideAlert(72, 'ok', hoursAgo(3), NOW, T).alert).toBe(false);
    expect(decideAlert(90, 'ok', hoursAgo(3), NOW, T).alert).toBe(true);
  });
});

describe('projectDaysToLimit', () => {
  const pts = (vals: number[]) => vals.map((value, i) => ({ t: i * DAY_MS, value }));
  it('projects linear growth', () => {
    const r = projectDaysToLimit(pts([10, 20, 30, 40]), 100)!;
    expect(r.perDay).toBeCloseTo(10, 5);
    expect(r.daysToLimit).toBeCloseTo(6, 5);
  });
  it('null daysToLimit when flat/shrinking, or already past', () => {
    expect(projectDaysToLimit(pts([40, 40, 40]), 100)!.daysToLimit).toBeNull();
    expect(projectDaysToLimit(pts([40, 30, 20]), 100)!.daysToLimit).toBeNull();
    expect(projectDaysToLimit(pts([90, 100, 110]), 100)!.daysToLimit).toBeNull();
  });
  it('null with too little history', () => {
    expect(projectDaysToLimit([], 100)).toBeNull();
    expect(projectDaysToLimit([{ t: 0, value: 1 }], 100)).toBeNull();
    expect(projectDaysToLimit([{ t: 0, value: 1 }, { t: 60_000, value: 2 }], 100)).toBeNull();
  });
});
