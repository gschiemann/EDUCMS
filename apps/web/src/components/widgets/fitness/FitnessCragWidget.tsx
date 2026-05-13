"use client";

/**
 * FitnessCragWidget - 4K climbing-gym topo scene, 3840x2160.
 *
 * Source: scratch/design/fitness/09-crag.html
 * Ported via HsStage transform:scale pattern. Every pixel size is FIXED
 * (matches the HTML mockup); DO NOT regress to vw/%.
 *
 * Visual DNA - guidebook / topo aesthetic:
 *   - Parchment #f0e7d4 base + topo-line elliptical contours
 *   - Earth palette: rock #3d2e1f, moss #5a7d3a, rust #c4582a, gold #d4a83a
 *   - Archivo Black + Bebas Neue + Outfit + JetBrains Mono
 *   - Massive header "The Crag." + double-stroked rotated stamp
 *   - Left: paper "Fresh Sets" route board with 8 routes + grade chips
 *   - Right rail: dark leaderboard, moss-bordered head setter, rust closure card
 *   - Bottom: 5-column gym status strip on rock with gold dividers
 *
 * Editable hotspots use dot-notation `data-field` keys matching the HTML:
 *   head.t1, head.t2, head.sub, head.stamp
 *   routes.t1, routes.t2, routes.by
 *   routes.n1..n8, routes.g1..g8, routes.t1n..t8n, routes.t1d..t8d,
 *     routes.b1..b8, routes.s1..s8, routes.s1l..s8l
 *   leader.lab, leader.t1, leader.t2,
 *     leader.r1..r5, leader.n1..n5, leader.c1..c5, leader.s1..s5
 *   setter.lab, setter.ini, setter.t1, setter.t2, setter.meta
 *   reset.l, reset.h
 *   strip.l1..l5, strip.v1..v5, strip.u1..u5
 */

import { HsStage } from '../hs/HsStage';

export interface FitnessCragConfig {
  // Header
  'head.t1'?: string;
  'head.t2'?: string;
  'head.sub'?: string;
  'head.stamp'?: string;
  // Routes header
  'routes.t1'?: string;
  'routes.t2'?: string;
  'routes.by'?: string;
  // Routes 1-8
  'routes.n1'?: string;
  'routes.g1'?: string;
  'routes.t1n'?: string;
  'routes.t1d'?: string;
  'routes.b1'?: string;
  'routes.s1'?: string;
  'routes.s1l'?: string;
  'routes.n2'?: string;
  'routes.g2'?: string;
  'routes.t2n'?: string;
  'routes.t2d'?: string;
  'routes.b2'?: string;
  'routes.s2'?: string;
  'routes.s2l'?: string;
  'routes.n3'?: string;
  'routes.g3'?: string;
  'routes.t3n'?: string;
  'routes.t3d'?: string;
  'routes.b3'?: string;
  'routes.s3'?: string;
  'routes.s3l'?: string;
  'routes.n4'?: string;
  'routes.g4'?: string;
  'routes.t4n'?: string;
  'routes.t4d'?: string;
  'routes.b4'?: string;
  'routes.s4'?: string;
  'routes.s4l'?: string;
  'routes.n5'?: string;
  'routes.g5'?: string;
  'routes.t5n'?: string;
  'routes.t5d'?: string;
  'routes.b5'?: string;
  'routes.s5'?: string;
  'routes.s5l'?: string;
  'routes.n6'?: string;
  'routes.g6'?: string;
  'routes.t6n'?: string;
  'routes.t6d'?: string;
  'routes.b6'?: string;
  'routes.s6'?: string;
  'routes.s6l'?: string;
  'routes.n7'?: string;
  'routes.g7'?: string;
  'routes.t7n'?: string;
  'routes.t7d'?: string;
  'routes.b7'?: string;
  'routes.s7'?: string;
  'routes.s7l'?: string;
  'routes.n8'?: string;
  'routes.g8'?: string;
  'routes.t8n'?: string;
  'routes.t8d'?: string;
  'routes.b8'?: string;
  'routes.s8'?: string;
  'routes.s8l'?: string;
  // Leaderboard
  'leader.lab'?: string;
  'leader.t1'?: string;
  'leader.t2'?: string;
  'leader.r1'?: string;
  'leader.n1'?: string;
  'leader.c1'?: string;
  'leader.s1'?: string;
  'leader.r2'?: string;
  'leader.n2'?: string;
  'leader.c2'?: string;
  'leader.s2'?: string;
  'leader.r3'?: string;
  'leader.n3'?: string;
  'leader.c3'?: string;
  'leader.s3'?: string;
  'leader.r4'?: string;
  'leader.n4'?: string;
  'leader.c4'?: string;
  'leader.s4'?: string;
  'leader.r5'?: string;
  'leader.n5'?: string;
  'leader.c5'?: string;
  'leader.s5'?: string;
  // Setter
  'setter.lab'?: string;
  'setter.ini'?: string;
  'setter.t1'?: string;
  'setter.t2'?: string;
  'setter.meta'?: string;
  // Reset
  'reset.l'?: string;
  'reset.h'?: string;
  // Bottom strip
  'strip.l1'?: string;
  'strip.v1'?: string;
  'strip.u1'?: string;
  'strip.l2'?: string;
  'strip.v2'?: string;
  'strip.u2'?: string;
  'strip.l3'?: string;
  'strip.v3'?: string;
  'strip.u3'?: string;
  'strip.l4'?: string;
  'strip.v4'?: string;
  'strip.u4'?: string;
  'strip.l5'?: string;
  'strip.v5'?: string;
  'strip.u5'?: string;
}

