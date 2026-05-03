"use client";

/**
 * FitnessStadiumWidget — 4K cardio-floor scene, 3840×2160 (Stadium theme).
 *
 * APPROVED 2026-05-03 — matches scratch/design/fitness/01-stadium.html
 * Ported via HsStage transform:scale pattern. Every pixel size is
 * FIXED (matches the HTML mockup); DO NOT regress to vw/%.
 *
 * Visual DNA — broadcast-Jumbotron stadium energy:
 *   - Charcoal #07070c base + faint scanline texture
 *   - Neon yellow #d7ff1e + hot red #ff2a4d + cyan #00d4ff accents
 *   - Archivo Black display + Outfit body + JetBrains Mono labels
 *   - Top scorebug ribbon (LIVE chip + channel + clock)
 *   - Massive 2300×1280 TV pane on left (CRT scanline overlay)
 *   - Right rail: now-playing music card + featured promo card
 *   - 4-column stat strip (checkins / PRs / classes / temp)
 *   - Bottom neon-yellow ticker on black with monospace tag
 *
 * Editable hotspots — every text element has a `data-field` attribute
 * that PropertiesPanel matches via THEMED_WIDGET_FIELDS or the MS_*
 * auto-form generator. Field keys use dot notation:
 *   scorebug.live, scorebug.channel, scorebug.network
 *   clock.time, clock.date
 *   tv.mark, tv.show, tv.tag, tv.t1, tv.t2, tv.t3
 *   nowplaying.label, nowplaying.title, nowplaying.artist,
 *     nowplaying.elapsed, nowplaying.total
 *   promo.badge, promo.label, promo.t1, promo.t2, promo.t3,
 *     promo.sub, promo.cta
 *   stats.0.k, stats.0.v, stats.0.cap (× 4 stat columns)
 *   ticker.tag, ticker.message
 */

import { useEffect, useState } from 'react';
import { HsStage } from '../hs/HsStage';

export interface FitnessStadiumConfig {
  // Scorebug
  'scorebug.live'?: string;
  'scorebug.channel'?: string;
  'scorebug.network'?: string;
  // Clock
  'clock.time'?: string;
  'clock.date'?: string;
  /** When true the clock auto-updates from the device clock every second. */
  liveClock?: boolean;
  // TV pane
  'tv.mark'?: string;
  'tv.show'?: string;
  'tv.tag'?: string;
  'tv.t1'?: string;
  'tv.t2'?: string;
  'tv.t3'?: string;
  // Now playing
  'nowplaying.label'?: string;
  'nowplaying.title'?: string;
  'nowplaying.artist'?: string;
  'nowplaying.elapsed'?: string;
  'nowplaying.total'?: string;
  // Promo
  'promo.badge'?: string;
  'promo.label'?: string;
  'promo.t1'?: string;
  'promo.t2'?: string;
  'promo.t3'?: string;
  'promo.sub'?: string;
  'promo.cta'?: string;
  // Stats — 4 columns
  'stats.0.k'?: string;
  'stats.0.v'?: string;
  'stats.0.cap'?: string;
  'stats.1.k'?: string;
  'stats.1.v'?: string;
  'stats.1.cap'?: string;
  'stats.2.k'?: string;
  'stats.2.v'?: string;
  'stats.2.cap'?: string;
  'stats.3.k'?: string;
  'stats.3.v'?: string;
  'stats.3.cap'?: string;
  // Ticker
  'ticker.tag'?: string;
  'ticker.message'?: string;
}

