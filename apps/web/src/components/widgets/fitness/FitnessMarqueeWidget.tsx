"use client";

/**
 * FitnessMarqueeWidget — 4K lobby marquee, 3840x2160 (Marquee theme).
 *
 * APPROVED 2026-05-03 — matches scratch/design/fitness/03-marquee.html
 * Ported via HsStage transform:scale pattern. Every pixel size is
 * FIXED (matches the HTML mockup); DO NOT regress to vw/%.
 *
 * Visual DNA — Vegas marquee + theater bill:
 *   - Deep magenta-violet base #0a0612 with hot/amber radial glows
 *   - Bulb-bordered marquee panel up top (animated dot pattern via
 *     radial-gradient background-image, blink keyframe + offset delay)
 *   - Hero title in Archivo Black with hot-red drop-shadow offset
 *   - Bebas Neue subtitle and class titles for theater-bill feel
 *   - Star-prefixed billing strip (DOORS · CLASSES · 24/7)
 *   - 8-row "Today's Classes" theater roster, "NOW" row highlighted
 *     in amber wash with hot-red emphasis
 *   - Right column: live clock, cyan weather temp, hot-red promo
 *   - Bottom black ticker with amber chrome
 *
 * Editable hotspots — every text element has a `data-field` attribute
 * that PropertiesPanel matches via THEMED_WIDGET_FIELDS or the auto-form
 * generator. Field keys use dot notation:
 *   marquee.pres, marquee.t1, marquee.t2, marquee.sub,
 *     marquee.b1, marquee.b2, marquee.b3
 *   roster.t, roster.d, roster.0.t/c/r ... roster.7.t/c/r
 *   clock.label, clock.time, clock.date
 *   weather.temp, weather.cond, weather.hilo
 *   promo.label, promo.h, promo.sub, promo.cta
 *   ticker.tag, ticker.message
 */

import { useEffect, useState } from 'react';
import { HsStage } from '../hs/HsStage';

export interface FitnessMarqueeConfig {
  // Marquee header
  'marquee.pres'?: string;
  'marquee.t1'?: string;
  'marquee.t2'?: string;
  'marquee.sub'?: string;
  'marquee.b1'?: string;
  'marquee.b2'?: string;
  'marquee.b3'?: string;
  // Roster header
  'roster.t'?: string;
  'roster.d'?: string;
  // Roster rows (0..7) — each has time / class / room
  'roster.0.t'?: string; 'roster.0.c'?: string; 'roster.0.r'?: string;
  'roster.1.t'?: string; 'roster.1.c'?: string; 'roster.1.r'?: string;
  'roster.2.t'?: string; 'roster.2.c'?: string; 'roster.2.r'?: string;
  'roster.3.t'?: string; 'roster.3.c'?: string; 'roster.3.r'?: string;
  'roster.4.t'?: string; 'roster.4.c'?: string; 'roster.4.r'?: string;
  'roster.5.t'?: string; 'roster.5.c'?: string; 'roster.5.r'?: string;
  'roster.6.t'?: string; 'roster.6.c'?: string; 'roster.6.r'?: string;
  'roster.7.t'?: string; 'roster.7.c'?: string; 'roster.7.r'?: string;
  // Clock
  'clock.label'?: string;
  'clock.time'?: string;
  'clock.date'?: string;
  /** When true the clock auto-updates from the device clock every second. */
  liveClock?: boolean;
  // Weather
  'weather.temp'?: string;
  'weather.cond'?: string;
  'weather.hilo'?: string;
  // Promo
  'promo.label'?: string;
  'promo.h'?: string;
  'promo.sub'?: string;
  'promo.cta'?: string;
  // Ticker
  'ticker.tag'?: string;
  'ticker.message'?: string;
}

