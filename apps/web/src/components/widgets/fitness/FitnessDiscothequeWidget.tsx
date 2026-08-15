"use client";

/**
 * FitnessDiscothequeWidget — 4K group-class studio scene, 3840×2160 (Discotheque theme).
 *
 * Ported from scratch/design/fitness/05-discotheque.html via HsStage
 * transform:scale pattern. Every pixel size is FIXED (matches the HTML
 * mockup); DO NOT regress to vw/%.
 *
 * Visual DNA — neon disco / spin-yoga-barre studio:
 *   - Deep magenta #0a0510 base + 45° pink scanline texture
 *   - Hot pink #ff1e7c + violet #7b2cff + chrome #e8d5ff palette
 *   - Archivo Black + Bebas Neue + Outfit + JetBrains Mono
 *   - Disco-ball in top-right corner (CSS gradient + grid mesh)
 *   - Massive 380px headline with violet drop-shadow + chrome subtitle
 *   - Three-card row: instructor portrait, class timer, music player
 *   - Animated equalizer bars in the music card
 *   - Bottom hot-pink ticker on black with neon tag
 *
 * Editable hotspots — every text element has a `data-field` attribute
 * that PropertiesPanel matches via THEMED_WIDGET_FIELDS or the auto-form
 * generator. Field keys use dot notation:
 *   head.now, head.t1, head.t2, head.sub
 *   instr.lab, instr.init, instr.t1, instr.t2, instr.role, instr.bio, instr.social
 *   timer.lab, timer.count, timer.phase, timer.meta
 *   play.lab, play.ti, play.ar, play.next
 *   ticker.tag, ticker.message
 */

import { HsStage } from '../hs/HsStage';
import { sceneCss } from '../scene-css';

export interface FitnessDiscothequeConfig {
  // Instructor photo — optional image for the instructor avatar circle
  instructorPhotoUrl?: string;
  // Gym logo — optional image for the header area
  gymLogoUrl?: string;
  // Headline
  'head.now'?: string;
  'head.t1'?: string;
  'head.t2'?: string;
  'head.sub'?: string;
  // Instructor card
  'instr.lab'?: string;
  'instr.init'?: string;
  'instr.t1'?: string;
  'instr.t2'?: string;
  'instr.role'?: string;
  'instr.bio'?: string;
  'instr.social'?: string;
  // Timer card
  'timer.lab'?: string;
  'timer.count'?: string;
  'timer.phase'?: string;
  'timer.meta'?: string;
  // Music player card
  'play.lab'?: string;
  'play.ti'?: string;
  'play.ar'?: string;
  'play.next'?: string;
  // Ticker
  'ticker.tag'?: string;
  'ticker.message'?: string;
}

/* eslint-disable @typescript-eslint/quotes */
export const DEFAULTS: Record<string, string> = {
  // Instructor photo upload (optional — falls back to initials)
  'instructorPhotoUrl': '',
  // Gym logo image upload (optional)
  'gymLogoUrl':         '',
  'head.now':       '▸ NOW LIVE · STUDIO B · 7:30 — 8:30 AM',
  'head.t1':        'Power ',
  'head.t2':        'Yoga.',
  'head.sub':       '★ 22 BOOKED · 8 MATS LEFT · BRING WATER ★',
  'instr.lab':      "★ TODAY'S INSTRUCTOR",
  'instr.init':     'PN',
  'instr.t1':       'Priya ',
  'instr.t2':       'Nair.',
  'instr.role':     'LEAD YOGA · RYT-500',
  'instr.bio':      '12 years on the mat. No-nonsense alignment, zero incense, hard mid-class transitions.',
  'instr.social':   '@priya.flow',
  'timer.lab':      '▸ FLOW · POSE 6 / 24',
  'timer.count':    '00:42',
  'timer.phase':    'WARRIOR II',
  'timer.meta':     'HOLD 60S · BREATHE',
  'play.lab':       '▸ NOW PLAYING',
  'play.ti':        'Sweat It Out',
  'play.ar':        '★ The Class Mix · Vol 12',
  'play.next':      'UP NEXT — RUNAWAY (REMIX)',
  'ticker.tag':     '★ STUDIO B',
  'ticker.message': '★ NEXT CLASS — RESTORE YOGA · PRIYA · 7:00 PM ★ MATS WIPED BETWEEN EVERY CLASS ★ BOOK NEXT WEEK NOW — APP OR DESK ★',
};
/* eslint-enable @typescript-eslint/quotes */

