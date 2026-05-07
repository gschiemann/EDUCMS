"use client";

/**
 * HsAthStandingsWidget — Athletics season standings broadsheet, 3840×2160.
 *
 * Newspaper-style season scoreboard: masthead with crest + day +
 * "week N of M" badge, 5 top stats, an 8-team standings table
 * with rank medals + form pills, athlete-of-the-week panel,
 * "school records this season" list, "up next" 4-event strip, and
 * a scrolling ticker.
 *
 * APPROVED 2026-05-07 — matches scratch/design/hs-district/hs-district-pack/ath-standings.html
 * Operator: "these need to be wired in for the highschools"
 *
 * Editable widget regions (each contenteditable through BuilderZone's
 * dotted-key setByPath handler):
 *   - crest.letter                       → masthead crest letter
 *   - title.{sup,t1,t2,t3}               → suplabel + 3-span headline (t2 accent)
 *   - day.{name,date,week}               → date column on the right
 *   - ts.0..4 (k, v)                     → 5 top stats
 *   - standings.{title,meta}             → standings card header
 *   - th.0..4                            → table header labels
 *   - row.0..7 (nm, wl, pp, tag)         → 8 standings rows
 *   - aotw.{tag,name,role,quote,num,lname,s1,s2,s3}  → athlete of the week
 *   - records.{title,meta}               → records card title
 *   - rec.0..3 (ic, nm, who, v)          → 4 records list items
 *   - upcoming.{k,v}                     → up-next label
 *   - up.0..3 (day, b, m, meta)          → 4 upcoming events
 *   - ticker.{tag,message,message2}      → scrolling ticker
 *
 * Note: this widget does NOT render a clock — the day/date are the
 * temporal anchor. day.date is operator-controlled, not live.
 */

import { HsStage } from './HsStage';

export interface HsAthStandingsConfig {
  'crest.letter'?: string;
  'title.sup'?: string;
  'title.t1'?: string;
  'title.t2'?: string;
  'title.t3'?: string;
  'day.name'?: string;
  'day.date'?: string;
  'day.week'?: string;
  'ts.0.k'?: string;
  'ts.0.v'?: string;
  'ts.1.k'?: string;
  'ts.1.v'?: string;
  'ts.2.k'?: string;
  'ts.2.v'?: string;
  'ts.3.k'?: string;
  'ts.3.v'?: string;
  'ts.4.k'?: string;
  'ts.4.v'?: string;
  'standings.title'?: string;
  'standings.meta'?: string;
  'th.0'?: string;
  'th.1'?: string;
  'th.2'?: string;
  'th.3'?: string;
  'th.4'?: string;
  'row.0.nm'?: string;
  'row.0.wl'?: string;
  'row.0.pp'?: string;
  'row.0.tag'?: string;
  'row.1.nm'?: string;
  'row.1.wl'?: string;
  'row.1.pp'?: string;
  'row.1.tag'?: string;
  'row.2.nm'?: string;
  'row.2.wl'?: string;
  'row.2.pp'?: string;
  'row.2.tag'?: string;
  'row.3.nm'?: string;
  'row.3.wl'?: string;
  'row.3.pp'?: string;
  'row.3.tag'?: string;
  'row.4.nm'?: string;
  'row.4.wl'?: string;
  'row.4.pp'?: string;
  'row.4.tag'?: string;
  'row.5.nm'?: string;
  'row.5.wl'?: string;
  'row.5.pp'?: string;
  'row.5.tag'?: string;
  'row.6.nm'?: string;
  'row.6.wl'?: string;
  'row.6.pp'?: string;
  'row.6.tag'?: string;
  'row.7.nm'?: string;
  'row.7.wl'?: string;
  'row.7.pp'?: string;
  'row.7.tag'?: string;
  'aotw.num'?: string;
  'aotw.lname'?: string;
  'aotw.tag'?: string;
  'aotw.name'?: string;
  'aotw.role'?: string;
  'aotw.quote'?: string;
  'aotw.s1'?: string;
  'aotw.s2'?: string;
  'aotw.s3'?: string;
  'records.title'?: string;
  'records.meta'?: string;
  'rec.0.ic'?: string;
  'rec.0.nm'?: string;
  'rec.0.who'?: string;
  'rec.0.v'?: string;
  'rec.1.ic'?: string;
  'rec.1.nm'?: string;
  'rec.1.who'?: string;
  'rec.1.v'?: string;
  'rec.2.ic'?: string;
  'rec.2.nm'?: string;
  'rec.2.who'?: string;
  'rec.2.v'?: string;
  'rec.3.ic'?: string;
  'rec.3.nm'?: string;
  'rec.3.who'?: string;
  'rec.3.v'?: string;
  'upcoming.k'?: string;
  'upcoming.v'?: string;
  'up.0.day'?: string;
  'up.0.b'?: string;
  'up.0.m'?: string;
  'up.0.meta'?: string;
  'up.1.day'?: string;
  'up.1.b'?: string;
  'up.1.m'?: string;
  'up.1.meta'?: string;
  'up.2.day'?: string;
  'up.2.b'?: string;
  'up.2.m'?: string;
  'up.2.meta'?: string;
  'up.3.day'?: string;
  'up.3.b'?: string;
  'up.3.m'?: string;
  'up.3.meta'?: string;
  'ticker.tag'?: string;
  'ticker.message'?: string;
  'ticker.message2'?: string;
}

