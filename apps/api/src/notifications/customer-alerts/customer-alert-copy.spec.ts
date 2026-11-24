/**
 * Customer alert email WORDS (2026-10-23): every event in en / es / zh, the
 * "Manage alert emails" link in every one, and nothing but screen + location
 * names (no person, no address).
 */
import {
  MAX_LISTED,
  alertLocaleOf,
  onTimeLabel,
  renderDigestEmail,
  renderEmergencyEmail,
  renderScreenAlertEmail,
  type AlertLocale,
  type ScreenItemKind,
} from './customer-alert-copy';

const links = { screensUrl: 'https://app.test/lincoln/screens', manageUrl: 'https://app.test/lincoln/account#alert-emails' };
const LOCALES: AlertLocale[] = ['en', 'es', 'zh'];
const KINDS: ScreenItemKind[] = ['OFFLINE', 'BACK_ONLINE', 'NO_CONTENT', 'CONTENT_RESTORED'];
const item = (screenName: string, kind: ScreenItemKind, minutes = 17) => ({ kind, screenName, locationName: 'Lincoln Elementary', minutes });

describe('screen alert emails', () => {
  it('subjects (en) match the agreed shape', () => {
    const three = ['Lobby TV', 'Gym Board', 'Office'];
    expect(renderScreenAlertEmail('en', { kind: 'OFFLINE', locationName: 'Lincoln Elementary', items: three.map((n) => item(n, 'OFFLINE')) }, links).subject).toBe(
      'VenueOS: 3 screens offline at Lincoln Elementary',
    );
    expect(renderScreenAlertEmail('en', { kind: 'OFFLINE', locationName: 'Lincoln Elementary', items: [item('Lobby TV', 'OFFLINE')] }, links).subject).toBe(
      'VenueOS: Lobby TV is offline at Lincoln Elementary',
    );
  });

  it('every kind × every language: a subject, the screen, the manage link, the screens link, a signature', () => {
    for (const l of LOCALES)
      for (const k of KINDS) {
        const e = renderScreenAlertEmail(l, { kind: k, locationName: 'Lincoln Elementary', items: [item('Lobby TV', k)] }, links);
        expect(e.subject).toMatch(/^VenueOS[:：]/);
        expect(e.subject).toContain('Lobby TV');
        expect(e.body).toContain('Lobby TV');
        expect(e.body).toContain(links.manageUrl);
        expect(e.body).toContain(links.screensUrl);
        expect(e.body).toMatch(/VenueOS/);
      }
  });

  it('a site-wide drop says so', () => {
    const e = renderScreenAlertEmail('en', { kind: 'OFFLINE', locationName: 'X', items: [item('a', 'OFFLINE'), item('b', 'OFFLINE')], siteWide: true }, links);
    expect(e.body).toContain('internet or power at the site');
  });

  it('lists at most 20 screens by name, then counts', () => {
    const items = Array.from({ length: MAX_LISTED + 5 }, (_, i) => item(`S${i}`, 'OFFLINE'));
    const e = renderScreenAlertEmail('en', { kind: 'OFFLINE', locationName: 'X', items }, links);
    expect(e.body).toContain('…and 5 more');
    expect(e.body).not.toContain(`S${MAX_LISTED + 1}`);
  });

  it('the language falls back to English', () => {
    expect(alertLocaleOf('fr')).toBe('en');
    expect(alertLocaleOf(null)).toBe('en');
    expect(alertLocaleOf('zh')).toBe('zh');
  });
});

