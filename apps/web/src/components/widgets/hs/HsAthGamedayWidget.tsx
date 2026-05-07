"use client";

/**
 * HsAthGamedayWidget — Athletics game-day stadium board, 3840×2160.
 *
 * Hero matchup (US vs THEM helmets), live countdown to kickoff,
 * a 6-team "All Wildcats today" grid with live/final/upcoming
 * statuses, fan info row (tickets, theme, gates, concessions,
 * stream), and a scrolling PA ticker.
 *
 * APPROVED 2026-05-07 — matches scratch/design/hs-district/hs-district-pack/ath-gameday.html
 * Operator: "these need to be wired in for the highschools"
 *
 * Editable widget regions (each contenteditable through BuilderZone's
 * dotted-key setByPath handler):
 *   - crest                     → school initial letter
 *   - school.{nm,sub}           → school name + sub-line
 *   - title.{t1,t2,t3}          → big headline split into 3 spans (t2 is accent)
 *   - rt.{badge,clock}          → "It's on" badge + live clock
 *   - us.{letter,label,name,mascot,rec,streak,rank}      → home team
 *   - them.{letter,label,name,mascot,rec,streak,rank}    → away team
 *   - vs.{text,when,where,weather}                       → matchup details
 *   - cd.{h,m,s}                → countdown segments
 *   - spread.{k,v,k2,v2}        → last meeting + series tally
 *   - strip.0..4 (k, v, s)      → 5 mid-row stats (captains, last5, PPG, coach)
 *   - teams.{title,meta}        → "All Wildcats today" header
 *   - t.0..5 (sport, b, opp, when, score)  → 6 contests in the grid
 *   - f.0..4 (k, v, s)          → 5 fan info tiles
 *   - ticker.{tag,message,message2}        → scrolling PA strip
 *
 * Live clock: rt.clock ticks via useHsLiveClock unless operator
 * overrides. Same pattern as HsVarsityWidget.
 */

import { HsStage } from './HsStage';
import { useHsLiveClock } from './useHsLiveClock';

export interface HsAthGamedayConfig {
  'crest.letter'?: string;
  'school.nm'?: string;
  'school.sub'?: string;
  'title.t1'?: string;
  'title.t2'?: string;
  'title.t3'?: string;
  'rt.badge'?: string;
  'rt.clock'?: string;
  'us.letter'?: string;
  'us.label'?: string;
  'us.name'?: string;
  'us.mascot'?: string;
  'us.rec'?: string;
  'us.streak'?: string;
  'us.rank'?: string;
  'vs.text'?: string;
  'vs.when'?: string;
  'vs.where'?: string;
  'vs.weather'?: string;
  'cd.h'?: string;
  'cd.m'?: string;
  'cd.s'?: string;
  'them.letter'?: string;
  'them.label'?: string;
  'them.name'?: string;
  'them.mascot'?: string;
  'them.rec'?: string;
  'them.streak'?: string;
  'them.rank'?: string;
  'spread.k'?: string;
  'spread.v'?: string;
  'spread.k2'?: string;
  'spread.v2'?: string;
  'strip.0.k'?: string;
  'strip.0.v'?: string;
  'strip.1.k'?: string;
  'strip.2.k'?: string;
  'strip.2.v'?: string;
  'strip.2.s'?: string;
  'strip.3.k'?: string;
  'strip.3.v'?: string;
  'strip.3.s'?: string;
  'strip.4.k'?: string;
  'strip.4.v'?: string;
  'strip.4.s'?: string;
  'teams.title'?: string;
  'teams.meta'?: string;
  't.0.sport'?: string;
  't.0.b'?: string;
  't.0.opp'?: string;
  't.0.when'?: string;
  't.0.score'?: string;
  't.1.sport'?: string;
  't.1.b'?: string;
  't.1.opp'?: string;
  't.1.when'?: string;
  't.2.sport'?: string;
  't.2.b'?: string;
  't.2.opp'?: string;
  't.2.when'?: string;
  't.3.sport'?: string;
  't.3.b'?: string;
  't.3.opp'?: string;
  't.3.when'?: string;
  't.4.sport'?: string;
  't.4.b'?: string;
  't.4.opp'?: string;
  't.4.when'?: string;
  't.4.score'?: string;
  't.5.sport'?: string;
  't.5.b'?: string;
  't.5.opp'?: string;
  't.5.when'?: string;
  'f.0.k'?: string;
  'f.0.v'?: string;
  'f.0.s'?: string;
  'f.1.k'?: string;
  'f.1.v'?: string;
  'f.1.s'?: string;
  'f.2.k'?: string;
  'f.2.v'?: string;
  'f.2.s'?: string;
  'f.3.k'?: string;
  'f.3.v'?: string;
  'f.3.s'?: string;
  'f.4.k'?: string;
  'f.4.v'?: string;
  'f.4.s'?: string;
  'ticker.tag'?: string;
  'ticker.message'?: string;
  'ticker.message2'?: string;
}

