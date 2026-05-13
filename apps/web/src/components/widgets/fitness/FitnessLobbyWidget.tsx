"use client";

/**
 * FitnessLobbyWidget — 4K premium smart-lounge / concierge scene, 3840x2160 (Lobby theme).
 *
 * APPROVED 2026-05-03 — matches scratch/design/fitness/15-lobby.html
 * Ported via HsStage transform:scale pattern. Every pixel size is
 * FIXED (matches the HTML mockup); DO NOT regress to vw/%.
 *
 * Visual DNA — boutique-hotel concierge:
 *   - Warm dark base (#1a160e -> #0a0805) with vignette
 *   - Brass #c89e54 + emerald #2d7a5e + paper-cream #f1ead8 palette
 *   - Cormorant Garamond italic display + Inter body + JetBrains Mono labels
 *   - Hairline brass dividers, never heavy boxes
 *   - Hero greeting (left): pre-label, italic name, prose body, 3 stat columns
 *   - Recovery booking grid (right): 4 rooms × 6 slot tiles (taken/you/closed states)
 *   - Below: 3 concierge cards (tea / event / valet)
 *   - Foot ribbon: extension numbers for desk / spa / etc.
 */

import { HsStage } from '../hs/HsStage';

export interface FitnessLobbyConfig {
  // Header
  'head.t1'?: string;
  'head.t2'?: string;
  'head.lab'?: string;
  'head.v'?: string;
  // Greeting hero
  'greet.pre'?: string;
  'greet.t1'?: string;
  'greet.t2'?: string;
  'greet.body'?: string;
  'greet.l1'?: string;
  'greet.v1'?: string;
  'greet.u1'?: string;
  'greet.l2'?: string;
  'greet.v2'?: string;
  'greet.u2'?: string;
  'greet.l3'?: string;
  'greet.v3'?: string;
  'greet.u3'?: string;
  // Recovery rooms
  'rec.lab'?: string;
  'rec.t1'?: string;
  'rec.t2'?: string;
  // Room 1
  'rec.r1n'?: string;
  'rec.r1m'?: string;
  'rec.r1s1'?: string;
  'rec.r1s2'?: string;
  'rec.r1s3'?: string;
  'rec.r1s4'?: string;
  'rec.r1s5'?: string;
  'rec.r1s6'?: string;
  'rec.r1stat'?: string;
  // Room 2
  'rec.r2n'?: string;
  'rec.r2m'?: string;
  'rec.r2s1'?: string;
  'rec.r2s2'?: string;
  'rec.r2s3'?: string;
  'rec.r2s4'?: string;
  'rec.r2s5'?: string;
  'rec.r2s6'?: string;
  'rec.r2stat'?: string;
  // Room 3
  'rec.r3n'?: string;
  'rec.r3m'?: string;
  'rec.r3s1'?: string;
  'rec.r3s2'?: string;
  'rec.r3s3'?: string;
  'rec.r3s4'?: string;
  'rec.r3s5'?: string;
  'rec.r3s6'?: string;
  'rec.r3stat'?: string;
  // Room 4
  'rec.r4n'?: string;
  'rec.r4m'?: string;
  'rec.r4s1'?: string;
  'rec.r4s2'?: string;
  'rec.r4s3'?: string;
  'rec.r4s4'?: string;
  'rec.r4s5'?: string;
  'rec.r4s6'?: string;
  'rec.r4stat'?: string;
  // News card
  'news.lab'?: string;
  'news.t1'?: string;
  'news.t2'?: string;
  'news.body'?: string;
  'news.meta'?: string;
  // Event card
  'event.lab'?: string;
  'event.t1'?: string;
  'event.t2'?: string;
  'event.body'?: string;
  'event.meta'?: string;
  // Valet card
  'valet.lab'?: string;
  'valet.t1'?: string;
  'valet.t2'?: string;
  'valet.body'?: string;
  'valet.meta'?: string;
  // Foot
  'foot.l1'?: string;
  'foot.l2'?: string;
  'foot.l3'?: string;
  'foot.l4'?: string;
  'foot.l5'?: string;
}