/* eslint-disable @typescript-eslint/quotes */
export const DEFAULTS: Record<string, string> = {
  'marquee.pres':       "★  TONIGHT'S BILL  ★",
  'marquee.t1':         'Welcome ',
  'marquee.t2':         'in.',
  'marquee.sub':        'FOUR CLASSES · ONE TIMER · NO EXCUSES',
  'marquee.b1':         'DOORS 5 AM',
  'marquee.b2':         'CLASSES UNTIL 8 PM',
  'marquee.b3':         '24/7 AFTER HOURS',
  'roster.t':           "Today's Classes",
  'roster.d':           '★ Tue · Apr 23 ★',
  'roster.0.t':         '6:00 AM',
  'roster.0.c':         'Sunrise Spin',
  'roster.0.r':         'Jamie · Studio A',
  'roster.1.t':         '7:30 AM',
  'roster.1.c':         'Power Yoga',
  'roster.1.r':         'Priya · Studio B',
  'roster.2.t':         '9:00 AM',
  'roster.2.c':         'Bootcamp · NOW',
  'roster.2.r':         'Marcus · Floor',
  'roster.3.t':         '12:00 PM',
  'roster.3.c':         'Lunch HIIT',
  'roster.3.r':         'Tasha · Studio A',
  'roster.4.t':         '5:30 PM',
  'roster.4.c':         'Heavy Hour',
  'roster.4.r':         'Dre · Platform',
  'roster.5.t':         '6:00 PM',
  'roster.5.c':         'Cycle 45',
  'roster.5.r':         'Jamie · Studio A',
  'roster.6.t':         '7:00 PM',
  'roster.6.c':         'Restore Yoga',
  'roster.6.r':         'Priya · Studio B',
  'roster.7.t':         '8:00 PM',
  'roster.7.c':         'Late Lift Open',
  'roster.7.r':         'Coach Dre on call',
  'clock.label':        '★ NOW SHOWING',
  'clock.time':         '7:42',
  'clock.date':         'TUE · APR 23',
  'weather.temp':       '72°',
  'weather.cond':       'Clear · light wind',
  'weather.hilo':       'HI 78 · LO 61 · HUM 42%',
  'promo.label':        '★ FEATURED · LIMITED',
  'promo.h':            'Bring a friend free.',
  'promo.sub':          'Guest passes good all month — ask the desk for yours.',
  'promo.cta':          '→ FRONT DESK',
  'ticker.tag':         '★ MARQUEE',
  'ticker.message':     '★ NEW MEMBER? FIRST PT SESSION FREE ★ POOL OPENS 5 AM ★ HEAVY HOUR · PLATFORM C · 5:30 PM ★ KIDS ZONE OPEN UNTIL 8 PM ★',
};
/* eslint-enable @typescript-eslint/quotes */

function pick(cfg: FitnessMarqueeConfig | undefined, key: keyof typeof DEFAULTS): string {
  return ((cfg as any)?.[key] as string | undefined) ?? DEFAULTS[key];
}

