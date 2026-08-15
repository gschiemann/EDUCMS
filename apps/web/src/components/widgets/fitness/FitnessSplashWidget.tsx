"use client";

/**
 * FitnessSplashWidget — 4K aquatics-center scene, 3840×2160 (Splash theme).
 *
 * Ported from scratch/design/fitness/07-splash.html via the HsStage
 * transform:scale pattern. Every pixel size is FIXED (matches the
 * HTML mockup); DO NOT regress to vw/%.
 *
 * Visual DNA — pool / aquatic center, tile + chlorine + lifeguard red:
 *   - Sky-to-pool gradient base (#67e8f9 → #0891b2 → #0e7490)
 *   - 100px tile grid overlay + 3 elliptical water-shimmer highlights
 *   - Lifeguard-red header strip (#dc2626) with circle logo + huge title
 *   - Big lane-status board (left, 2400px wide): 6 rows with lane #,
 *     type, pace, occupancy, status chip (open/full/class/closed)
 *   - Right column (1180px): 4-cell water/air/pH/chlorine stats panel,
 *     home-meet card, dark pool-rules card
 *   - Bottom white ticker on red border (#dc2626 text)
 *   - Archivo Black display + Bebas Neue accents + Outfit body +
 *     JetBrains Mono labels
 *
 * Editable hotspots — every text element has a `data-field` attribute
 * matching the HTML mockup exactly. Field keys use dot notation:
 *   head.lg, head.t1, head.t2, head.lab, head.v
 *   lanes.t1, lanes.t2, lanes.meta
 *   lanes.l1n..l6n, lanes.l1t..l6t, lanes.l1p..l6p,
 *     lanes.l1o..l6o, lanes.l1s..l6s
 *   stats.l1..4, stats.v1..4, stats.u1..4
 *   meet.tag, meet.t1, meet.t2, meet.body, meet.when
 *   rules.tag, rules.r1, rules.r2, rules.r3
 *   ticker.tag, ticker.message
 */

import { HsStage } from '../hs/HsStage';
import { sceneCss } from '../scene-css';

export interface FitnessSplashConfig {
  // Gym logo image — replaces the text logo circle in the header when set
  gymLogoUrl?: string;
  // Header
  'head.lg'?: string;
  'head.t1'?: string;
  'head.t2'?: string;
  'head.lab'?: string;
  'head.v'?: string;
  // Lanes panel
  'lanes.t1'?: string;
  'lanes.t2'?: string;
  'lanes.meta'?: string;
  'lanes.l1n'?: string; 'lanes.l1t'?: string; 'lanes.l1p'?: string; 'lanes.l1o'?: string; 'lanes.l1s'?: string;
  'lanes.l2n'?: string; 'lanes.l2t'?: string; 'lanes.l2p'?: string; 'lanes.l2o'?: string; 'lanes.l2s'?: string;
  'lanes.l3n'?: string; 'lanes.l3t'?: string; 'lanes.l3p'?: string; 'lanes.l3o'?: string; 'lanes.l3s'?: string;
  'lanes.l4n'?: string; 'lanes.l4t'?: string; 'lanes.l4p'?: string; 'lanes.l4o'?: string; 'lanes.l4s'?: string;
  'lanes.l5n'?: string; 'lanes.l5t'?: string; 'lanes.l5p'?: string; 'lanes.l5o'?: string; 'lanes.l5s'?: string;
  'lanes.l6n'?: string; 'lanes.l6t'?: string; 'lanes.l6p'?: string; 'lanes.l6o'?: string; 'lanes.l6s'?: string;
  // Right column — stats
  'stats.l1'?: string; 'stats.v1'?: string; 'stats.u1'?: string;
  'stats.l2'?: string; 'stats.v2'?: string; 'stats.u2'?: string;
  'stats.l3'?: string; 'stats.v3'?: string; 'stats.u3'?: string;
  'stats.l4'?: string; 'stats.v4'?: string; 'stats.u4'?: string;
  // Right column — meet
  'meet.tag'?: string;
  'meet.t1'?: string;
  'meet.t2'?: string;
  'meet.body'?: string;
  'meet.when'?: string;
  // Right column — rules
  'rules.tag'?: string;
  'rules.r1'?: string;
  'rules.r2'?: string;
  'rules.r3'?: string;
  // Ticker
  'ticker.tag'?: string;
  'ticker.message'?: string;
}

