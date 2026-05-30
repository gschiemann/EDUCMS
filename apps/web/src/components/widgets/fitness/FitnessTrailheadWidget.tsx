"use client";

/**
 * FitnessTrailheadWidget — 4K Run Club / Outdoor Cardio scene, 3840x2160.
 *
 * APPROVED 2026-05-03 — matches scratch/design/fitness/13-trailhead.html
 * Ported via HsStage transform:scale pattern. Every pixel size is
 * FIXED (matches the HTML mockup); DO NOT regress to vw/%.
 *
 * Visual DNA — topographic map + national-park sign aesthetic:
 *   - Paper #e9dfc6 base + forest #2d5a3a + clay #c75d3a + gold #dba93f
 *   - Layered radial-gradient "topo contour" lines on the background
 *   - Archivo Black display + Bebas Neue subheads + Outfit body + JetBrains Mono labels
 *   - National-park-style sign top with double-bevel cream inset border
 *   - Three-column body: today's runs / trail conditions / leaderboard
 *   - Bottom forest-green strip with mileage counters + announcement
 *
 * Editable hotspots — every text element has a `data-field` attribute.
 * Field keys use dot notation:
 *   sign.arrow, sign.t1, sign.t2, sign.s1, sign.s2, sign.s3
 *   runs.t1..t2, runs.sub, runs.t{1..6}{t,n,d,p,pl}
 *   cond.h, cond.l{1..6}, cond.v{1..6}, cond.note
 *   lb.lab, lb.t1, lb.t2, lb.r{1..7}, lb.n{1..7}, lb.m{1..7}
 *   strip.b{1..3}, strip.l{1..3}, strip.msg
 */

import { useEffect, useState } from 'react';
import { HsStage } from '../hs/HsStage';

export interface FitnessTrailheadConfig {
  // Gym logo — optional image for the sign area
  gymLogoUrl?: string;
  // Sign
  'sign.arrow'?: string;
  'sign.t1'?: string;
  'sign.t2'?: string;
  'sign.s1'?: string;
  'sign.s2'?: string;
  'sign.s3'?: string;
  /** When true the conditions header auto-updates from the device clock every second. */
  liveClock?: boolean;
  // Runs
  'runs.t1'?: string;
  'runs.t2'?: string;
  'runs.sub'?: string;
  'runs.t1t'?: string;
  'runs.t1n'?: string;
  'runs.t1d'?: string;
  'runs.t1p'?: string;
  'runs.t1pl'?: string;
  'runs.t2t'?: string;
  'runs.t2n'?: string;
  'runs.t2d'?: string;
  'runs.t2p'?: string;
  'runs.t2pl'?: string;
  'runs.t3t'?: string;
  'runs.t3n'?: string;
  'runs.t3d'?: string;
  'runs.t3p'?: string;
  'runs.t3pl'?: string;
  'runs.t4t'?: string;
  'runs.t4n'?: string;
  'runs.t4d'?: string;
  'runs.t4p'?: string;
  'runs.t4pl'?: string;
  'runs.t5t'?: string;
  'runs.t5n'?: string;
  'runs.t5d'?: string;
  'runs.t5p'?: string;
  'runs.t5pl'?: string;
  'runs.t6t'?: string;
  'runs.t6n'?: string;
  'runs.t6d'?: string;
  'runs.t6p'?: string;
  'runs.t6pl'?: string;
  // Conditions
  'cond.h'?: string;
  'cond.l1'?: string;
  'cond.v1'?: string;
  'cond.l2'?: string;
  'cond.v2'?: string;
  'cond.l3'?: string;
  'cond.v3'?: string;
  'cond.l4'?: string;
  'cond.v4'?: string;
  'cond.l5'?: string;
  'cond.v5'?: string;
  'cond.l6'?: string;
  'cond.v6'?: string;
  'cond.note'?: string;
  // Leaderboard
  'lb.lab'?: string;
  'lb.t1'?: string;
  'lb.t2'?: string;
  'lb.r1'?: string;
  'lb.n1'?: string;
  'lb.m1'?: string;
  'lb.r2'?: string;
  'lb.n2'?: string;
  'lb.m2'?: string;
  'lb.r3'?: string;
  'lb.n3'?: string;
  'lb.m3'?: string;
  'lb.r4'?: string;
  'lb.n4'?: string;
  'lb.m4'?: string;
  'lb.r5'?: string;
  'lb.n5'?: string;
  'lb.m5'?: string;
  'lb.r6'?: string;
  'lb.n6'?: string;
  'lb.m6'?: string;
  'lb.r7'?: string;
  'lb.n7'?: string;
  'lb.m7'?: string;
  // Strip
  'strip.b1'?: string;
  'strip.l1'?: string;
  'strip.b2'?: string;
  'strip.l2'?: string;
  'strip.b3'?: string;
  'strip.l3'?: string;
  'strip.msg'?: string;
}