export const DEFAULTS: Required<HsAthGamedayConfig> = {
  'crest.letter': 'W',
  'school.nm': 'Westridge Wildcats',
  'school.sub': 'Athletics · 2025–26 · Region 4A',
  'title.t1': 'Game ',
  'title.t2': 'Day',
  'title.t3': ' · Friday Night.',
  'rt.badge': "It's on",
  'rt.clock': '2:14 pm',
  'us.letter': 'W',
  'us.label': 'Home · Wildcats',
  'us.name': 'Westridge',
  'us.mascot': 'The Wildcats · est. 1956',
  'us.rec': '6–1',
  'us.streak': 'W4',
  'us.rank': '#3',
  'vs.text': 'VS',
  'vs.when': 'Tonight · 7:00 pm · Kickoff',
  'vs.where': 'Wildcat Stadium · Gate B opens 5:30',
  'vs.weather': 'Clear · 58°F · light wind out of the NW',
  'cd.h': '06',
  'cd.m': '14',
  'cd.s': '22',
  'them.letter': 'N',
  'them.label': 'Away · Northgate',
  'them.name': 'Northgate',
  'them.mascot': 'The Knights · est. 1962',
  'them.rec': '5–2',
  'them.streak': 'L1',
  'them.rank': '#7',
  'spread.k': 'Last meeting',
  'spread.v': 'WHS 28 — NHS 21 · 2024',
  'spread.k2': 'Series',
  'spread.v2': 'WHS leads 18–14',
  'strip.0.k': 'Captains tonight',
  'strip.0.v': '#7 · #54 · #11',
  'strip.1.k': 'Last 5',
  'strip.2.k': 'PPG · for',
  'strip.2.v': '31.4',
  'strip.2.s': '/ game',
  'strip.3.k': 'PPG · against',
  'strip.3.v': '17.8',
  'strip.3.s': '/ game',
  'strip.4.k': 'Coach',
  'strip.4.v': 'D. Halloran',
  'strip.4.s': '9th season',
  'teams.title': 'All Wildcats today · 6 contests',
  'teams.meta': "Live updates from the AD's office",
  't.0.sport': 'G Volleyball · V',
  't.0.b': 'Home',
  't.0.opp': 'vs Eastlake',
  't.0.when': 'Final · ',
  't.0.score': '3–1',
  't.1.sport': 'B Soccer · V',
  't.1.b': 'Away',
  't.1.opp': '@ Lincoln',
  't.1.when': "Live · 2H · 65'",
  't.2.sport': 'Football · V',
  't.2.b': 'Home',
  't.2.opp': 'vs Northgate',
  't.2.when': '7:00 pm',
  't.3.sport': 'G Soccer · JV',
  't.3.b': 'Home',
  't.3.opp': 'vs Northgate',
  't.3.when': '5:00 pm',
  't.4.sport': 'XC · V mixed',
  't.4.b': 'Away',
  't.4.opp': '@ County Inv.',
  't.4.when': 'Final · ',
  't.4.score': '2nd / 14',
  't.5.sport': 'Cheer + Band',
  't.5.b': 'Home',
  't.5.opp': 'Halftime show',
  't.5.when': '~8:30 pm',
  'f.0.k': 'Tickets',
  'f.0.v': '$5 student · $8 adult',
  'f.0.s': 'Free w/ ASB sticker · cash or tap',
  'f.1.k': 'Theme',
  'f.1.v': 'White-out the stands',
  'f.1.s': 'Wear white head-to-toe · senior night',
  'f.2.k': 'Gates',
  'f.2.v': 'Open 5:30 · Gate B',
  'f.2.s': 'Clear bag policy in effect tonight',
  'f.3.k': 'Concessions',
  'f.3.v': 'Booster grill is hot',
  'f.3.s': 'Burgers · dogs · hot cocoa · all ages',
  'f.4.k': 'Stream',
  'f.4.v': 'NFHS Network · live',
  'f.4.s': 'Free for WHS families · code at the office',
  'ticker.tag': 'Game day',
  'ticker.message': 'Senior night · 17 seniors honored at 6:45 — meet your athletes on the field · WHITE-OUT the stands · clear bag policy in effect · NFHS Network livestream free for WHS families · cheer block in section 8 · band performs at halftime · post-game tailgate in lot C with the boosters · drive home safe Wildcats',
  'ticker.message2': 'Senior night · 17 seniors honored at 6:45 — meet your athletes on the field · WHITE-OUT the stands · clear bag policy in effect · NFHS Network livestream free for WHS families · cheer block in section 8 · band performs at halftime · post-game tailgate in lot C with the boosters · drive home safe Wildcats',
};