/* eslint-disable @typescript-eslint/quotes */
export const DEFAULTS: Record<string, string> = {
  // Gym logo image upload (optional — replaces the text circle logo)
  'gymLogoUrl': '',
  'head.lg':  '★',
  'head.t1':  'Splash ',
  'head.t2':  'City.',
  'head.lab': '▸ POOL OPEN — 6:14 AM',
  'head.v':   '82°',

  'lanes.t1':   'Lane ',
  'lanes.t2':   'Status.',
  'lanes.meta': '25 YD POOL · 6 LANES · UPDATED 6:14A',

  'lanes.l1n': '1', 'lanes.l1t': 'SLOW LAP',        'lanes.l1p': '2:30 / 100',     'lanes.l1o': '2 swimmers · circle',                   'lanes.l1s': 'OPEN',
  'lanes.l2n': '2', 'lanes.l2t': 'MEDIUM',          'lanes.l2p': '1:55 / 100',     'lanes.l2o': '3 swimmers · circle',                   'lanes.l2s': 'OPEN',
  'lanes.l3n': '3', 'lanes.l3t': 'FAST',            'lanes.l3p': '1:20 / 100',     'lanes.l3o': '4 swimmers · circle',                   'lanes.l3s': 'FULL',
  'lanes.l4n': '4', 'lanes.l4t': 'FAST',            'lanes.l4p': '1:15 / 100',     'lanes.l4o': '2 swimmers · split',                    'lanes.l4s': 'OPEN',
  'lanes.l5n': '5', 'lanes.l5t': 'AQUA FIT CLASS',  'lanes.l5p': '7:00–7:45A',     'lanes.l5o': '14 / 18 spots — Coach Marlene',         'lanes.l5s': 'CLASS',
  'lanes.l6n': '6', 'lanes.l6t': 'MAINT.',          'lanes.l6p': 'RE-OPEN 9A',     'lanes.l6o': 'tile repair, lane rope replacement',    'lanes.l6s': 'CLOSED',

  'stats.l1': '▸ WATER',    'stats.v1': '82°', 'stats.u1': 'F · TARGET 80–84',
  'stats.l2': '▸ AIR',      'stats.v2': '80°', 'stats.u2': 'F · 65% RH',
  'stats.l3': '▸ pH',       'stats.v3': '7.4', 'stats.u3': 'IDEAL — 7.2–7.6',
  'stats.l4': '▸ CHLORINE', 'stats.v4': '2.1', 'stats.u4': 'PPM · OK',

  'meet.tag':  '★ HOME MEET — SAT',
  'meet.t1':   'Sharks ',
  'meet.t2':   'vs Vikings.',
  'meet.body': 'Spectator deck opens at 9:00 sharp. Lanes 1–6 closed all day Saturday for the meet. Free admission for members; $3 guests.',
  'meet.when': '▸ SAT 3/22 · WARM-UPS 8A · FIRST HEAT 9A',

  'rules.tag': '▸ POOL RULES — TODAY',
  'rules.r1':  'Shower before entering — chlorine reacts to oils/lotions',
  'rules.r2':  'Circle swim when 3+ in a lane (counter-clockwise)',
  'rules.r3':  'No diving in shallow end (south wall)',

  'ticker.tag':     '★ AQUATICS',
  'ticker.message': '★ FAMILY SWIM — SAT/SUN 12–3P · WHOLE DEEP END OPEN ★ MASTERS WED/FRI 6A · COACH ENA TAKING NEW SWIMMERS ★',
};
/* eslint-enable @typescript-eslint/quotes */

function pick(cfg: FitnessSplashConfig | undefined, key: keyof typeof DEFAULTS): string {
  return ((cfg as any)?.[key] as string | undefined) ?? DEFAULTS[key];
}

