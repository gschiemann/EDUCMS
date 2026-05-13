"use client";

/**
 * FitnessChannelGuideWidget — 4K cardio-floor scene, 3840×2160 (Channel Guide theme).
 *
 * Ported from scratch/design/fitness/04-channel-guide.html via HsStage
 * transform:scale pattern. Every pixel size is FIXED (matches the HTML
 * mockup); DO NOT regress to vw/%.
 *
 * Visual DNA — old-school cable TV channel guide energy:
 *   - Deep-space #040816 base + cyan scanline texture
 *   - Cyan #00d4ff + violet #a855f7 + hot red #ff2a4d accents
 *   - Archivo Black display + Outfit body + JetBrains Mono labels
 *   - Top brand bar with cyan-underline rule + LIVE pill + clock
 *   - Massive 2400px wide "now watching" preview pane (CRT glow)
 *   - Right column: "up next" channel queue + violet "ask staff" CTA
 *   - 8x2 channel-tile grid (Netflix/YouTube/Hulu/Prime/Disney+/Peacock/Spotify/Apple TV
 *     branded gradients, then a second row of 8 generic streaming bricks)
 *   - Bottom cyan ticker on black with monospace tag
 *
 * Editable hotspots — every text element has a `data-field` attribute
 * that PropertiesPanel matches via THEMED_WIDGET_FIELDS or the auto-form
 * generator. Field keys use dot notation:
 *   top.t1, top.t2, top.pill, top.time, top.date
 *   screen.ch, screen.live, screen.logo, screen.show,
 *     screen.t1, screen.t2, screen.t3, screen.p
 *   next.lab, next.h, next.0.ch, next.0.nm, next.0.tm (× 3 rows)
 *   cta.lab, cta.h, cta.p
 *   ch.0.num, ch.0.name, ch.0.show (× 16 channel tiles)
 *   ticker.tag, ticker.message
 */

import { useEffect, useState } from 'react';
import { HsStage } from '../hs/HsStage';

export interface FitnessChannelGuideConfig {
  // Top bar
  'top.t1'?: string;
  'top.t2'?: string;
  'top.pill'?: string;
  'top.time'?: string;
  'top.date'?: string;
  /** When true the clock auto-updates from the device clock every second. */
  liveClock?: boolean;
  // Now-watching screen
  'screen.ch'?: string;
  'screen.live'?: string;
  'screen.logo'?: string;
  'screen.show'?: string;
  'screen.t1'?: string;
  'screen.t2'?: string;
  'screen.t3'?: string;
  'screen.p'?: string;
  // Up-next panel
  'next.lab'?: string;
  'next.h'?: string;
  'next.0.ch'?: string;
  'next.0.nm'?: string;
  'next.0.tm'?: string;
  'next.1.ch'?: string;
  'next.1.nm'?: string;
  'next.1.tm'?: string;
  'next.2.ch'?: string;
  'next.2.nm'?: string;
  'next.2.tm'?: string;
  // CTA panel
  'cta.lab'?: string;
  'cta.h'?: string;
  'cta.p'?: string;
  // Channel grid — 16 tiles
  'ch.0.num'?: string;  'ch.0.name'?: string;  'ch.0.show'?: string;
  'ch.1.num'?: string;  'ch.1.name'?: string;  'ch.1.show'?: string;
  'ch.2.num'?: string;  'ch.2.name'?: string;  'ch.2.show'?: string;
  'ch.3.num'?: string;  'ch.3.name'?: string;  'ch.3.show'?: string;
  'ch.4.num'?: string;  'ch.4.name'?: string;  'ch.4.show'?: string;
  'ch.5.num'?: string;  'ch.5.name'?: string;  'ch.5.show'?: string;
  'ch.6.num'?: string;  'ch.6.name'?: string;  'ch.6.show'?: string;
  'ch.7.num'?: string;  'ch.7.name'?: string;  'ch.7.show'?: string;
  'ch.8.num'?: string;  'ch.8.name'?: string;  'ch.8.show'?: string;
  'ch.9.num'?: string;  'ch.9.name'?: string;  'ch.9.show'?: string;
  'ch.10.num'?: string; 'ch.10.name'?: string; 'ch.10.show'?: string;
  'ch.11.num'?: string; 'ch.11.name'?: string; 'ch.11.show'?: string;
  'ch.12.num'?: string; 'ch.12.name'?: string; 'ch.12.show'?: string;
  'ch.13.num'?: string; 'ch.13.name'?: string; 'ch.13.show'?: string;
  'ch.14.num'?: string; 'ch.14.name'?: string; 'ch.14.show'?: string;
  'ch.15.num'?: string; 'ch.15.name'?: string; 'ch.15.show'?: string;
  // Ticker
  'ticker.tag'?: string;
  'ticker.message'?: string;
}