describe('digest + emergency', () => {
  it('digest in every language', () => {
    for (const l of LOCALES) {
      const e = renderDigestEmail(l, { orgName: 'Springfield', items: [item('a', 'OFFLINE'), item('b', 'BACK_ONLINE')] }, links);
      expect(e.subject).toContain('Springfield');
      expect(e.body).toContain(links.manageUrl);
    }
  });

  it('emergency: trigger, drill, all-clear, multi-location — in every language, no person named', () => {
    const at = new Date('2026-10-23T15:42:00Z');
    const e = renderEmergencyEmail('en', { event: 'TRIGGERED', alertType: 'LOCKDOWN', isDrill: false, locationNames: ['Lincoln Elementary'], screenCount: 12, at }, { emergencyUrl: 'u', manageUrl: 'm' });
    expect(e.subject).toBe('VenueOS: Lockdown alert sent to Lincoln Elementary');
    // No clocks given: the time is stated in UTC, and labelled UTC (2026-11-23).
    expect(e.body).toContain('Time: Fri, Oct 23, 2026, 3:42 PM UTC');
    const d = renderEmergencyEmail('en', { event: 'TRIGGERED', alertType: 'EVACUATE', isDrill: true, locationNames: ['District', 'A', 'B'], at }, { emergencyUrl: 'u', manageUrl: 'm' });
    expect(d.subject).toBe('VenueOS: Evacuate drill started at District and 2 other locations');
    // Spanish plural (2026-11-23): "ubicaciones", never "ubicaciónes"; one is "ubicación".
    const dEs = renderEmergencyEmail('es', { event: 'TRIGGERED', alertType: 'EVACUATE', isDrill: true, locationNames: ['District', 'A', 'B'], at }, { emergencyUrl: 'u', manageUrl: 'm' });
    expect(dEs.subject).toBe('VenueOS: Simulacro de Evacuación iniciado en District y 2 ubicaciones más');
    const oneEs = renderEmergencyEmail('es', { event: 'CLEARED', isDrill: true, locationNames: ['District', 'A'], at }, { emergencyUrl: 'u', manageUrl: 'm' });
    expect(oneEs.subject).toBe('VenueOS: Simulacro terminado en District y 1 ubicación más');
    const c = renderEmergencyEmail('en', { event: 'CLEARED', isDrill: false, locationNames: ['Lincoln Elementary'], at }, { emergencyUrl: 'u', manageUrl: 'm' });
    expect(c.subject).toBe('VenueOS: All clear sent to Lincoln Elementary');
    for (const l of LOCALES) {
      const x = renderEmergencyEmail(l, { event: 'TRIGGERED', alertType: 'WEATHER', isDrill: false, locationNames: ['L'], at }, { emergencyUrl: 'u', manageUrl: 'm' });
      expect(x.body).toContain('m');
      expect(x.subject).toMatch(/^VenueOS[:：]/);
    }
  });
});