export function HsAthGamedayWidget({ config, live }: { config?: HsAthGamedayConfig; live?: boolean }) {
  const c = { ...DEFAULTS, ...(config || {}) } as Required<HsAthGamedayConfig>;
  // Live clock — replaces the placeholder "2:14 pm" so demo wall
  // shows real time. Operator can override rt.clock for marketing
  // screenshots and the override is preserved.
  const now = useHsLiveClock(live !== false);
  const liveClockText =
    c['rt.clock'] === DEFAULTS['rt.clock']
      ? now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
      : c['rt.clock'];
  const wrap: React.CSSProperties = { whiteSpace: 'pre-wrap' as const };
  return (
    <HsStage
      stageStyle={{
        background: '#0a0e1a',
        fontFamily: "'Oswald', sans-serif",
        color: '#fff',
      }}
    >
      <style>{CSS}</style>

      <div className="hs-ath-gd-bgfx" />

      {/* HEADER */}
      <header className="head">
        <div className="left">
          <div className="crest" data-widget="crest">
            <span data-field="crest.letter" style={wrap}>{c['crest.letter']}</span>
          </div>
          <div className="school" data-widget="school">
            <div className="nm" data-field="school.nm" style={wrap}>{c['school.nm']}</div>
            <div className="sub" data-field="school.sub" style={wrap}>{c['school.sub']}</div>
          </div>
        </div>
        <h1 data-widget="title">
          <span data-field="title.t1" style={wrap}>{c['title.t1']}</span>
          <span className="acc" data-field="title.t2" style={wrap}>{c['title.t2']}</span>
          <span data-field="title.t3" style={wrap}>{c['title.t3']}</span>
        </h1>
        <div className="right" data-widget="rt">
          <div className="badge" data-field="rt.badge" style={wrap}>{c['rt.badge']}</div>
          <div className="clock" data-field="rt.clock" style={wrap}>{liveClockText}</div>
        </div>
      </header>

      {/* HERO MATCHUP */}
      <section className="hero" data-widget="hero">
        <div className="team us">
          <div className="helmet" data-field="us.letter" style={wrap}>{c['us.letter']}</div>
          <div className="label" data-field="us.label" style={wrap}>{c['us.label']}</div>
          <div className="name" data-field="us.name" style={wrap}>{c['us.name']}</div>
          <div className="mascot" data-field="us.mascot" style={wrap}>{c['us.mascot']}</div>
          <div className="stats">
            <div className="s"><div className="k">Record</div><div className="v win" data-field="us.rec" style={wrap}>{c['us.rec']}</div></div>
            <div className="s"><div className="k">Streak</div><div className="v win" data-field="us.streak" style={wrap}>{c['us.streak']}</div></div>
            <div className="s"><div className="k">Rank</div><div className="v" data-field="us.rank" style={wrap}>{c['us.rank']}</div></div>
          </div>
        </div>

        <div className="vs">
          <div className="vsbig" data-field="vs.text" style={wrap}>{c['vs.text']}</div>
          <div className="countdown" data-widget="cd">
            <div className="seg"><div className="n" data-field="cd.h" style={wrap}>{c['cd.h']}</div><div className="l">Hours</div></div>
            <div className="seg"><div className="n" data-field="cd.m" style={wrap}>{c['cd.m']}</div><div className="l">Minutes</div></div>
            <div className="seg"><div className="n" data-field="cd.s" style={wrap}>{c['cd.s']}</div><div className="l">Seconds</div></div>
          </div>
          <div className="when" data-field="vs.when" style={wrap}>{c['vs.when']}</div>
          <div className="where">
            <span data-field="vs.where" style={wrap}>{c['vs.where']}</span>
            <small data-field="vs.weather" style={wrap}>{c['vs.weather']}</small>
          </div>
        </div>

        <div className="team them">
          <div className="helmet" data-field="them.letter" style={wrap}>{c['them.letter']}</div>
          <div className="label" data-field="them.label" style={wrap}>{c['them.label']}</div>
          <div className="name" data-field="them.name" style={wrap}>{c['them.name']}</div>
          <div className="mascot" data-field="them.mascot" style={wrap}>{c['them.mascot']}</div>
          <div className="stats">
            <div className="s"><div className="k">Record</div><div className="v" data-field="them.rec" style={wrap}>{c['them.rec']}</div></div>
            <div className="s"><div className="k">Streak</div><div className="v loss" data-field="them.streak" style={wrap}>{c['them.streak']}</div></div>
            <div className="s"><div className="k">Rank</div><div className="v" data-field="them.rank" style={wrap}>{c['them.rank']}</div></div>
          </div>
        </div>

        <div className="spread" data-widget="spread">
          <span data-field="spread.k" style={wrap}>{c['spread.k']}</span>
          <span className="v" data-field="spread.v" style={wrap}>{c['spread.v']}</span>
          <span data-field="spread.k2" style={wrap}>{c['spread.k2']}</span>
          <span className="v" data-field="spread.v2" style={wrap}>{c['spread.v2']}</span>
        </div>
      </section>

      {/* MIDDLE STRIP */}
      <section className="strip">
        <div className="stat us" data-widget="strip.0">
          <div className="k" data-field="strip.0.k" style={wrap}>{c['strip.0.k']}</div>
          <div className="v" data-field="strip.0.v" style={wrap}>{c['strip.0.v']}</div>
        </div>
        <div className="stat" data-widget="strip.1">
          <div className="k" data-field="strip.1.k" style={wrap}>{c['strip.1.k']}</div>
          <div className="v">
            <span className="pills" data-widget="strip.1.pills">
              <span className="w">W</span><span className="w">W</span><span className="l">L</span><span className="w">W</span><span className="w">W</span>
            </span>
          </div>
        </div>
        <div className="stat win" data-widget="strip.2">
          <div className="k" data-field="strip.2.k" style={wrap}>{c['strip.2.k']}</div>
          <div className="v">
            <span data-field="strip.2.v" style={wrap}>{c['strip.2.v']}</span>{' '}
            <small data-field="strip.2.s" style={wrap}>{c['strip.2.s']}</small>
          </div>
        </div>
        <div className="stat" data-widget="strip.3">
          <div className="k" data-field="strip.3.k" style={wrap}>{c['strip.3.k']}</div>
          <div className="v">
            <span data-field="strip.3.v" style={wrap}>{c['strip.3.v']}</span>{' '}
            <small data-field="strip.3.s" style={wrap}>{c['strip.3.s']}</small>
          </div>
        </div>
        <div className="stat" data-widget="strip.4">
          <div className="k" data-field="strip.4.k" style={wrap}>{c['strip.4.k']}</div>
          <div className="v">
            <span data-field="strip.4.v" style={wrap}>{c['strip.4.v']}</span>{' '}
            <small data-field="strip.4.s" style={wrap}>{c['strip.4.s']}</small>
          </div>
        </div>
      </section>

      {/* TODAY ALL TEAMS */}
      <section className="teams">
        <div className="head">
          <h2 data-field="teams.title" style={wrap}>{c['teams.title']}</h2>
          <div className="meta" data-field="teams.meta" style={wrap}>{c['teams.meta']}</div>
        </div>
        <div className="grid">
          <div className="row final" data-widget="t.0">
            <div className="top">
              <div className="sport" data-field="t.0.sport" style={wrap}>{c['t.0.sport']}</div>
              <div className="badge h" data-field="t.0.b" style={wrap}>{c['t.0.b']}</div>
            </div>
            <div className="opp" data-field="t.0.opp" style={wrap}>{c['t.0.opp']}</div>
            <div className="when">
              <span data-field="t.0.when" style={wrap}>{c['t.0.when']}</span>
              <span className="score" data-field="t.0.score" style={wrap}>{c['t.0.score']}</span>
            </div>
          </div>
          <div className="row live" data-widget="t.1">
            <div className="top">
              <div className="sport" data-field="t.1.sport" style={wrap}>{c['t.1.sport']}</div>
              <div className="badge a" data-field="t.1.b" style={wrap}>{c['t.1.b']}</div>
            </div>
            <div className="opp" data-field="t.1.opp" style={wrap}>{c['t.1.opp']}</div>
            <div className="when">
              <span data-field="t.1.when" style={wrap}>{c['t.1.when']}</span>
            </div>
          </div>
          <div className="row" data-widget="t.2">
            <div className="top">
              <div className="sport" data-field="t.2.sport" style={wrap}>{c['t.2.sport']}</div>
              <div className="badge h" data-field="t.2.b" style={wrap}>{c['t.2.b']}</div>
            </div>
            <div className="opp" data-field="t.2.opp" style={wrap}>{c['t.2.opp']}</div>
            <div className="when" data-field="t.2.when" style={wrap}>{c['t.2.when']}</div>
          </div>
          <div className="row" data-widget="t.3">
            <div className="top">
              <div className="sport" data-field="t.3.sport" style={wrap}>{c['t.3.sport']}</div>
              <div className="badge h" data-field="t.3.b" style={wrap}>{c['t.3.b']}</div>
            </div>
            <div className="opp" data-field="t.3.opp" style={wrap}>{c['t.3.opp']}</div>
            <div className="when" data-field="t.3.when" style={wrap}>{c['t.3.when']}</div>
          </div>
          <div className="row final" data-widget="t.4">
            <div className="top">
              <div className="sport" data-field="t.4.sport" style={wrap}>{c['t.4.sport']}</div>
              <div className="badge a" data-field="t.4.b" style={wrap}>{c['t.4.b']}</div>
            </div>
            <div className="opp" data-field="t.4.opp" style={wrap}>{c['t.4.opp']}</div>
            <div className="when">
              <span data-field="t.4.when" style={wrap}>{c['t.4.when']}</span>
              <span className="score" data-field="t.4.score" style={wrap}>{c['t.4.score']}</span>
            </div>
          </div>
          <div className="row" data-widget="t.5">
            <div className="top">
              <div className="sport" data-field="t.5.sport" style={wrap}>{c['t.5.sport']}</div>
              <div className="badge h" data-field="t.5.b" style={wrap}>{c['t.5.b']}</div>
            </div>
            <div className="opp" data-field="t.5.opp" style={wrap}>{c['t.5.opp']}</div>
            <div className="when" data-field="t.5.when" style={wrap}>{c['t.5.when']}</div>
          </div>
        </div>
      </section>

      {/* FAN INFO */}
      <section className="fan">
        {[0, 1, 2, 3, 4].map((i) => {
          const k = (`f.${i}.k`) as keyof HsAthGamedayConfig;
          const v = (`f.${i}.v`) as keyof HsAthGamedayConfig;
          const s = (`f.${i}.s`) as keyof HsAthGamedayConfig;
          return (
            <div key={i} className="it" data-widget={`f.${i}`}>
              <div className="k" data-field={k} style={wrap}>{c[k]}</div>
              <div className="v">
                <span data-field={v} style={wrap}>{c[v]}</span>
                <small data-field={s} style={wrap}>{c[s]}</small>
              </div>
            </div>
          );
        })}
      </section>

      {/* TICKER */}
      <div className="ticker" data-widget="ticker">
        <div className="tag" data-field="ticker.tag" style={wrap}>{c['ticker.tag']}</div>
        <div className="msg">
          <span data-field="ticker.message" style={wrap}>{c['ticker.message']}</span>
          <span>&nbsp;<span className="star">★</span>&nbsp;</span>
          <span data-field="ticker.message2" style={wrap}>{c['ticker.message2']}</span>
        </div>
      </div>
    </HsStage>
  );
}