/* eslint-disable @typescript-eslint/quotes */
export const DEFAULTS: Record<string, string> = {
  'top.t1':         'Channel ',
  'top.t2':         'Guide',
  'top.pill':       '▸ 1 STICK · ONLINE',
  'top.time':       '7:42 PM',
  'top.date':       'TUE · APR 23 · CARDIO TV — STATION 04',
  'screen.ch':      'CH 04',
  'screen.live':    'LIVE',
  'screen.logo':    'ESPN',
  'screen.show':    'SPORTSCENTER · 60 MIN LEFT',
  'screen.t1':      'Top ',
  'screen.t2':      '10',
  'screen.t3':      ' plays.',
  'screen.p':       "Recap of the night's biggest moments — runs through 8 PM, then NBA tipoff.",
  'next.lab':       '▸ UP NEXT ON THIS SCREEN',
  'next.h':         'Already queued.',
  'next.0.ch':      'CH 18',
  'next.0.nm':      'NBA Tipoff',
  'next.0.tm':      '8:00P',
  'next.1.ch':      'CH 02',
  'next.1.nm':      'CNN Headlines',
  'next.1.tm':      '9:00P',
  'next.2.ch':      'CH 11',
  'next.2.nm':      'Food Network',
  'next.2.tm':      '10:00P',
  'cta.lab':        '▸ ASK THE FRONT DESK',
  'cta.h':          'Want a different show?',
  'cta.p':          'Staff can switch any cardio TV — just shout the channel.',
  'ch.0.num':       'CH 01',
  'ch.0.name':      'NETFLIX',
  'ch.0.show':      '▸ Stranger Things 5',
  'ch.1.num':       'CH 02',
  'ch.1.name':      'YOUTUBE',
  'ch.1.show':      '▸ Live news',
  'ch.2.num':       'CH 03',
  'ch.2.name':      'HULU',
  'ch.2.show':      '▸ The Bear S4',
  'ch.3.num':       'CH 04',
  'ch.3.name':      'PRIME',
  'ch.3.show':      '▸ Reacher',
  'ch.4.num':       'CH 05',
  'ch.4.name':      'DISNEY+',
  'ch.4.show':      '▸ Andor S2',
  'ch.5.num':       'CH 06',
  'ch.5.name':      'PEACOCK',
  'ch.5.show':      '▸ Premier League',
  'ch.6.num':       'CH 07',
  'ch.6.name':      'SPOTIFY',
  'ch.6.show':      '▸ Cardio Heat',
  'ch.7.num':       'CH 08',
  'ch.7.name':      'APPLE TV',
  'ch.7.show':      '▸ Slow Horses',
  'ch.8.num':       'CH 09',
  'ch.8.name':      'MAX',
  'ch.8.show':      '▸ Hard Knocks',
  'ch.9.num':       'CH 10',
  'ch.9.name':      'PARAMOUNT+',
  'ch.9.show':      '▸ NCIS',
  'ch.10.num':      'CH 11',
  'ch.10.name':     'FOOD NET',
  'ch.10.show':     '▸ Chopped',
  'ch.11.num':      'CH 12',
  'ch.11.name':     'HGTV',
  'ch.11.show':     '▸ House Hunters',
  'ch.12.num':      'CH 13',
  'ch.12.name':     'FAST 1',
  'ch.12.show':     '▸ Pluto · 24/7 Office',
  'ch.13.num':      'CH 14',
  'ch.13.name':     'FAST 2',
  'ch.13.show':     '▸ Roku · Reno',
  'ch.14.num':      'CH 15',
  'ch.14.name':     'SLEEP TV',
  'ch.14.show':     '▸ Ambient · loop',
  'ch.15.num':      'CH 16',
  'ch.15.name':     'GYM CAM',
  'ch.15.show':     '▸ Floor live',
  'ticker.tag':     '▸ STREAMING',
  'ticker.message': '▸ PICK ANY SERVICE · WATCH ON ANY TV ▸ 300+ FREE CHANNELS PLUS YOUR SUBSCRIPTIONS ▸ STAFF CAN SWITCH ANY SCREEN — JUST ASK ▸',
};
/* eslint-enable @typescript-eslint/quotes */

