"use client";

/**
 * FitnessIronWidget — 4K weight-floor scene, 3840x2160 (Iron theme).
 *
 * APPROVED 2026-05-03 — matches scratch/design/fitness/02-iron.html
 * Ported via HsStage transform:scale pattern. Every pixel size is
 * FIXED (matches the HTML mockup); DO NOT regress to vw/%.
 *
 * Visual DNA — brutalist concrete weight floor:
 *   - Concrete charcoal #181816 base + scanline + grid texture
 *   - Caution-tape header ribbon (yellow + black diagonals, slight tilt)
 *   - Plate-stack decorative left rail (red/black/yellow/green/white)
 *   - Giant outlined stencil section number (520px)
 *   - Hot-red #ff2a4d accent on key words, caution-yellow #ffd400 chrome
 *   - Archivo Black display + Outfit body + JetBrains Mono labels
 *   - Tutorial pane (form-check) with circular play button + cue strip
 *   - Hero countdown timer with phase + round indicators
 *   - Dashed quote panel with oversized quote glyph
 *   - Bottom plate-stack ticker with clipped angled badge
 *
 * Editable hotspots — every text element has a `data-field` attribute
 * that PropertiesPanel matches via THEMED_WIDGET_FIELDS or the auto-form
 * generator. Field keys use dot notation:
 *   header.num, header.t1, header.t2, header.kicker, header.time
 *   tutorial.stamp, tutorial.t1, tutorial.t2,
 *     tutorial.c1k, tutorial.c1v, tutorial.c2k, tutorial.c2v,
 *     tutorial.c3k, tutorial.c3v
 *   timer.tag, timer.count, timer.phase, timer.protocol
 *   quote.t1, quote.t2, quote.t3, quote.by
 *   ticker.badge, ticker.t1, ticker.t2, ticker.t3
 */

import { useEffect, useState } from 'react';
import { HsStage } from '../hs/HsStage';

export interface FitnessIronConfig {
  // Header / stencil
  'header.num'?: string;
  'header.t1'?: string;
  'header.t2'?: string;
  'header.kicker'?: string;
  'header.time'?: string;
  /** When true the header time auto-updates from the device clock every second. */
  liveClock?: boolean;
  // Tutorial pane
  'tutorial.stamp'?: string;
  'tutorial.t1'?: string;
  'tutorial.t2'?: string;
  'tutorial.c1k'?: string;
  'tutorial.c1v'?: string;
  'tutorial.c2k'?: string;
  'tutorial.c2v'?: string;
  'tutorial.c3k'?: string;
  'tutorial.c3v'?: string;
  // Timer
  'timer.tag'?: string;
  'timer.count'?: string;
  'timer.phase'?: string;
  'timer.protocol'?: string;
  // Quote
  'quote.t1'?: string;
  'quote.t2'?: string;
  'quote.t3'?: string;
  'quote.by'?: string;
  // Ticker
  'ticker.badge'?: string;
  'ticker.t1'?: string;
  'ticker.t2'?: string;
  'ticker.t3'?: string;
}

/* eslint-disable @typescript-eslint/quotes */
export const DEFAULTS: Record<string, string> = {
  'header.num':         '02',
  'header.t1':          'Iron',
  'header.t2':          'floor.',
  'header.kicker':      'PLATFORM 1 — 8',
  'header.time':        '07:42 · TUE · 68°F',
  'tutorial.stamp':     '▸ FORM CHECK · LOOP',
  'tutorial.t1':        'Romanian ',
  'tutorial.t2':        'deadlift.',
  'tutorial.c1k':       'SETUP',
  'tutorial.c1v':       'Bar at hip · soft knees · neutral spine',
  'tutorial.c2k':       'DESCENT',
  'tutorial.c2v':       'Hinge — do not squat. 3 sec down.',
  'tutorial.c3k':       'FINISH',
  'tutorial.c3v':       'Squeeze glutes. Stand tall. Reset.',
  'timer.tag':          '▸ SUPERSET · ROUND 4 / 8',
  'timer.count':        '00:32',
  'timer.phase':        'WORK',
  'timer.protocol':     '40s ON · 20s OFF · 8 RDS',
  'quote.t1':           "The bar doesn't ",
  'quote.t2':           'care',
  'quote.t3':           ' about your feelings.',
  'quote.by':           '— PLATFORM C · ANONYMOUS',
  'ticker.badge':       '★ HEAVY HOUR',
  'ticker.t1':          '5:30 PM SHARP · BACK SQUAT ',
  'ticker.t2':          'PR FRIDAY',
  'ticker.t3':          ' · BRING A SPOTTER, BRING CHALK',
};
/* eslint-enable @typescript-eslint/quotes */