/* eslint-disable @typescript-eslint/quotes */
export const DEFAULTS: Record<string, string> = {
  'scorebug.live':       'LIVE',
  'scorebug.channel':    '12',
  'scorebug.network':    'ESPN',
  'clock.time':          '7:42',
  'clock.date':          'TUE · APR 23 · 72°F',
  'tv.mark':             'ESPN',
  'tv.show':             'SPORTSCENTER · LIVE',
  'tv.tag':              '▸ NOW PLAYING ON CARDIO',
  'tv.t1':               'Top ',
  'tv.t2':               '10',
  'tv.t3':               ' plays of the week.',
  'nowplaying.label':    '▸ NOW BLASTING · CARDIO FLOOR',
  'nowplaying.title':    'Titanium',
  'nowplaying.artist':   'David Guetta ft. Sia',
  'nowplaying.elapsed':  '2:01',
  'nowplaying.total':    '4:05',
  'promo.badge':         'AD',
  'promo.label':         '▸ FEATURED · LIMITED TIME',
  'promo.t1':            'First ',
  'promo.t2':            'PT',
  'promo.t3':            ' session free.',
  'promo.sub':           'Book at the front desk before Friday — new members only.',
  'promo.cta':           '→ Ask the desk',
  'stats.0.k':           'CHECKED IN TODAY',
  'stats.0.v':           '412',
  'stats.0.cap':         '+18% vs Tuesday avg',
  'stats.1.k':           'PRS THIS WEEK',
  'stats.1.v':           '37',
  'stats.1.cap':         'Heavy Hour at 5:30 again',
  'stats.2.k':           'CLASSES TODAY',
  'stats.2.v':           '11',
  'stats.2.cap':         '8 still have spots',
  'stats.3.k':           'FLOOR TEMP',
  'stats.3.v':           '68°',
  'stats.3.cap':         'Set & holding',
  'ticker.tag':          '★ THE GRIND',
  'ticker.message':      "★ THE BAR DOESN'T CARE ABOUT YOUR FEELINGS ★ SHOW UP. THAT'S THE WHOLE SECRET. ★ HEAVY HOUR · 5:30PM · PLATFORM C ★ FREE GUEST PASSES ALL MONTH ★",
};
/* eslint-enable @typescript-eslint/quotes */