describe('"didn’t come back on at its scheduled on time" (2026-10-25)', () => {
  // Monday 07:00 in Los Angeles = 14:00 UTC.
  const missedOnTime = { onAtMs: Date.parse('2026-10-26T14:00:00Z'), timeZone: 'America/Los_Angeles' };
  const missed = (screenName: string) => ({ ...item(screenName, 'OFFLINE', 16), locationName: 'Brookfield', missedOnTime });
  const render = (l: AlertLocale, items: ReturnType<typeof missed>[]) =>
    renderScreenAlertEmail(l, { kind: 'OFFLINE', locationName: 'Brookfield', items }, links);

  it('the switch-on time in the location’s own zone, in the reader’s language', () => {
    expect(onTimeLabel('en', missedOnTime)).toBe('7:00 AM');
    expect(onTimeLabel('es', missedOnTime)).toBe('7:00');
    expect(onTimeLabel('zh', missedOnTime)).toBe('上午7:00');
  });

  it('one screen: the subject and the line say what happened, in en / es / zh', () => {
    expect(render('en', [missed('G24')]).subject).toBe("VenueOS: G24 at Brookfield didn't come back on at 7:00 AM");
    expect(render('en', [missed('G24')]).body).toContain("G24 — didn't come back on at 7:00 AM, its scheduled on time");
    expect(render('es', [missed('G24')]).subject).toBe('VenueOS: G24 en Brookfield no volvió a encenderse a las 7:00');
    expect(render('es', [missed('G24')]).body).toContain('G24 — no volvió a encenderse a las 7:00, su hora programada de encendido');
    expect(render('zh', [missed('G24')]).subject).toBe('VenueOS：Brookfield 的 G24 未在 上午7:00 按时开机');
    expect(render('zh', [missed('G24')]).body).toContain('G24 — 未在计划开机时间 上午7:00 恢复开机');
  });

  it('several, all at one switch-on: one email says so; mixed with an ordinary drop: the ordinary subject, each line its own', () => {
    expect(render('en', [missed('G24'), missed('G43')]).subject).toBe("VenueOS: 2 screens at Brookfield didn't come back on at 7:00 AM");
    const mixed = render('en', [missed('G24'), { ...item('Lobby TV', 'OFFLINE', 22), locationName: 'Brookfield' } as any]);
    expect(mixed.subject).toBe('VenueOS: 2 screens offline at Brookfield');
    expect(mixed.body).toContain("G24 — didn't come back on at 7:00 AM, its scheduled on time");
    expect(mixed.body).toContain('Lobby TV — offline for 22 minutes');
  });

  it('a 1 o’clock switch-on reads "a la 1:00" in Spanish', () => {
    const one = { onAtMs: Date.parse('2026-10-26T08:00:00Z'), timeZone: 'America/Los_Angeles' };
    expect(renderScreenAlertEmail('es', { kind: 'OFFLINE', locationName: 'Brookfield', items: [{ ...missed('G24'), missedOnTime: one }] }, links).subject).toBe(
      'VenueOS: G24 en Brookfield no volvió a encenderse a la 1:00',
    );
  });

  it('the digest names it too', () => {
    const d = renderDigestEmail('en', { orgName: 'Brookfield', items: [missed('G24')] }, links);
    expect(d.body).toContain("Didn't come back on at 7:00 AM: G24 (Brookfield)");
  });
});

describe('offline duration is the true elapsed time at send (2026-11-02)', () => {
  const sinceMs = Date.UTC(2026, 10, 1, 16, 39);
  const nowMs = sinceMs + (3 * 60 + 12) * 60_000;
  const it1 = { kind: 'OFFLINE' as const, screenName: 'Lobby', locationName: 'Lincoln', minutes: 16, sinceMs, timeZone: 'UTC' };

  it('states "since <time> (<h> h <m> min)" computed from nowMs, ignoring the stale minutes field', () => {
    const e = renderScreenAlertEmail('en', { kind: 'OFFLINE', locationName: 'Lincoln', items: [it1], nowMs }, links);
    expect(e.body).toContain('Lobby — offline since 4:39 PM (3 h 12 min)');
    expect(e.body).not.toContain('16 minutes');
  });

  it('two sends of the same incident at different times state different durations', () => {
    const a = renderScreenAlertEmail('en', { kind: 'OFFLINE', locationName: 'Lincoln', items: [it1], nowMs: sinceMs + 16 * 60_000 }, links);
    const b = renderScreenAlertEmail('en', { kind: 'OFFLINE', locationName: 'Lincoln', items: [it1], nowMs }, links);
    expect(a.body).toContain('(16 minutes)');
    expect(b.body).toContain('(3 h 12 min)');
  });

  it('works in es and zh, in the location time zone, and in the digest', () => {
    const tz = { ...it1, timeZone: 'America/Chicago' };
    expect(renderScreenAlertEmail('es', { kind: 'OFFLINE', locationName: 'L', items: [tz], nowMs }, links).body).toContain('(3 h 12 min)');
    expect(renderScreenAlertEmail('zh', { kind: 'OFFLINE', locationName: 'L', items: [tz], nowMs }, links).body).toContain('3 小时 12 分钟');
    expect(renderScreenAlertEmail('en', { kind: 'OFFLINE', locationName: 'L', items: [tz], nowMs }, links).body).toContain('since 10:39 AM (3 h 12 min)');
    expect(renderDigestEmail('en', { orgName: 'O', items: [it1], nowMs }, links).body).toContain('since 4:39 PM (3 h 12 min)');
  });

  it('NO_CONTENT says picture, not offline', () => {
    const e = renderScreenAlertEmail('en', { kind: 'NO_CONTENT', locationName: 'L', items: [{ ...it1, kind: 'NO_CONTENT' }], nowMs }, links);
    expect(e.body).toContain('no picture confirmed since 4:39 PM (3 h 12 min)');
  });
});