/* eslint-disable @typescript-eslint/quotes */
export const DEFAULTS: Record<string, string> = {
  'head.t1':       'The ',
  'head.t2':       'Crag.',
  'head.sub':      '▸ ROUTES · BOULDER · TOPROPE · LEAD · KIDS WALL',
  'head.stamp':    'RESET ★ THIS WEEK',

  'routes.t1':     'Fresh ',
  'routes.t2':     'Sets.',
  'routes.by':     '▸ BOULDER CAVE · 9 NEW · 3/16 RESET',

  'routes.n1':     '#41',
  'routes.g1':     'V1',
  'routes.t1n':    'Slab Nap',
  'routes.t1d':    'flat slab to a balance mantle',
  'routes.b1':     'SET — JUNI',
  'routes.s1':     '42',
  'routes.s1l':    'SENDS',

  'routes.n2':     '#42',
  'routes.g2':     'V2',
  'routes.t2n':    'Easy Bake',
  'routes.t2d':    'crimps into a hueco rest',
  'routes.b2':     'SET — JUNI',
  'routes.s2':     '38',
  'routes.s2l':    'SENDS',

  'routes.n3':     '#43',
  'routes.g3':     'V4',
  'routes.t3n':    'Tendon City',
  'routes.t3d':    'crimp ladder, no feet at the lip',
  'routes.b3':     'SET — RUI',
  'routes.s3':     '14',
  'routes.s3l':    'SENDS',

  'routes.n4':     '#44',
  'routes.g4':     'V4',
  'routes.t4n':    'Power Hour',
  'routes.t4d':    'dyno into a sloper match',
  'routes.b4':     'SET — RUI',
  'routes.s4':     '9',
  'routes.s4l':    'SENDS',

  'routes.n5':     '#45',
  'routes.g5':     'V6',
  'routes.t5n':    'Bad Vibes',
  'routes.t5d':    'heel-toe cam to a deadpoint',
  'routes.b5':     'SET — KAI',
  'routes.s5':     '3',
  'routes.s5l':    'SENDS',

  'routes.n6':     '#46',
  'routes.g6':     'V6',
  'routes.t6n':    'Tweaker',
  'routes.t6d':    'tiny crimps, body tension all day',
  'routes.b6':     'SET — KAI',
  'routes.s6':     '2',
  'routes.s6l':    'SENDS',

  'routes.n7':     '#47',
  'routes.g7':     'V7',
  'routes.t7n':    'Caboodle',
  'routes.t7d':    'comp-style coordination problem',
  'routes.b7':     'SET — KAI',
  'routes.s7':     '1',
  'routes.s7l':    'SEND',

  'routes.n8':     '#48',
  'routes.g8':     'V9',
  'routes.t8n':    'Project',
  'routes.t8d':    'cutting-edge, look for the open beta',
  'routes.b8':     'SET — KAI',
  'routes.s8':     '0',
  'routes.s8l':    'SENDS',

  'leader.lab':    '★ COMP STANDINGS · MARCH SEND-OFF · WK 3/4',
  'leader.t1':     'Top ',
  'leader.t2':     'Sends.',
  'leader.r1':     '1',
  'leader.n1':     'Sasha Reinhart',
  'leader.c1':     '★ V8 flash · "Tweaker"',
  'leader.s1':     '2,840 PT',
  'leader.r2':     '2',
  'leader.n2':     'Marc Devereaux',
  'leader.c2':     '★ V7 redpoint · "Caboodle"',
  'leader.s2':     '2,610 PT',
  'leader.r3':     '3',
  'leader.n3':     'Lin Park',
  'leader.c3':     '★ Cleared whole comp set V0–V5',
  'leader.s3':     '2,395 PT',
  'leader.r4':     '4',
  'leader.n4':     'Halia Tanner',
  'leader.c4':     '★ first FA on #44',
  'leader.s4':     '2,180 PT',
  'leader.r5':     '5',
  'leader.n5':     'Devon Hughes',
  'leader.c5':     '★ Steady weekly grinder',
  'leader.s5':     '2,055 PT',

  'setter.lab':    '★ HEAD SETTER ON DECK',
  'setter.ini':    'KH',
  'setter.t1':     'Kai ',
  'setter.t2':     'Hawkins.',
  'setter.meta':   '▸ NEXT BOULDER RESET — TUE 3/24 · LEAD WALL — FRI 3/27',

  'reset.l':       '▸ WALL CLOSURE — MAINT.',
  'reset.h':       'SLAB CAVE CLOSED WED 3PM–9PM (BOLT INSPECTION)',

  'strip.l1':      '▸ MEMBERS IN',
  'strip.v1':      '38',
  'strip.u1':      'CURRENT · CAP 90',
  'strip.l2':      '▸ ROUTES UP',
  'strip.v2':      '142',
  'strip.u2':      '9 FRESH · 4 RESET TUE',
  'strip.l3':      '▸ TOPROPE',
  'strip.v3':      '12/14',
  'strip.u3':      'LANES OPEN',
  'strip.l4':      '▸ INTRO CLASS',
  'strip.v4':      '7P',
  'strip.u4':      '3 SPOTS LEFT',
  'strip.l5':      '▸ CHALK',
  'strip.v5':      'FREE',
  'strip.u5':      'FRONT DESK BUCKET',
};
/* eslint-enable @typescript-eslint/quotes */