/* eslint-disable @typescript-eslint/quotes */
export const DEFAULTS: Record<string, string> = {
  'head.t1':      'The ',
  'head.t2':      'Lounge.',
  'head.lab':     '★ TUESDAY · MARCH 18 · 6:14 AM',
  'head.v':       'Sunrise on the deck at 7:14.',

  'greet.pre':    '▸ NOW WELCOMING',
  'greet.t1':     'Good morning, ',
  'greet.t2':     'Eleanor.',
  'greet.body':   'Your reformer at <b>6:30 AM</b> is locked at station 04 with Annika. The infrared sauna is held for you at <b>7:45</b>. A double oat flat white will be at the bar after class — same as Tuesday.',
  'greet.l1':     '▸ STREAK',
  'greet.v1':     '42',
  'greet.u1':     'DAYS · BEST 51',
  'greet.l2':     '▸ TIER',
  'greet.v2':     'PLATINUM',
  'greet.u2':     'RENEWS 12·14',
  'greet.l3':     '▸ CREDITS',
  'greet.v3':     '7',
  'greet.u3':     'RECOVERY · MAR',

  'rec.lab':      '▸ RECOVERY ROOMS · TODAY',
  'rec.t1':       'Hold a ',
  'rec.t2':       'slot.',

  'rec.r1n':      'Infrared Sauna',
  'rec.r1m':      'DECK 2 · 30 MIN BLOCKS · 6A–10P',
  'rec.r1s1':     '6:30',
  'rec.r1s2':     '7:00',
  'rec.r1s3':     '7:45',
  'rec.r1s4':     '8:30',
  'rec.r1s5':     '9:00',
  'rec.r1s6':     '9:30',
  'rec.r1stat':   '▸ HELD FOR YOU',

  'rec.r2n':      'Cold Plunge',
  'rec.r2m':      'DECK 1 · 50°F · 10 MIN MAX',
  'rec.r2s1':     '6:30',
  'rec.r2s2':     '7:00',
  'rec.r2s3':     '7:30',
  'rec.r2s4':     '8:00',
  'rec.r2s5':     '8:30',
  'rec.r2s6':     '9:00',
  'rec.r2stat':   '▸ 4 OPEN',

  'rec.r3n':      'Massage Suite',
  'rec.r3m':      'DECK 3 · 30/60/90 MIN',
  'rec.r3s1':     '8:00',
  'rec.r3s2':     '9:30',
  'rec.r3s3':     '11:00',
  'rec.r3s4':     '1:00',
  'rec.r3s5':     '2:30',
  'rec.r3s6':     '4:00',
  'rec.r3stat':   '▸ 3 OPEN',

  'rec.r4n':      'Cryo Chamber',
  'rec.r4m':      'DECK 1 · 3 MIN · −220°F',
  'rec.r4s1':     '6:30',
  'rec.r4s2':     '7:00',
  'rec.r4s3':     '10:00',
  'rec.r4s4':     '10:30',
  'rec.r4s5':     '11:00',
  'rec.r4s6':     '11:30',
  'rec.r4stat':   '▸ MAINT 6–10A',

  'news.lab':     '▸ ON THE DECK',
  'news.t1':      'Tea ',
  'news.t2':      'service.',
  'news.body':    'The hot bar is pouring <b>matcha</b>, <b>jasmine</b>, and <b>genmaicha</b> until 11. Cold-press greens at the juice counter all morning.',
  'news.meta':    '▸ COMP TO PLATINUM · ALL DAY',

  'event.lab':    '▸ THIS EVENING',
  'event.t1':     "Founders' ",
  'event.t2':     'Salon.',
  'event.body':   'A conversation with our head of programming on the Q3 retreat. Wine + small plates from Hearth. RSVP at the desk.',
  'event.meta':   '▸ TUE 7:00 PM · LIBRARY · 24 SEATS',

  'valet.lab':    '▸ VALET / TRANSIT',
  'valet.t1':     'Easy ',
  'valet.t2':     'exit.',
  'valet.body':   "Black SUV at the front circle whenever you're ready. Northbound express train every <b>8 minutes</b> from the corner.",
  'valet.meta':   '▸ ASK AT THE DESK · < 4 MIN',

  'foot.l1':      '★ FRONT DESK <b>X1</b>',
  'foot.l2':      'CONCIERGE <b>X2</b>',
  'foot.l3':      'SPA <b>X3</b>',
  'foot.l4':      'RIDE HAIL <b>QR · LEFT</b>',
  'foot.l5':      'WIFI <b>LOUNGE-GUEST</b>',
};
/* eslint-enable @typescript-eslint/quotes */