// Map a status string to a CSS modifier class so the chip color matches
// the HTML mockup. Defaults to "open" when the string is unrecognized.
function statusClass(status: string): string {
  const s = status.trim().toUpperCase();
  if (s === 'OPEN') return 'fp-stat-open';
  if (s === 'FULL' || s === 'CLASS') return 'fp-stat-full';
  if (s === 'CLOSED' || s === 'CLS' || s === 'MAINT' || s === 'MAINT.') return 'fp-stat-cls';
  return 'fp-stat-open';
}

function isClosed(status: string): boolean {
  const s = status.trim().toUpperCase();
  return s === 'CLOSED' || s === 'CLS';
}

export function FitnessSplashWidget({ config }: { config?: FitnessSplashConfig }) {
  const lane6Status = pick(config, 'lanes.l6s');

  return (
    <HsStage
      stageClassName="fp-stage"
      stageStyle={{
        background: 'linear-gradient(180deg, #67e8f9 0%, #0891b2 60%, #0e7490 100%)',
        color: '#0c2a3a',
        fontFamily: "'Outfit', sans-serif",
      }}
    >
      <style>{sceneCss(CSS)}</style>

      {/* Header */}
      <div className="fp-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {pick(config, 'gymLogoUrl') ? (
          <img src={pick(config, 'gymLogoUrl')} alt="Gym logo" className="fp-gym-logo" />
        ) : (
          <div className="fp-lg" data-field="head.lg">{pick(config, 'head.lg')}</div>
        )}
        <div className="fp-ti">
          <span data-field="head.t1">{pick(config, 'head.t1')}</span>
          <em data-field="head.t2">{pick(config, 'head.t2')}</em>
        </div>
        <div className="fp-now">
          <div className="fp-now-lab" data-field="head.lab">{pick(config, 'head.lab')}</div>
          <div className="fp-now-v" data-field="head.v">{pick(config, 'head.v')}</div>
        </div>
      </div>

      {/* Lane status board */}
      <div className="fp-lanes">
        <div className="fp-lanes-h">
          <h2 className="fp-lanes-h2">
            <span data-field="lanes.t1">{pick(config, 'lanes.t1')}</span>
            <em data-field="lanes.t2">{pick(config, 'lanes.t2')}</em>
          </h2>
          <div className="fp-lanes-meta" data-field="lanes.meta">{pick(config, 'lanes.meta')}</div>
        </div>

        <div className="fp-lane-row">
          <div className="fp-ln" data-field="lanes.l1n">{pick(config, 'lanes.l1n')}</div>
          <div className="fp-ty" data-field="lanes.l1t">{pick(config, 'lanes.l1t')}</div>
          <div className="fp-pace" data-field="lanes.l1p">{pick(config, 'lanes.l1p')}</div>
          <div className="fp-occ" data-field="lanes.l1o">{pick(config, 'lanes.l1o')}</div>
          <div className={`fp-stat ${statusClass(pick(config, 'lanes.l1s'))}`} data-field="lanes.l1s">{pick(config, 'lanes.l1s')}</div>
        </div>

        <div className="fp-lane-row">
          <div className="fp-ln" data-field="lanes.l2n">{pick(config, 'lanes.l2n')}</div>
          <div className="fp-ty" data-field="lanes.l2t">{pick(config, 'lanes.l2t')}</div>
          <div className="fp-pace" data-field="lanes.l2p">{pick(config, 'lanes.l2p')}</div>
          <div className="fp-occ" data-field="lanes.l2o">{pick(config, 'lanes.l2o')}</div>
          <div className={`fp-stat ${statusClass(pick(config, 'lanes.l2s'))}`} data-field="lanes.l2s">{pick(config, 'lanes.l2s')}</div>
        </div>

        <div className="fp-lane-row">
          <div className="fp-ln" data-field="lanes.l3n">{pick(config, 'lanes.l3n')}</div>
          <div className="fp-ty" data-field="lanes.l3t">{pick(config, 'lanes.l3t')}</div>
          <div className="fp-pace" data-field="lanes.l3p">{pick(config, 'lanes.l3p')}</div>
          <div className="fp-occ" data-field="lanes.l3o">{pick(config, 'lanes.l3o')}</div>
          <div className={`fp-stat ${statusClass(pick(config, 'lanes.l3s'))}`} data-field="lanes.l3s">{pick(config, 'lanes.l3s')}</div>
        </div>

        <div className="fp-lane-row">
          <div className="fp-ln" data-field="lanes.l4n">{pick(config, 'lanes.l4n')}</div>
          <div className="fp-ty" data-field="lanes.l4t">{pick(config, 'lanes.l4t')}</div>
          <div className="fp-pace" data-field="lanes.l4p">{pick(config, 'lanes.l4p')}</div>
          <div className="fp-occ" data-field="lanes.l4o">{pick(config, 'lanes.l4o')}</div>
          <div className={`fp-stat ${statusClass(pick(config, 'lanes.l4s'))}`} data-field="lanes.l4s">{pick(config, 'lanes.l4s')}</div>
        </div>

        <div className="fp-lane-row">
          <div className="fp-ln" data-field="lanes.l5n">{pick(config, 'lanes.l5n')}</div>
          <div className="fp-ty" data-field="lanes.l5t">{pick(config, 'lanes.l5t')}</div>
          <div className="fp-pace" data-field="lanes.l5p">{pick(config, 'lanes.l5p')}</div>
          <div className="fp-occ" data-field="lanes.l5o">{pick(config, 'lanes.l5o')}</div>
          <div className={`fp-stat ${statusClass(pick(config, 'lanes.l5s'))}`} data-field="lanes.l5s">{pick(config, 'lanes.l5s')}</div>
        </div>

        <div className={`fp-lane-row ${isClosed(lane6Status) ? 'fp-closed' : ''}`}>
          <div className="fp-ln" data-field="lanes.l6n">{pick(config, 'lanes.l6n')}</div>
          <div className="fp-ty" data-field="lanes.l6t">{pick(config, 'lanes.l6t')}</div>
          <div className="fp-pace" data-field="lanes.l6p">{pick(config, 'lanes.l6p')}</div>
          <div className="fp-occ" data-field="lanes.l6o">{pick(config, 'lanes.l6o')}</div>
          <div className={`fp-stat ${statusClass(lane6Status)}`} data-field="lanes.l6s">{lane6Status}</div>
        </div>
      </div>

      {/* Right column */}
      <div className="fp-rt">
        <div className="fp-stats">
          <div className="fp-stats-cell">
            <div className="fp-stats-lab" data-field="stats.l1">{pick(config, 'stats.l1')}</div>
            <div className="fp-stats-v" data-field="stats.v1">{pick(config, 'stats.v1')}</div>
            <div className="fp-stats-u" data-field="stats.u1">{pick(config, 'stats.u1')}</div>
          </div>
          <div className="fp-stats-cell">
            <div className="fp-stats-lab" data-field="stats.l2">{pick(config, 'stats.l2')}</div>
            <div className="fp-stats-v" data-field="stats.v2">{pick(config, 'stats.v2')}</div>
            <div className="fp-stats-u" data-field="stats.u2">{pick(config, 'stats.u2')}</div>
          </div>
          <div className="fp-stats-cell">
            <div className="fp-stats-lab" data-field="stats.l3">{pick(config, 'stats.l3')}</div>
            <div className="fp-stats-v" data-field="stats.v3">{pick(config, 'stats.v3')}</div>
            <div className="fp-stats-u" data-field="stats.u3">{pick(config, 'stats.u3')}</div>
          </div>
          <div className="fp-stats-cell">
            <div className="fp-stats-lab" data-field="stats.l4">{pick(config, 'stats.l4')}</div>
            <div className="fp-stats-v" data-field="stats.v4">{pick(config, 'stats.v4')}</div>
            <div className="fp-stats-u" data-field="stats.u4">{pick(config, 'stats.u4')}</div>
          </div>
        </div>

        <div className="fp-meet">
          <div className="fp-meet-tag" data-field="meet.tag">{pick(config, 'meet.tag')}</div>
          <h3 className="fp-meet-h3">
            <span data-field="meet.t1">{pick(config, 'meet.t1')}</span>
            <em data-field="meet.t2">{pick(config, 'meet.t2')}</em>
          </h3>
          <div className="fp-meet-body" data-field="meet.body">{pick(config, 'meet.body')}</div>
          <div className="fp-meet-when" data-field="meet.when">{pick(config, 'meet.when')}</div>
        </div>

        <div className="fp-rules">
          <div className="fp-rules-tag" data-field="rules.tag">{pick(config, 'rules.tag')}</div>
          <ul className="fp-rules-ul">
            <li data-field="rules.r1">{pick(config, 'rules.r1')}</li>
            <li data-field="rules.r2">{pick(config, 'rules.r2')}</li>
            <li data-field="rules.r3">{pick(config, 'rules.r3')}</li>
          </ul>
        </div>
      </div>

      {/* Bottom ticker */}
      <div className="fp-ticker">
        <div className="fp-ticker-tag" data-field="ticker.tag">{pick(config, 'ticker.tag')}</div>
        <div className="fp-ticker-msg" data-field="ticker.message">{pick(config, 'ticker.message')}</div>
      </div>
    </HsStage>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=JetBrains+Mono:wght@500;700&family=Outfit:wght@400;700;900&family=Bebas+Neue&display=swap');