/* eslint-disable @typescript-eslint/quotes */
export const DEFAULTS: Record<string, string> = {
  // Gym logo image upload (optional — falls back to text logo in the sign)
  'gymLogoUrl':        '',
  'sign.arrow':        '→',
  'sign.t1':           'Trail',
  'sign.t2':           'head.',
  'sign.s1':           'EAST GATE',
  'sign.s2':           'ELV 1,420′',
  'sign.s3':           '▸ 12 ROUTES · 48 MILES',

  'runs.t1':           'Group ',
  'runs.t2':           'Runs.',
  'runs.sub':          '▸ TODAY · MEET AT THE TRAILHEAD KIOSK · BRING A BOTTLE',
  'runs.t1t':          '5:30A',
  'runs.t1n':          'Sunrise Easy 4',
  'runs.t1d':          'flat lake loop · all paces welcome',
  'runs.t1p':          '10:30 / mi',
  'runs.t1pl':         'CONVERSATIONAL',
  'runs.t2t':          '6:00A',
  'runs.t2n':          'Workout Wednesday',
  'runs.t2d':          '6×800 @ threshold · track',
  'runs.t2p':          '5:50 / 800',
  'runs.t2pl':         'FAST GROUP',
  'runs.t3t':          '12:00P',
  'runs.t3n':          'Lunch Lap 3',
  'runs.t3d':          'river path · easy & brisk groups',
  'runs.t3p':          '9:00–11:00',
  'runs.t3pl':         '2 PACES',
  'runs.t4t':          '5:30P',
  'runs.t4n':          'Hill Repeats',
  'runs.t4d':          '8 × Maple Hill · 90s recovery',
  'runs.t4p':          '5K effort',
  'runs.t4pl':         'FAST & STEEP',
  'runs.t5t':          '6:00P',
  'runs.t5n':          'Beginner 5K',
  'runs.t5d':          'walk/run intervals · couch-to-5K wk 4',
  'runs.t5p':          '4-1',
  'runs.t5pl':         'RUN/WALK',
  'runs.t6t':          '7:30P',
  'runs.t6n':          'Sundown Long',
  'runs.t6d':          '10mi · all paces · headlamps after 8p',
  'runs.t6p':          '8:30–10:00',
  'runs.t6pl':         'DISTANCE',

  'cond.h':            '▸ TRAIL CONDITIONS · 6:14A',
  'cond.l1':           'AIR TEMP',
  'cond.v1':           '42°',
  'cond.l2':           'DEWPOINT',
  'cond.v2':           '38°',
  'cond.l3':           'WIND',
  'cond.v3':           '8 NW',
  'cond.l4':           'SUNRISE',
  'cond.v4':           '7:14A',
  'cond.l5':           'SUNSET',
  'cond.v5':           '7:32P',
  'cond.l6':           'UV INDEX',
  'cond.v6':           '4 / 11',
  'cond.note':         '★ Trail #3 muddy past the bridge — closed shoes only. Goose family on the lake loop, give them room.',

  'lb.lab':            '★ MARCH MILEAGE BOARD',
  'lb.t1':             'Top ',
  'lb.t2':             'Striders.',
  'lb.r1':             '1',
  'lb.n1':             'Marisol Vega',
  'lb.m1':             '214 mi',
  'lb.r2':             '2',
  'lb.n2':             'Hiro Tanaka',
  'lb.m2':             '198 mi',
  'lb.r3':             '3',
  'lb.n3':             'Penny Asher',
  'lb.m3':             '185 mi',
  'lb.r4':             '4',
  'lb.n4':             'Conor Daley',
  'lb.m4':             '172 mi',
  'lb.r5':             '5',
  'lb.n5':             'Bea Okafor',
  'lb.m5':             '168 mi',
  'lb.r6':             '6',
  'lb.n6':             'Theo Klein',
  'lb.m6':             '154 mi',
  'lb.r7':             '7',
  'lb.n7':             'Ana Rivera',
  'lb.m7':             '142 mi',

  'strip.b1':          '3,420',
  'strip.l1':          'CLUB MI · MAR',
  'strip.b2':          '142',
  'strip.l2':          'RUNNERS LOGGED',
  'strip.b3':          '12',
  'strip.l3':          'DAYS TO HALF',
  'strip.msg':         '★ NORTHGATE HALF — APRIL 7 · BIBS AT THE FRONT DESK\n★ FREE SHOE FITTING — SAT 9A — RUN STORE',
};
/* eslint-enable @typescript-eslint/quotes */