function pick(cfg: FitnessLobbyConfig | undefined, key: keyof typeof DEFAULTS): string {
  return ((cfg as any)?.[key] as string | undefined) ?? DEFAULTS[key];
}

// Slot states from the HTML mockup. Room 1: taken/taken/you/open/open/open;
// Room 2: taken/open/open/taken/open/open; Room 3: taken/taken/open/taken/open/open;
// Room 4: closed/closed/open/open/open/open.
const SLOT_STATES: Record<string, string> = {
  'r1.1': 'taken', 'r1.2': 'taken', 'r1.3': 'you',   'r1.4': '',      'r1.5': '',      'r1.6': '',
  'r2.1': 'taken', 'r2.2': '',      'r2.3': '',      'r2.4': 'taken', 'r2.5': '',      'r2.6': '',
  'r3.1': 'taken', 'r3.2': 'taken', 'r3.3': '',      'r3.4': 'taken', 'r3.5': '',      'r3.6': '',
  'r4.1': 'closed','r4.2': 'closed','r4.3': '',      'r4.4': '',      'r4.5': '',      'r4.6': '',
};

function slotClass(roomIdx: number, slotIdx: number): string {
  const key = `r${roomIdx}.${slotIdx}`;
  const state = SLOT_STATES[key];
  return state ? `fb-slot fb-slot-${state}` : 'fb-slot';
}

interface RoomProps {
  config?: FitnessLobbyConfig;
  idx: 1 | 2 | 3 | 4;
}

function Room({ config, idx }: RoomProps) {
  const nKey = `rec.r${idx}n` as keyof typeof DEFAULTS;
  const mKey = `rec.r${idx}m` as keyof typeof DEFAULTS;
  const statKey = `rec.r${idx}stat` as keyof typeof DEFAULTS;
  return (
    <div className="fb-room">
      <div className="fb-rm-nm" data-field={nKey}>
        {pick(config, nKey)}
        <small data-field={mKey}>{pick(config, mKey)}</small>
      </div>
      <div className="fb-slots">
        {[1, 2, 3, 4, 5, 6].map((s) => {
          const sKey = `rec.r${idx}s${s}` as keyof typeof DEFAULTS;
          return (
            <div key={s} className={slotClass(idx, s)} data-field={sKey}>
              {pick(config, sKey)}
            </div>
          );
        })}
      </div>
      <div className="fb-stat" data-field={statKey}>{pick(config, statKey)}</div>
    </div>
  );
}