function pick(cfg: FitnessIronConfig | undefined, key: keyof typeof DEFAULTS): string {
  return ((cfg as any)?.[key] as string | undefined) ?? DEFAULTS[key];
}

function useLiveClock(enabled: boolean): string | null {
  const [tick, setTick] = useState<string | null>(() => (enabled ? formatLiveClock() : null));
  useEffect(() => {
    if (!enabled) return;
    setTick(formatLiveClock());
    const id = setInterval(() => setTick(formatLiveClock()), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return tick;
}

function formatLiveClock(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const dow = d.toLocaleDateString([], { weekday: 'short' }).toUpperCase();
  return `${hh}:${mm} · ${dow} · 68°F`;
}

export function FitnessIronWidget({ config }: { config?: FitnessIronConfig }) {
  const liveClock = useLiveClock(config?.liveClock !== false);
  const time = liveClock ?? pick(config, 'header.time');

  return (
    <HsStage
      stageClassName="fi-iron-stage"
      stageStyle={{ background: '#181816', color: '#f4f0e8', fontFamily: "'Outfit', system-ui, sans-serif" }}
    >
      <style>{CSS}</style>

      {/* Caution-tape header ribbon */}
      <div className="fi-tape" />

      {/* Decorative plate-stack rail */}
      <div className="fi-plates">
        <div className="fi-plate fi-r" />
        <div className="fi-plate fi-r" />
        <div className="fi-plate fi-b" />
        <div className="fi-plate fi-y" />
        <div className="fi-plate fi-b" />
        <div className="fi-plate fi-g" />
        <div className="fi-plate fi-w" />
        <div className="fi-plate fi-b" />
        <div className="fi-plate fi-r" />
      </div>

      {/* Stencil header */}
      <div className="fi-stencil">
        <div className="fi-num" data-field="header.num">{pick(config, 'header.num')}</div>
        <div className="fi-label">
          <span data-field="header.t1">{pick(config, 'header.t1')}</span>
          <em data-field="header.t2">{pick(config, 'header.t2')}</em>
        </div>
        <div className="fi-meta">
          <div data-field="header.kicker">{pick(config, 'header.kicker')}</div>
          <div data-field="header.time">{time}</div>
        </div>
      </div>

      {/* Two-column grid */}
      <div className="fi-grid">

        {/* Tutorial pane */}
        <div className="fi-tutorial">
          <div className="fi-stamp" data-field="tutorial.stamp">{pick(config, 'tutorial.stamp')}</div>
          <div className="fi-play" />
          <div className="fi-lower">
            <div className="fi-name">
              <span data-field="tutorial.t1">{pick(config, 'tutorial.t1')}</span>
              <em data-field="tutorial.t2">{pick(config, 'tutorial.t2')}</em>
            </div>
            <div className="fi-cues">
              <div className="fi-cue">
                <b data-field="tutorial.c1k">{pick(config, 'tutorial.c1k')}</b>
                <span data-field="tutorial.c1v">{pick(config, 'tutorial.c1v')}</span>
              </div>
              <div className="fi-cue">
                <b data-field="tutorial.c2k">{pick(config, 'tutorial.c2k')}</b>
                <span data-field="tutorial.c2v">{pick(config, 'tutorial.c2v')}</span>
              </div>
              <div className="fi-cue">
                <b data-field="tutorial.c3k">{pick(config, 'tutorial.c3k')}</b>
                <span data-field="tutorial.c3v">{pick(config, 'tutorial.c3v')}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Timer */}
        <div className="fi-timer">
          <div className="fi-tag" data-field="timer.tag">{pick(config, 'timer.tag')}</div>
          <div className="fi-countdown" data-field="timer.count">{pick(config, 'timer.count')}</div>
          <div className="fi-phase" data-field="timer.phase">{pick(config, 'timer.phase')}</div>
          <div className="fi-rounds">
            <span className="fi-done" />
            <span className="fi-done" />
            <span className="fi-done" />
            <span className="fi-now" />
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="fi-protocol" data-field="timer.protocol">{pick(config, 'timer.protocol')}</div>
        </div>

        {/* Quote */}
        <div className="fi-quote">
          <div className="fi-quote-body">
            <span data-field="quote.t1">{pick(config, 'quote.t1')}</span>
            <em data-field="quote.t2">{pick(config, 'quote.t2')}</em>
            <span data-field="quote.t3">{pick(config, 'quote.t3')}</span>
          </div>
          <div className="fi-quote-by" data-field="quote.by">{pick(config, 'quote.by')}</div>
        </div>

      </div>

      {/* Bottom ticker */}
      <div className="fi-ticker">
        <div className="fi-ticker-badge" data-field="ticker.badge">{pick(config, 'ticker.badge')}</div>
        <div className="fi-ticker-msg">
          <span data-field="ticker.t1">{pick(config, 'ticker.t1')}</span>
          <em data-field="ticker.t2">{pick(config, 'ticker.t2')}</em>
          <span data-field="ticker.t3">{pick(config, 'ticker.t3')}</span>
        </div>
      </div>
    </HsStage>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=JetBrains+Mono:wght@500;700&family=Outfit:wght@400;700;900&display=swap');

.fi-iron-stage {
  background:
    radial-gradient(circle at 20% 30%, rgba(255,255,255,.04), transparent 40%),
    radial-gradient(circle at 80% 70%, rgba(255,255,255,.03), transparent 40%),
    repeating-linear-gradient(0deg, rgba(0,0,0,.18) 0 2px, transparent 2px 8px),
    repeating-linear-gradient(90deg, rgba(255,255,255,.02) 0 1px, transparent 1px 60px),
    #181816;
}

.fi-tape {
  position: absolute; top: 60px; left: 0; right: 0; height: 80px;
  background: repeating-linear-gradient(135deg, #ffd400 0 80px, #000 80px 160px);
  transform: rotate(-.6deg); transform-origin: 0 50%;
}
.fi-tape::after {
  content: ''; position: absolute; top: -2px; right: 0; bottom: -2px; left: 0;
  border-top: 3px solid #000; border-bottom: 3px solid #000;
}

.fi-plates {
  position: absolute; left: 0; top: 200px; bottom: 240px; width: 80px;
  display: flex; flex-direction: column; gap: 18px; padding: 40px 20px;
  align-items: center; justify-content: center;
}
.fi-plate { width: 50px; height: 50px; border-radius: 50%; flex: none; }
.fi-r { background: #cc0000; box-shadow: inset -6px -6px 0 rgba(0,0,0,.4); }
.fi-b { background: #1a1a1a; border: 3px solid #444; }
.fi-y { background: #ffd400; box-shadow: inset -6px -6px 0 rgba(0,0,0,.4); }
.fi-g { background: #1a7f3f; box-shadow: inset -6px -6px 0 rgba(0,0,0,.4); }
.fi-w { background: #e8e4dc; }

.fi-stencil {
  position: absolute; top: 200px; left: 80px; right: 80px;
  display: flex; align-items: flex-end; gap: 80px;
}
.fi-num {
  font-family: 'Archivo Black'; font-size: 520px; line-height: .8;
  color: transparent; -webkit-text-stroke: 6px #f4f0e8; letter-spacing: -.04em;
}
.fi-label {
  font-family: 'Archivo Black'; font-size: 200px; line-height: .85;
  letter-spacing: -.03em; flex: 1;
}
.fi-label em { font-style: normal; color: #ff2a4d; display: block; }
.fi-meta {
  font-family: 'JetBrains Mono'; font-size: 48px; letter-spacing: .18em;
  color: #8a8680; padding-bottom: 30px;
}

.fi-grid {
  position: absolute; top: 920px; left: 80px; right: 80px; bottom: 240px;
  display: grid;
  grid-template-columns: 2200px 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 48px;
}

.fi-tutorial {
  grid-column: 1; grid-row: 1 / span 2;
  background: #0d0d0d; border: 4px solid #f4f0e8;
  position: relative; overflow: hidden;
}
.fi-tutorial::before {
  content: ''; position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  background: radial-gradient(800px 500px at 50% 40%, rgba(255,42,77,.15), transparent 60%);
}
.fi-stamp {
  position: absolute; top: 40px; left: 48px;
  font-family: 'JetBrains Mono'; font-size: 36px; letter-spacing: .24em;
  color: #ffd400; border: 3px solid #ffd400; padding: 10px 20px;
}
.fi-play {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -60%);
  width: 380px; height: 380px; border: 8px solid #f4f0e8; border-radius: 50%;
  display: grid; place-items: center;
}
.fi-play::after {
  content: ''; width: 0; height: 0;
  border-left: 140px solid #f4f0e8;
  border-top: 90px solid transparent;
  border-bottom: 90px solid transparent;
  margin-left: 30px;
}
.fi-lower {
  position: absolute; left: 0; right: 0; bottom: 0; padding: 64px 80px;
  background: linear-gradient(180deg, transparent, rgba(0,0,0,.92));
}
.fi-name {
  font-family: 'Archivo Black'; font-size: 160px; line-height: .9;
  letter-spacing: -.02em;
}
.fi-name em { font-style: normal; color: #ff2a4d; }
.fi-cues { display: flex; gap: 48px; margin-top: 40px; }
.fi-cue {
  font-family: 'Outfit'; font-weight: 700; font-size: 42px; flex: 1;
  padding-left: 24px; border-left: 6px solid #ff2a4d;
}
.fi-cue b {
  display: block; font-family: 'JetBrains Mono'; font-size: 28px;
  letter-spacing: .24em; color: #8a8680; margin-bottom: 8px;
}

.fi-timer {
  background: #0d0d0d; border: 4px solid #ff2a4d;
  padding: 48px 56px; position: relative;
}
.fi-tag {
  font-family: 'JetBrains Mono'; font-size: 32px; letter-spacing: .28em;
  color: #ff2a4d;
}
.fi-countdown {
  font-family: 'Archivo Black'; font-size: 340px; line-height: .85;
  letter-spacing: -.04em; color: #f4f0e8; margin-top: 20px;
}
.fi-phase {
  font-family: 'Archivo Black'; font-size: 96px; line-height: 1;
  letter-spacing: -.02em; color: #ff2a4d; margin-top: 8px;
}
.fi-rounds { display: flex; gap: 14px; margin-top: 38px; }
.fi-rounds span {
  width: 70px; height: 14px;
  background: rgba(255,255,255,.08); border-radius: 2px;
}
.fi-rounds span.fi-done { background: #ff2a4d; }
.fi-rounds span.fi-now { background: #ffd400; }
.fi-protocol {
  font-family: 'JetBrains Mono'; font-size: 32px; letter-spacing: .18em;
  color: #8a8680; margin-top: 24px;
}

.fi-quote {
  background: transparent; border: 4px dashed #f4f0e8;
  padding: 54px 56px; position: relative;
}
.fi-quote::before {
  content: '"'; position: absolute; top: -30px; left: 30px;
  font-family: 'Archivo Black'; font-size: 280px; line-height: 1;
  color: #ffd400;
}
.fi-quote-body {
  font-family: 'Archivo Black'; font-size: 78px; line-height: 1;
  letter-spacing: -.02em;
}
.fi-quote-body em { font-style: normal; color: #ff2a4d; }
.fi-quote-by {
  font-family: 'JetBrains Mono'; font-size: 30px; letter-spacing: .22em;
  color: #8a8680; margin-top: 30px;
}

.fi-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 180px;
  background: #0a0a0a; border-top: 4px solid #ffd400;
  display: flex; align-items: center; gap: 0; overflow: hidden;
}
.fi-ticker-badge {
  flex: none; height: 100%; display: flex; align-items: center;
  padding: 0 56px;
  background: #ffd400; color: #000;
  font-family: 'Archivo Black'; font-size: 80px; letter-spacing: .04em;
  clip-path: polygon(0 0, 100% 0, calc(100% - 60px) 100%, 0 100%);
}
.fi-ticker-msg {
  font-family: 'Archivo Black'; font-size: 80px; letter-spacing: -.01em;
  color: #f4f0e8; white-space: nowrap; padding-left: 80px;
  animation: fi-ticker-scroll 60s linear infinite;
}
.fi-ticker-msg em { font-style: normal; color: #ff2a4d; }
@keyframes fi-ticker-scroll {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
`;