export const DEFAULTS: Required<HsAthStandingsConfig> = {
  'crest.letter': 'W',
  'title.sup': 'Westridge Athletics · Region 4A · 2025–26 Fall',
  'title.t1': 'Wildcats ',
  'title.t2': 'at the top',
  'title.t3': '.',
  'day.name': 'Wednesday',
  'day.date': 'Oct 15 · Updated 2:14 pm',
  'day.week': 'Week 7 of 10',
  'ts.0.k': 'Overall record',
  'ts.0.v': '42–11',
  'ts.1.k': 'Region rank',
  'ts.1.v': '1st of 8',
  'ts.2.k': 'State qualifiers',
  'ts.2.v': '14 athletes',
  'ts.3.k': 'Win streak',
  'ts.3.v': '9 games',
  'ts.4.k': 'Student attendance',
  'ts.4.v': '87% / game',
  'standings.title': 'Region 4A · Football Standings',
  'standings.meta': 'Through Week 7 · official',
  'th.0': 'Team',
  'th.1': 'W–L',
  'th.2': 'PF / PA',
  'th.3': 'Last 5',
  'th.4': 'Status',
  'row.0.nm': 'Westridge Wildcats',
  'row.0.wl': '6–1',
  'row.0.pp': '220 / 124',
  'row.0.tag': 'Region lead · clinched',
  'row.1.nm': 'Northgate Knights',
  'row.1.wl': '5–2',
  'row.1.pp': '189 / 142',
  'row.1.tag': 'Playoff in',
  'row.2.nm': 'Eastlake Eagles',
  'row.2.wl': '5–2',
  'row.2.pp': '201 / 158',
  'row.2.tag': 'Playoff in',
  'row.3.nm': 'Lincoln Lions',
  'row.3.wl': '4–3',
  'row.3.pp': '168 / 171',
  'row.3.tag': 'Bubble · in if win',
  'row.4.nm': 'Maplewood Mustangs',
  'row.4.wl': '3–4',
  'row.4.pp': '142 / 188',
  'row.4.tag': 'Bubble',
  'row.5.nm': 'Bayside Buccaneers',
  'row.5.wl': '3–4',
  'row.5.pp': '155 / 192',
  'row.5.tag': 'Bubble',
  'row.6.nm': 'Riverside Rams',
  'row.6.wl': '2–5',
  'row.6.pp': '118 / 201',
  'row.6.tag': 'Eliminated',
  'row.7.nm': 'Crestwood Cougars',
  'row.7.wl': '0–7',
  'row.7.pp': '84 / 268',
  'row.7.tag': 'Eliminated',
  'aotw.num': '11',
  'aotw.lname': "Maya Castellanos · '26",
  'aotw.tag': 'Athlete of the week · 10/15',
  'aotw.name': 'Maya Castellanos',
  'aotw.role': 'Senior captain · Girls Volleyball · Outside hitter',
  'aotw.quote': "She's the loudest voice in the gym and the quietest one off it. 24 kills against Eastlake, then she stayed an hour late to coach the JV. That's the standard.",
  'aotw.s1': '24',
  'aotw.s2': '7',
  'aotw.s3': '19',
  'records.title': 'School records · this season',
  'records.meta': 'Top 4 · live tracking',
  'rec.0.ic': 'XC',
  'rec.0.nm': 'Boys 5K · course record',
  'rec.0.who': "Jordan Pham '26 · 14:52 · @ County",
  'rec.0.v': '14:52',
  'rec.1.ic': 'VB',
  'rec.1.nm': 'Single-match kills · girls',
  'rec.1.who': "Maya C. '26 · 24 vs Eastlake · 10/13",
  'rec.1.v': '24',
  'rec.2.ic': 'FB',
  'rec.2.nm': 'Career sacks · varsity football',
  'rec.2.who': "Marcus T. '26 · 32 (3-yr) · old: 31",
  'rec.2.v': '32',
  'rec.3.ic': 'SC',
  'rec.3.nm': 'Goals in season · boys soccer',
  'rec.3.who': "Diego A. '27 · 18 in 11 games",
  'rec.3.v': '18',
  'upcoming.k': 'This week',
  'upcoming.v': 'Up\nnext',
  'up.0.day': 'Wed · today',
  'up.0.b': 'Home',
  'up.0.m': 'G Soccer JV vs Northgate',
  'up.0.meta': '5:00 pm · Stadium turf',
  'up.1.day': 'Fri 10/17',
  'up.1.b': 'Home',
  'up.1.m': 'FB Varsity vs Northgate',
  'up.1.meta': '7:00 pm · Senior night',
  'up.2.day': 'Sat 10/18',
  'up.2.b': 'Away',
  'up.2.m': 'XC @ State Pre-meet',
  'up.2.meta': '9:00 am · Riverside park',
  'up.3.day': 'Tue 10/21',
  'up.3.b': 'Home',
  'up.3.m': 'G Volleyball · Region semi',
  'up.3.meta': '6:00 pm · Main gym · ticketed',
  'ticker.tag': 'Wildcats',
  'ticker.message': 'Football clinched the region for the second straight year — playoffs start 10/24 · 14 athletes have qualified for state across XC, golf and tennis · Senior night Friday — 17 football seniors honored · Volleyball region semi at home Tuesday — bring your white-out · Track tryouts open 10/27 · Athletic trainer office hours moved to room 102 · Boosters meeting Thursday 7pm in the cafeteria',
  'ticker.message2': 'Football clinched the region for the second straight year — playoffs start 10/24 · 14 athletes have qualified for state across XC, golf and tennis · Senior night Friday — 17 football seniors honored · Volleyball region semi at home Tuesday — bring your white-out · Track tryouts open 10/27 · Athletic trainer office hours moved to room 102 · Boosters meeting Thursday 7pm in the cafeteria',
};

