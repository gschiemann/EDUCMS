/**
 * Notification titles and bodies in the reader's language.
 *
 * Three things are pinned here:
 *   1. CONTRACT — every sentence notificationCopy.ts recognises is still what
 *      the API writes. The API source is read as text; reword a sentence there
 *      and this fails, instead of Spanish and Chinese readers silently getting
 *      English again.
 *   2. ENGLISH IS UNCHANGED — the English catalog rebuilds the API's own words.
 *   3. SPANISH / CHINESE ARE REAL — the same rows come back translated, with
 *      the user's data (screen names, sites, counts) carried through intact,
 *      and free text the server did not author passes through untouched.
 */
import fs from 'fs';
import path from 'path';
import en from '../../../i18n/messages/en.json';
import es from '../../../i18n/messages/es.json';
import zh from '../../../i18n/messages/zh.json';
import { BODY_RULES, TITLE_RULES, localizeNotification, type NotificationTranslate } from '../notificationCopy';

const API = path.resolve(__dirname, '../../../../../api/src');
const src = (rel: string) => fs.readFileSync(path.join(API, rel), 'utf8');

/** Minimal ICU: `{name}` and `{n, plural, one {…} other {…}}` with `#` — what these messages use. */
function makeT(catalog: unknown, locale: string): NotificationTranslate {
  const root = (catalog as { notifications: { server: Record<string, unknown> } }).notifications.server;
  const plural = new Intl.PluralRules(locale);
  return (key, values = {}) => {
    const msg = key.split('.').reduce<unknown>((n, p) => (n as Record<string, unknown>)?.[p], root);
    if (typeof msg !== 'string') throw new Error(`missing notifications.server.${key} in ${locale}`);
    let out = msg.replace(/\{(\w+), plural, ((?:[^{}]|\{[^{}]*\})*)\}/g, (_m, name: string, body: string) => {
      const n = Number(values[name]);
      const opts: Record<string, string> = {};
      for (const o of body.matchAll(/(=\d+|zero|one|two|few|many|other)\s*\{([^{}]*)\}/g)) opts[o[1]] = o[2];
      return (opts[`=${n}`] ?? opts[plural.select(n)] ?? opts.other ?? '').replace(/#/g, String(n));
    });
    out = out.replace(/\{(\w+)\}/g, (m, name: string) => (name in values ? String(values[name]) : m));
    if (/\{\w+\}/.test(out)) throw new Error(`unfilled placeholder in ${locale} ${key}: ${out}`);
    return out;
  };
}

const fmt = (ms: number) => `<${new Date(ms).toISOString().slice(0, 16)}>`;
const EN = { t: makeT(en, 'en'), formatTime: fmt };
const ES = { t: makeT(es, 'es'), formatTime: fmt };
const ZH = { t: makeT(zh, 'zh'), formatTime: fmt };

/** Rows exactly as the API writes them (sample data in the API's own templates). */
const ROWS = {
  offline: { kind: 'SCREEN_OFFLINE', title: 'Screen offline: Lobby TV', body: 'No heartbeat since 2026-10-07T21:14:03.000Z.' },
  offlineNever: { kind: 'SCREEN_OFFLINE', title: 'Screen offline: Lobby TV', body: 'No heartbeat since unknown.' },
  offlineHq: {
    kind: 'SCREEN_OFFLINE',
    title: 'Westside Store · Screen offline: Menu 2',
    body: 'Westside Store: no heartbeat from "Menu 2" since 2026-10-07T21:14:03.000Z.',
  },
  infra: {
    kind: 'INFRA_EVENT',
    title: 'Possible infrastructure event — 6/8 screens dropped',
    body: '6 screens went offline within 90 s (>50% of fleet). Likely WAN, ISP, or local power event — per-screen alerts suppressed. Affected: A, B, C, D, E….',
  },
  infraHq: {
    kind: 'INFRA_EVENT',
    title: 'Westside Store · Possible infrastructure event — 6/8 screens dropped',
    body: "Westside Store: 6 screens went offline within 90 s (>50% of that location's fleet). Likely WAN, ISP, or power.",
  },
  pushDead: {
    kind: 'SCREEN_PUSH_DEAD',
    title: 'Gym Wall: realtime channel down — running on polling',
    body:
      'This screen cannot receive instant commands (refresh, immediate emergency delivery). ' +
      'Its render proof is current, so it is still playing and updates via its regular polling ' +
      '(5–10s), including emergencies. Usual cause: the venue network blocks WebSocket/streaming connections.',
  },
  assetRejected: { kind: 'ASSET_REJECTED', title: 'Your asset was rejected', body: '"Fall menu.png" was rejected by pat@example.com — "Wrong logo".' },
  submission: { kind: 'INFO', title: 'New submission awaiting your review', body: '3 item(s) submitted for approval.' },
  supportAsk: {
    kind: 'INFO',
    title: 'VenueOS is asking for support access',
    body: 'VenueOS support asked for access to Springfield USD for 2 hours: "Fix the lobby playlist". Approve or deny it in Settings → Support access.',
  },
  breakGlass: {
    kind: 'INFO',
    title: 'VenueOS used emergency support access',
    body: 'ops@venue-os.app opened emergency access to Springfield USD until 2026-10-24 17:30 UTC: "Alert stuck". You can end it now in Settings → Support access.',
  },
  stutter: {
    kind: 'INFO',
    title: 'Video stutters on Lobby TV',
    body: '“Lobby TV” stutters on “promo.mp4” and there is no lighter copy to switch it to. It keeps playing.',
  },
  kioskDefault: { kind: 'INFO', title: 'Visitor needs assistance — Kiosk 1', body: 'A kiosk visitor tapped “request help.”' },
};

describe('contract — every sentence recognised here is still what the API writes', () => {
  const cases: Array<[string, string[]]> = [
    [
      'notifications/notifications.service.ts',
      [
        'title: `Screen offline: ${screen.name}`',
        'title: `${meta.name} · Screen offline: ${screen.name}`',
        'body: `No heartbeat since ${since}.`',
        "const since = screen.lastPingAt?.toISOString() ?? 'unknown';",
        'body: `${meta.name}: no heartbeat from "${screen.name}" since ${since}.`',
        'title: `Possible infrastructure event — ${dropped.length}/${total} screens dropped`',
        'title: `${meta.name} · Possible infrastructure event — ${dropped.length}/${total} screens dropped`',
        '`${dropped.length} screens went offline within ${COHORT_WINDOW_S} s `',
        '`(>${Math.round(COHORT_PCT * 100)}% of fleet). `',
        '`Likely WAN, ISP, or local power event — per-screen alerts suppressed. `',
        "`Affected: ${dropped.slice(0, 5).map((s) => s.name).join(', ')}${dropped.length > 5 ? '…' : ''}.`",
        '`${meta.name}: ${dropped.length} screens went offline within ${COHORT_WINDOW_S} s `',
        "`(>${Math.round(COHORT_PCT * 100)}% of that location's fleet). Likely WAN, ISP, or power.`",
      ],
    ],
    [
      'screens/screen-wedge-detector.cron.ts',
      [
        '`${screen.name}: realtime channel down — running on polling`',
        '`${screen.name}: realtime down AND content unproven — needs attention now`',
        "'This screen cannot receive instant commands (refresh, immediate emergency delivery). '",
        "'Its render proof is current, so it is still playing and updates via its regular polling '",
        "'(5–10s), including emergencies. Usual cause: the venue network blocks WebSocket/streaming connections.'",
        "'This screen cannot receive instant commands AND has not proven a painted frame recently — '",
        "'what it is showing right now is unverified. A durable refresh command has been queued via its '",
        "'manifest; if it does not recover within minutes, it needs on-site or network attention today, '",
        "'not a daily reminder.'",
      ],
    ],
    [
      'assets/assets.controller.ts',
      [
        "const title = 'New asset pending review';",
        '`${uploaderEmail} uploaded "${assetName}" — review needed before it can be scheduled.`',
        "decision === 'APPROVED' ? 'Your asset was approved' : 'Your asset was rejected'",
        '`"${assetName}" is now published and can be added to playlists.`',
        '`"${assetName}" was rejected by ${reviewerEmail}${reason ? ` — "${reason}"` : \'\'}.`',
      ],
    ],
    [
      'submissions/submissions.controller.ts',
      [
        "title: 'New submission awaiting your review'",
        '`${assetIds.length + playlistIds.length + scheduleIds.length} item(s) submitted for approval.`',
        "decision === 'APPROVED' ? 'Your submission was approved' : 'Your submission was rejected'",
        "'Content is now live.'",
        "'Reviewer left no feedback. Edit and resubmit when ready.'",
      ],
    ],
    ['schedules/schedules.controller.ts', ["title: 'New submission awaiting your review'", "'A schedule was submitted for approval before it can go live.'"]],
    [
      'customers/customer-console.service.ts',
      [
        "title: 'VenueOS support created an owner sign-in link'",
        "'A one-time sign-in link for a new organization owner was issued under your support access approval. If you did not expect this, revoke support access in Settings.'",
      ],
    ],
    [
      'support-access/support-access.service.ts',
      [
        "'VenueOS is asking for support access'",
        "'VenueOS used emergency support access'",
        "'VenueOS support access has ended'",
        'asked for access to ${org.name} for ${describeMinutes(grant.requestedDurationMinutes)}: "${grant.reason}". Approve or deny it in Settings → Support access.`',
        'opened emergency access to ${org.name} until ${fmt(grant.expiresAt)}: "${grant.reason}". You can end it now in Settings → Support access.`',
        '`VenueOS ended its support access to ${org.name}.`',
        "${grant.requestedByEmail ?? 'VenueOS support'}",
        "`${orgRow?.name ?? 'A customer'} approved support access`",
        "`${orgRow?.name ?? 'A customer'} denied support access`",
        "`${orgRow?.name ?? 'A customer'} gave VenueOS support access`",
        '`Access until ${fmt(grant.expiresAt)}.`',
        "if (!minutes) return 'an unspecified time';",
        "return d === 1 ? '1 day' : `${d} days`;",
        "return h === 1 ? '1 hour' : `${h} hours`;",
        'return `${minutes} minutes`;',
        "x.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'",
      ],
    ],
    [
      'notifications/notifications.controller.ts',
      [
        "const HELP_DEFAULT_TITLE = 'Visitor needs assistance';",
        "const HELP_DEFAULT_BODY = 'A kiosk visitor tapped “request help.”';",
        'title: `${title} — ${screen.name}`',
      ],
    ],
    [
      'telemetry/playback-demotion.service.ts',
      [
        'title: `Video stutters on ${screenName}`',
        '`“${screenName}” stutters on “${fileName}” while it plays more than one video at once. It keeps playing; a lighter copy would not fix this.`',
        '`“${screenName}” stutters on “${fileName}” and there is no lighter copy to switch it to. It keeps playing.`',
      ],
    ],
  ];
  it.each(cases)('%s', (file, fragments) => {
    const text = src(file);
    for (const f of fragments) expect({ file, fragment: f, found: text.includes(f) }).toEqual({ file, fragment: f, found: true });
  });

  it('the English push-dead bodies are the API’s own concatenated sentences', () => {
    // Join `'…' +\n  '…'` literal concatenations back into one literal, then the
    // English catalog text must appear as that whole literal.
    const joined = src('screens/screen-wedge-detector.cron.ts').replace(/'\s*\+\s*'/g, '');
    for (const key of ['pushDeadPollingBody', 'pushDeadUnprovenBody'] as const) {
      const text = en.notifications.server[key];
      expect({ key, found: joined.includes(`'${text}'`) }).toEqual({ key, found: true });
    }
  });
});

describe('English reads exactly as the server wrote it', () => {
  it.each(Object.entries(ROWS).filter(([name]) => !['offline', 'offlineHq', 'offlineNever', 'submission', 'breakGlass'].includes(name)))(
    '%s',
    (_name, row) => {
      const out = localizeNotification(row, EN);
      expect(out.title).toBe(row.title);
      expect(out.body).toBe(row.body);
      expect(out.titleLocalized).toBe(true);
      expect(out.bodyLocalized).toBe(true);
    },
  );

  it('only the machine bits change: timestamps become local times, counts read naturally', () => {
    expect(localizeNotification(ROWS.offline, EN).body).toBe('No heartbeat since <2026-10-07T21:14>.');
    expect(localizeNotification(ROWS.offlineHq, EN).body).toBe('Westside Store: no heartbeat from "Menu 2" since <2026-10-07T21:14>.');
    expect(localizeNotification(ROWS.offlineNever, EN).body).toBe('No heartbeat on record yet.');
    expect(localizeNotification(ROWS.submission, EN).body).toBe('3 items submitted for approval.');
    expect(localizeNotification({ ...ROWS.submission, body: '1 item(s) submitted for approval.' }, EN).body).toBe('1 item submitted for approval.');
    expect(localizeNotification(ROWS.breakGlass, EN).body).toBe(
      'ops@venue-os.app opened emergency access to Springfield USD until <2026-10-24T17:30>: "Alert stuck". You can end it now in Settings → Support access.',
    );
  });
});

describe('Spanish and Chinese readers get their own language', () => {
  it('offline screen', () => {
    expect(localizeNotification(ROWS.offline, ES)).toMatchObject({ title: 'Pantalla sin conexión: Lobby TV', body: 'Sin señal de actividad desde <2026-10-07T21:14>.' });
    expect(localizeNotification(ROWS.offline, ZH)).toMatchObject({ title: '屏幕离线：Lobby TV', body: '自 <2026-10-07T21:14> 起未收到心跳信号。' });
    expect(localizeNotification(ROWS.offlineHq, ES).title).toBe('Westside Store · Pantalla sin conexión: Menu 2');
  });

  it('a site-wide drop keeps its counts and the names of the screens', () => {
    const esRow = localizeNotification(ROWS.infra, ES);
    expect(esRow.title).toBe('Posible falla de infraestructura: se desconectaron 6 de 8 pantallas');
    expect(esRow.body).toContain('Afectadas: A, B, C, D, E….');
    const zhRow = localizeNotification(ROWS.infraHq, ZH);
    expect(zhRow.title).toBe('Westside Store · 可能的基础设施故障——8 块屏幕中有 6 块掉线');
    expect(zhRow.body).toContain('Westside Store：90 秒内有 6 块屏幕离线');
  });

  it('support access names the duration and the time in the reader’s words', () => {
    expect(localizeNotification(ROWS.supportAsk, ES).body).toBe(
      'El soporte de VenueOS solicitó acceso a Springfield USD durante 2 horas: "Fix the lobby playlist". Apruébalo o recházalo en Ajustes → Acceso de soporte de VenueOS.',
    );
    expect(localizeNotification(ROWS.supportAsk, ZH).body).toContain('时长 2 小时');
    expect(localizeNotification(ROWS.breakGlass, ZH).body).toContain('有效期至 <2026-10-24T17:30>');
  });

  it('plurals follow the language', () => {
    expect(localizeNotification({ ...ROWS.submission, body: '1 item(s) submitted for approval.' }, ES).body).toBe('Se envió 1 elemento para aprobación.');
    expect(localizeNotification(ROWS.submission, ES).body).toBe('Se enviaron 3 elementos para aprobación.');
    expect(localizeNotification(ROWS.submission, ZH).body).toBe('3 项内容已提交审批。');
  });

  it.each(Object.entries(ROWS))('%s is fully translated in Spanish and Chinese', (_name, row) => {
    for (const o of [ES, ZH]) {
      const out = localizeNotification(row, o);
      expect(out.titleLocalized).toBe(true);
      expect(out.bodyLocalized).toBe(true);
      expect(out.title).not.toBe(row.title);
      expect(out.body).not.toBe(row.body);
    }
  });
});

describe('text the server did not author is never touched', () => {
  it('a reviewer’s own note and a visitor’s typed request stay exactly as written', () => {
    const note = { kind: 'INFO', title: 'Your submission was rejected', body: 'Please use the 2027 logo.' };
    expect(localizeNotification(note, ES)).toMatchObject({ title: 'Tu envío fue rechazado', body: 'Please use the 2027 logo.', bodyLocalized: false });
    const typed = { kind: 'INFO', title: 'Spill in aisle 4 — Kiosk 1', body: 'Someone dropped a drink' };
    expect(localizeNotification(typed, ZH)).toMatchObject({ title: typed.title, body: typed.body, titleLocalized: false, bodyLocalized: false });
  });

  it('a sentence under the wrong kind is not reinterpreted', () => {
    const odd = { kind: 'INFO', title: 'Screen offline: Lobby', body: null };
    expect(localizeNotification(odd, ES)).toMatchObject({ title: 'Screen offline: Lobby', body: null, titleLocalized: false });
  });

  it('a row with no body stays without one', () => {
    expect(localizeNotification({ kind: 'ASSET_APPROVED', title: 'Your asset was approved', body: null }, ZH)).toEqual({
      title: '您的素材已获批准',
      body: null,
      titleLocalized: true,
      bodyLocalized: false,
    });
  });
});

describe('every rule has its message in all three catalogs', () => {
  const keysOf = (rules: typeof TITLE_RULES) =>
    rules.flatMap((r) => (typeof r.key === 'function' ? ['infraEvent', 'infraEventAt'] : [r.key]));
  it.each([['en', en], ['es', es], ['zh', zh]] as const)('%s', (_loc, cat) => {
    const server = (cat as { notifications: { server: Record<string, unknown> } }).notifications.server;
    for (const k of [...keysOf(TITLE_RULES), ...keysOf(BODY_RULES), 'venueosSupport', 'aCustomer', 'unknownTime']) {
      expect({ k, ok: typeof server[k] === 'string' }).toEqual({ k, ok: true });
    }
    for (const u of ['days', 'hours', 'minutes', 'unspecified']) {
      expect(typeof (server.duration as Record<string, unknown>)[u]).toBe('string');
    }
  });
});