function pick(cfg: FitnessStadiumConfig | undefined, key: keyof typeof DEFAULTS): string {
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

function formatLiveClock() {
  const d = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(/\s?(AM|PM)$/i, '');
  const dow = d.toLocaleDateString([], { weekday: 'short' }).toUpperCase();
  const mon = d.toLocaleDateString([], { month: 'short' }).toUpperCase();
  const dom = d.getDate();
  return { time, date: `${dow} · ${mon} ${dom}` };
}

export function FitnessStadiumWidget({ config }: { config?: FitnessStadiumConfig }) {
  const liveClock = useLiveClock(config?.liveClock !== false);
  const time = liveClock?.time ?? pick(config, 'clock.time');
  const date = liveClock ? `${liveClock.date} · ${pick(config, 'clock.date').split('·').slice(2).join('·').trim() || ''}`.replace(/·\s*$/, '').trim() : pick(config, 'clock.date');

  return (
    <HsStage stageClassName="fs-stadium-stage" stageStyle={{ background: '#07070c', color: '#f4f5f7', fontFamily: "'Outfit', system-ui, sans-serif" }}>
      <style>{CSS}</style>

      {/* Scorebug — top ribbon */}
      <div className="fs-scorebug">
        <div className="fs-live"><span data-field="scorebug.live">{pick(config, 'scorebug.live')}</span></div>
        <div className="fs-channel">CH <b data-field="scorebug.channel">{pick(config, 'scorebug.channel')}</b> · <span data-field="scorebug.network">{pick(config, 'scorebug.network')}</span></div>
        <div className="fs-spacer" />
        <div className="fs-clock">
          <div data-field="clock.time">{time}</div>
          <div className="fs-clock-date" data-field="clock.date">{date}</div>
        </div>
      </div>

      {/* Massive TV pane */}
      <div className="fs-tv">
        <div className="fs-crt" />
        <div className="fs-tv-center">
          <div className="fs-tv-mark" data-field="tv.mark">{pick(config, 'tv.mark')}</div>
          <div className="fs-tv-net" data-field="tv.show">{pick(config, 'tv.show')}</div>
        </div>
        <div className="fs-tv-lower">
          <div className="fs-tv-tag" data-field="tv.tag">{pick(config, 'tv.tag')}</div>
          <h2 className="fs-tv-title">
            <span data-field="tv.t1">{pick(config, 'tv.t1')}</span>
            <em data-field="tv.t2">{pick(config, 'tv.t2')}</em>
            <span data-field="tv.t3">{pick(config, 'tv.t3')}</span>
          </h2>
        </div>
      </div>

      {/* Right rail */}
      <div className="fs-right">
        <div className="fs-panel fs-nowplay">
          <div className="fs-label" data-field="nowplaying.label">{pick(config, 'nowplaying.label')}</div>
          <div className="fs-np-row">
            <div className="fs-np-art" />
            <div className="fs-np-meta">
              <div className="fs-np-title" data-field="nowplaying.title">{pick(config, 'nowplaying.title')}</div>
              <div className="fs-np-artist" data-field="nowplaying.artist">{pick(config, 'nowplaying.artist')}</div>
            </div>
          </div>
          <div className="fs-eq">
            <span /><span /><span /><span /><span /><span /><span />
          </div>
          <div className="fs-pgr"><i /></div>
          <div className="fs-times">
            <span data-field="nowplaying.elapsed">{pick(config, 'nowplaying.elapsed')}</span>
            <span data-field="nowplaying.total">{pick(config, 'nowplaying.total')}</span>
          </div>
        </div>

        <div className="fs-panel fs-promo">
          <div className="fs-promo-badge" data-field="promo.badge">{pick(config, 'promo.badge')}</div>
          <div className="fs-label" data-field="promo.label">{pick(config, 'promo.label')}</div>
          <h3 className="fs-promo-h">
            <span data-field="promo.t1">{pick(config, 'promo.t1')}</span>
            <em data-field="promo.t2">{pick(config, 'promo.t2')}</em>
            <span data-field="promo.t3">{pick(config, 'promo.t3')}</span>
          </h3>
          <div className="fs-promo-sub" data-field="promo.sub">{pick(config, 'promo.sub')}</div>
          <div className="fs-promo-cta" data-field="promo.cta">{pick(config, 'promo.cta')}</div>
        </div>
      </div>

      {/* Stat strip */}
      <div className="fs-stats">
        <div className="fs-stat fs-acc1">
          <div className="fs-stat-k" data-field="stats.0.k">{pick(config, 'stats.0.k')}</div>
          <div className="fs-stat-v" data-field="stats.0.v">{pick(config, 'stats.0.v')}</div>
          <div className="fs-stat-cap" data-field="stats.0.cap">{pick(config, 'stats.0.cap')}</div>
        </div>
        <div className="fs-stat fs-acc2">
          <div className="fs-stat-k" data-field="stats.1.k">{pick(config, 'stats.1.k')}</div>
          <div className="fs-stat-v" data-field="stats.1.v">{pick(config, 'stats.1.v')}</div>
          <div className="fs-stat-cap" data-field="stats.1.cap">{pick(config, 'stats.1.cap')}</div>
        </div>
        <div className="fs-stat fs-acc3">
          <div className="fs-stat-k" data-field="stats.2.k">{pick(config, 'stats.2.k')}</div>
          <div className="fs-stat-v" data-field="stats.2.v">{pick(config, 'stats.2.v')}</div>
          <div className="fs-stat-cap" data-field="stats.2.cap">{pick(config, 'stats.2.cap')}</div>
        </div>
        <div className="fs-stat">
          <div className="fs-stat-k" data-field="stats.3.k">{pick(config, 'stats.3.k')}</div>
          <div className="fs-stat-v" data-field="stats.3.v">{pick(config, 'stats.3.v')}</div>
          <div className="fs-stat-cap" data-field="stats.3.cap">{pick(config, 'stats.3.cap')}</div>
        </div>
      </div>

      {/* Bottom ticker */}
      <div className="fs-ticker">
        <div className="fs-ticker-tag" data-field="ticker.tag">{pick(config, 'ticker.tag')}</div>
        <div className="fs-ticker-msg" data-field="ticker.message">{pick(config, 'ticker.message')}</div>
      </div>
    </HsStage>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=JetBrains+Mono:wght@500;700&family=Outfit:wght@400;700;900&display=swap');

.fs-stadium-stage {
  background:
    radial-gradient(1400px 800px at 12% 12%, rgba(215,255,30,.07), transparent 60%),
    radial-gradient(1100px 700px at 90% 88%, rgba(255,42,77,.07), transparent 60%),
    linear-gradient(135deg, #07070c 0%, #0e0e16 50%, #07070c 100%);
}
.fs-stadium-stage::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: repeating-linear-gradient(0deg, rgba(255,255,255,.015) 0 1px, transparent 1px 4px);
}

.fs-scorebug {
  position: absolute; top: 48px; left: 64px; right: 64px; height: 120px;
  display: flex; align-items: center; gap: 32px;
  border-bottom: 2px solid rgba(255,255,255,.08); padding-bottom: 20px;
}
.fs-live {
  font-family: 'Archivo Black'; font-size: 46px; letter-spacing: .06em; color: #000;
  background: #ff2a4d; padding: 14px 22px; border-radius: 6px;
  display: flex; gap: 14px; align-items: center;
}
.fs-live::before {
  content: ''; width: 18px; height: 18px; border-radius: 50%;
  background: #000; animation: fs-blink 1.4s infinite;
}
@keyframes fs-blink { 50% { opacity: .3; } }
.fs-channel { font-family: 'JetBrains Mono'; font-size: 38px; letter-spacing: .2em; color: #9aa0ab; }
.fs-channel b { color: #f4f5f7; }
.fs-spacer { flex: 1; }
.fs-clock {
  font-family: 'Archivo Black'; font-size: 120px; letter-spacing: -.02em;
  line-height: .85; color: #d7ff1e; text-align: right;
}
.fs-clock-date {
  display: block; font-family: 'JetBrains Mono'; font-size: 34px;
  color: #9aa0ab; letter-spacing: .18em; margin-top: 6px;
}

.fs-tv {
  position: absolute; top: 220px; left: 64px; width: 2300px; height: 1280px;
  background: linear-gradient(180deg, #1a1d24, #0c0e13);
  border: 3px solid rgba(255,255,255,.08); border-radius: 14px;
  overflow: hidden; box-shadow: 0 30px 80px rgba(0,0,0,.6);
}
.fs-crt {
  position: absolute; inset: 0;
  background:
    radial-gradient(1600px 900px at 50% 40%, rgba(0,212,255,.16), transparent 60%),
    linear-gradient(180deg, #0a0d14 0%, #1a2030 50%, #0a0d14 100%);
}
.fs-crt::after {
  content: ''; position: absolute; inset: 0;
  background: repeating-linear-gradient(0deg, rgba(255,255,255,.04) 0 2px, transparent 2px 6px);
  mix-blend-mode: screen;
}
.fs-tv-center {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -75%);
  text-align: center; padding: 0 60px;
}
.fs-tv-mark {
  font-family: 'Archivo Black'; font-size: 380px; line-height: .85; letter-spacing: -.04em;
  color: #f4f5f7; text-shadow: 0 14px 48px rgba(0,212,255,.35);
}
.fs-tv-net {
  display: inline-block; font-family: 'JetBrains Mono'; font-size: 34px; letter-spacing: .34em;
  color: #00d4ff; border: 2px solid #00d4ff; padding: 10px 26px; margin-top: 28px;
}
.fs-tv-lower {
  position: absolute; left: 0; right: 0; bottom: 0; padding: 42px 56px;
  background: linear-gradient(180deg, transparent, rgba(0,0,0,.85));
}
.fs-tv-tag {
  font-family: 'JetBrains Mono'; font-size: 32px; letter-spacing: .24em;
  color: #d7ff1e; margin-bottom: 14px;
}
.fs-tv-title {
  margin: 0; font-family: 'Archivo Black'; font-size: 108px;
  line-height: .92; letter-spacing: -.02em;
}
.fs-tv-title em { font-style: normal; color: #d7ff1e; }

.fs-right {
  position: absolute; top: 220px; right: 64px; width: 1340px;
  display: flex; flex-direction: column; gap: 36px;
}
.fs-panel {
  background: #11131a; border: 2px solid rgba(255,255,255,.08); border-radius: 14px;
  padding: 46px; position: relative;
}
.fs-label {
  font-family: 'JetBrains Mono'; font-size: 28px; letter-spacing: .28em;
  color: #9aa0ab; margin-bottom: 16px;
}

.fs-nowplay {
  background: linear-gradient(135deg, #0e2014 0%, #0d1117 100%);
  border-color: rgba(215,255,30,.25);
}
.fs-nowplay .fs-label { color: #d7ff1e; }
.fs-np-row { display: flex; gap: 32px; align-items: center; }
.fs-np-art {
  width: 220px; height: 220px; border-radius: 14px; flex: none;
  background: linear-gradient(135deg, #d7ff1e 0%, #79e600 100%);
  position: relative; overflow: hidden;
}
.fs-np-art::after {
  content: '\\266B'; position: absolute; inset: 0; display: grid; place-items: center;
  font-family: 'Archivo Black'; font-size: 200px; color: rgba(0,0,0,.85);
}
.fs-np-title { font-family: 'Archivo Black'; font-size: 80px; line-height: .95; letter-spacing: -.02em; }
.fs-np-artist { font-family: 'Outfit'; font-weight: 400; font-size: 42px; color: #9aa0ab; margin-top: 10px; }
.fs-eq {
  display: flex; gap: 8px; margin-top: 24px; align-items: flex-end; height: 48px;
}
.fs-eq span {
  width: 14px; background: #d7ff1e; border-radius: 3px;
  animation: fs-eq 1s ease-in-out infinite;
}
.fs-eq span:nth-child(1) { animation-delay: 0s;   height: 36%; }
.fs-eq span:nth-child(2) { animation-delay: .15s; height: 80%; }
.fs-eq span:nth-child(3) { animation-delay: .30s; height: 55%; }
.fs-eq span:nth-child(4) { animation-delay: .45s; height: 90%; }
.fs-eq span:nth-child(5) { animation-delay: .60s; height: 48%; }
.fs-eq span:nth-child(6) { animation-delay: .75s; height: 70%; }
.fs-eq span:nth-child(7) { animation-delay: .90s; height: 42%; }
@keyframes fs-eq { 0%,100% { transform: scaleY(.4); } 50% { transform: scaleY(1); } }
.fs-pgr {
  margin-top: 30px; height: 8px; background: rgba(255,255,255,.08);
  border-radius: 4px; overflow: hidden;
}
.fs-pgr i { display: block; height: 100%; width: 48%; background: #d7ff1e; }
.fs-times {
  display: flex; justify-content: space-between; margin-top: 10px;
  font-family: 'JetBrains Mono'; font-size: 28px; color: #9aa0ab; letter-spacing: .1em;
}

.fs-promo {
  background: linear-gradient(135deg, #2a1500 0%, #150a00 100%);
  border-color: rgba(251,191,36,.32);
}
.fs-promo .fs-label { color: #fbbf24; }
.fs-promo-badge {
  position: absolute; top: 30px; right: 30px;
  font-family: 'JetBrains Mono'; font-size: 22px; letter-spacing: .24em; color: #000;
  background: #fbbf24; padding: 6px 14px; border-radius: 4px;
}
.fs-promo-h {
  margin: 0; font-family: 'Archivo Black'; font-size: 96px;
  line-height: .92; letter-spacing: -.02em;
}
.fs-promo-h em { font-style: normal; color: #fbbf24; }
.fs-promo-sub { font-size: 42px; color: #9aa0ab; margin-top: 18px; line-height: 1.25; }
.fs-promo-cta {
  display: inline-block; margin-top: 30px;
  font-family: 'Archivo Black'; font-size: 42px; letter-spacing: .04em;
  background: #fbbf24; color: #000; padding: 18px 36px; border-radius: 8px;
}

.fs-stats {
  position: absolute; left: 64px; right: 64px; bottom: 160px; height: 230px;
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 36px;
}
.fs-stat {
  background: #11131a; border: 2px solid rgba(255,255,255,.08); border-radius: 14px;
  padding: 36px 40px; position: relative; overflow: hidden;
}
.fs-stat-k {
  font-family: 'JetBrains Mono'; font-size: 26px; letter-spacing: .28em; color: #9aa0ab;
}
.fs-stat-v {
  font-family: 'Archivo Black'; font-size: 120px; line-height: .92; letter-spacing: -.02em; margin-top: 8px;
}
.fs-acc1 .fs-stat-v { color: #d7ff1e; }
.fs-acc2 .fs-stat-v { color: #ff2a4d; }
.fs-acc3 .fs-stat-v { color: #00d4ff; }
.fs-stat-cap { font-family: 'Outfit'; font-size: 30px; color: #9aa0ab; margin-top: 8px; }
.fs-stat::after {
  content: ''; position: absolute; right: -30px; top: -30px;
  width: 140px; height: 140px; border-radius: 50%; opacity: .12;
}
.fs-acc1::after { background: #d7ff1e; }
.fs-acc2::after { background: #ff2a4d; }
.fs-acc3::after { background: #00d4ff; }

.fs-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 108px;
  background: #d7ff1e; color: #000;
  display: flex; align-items: center; gap: 48px; overflow: hidden;
  font-family: 'Archivo Black'; font-size: 60px; letter-spacing: .02em;
}
.fs-ticker-tag {
  background: #000; color: #d7ff1e; padding: 14px 30px; margin-left: 24px;
  font-size: 42px; letter-spacing: .18em; flex: none;
}
.fs-ticker-msg {
  white-space: nowrap;
  animation: fs-ticker-scroll 60s linear infinite;
}
@keyframes fs-ticker-scroll {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
`;
