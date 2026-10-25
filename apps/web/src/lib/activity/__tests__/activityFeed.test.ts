/**
 * Customer-facing activity sentences (2026-10-24). The owner's phone showed
 * "Field Build Window Expire · field_build_window"; these pin what a person
 * reads instead, in all three languages.
 */
import { CUSTOMER_ACTIVITY, type ActivityItem } from '@cms/api-types';
import en from '@/i18n/messages/en.json';
import es from '@/i18n/messages/es.json';
import zh from '@/i18n/messages/zh.json';
import {
  activityLines,
  describeActivity,
  groupActivity,
  hasSentence,
  type ActivityTranslate,
} from '../activityFeed';

/** A small ICU subset — `{x}` and `{n, plural, one {…} other {…}}` — over a real catalog. */
type Tree = { [k: string]: string | Tree };
function translator(messages: { activityFeed: unknown }): ActivityTranslate {
  const root = messages.activityFeed as Tree;
  return (key, values = {}) => {
    const msg = key
      .split('.')
      .reduce<string | Tree | undefined>((n, k) => (n && typeof n === 'object' ? n[k] : undefined), root);
    if (typeof msg !== 'string') throw new Error(`missing activityFeed.${key}`);
    let out = msg.replace(/\{(\w+), plural,((?:[^{}]|\{[^{}]*\})*)\}/g, (_m: string, name: string, body: string) => {
      const n = Number(values[name]);
      const opts: Record<string, string> = {};
      body.replace(/(one|other|=\d+)\s*\{([^{}]*)\}/g, (_x: string, k: string, v: string) => ((opts[k] = v), ''));
      return (opts[`=${n}`] ?? (n === 1 ? opts.one : undefined) ?? opts.other ?? '').replace(/#/g, String(n));
    });
    out = out.replace(/\{(\w+)\}/g, (m: string, name: string) => (name in values ? String(values[name]) : m));
    return out;
  };
}
const tEn = translator(en);

let seq = 0;
function item(over: Partial<ActivityItem> & { action: string }): ActivityItem {
  seq += 1;
  return {
    id: `a${seq}`,
    category: (CUSTOMER_ACTIVITY[over.action]?.category ?? 'content') as ActivityItem['category'],
    createdAt: '2026-10-24T10:00:00.000Z',
    targetType: 'Playlist',
    targetId: null,
    actor: { kind: 'person', userId: 'greg', name: 'Greg' },
    subject: null,
    target: null,
    targetKey: null,
    facts: {},
    ...over,
  };
}
const at = (min: number) => new Date(Date.parse('2026-10-24T10:00:00.000Z') - min * 60_000).toISOString();
const say = (items: ActivityItem[], viewerId: string | null = 'someone-else', t: ActivityTranslate = tEn) =>
  activityLines(items, { t, viewerId }).map((l) => l.text);

describe('every customer action has a sentence', () => {
  it('the allowlist and the sentences never drift apart', () => {
    for (const action of Object.keys(CUSTOMER_ACTIVITY)) expect({ action, ok: hasSentence(action) }).toEqual({ action, ok: true });
  });

  it('every variant an action can produce resolves in en, es and zh', () => {
    const variants: Array<Partial<ActivityItem> & { action: string }> = [];
    for (const action of Object.keys(CUSTOMER_ACTIVITY)) {
      for (const facts of [{}, { on: true }, { on: false }, { drill: true }, { orientation: 'PORTRAIT' }, { orientation: 'LANDSCAPE' }, { requested: 'POWER_OFF' }, { requested: 'POWER_ON' }, { requested: 'BLANK' }, { requested: 'WAKE' }, { requested: 'REBOOT' }, { requested: 'SET_BRIGHTNESS' }, { requested: 'SET_VOLUME' }, { role: 'CONTRIBUTOR' }, { device: 'a Windows PC' }, { label: 'iPhone' }, { from: 'Old' }, { alertType: 'LOCKDOWN' }]) {
        for (const named of [false, true]) {
          variants.push({ action, facts, subject: named ? 'Lobby loop' : null, target: named ? 'Lobby TV' : null, targetKey: named ? 'scr-1' : null });
        }
      }
    }
    for (const t of [translator(en), translator(es), translator(zh)]) {
      for (const v of variants) {
        const g = groupActivity([item(v)]);
        const line = describeActivity(g[0], { t, viewerId: null });
        expect(line).not.toBeNull();
        // No unfilled ICU placeholder ever reaches a reader.
        expect({ action: v.action, text: line!.text }).toEqual({ action: v.action, text: expect.not.stringMatching(/[{}]/) });
      }
      // Grouped (count > 1) variants too.
      for (const action of ['SCHEDULE_CREATED', 'ASSET_UPLOADED', 'ASSET_DELETED', 'ASSET_APPROVED', 'ASSET_REJECTED', 'REFRESH_WEB', 'SCREEN_DISPLAY_CONTROL']) {
        const many = groupActivity([
          item({ action, subject: 'x', targetKey: 's1', facts: { requested: 'REBOOT' } }),
          item({ action, subject: 'x', targetKey: 's2', facts: { requested: 'REBOOT' } }),
        ]);
        expect(many).toHaveLength(1);
        expect(describeActivity(many[0], { t, viewerId: null })!.text).not.toMatch(/[{}]/);
      }
    }
  });
});

describe('the sentences the owner should have seen', () => {
  it('a publish wizard is ONE line: created and published to a screen', () => {
    // Newest first, as the API returns them (the owner's real 2026-10-16 sitting).
    const lines = say([
      item({ action: 'SCHEDULE_CREATED', createdAt: at(0), subject: 'test6', target: 'Venue Media Player', targetKey: 'mp', targetType: 'Schedule' }),
      item({ action: 'PLAYLIST_ITEMS_REPLACED', createdAt: at(0.1), subject: 'test6' }),
      item({ action: 'PLAYLIST_CREATED', createdAt: at(0.15), subject: 'test6' }),
    ]);
    expect(lines).toEqual(['Greg created “test6” and published it to “Venue Media Player”']);
  });

  it('publishing to three screens: "published “Lobby loop” to 3 screens"', () => {
    const rows = ['a', 'b', 'c'].map((s, i) =>
      item({ action: 'SCHEDULE_CREATED', createdAt: at(i * 0.2), subject: 'Lobby loop', target: s, targetKey: s }),
    );
    expect(say(rows)).toEqual(['Greg published “Lobby loop” to 3 screens']);
  });

  it('the viewer reads "You"; VenueOS staff read as VenueOS support', () => {
    expect(say([item({ action: 'PLAYLIST_CREATED', subject: 'Fall promo' })], 'greg')).toEqual(['You created the playlist “Fall promo”']);
    expect(say([item({ action: 'PLAYLIST_CREATED', subject: 'Fall promo', actor: { kind: 'support', userId: 'staff', name: null } })])).toEqual([
      'VenueOS support created the playlist “Fall promo”',
    ]);
  });

  it('alerts and drills say which, and where', () => {
    expect(say([item({ action: 'TRIGGER_EMERGENCY', facts: { alertType: 'EVACUATE' } })])).toEqual(['Greg sent a Fire / Evacuate alert to every screen']);
    expect(say([item({ action: 'TRIGGER_EMERGENCY_DRILL', facts: { alertType: 'HOLD', drill: true }, target: 'Front desk' })])).toEqual([
      'Greg started a Hold drill on “Front desk”',
    ]);
    expect(say([item({ action: 'CLEAR_EMERGENCY_DRILL' })])).toEqual(['Greg ended the drill']);
    expect(say([item({ action: 'CLEAR_EMERGENCY' })])).toEqual(['Greg sent the all-clear']);
    // A drill is amber, a live alert red.
    const [drill] = activityLines([item({ action: 'TRIGGER_EMERGENCY_DRILL', facts: { alertType: 'HOLD', drill: true } })], { t: tEn });
    const [live] = activityLines([item({ action: 'TRIGGER_EMERGENCY', facts: { alertType: 'HOLD' } })], { t: tEn });
    expect(drill.tone).toBe('amber');
    expect(live.tone).toBe('rose');
  });

  it('an orientation flipped three times reads as its final state', () => {
    expect(
      say([
        item({ action: 'SCREEN_ORIENTATION_CHANGED', createdAt: at(0), subject: 'Lobby TV', facts: { orientation: 'PORTRAIT' } }),
        item({ action: 'SCREEN_ORIENTATION_CHANGED', createdAt: at(1.5), subject: 'Lobby TV', facts: { orientation: 'AUTO' } }),
        item({ action: 'SCREEN_ORIENTATION_CHANGED', createdAt: at(2.3), subject: 'Lobby TV', facts: { orientation: 'LANDSCAPE' } }),
      ]),
    ).toEqual(['Greg turned “Lobby TV” to portrait']);
  });

  it('eight uploads are one line; a different person starts a new one', () => {
    const uploads = Array.from({ length: 8 }, (_, i) => item({ action: 'ASSET_UPLOADED', createdAt: at(i * 0.5), subject: `photo-${i}.jpg`, targetId: `f${i}` }));
    uploads.push(item({ action: 'ASSET_UPLOADED', createdAt: at(5), subject: 'menu.pdf', targetId: 'f9', actor: { kind: 'person', userId: 'maria', name: 'Maria' } }));
    expect(say(uploads)).toEqual(['Greg uploaded 8 files', 'Maria uploaded “menu.pdf”']);
  });

  it('rows more than ten minutes apart stay separate', () => {
    expect(
      say([
        item({ action: 'ASSET_UPLOADED', createdAt: at(0), subject: 'a.jpg', targetId: 'f1' }),
        item({ action: 'ASSET_UPLOADED', createdAt: at(30), subject: 'b.jpg', targetId: 'f2' }),
      ]),
    ).toEqual(['Greg uploaded “a.jpg”', 'Greg uploaded “b.jpg”']);
  });

  it('a row with no name still reads naturally', () => {
    expect(say([item({ action: 'PLAYLIST_DELETED' })])).toEqual(['Greg deleted a playlist']);
    expect(say([item({ action: 'SCREEN_DISPLAY_CONTROL', facts: { requested: 'POWER_OFF' } })])).toEqual(['Greg turned off a screen']);
    expect(say([item({ action: 'PLAYLIST_SCHEDULES_TOGGLED' })])).toEqual(['Greg changed whether a playlist plays']);
  });

  it('a new sign-in names the device in the reader\'s language', () => {
    const row = item({ action: 'MFA_EMAIL_CODE_SUCCESS', facts: { device: 'a Windows PC' } });
    expect(say([row])).toEqual(['New sign-in: Greg on a Windows PC']);
    expect(say([row], null, translator(es))).toEqual(['Nuevo inicio de sesión: Greg en una PC con Windows']);
    expect(say([row], null, translator(zh))).toEqual(['新登录：Greg（Windows 电脑）']);
    // An unknown device name is dropped, never shown in English.
    expect(say([item({ action: 'MFA_EMAIL_CODE_SUCCESS', facts: { device: 'a toaster' } })], null, translator(es))).toEqual(['Nuevo inicio de sesión: Greg']);
  });

  it('Spanish and Chinese read naturally', () => {
    const rows = [item({ action: 'SCHEDULE_CREATED', subject: 'Lobby loop', target: 'Recepción', targetKey: 'r' })];
    expect(say(rows, null, translator(es))).toEqual(['Greg publicó «Lobby loop» en «Recepción»']);
    expect(say(rows, null, translator(zh))).toEqual(['Greg将“Lobby loop”发布到“Recepción”']);
    expect(say([item({ action: 'PLAYLIST_CREATED', subject: 'x' })], 'greg', translator(es))).toEqual(['Usted creó la lista «x»']);
  });

  it('an action this client cannot word is skipped, never title-cased', () => {
    expect(say([item({ action: 'FIELD_BUILD_WINDOW_EXPIRE' }), item({ action: 'PLAYLIST_CREATED', subject: 'p' })])).toEqual([
      'Greg created the playlist “p”',
    ]);
  });
});