// Static dot colors for the standings rows (matches the HTML's hard-coded inline backgrounds)
const ROW_DOTS = ['#b51d2c', '#0f2a4a', '#1f7a4a', '#c69635', '#7a3da1', '#3a6dc7', '#c03c52', '#566072'];

// Form indicators per row (W/L pills) — matches the HTML pattern row by row.
const ROW_FORMS: Array<Array<'w' | 'l' | 't'>> = [
  ['w', 'w', 'l', 'w', 'w'],
  ['w', 'w', 'w', 'l', 'w'],
  ['w', 'l', 'w', 'w', 'w'],
  ['l', 'w', 'w', 'l', 'w'],
  ['l', 'w', 'l', 'l', 'w'],
  ['w', 'l', 'l', 'w', 'l'],
  ['l', 'l', 'w', 'l', 'l'],
  ['l', 'l', 'l', 'l', 'l'],
];

export function HsAthStandingsWidget({ config, live: _live }: { config?: HsAthStandingsConfig; live?: boolean }) {
  const c = { ...DEFAULTS, ...(config || {}) } as Required<HsAthStandingsConfig>;
  const wrap: React.CSSProperties = { whiteSpace: 'pre-wrap' as const };
  return (
    <HsStage
      stageStyle={{
        background: '#f5f3ee',
        fontFamily: "'Archivo', sans-serif",
        color: '#0e1116',
      }}
    >
      <style>{CSS}</style>

      <div className="hs-ath-st-bgfx" />

      {/* MASTHEAD */}
      <header className="mast">
        <div className="crest" data-widget="crest" data-est="EST. 1956">
          <span data-field="crest.letter" style={wrap}>{c['crest.letter']}</span>
        </div>
        <div className="title" data-widget="title">
          <div className="sup">
            <span data-field="title.sup" style={wrap}>{c['title.sup']}</span>
          </div>
          <h1>
            <span data-field="title.t1" style={wrap}>{c['title.t1']}</span>
            <span className="acc" data-field="title.t2" style={wrap}>{c['title.t2']}</span>
            <span data-field="title.t3" style={wrap}>{c['title.t3']}</span>
          </h1>
        </div>
        <div className="right" data-widget="day">
          <div className="day" data-field="day.name" style={wrap}>{c['day.name']}</div>
          <div className="date" data-field="day.date" style={wrap}>{c['day.date']}</div>
          <div className="week" data-field="day.week" style={wrap}>{c['day.week']}</div>
        </div>
      </header>

      {/* TOP STATS BAR */}
      <section className="topstats">
        <div className="s us" data-widget="ts.0">
          <div className="k" data-field="ts.0.k" style={wrap}>{c['ts.0.k']}</div>
          <div className="v" data-field="ts.0.v" style={wrap}>{c['ts.0.v']}</div>
        </div>
        <div className="s" data-widget="ts.1">
          <div className="k" data-field="ts.1.k" style={wrap}>{c['ts.1.k']}</div>
          <div className="v" data-field="ts.1.v" style={wrap}>{c['ts.1.v']}</div>
        </div>
        <div className="s gold" data-widget="ts.2">
          <div className="k" data-field="ts.2.k" style={wrap}>{c['ts.2.k']}</div>
          <div className="v" data-field="ts.2.v" style={wrap}>{c['ts.2.v']}</div>
        </div>
        <div className="s dark" data-widget="ts.3">
          <div className="k" data-field="ts.3.k" style={wrap}>{c['ts.3.k']}</div>
          <div className="v" data-field="ts.3.v" style={wrap}>{c['ts.3.v']}</div>
        </div>
        <div className="s" data-widget="ts.4">
          <div className="k" data-field="ts.4.k" style={wrap}>{c['ts.4.k']}</div>
          <div className="v" data-field="ts.4.v" style={wrap}>{c['ts.4.v']}</div>
        </div>
      </section>

      {/* MAIN GRID */}
      <section className="grid">
        <div className="standings">
          <div className="hd">
            <h2 data-field="standings.title" style={wrap}>{c['standings.title']}</h2>
            <div className="meta" data-field="standings.meta" style={wrap}>{c['standings.meta']}</div>
          </div>
          <table>
            <colgroup>
              <col style={{ width: '38%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '16%' }} />
            </colgroup>
            <thead>
              <tr>
                <th data-field="th.0" style={wrap}>{c['th.0']}</th>
                <th className="num" data-field="th.1" style={wrap}>{c['th.1']}</th>
                <th className="num" data-field="th.2" style={wrap}>{c['th.2']}</th>
                <th className="num" data-field="th.3" style={wrap}>{c['th.3']}</th>
                <th className="num" data-field="th.4" style={wrap}>{c['th.4']}</th>
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
                const nm = (`row.${i}.nm`) as keyof HsAthStandingsConfig;
                const wl = (`row.${i}.wl`) as keyof HsAthStandingsConfig;
                const pp = (`row.${i}.pp`) as keyof HsAthStandingsConfig;
                const tag = (`row.${i}.tag`) as keyof HsAthStandingsConfig;
                const isUs = i === 0;
                return (
                  <tr key={i} className={isUs ? 'us' : ''} data-widget={`row.${i}`}>
                    <td>
                      <span className="rank">{i + 1}</span>
                      <span className="nm">
                        <span className="dot" style={{ background: ROW_DOTS[i] }} />
                        <span data-field={nm} style={wrap}>{c[nm]}</span>
                      </span>
                    </td>
                    <td className="num" data-field={wl} style={wrap}>{c[wl]}</td>
                    <td className="num" data-field={pp} style={wrap}>{c[pp]}</td>
                    <td className="num">
                      <span className="form">
                        {ROW_FORMS[i].map((f, j) => (
                          <span key={j} className={f}>{f.toUpperCase()}</span>
                        ))}
                      </span>
                    </td>
                    <td className="tag" data-field={tag} style={wrap}>{c[tag]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="col">
          <div className="aotw" data-widget="aotw">
            <div className="photo">
              <div className="num" data-field="aotw.num" style={wrap}>{c['aotw.num']}</div>
              <div className="name" data-field="aotw.lname" style={wrap}>{c['aotw.lname']}</div>
            </div>
            <div className="body">
              <div className="tag" data-field="aotw.tag" style={wrap}>{c['aotw.tag']}</div>
              <h3 data-field="aotw.name" style={wrap}>{c['aotw.name']}</h3>
              <div className="role" data-field="aotw.role" style={wrap}>{c['aotw.role']}</div>
              <div className="quote" data-field="aotw.quote" style={wrap}>{c['aotw.quote']}</div>
              <div className="stats">
                <div className="s"><div className="k">Kills</div><div className="v" data-field="aotw.s1" style={wrap}>{c['aotw.s1']}</div></div>
                <div className="s"><div className="k">Aces</div><div className="v" data-field="aotw.s2" style={wrap}>{c['aotw.s2']}</div></div>
                <div className="s"><div className="k">Digs</div><div className="v" data-field="aotw.s3" style={wrap}>{c['aotw.s3']}</div></div>
              </div>
            </div>
          </div>

          <div className="records" data-widget="records">
            <h3>
              <span data-field="records.title" style={wrap}>{c['records.title']}</span>
              <span className="meta" data-field="records.meta" style={wrap}>{c['records.meta']}</span>
            </h3>
            <ul>
              {[0, 1, 2, 3].map((i) => {
                const ic = (`rec.${i}.ic`) as keyof HsAthStandingsConfig;
                const nm = (`rec.${i}.nm`) as keyof HsAthStandingsConfig;
                const who = (`rec.${i}.who`) as keyof HsAthStandingsConfig;
                const v = (`rec.${i}.v`) as keyof HsAthStandingsConfig;
                // Items 0 and 2 are "new" in the original HTML (red icon + "NEW" label).
                const isNew = i === 0 || i === 2;
                return (
                  <li key={i} className={isNew ? 'new' : ''} data-widget={`rec.${i}`}>
                    <div className="ic" data-field={ic} style={wrap}>{c[ic]}</div>
                    <div className="body">
                      <div className="nm" data-field={nm} style={wrap}>{c[nm]}</div>
                      <div className="who" data-field={who} style={wrap}>{c[who]}</div>
                    </div>
                    <div className="v" data-field={v} style={wrap}>{c[v]}</div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </section>

      {/* UPCOMING STRIP */}
      <section className="upcoming" data-widget="upcoming">
        <div className="label">
          <div className="k" data-field="upcoming.k" style={wrap}>{c['upcoming.k']}</div>
          <div className="v" data-field="upcoming.v" style={wrap}>{c['upcoming.v']}</div>
        </div>
        <div className="list">
          {[0, 1, 2, 3].map((i) => {
            const day = (`up.${i}.day`) as keyof HsAthStandingsConfig;
            const b = (`up.${i}.b`) as keyof HsAthStandingsConfig;
            const m = (`up.${i}.m`) as keyof HsAthStandingsConfig;
            const meta = (`up.${i}.meta`) as keyof HsAthStandingsConfig;
            // i==2 is the only "Away" badge in the original HTML.
            const badgeCls = i === 2 ? 'badge a' : 'badge h';
            return (
              <div key={i} className="ev" data-widget={`up.${i}`}>
                <div className="top">
                  <div className="day" data-field={day} style={wrap}>{c[day]}</div>
                  <div className={badgeCls} data-field={b} style={wrap}>{c[b]}</div>
                </div>
                <div className="matchup" data-field={m} style={wrap}>{c[m]}</div>
                <div className="meta" data-field={meta} style={wrap}>{c[meta]}</div>
              </div>
            );
          })}
        </div>
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

/** Inlined CSS — every pixel matches scratch/design/hs-district/hs-district-pack/ath-standings.html. */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Archivo:wght@500;600;700;800;900&family=Archivo+Narrow:wght@400;500;700&family=JetBrains+Mono:wght@500;700&display=swap');

.hs-ath-st-bgfx {
  position: absolute; inset: 0; pointer-events: none;
  background:
    radial-gradient(1400px 800px at 0% 0%, rgba(181,29,44,.06), transparent 60%),
    radial-gradient(1200px 800px at 100% 100%, rgba(15,42,74,.06), transparent 60%);
}

@keyframes hsAthStBlink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: .3; } }
@keyframes hsAthStSc { from { transform: translateX(0); } to { transform: translateX(-50%); } }

/* MASTHEAD */
.mast { position: absolute; top: 60px; left: 80px; right: 80px; height: 240px;
  display: grid; grid-template-columns: auto 1fr auto; gap: 48px; align-items: center;
  border-bottom: 6px solid #0e1116; z-index: 4; }
.mast .crest { width: 200px; height: 200px; background: #b51d2c;
  clip-path: polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);
  display: grid; place-items: center; color: #fff;
  font-family: 'Bebas Neue', sans-serif; font-size: 140px; line-height: .9; border: 6px solid #0e1116; position: relative; }
.mast .crest::after { content: attr(data-est); position: absolute; bottom: 30px; left: 50%; transform: translateX(-50%);
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 24px; letter-spacing: .3em; color: #c69635; white-space: nowrap; }
.mast .title { display: flex; flex-direction: column; line-height: .9; }
.mast .title .sup { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 30px; letter-spacing: .32em; color: #b51d2c;
  text-transform: uppercase; margin-bottom: 14px; display: flex; align-items: center; gap: 18px; }
.mast .title .sup::before, .mast .title .sup::after { content: ''; height: 3px; width: 60px; background: #b51d2c; }
.mast .title h1 { margin: 0; font-family: 'Bebas Neue', sans-serif; font-size: 200px; letter-spacing: .02em; color: #0e1116; text-transform: uppercase; line-height: .9; }
.mast .title h1 .acc { color: #b51d2c; }
.mast .right { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
.mast .right .day { font-family: 'Bebas Neue', sans-serif; font-size: 80px; line-height: .9; color: #0e1116; letter-spacing: .02em; }
.mast .right .date { font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 24px; letter-spacing: .22em; color: #566072; text-transform: uppercase; }
.mast .right .week { margin-top: 6px; padding: 12px 22px; background: #0e1116; color: #fff;
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px; letter-spacing: .22em; text-transform: uppercase;
  display: inline-flex; align-items: center; gap: 14px; }
.mast .right .week::before { content: ''; width: 14px; height: 14px; border-radius: 50%; background: #c69635; animation: hsAthStBlink 1.4s steps(2) infinite; }

/* TOP STATS */
.topstats { position: absolute; top: 340px; left: 80px; right: 80px; height: 130px;
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 20px; z-index: 3; }
.topstats .s { background: #ffffff; border: 2px solid #0e1116; padding: 16px 24px;
  display: flex; flex-direction: column; justify-content: center; gap: 6px; line-height: 1; }
.topstats .s .k { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 26px; letter-spacing: .24em; color: #566072; text-transform: uppercase; }
.topstats .s .v { font-family: 'Bebas Neue', sans-serif; font-size: 64px; color: #0e1116; letter-spacing: .02em; line-height: .9; font-variant-numeric: tabular-nums; }
.topstats .s.us { background: #b51d2c; border-color: #7a0e18; }
.topstats .s.us .v { color: #fff; }
.topstats .s.us .k { color: rgba(255,255,255,.78); }
.topstats .s.gold { background: #c69635; border-color: #7a5e1f; }
.topstats .s.gold .v { color: #fff; }
.topstats .s.gold .k { color: rgba(255,255,255,.85); }
.topstats .s.dark { background: #0e1116; }
.topstats .s.dark .v { color: #fff; }
.topstats .s.dark .k { color: #c69635; }

/* MAIN GRID */
.grid { position: absolute; top: 500px; left: 80px; right: 80px; bottom: 300px;
  display: grid; grid-template-columns: 1.3fr 1fr; gap: 24px; z-index: 3; }

/* STANDINGS TABLE */
.standings { background: #ffffff; border: 3px solid #0e1116; display: flex; flex-direction: column; overflow: hidden; }
.standings .hd { height: 90px; background: #0e1116; color: #fff;
  display: flex; justify-content: space-between; align-items: center; padding: 0 32px; flex-shrink: 0; }
.standings .hd h2 { margin: 0; font-family: 'Bebas Neue', sans-serif; font-size: 60px; color: #fff; letter-spacing: .04em; line-height: 1; }
.standings .hd .meta { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px; color: #c69635; letter-spacing: .22em; text-transform: uppercase; }
.standings table { width: 100%; border-collapse: collapse; flex: 1; table-layout: fixed; }
.standings thead th { text-align: left; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 28px;
  letter-spacing: .22em; color: #566072; text-transform: uppercase; padding: 14px 20px; border-bottom: 3px solid #0e1116; background: #f5f3ee; font-variant-numeric: tabular-nums; }
.standings thead th.num { text-align: right; }
.standings tbody tr { border-bottom: 1px solid #d8d3c6; }
.standings tbody tr:last-child { border-bottom: 0; }
.standings tbody tr.us { background: rgba(181,29,44,.06); }
.standings tbody tr.us td { color: #0e1116; }
.standings tbody tr.us td:first-child { position: relative; }
.standings tbody tr.us td:first-child::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 8px; background: #b51d2c; }
.standings tbody td { padding: 18px 20px; font-family: 'Archivo', sans-serif; font-weight: 700; font-size: 32px; color: #0e1116;
  vertical-align: middle; font-variant-numeric: tabular-nums; }
.standings tbody td.num { text-align: right; }
.standings tbody td .rank { display: inline-block; width: 48px; height: 48px; border-radius: 50%; background: #e9e5db;
  color: #0e1116; font-family: 'Bebas Neue', sans-serif; font-size: 32px; line-height: 48px; text-align: center; vertical-align: middle; margin-right: 14px; }
.standings tbody tr:nth-child(1) td .rank { background: #c69635; color: #fff; }
.standings tbody tr:nth-child(2) td .rank { background: #9aa1ad; color: #fff; }
.standings tbody tr:nth-child(3) td .rank { background: #c08648; color: #fff; }
.standings tbody td .nm { display: inline-flex; align-items: center; gap: 14px; line-height: 1; }
.standings tbody td .nm .dot { width: 18px; height: 18px; display: inline-block; flex-shrink: 0; }
.standings tbody td .form { display: inline-flex; gap: 5px; }
.standings tbody td .form span { width: 30px; height: 30px; display: inline-block;
  font-family: 'Bebas Neue', sans-serif; font-size: 22px; color: #fff; text-align: center; line-height: 30px; }
.standings tbody td .form span.w { background: #1f8a4a; }
.standings tbody td .form span.l { background: #c03c52; }
.standings tbody td .form span.t { background: #8d96a8; }
.standings tbody td.tag { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 24px; letter-spacing: .18em; text-transform: uppercase; color: #566072; text-align: right; }
.standings tbody tr.us td.tag { color: #b51d2c; }

/* RIGHT COLUMN */
.col { display: flex; flex-direction: column; gap: 24px; }

/* ATHLETE OF THE WEEK */
.aotw { flex: 1; background: #0e1116; color: #fff; border: 3px solid #0e1116; position: relative;
  overflow: hidden; display: grid; grid-template-columns: auto 1fr; gap: 32px; padding: 32px; }
.aotw::before { content: ''; position: absolute; top: -100px; right: -100px; width: 600px; height: 600px;
  background: radial-gradient(circle, #b51d2c 0%, transparent 60%); opacity: .4; pointer-events: none; }
.aotw .photo { width: 380px; height: 100%; background: linear-gradient(135deg, #b51d2c, #7a0e18); border: 4px solid #c69635;
  display: grid; place-items: center; position: relative; overflow: hidden; }
.aotw .photo::before { content: ''; position: absolute; inset: 0;
  background: repeating-linear-gradient(45deg, transparent 0 40px, rgba(0,0,0,.1) 40px 41px); }
.aotw .photo .num { font-family: 'Bebas Neue', sans-serif; font-size: 300px; color: #fff; line-height: .85;
  position: relative; z-index: 1; text-shadow: 0 8px 24px rgba(0,0,0,.4); }
.aotw .photo .name { position: absolute; bottom: 18px; left: 0; right: 0; text-align: center;
  font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 24px; color: #fff; letter-spacing: .04em; text-transform: uppercase;
  background: rgba(0,0,0,.4); padding: 6px 0; z-index: 1; backdrop-filter: blur(4px); }
.aotw .body { display: flex; flex-direction: column; gap: 8px; position: relative; z-index: 1; }
.aotw .body .tag { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px; letter-spacing: .32em; color: #c69635;
  text-transform: uppercase; display: flex; align-items: center; gap: 14px; line-height: 1; }
.aotw .body .tag::before { content: '★'; font-size: 22px; line-height: 1; }
.aotw .body h3 { margin: 6px 0 0; font-family: 'Bebas Neue', sans-serif; font-size: 108px; color: #fff; letter-spacing: .02em; line-height: .9; }
.aotw .body .role { font-family: 'Archivo', sans-serif; font-weight: 700; font-size: 30px; color: #c69635; letter-spacing: .02em; line-height: 1.1; margin-top: 4px; }
.aotw .body .quote { margin-top: 14px; font-family: 'Archivo Narrow', sans-serif; font-weight: 500; font-size: 28px; line-height: 1.3;
  color: rgba(255,255,255,.82); text-wrap: pretty; font-style: italic; border-left: 4px solid #c69635; padding-left: 18px; }
.aotw .body .stats { margin-top: auto; display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px;
  border-top: 2px solid rgba(255,255,255,.18); padding-top: 18px; }
.aotw .body .stats .s { display: flex; flex-direction: column; line-height: 1; }
.aotw .body .stats .s .k { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 26px; letter-spacing: .22em; color: rgba(255,255,255,.6); text-transform: uppercase; }
.aotw .body .stats .s .v { font-family: 'Bebas Neue', sans-serif; font-size: 64px; color: #fff; letter-spacing: .02em; margin-top: 4px; font-variant-numeric: tabular-nums; }

/* SCHOOL RECORDS */
.records { flex: 0 0 auto; background: #ffffff; border: 3px solid #0e1116; padding: 24px 28px; display: flex; flex-direction: column; }
.records h3 { margin: 0 0 14px; font-family: 'Bebas Neue', sans-serif; font-size: 54px; color: #0e1116; letter-spacing: .04em;
  line-height: 1; border-bottom: 3px solid #0e1116; padding-bottom: 12px; display: flex; justify-content: space-between; align-items: baseline; }
.records h3 .meta { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 26px; color: #566072; letter-spacing: .22em; text-transform: uppercase; }
.records ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.records li { display: grid; grid-template-columns: auto 1fr auto; gap: 18px; align-items: center; padding: 12px 0; border-bottom: 1px dashed #d8d3c6; }
.records li:last-child { border-bottom: 0; }
.records li .ic { width: 56px; height: 56px; background: #e9e5db; display: grid; place-items: center;
  font-family: 'Bebas Neue', sans-serif; font-size: 30px; color: #0e1116; line-height: 1; }
.records li.new .ic { background: #b51d2c; color: #fff; }
.records li .body { display: flex; flex-direction: column; line-height: 1.1; }
.records li .body .nm { font-family: 'Archivo', sans-serif; font-weight: 800; font-size: 32px; color: #0e1116; letter-spacing: -.01em; }
.records li .body .who { font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 26px; color: #566072; letter-spacing: .18em; text-transform: uppercase; margin-top: 3px; }
.records li .v { font-family: 'Bebas Neue', sans-serif; font-size: 48px; color: #0e1116; letter-spacing: .02em; text-align: right; font-variant-numeric: tabular-nums; line-height: 1; }
.records li.new .v { color: #b51d2c; }
.records li.new .v::after { content: 'NEW'; display: block; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 24px; color: #b51d2c; letter-spacing: .28em; margin-top: 4px; }

/* UPCOMING */
.upcoming { position: absolute; left: 80px; right: 80px; bottom: 120px; height: 160px; background: #0f2a4a; color: #fff;
  border: 3px solid #0e1116; display: grid; grid-template-columns: 240px 1fr; align-items: stretch; z-index: 3; overflow: hidden; }
.upcoming .label { background: #c69635; color: #0e1116;
  display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 0 24px; line-height: 1; text-align: center; }
.upcoming .label .k { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 28px; letter-spacing: .28em; text-transform: uppercase; }
.upcoming .label .v { font-family: 'Bebas Neue', sans-serif; font-size: 54px; letter-spacing: .04em; line-height: .95; margin-top: 6px; white-space: pre-line; }
.upcoming .list { display: grid; grid-template-columns: repeat(4, 1fr); align-items: stretch; }
.upcoming .ev { padding: 16px 24px; border-right: 1px solid rgba(255,255,255,.18);
  display: flex; flex-direction: column; justify-content: space-between; line-height: 1.1; gap: 6px; }
.upcoming .ev:last-child { border-right: 0; }
.upcoming .ev .top { display: flex; justify-content: space-between; align-items: center; }
.upcoming .ev .day { font-family: 'Bebas Neue', sans-serif; font-size: 48px; color: #c69635; letter-spacing: .02em; line-height: .9; }
.upcoming .ev .badge { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 24px; letter-spacing: .2em; text-transform: uppercase; padding: 6px 12px; line-height: 1; }
.upcoming .ev .badge.h { background: #b51d2c; color: #fff; }
.upcoming .ev .badge.a { background: #fff; color: #0f2a4a; }
.upcoming .ev .matchup { font-family: 'Archivo', sans-serif; font-weight: 800; font-size: 36px; color: #fff; letter-spacing: -.01em; line-height: 1.1; text-wrap: balance; }
.upcoming .ev .meta { font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 26px; color: rgba(255,255,255,.7); letter-spacing: .18em; text-transform: uppercase; }

/* TICKER */
.ticker { position: absolute; left: 0; right: 0; bottom: 0; height: 120px; background: #0e1116; color: #fff;
  display: flex; align-items: center; overflow: hidden; z-index: 5; border-top: 6px solid #b51d2c; }
.ticker .tag { flex: 0 0 auto; background: #b51d2c; font-family: 'Bebas Neue', sans-serif; font-size: 48px;
  padding: 0 36px; height: 100%; display: flex; align-items: center; letter-spacing: .06em; gap: 18px; }
.ticker .tag::before { content: ''; width: 18px; height: 18px; background: #c69635; border-radius: 50%; animation: hsAthStBlink 1.4s steps(2) infinite; }
.ticker .msg { font-family: 'Archivo', sans-serif; font-weight: 700; font-size: 34px; padding-left: 36px;
  white-space: nowrap; letter-spacing: .04em; text-transform: uppercase; animation: hsAthStSc 110s linear infinite; }
.ticker .msg .star { color: #c69635; margin: 0 22px; }
`;