function pick(cfg: FitnessTrailheadConfig | undefined, key: keyof typeof DEFAULTS): string {
  return ((cfg as any)?.[key] as string | undefined) ?? DEFAULTS[key];
}

function useLiveCondHeader(enabled: boolean, fallback: string): string {
  const [tick, setTick] = useState<string>(enabled ? formatCondHeader() : fallback);
  useEffect(() => {
    if (!enabled) {
      setTick(fallback);
      return;
    }
    setTick(formatCondHeader());
    const id = setInterval(() => setTick(formatCondHeader()), 1000);
    return () => clearInterval(id);
  }, [enabled, fallback]);
  return tick;
}

function formatCondHeader(): string {
  const d = new Date();
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'P' : 'A';
  const h12 = h % 12 || 12;
  return `▸ TRAIL CONDITIONS · ${h12}:${m}${ampm}`;
}

export function FitnessTrailheadWidget({ config }: { config?: FitnessTrailheadConfig }) {
  const liveOn = config?.liveClock === true;
  const condHeader = useLiveCondHeader(liveOn, pick(config, 'cond.h'));

  return (
    <HsStage
      stageClassName="fh-stage"
      stageStyle={{ background: '#e9dfc6', color: '#1a2e22', fontFamily: "'Outfit', sans-serif" }}
    >
      <style>{CSS}</style>

      {/* National-park-style sign */}
      <div className="fh-sign">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {pick(config, 'gymLogoUrl') && (
          <img src={pick(config, 'gymLogoUrl')} alt="Gym logo" className="fh-gym-logo" />
        )}
        <div className="fh-sign-arrow" data-field="sign.arrow">{pick(config, 'sign.arrow')}</div>
        <div className="fh-sign-title">
          <span data-field="sign.t1">{pick(config, 'sign.t1')}</span>
          <em data-field="sign.t2">{pick(config, 'sign.t2')}</em>
        </div>
        <div className="fh-sign-stamp">
          <div data-field="sign.s1">{pick(config, 'sign.s1')}</div>
          <div className="fh-sign-alt" data-field="sign.s2">{pick(config, 'sign.s2')}</div>
          <div data-field="sign.s3">{pick(config, 'sign.s3')}</div>
        </div>
      </div>

      {/* Three columns */}
      <div className="fh-below">

        {/* Today's runs */}
        <div className="fh-runs">
          <div className="fh-runs-h">
            <h2 className="fh-runs-h2">
              <span data-field="runs.t1">{pick(config, 'runs.t1')}</span>
              <em data-field="runs.t2">{pick(config, 'runs.t2')}</em>
            </h2>
            <div className="fh-runs-sub" data-field="runs.sub">{pick(config, 'runs.sub')}</div>
          </div>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div className="fh-runs-row" key={i}>
              <div className="fh-tm" data-field={`runs.t${i}t`}>{pick(config, `runs.t${i}t` as keyof typeof DEFAULTS)}</div>
              <div className="fh-nm">
                <span data-field={`runs.t${i}n`}>{pick(config, `runs.t${i}n` as keyof typeof DEFAULTS)}</span>
                <small data-field={`runs.t${i}d`}>{pick(config, `runs.t${i}d` as keyof typeof DEFAULTS)}</small>
              </div>
              <div className="fh-pace">
                <span data-field={`runs.t${i}p`}>{pick(config, `runs.t${i}p` as keyof typeof DEFAULTS)}</span>
                <small data-field={`runs.t${i}pl`}>{pick(config, `runs.t${i}pl` as keyof typeof DEFAULTS)}</small>
              </div>
            </div>
          ))}
        </div>

        {/* Conditions */}
        <div className="fh-cond">
          <div className="fh-cond-h" data-field="cond.h">{liveOn ? condHeader : pick(config, 'cond.h')}</div>
          <div className="fh-cond-row">
            <div className="fh-cond-l" data-field="cond.l1">{pick(config, 'cond.l1')}</div>
            <div className="fh-cond-v" data-field="cond.v1">{pick(config, 'cond.v1')}</div>
          </div>
          <div className="fh-cond-row">
            <div className="fh-cond-l" data-field="cond.l2">{pick(config, 'cond.l2')}</div>
            <div className="fh-cond-v" data-field="cond.v2">{pick(config, 'cond.v2')}</div>
          </div>
          <div className="fh-cond-row">
            <div className="fh-cond-l" data-field="cond.l3">{pick(config, 'cond.l3')}</div>
            <div className="fh-cond-v" data-field="cond.v3">{pick(config, 'cond.v3')}</div>
          </div>
          <div className="fh-cond-row">
            <div className="fh-cond-l" data-field="cond.l4">{pick(config, 'cond.l4')}</div>
            <div className="fh-cond-v fh-amber" data-field="cond.v4">{pick(config, 'cond.v4')}</div>
          </div>
          <div className="fh-cond-row">
            <div className="fh-cond-l" data-field="cond.l5">{pick(config, 'cond.l5')}</div>
            <div className="fh-cond-v fh-amber" data-field="cond.v5">{pick(config, 'cond.v5')}</div>
          </div>
          <div className="fh-cond-row">
            <div className="fh-cond-l" data-field="cond.l6">{pick(config, 'cond.l6')}</div>
            <div className="fh-cond-v" data-field="cond.v6">{pick(config, 'cond.v6')}</div>
          </div>
          <div className="fh-cond-note" data-field="cond.note">{pick(config, 'cond.note')}</div>
        </div>

        {/* Leaderboard */}
        <div className="fh-lb">
          <div className="fh-lb-lab" data-field="lb.lab">{pick(config, 'lb.lab')}</div>
          <h3 className="fh-lb-h3">
            <span data-field="lb.t1">{pick(config, 'lb.t1')}</span>
            <em data-field="lb.t2">{pick(config, 'lb.t2')}</em>
          </h3>
          <table className="fh-lb-table">
            <tbody>
              {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                <tr key={i}>
                  <td className="fh-lb-r" data-field={`lb.r${i}`}>{pick(config, `lb.r${i}` as keyof typeof DEFAULTS)}</td>
                  <td className="fh-lb-n" data-field={`lb.n${i}`}>{pick(config, `lb.n${i}` as keyof typeof DEFAULTS)}</td>
                  <td className="fh-lb-m" data-field={`lb.m${i}`}>{pick(config, `lb.m${i}` as keyof typeof DEFAULTS)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>

      {/* Bottom mileage strip */}
      <div className="fh-strip">
        <div className="fh-strip-b">
          <b data-field="strip.b1">{pick(config, 'strip.b1')}</b>
          <span data-field="strip.l1">{pick(config, 'strip.l1')}</span>
        </div>
        <div className="fh-strip-div" />
        <div className="fh-strip-b">
          <b data-field="strip.b2">{pick(config, 'strip.b2')}</b>
          <span data-field="strip.l2">{pick(config, 'strip.l2')}</span>
        </div>
        <div className="fh-strip-div" />
        <div className="fh-strip-b">
          <b data-field="strip.b3">{pick(config, 'strip.b3')}</b>
          <span data-field="strip.l3">{pick(config, 'strip.l3')}</span>
        </div>
        <div className="fh-strip-msg" data-field="strip.msg">
          {pick(config, 'strip.msg').split('\n').map((line, idx, arr) => (
            <span key={idx}>
              {line}
              {idx < arr.length - 1 ? <br /> : null}
            </span>
          ))}
        </div>
      </div>
    </HsStage>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=JetBrains+Mono:wght@500;700&family=Outfit:wght@400;700;900&family=Bebas+Neue&display=swap');

.fh-stage {
  background:
    radial-gradient(900px 700px at 80% 80%, rgba(45,90,58,.12), transparent 60%),
    #e9dfc6;
}
/* topo contour lines */
.fh-stage::before {
  content: '';
  position: absolute;
  top: 0; right: 0; bottom: 0; left: 0;
  pointer-events: none;
  opacity: .22;
  background-image:
    radial-gradient(ellipse 1100px 600px at 70% 60%, transparent 38%, #2d5a3a 38.6%, transparent 39.2%),
    radial-gradient(ellipse 1100px 600px at 70% 60%, transparent 30%, #2d5a3a 30.6%, transparent 31.2%),
    radial-gradient(ellipse 1100px 600px at 70% 60%, transparent 22%, #2d5a3a 22.6%, transparent 23.2%),
    radial-gradient(ellipse 1300px 700px at 20% 25%, transparent 36%, #2d5a3a 36.6%, transparent 37.2%),
    radial-gradient(ellipse 1300px 700px at 20% 25%, transparent 28%, #2d5a3a 28.6%, transparent 29.2%),
    radial-gradient(ellipse 1300px 700px at 20% 25%, transparent 20%, #2d5a3a 20.6%, transparent 21.2%);
}

/* National-park-style sign */
.fh-sign {
  position: absolute; top: 80px; left: 80px; right: 80px; height: 480px;
  background: #2d5a3a; color: #e9dfc6;
  padding: 36px 60px;
  display: flex; align-items: center; gap: 60px;
  box-shadow: 0 30px 80px rgba(0,0,0,.4), inset 0 0 0 8px #e9dfc6, inset 0 0 0 16px #2d5a3a;
}
.fh-gym-logo { height: 120px; width: auto; object-fit: contain; object-position: left center; flex-shrink: 0; }
.fh-sign-arrow {
  font-family: 'Archivo Black'; font-size: 200px; color: #dba93f; line-height: 1; flex: none;
}
.fh-sign-title {
  font-family: 'Archivo Black'; font-size: 300px; line-height: .85; letter-spacing: -.04em; flex: 1;
}
.fh-sign-title em { font-style: normal; color: #dba93f; }
.fh-sign-stamp {
  flex: none; text-align: right;
  font-family: 'JetBrains Mono'; font-size: 36px; letter-spacing: .18em; line-height: 1.5;
}
.fh-sign-alt {
  font-family: 'Archivo Black'; font-size: 90px; color: #dba93f; line-height: .85; letter-spacing: 0;
}

/* Three columns under sign */
.fh-below {
  position: absolute; top: 620px; left: 80px; right: 80px; bottom: 160px;
  display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 36px;
}

/* Today's runs */
.fh-runs {
  background: #e9dfc6; border: 6px solid #1a2e22; padding: 36px 44px;
}
.fh-runs-h {
  border-bottom: 5px double #1a2e22; padding-bottom: 14px; margin-bottom: 20px;
}
.fh-runs-h2 {
  font-family: 'Archivo Black'; font-size: 90px; line-height: .85; margin: 0;
}
.fh-runs-h2 em { font-style: normal; color: #c75d3a; }
.fh-runs-sub {
  font-family: 'JetBrains Mono'; font-size: 24px; letter-spacing: .22em; color: #6a7060; margin-top: 6px;
}
.fh-runs-row {
  display: grid; grid-template-columns: 110px 1fr 200px; gap: 24px;
  padding: 18px 0; align-items: center; border-bottom: 2px dotted #1a2e22;
}
.fh-runs-row:last-child { border-bottom: 0; }
.fh-tm {
  font-family: 'Archivo Black'; font-size: 46px; color: #c75d3a; line-height: .85;
}
.fh-nm {
  font-family: 'Bebas Neue'; font-size: 48px; letter-spacing: .04em; line-height: 1;
}
.fh-nm small {
  display: block; font-family: 'Outfit'; font-weight: 400; font-size: 26px;
  color: #6a7060; margin-top: 4px; letter-spacing: .06em; line-height: 1.2;
}
.fh-pace {
  font-family: 'JetBrains Mono'; font-weight: 700; font-size: 30px;
  color: #2d5a3a; text-align: right; letter-spacing: .06em;
}
.fh-pace small {
  display: block; font-family: 'Outfit'; font-weight: 400; font-size: 20px; color: #6a7060; margin-top: 4px;
}

/* Conditions */
.fh-cond {
  background: #1a2e22; color: #e9dfc6;
  padding: 36px 44px;
  display: flex; flex-direction: column; gap: 20px;
}
.fh-cond-h {
  font-family: 'JetBrains Mono'; font-size: 30px; letter-spacing: .28em; color: #dba93f;
  border-bottom: 2px solid #dba93f; padding-bottom: 10px;
}
.fh-cond-row {
  display: flex; justify-content: space-between; align-items: flex-end;
}
.fh-cond-l {
  font-family: 'Bebas Neue'; font-size: 42px; letter-spacing: .06em; color: #cdbf9c;
}
.fh-cond-v {
  font-family: 'Archivo Black'; font-size: 80px; line-height: .85;
}
.fh-cond-v.fh-amber { color: #dba93f; }
.fh-cond-note {
  font-family: 'Outfit'; font-style: italic; font-weight: 400; font-size: 30px; line-height: 1.3;
  color: #cdbf9c; border-top: 1px dashed rgba(255,255,255,.3); padding-top: 18px; margin-top: auto;
}

/* Leaderboard */
.fh-lb {
  background: #c75d3a; color: #e9dfc6; padding: 36px 44px;
}
.fh-lb-lab {
  font-family: 'JetBrains Mono'; font-size: 30px; letter-spacing: .28em; color: #dba93f;
}
.fh-lb-h3 {
  font-family: 'Archivo Black'; font-size: 80px; line-height: .85; margin: 14px 0 18px;
}
.fh-lb-h3 em { font-style: normal; color: #dba93f; }
.fh-lb-table { width: 100%; border-collapse: collapse; }
.fh-lb-table td {
  padding: 12px 8px; border-bottom: 1px solid rgba(255,255,255,.25);
  font-family: 'Outfit'; font-size: 32px;
}
.fh-lb-r {
  font-family: 'Archivo Black'; font-size: 46px; color: #dba93f;
  width: 80px; text-align: center; line-height: 1;
}
.fh-lb-n { font-weight: 800; }
.fh-lb-m {
  font-family: 'JetBrains Mono'; font-weight: 700; text-align: right; letter-spacing: .06em;
}

/* Bottom mileage strip */
.fh-strip {
  position: absolute; left: 0; right: 0; bottom: 0; height: 140px;
  background: #2d5a3a; color: #e9dfc6;
  display: flex; align-items: center; padding: 0 80px; gap: 48px;
}
.fh-strip-b {
  display: flex; align-items: baseline; gap: 16px;
}
.fh-strip-b b {
  font-family: 'Archivo Black'; font-size: 80px; color: #dba93f; line-height: 1;
}
.fh-strip-b span {
  font-family: 'Bebas Neue'; font-size: 36px; letter-spacing: .18em; color: #cdbf9c;
}
.fh-strip-div {
  width: 2px; align-self: stretch; background: #cdbf9c; opacity: .3;
}
.fh-strip-msg {
  margin-left: auto;
  font-family: 'JetBrains Mono'; font-size: 26px; letter-spacing: .18em; color: #dba93f;
  text-align: right; line-height: 1.4;
}
`;