export function FitnessLobbyWidget({ config }: { config?: FitnessLobbyConfig }) {
  return (
    <HsStage stageClassName="fb-stage" stageStyle={{ background: '#13100c', color: '#f1ead8', fontFamily: "'Inter', system-ui, sans-serif", fontWeight: 300 }}>
      <style>{CSS}</style>

      {/* Header */}
      <div className="fb-head">
        <div className="fb-lg">
          <span data-field="head.t1">{pick(config, 'head.t1')}</span>
          <em data-field="head.t2">{pick(config, 'head.t2')}</em>
        </div>
        <div className="fb-head-r">
          <div className="fb-lab" data-field="head.lab">{pick(config, 'head.lab')}</div>
          <div className="fb-v" data-field="head.v">{pick(config, 'head.v')}</div>
        </div>
      </div>

      {/* Greeting hero */}
      <div className="fb-greet">
        <div className="fb-pre" data-field="greet.pre">{pick(config, 'greet.pre')}</div>
        <h1 className="fb-h1">
          <span data-field="greet.t1">{pick(config, 'greet.t1')}</span>
          <em data-field="greet.t2">{pick(config, 'greet.t2')}</em>
        </h1>
        <div
          className="fb-greet-body"
          data-field="greet.body"
          dangerouslySetInnerHTML={{ __html: pick(config, 'greet.body') }}
        />
        <div className="fb-stats">
          <div className="fb-s">
            <div className="fb-s-lab" data-field="greet.l1">{pick(config, 'greet.l1')}</div>
            <div className="fb-s-v" data-field="greet.v1">{pick(config, 'greet.v1')}</div>
            <div className="fb-s-u" data-field="greet.u1">{pick(config, 'greet.u1')}</div>
          </div>
          <div className="fb-s">
            <div className="fb-s-lab" data-field="greet.l2">{pick(config, 'greet.l2')}</div>
            <div className="fb-s-v" data-field="greet.v2">{pick(config, 'greet.v2')}</div>
            <div className="fb-s-u" data-field="greet.u2">{pick(config, 'greet.u2')}</div>
          </div>
          <div className="fb-s">
            <div className="fb-s-lab" data-field="greet.l3">{pick(config, 'greet.l3')}</div>
            <div className="fb-s-v" data-field="greet.v3">{pick(config, 'greet.v3')}</div>
            <div className="fb-s-u" data-field="greet.u3">{pick(config, 'greet.u3')}</div>
          </div>
        </div>
      </div>

      {/* Recovery grid */}
      <div className="fb-rec">
        <div className="fb-lab" data-field="rec.lab">{pick(config, 'rec.lab')}</div>
        <h2 className="fb-h2">
          <span data-field="rec.t1">{pick(config, 'rec.t1')}</span>
          <em data-field="rec.t2">{pick(config, 'rec.t2')}</em>
        </h2>
        <Room config={config} idx={1} />
        <Room config={config} idx={2} />
        <Room config={config} idx={3} />
        <Room config={config} idx={4} />
      </div>

      {/* Below cards */}
      <div className="fb-below">
        <div className="fb-card">
          <div className="fb-lab" data-field="news.lab">{pick(config, 'news.lab')}</div>
          <h3 className="fb-h3">
            <span data-field="news.t1">{pick(config, 'news.t1')}</span>
            <em data-field="news.t2">{pick(config, 'news.t2')}</em>
          </h3>
          <div className="fb-body" data-field="news.body" dangerouslySetInnerHTML={{ __html: pick(config, 'news.body') }} />
          <div className="fb-meta" data-field="news.meta">{pick(config, 'news.meta')}</div>
        </div>
        <div className="fb-card">
          <div className="fb-lab" data-field="event.lab">{pick(config, 'event.lab')}</div>
          <h3 className="fb-h3">
            <span data-field="event.t1">{pick(config, 'event.t1')}</span>
            <em data-field="event.t2">{pick(config, 'event.t2')}</em>
          </h3>
          <div className="fb-body" data-field="event.body" dangerouslySetInnerHTML={{ __html: pick(config, 'event.body') }} />
          <div className="fb-meta" data-field="event.meta">{pick(config, 'event.meta')}</div>
        </div>
        <div className="fb-card">
          <div className="fb-lab" data-field="valet.lab">{pick(config, 'valet.lab')}</div>
          <h3 className="fb-h3">
            <span data-field="valet.t1">{pick(config, 'valet.t1')}</span>
            <em data-field="valet.t2">{pick(config, 'valet.t2')}</em>
          </h3>
          <div className="fb-body" data-field="valet.body" dangerouslySetInnerHTML={{ __html: pick(config, 'valet.body') }} />
          <div className="fb-meta" data-field="valet.meta">{pick(config, 'valet.meta')}</div>
        </div>
      </div>

      {/* Foot */}
      <div className="fb-foot">
        <div data-field="foot.l1" dangerouslySetInnerHTML={{ __html: pick(config, 'foot.l1') }} />
        <div className="fb-foot-div" />
        <div data-field="foot.l2" dangerouslySetInnerHTML={{ __html: pick(config, 'foot.l2') }} />
        <div className="fb-foot-div" />
        <div data-field="foot.l3" dangerouslySetInnerHTML={{ __html: pick(config, 'foot.l3') }} />
        <div className="fb-foot-div" />
        <div data-field="foot.l4" dangerouslySetInnerHTML={{ __html: pick(config, 'foot.l4') }} />
        <div className="fb-foot-div" />
        <div data-field="foot.l5" dangerouslySetInnerHTML={{ __html: pick(config, 'foot.l5') }} />
      </div>
    </HsStage>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,700;1,400&family=Inter:wght@300;400;500;700&family=JetBrains+Mono:wght@400;500&display=swap');

.fb-stage {
  background:
    radial-gradient(1500px 1000px at 20% 10%, rgba(200,158,84,.10), transparent 60%),
    radial-gradient(1300px 900px at 85% 90%, rgba(45,122,94,.10), transparent 60%),
    linear-gradient(180deg, #1a160e 0%, #0a0805 100%);
}
.fb-stage::before {
  content: '';
  position: absolute;
  top: 0; right: 0; bottom: 0; left: 0;
  pointer-events: none;
  background-image: radial-gradient(circle at center, transparent 60%, rgba(0,0,0,.4) 100%);
}

.fb-head {
  position: absolute; top: 80px; left: 120px; right: 120px;
  display: flex; justify-content: space-between; align-items: flex-end;
  padding-bottom: 30px; border-bottom: 1px solid #c89e54;
}
.fb-lg {
  font-family: 'Cormorant Garamond'; font-style: italic; font-weight: 400;
  font-size: 160px; line-height: .85; letter-spacing: -.02em;
}
.fb-lg em { font-style: italic; color: #c89e54; }
.fb-head-r { text-align: right; }
.fb-head-r .fb-lab {
  font-family: 'JetBrains Mono'; font-size: 24px; letter-spacing: .32em;
  color: #c89e54;
}
.fb-head-r .fb-v {
  font-family: 'Cormorant Garamond'; font-style: italic; font-size: 54px;
  color: #f1ead8; margin-top: 6px;
}

.fb-greet {
  position: absolute; top: 340px; left: 120px; width: 1900px;
}
.fb-pre {
  font-family: 'JetBrains Mono'; font-size: 30px; letter-spacing: .4em;
  color: #c89e54;
}
.fb-h1 {
  font-family: 'Cormorant Garamond'; font-weight: 400; font-size: 240px;
  line-height: .85; letter-spacing: -.03em; margin: 30px 0 0;
}
.fb-h1 em { font-style: italic; color: #c89e54; }
.fb-greet-body {
  font-family: 'Cormorant Garamond'; font-style: italic; font-weight: 400;
  font-size: 54px; line-height: 1.3; color: #f1ead8;
  margin-top: 36px; max-width: 1700px;
}
.fb-greet-body b {
  font-style: normal; font-family: 'Inter'; font-weight: 500; color: #c89e54;
}
.fb-stats {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px; margin-top: 50px;
}
.fb-s {
  border-top: 1px solid #c89e54; padding: 18px 4px 0;
}
.fb-s-lab {
  font-family: 'JetBrains Mono'; font-size: 22px; letter-spacing: .28em;
  color: #9b8e72;
}
.fb-s-v {
  font-family: 'Cormorant Garamond'; font-style: italic; font-size: 96px;
  line-height: .9; color: #c89e54; margin-top: 10px;
}
.fb-s-u {
  font-family: 'JetBrains Mono'; font-size: 22px; letter-spacing: .18em;
  color: #f1ead8; margin-top: 4px;
}

.fb-rec {
  position: absolute; top: 340px; right: 120px; width: 1500px;
  background: rgba(241,234,216,.04); border: 1px solid #c89e54;
  padding: 50px 56px;
}
.fb-rec .fb-lab {
  font-family: 'JetBrains Mono'; font-size: 28px; letter-spacing: .32em;
  color: #c89e54;
}
.fb-h2 {
  font-family: 'Cormorant Garamond'; font-weight: 400; font-size: 90px;
  line-height: .85; margin: 14px 0 24px;
}
.fb-h2 em { font-style: italic; color: #5fb595; }

.fb-room {
  display: grid; grid-template-columns: 240px 1fr 200px; gap: 30px;
  padding: 20px 0; align-items: center;
  border-bottom: 1px solid rgba(200,158,84,.3);
}
.fb-room:last-child { border-bottom: 0; }
.fb-rm-nm {
  font-family: 'Cormorant Garamond'; font-style: italic; font-size: 60px;
  line-height: .95; color: #f1ead8;
}
.fb-rm-nm small {
  display: block; font-family: 'JetBrains Mono'; font-style: normal;
  font-size: 22px; letter-spacing: .18em; color: #9b8e72; margin-top: 4px;
}
.fb-slots { display: flex; gap: 6px; flex-wrap: wrap; }
.fb-slot {
  width: 62px; height: 54px; display: grid; place-items: center;
  font-family: 'JetBrains Mono'; font-size: 22px; font-weight: 500;
  letter-spacing: .05em; border: 1px solid #c89e54; color: #f1ead8;
}
.fb-slot-taken { background: #c89e54; color: #13100c; }
.fb-slot-you { background: #2d7a5e; color: #fff; border-color: #5fb595; }
.fb-slot-closed {
  background: rgba(0,0,0,.3); color: #9b8e72;
  border-color: rgba(155,142,114,.3); text-decoration: line-through;
}
.fb-stat {
  font-family: 'JetBrains Mono'; font-size: 28px; letter-spacing: .18em;
  color: #c89e54; text-align: right;
}

.fb-below {
  position: absolute; left: 120px; right: 120px; bottom: 160px;
  display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 36px;
}
.fb-card {
  background: rgba(241,234,216,.05); border: 1px solid #c89e54;
  padding: 34px 40px;
}
.fb-card .fb-lab {
  font-family: 'JetBrains Mono'; font-size: 24px; letter-spacing: .32em;
  color: #c89e54;
}
.fb-h3 {
  font-family: 'Cormorant Garamond'; font-weight: 400; font-size: 64px;
  line-height: .9; margin: 14px 0 16px;
}
.fb-h3 em { font-style: italic; color: #5fb595; }
.fb-body {
  font-family: 'Inter'; font-weight: 300; font-size: 32px; line-height: 1.4;
  color: #f1ead8;
}
.fb-body b { color: #c89e54; font-weight: 500; }
.fb-meta {
  font-family: 'JetBrains Mono'; font-size: 26px; letter-spacing: .18em;
  color: #c89e54; margin-top: 18px;
}

.fb-foot {
  position: absolute; left: 0; right: 0; bottom: 0; height: 120px;
  background: #0a0805; color: #c89e54;
  display: flex; align-items: center; padding: 0 120px; gap: 48px;
  font-family: 'JetBrains Mono'; font-size: 30px; letter-spacing: .28em;
  border-top: 1px solid #c89e54;
}
.fb-foot b { color: #f1ead8; }
.fb-foot-div {
  width: 1px; align-self: stretch; background: #c89e54; margin: 30px 0;
}
`;