.fp-stage::before {
  content: '';
  position: absolute; top: 0; right: 0; bottom: 0; left: 0; pointer-events: none;
  background-image:
    linear-gradient(0deg, rgba(255,255,255,.08) 0 2px, transparent 2px 100px),
    linear-gradient(90deg, rgba(255,255,255,.08) 0 2px, transparent 2px 100px);
}
.fp-stage::after {
  content: '';
  position: absolute; top: 0; right: 0; bottom: 0; left: 0; pointer-events: none;
  background-image:
    radial-gradient(ellipse 200px 30px at 30% 40%, rgba(255,255,255,.18), transparent 70%),
    radial-gradient(ellipse 300px 40px at 70% 70%, rgba(255,255,255,.14), transparent 70%),
    radial-gradient(ellipse 250px 35px at 20% 80%, rgba(255,255,255,.12), transparent 70%);
  animation: fp-shimmer 8s ease-in-out infinite alternate;
}
@keyframes fp-shimmer {
  0%   { transform: translateX(0)    translateY(0); opacity: 1; }
  100% { transform: translateX(60px) translateY(-30px); opacity: .75; }
}

.fp-head {
  position: absolute; top: 0; left: 0; right: 0; height: 240px;
  background: #dc2626;
  display: flex; align-items: center;
  padding: 0 80px; gap: 60px;
  border-bottom: 8px solid #fff;
  z-index: 2;
}
.fp-gym-logo { width: 160px; height: 160px; border-radius: 50%; object-fit: cover; object-position: center; flex: none; border: 8px solid #dc2626; box-shadow: 0 0 0 8px #fff; }
.fp-lg {
  width: 160px; height: 160px; border-radius: 50%;
  background: #fff; color: #dc2626;
  display: grid; place-items: center;
  font-family: 'Archivo Black'; font-size: 90px; flex: none;
  border: 8px solid #dc2626;
  box-shadow: 0 0 0 8px #fff;
}
.fp-ti {
  font-family: 'Archivo Black'; font-size: 160px; line-height: .85;
  color: #fff; letter-spacing: -.03em;
}
.fp-ti em { font-style: normal; color: #0c2a3a; }
.fp-now {
  margin-left: auto; text-align: right;
}
.fp-now-lab {
  font-family: 'JetBrains Mono'; font-size: 30px; letter-spacing: .28em;
  color: rgba(255,255,255,.85);
}
.fp-now-v {
  font-family: 'Archivo Black'; font-size: 140px; line-height: .85; color: #fff;
}

.fp-lanes {
  position: absolute; top: 280px; left: 80px; width: 2400px;
  background: rgba(255,255,255,.96);
  border: 8px solid #fff; padding: 50px 56px;
  box-shadow: 0 30px 80px rgba(0,0,0,.3);
  z-index: 2;
}
.fp-lanes-h {
  display: flex; justify-content: space-between; align-items: baseline;
  margin-bottom: 30px; padding-bottom: 20px;
  border-bottom: 6px double #0891b2;
}
.fp-lanes-h2 {
  font-family: 'Archivo Black'; font-size: 90px; line-height: .85;
  margin: 0; color: #0c2a3a;
}
.fp-lanes-h2 em { font-style: normal; color: #dc2626; }
.fp-lanes-meta {
  font-family: 'JetBrains Mono'; font-size: 30px; letter-spacing: .18em;
  color: #5a8499;
}

.fp-lane-row {
  display: flex; gap: 24px; padding: 18px 0;
  align-items: center; border-bottom: 2px solid #b3d9e6;
}
.fp-lane-row:last-child { border-bottom: 0; }
.fp-ln {
  width: 90px; flex: none;
  font-family: 'Archivo Black'; font-size: 80px; color: #fff;
  background: #0891b2;
  text-align: center; line-height: 90px;
}
.fp-closed .fp-ln { background: #999; }
.fp-ty {
  width: 340px; flex: none;
  font-family: 'Bebas Neue'; font-size: 54px; letter-spacing: .04em;
  color: #0c2a3a;
}
.fp-closed .fp-ty { color: #999; text-decoration: line-through; }
.fp-pace {
  width: 200px; flex: none;
  font-family: 'JetBrains Mono'; font-weight: 700; font-size: 36px;
  color: #155e75;
}
.fp-occ {
  flex: 1;
  font-family: 'Outfit'; font-weight: 700; font-size: 36px; color: #0c2a3a;
}
.fp-stat {
  flex: none;
  font-family: 'JetBrains Mono'; font-size: 28px; letter-spacing: .18em;
  padding: 8px 16px;
}
.fp-stat-open { background: #67e8f9; color: #0c2a3a; }
.fp-stat-full { background: #dc2626; color: #fff; }
.fp-stat-cls  { background: #999;    color: #fff; }

.fp-rt {
  position: absolute; top: 280px; right: 80px; width: 1180px;
  display: flex; flex-direction: column; gap: 32px;
  z-index: 2;
}

.fp-stats {
  background: #155e75; color: #fff;
  padding: 36px 44px; border: 8px solid #fff;
  display: grid; grid-template-columns: repeat(2,1fr); gap: 24px 32px;
}
.fp-stats-lab {
  font-family: 'JetBrains Mono'; font-size: 24px; letter-spacing: .28em; color: #67e8f9;
}
.fp-stats-v {
  font-family: 'Archivo Black'; font-size: 96px; line-height: .85;
}
.fp-stats-u {
  font-family: 'Bebas Neue'; font-size: 36px; letter-spacing: .06em; color: #67e8f9;
}

.fp-meet {
  background: #fff; border: 8px solid #dc2626; padding: 36px 44px;
}
.fp-meet-tag {
  font-family: 'JetBrains Mono'; font-size: 30px; letter-spacing: .28em; color: #dc2626;
}
.fp-meet-h3 {
  font-family: 'Archivo Black'; font-size: 90px; line-height: .85;
  margin: 14px 0 0;
}
.fp-meet-h3 em { font-style: normal; color: #dc2626; }
.fp-meet-body {
  font-family: 'Outfit'; font-weight: 700; font-size: 36px; line-height: 1.3;
  color: #0c2a3a; margin-top: 20px;
}
.fp-meet-when {
  font-family: 'JetBrains Mono'; font-size: 32px; letter-spacing: .15em;
  color: #155e75; margin-top: 18px;
}

.fp-rules {
  background: #0c2a3a; color: #fff;
  padding: 30px 40px;
}
.fp-rules-tag {
  font-family: 'JetBrains Mono'; font-size: 26px; letter-spacing: .28em; color: #67e8f9;
}
.fp-rules-ul {
  padding-left: 30px; margin: 14px 0 0;
  font-family: 'Outfit'; font-weight: 700; font-size: 30px; line-height: 1.4;
}

.fp-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 120px;
  background: #fff; color: #dc2626;
  display: flex; align-items: center; gap: 40px; overflow: hidden;
  font-family: 'Archivo Black'; font-size: 60px;
  border-top: 8px solid #dc2626;
  z-index: 3;
}
.fp-ticker-tag {
  background: #dc2626; color: #fff;
  padding: 14px 30px; margin-left: 24px;
  flex: none; font-size: 42px; letter-spacing: .18em;
}
.fp-ticker-msg {
  white-space: nowrap;
  animation: fp-ticker-scroll 60s linear infinite;
}
@keyframes fp-ticker-scroll {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
`;
