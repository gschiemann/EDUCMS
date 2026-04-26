"use client";

/**
 * MsStudioPortraitWidget — Middle-school lobby scene (PORTRAIT 2160×3840).
 *
 * APPROVED 2026-04-25 — matches scratch/design/studio-ms-portrait-v1.html.
 * Portrait sibling to MsStudioWidget. Single combined footer at bottom.
 *
 * Layout (2160×3840 stage, edge inset 64px L/R, 20px gaps):
 *   HUD     (top: 56,   h: 360)   ON AIR cabochon + WESTRIDGE.MS lockup
 *                                  + 3 vintage meta tiles (clock/weather/cd)
 *   HERO    (top: 436,  h: 1100)  Episode ribbon, supersized "GOOD MORNING"
 *                                  headline, animated waveform, lede,
 *                                  4 cue chips
 *   TURN+VU (top: 1556, h: 700)   Side-by-side turntable + VU meter
 *   MIXER   (top: 2276, h: 280)   4-strip horizontal console (knob /
 *                                  LEDs / fader / label)
 *   LINEUP  (top: 2576, h: 940)   4 cassette tape cards stacked
 *                                  vertically (done / live / next / later)
 *   FOOTER  (top: 3536, h: 280)   Single combined bar — slate (amber
 *                                  breaking) + VFD (cyan attendance) on
 *                                  top row, brushed-aluminum NOW PLAYING
 *                                  ticker on bottom row
 *
 * box-sizing: border-box on every panel that sets explicit width is
 * load-bearing — without it the lineup column drifts past the right edge.
 *
 * Same Cfg shape as the landscape sibling so admins can swap orientations
 * without reconfiguring. The portrait re-rank pulls the cassette LINEUP
 * into a tall vertical column of 4 (instead of 4-across) and merges the
 * 3 footer chrome elements into one bar with internal dividers — partner
 * explicitly asked for one merged bar.
 */

import * as React from 'react';
import { HsStage } from '../hs/HsStage';
import { useLiveTemplateData, fmt } from '../lib/useLiveTemplateData';

export interface MsStudioPortraitConfig {
  // HUD — ON AIR cabochon
  'status.label'?: string;
  // HUD — school lockup
  'school.eye'?: string;
  'school.name'?: string;
  'school.callsign'?: string;
  'school.team'?: string;
  'school.day'?: string;
  // HUD — meta tiles
  'clock.label'?: string;
  'clock.time'?: string;
  'weather.label'?: string;
  'weather.temp'?: string;
  'countdown.label'?: string;
  'countdown.value'?: string;
  // Hero — broadcast poster
  'greeting.episode'?: string;
  'greeting.h1'?: string;
  'greeting.h2'?: string;
  'greeting.subtitle'?: string;
  'greeting.c0'?: string;
  'greeting.c1'?: string;
  'greeting.c2'?: string;
  'greeting.c3'?: string;
  // Hero — turntable feature
  'feature.eye'?: string;
  'feature.label'?: string;
  'feature.title'?: string;
  'feature.sub'?: string;
  'feature.nw'?: string;
  'feature.tag'?: string;
  // VU meter
  'vu.k'?: string;
  'vu.v'?: string;
  'vu.feet0'?: string;
  'vu.feet1'?: string;
  // Mixer
  'mixer.k'?: string;
  'mixer.v'?: string;
  'mixer.s0'?: string;
  'mixer.s1'?: string;
  'mixer.s2'?: string;
  'mixer.s3'?: string;
  // Lineup — header
  'segments.title'?: string;
  'segments.subtitle'?: string;
  'segments.meta'?: string;
  'segments.metar'?: string;
  // Lineup — tapes (4 cards stacked vertically: done / live / next / later)
  'segments.0.n'?: string;
  'segments.0.t'?: string;
  'segments.0.host'?: string;
  'segments.0.time'?: string;
  'segments.1.n'?: string;
  'segments.1.t'?: string;
  'segments.1.host'?: string;
  'segments.1.time'?: string;
  'segments.2.n'?: string;
  'segments.2.t'?: string;
  'segments.2.host'?: string;
  'segments.2.time'?: string;
  'segments.3.n'?: string;
  'segments.3.t'?: string;
  'segments.3.host'?: string;
  'segments.3.time'?: string;
  // Footer — slate (breaking news)
  'announcement.tag'?: string;
  'announcement.message'?: string;
  'announcement.when_eye'?: string;
  'announcement.when'?: string;
  // Footer — VFD (attendance)
  'big.label'?: string;
  'big.sub'?: string;
  'big.value'?: string;
  // Footer — ticker
  'ticker.tag'?: string;
  'ticker.m0'?: string;
  'ticker.m1'?: string;
  'ticker.m2'?: string;
  'ticker.m3'?: string;
  'ticker.m4'?: string;
  'ticker.m5'?: string;
  'ticker.m6'?: string;
  'ticker.callsign'?: string;
}

export const DEFAULTS: Required<MsStudioPortraitConfig> = {
  // HUD — ON AIR cabochon
  'status.label': 'ON AIR',
  // HUD — school lockup
  'school.eye': '★ Otter Radio · Ep. 142',
  'school.name': 'WESTRIDGE',
  'school.callsign': '.MS',
  'school.team': '88.7 FM · House Otters',
  'school.day': 'Day B',
  // HUD — meta tiles
  'clock.label': 'Studio Time',
  'clock.time': '7:53',
  'weather.label': 'Outside',
  'weather.temp': '46°',
  'countdown.label': 'Field Day',
  'countdown.value': '12d',
  // Hero — broadcast poster
  'greeting.episode': '● Morning Show · Episode 142',
  'greeting.h1': 'GOOD',
  'greeting.h2': 'MORNING.',
  'greeting.subtitle':
    "Broadcasting live from the front office. First bell at 08:05. Mr. Nguyen wants journals out for poetry in P2 — you heard it here first. Up next: science lab, mile run, and the greatest chicken & rice the cafeteria's ever cooked.",
  'greeting.c0': '● Live mic on',
  'greeting.c1': '● Cue sheet',
  'greeting.c2': '● Phone lines',
  'greeting.c3': '● Standby',
  // Hero — turntable feature
  'feature.eye': '▼ Studer · 33⅓',
  'feature.label': 'Now Spinning · A-Side',
  'feature.title': 'Spring Band Concert',
  'feature.sub': 'Wed · 7 PM',
  'feature.nw': '▶ Spotlight · Spring Band Concert',
  'feature.tag': '04 · "Echoes"',
  // VU meter
  'vu.k': '▼ Master Output',
  'vu.v': '+3 dB',
  'vu.feet0': 'Peak / RMS',
  'vu.feet1': '88.7 FM',
  // Mixer
  'mixer.k': 'Channel Faders',
  'mixer.v': '4 / 4 Hot',
  'mixer.s0': 'Mic · Ch 1',
  'mixer.s1': 'Deck · Ch 2',
  'mixer.s2': 'Band · Ch 3',
  'mixer.s3': 'FX · Ch 4',
  // Lineup — header
  'segments.title': "Today's",
  'segments.subtitle': 'Lineup',
  'segments.meta': 'Day B · 6 segments queued',
  'segments.metar': 'On schedule',
  // Lineup — tapes
  'segments.0.n': 'Side A · Track 01 · P1',
  'segments.0.t': 'Math 7 · Ms. Patel',
  'segments.0.host': 'Rm 214',
  'segments.0.time': '8:05 — 8:55 · DONE · 50 MIN',
  'segments.1.n': '★ ON AIR · Track 02 · P2',
  'segments.1.t': 'English Poetry · Mr. Nguyen',
  'segments.1.host': 'Rm 108',
  'segments.1.time': '9:00 — 9:50 · LIVE · RM 108',
  'segments.2.n': 'Side A · Track 03 · P3',
  'segments.2.t': 'Science Lab · Ms. Okafor',
  'segments.2.host': 'Rm 207',
  'segments.2.time': '9:55 — 10:45 · UP NEXT · RM 207',
  'segments.3.n': 'Side B · Track 04 · P4',
  'segments.3.t': 'PE — Mile Run · Coach Reyes',
  'segments.3.host': 'Gym A',
  'segments.3.time': '10:50 — 11:40 · LATER · GYM A',
  // Footer — slate
  'announcement.tag': 'Breaking',
  'announcement.message':
    'Picture day moved to Thursday — full uniform. Permission slips to front office by Wednesday.',
  'announcement.when_eye': 'All Day',
  'announcement.when': 'THU',
  // Footer — VFD
  'big.label': 'Otters Here',
  'big.sub': '98.2% attendance',
  'big.value': '1,217',
  // Footer — ticker
  'ticker.tag': '▶ Now Playing',
  'ticker.m0': 'Substitute teacher in Rm B-12',
  'ticker.m1': 'Spelling bee sign-ups end Friday',
  'ticker.m2': '8th grade field trip forms due tomorrow',
  'ticker.m3': 'Library returns due this week',
  'ticker.m4': 'Lost blue water bottle → front office',
  'ticker.m5': 'Robotics Club · 3 PM · Rm 207',
  'ticker.m6': 'Bus 14 running +10 min',
  'ticker.callsign': '88.7 FM · WMS',
};