describe('emergency record copy: the time as the screens’ clocks show it (2026-11-23)', () => {
  // The owner, after a live demo: "My alert email give me utc time but I want local time of the screen".
  const at = new Date('2026-11-23T20:41:00Z');
  const jul = new Date('2026-07-23T20:41:00Z');
  const L = { emergencyUrl: 'u', manageUrl: 'm' };
  const render = (l: AlertLocale, locationNames: string[], clocks: Array<{ name: string; zone: string | null }>, when = at, event: 'TRIGGERED' | 'CLEARED' = 'TRIGGERED') =>
    renderEmergencyEmail(l, { event, alertType: 'LOCKDOWN', isDrill: true, locationNames, at: when, clocks }, L).body;
  const timeBlock = (body: string) => {
    const lines = body.split('\n');
    const i = lines.findIndex((x) => /^(Time|Hora|时间):/.test(x));
    const out = [lines[i]];
    for (let j = i + 1; j < lines.length && lines[j].startsWith('  '); j++) out.push(lines[j]);
    return out;
  };

  it('one location: one line, local time, zone named — en / es / zh; trigger, drill and all-clear alike', () => {
    const one = [{ name: 'Lincoln Elementary', zone: 'America/Chicago' }];
    expect(timeBlock(render('en', ['Lincoln Elementary'], one))).toEqual(['Time: Mon, Nov 23, 2026, 2:41 PM CST']);
    expect(timeBlock(render('es', ['Lincoln Elementary'], one))).toEqual(['Hora: lun, 23 nov 2026, 14:41 hora estándar central']);
    expect(timeBlock(render('zh', ['Lincoln Elementary'], one))).toEqual(['时间: 2026年11月23日周一 北美中部标准时间下午2:41']);
    expect(timeBlock(render('en', ['Lincoln Elementary'], one, at, 'CLEARED'))).toEqual(['Time: Mon, Nov 23, 2026, 2:41 PM CST']);
    const live = renderEmergencyEmail('en', { event: 'TRIGGERED', alertType: 'LOCKDOWN', isDrill: false, locationNames: ['Lincoln Elementary'], at, clocks: one }, L).body;
    expect(timeBlock(live)).toEqual(['Time: Mon, Nov 23, 2026, 2:41 PM CST']);
    for (const l of LOCALES) expect(render(l, ['Lincoln Elementary'], one)).not.toContain('UTC');
  });

  it('several locations whose clocks agree: still one line', () => {
    const body = render('en', ['Springfield District', 'Lincoln Elementary', 'Adams Middle'], [
      { name: 'Springfield District', zone: 'America/Chicago' },
      { name: 'Lincoln Elementary', zone: 'America/Chicago' },
      { name: 'Adams Middle', zone: 'America/Chicago' },
    ]);
    expect(timeBlock(body)).toEqual(['Time: Mon, Nov 23, 2026, 2:41 PM CST']);
  });

  it('clocks that disagree: one line per reading, the alert’s own target first, naming who reads it', () => {
    const clocks = [
      { name: 'Springfield District', zone: 'America/Chicago' },
      { name: 'Mesa Campus', zone: 'America/Denver' },
      { name: 'Lincoln Elementary', zone: 'America/Chicago' },
      { name: 'Adams Middle', zone: 'America/Chicago' },
    ];
    const names = clocks.map((c) => c.name);
    expect(timeBlock(render('en', names, clocks))).toEqual([
      'Time:',
      '  • Mon, Nov 23, 2026, 2:41 PM CST — Springfield District and 2 other locations',
      '  • Mon, Nov 23, 2026, 1:41 PM MST — Mesa Campus',
    ]);
    expect(timeBlock(render('es', names, clocks))).toEqual([
      'Hora:',
      '  • lun, 23 nov 2026, 14:41 hora estándar central — Springfield District y 2 ubicaciones más',
      '  • lun, 23 nov 2026, 13:41 hora estándar de las Montañas Rocosas — Mesa Campus',
    ]);
    expect(timeBlock(render('zh', names, clocks))).toEqual([
      '时间:',
      '  • 2026年11月23日周一 北美中部标准时间下午2:41 — Springfield District 及其他 2 个地点',
      '  • 2026年11月23日周一 北美山区标准时间下午1:41 — Mesa Campus',
    ]);
  });

  it('Denver and Phoenix read the same in winter (one line) and differ in summer (two)', () => {
    const clocks = [
      { name: 'Denver Campus', zone: 'America/Denver' },
      { name: 'Phoenix Campus', zone: 'America/Phoenix' },
    ];
    expect(timeBlock(render('en', ['Denver Campus', 'Phoenix Campus'], clocks, at))).toEqual(['Time: Mon, Nov 23, 2026, 1:41 PM MST']);
    expect(timeBlock(render('en', ['Denver Campus', 'Phoenix Campus'], clocks, jul))).toEqual([
      'Time:',
      '  • Thu, Jul 23, 2026, 2:41 PM MDT — Denver Campus',
      '  • Thu, Jul 23, 2026, 1:41 PM MST — Phoenix Campus',
    ]);
  });

  it('one location whose screens show two zones (a per-screen override) is named on both lines', () => {
    const body = render('en', ['Lincoln Elementary'], [
      { name: 'Lincoln Elementary', zone: 'America/Chicago' },
      { name: 'Lincoln Elementary', zone: 'America/New_York' },
    ]);
    expect(timeBlock(body)).toEqual([
      'Time:',
      '  • Mon, Nov 23, 2026, 2:41 PM CST — Lincoln Elementary',
      '  • Mon, Nov 23, 2026, 3:41 PM EST — Lincoln Elementary',
    ]);
  });

  it('no zone known, an unknown zone, or no clocks at all: UTC, labelled UTC, never a bare time', () => {
    for (const clocks of [[], [{ name: 'L', zone: null }], [{ name: 'L', zone: 'Not/AZone' }]]) {
      expect(timeBlock(render('en', ['L'], clocks))).toEqual(['Time: Mon, Nov 23, 2026, 8:41 PM UTC']);
      expect(timeBlock(render('es', ['L'], clocks))).toEqual(['Hora: lun, 23 nov 2026, 20:41 tiempo universal coordinado']);
      expect(timeBlock(render('zh', ['L'], clocks))).toEqual(['时间: 2026年11月23日周一 协调世界时下午8:41']);
    }
    const legacy = renderEmergencyEmail('en', { event: 'CLEARED', isDrill: false, locationNames: ['L'], at }, L).body;
    expect(timeBlock(legacy)).toEqual(['Time: Mon, Nov 23, 2026, 8:41 PM UTC']);
  });

  it('a known zone and an unknown one at once: each says which it is', () => {
    expect(timeBlock(render('en', ['A', 'B'], [{ name: 'A', zone: 'America/Chicago' }, { name: 'B', zone: null }]))).toEqual([
      'Time:',
      '  • Mon, Nov 23, 2026, 2:41 PM CST — A',
      '  • Mon, Nov 23, 2026, 8:41 PM UTC — B',
    ]);
  });

  it('the rest of the copy is unchanged: subject, record line, links, signature; no odd spaces anywhere', () => {
    for (const l of LOCALES) {
      const e = renderEmergencyEmail(l, { event: 'TRIGGERED', alertType: 'LOCKDOWN', isDrill: true, locationNames: ['Lincoln Elementary'], at, clocks: [{ name: 'Lincoln Elementary', zone: 'America/Chicago' }] }, L);
      expect(e.subject).toMatch(/^VenueOS[:：]/);
      expect(e.subject).not.toMatch(/\d:\d\d/);
      expect(e.body).toContain('u');
      expect(e.body).toContain('m');
      expect(e.body + e.subject).not.toMatch(/[\u202f\u00a0]/);
    }
  });
});