function pick(cfg: FitnessDiscothequeConfig | undefined, key: keyof typeof DEFAULTS): string {
  return ((cfg as any)?.[key] as string | undefined) ?? DEFAULTS[key];
}

export function FitnessDiscothequeWidget({ config }: { config?: FitnessDiscothequeConfig }) {
  return (
    <HsStage
      stageClassName="fd-disco-stage"
      stageStyle={{ background: '#0a0510', color: '#fff4f8', fontFamily: "'Outfit', system-ui, sans-serif" }}
    >
      <style>{sceneCss(CSS)}</style>

      {/* Disco ball corner */}
      <div className="fd-ball" />

      {/* Headline */}
      <div className="fd-head">
        <div className="fd-now" data-field="head.now">{pick(config, 'head.now')}</div>
        <h1 className="fd-h1">
          <span data-field="head.t1">{pick(config, 'head.t1')}</span>
          <em data-field="head.t2">{pick(config, 'head.t2')}</em>
        </h1>
        <div className="fd-sub" data-field="head.sub">{pick(config, 'head.sub')}</div>
      </div>

      {/* Three-card row */}
      <div className="fd-below">
        {/* Instructor */}
        <div className="fd-instr">
          <div className="fd-instr-lab" data-field="instr.lab">{pick(config, 'instr.lab')}</div>
          <div className="fd-instr-row">
            <div className="fd-ph">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {pick(config, 'instructorPhotoUrl') ? (
                <img src={pick(config, 'instructorPhotoUrl')} alt="Instructor photo" className="fd-instr-photo" />
              ) : (
                <div className="fd-init" data-field="instr.init">{pick(config, 'instr.init')}</div>
              )}
            </div>
            <div>
              <div className="fd-nm">
                <span data-field="instr.t1">{pick(config, 'instr.t1')}</span>
                <em data-field="instr.t2">{pick(config, 'instr.t2')}</em>
              </div>
              <div className="fd-role" data-field="instr.role">{pick(config, 'instr.role')}</div>
              <div className="fd-bio" data-field="instr.bio">{pick(config, 'instr.bio')}</div>
              <div className="fd-social" data-field="instr.social">{pick(config, 'instr.social')}</div>
            </div>
          </div>
        </div>

        {/* Timer */}
        <div className="fd-timer">
          <div className="fd-timer-lab" data-field="timer.lab">{pick(config, 'timer.lab')}</div>
          <div className="fd-count" data-field="timer.count">{pick(config, 'timer.count')}</div>
          <div className="fd-phase" data-field="timer.phase">{pick(config, 'timer.phase')}</div>
          <div className="fd-meta" data-field="timer.meta">{pick(config, 'timer.meta')}</div>
        </div>

        {/* Music player */}
        <div className="fd-play">
          <div className="fd-play-lab" data-field="play.lab">{pick(config, 'play.lab')}</div>
          <div className="fd-ti" data-field="play.ti">{pick(config, 'play.ti')}</div>
          <div className="fd-ar" data-field="play.ar">{pick(config, 'play.ar')}</div>
          <div className="fd-eq">
            <span /><span /><span /><span /><span /><span />
            <span /><span /><span /><span /><span /><span />
          </div>
          <div className="fd-next" data-field="play.next">{pick(config, 'play.next')}</div>
        </div>
      </div>

      {/* Ticker */}
      <div className="fd-ticker">
        <div className="fd-ticker-tag" data-field="ticker.tag">{pick(config, 'ticker.tag')}</div>
        <div className="fd-ticker-msg" data-field="ticker.message">{pick(config, 'ticker.message')}</div>
      </div>
    </HsStage>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=JetBrains+Mono:wght@500;700&family=Outfit:wght@400;700;900&family=Bebas+Neue&display=swap');

.fd-disco-stage {
  background:
    radial-gradient(1400px 900px at 25% 15%, rgba(255,30,124,.18), transparent 60%),
    radial-gradient(1200px 800px at 80% 85%, rgba(123,44,255,.18), transparent 60%),
    linear-gradient(135deg, #0a0510 0%, #1a0a1f 50%, #0a0510 100%);
}
.fd-disco-stage::before {
  content: '';
  position: absolute;
  top: 0; right: 0; bottom: 0; left: 0;
  pointer-events: none;
  background-image: repeating-linear-gradient(45deg, rgba(255,30,124,.025) 0 2px, transparent 2px 80px);
}

/* Disco ball corner */
.fd-ball {
  position: absolute; top: 120px; right: 140px; width: 340px; height: 340px; border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, #fff 0, #e8d5ff 30%, #6b4a90 100%);
  box-shadow: 0 0 100px rgba(255,30,124,.5), 0 0 200px rgba(123,44,255,.3);
  animation: fd-ball-spin 18s linear infinite;
}
.fd-ball::after {
  content: ''; position: absolute; top: 0; right: 0; bottom: 0; left: 0; border-radius: 50%;
  background-image:
    repeating-linear-gradient(0deg, rgba(0,0,0,.3) 0 2px, transparent 2px 22px),
    repeating-linear-gradient(90deg, rgba(0,0,0,.3) 0 2px, transparent 2px 22px);
}
@keyframes fd-ball-spin {
  0%   { box-shadow: 0 0 100px rgba(255,30,124,.5), 0 0 200px rgba(123,44,255,.3); }
  50%  { box-shadow: 0 0 100px rgba(123,44,255,.5), 0 0 200px rgba(255,30,124,.3); }
  100% { box-shadow: 0 0 100px rgba(255,30,124,.5), 0 0 200px rgba(123,44,255,.3); }
}

/* Headline */
.fd-head { position: absolute; top: 80px; left: 120px; width: 2200px; }
.fd-now { font-family: 'JetBrains Mono'; font-size: 46px; letter-spacing: .4em; color: #ff1e7c; }
.fd-h1 {
  margin: 24px 0 0; font-family: 'Archivo Black';
  font-size: 380px; line-height: .82; letter-spacing: -.04em; color: #fff4f8;
  text-shadow: 0 0 60px rgba(255,30,124,.45), 12px 12px 0 #7b2cff;
}
.fd-h1 em { font-style: normal; color: #ff1e7c; }
.fd-sub {
  font-family: 'Bebas Neue'; font-size: 84px; letter-spacing: .06em;
  margin-top: 30px; color: #e8d5ff;
}

/* Three-card row */
.fd-below {
  position: absolute; top: 1080px; left: 120px; right: 120px; bottom: 240px;
  display: grid; grid-template-columns: 1.6fr 1fr 1fr; gap: 48px;
}

/* Instructor card */
.fd-instr {
  background: linear-gradient(180deg, #1f0a1f 0%, #0e0410 100%);
  border: 4px solid #ff1e7c; padding: 60px; position: relative; overflow: hidden;
}
.fd-instr::after {
  content: ''; position: absolute; right: -150px; bottom: -150px;
  width: 600px; height: 600px; border-radius: 50%;
  background: radial-gradient(circle, rgba(255,30,124,.3), transparent 70%);
}
.fd-instr-lab {
  font-family: 'JetBrains Mono'; font-size: 30px; letter-spacing: .28em; color: #ff1e7c;
}
.fd-instr-row {
  display: flex; gap: 48px; margin-top: 30px; align-items: flex-start;
  position: relative; z-index: 1;
}
.fd-ph {
  width: 380px; height: 380px; border-radius: 50%; flex: none;
  background: linear-gradient(135deg, #ff1e7c 0%, #7b2cff 100%);
  border: 6px solid #e8d5ff; position: relative; overflow: hidden;
  display: grid; place-items: center;
}
.fd-instr-photo { position: absolute; top: 0; right: 0; bottom: 0; left: 0; width: 100%; height: 100%; object-fit: cover; object-position: center top; }
.fd-init {
  font-family: 'Archivo Black'; font-size: 200px; color: #fff; line-height: 1;
}
.fd-nm {
  font-family: 'Archivo Black'; font-size: 130px; line-height: .9; letter-spacing: -.02em; color: #fff4f8;
}
.fd-nm em { font-style: normal; color: #ff1e7c; }
.fd-role {
  font-family: 'Bebas Neue'; font-size: 50px; letter-spacing: .06em; color: #e8d5ff; margin-top: 8px;
}
.fd-bio {
  font-family: 'Outfit'; font-weight: 400; font-size: 38px;
  color: #b69cb0; line-height: 1.3; margin-top: 24px;
}
.fd-social {
  display: inline-block; margin-top: 24px;
  font-family: 'JetBrains Mono'; font-size: 32px; letter-spacing: .18em; color: #ff1e7c;
  border: 2px solid #ff1e7c; padding: 8px 18px;
}

/* Timer card */
.fd-timer {
  background: #0e0410; border: 4px solid #7b2cff; padding: 50px 56px; position: relative;
}
.fd-timer-lab {
  font-family: 'JetBrains Mono'; font-size: 30px; letter-spacing: .28em; color: #7b2cff;
}
.fd-count {
  font-family: 'Archivo Black'; font-size: 380px; line-height: .8; letter-spacing: -.04em;
  color: #fff4f8; margin-top: 14px;
  text-shadow: 0 0 60px rgba(123,44,255,.5);
}
.fd-phase {
  font-family: 'Bebas Neue'; font-size: 120px; letter-spacing: .04em; color: #ff1e7c; line-height: .95;
}
.fd-meta {
  font-family: 'JetBrains Mono'; font-size: 30px; letter-spacing: .18em; color: #b69cb0; margin-top: 24px;
}

/* Music player card */
.fd-play {
  background: linear-gradient(135deg, #7b2cff 0%, #ff1e7c 100%);
  padding: 50px 56px; position: relative; color: #fff;
}
.fd-play-lab {
  font-family: 'JetBrains Mono'; font-size: 30px; letter-spacing: .28em; color: rgba(255,255,255,.85);
}
.fd-ti {
  font-family: 'Archivo Black'; font-size: 90px; line-height: .92; letter-spacing: -.02em; margin-top: 14px;
}
.fd-ar {
  font-family: 'Bebas Neue'; font-size: 50px; letter-spacing: .04em; margin-top: 8px;
}
.fd-eq {
  display: flex; gap: 8px; height: 80px; margin-top: 30px; align-items: flex-end;
}
.fd-eq span {
  width: 18px; background: #fff; border-radius: 3px;
  animation: fd-eq 1.1s ease-in-out infinite;
}
.fd-eq span:nth-child(odd) { animation-delay: .2s; }
.fd-eq span:nth-child(3n)  { animation-delay: .5s; }
@keyframes fd-eq { 0%,100% { height: 25%; } 50% { height: 90%; } }
.fd-next {
  font-family: 'JetBrains Mono'; font-size: 28px; letter-spacing: .18em;
  margin-top: 30px; color: rgba(255,255,255,.85);
}

/* Ticker */
.fd-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 120px;
  background: #000; border-top: 4px solid #ff1e7c; color: #ff1e7c;
  display: flex; align-items: center; gap: 48px; overflow: hidden;
  font-family: 'Archivo Black'; font-size: 60px;
}
.fd-ticker-tag {
  background: #ff1e7c; color: #000; padding: 14px 30px; margin-left: 24px;
  font-size: 42px; letter-spacing: .18em; flex: none;
}
.fd-ticker-msg {
  white-space: nowrap;
  animation: fd-ticker-scroll 60s linear infinite;
}
@keyframes fd-ticker-scroll {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
`;