/** "Empty string in editor → fall back to demo copy" — same convention
 * as the landscape sibling so a single config can drive both orientations. */
const pickStatic = <K extends keyof Required<MsStudioPortraitConfig>>(
  cfg: MsStudioPortraitConfig,
  key: K,
): string => {
  const v = cfg[key];
  return (v === undefined || v === '' ? DEFAULTS[key] : v) as string;
};

export function MsStudioPortraitWidget({
  config,
  live,
}: {
  config?: MsStudioPortraitConfig; live?: boolean
}) {
  const cfg = config || {};
  // Live clock + weather. Operator-typed values still WIN — the hook
  // is the FALLBACK for fields the teacher hasn't customized.
  const { now, weather } = useLiveTemplateData({
    live,
    weatherLocation: (cfg as any).weatherLocation,
    weatherUnits: (cfg as any).weatherUnits,
    weatherOverride: cfg['weather.temp'],
  });

  const pick = <K extends keyof Required<MsStudioPortraitConfig>>(key: K): string => {
    const v = cfg[key];
    if (v !== undefined && v !== '') return v as string;
    if (live) {
      if (key === 'clock.time') return fmt.time12NoSuffix(now);
      if (key === 'weather.temp' && weather) return `${weather.tempF}°`;
    }
    return DEFAULTS[key] as string;
  };

  // Per-tape modifier class (matches landscape: tape 0 done, tape 1 live).
  type TapeKey = 0 | 1 | 2 | 3;
  const tapeClass: Record<TapeKey, string> = {
    0: 'ms-st-p-done',
    1: 'ms-st-p-live',
    2: '',
    3: '',
  };

  return (
    <HsStage
      width={2160}
      height={3840}
      stageStyle={{
        background: '#1b1410',
        backgroundImage: [
          'radial-gradient(circle at 50% 0%, rgba(244,185,66,.06), transparent 60%)',
          'repeating-linear-gradient(45deg, rgba(255,255,255,.012) 0 18px, transparent 18px 36px)',
          'repeating-linear-gradient(-45deg, rgba(0,0,0,.18) 0 18px, transparent 18px 36px)',
        ].join(', '),
        fontFamily: "'Archivo', system-ui, sans-serif",
        color: '#f6f1e8',
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* Faint scanline overlay (mockup paints on .stage::before). */}
      <div className="ms-st-p-scanlines" aria-hidden="true" />

      {/* ─── HUD: ON AIR + lockup, then 3 meta tiles row ───────── */}
      <header className="ms-st-p-hud">
        <div className="ms-st-p-hud-top">
          <div className="ms-st-p-onair" data-widget="status" aria-label="On Air">
            <span className="ms-st-p-onair-dot" aria-hidden="true" />
            <span className="ms-st-p-onair-text" data-field="status.label" style={{ whiteSpace: 'pre-wrap' }}>
              {pick('status.label')
                .split(/\s+/)
                .map((w, i, arr) => (
                  <React.Fragment key={i}>
                    {w}
                    {i < arr.length - 1 ? <br /> : null}
                  </React.Fragment>
                ))}
            </span>
          </div>

          <div className="ms-st-p-lockup" data-widget="school">
            <div className="ms-st-p-eye" data-field="school.eye" style={{ whiteSpace: 'pre-wrap' }}>
              {pick('school.eye')}
            </div>
            <div className="ms-st-p-name">
              <span data-field="school.name" style={{ whiteSpace: 'pre-wrap' }}>{pick('school.name')}</span>
              <b data-field="school.callsign" style={{ whiteSpace: 'pre-wrap' }}>{pick('school.callsign')}</b>
            </div>
            <div className="ms-st-p-freq">
              <span data-field="school.team" style={{ whiteSpace: 'pre-wrap' }}>{pick('school.team')}</span>
              {' · '}
              <b data-field="school.day" style={{ whiteSpace: 'pre-wrap' }}>{pick('school.day')}</b>
            </div>
          </div>
        </div>

        <div className="ms-st-p-hud-meta">
          <div className="ms-st-p-mt" data-widget="clock">
            <span className="ms-st-p-mt-k" data-field="clock.label" style={{ whiteSpace: 'pre-wrap' }}>
              {pick('clock.label')}
            </span>
            <span className="ms-st-p-mt-v" data-field="clock.time" style={{ whiteSpace: 'pre-wrap' }}>
              {pick('clock.time')}
            </span>
          </div>
          <div className="ms-st-p-mt ms-st-p-warm" data-widget="weather">
            <span className="ms-st-p-mt-k" data-field="weather.label" style={{ whiteSpace: 'pre-wrap' }}>
              {pick('weather.label')}
            </span>
            <span className="ms-st-p-mt-v" data-field="weather.temp" style={{ whiteSpace: 'pre-wrap' }}>
              {pick('weather.temp')}
            </span>
          </div>
          <div className="ms-st-p-mt ms-st-p-cool" data-widget="countdown">
            <span className="ms-st-p-mt-k" data-field="countdown.label" style={{ whiteSpace: 'pre-wrap' }}>
              {pick('countdown.label')}
            </span>
            <span className="ms-st-p-mt-v" data-field="countdown.value" style={{ whiteSpace: 'pre-wrap' }}>
              {pick('countdown.value')}
            </span>
          </div>
        </div>
      </header>

      {/* ─── HERO — episode ribbon + headline + waveform + lede + chips ── */}
      <section className="ms-st-p-hero" data-widget="greeting">
        <span className="ms-st-p-ribbon" data-field="greeting.episode" style={{ whiteSpace: 'pre-wrap' }}>
          {pick('greeting.episode')}
        </span>
        <h1 className="ms-st-p-h1">
          <span data-field="greeting.h1" style={{ whiteSpace: 'pre-wrap' }}>{pick('greeting.h1')}</span>{' '}
          <em data-field="greeting.h2" style={{ whiteSpace: 'pre-wrap' }}>{pick('greeting.h2')}</em>
        </h1>
        <div className="ms-st-p-waveform" aria-hidden="true">
          <i /><i /><i /><i /><i /><i /><i /><i />
          <i /><i /><i /><i /><i /><i /><i /><i />
          <i /><i /><i /><i /><i /><i /><i /><i />
        </div>
        <p className="ms-st-p-lede" data-field="greeting.subtitle" style={{ whiteSpace: 'pre-wrap' }}>
          {pick('greeting.subtitle')}
        </p>
        <div className="ms-st-p-chips">
          <span data-field="greeting.c0" style={{ whiteSpace: 'pre-wrap' }}>{pick('greeting.c0')}</span>
          <span data-field="greeting.c1" style={{ whiteSpace: 'pre-wrap' }}>{pick('greeting.c1')}</span>
          <span data-field="greeting.c2" style={{ whiteSpace: 'pre-wrap' }}>{pick('greeting.c2')}</span>
          <span data-field="greeting.c3" style={{ whiteSpace: 'pre-wrap' }}>{pick('greeting.c3')}</span>
        </div>
      </section>

      {/* ─── TURN+VU — side-by-side instruments row ─────────────── */}
      <section className="ms-st-p-turnvu">
        <div className="ms-st-p-turntable" data-widget="feature">
          <div className="ms-st-p-tt-eye" data-field="feature.eye" style={{ whiteSpace: 'pre-wrap' }}>
            {pick('feature.eye')}
          </div>
          <div className="ms-st-p-tt-stamp" data-field="feature.label" style={{ whiteSpace: 'pre-wrap' }}>
            {pick('feature.label')}
          </div>
          <div className="ms-st-p-platter" aria-hidden="true" />
          <div className="ms-st-p-tonearm" aria-hidden="true" />
          <div className="ms-st-p-now-spinning" data-field="feature.nw" style={{ whiteSpace: 'pre-wrap' }}>
            {pick('feature.nw')}
          </div>
        </div>
        <div className="ms-st-p-vumeter" data-widget="vu">
          <div className="ms-st-p-vu-eye" data-field="vu.k" style={{ whiteSpace: 'pre-wrap' }}>
            {pick('vu.k')}
          </div>
          <div className="ms-st-p-vu-stamp" data-field="vu.v" style={{ whiteSpace: 'pre-wrap' }}>
            {pick('vu.v')}
          </div>
          <div className="ms-st-p-vu-face" aria-hidden="true">
            <div className="ms-st-p-vu-ticks" />
            <div className="ms-st-p-vu-needle" />
          </div>
          <div className="ms-st-p-vu-readout">−20 −10 −5 0 +1 +3 +5 ▲</div>
        </div>
      </section>

      {/* ─── MIXER — 4-strip horizontal console ─────────────────── */}
      <section className="ms-st-p-mixer" data-widget="mixer">
        <div className="ms-st-p-strip">
          <div className="ms-st-p-knob" />
          <div className="ms-st-p-leds">
            <b className="ms-st-p-on" />
            <b className="ms-st-p-on" />
            <b className="ms-st-p-hot" />
            <b />
            <b />
          </div>
          <div className="ms-st-p-fader" />
          <div className="ms-st-p-label" data-field="mixer.s0" style={{ whiteSpace: 'pre-wrap' }}>
            {pick('mixer.s0')}
          </div>
        </div>
        <div className="ms-st-p-strip">
          <div className="ms-st-p-knob" style={{ transform: 'rotate(60deg)' }} />
          <div className="ms-st-p-leds">
            <b className="ms-st-p-on" />
            <b className="ms-st-p-on" />
            <b className="ms-st-p-on" />
            <b className="ms-st-p-hot" />
            <b />
          </div>
          <div className="ms-st-p-fader" />
          <div className="ms-st-p-label" data-field="mixer.s1" style={{ whiteSpace: 'pre-wrap' }}>
            {pick('mixer.s1')}
          </div>
        </div>
        <div className="ms-st-p-strip">
          <div className="ms-st-p-knob" style={{ transform: 'rotate(-30deg)' }} />
          <div className="ms-st-p-leds">
            <b className="ms-st-p-on" />
            <b className="ms-st-p-on" />
            <b className="ms-st-p-on" />
            <b className="ms-st-p-on" />
            <b className="ms-st-p-peak" />
          </div>
          <div className="ms-st-p-fader" />
          <div className="ms-st-p-label" data-field="mixer.s2" style={{ whiteSpace: 'pre-wrap' }}>
            {pick('mixer.s2')}
          </div>
        </div>
        <div className="ms-st-p-strip">
          <div className="ms-st-p-knob" style={{ transform: 'rotate(20deg)' }} />
          <div className="ms-st-p-leds">
            <b className="ms-st-p-on" />
            <b className="ms-st-p-on" />
            <b />
            <b />
            <b />
          </div>
          <div className="ms-st-p-fader" />
          <div className="ms-st-p-label" data-field="mixer.s3" style={{ whiteSpace: 'pre-wrap' }}>
            {pick('mixer.s3')}
          </div>
        </div>
      </section>

      {/* ─── LINEUP — 4 cassettes stacked vertically ─────────────── */}
      <section className="ms-st-p-lineup" data-widget="segments">
        <div className="ms-st-p-lineup-head">
          <h2 className="ms-st-p-lineup-h2">
            <span data-field="segments.title" style={{ whiteSpace: 'pre-wrap' }}>{pick('segments.title')}</span>{' '}
            <em data-field="segments.subtitle" style={{ whiteSpace: 'pre-wrap' }}>{pick('segments.subtitle')}</em>
          </h2>
          <span className="ms-st-p-lineup-meta">
            <span data-field="segments.meta" style={{ whiteSpace: 'pre-wrap' }}>{pick('segments.meta')}</span>
            {' · '}
            <b data-field="segments.metar" style={{ whiteSpace: 'pre-wrap' }}>{pick('segments.metar')}</b>
          </span>
        </div>

        <div className="ms-st-p-tapes">
          {([0, 1, 2, 3] as const).map((i) => {
            const cls = `ms-st-p-tape ${tapeClass[i]}`.trim();
            return (
              <div key={i} className={cls} data-widget={`segments.${i}`}>
                <div className="ms-st-p-label-block">
                  <div
                    className="ms-st-p-label-top"
                    data-field={`segments.${i}.n`}
                   style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(
                            `segments.${i}.n` as keyof Required<MsStudioPortraitConfig>,
                    )}
                  </div>
                  <div
                    className="ms-st-p-label-name"
                    data-field={`segments.${i}.t`}
                   style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(
                            `segments.${i}.t` as keyof Required<MsStudioPortraitConfig>,
                    )}
                  </div>
                </div>
                <div className="ms-st-p-reels" aria-hidden="true">
                  <div className="ms-st-p-reel" />
                  <div className="ms-st-p-reel" />
                </div>
                <div className="ms-st-p-tape-meta">
                  <b data-field={`segments.${i}.time`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(
                            `segments.${i}.time` as keyof Required<MsStudioPortraitConfig>,
                    )}
                  </b>
                  <span data-field={`segments.${i}.host`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(
                            `segments.${i}.host` as keyof Required<MsStudioPortraitConfig>,
                    )}
                  </span>
                </div>
                {i === 1 ? <div className="ms-st-p-now-pip">NOW PLAYING</div> : null}
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── FOOTER — single combined bar (slate + VFD top, ticker bottom) ─ */}
      <section className="ms-st-p-footer">
        <div className="ms-st-p-footer-top">
          <div className="ms-st-p-slate" data-widget="announcement">
            <span className="ms-st-p-slate-tag">
              <span data-field="announcement.tag" style={{ whiteSpace: 'pre-wrap' }}>{pick('announcement.tag')}</span>
            </span>
            <span className="ms-st-p-slate-msg" data-field="announcement.message" style={{ whiteSpace: 'pre-wrap' }}>
              {pick('announcement.message')}
            </span>
            <span className="ms-st-p-slate-when">
              <span data-field="announcement.when" style={{ whiteSpace: 'pre-wrap' }}>{pick('announcement.when')}</span>
              <span data-field="announcement.when_eye" style={{ whiteSpace: 'pre-wrap' }}>{pick('announcement.when_eye')}</span>
            </span>
          </div>

          <div className="ms-st-p-vfd" data-widget="big">
            <div className="ms-st-p-vfd-info">
              <div className="ms-st-p-vfd-k" data-field="big.label" style={{ whiteSpace: 'pre-wrap' }}>
                {pick('big.label')}
              </div>
              <div className="ms-st-p-vfd-s" data-field="big.sub" style={{ whiteSpace: 'pre-wrap' }}>
                {pick('big.sub')}
              </div>
            </div>
            <div className="ms-st-p-vfd-v" data-field="big.value" style={{ whiteSpace: 'pre-wrap' }}>
              {pick('big.value')}
            </div>
          </div>
        </div>

        <div className="ms-st-p-ticker" data-widget="ticker">
          <div className="ms-st-p-ticker-badge" data-field="ticker.tag" style={{ whiteSpace: 'pre-wrap' }}>
            {pick('ticker.tag')}
          </div>
          <div className="ms-st-p-ticker-feed">
            <div className="ms-st-p-ticker-feed-inner">
              <span data-field="ticker.m0" style={{ whiteSpace: 'pre-wrap' }}>{pick('ticker.m0')}</span>
              <span data-field="ticker.m1" style={{ whiteSpace: 'pre-wrap' }}>{pick('ticker.m1')}</span>
              <span data-field="ticker.m2" style={{ whiteSpace: 'pre-wrap' }}>{pick('ticker.m2')}</span>
              <span data-field="ticker.m3" style={{ whiteSpace: 'pre-wrap' }}>{pick('ticker.m3')}</span>
              <span data-field="ticker.m4" style={{ whiteSpace: 'pre-wrap' }}>{pick('ticker.m4')}</span>
              <span data-field="ticker.m5" style={{ whiteSpace: 'pre-wrap' }}>{pick('ticker.m5')}</span>
              <span data-field="ticker.m6" style={{ whiteSpace: 'pre-wrap' }}>{pick('ticker.m6')}</span>
              <span aria-hidden="true">{pick('ticker.m0')}</span>
              <span aria-hidden="true">{pick('ticker.m1')}</span>
              <span aria-hidden="true">{pick('ticker.m2')}</span>
              <span aria-hidden="true">{pick('ticker.m3')}</span>
              <span aria-hidden="true">{pick('ticker.m4')}</span>
              <span aria-hidden="true">{pick('ticker.m5')}</span>
              <span aria-hidden="true">{pick('ticker.m6')}</span>
            </div>
          </div>
          <div className="ms-st-p-ticker-end" data-field="ticker.callsign" style={{ whiteSpace: 'pre-wrap' }}>
            {pick('ticker.callsign')}
          </div>
        </div>
      </section>
    </HsStage>
  );
}

/** Inlined CSS — every pixel value matches scratch/design/studio-ms-portrait-v1.html. */
const CSS = `
/* Box-sizing border-box on every panel that sets explicit width.
   Without it the lineup column drifts past the right edge. */
.ms-st-p-hud, .ms-st-p-hud-top, .ms-st-p-hud-meta, .ms-st-p-mt,
.ms-st-p-onair, .ms-st-p-lockup,
.ms-st-p-hero, .ms-st-p-ribbon, .ms-st-p-chips,
.ms-st-p-turnvu, .ms-st-p-turntable, .ms-st-p-vumeter, .ms-st-p-vu-face,
.ms-st-p-mixer, .ms-st-p-strip, .ms-st-p-fader,
.ms-st-p-lineup, .ms-st-p-tapes, .ms-st-p-tape, .ms-st-p-label-block,
.ms-st-p-footer, .ms-st-p-footer-top, .ms-st-p-slate, .ms-st-p-vfd,
.ms-st-p-ticker {
  box-sizing: border-box;
}

/* Faint scanline overlay (mockup paints on .stage::before). */
.ms-st-p-scanlines {
  position: absolute; inset: 0; pointer-events: none; z-index: 1;
  background: repeating-linear-gradient(0deg, transparent 0 3px, rgba(0,0,0,.12) 3px 4px);
}

/* ─── HUD — top: ON AIR cabochon + school + 3 meta tiles ─── */
.ms-st-p-hud {
  position: absolute; top: 56px; left: 64px; right: 64px; height: 360px;
  display: flex; flex-direction: column; gap: 24px; overflow: hidden;
  z-index: 4;
}
.ms-st-p-hud-top {
  display: grid; grid-template-columns: auto 1fr; gap: 36px; align-items: center;
}

/* ON AIR cabochon */
.ms-st-p-onair {
  width: 220px; height: 200px; position: relative;
  background: linear-gradient(180deg, #e63946 0%, #c2293a 100%);
  border: 5px solid #1a0608; border-radius: 12px;
  box-shadow:
    inset 0 6px 14px rgba(255,180,180,.4),
    inset 0 -8px 18px rgba(0,0,0,.55),
    0 8px 22px rgba(230,57,70,.4);
  display: grid; place-items: center;
}
.ms-st-p-onair-dot {
  position: absolute; top: 14px; left: 14px;
  width: 16px; height: 16px; border-radius: 50%; background: #fff;
  box-shadow: 0 0 12px #fff;
  animation: msStPPulse 1.4s ease-in-out infinite;
}
@keyframes msStPPulse {
  0%,100% { opacity: 1; transform: scale(1); }
  50%     { opacity: .55; transform: scale(.86); }
}
.ms-st-p-onair-text {
  font-family: 'Anton', sans-serif; font-size: 86px; line-height: .85;
  color: #fff; letter-spacing: .04em; text-align: center;
  text-shadow: 0 2px 0 #1a0608;
}

/* School lockup */
.ms-st-p-lockup { min-width: 0; }
.ms-st-p-eye {
  font-family: 'DM Mono', monospace; font-size: 30px; font-weight: 700;
  letter-spacing: .26em; text-transform: uppercase; color: #f4b942;
}
.ms-st-p-name {
  font-family: 'Anton', sans-serif; font-size: 144px; line-height: .9;
  color: #f6f1e8; letter-spacing: .01em; margin-top: 14px;
}
.ms-st-p-name b { color: #e63946; font-weight: normal; }
.ms-st-p-freq {
  font-family: 'DM Mono', monospace; font-size: 32px; font-weight: 700;
  color: #4dd0e1; margin-top: 14px; letter-spacing: .2em;
  display: inline-flex; align-items: center; gap: 14px;
}
.ms-st-p-freq::before {
  content: ''; width: 28px; height: 14px;
  background: repeating-linear-gradient(90deg, #4dd0e1 0 4px, transparent 4px 8px);
}
.ms-st-p-freq b { color: #4dd0e1; font-weight: 700; }

/* Three meta tiles row */
.ms-st-p-hud-meta {
  display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px;
  flex: 1; min-height: 0;
}
.ms-st-p-mt {
  background: linear-gradient(180deg, #2a2520 0%, #14110e 100%);
  border: 4px solid #4a3a30; border-radius: 8px;
  padding: 20px 28px;
  display: flex; flex-direction: column; justify-content: center; gap: 8px;
  box-shadow:
    inset 0 4px 10px rgba(255,235,180,.06),
    inset 0 -6px 14px rgba(0,0,0,.5);
  overflow: hidden;
}
.ms-st-p-mt-k {
  font-family: 'DM Mono', monospace; font-size: 22px; font-weight: 700;
  letter-spacing: .26em; text-transform: uppercase; color: #c0a060;
}
.ms-st-p-mt-v {
  font-family: 'Anton', sans-serif; font-size: 110px; line-height: 1;
  color: #f6f1e8; letter-spacing: -.005em;
}
.ms-st-p-mt.ms-st-p-warm .ms-st-p-mt-v {
  color: #f4b942; text-shadow: 0 0 16px rgba(244,185,66,.4);
}
.ms-st-p-mt.ms-st-p-cool .ms-st-p-mt-v {
  color: #4dd0e1; text-shadow: 0 0 14px rgba(77,208,225,.5);
}

/* ─── HERO — GOOD MORNING + waveform + lede + chips ─── */
.ms-st-p-hero {
  position: absolute; top: 436px; left: 64px; right: 64px; height: 1100px;
  background: linear-gradient(180deg, #2a2024 0%, #1a1318 100%);
  border: 5px solid #1a0608; border-radius: 12px;
  box-shadow: 0 16px 40px rgba(0,0,0,.55);
  padding: 60px 80px; overflow: hidden;
  z-index: 3;
}
.ms-st-p-ribbon {
  display: inline-block;
  background: linear-gradient(90deg, #e63946 0%, #c2293a 100%);
  color: #fff;
  font-family: 'DM Mono', monospace; font-size: 30px; font-weight: 700;
  padding: 14px 28px; letter-spacing: .2em; text-transform: uppercase;
  border: 3px solid #1a0608; box-shadow: 6px 6px 0 #1a0608;
  margin-bottom: 36px;
}
.ms-st-p-h1 {
  font-family: 'Anton', sans-serif; font-size: 320px; line-height: .9;
  color: #f6f1e8; margin: 0; letter-spacing: -.01em; text-transform: uppercase;
}
.ms-st-p-h1 em {
  font-style: normal; color: #e63946;
  text-shadow: 0 0 36px rgba(230,57,70,.45);
}

/* Animated waveform — 24 vertical bars */
.ms-st-p-waveform {
  display: flex; align-items: flex-end; gap: 10px; margin-top: 44px;
  height: 110px;
}
.ms-st-p-waveform i {
  flex: 1;
  background: linear-gradient(180deg, #4dd0e1 0%, #2880a0 100%);
  border-radius: 4px;
  box-shadow: 0 0 12px rgba(77,208,225,.5);
  animation: msStPWave 1.6s ease-in-out infinite;
}
@keyframes msStPWave {
  0%,100% { height: 30%; opacity: .65; }
  50%     { height: 100%; opacity: 1; }
}
.ms-st-p-waveform i:nth-child(1)  { animation-delay: .00s; }
.ms-st-p-waveform i:nth-child(2)  { animation-delay: .07s; }
.ms-st-p-waveform i:nth-child(3)  { animation-delay: .14s; }
.ms-st-p-waveform i:nth-child(4)  { animation-delay: .21s; }
.ms-st-p-waveform i:nth-child(5)  { animation-delay: .28s; }
.ms-st-p-waveform i:nth-child(6)  { animation-delay: .35s; }
.ms-st-p-waveform i:nth-child(7)  { animation-delay: .42s; }
.ms-st-p-waveform i:nth-child(8)  { animation-delay: .49s; }
.ms-st-p-waveform i:nth-child(9)  { animation-delay: .56s; }
.ms-st-p-waveform i:nth-child(10) { animation-delay: .63s; }
.ms-st-p-waveform i:nth-child(11) { animation-delay: .70s; }
.ms-st-p-waveform i:nth-child(12) { animation-delay: .77s; }
.ms-st-p-waveform i:nth-child(13) { animation-delay: .84s; }
.ms-st-p-waveform i:nth-child(14) { animation-delay: .91s; }
.ms-st-p-waveform i:nth-child(15) { animation-delay: .98s; }
.ms-st-p-waveform i:nth-child(16) { animation-delay: 1.05s; }
.ms-st-p-waveform i:nth-child(17) { animation-delay: 1.12s; }
.ms-st-p-waveform i:nth-child(18) { animation-delay: 1.19s; }
.ms-st-p-waveform i:nth-child(19) { animation-delay: 1.26s; }
.ms-st-p-waveform i:nth-child(20) { animation-delay: 1.33s; }
.ms-st-p-waveform i:nth-child(21) { animation-delay: 1.40s; }
.ms-st-p-waveform i:nth-child(22) { animation-delay: 1.47s; }
.ms-st-p-waveform i:nth-child(23) { animation-delay: 1.54s; }
.ms-st-p-waveform i:nth-child(24) { animation-delay: 1.61s; }

.ms-st-p-lede {
  font-family: 'Archivo', sans-serif; font-weight: 600;
  font-size: 60px; line-height: 1.25;
  color: #d8d2c4; margin: 36px 0 0; max-width: 1820px;
}
.ms-st-p-lede b { color: #f4b942; font-weight: 800; }
.ms-st-p-lede em { color: #4dd0e1; font-style: normal; font-weight: 800; }

.ms-st-p-chips {
  display: flex; gap: 18px; flex-wrap: wrap; margin-top: 36px;
}
.ms-st-p-chips span {
  font-family: 'DM Mono', monospace; font-size: 28px; font-weight: 700;
  background: rgba(0,0,0,.5); color: #f4b942; border: 2px solid #4a3a30;
  padding: 14px 24px; letter-spacing: .14em; text-transform: uppercase;
}

/* ─── TURNTABLE + VU METER row (side-by-side) ─── */
.ms-st-p-turnvu {
  position: absolute; top: 1556px; left: 64px; right: 64px; height: 700px;
  display: grid; grid-template-columns: 1fr 1fr; gap: 24px;
  z-index: 3;
}
.ms-st-p-turntable {
  position: relative;
  background: linear-gradient(180deg, #4a2818 0%, #1f1108 100%);
  border: 5px solid #1a0608; border-radius: 12px;
  box-shadow:
    inset 0 8px 24px rgba(255,180,120,.08),
    inset 0 -10px 30px rgba(0,0,0,.6),
    0 16px 40px rgba(0,0,0,.55);
  padding: 32px; overflow: hidden;
}
.ms-st-p-tt-eye {
  position: absolute; top: 32px; left: 32px;
  font-family: 'DM Mono', monospace; font-size: 24px; font-weight: 700;
  letter-spacing: .24em; text-transform: uppercase; color: #c0a060;
  z-index: 2;
}
.ms-st-p-tt-stamp {
  position: absolute; top: 32px; right: 32px;
  font-family: 'DM Mono', monospace; font-size: 22px; font-weight: 700;
  letter-spacing: .22em; text-transform: uppercase; color: #c0a060;
  z-index: 2;
}
.ms-st-p-platter {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: 460px; height: 460px; border-radius: 50%;
  background:
    radial-gradient(circle at 50% 50%, #1a1010 0%, #0a0606 60%, #050202 100%),
    repeating-conic-gradient(from 0deg, rgba(255,255,255,.02) 0deg 1deg, transparent 1deg 4deg);
  border: 6px solid #2a1408;
  box-shadow:
    inset 0 0 60px rgba(0,0,0,.8),
    0 14px 40px rgba(0,0,0,.55);
  animation: msStPSpin 4s linear infinite;
}
@keyframes msStPSpin { to { transform: translate(-50%, -50%) rotate(360deg); } }
.ms-st-p-platter::before {
  content: ''; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: 180px; height: 180px; border-radius: 50%;
  background: radial-gradient(circle at 38% 38%, #f4b942 0%, #c8901c 70%, #6a4810 100%);
  border: 3px solid #1a0608;
  box-shadow: inset 0 -8px 14px rgba(0,0,0,.4);
}
.ms-st-p-platter::after {
  content: ''; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: 12px; height: 12px; border-radius: 50%; background: #1a0608;
}
.ms-st-p-tonearm {
  position: absolute; top: 64px; right: 56px;
  width: 360px; height: 16px;
  background: linear-gradient(180deg, #d0c8b0 0%, #806a48 100%);
  border-radius: 8px; transform-origin: 100% 50%;
  transform: rotate(-32deg);
  box-shadow: 0 4px 10px rgba(0,0,0,.6);
  z-index: 3;
}
.ms-st-p-tonearm::before {
  /* counterweight at the right end */
  content: ''; position: absolute; right: -28px; top: -16px;
  width: 56px; height: 48px; background: #2a2520;
  border: 3px solid #1a0608; border-radius: 6px;
}
.ms-st-p-tonearm::after {
  /* needle at the left end */
  content: ''; position: absolute; left: 0; top: -8px;
  width: 24px; height: 32px; background: #1a0608;
  clip-path: polygon(0 0, 100% 0, 50% 100%);
}
.ms-st-p-now-spinning {
  position: absolute; bottom: 32px; left: 32px;
  font-family: 'Bebas Neue', 'Anton', sans-serif; font-size: 36px;
  color: #4dd0e1; letter-spacing: .14em; text-transform: uppercase;
  text-shadow: 0 0 14px rgba(77,208,225,.5); z-index: 2;
}

/* VU meter side */
.ms-st-p-vumeter {
  position: relative;
  background: linear-gradient(180deg, #2a2520 0%, #14110e 100%);
  border: 5px solid #1a0608; border-radius: 12px;
  box-shadow:
    inset 0 6px 18px rgba(255,235,180,.05),
    inset 0 -10px 24px rgba(0,0,0,.7),
    0 16px 40px rgba(0,0,0,.55);
  padding: 32px; overflow: hidden;
}
.ms-st-p-vu-eye {
  font-family: 'DM Mono', monospace; font-size: 24px; font-weight: 700;
  letter-spacing: .24em; text-transform: uppercase; color: #c0a060;
}
.ms-st-p-vu-stamp {
  position: absolute; top: 32px; right: 32px;
  font-family: 'DM Mono', monospace; font-size: 26px; font-weight: 700;
  color: #4dd0e1; letter-spacing: .18em;
}

/* VU arc — half-circle */
.ms-st-p-vu-face {
  position: absolute; bottom: 32px; left: 50%; transform: translateX(-50%);
  width: 580px; height: 290px;
  background: radial-gradient(circle at 50% 100%, #f4b942 0%, #c8901c 70%, #5a3a08 100%);
  border-top-left-radius: 290px; border-top-right-radius: 290px;
  border: 4px solid #1a0608;
  overflow: hidden;
  box-shadow: inset 0 -20px 40px rgba(0,0,0,.5);
}
.ms-st-p-vu-face::before {
  /* peak red zone */
  content: ''; position: absolute; top: 0; right: 0;
  width: 40%; height: 100%;
  background: linear-gradient(135deg, transparent 0%, rgba(230,57,70,.5) 100%);
  border-top-right-radius: 290px;
}
.ms-st-p-vu-ticks {
  position: absolute; inset: 14px;
  background:
    conic-gradient(from 270deg at 50% 100%,
      transparent 0deg, transparent 8deg,
      #1a0608 8deg, #1a0608 9.4deg,
      transparent 9.4deg, transparent 26.6deg,
      #1a0608 26.6deg, #1a0608 28deg,
      transparent 28deg, transparent 45deg,
      #1a0608 45deg, #1a0608 46.4deg,
      transparent 46.4deg, transparent 63.4deg,
      #1a0608 63.4deg, #1a0608 64.8deg,
      transparent 64.8deg, transparent 81.8deg,
      #1a0608 81.8deg, #1a0608 83.2deg,
      transparent 83.2deg);
}
.ms-st-p-vu-needle {
  position: absolute; bottom: 0; left: 50%;
  width: 4px; height: 240px; background: #1a0608;
  transform-origin: 50% 100%; transform: translateX(-50%) rotate(28deg);
  box-shadow: 0 0 8px rgba(0,0,0,.5);
  animation: msStPNeedle 2.4s ease-in-out infinite;
}
@keyframes msStPNeedle {
  0%,100% { transform: translateX(-50%) rotate(18deg); }
  50%     { transform: translateX(-50%) rotate(40deg); }
}
.ms-st-p-vu-readout {
  position: absolute; bottom: 16px; left: 0; right: 0; text-align: center;
  font-family: 'DM Mono', monospace; font-size: 24px; font-weight: 700;
  color: #1a0608; letter-spacing: .18em;
}

/* ─── MIXER — 4-strip horizontal console ─── */
.ms-st-p-mixer {
  position: absolute; top: 2276px; left: 64px; right: 64px; height: 280px;
  background: linear-gradient(180deg, #2a2520 0%, #14110e 100%);
  border: 5px solid #1a0608; border-radius: 12px;
  box-shadow:
    inset 0 6px 14px rgba(255,235,180,.05),
    inset 0 -8px 20px rgba(0,0,0,.6),
    0 14px 36px rgba(0,0,0,.5);
  padding: 28px 36px; overflow: hidden;
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 28px;
  z-index: 3;
}
.ms-st-p-strip {
  position: relative;
  display: flex; flex-direction: column; align-items: center; gap: 14px;
}
.ms-st-p-knob {
  width: 60px; height: 60px; border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #c0a060 0%, #6a4810 70%, #2a1808 100%);
  border: 3px solid #1a0608; box-shadow: 0 4px 8px rgba(0,0,0,.5);
  position: relative;
}
.ms-st-p-knob::before {
  content: ''; position: absolute; top: 6px; left: 50%; transform: translateX(-50%);
  width: 4px; height: 16px; background: #1a0608; border-radius: 2px;
}
.ms-st-p-leds { display: flex; gap: 6px; align-items: center; }
.ms-st-p-leds b {
  width: 12px; height: 12px; border-radius: 50%;
  background: #2a2520; box-shadow: inset 0 1px 2px rgba(0,0,0,.5);
}
.ms-st-p-leds b.ms-st-p-on   { background: #5ff28d; box-shadow: 0 0 10px #5ff28d; }
.ms-st-p-leds b.ms-st-p-hot  { background: #f4b942; box-shadow: 0 0 10px #f4b942; }
.ms-st-p-leds b.ms-st-p-peak { background: #e63946; box-shadow: 0 0 10px #e63946; }
.ms-st-p-fader {
  width: 8px; height: 56px; background: #14110e;
  border: 2px solid #1a0608; border-radius: 4px;
  position: relative; margin-top: 6px;
}
.ms-st-p-fader::before {
  content: ''; position: absolute; left: -16px; right: -16px; top: 16px; height: 12px;
  background: linear-gradient(180deg, #c0a060 0%, #6a4810 100%);
  border: 2px solid #1a0608; border-radius: 3px;
}
.ms-st-p-label {
  font-family: 'DM Mono', monospace; font-size: 22px; font-weight: 700;
  color: #c0a060; letter-spacing: .2em; text-transform: uppercase;
}

/* ─── LINEUP — 4 cassettes stacked vertically ─── */
.ms-st-p-lineup {
  position: absolute; top: 2576px; left: 64px; right: 64px; height: 940px;
  background: linear-gradient(180deg, #1a1318 0%, #0d090d 100%);
  border: 5px solid #2a1f24; border-radius: 12px;
  box-shadow:
    inset 0 8px 20px rgba(244,185,66,.04),
    inset 0 -10px 30px rgba(0,0,0,.6),
    0 18px 50px rgba(0,0,0,.55);
  padding: 24px 36px;
  z-index: 3;
}
.ms-st-p-lineup-head {
  display: flex; justify-content: space-between; align-items: flex-end;
  padding-bottom: 14px; border-bottom: 3px solid rgba(244,185,66,.22);
  margin-bottom: 18px;
}
.ms-st-p-lineup-h2 {
  font-family: 'Anton', sans-serif; font-size: 80px; line-height: 1;
  color: #f6f1e8; margin: 0; letter-spacing: .02em; text-transform: uppercase;
}
.ms-st-p-lineup-h2 em {
  font-style: normal; color: #f4b942;
  text-shadow: 0 0 24px rgba(244,185,66,.4);
}
.ms-st-p-lineup-meta {
  font-family: 'DM Mono', monospace; font-size: 22px; font-weight: 700;
  color: #b9aca0; letter-spacing: .2em; text-transform: uppercase;
}
.ms-st-p-lineup-meta b { color: #4dd0e1; }

.ms-st-p-tapes { display: flex; flex-direction: column; gap: 14px; }
.ms-st-p-tape {
  position: relative; height: 152px;
  background: linear-gradient(180deg, #2a2024 0%, #1a1318 100%);
  border: 3px solid #0a0608; border-radius: 8px;
  box-shadow:
    inset 0 4px 8px rgba(255,255,255,.06),
    inset 0 -6px 12px rgba(0,0,0,.7),
    0 8px 16px rgba(0,0,0,.55);
  overflow: hidden;
  display: grid; grid-template-columns: auto 1fr auto auto; gap: 32px;
  align-items: center; padding: 16px 28px;
}
.ms-st-p-tape::before {
  /* shell screws */
  content: ''; position: absolute; inset: 0;
  background:
    radial-gradient(circle at 14px 14px,            #4a4744 2.5px, transparent 3.5px),
    radial-gradient(circle at calc(100% - 14px) 14px, #4a4744 2.5px, transparent 3.5px),
    radial-gradient(circle at 14px calc(100% - 14px), #4a4744 2.5px, transparent 3.5px),
    radial-gradient(circle at calc(100% - 14px) calc(100% - 14px), #4a4744 2.5px, transparent 3.5px);
  pointer-events: none;
}
.ms-st-p-label-block {
  background: linear-gradient(180deg, #f5e8b6 0%, #e8d188 100%);
  border: 2px solid #2a1f10; border-radius: 4px;
  padding: 10px 16px; min-width: 540px;
  color: #1a0e08;
}
.ms-st-p-label-top {
  font-family: 'DM Mono', monospace; font-size: 18px; font-weight: 700;
  letter-spacing: .18em; text-transform: uppercase; color: #6a4810;
}
.ms-st-p-label-name {
  font-family: 'Anton', sans-serif; font-size: 44px; line-height: 1;
  color: #1a0608; letter-spacing: -.005em; margin-top: 4px;
}
.ms-st-p-reels { display: flex; gap: 24px; }
.ms-st-p-reel {
  width: 72px; height: 72px; border-radius: 50%;
  background: radial-gradient(circle at 50% 50%, #2a2024 0%, #14110e 70%);
  border: 3px solid #0a0608;
  position: relative;
  animation: msStPReelSpin 2.4s linear infinite;
}
@keyframes msStPReelSpin { to { transform: rotate(360deg); } }
.ms-st-p-reel::before {
  content: ''; position: absolute; inset: 16px; border-radius: 50%;
  background:
    conic-gradient(#4a4744 0deg 12deg, transparent 12deg 60deg,
                   #4a4744 60deg 72deg, transparent 72deg 120deg,
                   #4a4744 120deg 132deg, transparent 132deg 180deg,
                   #4a4744 180deg 192deg, transparent 192deg 240deg,
                   #4a4744 240deg 252deg, transparent 252deg 300deg,
                   #4a4744 300deg 312deg, transparent 312deg 360deg);
}
.ms-st-p-tape-meta {
  font-family: 'DM Mono', monospace; font-size: 24px; font-weight: 700;
  letter-spacing: .14em; color: #b9aca0;
  text-align: right;
}
.ms-st-p-tape-meta b {
  display: block; color: #f4b942; font-weight: 700; font-size: 28px;
  margin-bottom: 4px;
}

.ms-st-p-tape.ms-st-p-done { opacity: .55; }
.ms-st-p-tape.ms-st-p-done .ms-st-p-reel { animation: none; opacity: .35; }
.ms-st-p-tape.ms-st-p-live {
  border-color: #e63946;
  box-shadow:
    inset 0 4px 12px rgba(255,180,180,.12),
    inset 0 -6px 14px rgba(0,0,0,.7),
    0 8px 20px rgba(230,57,70,.35);
}
.ms-st-p-tape.ms-st-p-live .ms-st-p-now-pip {
  position: absolute; top: 50%; right: 32px;
  transform: translateY(-50%);
  background: #e63946; color: #fff;
  font-family: 'DM Mono', monospace; font-size: 14px; font-weight: 700;
  letter-spacing: .24em;
  padding: 4px 12px; border-radius: 4px;
  box-shadow: 0 0 14px rgba(230,57,70,.6);
  z-index: 5;
}

/* ─── FOOTER — single combined bar ─── */
/* Outer chrome only. Inner zones have NO own border / radius / shadow,
   just background colors separated by 2px inner dividers. */
.ms-st-p-footer {
  position: absolute; top: 3536px; left: 64px; right: 64px; height: 280px;
  background: #14110e;
  border: 4px solid #0a0608; border-radius: 8px;
  box-shadow: 0 14px 36px rgba(0,0,0,.6);
  overflow: hidden;
  display: flex; flex-direction: column;
  z-index: 3;
}
.ms-st-p-footer-top {
  display: grid; grid-template-columns: 1.7fr 1fr;
  flex: 1 1 auto; min-height: 0;
  border-bottom: 2px solid #0a0608;
}

/* Slate (amber breaking-news block) */
.ms-st-p-slate {
  position: relative;
  background: linear-gradient(180deg, #f4b942 0%, #c8901c 100%);
  color: #1a0e08; padding: 22px 28px;
  display: grid; grid-template-columns: auto 1fr auto; gap: 24px; align-items: center;
  overflow: hidden;
  border-right: 2px solid #0a0608;
}
.ms-st-p-slate::before {
  content: ''; position: absolute; inset: 0;
  background: repeating-linear-gradient(135deg, transparent 0 56px, rgba(0,0,0,.08) 56px 64px);
  pointer-events: none;
}
.ms-st-p-slate-tag {
  background: #1a0e08; color: #f4b942;
  padding: 12px 20px;
  font-family: 'Anton', sans-serif; font-size: 36px; letter-spacing: .14em;
  text-transform: uppercase;
  border: 3px solid #1a0e08; box-shadow: 6px 6px 0 rgba(0,0,0,.4);
  display: inline-flex; align-items: center; gap: 14px;
  position: relative; z-index: 1;
}
.ms-st-p-slate-tag::before {
  content: ''; width: 14px; height: 14px; border-radius: 50%; background: #e63946;
  box-shadow: 0 0 14px #e63946;
  animation: msStPPulse 1.4s ease-in-out infinite;
}
.ms-st-p-slate-msg {
  font-family: 'Archivo', sans-serif; font-weight: 800;
  font-size: 36px; line-height: 1.15; letter-spacing: -.005em;
  position: relative; z-index: 1;
}
.ms-st-p-slate-when {
  font-family: 'Anton', sans-serif; font-size: 48px; letter-spacing: .04em;
  text-transform: uppercase; line-height: 1; text-align: right;
  border-left: 3px solid #1a0e08; padding-left: 22px;
  position: relative; z-index: 1; white-space: nowrap;
}
.ms-st-p-slate-when span {
  display: block;
  font-family: 'DM Mono', monospace; font-size: 18px; font-weight: 700;
  letter-spacing: .18em; text-transform: uppercase; opacity: .7;
  margin-top: 6px;
}

/* VFD (cyan attendance block) */
.ms-st-p-vfd {
  position: relative;
  background: linear-gradient(180deg, #08161c 0%, #020a0e 100%);
  padding: 22px 32px;
  display: grid; grid-template-columns: 1fr auto; gap: 28px; align-items: center;
  overflow: hidden;
}
.ms-st-p-vfd::before {
  content: ''; position: absolute; inset: 0;
  background: repeating-linear-gradient(0deg, transparent 0 3px, rgba(77,208,225,.04) 3px 4px);
  pointer-events: none;
}
.ms-st-p-vfd-info { position: relative; z-index: 1; min-width: 0; }
.ms-st-p-vfd-k {
  font-family: 'DM Mono', monospace; font-size: 18px; font-weight: 700;
  letter-spacing: .26em; text-transform: uppercase; color: #4dd0e1;
  text-shadow: 0 0 12px rgba(77,208,225,.5);
}
.ms-st-p-vfd-s {
  font-family: 'Archivo', sans-serif; font-weight: 600; font-size: 22px;
  color: rgba(77,208,225,.6); margin-top: 6px;
}
.ms-st-p-vfd-v {
  position: relative; z-index: 1;
  font-family: 'Anton', sans-serif; font-size: 96px; line-height: .9;
  color: #4dd0e1; letter-spacing: -.005em;
  text-shadow:
    0 0 18px rgba(77,208,225,.7),
    0 0 48px rgba(77,208,225,.4);
}

/* Ticker (brushed-aluminum bottom row) */
.ms-st-p-ticker {
  position: relative; height: 88px; flex: 0 0 auto;
  background: linear-gradient(180deg, #2a2520 0%, #14110e 100%);
  display: grid; grid-template-columns: auto 1fr auto;
  overflow: hidden;
}
.ms-st-p-ticker::before {
  content: ''; position: absolute; inset: 4px;
  background:
    repeating-linear-gradient(90deg, transparent 0 2px, rgba(255,235,180,.04) 2px 3px),
    linear-gradient(180deg, rgba(255,235,180,.04), transparent 50%);
  pointer-events: none;
}
.ms-st-p-ticker-badge {
  background: #e63946; color: #fff;
  font-family: 'Anton', sans-serif; font-size: 38px; letter-spacing: .14em;
  text-transform: uppercase;
  padding: 0 26px;
  display: flex; align-items: center; gap: 14px;
  border-right: 2px solid #0a0608;
  position: relative; z-index: 1;
}
.ms-st-p-ticker-badge::before {
  content: ''; width: 12px; height: 12px; border-radius: 50%; background: #fff;
  box-shadow: 0 0 12px #fff;
  animation: msStPPulse 1.4s ease-in-out infinite;
}
.ms-st-p-ticker-feed {
  overflow: hidden; position: relative; z-index: 1;
  display: flex; align-items: center;
}
.ms-st-p-ticker-feed-inner {
  display: inline-flex; align-items: center; gap: 50px;
  height: 100%; padding: 0 32px;
  white-space: nowrap;
  animation: msStPScroll 36s linear infinite;
  font-family: 'Archivo', sans-serif; font-weight: 700; font-size: 28px;
  color: #f6f1e8;
}
@keyframes msStPScroll {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
.ms-st-p-ticker-feed-inner span {
  display: inline-flex; align-items: center; gap: 14px;
}
.ms-st-p-ticker-feed-inner span::after {
  content: '●'; color: #f4b942; margin-left: 50px;
}
.ms-st-p-ticker-end {
  font-family: 'Anton', sans-serif; font-size: 32px; letter-spacing: .14em;
  color: #4dd0e1; padding: 0 26px;
  display: flex; align-items: center;
  border-left: 2px solid #0a0608;
  text-shadow: 0 0 12px rgba(77,208,225,.5);
  position: relative; z-index: 1;
}
`;