function pick(cfg: FitnessCragConfig | undefined, key: keyof typeof DEFAULTS): string {
  return ((cfg as any)?.[key] as string | undefined) ?? DEFAULTS[key];
}

// Color class assignments for the 8 grade chips, mirroring the HTML mockup.
const GRADE_COLORS: ReadonlyArray<string> = [
  'fg-green', 'fg-green', 'fg-blue', 'fg-blue',
  'fg-red',   'fg-red',   'fg-purple', 'fg-black',
];

export function FitnessCragWidget({ config }: { config?: FitnessCragConfig }) {
  // Pre-resolve route rows so the JSX stays readable.
  const routes = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({
    n:   pick(config, `routes.n${i}` as keyof typeof DEFAULTS),
    g:   pick(config, `routes.g${i}` as keyof typeof DEFAULTS),
    nm:  pick(config, `routes.t${i}n` as keyof typeof DEFAULTS),
    nd:  pick(config, `routes.t${i}d` as keyof typeof DEFAULTS),
    by:  pick(config, `routes.b${i}` as keyof typeof DEFAULTS),
    s:   pick(config, `routes.s${i}` as keyof typeof DEFAULTS),
    sl:  pick(config, `routes.s${i}l` as keyof typeof DEFAULTS),
    color: GRADE_COLORS[i - 1],
    idx: i,
  }));

  const leaderRows = [1, 2, 3, 4, 5].map((i) => ({
    r: pick(config, `leader.r${i}` as keyof typeof DEFAULTS),
    n: pick(config, `leader.n${i}` as keyof typeof DEFAULTS),
    c: pick(config, `leader.c${i}` as keyof typeof DEFAULTS),
    s: pick(config, `leader.s${i}` as keyof typeof DEFAULTS),
    idx: i,
  }));

  return (
    <HsStage
      stageClassName="fg-stage"
      stageStyle={{ background: '#f0e7d4', color: '#1f1610', fontFamily: "'Outfit', sans-serif" }}
    >
      <style>{CSS}</style>

      {/* Header */}
      <div className="fg-head">
        <div className="fg-head-left">
          <div className="fg-title">
            <span data-field="head.t1">{pick(config, 'head.t1')}</span>
            <em data-field="head.t2">{pick(config, 'head.t2')}</em>
          </div>
          <div className="fg-sub" data-field="head.sub">{pick(config, 'head.sub')}</div>
        </div>
        <div className="fg-stamp" data-field="head.stamp">{pick(config, 'head.stamp')}</div>
      </div>

      {/* Route board */}
      <div className="fg-routes">
        <div className="fg-routes-h">
          <h2 className="fg-routes-ti">
            <span data-field="routes.t1">{pick(config, 'routes.t1')}</span>
            <em data-field="routes.t2">{pick(config, 'routes.t2')}</em>
          </h2>
          <div className="fg-routes-by" data-field="routes.by">{pick(config, 'routes.by')}</div>
        </div>
        {routes.map((r) => (
          <div className="fg-row" key={r.idx}>
            <div className="fg-num" data-field={`routes.n${r.idx}`}>{r.n}</div>
            <div className={`fg-gr ${r.color}`} data-field={`routes.g${r.idx}`}>{r.g}</div>
            <div className="fg-nm">
              <span data-field={`routes.t${r.idx}n`}>{r.nm}</span>
              <small data-field={`routes.t${r.idx}d`}>{r.nd}</small>
            </div>
            <div className="fg-row-by" data-field={`routes.b${r.idx}`}>{r.by}</div>
            <div className="fg-sends">
              <span data-field={`routes.s${r.idx}`}>{r.s}</span>
              <small data-field={`routes.s${r.idx}l`}>{r.sl}</small>
            </div>
          </div>
        ))}
      </div>

      {/* Right rail */}
      <div className="fg-rt">
        <div className="fg-leader">
          <div className="fg-leader-lab" data-field="leader.lab">{pick(config, 'leader.lab')}</div>
          <h3 className="fg-leader-h">
            <span data-field="leader.t1">{pick(config, 'leader.t1')}</span>
            <em data-field="leader.t2">{pick(config, 'leader.t2')}</em>
          </h3>
          <table className="fg-leader-table">
            <tbody>
              {leaderRows.map((row) => (
                <tr key={row.idx}>
                  <td className="fg-r" data-field={`leader.r${row.idx}`}>{row.r}</td>
                  <td className="fg-n" data-field={`leader.n${row.idx}`}>{row.n}</td>
                  <td data-field={`leader.c${row.idx}`}>{row.c}</td>
                  <td className="fg-s" data-field={`leader.s${row.idx}`}>{row.s}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="fg-setter">
          <div className="fg-setter-lab" data-field="setter.lab">{pick(config, 'setter.lab')}</div>
          <div className="fg-setter-row">
            <div className="fg-setter-ph" data-field="setter.ini">{pick(config, 'setter.ini')}</div>
            <div>
              <div className="fg-setter-nm">
                <span data-field="setter.t1">{pick(config, 'setter.t1')}</span>
                <em data-field="setter.t2">{pick(config, 'setter.t2')}</em>
              </div>
              <div className="fg-setter-meta" data-field="setter.meta">{pick(config, 'setter.meta')}</div>
            </div>
          </div>
        </div>

        <div className="fg-reset">
          <div>
            <div className="fg-reset-l" data-field="reset.l">{pick(config, 'reset.l')}</div>
            <h3 className="fg-reset-h" data-field="reset.h">{pick(config, 'reset.h')}</h3>
          </div>
        </div>
      </div>

      {/* Bottom strip */}
      <div className="fg-strip">
        <div className="fg-strip-c">
          <div className="fg-strip-lab" data-field="strip.l1">{pick(config, 'strip.l1')}</div>
          <div className="fg-strip-v" data-field="strip.v1">{pick(config, 'strip.v1')}</div>
          <div className="fg-strip-u" data-field="strip.u1">{pick(config, 'strip.u1')}</div>
        </div>
        <div className="fg-strip-c">
          <div className="fg-strip-lab" data-field="strip.l2">{pick(config, 'strip.l2')}</div>
          <div className="fg-strip-v" data-field="strip.v2">{pick(config, 'strip.v2')}</div>
          <div className="fg-strip-u" data-field="strip.u2">{pick(config, 'strip.u2')}</div>
        </div>
        <div className="fg-strip-c">
          <div className="fg-strip-lab" data-field="strip.l3">{pick(config, 'strip.l3')}</div>
          <div className="fg-strip-v" data-field="strip.v3">{pick(config, 'strip.v3')}</div>
          <div className="fg-strip-u" data-field="strip.u3">{pick(config, 'strip.u3')}</div>
        </div>
        <div className="fg-strip-c">
          <div className="fg-strip-lab" data-field="strip.l4">{pick(config, 'strip.l4')}</div>
          <div className="fg-strip-v" data-field="strip.v4">{pick(config, 'strip.v4')}</div>
          <div className="fg-strip-u" data-field="strip.u4">{pick(config, 'strip.u4')}</div>
        </div>
        <div className="fg-strip-c">
          <div className="fg-strip-lab" data-field="strip.l5">{pick(config, 'strip.l5')}</div>
          <div className="fg-strip-v" data-field="strip.v5">{pick(config, 'strip.v5')}</div>
          <div className="fg-strip-u" data-field="strip.u5">{pick(config, 'strip.u5')}</div>
        </div>
      </div>
    </HsStage>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=JetBrains+Mono:wght@500;700&family=Outfit:wght@400;700;900&family=Bebas+Neue&display=swap');

.fg-stage {
  background:
    radial-gradient(800px 600px at 90% 10%, rgba(196,88,42,.08), transparent 60%),
    radial-gradient(900px 700px at 10% 90%, rgba(90,125,58,.10), transparent 60%),
    #f0e7d4;
  color: #1f1610;
  font-family: 'Outfit', sans-serif;
}
/* Topo lines */
.fg-stage::before {
  content: '';
  position: absolute;
  top: 0; right: 0; bottom: 0; left: 0;
  pointer-events: none;
  opacity: .18;
  background-image:
    radial-gradient(ellipse 1200px 700px at 30% 40%, transparent 38%, rgba(61,46,31,.5) 38.5%, transparent 39%),
    radial-gradient(ellipse 1200px 700px at 30% 40%, transparent 32%, rgba(61,46,31,.5) 32.5%, transparent 33%),
    radial-gradient(ellipse 1200px 700px at 30% 40%, transparent 26%, rgba(61,46,31,.5) 26.5%, transparent 27%),
    radial-gradient(ellipse 1200px 700px at 30% 40%, transparent 20%, rgba(61,46,31,.5) 20.5%, transparent 21%),
    radial-gradient(ellipse 900px 600px at 80% 75%, transparent 42%, rgba(61,46,31,.4) 42.5%, transparent 43%),
    radial-gradient(ellipse 900px 600px at 80% 75%, transparent 34%, rgba(61,46,31,.4) 34.5%, transparent 35%),
    radial-gradient(ellipse 900px 600px at 80% 75%, transparent 26%, rgba(61,46,31,.4) 26.5%, transparent 27%);
}
/* Paper grain */
.fg-stage::after {
  content: '';
  position: absolute;
  top: 0; right: 0; bottom: 0; left: 0;
  pointer-events: none;
  background-image: repeating-linear-gradient(45deg, transparent 0 3px, rgba(61,46,31,.02) 3px 4px);
}

/* Header */
.fg-head {
  position: absolute; top: 80px; left: 120px; right: 120px;
  display: flex; justify-content: space-between; align-items: flex-start;
}
.fg-head-left { position: relative; }
.fg-title {
  font-family: 'Archivo Black'; font-size: 340px;
  line-height: .82; letter-spacing: -.04em;
}
.fg-title em { font-style: normal; color: #c4582a; }
.fg-sub {
  position: absolute; left: 0; top: 280px;
  font-family: 'JetBrains Mono'; font-size: 34px;
  letter-spacing: .32em; color: #3d2e1f;
}
.fg-stamp {
  border: 6px double #c4582a; padding: 16px 28px;
  transform: rotate(4deg); margin-top: 30px;
  font-family: 'Archivo Black'; font-size: 60px;
  color: #c4582a; letter-spacing: .06em;
}

/* Route board */
.fg-routes {
  position: absolute; top: 660px; left: 120px;
  width: 1700px;
  background: #f0e7d4; border: 8px solid #3d2e1f;
  padding: 50px 56px;
  box-shadow: 0 30px 80px rgba(0,0,0,.25);
}
.fg-routes-h {
  display: flex; justify-content: space-between; align-items: baseline;
  border-bottom: 6px double #3d2e1f; padding-bottom: 18px;
}
.fg-routes-ti {
  font-family: 'Archivo Black'; font-size: 90px;
  line-height: .85; margin: 0;
}
.fg-routes-ti em { font-style: normal; color: #c4582a; }
.fg-routes-by {
  font-family: 'JetBrains Mono'; font-size: 30px;
  letter-spacing: .18em; color: #7a6b50;
}
.fg-row {
  display: grid;
  grid-template-columns: 80px 140px 1fr 200px 100px;
  gap: 24px; padding: 18px 0; align-items: center;
  border-bottom: 2px dotted #3d2e1f;
}
.fg-row:last-child { border-bottom: 0; }
.fg-num {
  font-family: 'JetBrains Mono'; font-size: 42px;
  font-weight: 700; color: #7a6b50;
}
.fg-gr {
  font-family: 'Archivo Black'; font-size: 60px;
  color: #fff; text-align: center; padding: 8px 0; line-height: 1;
}
.fg-gr.fg-green { background: #5a7d3a; }
.fg-gr.fg-blue { background: #3d6b9a; }
.fg-gr.fg-red { background: #c4582a; }
.fg-gr.fg-purple { background: #6b3a7a; }
.fg-gr.fg-black { background: #3d2e1f; }
.fg-nm {
  font-family: 'Bebas Neue'; font-size: 54px;
  letter-spacing: .04em; line-height: 1;
}
.fg-nm small {
  display: block; font-family: 'Outfit'; font-weight: 400;
  font-size: 26px; letter-spacing: .06em;
  color: #7a6b50; margin-top: 6px; line-height: 1.2;
}
.fg-row-by {
  font-family: 'JetBrains Mono'; font-size: 28px;
  color: #3d2e1f; letter-spacing: .1em;
}
.fg-sends {
  font-family: 'Archivo Black'; font-size: 52px;
  color: #c4582a; text-align: right; line-height: 1;
}
.fg-sends small {
  font-family: 'Outfit'; font-weight: 400; font-size: 22px;
  color: #7a6b50; display: block; letter-spacing: .1em;
}

/* Right rail */
.fg-rt {
  position: absolute; top: 660px; right: 120px;
  width: 1860px;
  display: flex; flex-direction: column; gap: 32px;
}

.fg-leader {
  background: #3d2e1f; color: #f0e7d4;
  padding: 40px 50px;
}
.fg-leader-lab {
  font-family: 'JetBrains Mono'; font-size: 30px;
  letter-spacing: .28em; color: #d4a83a;
}
.fg-leader-h {
  font-family: 'Archivo Black'; font-size: 90px;
  line-height: .85; margin: 14px 0 22px;
}
.fg-leader-h em { font-style: normal; color: #d4a83a; }
.fg-leader-table {
  width: 100%; border-collapse: collapse;
  font-family: 'Outfit'; font-size: 34px;
}
.fg-leader-table td {
  padding: 14px 8px;
  border-bottom: 1px solid rgba(240,231,212,.2);
}
.fg-leader-table td.fg-r {
  font-family: 'Archivo Black'; font-size: 50px;
  color: #d4a83a; width: 80px; text-align: center;
}
.fg-leader-table td.fg-n { font-weight: 800; }
.fg-leader-table td.fg-s {
  font-family: 'JetBrains Mono'; font-weight: 700; text-align: right;
}

.fg-setter {
  background: #f0e7d4; border: 6px solid #5a7d3a;
  padding: 32px 40px;
}
.fg-setter-lab {
  font-family: 'JetBrains Mono'; font-size: 28px;
  letter-spacing: .28em; color: #5a7d3a;
}
.fg-setter-row {
  display: flex; gap: 30px; align-items: center; margin-top: 16px;
}
.fg-setter-ph {
  width: 140px; height: 140px; border-radius: 50%;
  background: #5a7d3a; color: #f0e7d4; flex: none;
  display: grid; place-items: center;
  font-family: 'Archivo Black'; font-size: 70px;
}
.fg-setter-nm {
  font-family: 'Archivo Black'; font-size: 60px; line-height: .95;
}
.fg-setter-nm em { font-style: normal; color: #c4582a; }
.fg-setter-meta {
  font-family: 'JetBrains Mono'; font-size: 24px;
  color: #7a6b50; letter-spacing: .12em; margin-top: 6px;
}

.fg-reset {
  background: #c4582a; color: #fff;
  padding: 30px 40px;
  display: flex; justify-content: space-between; align-items: center; gap: 30px;
}
.fg-reset-l {
  font-family: 'JetBrains Mono'; font-size: 30px;
  letter-spacing: .28em;
}
.fg-reset-h {
  font-family: 'Archivo Black'; font-size: 74px;
  line-height: .85; margin: 8px 0 0;
}

/* Bottom strip */
.fg-strip {
  position: absolute; bottom: 0; left: 0; right: 0;
  height: 200px;
  background: #3d2e1f; color: #f0e7d4;
  display: grid; grid-template-columns: repeat(5, 1fr);
  padding: 0 120px; align-items: center; gap: 60px;
}
.fg-strip-c {
  border-left: 3px solid #d4a83a; padding-left: 24px;
}
.fg-strip-c:first-child {
  border-left: 0; padding-left: 0;
}
.fg-strip-lab {
  font-family: 'JetBrains Mono'; font-size: 24px;
  letter-spacing: .28em; color: #d4a83a;
}
.fg-strip-v {
  font-family: 'Archivo Black'; font-size: 80px;
  line-height: .9; margin-top: 6px;
}
.fg-strip-u {
  font-family: 'Bebas Neue'; font-size: 32px;
  letter-spacing: .08em; color: #d8c8a8;
}
`;