/** Inlined CSS — every pixel matches scratch/design/hs-district/hs-district-pack/ath-gameday.html. */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Oswald:wght@400;500;600;700&family=Archivo:wght@500;700;800;900&family=JetBrains+Mono:wght@500;700&display=swap');

.hs-ath-gd-bgfx {
  position: absolute; inset: 0; pointer-events: none;
  background:
    radial-gradient(1800px 1100px at 50% 0%, rgba(217,34,49,.18), transparent 60%),
    radial-gradient(1200px 800px at 100% 100%, rgba(26,78,216,.14), transparent 60%),
    repeating-linear-gradient(90deg, rgba(255,255,255,.012) 0 2px, transparent 2px 240px);
}

@keyframes hsAthGdBlink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: .25; } }
@keyframes hsAthGdSc { from { transform: translateX(0); } to { transform: translateX(-50%); } }

/* HEADER */
.head { position: absolute; top: 0; left: 0; right: 0; height: 160px; background: #000;
  display: grid; grid-template-columns: auto 1fr auto; align-items: center; padding: 0 60px; gap: 40px; z-index: 5; border-bottom: 6px solid #d92231; }
.head .left { display: flex; align-items: center; gap: 32px; }
.head .crest { width: 96px; height: 96px; background: #d92231;
  clip-path: polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);
  display: grid; place-items: center; font-family: 'Bebas Neue', sans-serif; font-size: 60px; color: #fff; line-height: 1; border: 4px solid #fff; }
.head .school { display: flex; flex-direction: column; line-height: .95; }
.head .school .nm { font-family: 'Bebas Neue', sans-serif; font-size: 64px; letter-spacing: .04em; color: #fff; }
.head .school .sub { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 28px; letter-spacing: .28em; color: #f5b324; text-transform: uppercase; margin-top: 4px; }
.head h1 { margin: 0; font-family: 'Bebas Neue', sans-serif; font-size: 120px; letter-spacing: .06em; color: #fff; text-align: center; line-height: 1; }
.head h1 .acc { color: #d92231; text-shadow: 0 0 30px rgba(217,34,49,.5); }
.head .right { display: flex; align-items: center; gap: 18px; }
.head .badge { padding: 14px 22px; background: #d92231; color: #fff; font-family: 'Bebas Neue', sans-serif; font-size: 36px; letter-spacing: .18em; display: flex; align-items: center; gap: 14px; line-height: 1; }
.head .badge::before { content: ''; width: 14px; height: 14px; border-radius: 50%; background: #fff; animation: hsAthGdBlink 1.4s steps(2) infinite; }
.head .clock { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 36px; color: #fff; letter-spacing: .18em; font-variant-numeric: tabular-nums; }

/* HERO MATCHUP */
.hero { position: absolute; top: 160px; left: 0; right: 0; height: 1100px;
  background: linear-gradient(135deg, rgba(217,34,49,.2) 0%, transparent 50%, rgba(26,78,216,.2) 100%), #0a0e1a;
  display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; padding: 60px 80px; gap: 40px; z-index: 3; border-bottom: 1px solid rgba(255,255,255,.12); }
.hero::before { content: ''; position: absolute; inset: 0; pointer-events: none;
  background: repeating-linear-gradient(90deg, transparent 0 119px, rgba(255,255,255,.04) 119px 120px); }
.hero .team { display: flex; flex-direction: column; align-items: center; gap: 20px; z-index: 2; position: relative; }
.hero .team.us { align-items: flex-start; padding-left: 80px; }
.hero .team.them { align-items: flex-end; padding-right: 80px; }
.hero .team .helmet { width: 480px; height: 480px; border-radius: 50%; display: grid; place-items: center;
  font-family: 'Bebas Neue', sans-serif; font-size: 280px; color: #fff; line-height: 1; border: 12px solid #fff;
  box-shadow: 0 0 0 8px rgba(0,0,0,.5), 0 30px 80px rgba(0,0,0,.6); }
.hero .team.us .helmet { background: radial-gradient(circle at 30% 30%, #d92231, #7a0e18); }
.hero .team.them .helmet { background: radial-gradient(circle at 30% 30%, #1a4ed8, #0f2f8a); }
.hero .team .label { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 32px; letter-spacing: .32em; text-transform: uppercase; line-height: 1; }
.hero .team.us .label { color: #d92231; }
.hero .team.them .label { color: #1a4ed8; }
.hero .team .name { font-family: 'Bebas Neue', sans-serif; font-size: 160px; color: #fff; letter-spacing: .03em; line-height: .9; text-align: center; }
.hero .team .mascot { font-family: 'Archivo', sans-serif; font-weight: 800; font-size: 36px; color: #9ba6c2; letter-spacing: .04em; line-height: 1; }
.hero .team .stats { display: flex; gap: 32px; margin-top: 8px; }
.hero .team .stats .s { display: flex; flex-direction: column; align-items: center; line-height: 1; }
.hero .team .stats .s .k { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 26px; letter-spacing: .22em; color: #5d6a89; text-transform: uppercase; }
.hero .team .stats .s .v { font-family: 'Bebas Neue', sans-serif; font-size: 80px; color: #fff; letter-spacing: .02em; margin-top: 6px; font-variant-numeric: tabular-nums; }
.hero .team .stats .s .v.win { color: #1fc16b; }
.hero .team .stats .s .v.loss { color: #ff5274; }
.hero .team.us { text-align: left; }
.hero .team.us .name, .hero .team.us .mascot, .hero .team.us .stats { align-self: flex-start; }
.hero .team.them { text-align: right; }
.hero .team.them .name, .hero .team.them .mascot, .hero .team.them .stats { align-self: flex-end; }

.hero .vs { display: flex; flex-direction: column; align-items: center; gap: 24px; z-index: 2; position: relative; }
.hero .vs .vsbig { font-family: 'Bebas Neue', sans-serif; font-size: 300px; color: #fff; letter-spacing: .04em; line-height: .85;
  text-shadow: 0 0 60px rgba(217,34,49,.6), 0 0 120px rgba(26,78,216,.4); position: relative; }
.hero .vs .vsbig::before, .hero .vs .vsbig::after { content: ''; position: absolute; left: 50%; width: 160px; height: 6px;
  background: linear-gradient(90deg, transparent, #f5b324, transparent); transform: translateX(-50%); }
.hero .vs .vsbig::before { top: -30px; }
.hero .vs .vsbig::after { bottom: -30px; }
.hero .vs .countdown { display: flex; gap: 14px; margin-top: 18px; }
.hero .vs .countdown .seg { background: #000; border: 3px solid #f5b324; padding: 18px 22px; display: flex; flex-direction: column; align-items: center; line-height: 1; min-width: 130px; }
.hero .vs .countdown .seg .n { font-family: 'Bebas Neue', sans-serif; font-size: 96px; color: #f5b324; letter-spacing: .02em; font-variant-numeric: tabular-nums; }
.hero .vs .countdown .seg .l { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 26px; letter-spacing: .22em; color: #fff; text-transform: uppercase; margin-top: 4px; }
.hero .vs .when { padding: 20px 36px; background: #f5b324; color: #000; font-family: 'Bebas Neue', sans-serif; font-size: 48px; letter-spacing: .06em; line-height: 1; text-transform: uppercase; }
.hero .vs .where { font-family: 'Archivo', sans-serif; font-weight: 700; font-size: 32px; color: #fff; letter-spacing: .04em; line-height: 1.2; text-align: center; text-wrap: balance; }
.hero .vs .where small { display: block; font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 30px; color: #9ba6c2; margin-top: 8px; letter-spacing: .18em; text-transform: uppercase; }

.hero .spread { position: absolute; left: 50%; bottom: -30px; transform: translateX(-50%); display: flex; align-items: center; gap: 18px;
  background: #000; border: 3px solid rgba(255,255,255,.12); padding: 14px 28px;
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 30px; color: #f5b324; letter-spacing: .22em; text-transform: uppercase; z-index: 4; }
.hero .spread .v { color: #fff; font-size: 36px; }

/* MIDDLE STRIP */
.strip { position: absolute; left: 80px; right: 80px; top: 1300px; height: 140px;
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 20px; z-index: 3; }
.strip .stat { background: #16203a; border: 2px solid rgba(255,255,255,.12); border-left: 8px solid #f5b324;
  padding: 18px 24px; display: flex; flex-direction: column; justify-content: center; line-height: 1; gap: 8px; }
.strip .stat .k { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 28px; letter-spacing: .24em; color: #9ba6c2; text-transform: uppercase; }
.strip .stat .v { font-family: 'Bebas Neue', sans-serif; font-size: 64px; color: #fff; letter-spacing: .02em; font-variant-numeric: tabular-nums; display: flex; align-items: baseline; gap: 14px; }
.strip .stat .v small { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 28px; color: #5d6a89; letter-spacing: .18em; text-transform: uppercase; }
.strip .stat.us { border-left-color: #d92231; }
.strip .stat.win { border-left-color: #1fc16b; }
.strip .stat.win .v { color: #1fc16b; }
.strip .stat.last5 { flex-direction: column; gap: 8px; }
.strip .stat .pills { display: flex; gap: 6px; margin-top: 4px; }
.strip .stat .pills span { width: 38px; height: 38px; display: grid; place-items: center;
  font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #fff; line-height: 1; }
.strip .stat .pills span.w { background: #1fc16b; }
.strip .stat .pills span.l { background: #ff5274; }
.strip .stat .pills span.t { background: #5d6a89; }

/* TODAY ALL TEAMS */
.teams { position: absolute; left: 80px; right: 80px; top: 1480px; height: 520px;
  background: #16203a; border: 1px solid rgba(255,255,255,.12); display: flex; flex-direction: column; z-index: 3; }
.teams .head { position: static; height: 80px; background: #000; border-bottom: 3px solid #f5b324;
  display: flex; justify-content: space-between; align-items: center; padding: 0 32px; }
.teams .head h2 { margin: 0; font-family: 'Bebas Neue', sans-serif; font-size: 54px; color: #fff; letter-spacing: .06em; line-height: 1; }
.teams .head .meta { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 28px; color: #f5b324; letter-spacing: .24em; text-transform: uppercase; }
.teams .grid { flex: 1; display: grid; grid-template-columns: repeat(6, 1fr); gap: 0; }
.teams .row { padding: 18px 22px; border-right: 1px solid rgba(255,255,255,.12);
  display: flex; flex-direction: column; justify-content: space-between; line-height: 1.1; gap: 8px; }
.teams .row:last-child { border-right: 0; }
.teams .row .top { display: flex; justify-content: space-between; align-items: flex-start; }
.teams .row .sport { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 26px; letter-spacing: .22em; color: #5d6a89; text-transform: uppercase; }
.teams .row .badge { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 24px; letter-spacing: .2em; text-transform: uppercase; padding: 6px 12px; color: #000; line-height: 1; }
.teams .row .badge.h { background: #d92231; color: #fff; }
.teams .row .badge.a { background: #1a4ed8; color: #fff; }
.teams .row .opp { font-family: 'Bebas Neue', sans-serif; font-size: 42px; color: #fff; letter-spacing: .02em; line-height: .95; text-wrap: balance; }
.teams .row .when { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 28px; color: #f5b324; letter-spacing: .18em; text-transform: uppercase; font-variant-numeric: tabular-nums; }
.teams .row.live { background: rgba(31,193,107,.08); border-right-color: #1fc16b; }
.teams .row.live .when { color: #1fc16b; display: flex; align-items: center; gap: 8px; }
.teams .row.live .when::before { content: ''; width: 10px; height: 10px; border-radius: 50%; background: #1fc16b; animation: hsAthGdBlink 1.2s steps(2) infinite; }
.teams .row.final .opp { color: #9ba6c2; }
.teams .row.final .when { color: #fff; }
.teams .row.final .when .score { color: #1fc16b; }
.teams .row.final .when .score.l { color: #ff5274; }

/* FAN INFO */
.fan { position: absolute; left: 80px; right: 80px; bottom: 96px; height: 140px;
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 20px; z-index: 3; }
.fan .it { background: #1c2848; border: 2px solid rgba(255,255,255,.12); padding: 18px 24px;
  display: flex; flex-direction: column; justify-content: center; line-height: 1; gap: 8px; }
.fan .it .k { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 26px; letter-spacing: .24em; color: #f5b324; text-transform: uppercase; display: flex; align-items: center; gap: 10px; }
.fan .it .k::before { content: ''; width: 24px; height: 4px; background: currentColor; }
.fan .it .v { font-family: 'Bebas Neue', sans-serif; font-size: 42px; color: #fff; letter-spacing: .02em; line-height: 1; text-wrap: balance; }
.fan .it .v small { display: block; font-family: 'Archivo', sans-serif; font-weight: 500; font-size: 26px; color: #9ba6c2; margin-top: 4px; letter-spacing: 0; text-transform: none; }

/* TICKER */
.ticker { position: absolute; left: 0; right: 0; bottom: 0; height: 96px; background: #000; color: #fff;
  display: flex; align-items: center; overflow: hidden; z-index: 5; border-top: 4px solid #d92231; }
.ticker .tag { flex: 0 0 auto; background: #d92231;
  font-family: 'Bebas Neue', sans-serif; font-size: 42px; padding: 0 36px; height: 100%;
  display: flex; align-items: center; letter-spacing: .06em; gap: 14px; }
.ticker .tag::before { content: ''; width: 18px; height: 18px; background: #fff; border-radius: 50%; animation: hsAthGdBlink 1.2s steps(2) infinite; }
.ticker .msg { font-family: 'Oswald', sans-serif; font-weight: 600; font-size: 32px; padding-left: 36px;
  white-space: nowrap; letter-spacing: .04em; text-transform: uppercase; animation: hsAthGdSc 100s linear infinite; }
.ticker .msg .star { color: #f5b324; margin: 0 22px; }
`;