function pick(cfg: FitnessChannelGuideConfig | undefined, key: keyof typeof DEFAULTS): string {
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
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  const dow = d.toLocaleDateString([], { weekday: 'short' }).toUpperCase();
  const mon = d.toLocaleDateString([], { month: 'short' }).toUpperCase();
  const dom = d.getDate();
  return { time, date: `${dow} · ${mon} ${dom}` };
}

const CHANNEL_CLASSES: Record<number, string> = {
  0: 'fc-tile fc-netflix fc-on',
  1: 'fc-tile fc-youtube',
  2: 'fc-tile fc-hulu',
  3: 'fc-tile fc-prime',
  4: 'fc-tile fc-disney',
  5: 'fc-tile fc-peacock',
  6: 'fc-tile fc-spotify',
  7: 'fc-tile fc-apple',
  8: 'fc-tile',
  9: 'fc-tile',
  10: 'fc-tile',
  11: 'fc-tile',
  12: 'fc-tile',
  13: 'fc-tile',
  14: 'fc-tile',
  15: 'fc-tile',
};

export function FitnessChannelGuideWidget({ config }: { config?: FitnessChannelGuideConfig }) {
  const liveClock = useLiveClock(config?.liveClock !== false);
  const time = liveClock?.time ?? pick(config, 'top.time');
  const date = liveClock
    ? `${liveClock.date} · ${pick(config, 'top.date').split('·').slice(2).join('·').trim() || ''}`.replace(/·\s*$/, '').trim()
    : pick(config, 'top.date');

  return (
    <HsStage
      stageClassName="fc-channel-stage"
      stageStyle={{ background: '#040816', color: '#e8f0ff', fontFamily: "'Outfit', system-ui, sans-serif" }}
    >
      <style>{CSS}</style>

      {/* Top bar */}
      <div className="fc-top">
        <div className="fc-brand">
          <span data-field="top.t1">{pick(config, 'top.t1')}</span>
          <em data-field="top.t2">{pick(config, 'top.t2')}</em>
        </div>
        <div className="fc-pill" data-field="top.pill">{pick(config, 'top.pill')}</div>
        <div className="fc-spacer" />
        <div>
          <div className="fc-clock" data-field="top.time">{time}</div>
          <div className="fc-date" data-field="top.date">{date}</div>
        </div>
      </div>

      {/* Now-watching preview */}
      <div className="fc-preview">
        <div className="fc-screen">
          <div className="fc-chnum" data-field="screen.ch">{pick(config, 'screen.ch')}</div>
          <div className="fc-screen-live" data-field="screen.live">{pick(config, 'screen.live')}</div>
          <div className="fc-screen-center">
            <div className="fc-screen-logo" data-field="screen.logo">{pick(config, 'screen.logo')}</div>
            <div className="fc-screen-show" data-field="screen.show">{pick(config, 'screen.show')}</div>
          </div>
          <div className="fc-screen-lower">
            <h2 className="fc-screen-h">
              <span data-field="screen.t1">{pick(config, 'screen.t1')}</span>
              <em data-field="screen.t2">{pick(config, 'screen.t2')}</em>
              <span data-field="screen.t3">{pick(config, 'screen.t3')}</span>
            </h2>
            <p className="fc-screen-p" data-field="screen.p">{pick(config, 'screen.p')}</p>
          </div>
        </div>

        <div className="fc-info">
          <div className="fc-panel fc-next">
            <div className="fc-lab" data-field="next.lab">{pick(config, 'next.lab')}</div>
            <h3 className="fc-next-h" data-field="next.h">{pick(config, 'next.h')}</h3>
            <ul className="fc-next-list">
              <li>
                <span className="fc-next-ch" data-field="next.0.ch">{pick(config, 'next.0.ch')}</span>
                <span className="fc-next-nm" data-field="next.0.nm">{pick(config, 'next.0.nm')}</span>
                <span className="fc-next-tm" data-field="next.0.tm">{pick(config, 'next.0.tm')}</span>
              </li>
              <li>
                <span className="fc-next-ch" data-field="next.1.ch">{pick(config, 'next.1.ch')}</span>
                <span className="fc-next-nm" data-field="next.1.nm">{pick(config, 'next.1.nm')}</span>
                <span className="fc-next-tm" data-field="next.1.tm">{pick(config, 'next.1.tm')}</span>
              </li>
              <li>
                <span className="fc-next-ch" data-field="next.2.ch">{pick(config, 'next.2.ch')}</span>
                <span className="fc-next-nm" data-field="next.2.nm">{pick(config, 'next.2.nm')}</span>
                <span className="fc-next-tm" data-field="next.2.tm">{pick(config, 'next.2.tm')}</span>
              </li>
            </ul>
          </div>

          <div className="fc-panel fc-cta">
            <div className="fc-lab fc-cta-lab" data-field="cta.lab">{pick(config, 'cta.lab')}</div>
            <h3 className="fc-cta-h" data-field="cta.h">{pick(config, 'cta.h')}</h3>
            <p className="fc-cta-p" data-field="cta.p">{pick(config, 'cta.p')}</p>
          </div>
        </div>
      </div>

      {/* Channel grid */}
      <div className="fc-grid">
        {Array.from({ length: 16 }).map((_, i) => {
          const numKey = `ch.${i}.num` as keyof typeof DEFAULTS;
          const nameKey = `ch.${i}.name` as keyof typeof DEFAULTS;
          const showKey = `ch.${i}.show` as keyof typeof DEFAULTS;
          const showLive = i === 0;
          return (
            <div key={i} className={CHANNEL_CLASSES[i]}>
              <div className="fc-tile-num" data-field={numKey}>{pick(config, numKey)}</div>
              {showLive && <div className="fc-tile-live">LIVE</div>}
              <div className="fc-tile-name" data-field={nameKey}>{pick(config, nameKey)}</div>
              <div className="fc-tile-show" data-field={showKey}>{pick(config, showKey)}</div>
            </div>
          );
        })}
      </div>

      {/* Ticker */}
      <div className="fc-ticker">
        <div className="fc-ticker-tag" data-field="ticker.tag">{pick(config, 'ticker.tag')}</div>
        <div className="fc-ticker-msg" data-field="ticker.message">{pick(config, 'ticker.message')}</div>
      </div>
    </HsStage>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=JetBrains+Mono:wght@500;700&family=Outfit:wght@400;700;900&display=swap');

.fc-channel-stage {
  background:
    radial-gradient(1400px 800px at 15% 12%, rgba(0,212,255,.10), transparent 60%),
    radial-gradient(1100px 700px at 85% 88%, rgba(168,85,247,.10), transparent 60%),
    linear-gradient(135deg, #040816 0%, #0a0e22 50%, #040816 100%);
}
.fc-channel-stage::before {
  content: '';
  position: absolute;
  top: 0; right: 0; bottom: 0; left: 0;
  pointer-events: none;
  background-image: repeating-linear-gradient(0deg, rgba(0,212,255,.04) 0 1px, transparent 1px 4px);
}

/* Top bar */
.fc-top {
  position: absolute; top: 48px; left: 64px; right: 64px; height: 140px;
  display: flex; align-items: center; gap: 36px;
  border-bottom: 3px solid #00d4ff; padding-bottom: 28px;
}
.fc-brand { font-family: 'Archivo Black'; font-size: 90px; line-height: .85; letter-spacing: -.02em; color: #e8f0ff; }
.fc-brand em { font-style: normal; color: #00d4ff; }
.fc-pill {
  font-family: 'JetBrains Mono'; font-size: 30px; letter-spacing: .24em; color: #000;
  background: #00d4ff; padding: 10px 22px; border-radius: 6px;
}
.fc-spacer { flex: 1; }
.fc-clock { font-family: 'Archivo Black'; font-size: 96px; line-height: .85; color: #e8f0ff; letter-spacing: -.02em; }
.fc-date { font-family: 'JetBrains Mono'; font-size: 30px; letter-spacing: .18em; color: #7a8aa8; margin-top: 8px; }

/* Now-watching preview */
.fc-preview {
  position: absolute; top: 236px; left: 64px; right: 64px; height: 780px;
  display: grid; grid-template-columns: 2400px 1fr; gap: 48px;
}
.fc-screen {
  background: linear-gradient(180deg, #0a1228, #04081a);
  border: 4px solid rgba(168,85,247,.18); border-radius: 16px;
  position: relative; overflow: hidden;
}
.fc-screen::before {
  content: ''; position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  background: radial-gradient(900px 600px at 50% 40%, rgba(0,212,255,.18), transparent 60%);
}
.fc-chnum {
  position: absolute; top: 36px; left: 36px;
  font-family: 'JetBrains Mono'; font-size: 32px; letter-spacing: .24em; color: #00d4ff;
}
.fc-screen-live {
  position: absolute; top: 36px; right: 36px;
  font-family: 'Archivo Black'; font-size: 36px; color: #000;
  background: #ff2a4d; padding: 10px 22px;
}
.fc-screen-center {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  text-align: center;
}
.fc-screen-logo {
  font-family: 'Archivo Black'; font-size: 280px; line-height: .85; letter-spacing: -.04em; color: #e8f0ff;
  text-shadow: 0 12px 40px rgba(0,212,255,.4);
}
.fc-screen-show {
  font-family: 'JetBrains Mono'; font-size: 42px; letter-spacing: .28em; color: #00d4ff; margin-top: 16px;
}
.fc-screen-lower {
  position: absolute; left: 0; right: 0; bottom: 0; padding: 48px 60px;
  background: linear-gradient(180deg, transparent, rgba(0,0,0,.92));
}
.fc-screen-h {
  margin: 0; font-family: 'Archivo Black'; font-size: 84px; line-height: .92; letter-spacing: -.02em;
}
.fc-screen-h em { font-style: normal; color: #00d4ff; }
.fc-screen-p {
  font-family: 'Outfit'; font-size: 34px; color: #7a8aa8; margin: 14px 0 0;
}

.fc-info { display: flex; flex-direction: column; gap: 32px; }
.fc-panel {
  background: #0a1228; border: 3px solid rgba(168,85,247,.18); border-radius: 14px;
  padding: 42px 46px; position: relative;
}
.fc-lab {
  font-family: 'JetBrains Mono'; font-size: 26px; letter-spacing: .28em; color: #00d4ff; margin-bottom: 14px;
}
.fc-next-h {
  margin: 0; font-family: 'Archivo Black'; font-size: 60px; line-height: .95; letter-spacing: -.02em;
}
.fc-next-list {
  list-style: none; margin: 24px 0 0; padding: 0;
  display: flex; flex-direction: column; gap: 18px;
}
.fc-next-list li {
  display: grid; grid-template-columns: 100px 1fr 90px; align-items: baseline; gap: 16px;
  font-family: 'JetBrains Mono'; font-size: 30px; letter-spacing: .04em;
}
.fc-next-ch { color: #00d4ff; }
.fc-next-nm { color: #e8f0ff; font-family: 'Outfit'; font-weight: 700; font-size: 34px; letter-spacing: 0; }
.fc-next-tm { color: #7a8aa8; text-align: right; }

.fc-cta { background: linear-gradient(135deg, #a855f7, #6b21a8); border-color: #000; }
.fc-cta-lab { color: #fff; }
.fc-cta-h { margin: 0; font-family: 'Archivo Black'; font-size: 64px; line-height: .92; letter-spacing: -.02em; }
.fc-cta-p { font-family: 'Outfit'; font-size: 30px; margin: 14px 0 0; }

/* Channel grid */
.fc-grid {
  position: absolute; left: 64px; right: 64px; bottom: 140px; height: 1000px;
  display: grid; grid-template-columns: repeat(8, 1fr); grid-template-rows: repeat(2, 1fr); gap: 28px;
}
.fc-tile {
  background: #0a1228; border: 3px solid rgba(168,85,247,.18); border-radius: 14px;
  position: relative; overflow: hidden;
  display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 30px;
}
.fc-tile.fc-on { border-color: #00d4ff; box-shadow: 0 0 60px rgba(0,212,255,.25); }
.fc-tile-num {
  position: absolute; top: 18px; left: 24px;
  font-family: 'JetBrains Mono'; font-size: 30px; letter-spacing: .18em; color: #7a8aa8;
}
.fc-tile-live {
  position: absolute; top: 18px; right: 18px;
  font-family: 'JetBrains Mono'; font-size: 22px; color: #ff2a4d;
  padding: 4px 10px; border: 2px solid #ff2a4d;
}
.fc-tile-name {
  font-family: 'Archivo Black'; font-size: 84px; line-height: .85; letter-spacing: -.03em; color: #e8f0ff; text-align: center;
}
.fc-tile-show {
  font-family: 'JetBrains Mono'; font-size: 24px; letter-spacing: .18em; color: #7a8aa8; margin-top: 14px; text-align: center;
}

/* Branded tiles */
.fc-tile.fc-netflix { background: linear-gradient(135deg, #4d0008 0%, #1a0003 100%); border-color: #e50914; }
.fc-tile.fc-netflix .fc-tile-name { color: #e50914; }
.fc-tile.fc-youtube { background: linear-gradient(135deg, #3a0202 0%, #100000 100%); border-color: #ff0000; }
.fc-tile.fc-youtube .fc-tile-name { color: #ff0000; }
.fc-tile.fc-disney  { background: linear-gradient(135deg, #00102f 0%, #000610 100%); border-color: #1ec0ff; }
.fc-tile.fc-disney  .fc-tile-name { color: #1ec0ff; }
.fc-tile.fc-hulu    { background: linear-gradient(135deg, #002e1a 0%, #000a06 100%); border-color: #1ce783; }
.fc-tile.fc-hulu    .fc-tile-name { color: #1ce783; }
.fc-tile.fc-prime   { background: linear-gradient(135deg, #002830 0%, #000c10 100%); border-color: #00a8e1; }
.fc-tile.fc-prime   .fc-tile-name { color: #00a8e1; }
.fc-tile.fc-peacock { background: linear-gradient(135deg, #2a1500 0%, #100600 100%); border-color: #fbbf24; }
.fc-tile.fc-peacock .fc-tile-name { color: #fbbf24; }
.fc-tile.fc-spotify { background: linear-gradient(135deg, #002e0e 0%, #000c04 100%); border-color: #1db954; }
.fc-tile.fc-spotify .fc-tile-name { color: #1db954; }
.fc-tile.fc-apple   { background: linear-gradient(135deg, #1a1a1a 0%, #060606 100%); border-color: #fff; }

/* Ticker */
.fc-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 108px;
  background: #000; border-top: 3px solid #00d4ff; color: #e8f0ff;
  display: flex; align-items: center; gap: 48px; overflow: hidden;
  font-family: 'Archivo Black'; font-size: 54px;
}
.fc-ticker-tag {
  background: #00d4ff; color: #000; padding: 14px 30px; margin-left: 24px;
  font-size: 36px; letter-spacing: .18em; flex: none;
}
.fc-ticker-msg {
  white-space: nowrap;
  animation: fc-ticker-scroll 60s linear infinite;
}
@keyframes fc-ticker-scroll {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
`;