function useLiveClock(enabled: boolean): { time: string; date: string } | null {
  const [tick, setTick] = useState(() => (enabled ? formatLiveClock() : null));
  useEffect(() => {
    if (!enabled) return;
    setTick(formatLiveClock());
    const id = setInterval(() => setTick(formatLiveClock()), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return tick;
}

function formatLiveClock(): { time: string; date: string } {
  const d = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(/\s?(AM|PM)$/i, '');
  const dow = d.toLocaleDateString([], { weekday: 'short' }).toUpperCase();
  const mon = d.toLocaleDateString([], { month: 'short' }).toUpperCase();
  const dom = d.getDate();
  return { time, date: `${dow} · ${mon} ${dom}` };
}

interface RosterRowProps {
  idx: number;
  config?: FitnessMarqueeConfig;
  highlight?: boolean;
}

function RosterRow({ idx, config, highlight }: RosterRowProps) {
  const tKey = `roster.${idx}.t` as keyof typeof DEFAULTS;
  const cKey = `roster.${idx}.c` as keyof typeof DEFAULTS;
  const rKey = `roster.${idx}.r` as keyof typeof DEFAULTS;
  return (
    <li className={highlight ? 'fm-row fm-now' : 'fm-row'}>
      <span className="fm-row-t" data-field={tKey}>{pick(config, tKey)}</span>
      <span className="fm-row-c">
        {highlight
          ? <em data-field={cKey}>{pick(config, cKey)}</em>
          : <span data-field={cKey}>{pick(config, cKey)}</span>}
      </span>
      <span className="fm-row-r" data-field={rKey}>{pick(config, rKey)}</span>
    </li>
  );
}

export function FitnessMarqueeWidget({ config }: { config?: FitnessMarqueeConfig }) {
  const liveClock = useLiveClock(config?.liveClock !== false);
  const time = liveClock?.time ?? pick(config, 'clock.time');
  const date = liveClock?.date ?? pick(config, 'clock.date');

  return (
    <HsStage
      stageClassName="fm-marquee-stage"
      stageStyle={{ background: '#0a0612', color: '#fff8e7', fontFamily: "'Outfit', system-ui, sans-serif" }}
    >
      <style>{CSS}</style>

      {/* Bulb-bordered marquee */}
      <div className="fm-marquee">
        <div className="fm-pres" data-field="marquee.pres">{pick(config, 'marquee.pres')}</div>
        <h1 className="fm-h1">
          <span data-field="marquee.t1">{pick(config, 'marquee.t1')}</span>
          <em data-field="marquee.t2">{pick(config, 'marquee.t2')}</em>
        </h1>
        <div className="fm-sub" data-field="marquee.sub">{pick(config, 'marquee.sub')}</div>
        <div className="fm-billing">
          <span data-field="marquee.b1">{pick(config, 'marquee.b1')}</span>
          <span data-field="marquee.b2">{pick(config, 'marquee.b2')}</span>
          <span data-field="marquee.b3">{pick(config, 'marquee.b3')}</span>
        </div>
      </div>

      {/* Below — roster + side panels */}
      <div className="fm-below">

        <div className="fm-roster">
          <div className="fm-roster-hd">
            <div className="fm-roster-t" data-field="roster.t">{pick(config, 'roster.t')}</div>
            <div className="fm-roster-d" data-field="roster.d">{pick(config, 'roster.d')}</div>
          </div>
          <ul className="fm-roster-list">
            <RosterRow idx={0} config={config} />
            <RosterRow idx={1} config={config} />
            <RosterRow idx={2} config={config} highlight />
            <RosterRow idx={3} config={config} />
            <RosterRow idx={4} config={config} />
            <RosterRow idx={5} config={config} />
            <RosterRow idx={6} config={config} />
            <RosterRow idx={7} config={config} />
          </ul>
        </div>

        <div className="fm-side">
          <div className="fm-panel fm-clock">
            <div className="fm-label" data-field="clock.label">{pick(config, 'clock.label')}</div>
            <div className="fm-clock-time" data-field="clock.time">{time}</div>
            <div className="fm-clock-date" data-field="clock.date">{date}</div>
          </div>

          <div className="fm-panel fm-weather">
            <div className="fm-weather-temp" data-field="weather.temp">{pick(config, 'weather.temp')}</div>
            <div className="fm-weather-meta">
              <div className="fm-weather-cond" data-field="weather.cond">{pick(config, 'weather.cond')}</div>
              <div className="fm-weather-hilo" data-field="weather.hilo">{pick(config, 'weather.hilo')}</div>
            </div>
          </div>

          <div className="fm-panel fm-promo">
            <div className="fm-label" data-field="promo.label">{pick(config, 'promo.label')}</div>
            <h3 className="fm-promo-h" data-field="promo.h">{pick(config, 'promo.h')}</h3>
            <div className="fm-promo-sub" data-field="promo.sub">{pick(config, 'promo.sub')}</div>
            <div className="fm-promo-cta" data-field="promo.cta">{pick(config, 'promo.cta')}</div>
          </div>
        </div>

      </div>

      {/* Bottom ticker */}
      <div className="fm-ticker">
        <div className="fm-ticker-tag" data-field="ticker.tag">{pick(config, 'ticker.tag')}</div>
        <div className="fm-ticker-msg" data-field="ticker.message">{pick(config, 'ticker.message')}</div>
      </div>
    </HsStage>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=JetBrains+Mono:wght@500;700&family=Outfit:wght@400;700;900&family=Bebas+Neue&display=swap');

.fm-marquee-stage {
  background:
    radial-gradient(1200px 800px at 20% 10%, rgba(255,170,43,.15), transparent 60%),
    radial-gradient(1100px 700px at 90% 90%, rgba(255,42,77,.12), transparent 60%),
    linear-gradient(180deg, #0a0612 0%, #160a20 50%, #0a0612 100%);
}

.fm-marquee {
  position: absolute; top: 60px; left: 60px; right: 60px; height: 920px;
  background: linear-gradient(180deg, #2a1530 0%, #150818 100%);
  border: 6px solid #ffd86b; border-radius: 24px;
  box-shadow: inset 0 0 80px rgba(255,170,43,.2), 0 30px 80px rgba(0,0,0,.6);
  padding: 80px 100px;
  display: flex; flex-direction: column; justify-content: center; align-items: center;
  text-align: center; overflow: hidden;
}
.fm-marquee::before,
.fm-marquee::after {
  content: ''; position: absolute; left: 30px; right: 30px; height: 30px;
  background-image: radial-gradient(circle, #ffd86b 0, #ffd86b 6px, transparent 7px);
  background-size: 60px 30px; background-repeat: repeat-x;
  filter: drop-shadow(0 0 12px #ffaa2b);
  animation: fm-bulb 1.4s infinite;
}
.fm-marquee::before { top: 30px; }
.fm-marquee::after { bottom: 30px; animation-delay: .7s; }
@keyframes fm-bulb { 50% { opacity: .5; } }

.fm-pres {
  font-family: 'JetBrains Mono'; font-size: 46px; letter-spacing: .4em;
  color: #ffd86b; margin-bottom: 30px;
}
.fm-h1 {
  margin: 0; font-family: 'Archivo Black'; font-size: 340px; line-height: .85;
  letter-spacing: -.04em; color: #fff8e7;
  text-shadow: 0 0 40px rgba(255,170,43,.45), 6px 6px 0 #ff2a4d;
}
.fm-h1 em { font-style: normal; color: #ffd86b; }
.fm-sub {
  font-family: 'Bebas Neue'; font-size: 84px; line-height: 1;
  letter-spacing: .06em; color: #fff8e7; margin-top: 30px;
}
.fm-billing {
  display: flex; gap: 60px; margin-top: 40px;
  font-family: 'JetBrains Mono'; font-size: 36px; letter-spacing: .18em;
  color: #ffaa2b;
}
.fm-billing span::before { content: '★ '; }

.fm-below {
  position: absolute; top: 1010px; left: 60px; right: 60px; bottom: 160px;
  display: grid; grid-template-columns: 2400px 1fr; gap: 48px;
}

.fm-roster {
  background: rgba(255,248,231,.04);
  border: 3px solid rgba(255,248,231,.1);
  padding: 60px 70px; position: relative;
}
.fm-roster-hd {
  display: flex; justify-content: space-between; align-items: flex-end;
  border-bottom: 4px solid #ffd86b; padding-bottom: 24px; margin-bottom: 30px;
}
.fm-roster-t {
  font-family: 'Bebas Neue'; font-size: 140px; line-height: .9;
  letter-spacing: .04em; color: #ffd86b;
}
.fm-roster-d {
  font-family: 'JetBrains Mono'; font-size: 42px; letter-spacing: .18em;
  color: #fff8e7; padding-bottom: 12px;
}
.fm-roster-list {
  list-style: none; margin: 0; padding: 0;
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px 56px;
}
.fm-row {
  display: grid; grid-template-columns: 240px 1fr 280px;
  align-items: baseline; padding: 18px 0;
  border-bottom: 1px dashed rgba(255,248,231,.15);
  gap: 24px;
}
.fm-row.fm-now {
  background: linear-gradient(90deg, rgba(255,170,43,.2), transparent);
  padding: 18px 16px; border-bottom-color: #ffd86b;
}
.fm-row-t {
  font-family: 'JetBrains Mono'; font-weight: 700; font-size: 42px;
  color: #ffd86b; letter-spacing: .04em;
}
.fm-row-c {
  font-family: 'Bebas Neue'; font-size: 62px;
  letter-spacing: .04em; color: #fff8e7;
}
.fm-row.fm-now .fm-row-c em { font-style: normal; color: #ff2a4d; }
.fm-row-r {
  font-family: 'Outfit'; font-weight: 400; font-size: 36px;
  color: rgba(255,248,231,.6); text-align: right;
}
.fm-row.fm-now .fm-row-r { color: #ffd86b; }

.fm-side { display: flex; flex-direction: column; gap: 36px; }
.fm-panel {
  background: #1a0f1f; border: 3px solid rgba(255,248,231,.1);
  padding: 46px; position: relative;
}
.fm-label {
  font-family: 'JetBrains Mono'; font-size: 28px; letter-spacing: .28em;
  color: #ffd86b; margin-bottom: 18px;
}

.fm-clock-time {
  font-family: 'Archivo Black'; font-size: 200px; line-height: .85;
  letter-spacing: -.03em; color: #fff8e7;
}
.fm-clock-date {
  font-family: 'JetBrains Mono'; font-size: 34px; letter-spacing: .2em;
  color: rgba(255,248,231,.6); margin-top: 14px;
}

.fm-weather { display: flex; align-items: center; gap: 30px; }
.fm-weather-temp {
  font-family: 'Archivo Black'; font-size: 170px; line-height: .85;
  color: #00d4ff;
}
.fm-weather-cond {
  font-family: 'Bebas Neue'; font-size: 56px; line-height: 1;
}
.fm-weather-hilo {
  font-family: 'JetBrains Mono'; font-size: 30px;
  color: rgba(255,248,231,.6); margin-top: 8px; letter-spacing: .16em;
}

.fm-promo {
  background: linear-gradient(135deg, #ff2a4d 0%, #c1281a 100%);
  border-color: #000; color: #fff;
}
.fm-promo .fm-label { color: #fff; }
.fm-promo-h {
  margin: 0; font-family: 'Archivo Black'; font-size: 90px;
  line-height: .92; letter-spacing: -.02em;
}
.fm-promo-sub { font-size: 36px; margin-top: 14px; }
.fm-promo-cta {
  display: inline-block; margin-top: 20px;
  font-family: 'Archivo Black'; font-size: 36px;
  background: #fff; color: #000; padding: 14px 28px;
}

.fm-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 108px;
  background: #000; border-top: 4px solid #ffd86b; color: #ffd86b;
  display: flex; align-items: center; gap: 48px; overflow: hidden;
  font-family: 'Archivo Black'; font-size: 60px;
}
.fm-ticker-tag {
  background: #ffd86b; color: #000;
  padding: 14px 30px; margin-left: 24px;
  font-size: 40px; letter-spacing: .18em; flex: none;
}
.fm-ticker-msg {
  white-space: nowrap;
  animation: fm-ticker-scroll 60s linear infinite;
}
@keyframes fm-ticker-scroll {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
`;
