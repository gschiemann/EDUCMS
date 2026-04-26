"use client";

/**
 * MsStudioWidget — Middle-school lobby scene, 3840×2160.
 *
 * APPROVED 2026-04-25 — matches scratch/design/studio-ms-v2.html.
 * Reviewed by user, ported via HsStage scale pattern. DO NOT
 * regress to vw/% units. Every pixel size must match the mockup.
 *
 * Scene layout (panels arranged on a 3840×2160 stage):
 *   - hud            → ON AIR cabochon + WESTRIDGE.MS lockup with frequency
 *                      dial + 3 vintage meta tiles (clock / weather / countdown)
 *   - hero-row       → LEFT: broadcast poster with episode ribbon, supersized
 *                      "GOOD MORNING" headline, animated waveform, lede, and
 *                      4 cue-card chips. RIGHT: rack column with turntable
 *                      (vinyl platter + tonearm + label art), VU meter
 *                      (animated needle, peak zone), and 4-fader mixer strip.
 *   - lineup         → 4 cassette-tape schedule cards (done / live / next /
 *                      later) with animated reels.
 *   - lower          → amber breaking-news slate (BREAKING tag + msg + when)
 *                      + cyan VFD frequency display (call letters + big value).
 *   - ticker         → brushed-aluminum NOW PLAYING scrolling bar with red
 *                      pulse badge and cyan call-letters cap on the right.
 *
 * box-sizing: border-box on every panel that sets explicit width is load-
 * bearing — without it the rack column drifts past the right edge.
 */

import * as React from 'react';
import { HsStage } from '../hs/HsStage';

export interface MsStudioConfig {
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
  // Lineup — tapes (4 cards: done / live / next / later)
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
  // Lower — breaking-news slate
  'announcement.tag'?: string;
  'announcement.message'?: string;
  'announcement.when_eye'?: string;
  'announcement.when'?: string;
  // Lower — VFD frequency display
  'big.label'?: string;
  'big.sub'?: string;
  'big.value'?: string;
  // Ticker
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

export const DEFAULTS: Required<MsStudioConfig> = {
  // HUD — ON AIR cabochon
  'status.label': 'ON AIR',
  // HUD — school lockup
  'school.eye': 'Otter Radio · Ep. 142',
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
  'greeting.episode': 'Morning Show · Episode 142',
  'greeting.h1': 'GOOD',
  'greeting.h2': 'MORNING.',
  'greeting.subtitle':
    "Broadcasting live from the front office. First bell at 08:05. Mr. Nguyen wants journals out for poetry in P2 — you heard it here first. Up next: science lab, mile run, and the greatest chicken & rice the cafeteria's ever cooked.",
  'greeting.c0': 'Rm 108 · Poetry',
  'greeting.c1': 'Gym A · Mile Run',
  'greeting.c2': 'Lib · Sign-ups Fri',
  'greeting.c3': 'Aud · Drama Auditions',
  // Hero — turntable feature
  'feature.eye': 'NOW SPINNING',
  'feature.label': 'Spotlight',
  'feature.title': 'Spring Band Concert',
  'feature.sub': 'Wed · 7 PM',
  'feature.nw': '7th & 8th Grade Band',
  'feature.tag': '04 · "Echoes"',
  // VU meter
  'vu.k': 'Master Output',
  'vu.v': '+3 dB',
  'vu.feet0': 'Peak / RMS',
  'vu.feet1': '88.7 FM',
  // Mixer
  'mixer.k': 'Channel Faders',
  'mixer.v': '4 / 4 Hot',
  'mixer.s0': 'MIC',
  'mixer.s1': 'DECK',
  'mixer.s2': 'BAND',
  'mixer.s3': 'FX',
  // Lineup — header
  'segments.title': "Today's",
  'segments.subtitle': 'Lineup',
  'segments.meta': 'Day B · 6 segments queued',
  'segments.metar': 'on schedule',
  // Lineup — tapes
  'segments.0.n': 'Side A · Track 01 · P1',
  'segments.0.t': 'Math 7',
  'segments.0.host': 'Ms. Patel · Rm 214',
  'segments.0.time': '8:05 — 8:55 · DONE',
  'segments.1.n': 'On Air · Track 02 · P2',
  'segments.1.t': 'English Poetry',
  'segments.1.host': 'Mr. Nguyen · Rm 108',
  'segments.1.time': '9:00 — 9:50 · LIVE',
  'segments.2.n': 'Side A · Track 03 · P3',
  'segments.2.t': 'Science Lab',
  'segments.2.host': 'Ms. Okafor · Rm 207',
  'segments.2.time': '9:55 — 10:45 · UP NEXT',
  'segments.3.n': 'Side B · Track 04 · P4',
  'segments.3.t': 'PE Mile Run',
  'segments.3.host': 'Coach Reyes · Gym A',
  'segments.3.time': '10:50 — 11:40 · 10:50',
  // Lower — breaking-news slate
  'announcement.tag': 'Breaking',
  'announcement.message':
    'Picture day moved to Thursday — full uniform. Permission slips to front office by Wednesday end of day.',
  'announcement.when_eye': 'Cue Sheet',
  'announcement.when': 'THU · ALL DAY',
  // Lower — VFD frequency display
  'big.label': 'Otters Here',
  'big.sub': '98.2% attendance',
  'big.value': '1,217',
  // Ticker
  'ticker.tag': 'Now Playing',
  'ticker.m0': 'Bus 14 running +10 min',
  'ticker.m1': 'Substitute teacher in Rm B-12',
  'ticker.m2': 'Spelling bee sign-ups end Friday',
  'ticker.m3': '8th grade field trip forms due tomorrow',
  'ticker.m4': 'Library returns due this week',
  'ticker.m5': 'Lost blue water bottle → front office',
  'ticker.m6': 'Robotics Club · 3 PM · Rm 207',
  'ticker.callsign': '88.7 FM · WMS',
};

/**
 * Pick a value from the merged config, falling back to DEFAULTS if the
 * caller passed an empty string. Mirrors the arcade widget's pattern of
 * "empty string → use default" — empty strings in the editor mean
 * "blank" but in the demo we want the demo copy.
 */
const pick = <K extends keyof Required<MsStudioConfig>>(
  cfg: MsStudioConfig,
  key: K,
): string => {
  const v = cfg[key];
  return (v === undefined || v === '' ? DEFAULTS[key] : v) as string;
};

export function MsStudioWidget({ config }: { config?: MsStudioConfig }) {
  const cfg = config || {};

  // Per-tape metadata (which lbl colour, what the side stamp says, etc.)
  type TapeKey = 0 | 1 | 2 | 3;
  const tapeClass: Record<TapeKey, string> = {
    0: 'ms-st-done',
    1: 'ms-st-live',
    2: '',
    3: '',
  };
  const tapeStampLabel: Record<TapeKey, string> = {
    0: 'A',
    1: 'REC',
    2: 'A',
    3: 'A',
  };

  return (
    <HsStage
      stageStyle={{
        background: '#0c0a0d',
        backgroundImage: [
          'radial-gradient(ellipse 1800px 1100px at 32% 30%, rgba(244,185,66,.08), transparent 65%)',
          'radial-gradient(ellipse 1500px 900px at 80% 80%, rgba(230,57,70,.07), transparent 65%)',
          'repeating-linear-gradient(45deg, rgba(255,255,255,.018) 0 80px, rgba(0,0,0,.08) 80px 90px)',
          'repeating-linear-gradient(-45deg, rgba(255,255,255,.018) 0 80px, rgba(0,0,0,.08) 80px 90px)',
        ].join(', '),
        fontFamily: "'Archivo', system-ui, sans-serif",
        color: '#f6f1e8',
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* Tape-recorder scanline overlay (mockup paints on .stage::before) */}
      <div className="ms-st-scanlines" aria-hidden="true" />

      {/* ─── HUD: ON AIR sign + school lockup + meta tiles ───── */}
      <header className="ms-st-hud">
        <div className="ms-st-onair" data-widget="status" aria-label="On Air">
          <div className="ms-st-onair-text">
            <span className="ms-st-onair-dot" />
            <span className="ms-st-onair-label" data-field="status.label" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'status.label')}
            </span>
          </div>
        </div>

        <div className="ms-st-lockup" data-widget="school">
          <div className="ms-st-eye">
            <span data-field="school.eye" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'school.eye')}</span>
          </div>
          <div className="ms-st-name">
            <span data-field="school.name" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'school.name')}</span>{' '}
            <b data-field="school.callsign" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'school.callsign')}</b>
          </div>
          <div className="ms-st-freq">
            <span className="ms-st-dial" aria-hidden="true">
              <i /><i /><i /><i /><i /><i /><i /><i /><i /><i />
            </span>
            <span data-field="school.team" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'school.team')}</span>
            {' · '}
            <b data-field="school.day" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'school.day')}</b>
          </div>
        </div>

        <div className="ms-st-meta">
          <div className="ms-st-mt ms-st-warm" data-widget="clock">
            <span className="ms-st-mt-k" data-field="clock.label" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'clock.label')}
            </span>
            <span className="ms-st-mt-v" data-field="clock.time" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'clock.time')}
            </span>
          </div>
          <div className="ms-st-mt ms-st-cool" data-widget="weather">
            <span className="ms-st-mt-k" data-field="weather.label" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'weather.label')}
            </span>
            <span className="ms-st-mt-v" data-field="weather.temp" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'weather.temp')}
            </span>
          </div>
          <div className="ms-st-mt" data-widget="countdown">
            <span className="ms-st-mt-k" data-field="countdown.label" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'countdown.label')}
            </span>
            <span className="ms-st-mt-v" data-field="countdown.value" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'countdown.value')}
            </span>
          </div>
        </div>
      </header>

      {/* ─── HERO ROW ───────────────────────────────────────── */}
      <section className="ms-st-hero-row">
        {/* LEFT: broadcast poster */}
        <div className="ms-st-poster" data-widget="greeting">
          <div className="ms-st-ribbon" data-field="greeting.episode" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'greeting.episode')}
          </div>
          <h1 className="ms-st-poster-h1">
            <span data-field="greeting.h1" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.h1')}</span>
            <em data-field="greeting.h2" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'greeting.h2')}</em>
          </h1>
          <div className="ms-st-waveform" aria-hidden="true">
            <i /><i /><i /><i /><i /><i /><i /><i />
            <i /><i /><i /><i /><i /><i /><i /><i />
            <i /><i /><i /><i /><i /><i /><i /><i />
          </div>
          <p className="ms-st-lede" data-field="greeting.subtitle" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'greeting.subtitle')}
          </p>
          <div className="ms-st-cues">
            <span className="ms-st-cue ms-st-red" data-field="greeting.c0" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'greeting.c0')}
            </span>
            <span className="ms-st-cue" data-field="greeting.c1" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'greeting.c1')}
            </span>
            <span className="ms-st-cue ms-st-cyan" data-field="greeting.c2" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'greeting.c2')}
            </span>
            <span className="ms-st-cue" data-field="greeting.c3" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'greeting.c3')}
            </span>
          </div>
        </div>

        {/* RIGHT: rack column */}
        <div className="ms-st-rack">
          {/* TURNTABLE / now spinning */}
          <div className="ms-st-turntable" data-widget="feature">
            <div className="ms-st-tt-head">
              <div className="ms-st-tt-brand">Studer · 33⅓</div>
              <div className="ms-st-tt-meta">
                <b data-field="feature.eye" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'feature.eye')}</b> · A-Side
              </div>
            </div>
            <div className="ms-st-platter-wrap">
              <div className="ms-st-platter" aria-hidden="true">
                <div className="ms-st-label-art">
                  <div className="ms-st-la-t" data-field="feature.label" style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, 'feature.label')}
                  </div>
                  <h3 className="ms-st-la-h3" data-field="feature.title" style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, 'feature.title')}
                  </h3>
                  <div className="ms-st-la-s" data-field="feature.sub" style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, 'feature.sub')}
                  </div>
                </div>
                <div className="ms-st-pin" />
              </div>
              <div className="ms-st-tonearm" aria-hidden="true">
                <div className="ms-st-arm">
                  <div className="ms-st-arm-head" />
                  <div className="ms-st-arm-weight" />
                </div>
              </div>
            </div>
            <div className="ms-st-now-spinning">
              <span className="ms-st-nw" data-field="feature.nw" style={{ whiteSpace: 'pre-wrap' }}>
                {pick(cfg, 'feature.nw')}
              </span>
              <span className="ms-st-tg">
                Track <b data-field="feature.tag" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'feature.tag')}</b>
              </span>
            </div>
          </div>

          {/* VU + Mixer */}
          <div className="ms-st-control-row">
            <div className="ms-st-vu" data-widget="vu">
              <div className="ms-st-vu-head">
                <span className="ms-st-vu-k" data-field="vu.k" style={{ whiteSpace: 'pre-wrap' }}>
                  {pick(cfg, 'vu.k')}
                </span>
                <span className="ms-st-vu-v" data-field="vu.v" style={{ whiteSpace: 'pre-wrap' }}>
                  {pick(cfg, 'vu.v')}
                </span>
              </div>
              <div className="ms-st-vu-face" aria-hidden="true">
                <div className="ms-st-vu-scale">
                  −20 −10 −5 0 +1 +3<b>+6</b>
                </div>
                <div className="ms-st-vu-needle" />
                <div className="ms-st-vu-pivot" />
              </div>
              <div className="ms-st-vu-feet">
                <span data-field="vu.feet0" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'vu.feet0')}</span>
                <span>
                  <b data-field="vu.feet1" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'vu.feet1')}</b> live
                </span>
              </div>
            </div>

            <div className="ms-st-mixer" data-widget="mixer">
              <div className="ms-st-mixer-head">
                <span className="ms-st-mixer-k" data-field="mixer.k" style={{ whiteSpace: 'pre-wrap' }}>
                  {pick(cfg, 'mixer.k')}
                </span>
                <span className="ms-st-mixer-v" data-field="mixer.v" style={{ whiteSpace: 'pre-wrap' }}>
                  {pick(cfg, 'mixer.v')}
                </span>
              </div>
              <div className="ms-st-strips">
                {/* Strip 1 — MIC */}
                <div className="ms-st-strip">
                  <div className="ms-st-knob" />
                  <div className="ms-st-led">
                    <i className="ms-st-on" />
                    <i className="ms-st-on" />
                    <i className="ms-st-warn" />
                    <i />
                  </div>
                  <div className="ms-st-fader">
                    <div className="ms-st-cap" style={{ bottom: '24%' }} />
                  </div>
                  <div className="ms-st-lbl" data-field="mixer.s0" style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, 'mixer.s0')}
                  </div>
                  <div className="ms-st-ch">CH 1</div>
                </div>
                {/* Strip 2 — DECK */}
                <div className="ms-st-strip">
                  <div className="ms-st-knob" style={{ transform: 'rotate(60deg)' }} />
                  <div className="ms-st-led">
                    <i className="ms-st-on" />
                    <i className="ms-st-on" />
                    <i className="ms-st-on" />
                    <i className="ms-st-warn" />
                  </div>
                  <div className="ms-st-fader">
                    <div className="ms-st-cap" style={{ bottom: '60%' }} />
                  </div>
                  <div className="ms-st-lbl" data-field="mixer.s1" style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, 'mixer.s1')}
                  </div>
                  <div className="ms-st-ch">CH 2</div>
                </div>
                {/* Strip 3 — BAND */}
                <div className="ms-st-strip">
                  <div className="ms-st-knob" style={{ transform: 'rotate(-30deg)' }} />
                  <div className="ms-st-led">
                    <i className="ms-st-on" />
                    <i className="ms-st-warn" />
                    <i className="ms-st-peak" />
                    <i />
                  </div>
                  <div className="ms-st-fader">
                    <div className="ms-st-cap" style={{ bottom: '78%' }} />
                  </div>
                  <div className="ms-st-lbl" data-field="mixer.s2" style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, 'mixer.s2')}
                  </div>
                  <div className="ms-st-ch">CH 3</div>
                </div>
                {/* Strip 4 — FX */}
                <div className="ms-st-strip">
                  <div className="ms-st-knob" style={{ transform: 'rotate(20deg)' }} />
                  <div className="ms-st-led">
                    <i className="ms-st-on" />
                    <i className="ms-st-on" />
                    <i />
                    <i />
                  </div>
                  <div className="ms-st-fader">
                    <div className="ms-st-cap" style={{ bottom: '42%' }} />
                  </div>
                  <div className="ms-st-lbl" data-field="mixer.s3" style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, 'mixer.s3')}
                  </div>
                  <div className="ms-st-ch">CH 4</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── LINEUP — cassette tape schedule ──────────────── */}
      <section className="ms-st-lineup" data-widget="segments">
        <div className="ms-st-lineup-head">
          <h2 className="ms-st-lineup-h2">
            <span data-field="segments.title" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'segments.title')}</span>{' '}
            <em data-field="segments.subtitle" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'segments.subtitle')}</em>
          </h2>
          <div className="ms-st-lineup-meta">
            <span className="ms-st-recdot" />
            <span data-field="segments.meta" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'segments.meta')}</span>
            {' · '}
            <b data-field="segments.metar" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'segments.metar')}</b>
          </div>
        </div>

        <div className="ms-st-tapes">
          {([0, 1, 2, 3] as const).map((i) => {
            const cls = `ms-st-tape ${tapeClass[i]}`.trim();
            const stampStyle: React.CSSProperties =
              i === 1 ? { background: '#e63946', fontSize: '14px' } : {};
            return (
              <div key={i} className={cls} data-widget={`segments.${i}`}>
                <div className="ms-st-tape-lbl">
                  <div className="ms-st-stamp" style={stampStyle}>
                    {tapeStampLabel[i]}
                  </div>
                  <div className="ms-st-tape-n" data-field={`segments.${i}.n`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `segments.${i}.n` as keyof Required<MsStudioConfig>)}
                  </div>
                  <div className="ms-st-tape-t" data-field={`segments.${i}.t`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `segments.${i}.t` as keyof Required<MsStudioConfig>)}
                  </div>
                  <div className="ms-st-tape-h" data-field={`segments.${i}.host`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `segments.${i}.host` as keyof Required<MsStudioConfig>)}
                  </div>
                  <div className="ms-st-tape-tm" data-field={`segments.${i}.time`} style={{ whiteSpace: 'pre-wrap' }}>
                    {pick(cfg, `segments.${i}.time` as keyof Required<MsStudioConfig>)}
                  </div>
                </div>
                <div className="ms-st-hubs">
                  <div className="ms-st-hub" />
                  <div className="ms-st-hub ms-st-hub-right" />
                </div>
                {i === 1 ? <div className="ms-st-now-pip">NOW PLAYING</div> : null}
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── FOOTER — single combined bottom bar (announcement +
            attendance + ticker). Replaces the old 2-bar stack
            (.ms-st-lower + .ms-st-ticker) that was overlapping the
            cassette reels. */}
      <section className="ms-st-footer">
        <div className="ms-st-footer-top">
          <div className="ms-st-slate" data-widget="announcement">
            <span className="ms-st-slate-tag">
              <span data-field="announcement.tag" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'announcement.tag')}</span>
            </span>
            <span className="ms-st-slate-msg" data-field="announcement.message" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'announcement.message')}
            </span>
            <span className="ms-st-slate-when">
              <span data-field="announcement.when_eye" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'announcement.when_eye')}</span>
              <span data-field="announcement.when" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'announcement.when')}</span>
            </span>
          </div>

          <div className="ms-st-vfd" data-widget="big">
            <div className="ms-st-vfd-info">
              <div className="ms-st-vfd-k" data-field="big.label" style={{ whiteSpace: 'pre-wrap' }}>
                {pick(cfg, 'big.label')}
              </div>
              <div className="ms-st-vfd-s" data-field="big.sub" style={{ whiteSpace: 'pre-wrap' }}>
                {pick(cfg, 'big.sub')}
              </div>
            </div>
            <div className="ms-st-vfd-v" data-field="big.value" style={{ whiteSpace: 'pre-wrap' }}>
              {pick(cfg, 'big.value')}
            </div>
          </div>
        </div>

        <div className="ms-st-ticker" data-widget="ticker">
          <div className="ms-st-ticker-badge" data-field="ticker.tag" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'ticker.tag')}
          </div>
          <div className="ms-st-ticker-feed">
            <div className="ms-st-ticker-feed-inner">
              <span data-field="ticker.m0" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'ticker.m0')}</span>
              <span data-field="ticker.m1" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'ticker.m1')}</span>
              <span data-field="ticker.m2" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'ticker.m2')}</span>
              <span data-field="ticker.m3" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'ticker.m3')}</span>
              <span data-field="ticker.m4" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'ticker.m4')}</span>
              <span data-field="ticker.m5" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'ticker.m5')}</span>
              <span data-field="ticker.m6" style={{ whiteSpace: 'pre-wrap' }}>{pick(cfg, 'ticker.m6')}</span>
              <span aria-hidden="true">{pick(cfg, 'ticker.m0')}</span>
              <span aria-hidden="true">{pick(cfg, 'ticker.m1')}</span>
              <span aria-hidden="true">{pick(cfg, 'ticker.m2')}</span>
              <span aria-hidden="true">{pick(cfg, 'ticker.m3')}</span>
              <span aria-hidden="true">{pick(cfg, 'ticker.m4')}</span>
              <span aria-hidden="true">{pick(cfg, 'ticker.m5')}</span>
              <span aria-hidden="true">{pick(cfg, 'ticker.m6')}</span>
            </div>
          </div>
          <div className="ms-st-ticker-end" data-field="ticker.callsign" style={{ whiteSpace: 'pre-wrap' }}>
            {pick(cfg, 'ticker.callsign')}
          </div>
        </div>
      </section>
    </HsStage>
  );
}

/** Inlined CSS — every pixel value matches scratch/design/studio-ms-v2.html. */
const CSS = `
/* Box-sizing border-box on every panel that sets explicit width.
   Without it the rack column drifts ~80px past its intended right edge. */
.ms-st-hud, .ms-st-onair, .ms-st-lockup, .ms-st-meta, .ms-st-mt,
.ms-st-hero-row, .ms-st-poster, .ms-st-rack, .ms-st-turntable,
.ms-st-control-row, .ms-st-vu, .ms-st-mixer, .ms-st-strip, .ms-st-fader,
.ms-st-lineup, .ms-st-tapes, .ms-st-tape, .ms-st-tape-lbl, .ms-st-hubs,
.ms-st-footer, .ms-st-footer-top, .ms-st-slate, .ms-st-vfd, .ms-st-ticker, .ms-st-cues,
.ms-st-cue, .ms-st-ribbon, .ms-st-platter-wrap, .ms-st-vu-face,
.ms-st-strips {
  box-sizing: border-box;
}

/* Tape-recorder scanline overlay (mockup paints on .stage::before) */
.ms-st-scanlines {
  position: absolute; inset: 0; pointer-events: none; z-index: 1;
  background: repeating-linear-gradient(0deg, transparent 0 4px, rgba(255,255,255,.012) 4px 5px);
}

/* ─── HUD: ON AIR sign + school lockup + meta tiles ───────── */
.ms-st-hud {
  position: absolute; top: 56px; left: 64px; right: 64px; height: 224px;
  display: grid; grid-template-columns: auto 1fr auto; gap: 48px; align-items: center;
  z-index: 4;
}

/* ON AIR cabochon — real cabinet with screws, glow ring, glass face */
.ms-st-onair {
  width: 520px; height: 200px; position: relative;
  background: linear-gradient(180deg, #2a1418 0%, #160809 50%, #0d0306 100%);
  border: 6px solid #2c1c1f;
  border-radius: 16px;
  box-shadow:
    inset 0 6px 14px rgba(255,140,140,.12),
    inset 0 -8px 18px rgba(0,0,0,.55),
    0 18px 48px rgba(230,57,70,.45),
    0 0 120px rgba(230,57,70,.28);
}
.ms-st-onair::before {
  /* glass face highlight */
  content:''; position: absolute; inset: 14px;
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255,255,255,.07), transparent 28%),
    radial-gradient(ellipse 80% 60% at 50% 30%, rgba(230,57,70,.45), rgba(80,8,12,.85) 70%);
  box-shadow: inset 0 0 80px rgba(255,90,100,.38);
}
.ms-st-onair::after {
  /* corner screws — four little aluminum dots */
  content:''; position: absolute; inset: 0;
  background:
    radial-gradient(circle at 22px 22px, #b9b3aa 3px, #5a564f 4px, transparent 5px),
    radial-gradient(circle at calc(100% - 22px) 22px, #b9b3aa 3px, #5a564f 4px, transparent 5px),
    radial-gradient(circle at 22px calc(100% - 22px), #b9b3aa 3px, #5a564f 4px, transparent 5px),
    radial-gradient(circle at calc(100% - 22px) calc(100% - 22px), #b9b3aa 3px, #5a564f 4px, transparent 5px);
  pointer-events: none;
}
.ms-st-onair-text {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 24px;
  z-index: 2;
}
.ms-st-onair-dot {
  width: 28px; height: 28px; border-radius: 50%; background: #e63946;
  box-shadow:
    0 0 24px #ff5566,
    0 0 60px rgba(230,57,70,.7),
    inset 0 -6px 8px rgba(0,0,0,.4);
  animation: msStPulse 1.4s ease-in-out infinite;
}
@keyframes msStPulse {
  0%,100% { opacity: 1; transform: scale(1); }
  50% { opacity: .55; transform: scale(.85); }
}
.ms-st-onair-label {
  font-family: 'Anton', 'Archivo', sans-serif;
  font-size: 132px; line-height: .95; letter-spacing: .04em;
  color: #ffe2c0;
  text-shadow:
    0 0 24px rgba(255,180,140,.55),
    0 0 60px rgba(230,57,70,.45),
    0 4px 0 rgba(0,0,0,.6);
}

/* School lockup with frequency dial visual */
.ms-st-lockup { display: flex; flex-direction: column; justify-content: center; gap: 6px; padding-left: 12px; }
.ms-st-eye {
  font-family: 'DM Mono', monospace; font-size: 28px; font-weight: 700;
  letter-spacing: .28em; text-transform: uppercase; color: #f4b942;
  display: inline-flex; align-items: center; gap: 16px;
}
.ms-st-eye::before {
  content: ''; width: 56px; height: 4px; background: #f4b942;
  box-shadow: 0 0 20px #f4b942;
}
.ms-st-name {
  font-family: 'Anton', sans-serif; font-size: 132px; line-height: .9;
  letter-spacing: .005em; color: #f6f1e8;
  text-shadow: 0 4px 0 rgba(0,0,0,.55), 0 0 60px rgba(244,185,66,.18);
}
.ms-st-name b { color: #f4b942; font-weight: inherit; }
.ms-st-freq {
  margin-top: 14px; display: flex; align-items: center; gap: 24px;
  font-family: 'DM Mono', monospace; font-size: 30px; font-weight: 500;
  letter-spacing: .14em; text-transform: uppercase; color: #b9aca0;
}
.ms-st-freq b { color: #4dd0e1; font-weight: 700; }
.ms-st-dial {
  display: inline-flex; align-items: center; height: 30px; padding: 0 12px;
  background: linear-gradient(180deg, #0a0608 0%, #1a1216 100%);
  border: 2px solid #2a2024; border-radius: 4px;
}
.ms-st-dial i {
  display: inline-block; width: 3px; height: 14px; margin-right: 4px; background: #8d8a85;
}
.ms-st-dial i:nth-child(3),
.ms-st-dial i:nth-child(7) {
  background: #4dd0e1; height: 22px; box-shadow: 0 0 8px #4dd0e1;
}

/* Meta tiles — 3 vintage analog readouts */
.ms-st-meta { display: flex; gap: 18px; }
.ms-st-mt {
  width: 220px; height: 176px;
  background: linear-gradient(180deg, #1f1a1e 0%, #120c10 100%);
  border: 4px solid #2e2429;
  border-radius: 8px;
  box-shadow: inset 0 4px 12px rgba(255,180,140,.06), inset 0 -8px 14px rgba(0,0,0,.5), 0 8px 24px rgba(0,0,0,.45);
  padding: 18px 22px;
  display: flex; flex-direction: column; justify-content: space-between;
  position: relative; overflow: hidden;
}
.ms-st-mt::before {
  /* glow tint per tile */
  content: ''; position: absolute; inset: 6px; border-radius: 4px;
  background: radial-gradient(ellipse 80% 60% at 50% 30%, rgba(244,185,66,.08), transparent 70%);
  pointer-events: none;
}
.ms-st-mt-k {
  font-family: 'DM Mono', monospace; font-size: 22px; font-weight: 700;
  letter-spacing: .22em; text-transform: uppercase; color: #b9aca0;
}
.ms-st-mt-v {
  font-family: 'Anton', sans-serif; font-size: 92px; line-height: 1;
  letter-spacing: -.005em; color: #f6f1e8;
  text-shadow: 0 0 24px rgba(244,185,66,.4);
}
.ms-st-mt.ms-st-warm .ms-st-mt-v { color: #f4b942; text-shadow: 0 0 28px rgba(244,185,66,.55); }
.ms-st-mt.ms-st-cool .ms-st-mt-v { color: #4dd0e1; text-shadow: 0 0 28px rgba(77,208,225,.5); }

/* ─── HERO ROW ────────────────────────────────────────────── */
.ms-st-hero-row {
  position: absolute; top: 300px; left: 64px; right: 64px; height: 940px;
  display: grid; grid-template-columns: 1fr 1300px; gap: 40px;
  z-index: 3;
}

/* LEFT — broadcast poster */
.ms-st-poster {
  position: relative;
  background: linear-gradient(180deg, #1c1419 0%, #110a0e 100%);
  border: 5px solid #2a1f25;
  border-radius: 12px;
  box-shadow:
    inset 0 8px 20px rgba(244,185,66,.05),
    inset 0 -10px 30px rgba(0,0,0,.6),
    0 20px 60px rgba(0,0,0,.55);
  padding: 56px 72px 64px;
  display: flex; flex-direction: column; justify-content: space-between;
  overflow: hidden;
}
.ms-st-poster::before {
  /* faint amber sweep */
  content: ''; position: absolute; inset: 0;
  background: radial-gradient(ellipse 1200px 700px at 0% 0%, rgba(244,185,66,.10), transparent 60%);
  pointer-events: none;
}
.ms-st-ribbon {
  /* episode slate */
  display: inline-flex; align-items: center; gap: 24px; flex-shrink: 0;
  padding: 18px 32px;
  background: #e63946;
  color: #fff;
  font-family: 'DM Mono', monospace; font-size: 32px; font-weight: 700;
  letter-spacing: .26em; text-transform: uppercase;
  align-self: flex-start;
  box-shadow: 8px 8px 0 rgba(0,0,0,.6), 0 0 40px rgba(230,57,70,.4);
  position: relative; z-index: 1;
}
.ms-st-ribbon::before {
  content: ''; width: 16px; height: 16px; border-radius: 50%; background: #fff;
  box-shadow: 0 0 12px #fff;
}
.ms-st-poster-h1 {
  font-family: 'Anton', sans-serif;
  font-size: 360px; line-height: .82; letter-spacing: .002em;
  color: #f6f1e8; margin: 0;
  text-transform: uppercase;
  text-shadow: 0 6px 0 rgba(0,0,0,.55);
  position: relative; z-index: 1;
}
.ms-st-poster-h1 em {
  font-style: normal; color: #e63946;
  display: block;
  text-shadow:
    14px 14px 0 rgba(230,57,70,.22),
    0 4px 0 rgba(0,0,0,.55);
}

/* Waveform under headline — pure CSS bars that pulse */
.ms-st-waveform {
  margin-top: 24px;
  display: flex; align-items: flex-end; gap: 10px;
  height: 88px; position: relative; z-index: 1;
}
.ms-st-waveform i {
  display: block; width: 14px; background: linear-gradient(180deg, #f4b942 0%, #e63946 100%);
  border-radius: 3px;
  box-shadow: 0 0 10px rgba(244,185,66,.4);
  animation: msStWave 1.6s ease-in-out infinite;
}
@keyframes msStWave {
  0%,100% { height: 18%; }
  50%     { height: 100%; }
}
.ms-st-waveform i:nth-child(1)  { animation-delay: -.10s; }
.ms-st-waveform i:nth-child(2)  { animation-delay: -.42s; }
.ms-st-waveform i:nth-child(3)  { animation-delay: -.18s; }
.ms-st-waveform i:nth-child(4)  { animation-delay: -.66s; }
.ms-st-waveform i:nth-child(5)  { animation-delay: -.28s; }
.ms-st-waveform i:nth-child(6)  { animation-delay: -.90s; }
.ms-st-waveform i:nth-child(7)  { animation-delay: -.04s; }
.ms-st-waveform i:nth-child(8)  { animation-delay: -.55s; }
.ms-st-waveform i:nth-child(9)  { animation-delay: -.22s; }
.ms-st-waveform i:nth-child(10) { animation-delay: -.78s; }
.ms-st-waveform i:nth-child(11) { animation-delay: -.36s; }
.ms-st-waveform i:nth-child(12) { animation-delay: -.50s; }
.ms-st-waveform i:nth-child(13) { animation-delay: -.14s; }
.ms-st-waveform i:nth-child(14) { animation-delay: -.84s; }
.ms-st-waveform i:nth-child(15) { animation-delay: -.30s; }
.ms-st-waveform i:nth-child(16) { animation-delay: -.62s; }
.ms-st-waveform i:nth-child(17) { animation-delay: -.20s; }
.ms-st-waveform i:nth-child(18) { animation-delay: -.94s; }
.ms-st-waveform i:nth-child(19) { animation-delay: -.40s; }
.ms-st-waveform i:nth-child(20) { animation-delay: -.16s; }
.ms-st-waveform i:nth-child(21) { animation-delay: -.72s; }
.ms-st-waveform i:nth-child(22) { animation-delay: -.32s; }
.ms-st-waveform i:nth-child(23) { animation-delay: -.58s; }
.ms-st-waveform i:nth-child(24) { animation-delay: -.06s; }

.ms-st-lede {
  font-family: 'Archivo', sans-serif; font-weight: 500;
  font-size: 42px; line-height: 1.28;
  color: #b9aca0; margin: 32px 0 0; max-width: 1900px;
  position: relative; z-index: 1;
}
.ms-st-lede b { color: #f4b942; font-weight: 700; }

/* Cue-card chips along the bottom of the poster — guest list */
.ms-st-cues {
  display: flex; gap: 18px; margin-top: 32px; flex-wrap: wrap;
  position: relative; z-index: 1;
}
.ms-st-cue {
  display: inline-flex; align-items: center; gap: 14px;
  padding: 14px 24px;
  background: rgba(244,185,66,.10);
  border: 3px solid #f4b942;
  border-radius: 4px;
  font-family: 'DM Mono', monospace; font-size: 26px; font-weight: 700;
  letter-spacing: .12em; text-transform: uppercase; color: #f6f1e8;
}
.ms-st-cue::before {
  content: ''; width: 14px; height: 14px; border-radius: 50%; background: #f4b942;
  box-shadow: 0 0 10px #f4b942;
}
.ms-st-cue.ms-st-red { border-color: #e63946; background: rgba(230,57,70,.12); }
.ms-st-cue.ms-st-red::before { background: #e63946; box-shadow: 0 0 10px #e63946; }
.ms-st-cue.ms-st-cyan { border-color: #4dd0e1; background: rgba(77,208,225,.10); }
.ms-st-cue.ms-st-cyan::before { background: #4dd0e1; box-shadow: 0 0 10px #4dd0e1; }

/* RIGHT — turntable + VU + mixer column */
.ms-st-rack {
  display: grid; grid-template-rows: 600px 1fr; gap: 24px;
  position: relative;
}

/* Turntable: mahogany plinth + vinyl platter + tonearm + label */
.ms-st-turntable {
  position: relative;
  background: linear-gradient(180deg, #4d2818 0%, #2c150c 100%);
  border: 5px solid #2a1209;
  border-radius: 12px;
  box-shadow:
    inset 0 6px 18px rgba(255,180,140,.10),
    inset 0 -10px 30px rgba(0,0,0,.65),
    0 18px 50px rgba(0,0,0,.6);
  padding: 26px 30px;
  overflow: hidden;
}
.ms-st-turntable::before {
  /* wood grain */
  content: ''; position: absolute; inset: 0;
  background:
    repeating-linear-gradient(98deg, transparent 0 4px, rgba(0,0,0,.10) 4px 6px),
    repeating-linear-gradient(98deg, transparent 0 60px, rgba(255,180,140,.04) 60px 64px);
  pointer-events: none;
}
.ms-st-tt-head {
  display: flex; justify-content: space-between; align-items: center;
  padding-bottom: 14px; border-bottom: 2px solid rgba(244,185,66,.22);
  position: relative; z-index: 2;
}
.ms-st-tt-brand {
  font-family: 'Anton', sans-serif; font-size: 38px; letter-spacing: .12em;
  color: #f4b942; text-transform: uppercase;
}
.ms-st-tt-meta {
  font-family: 'DM Mono', monospace; font-size: 22px; font-weight: 700;
  letter-spacing: .18em; text-transform: uppercase; color: #b9aca0;
}
.ms-st-tt-meta b { color: #f4b942; }

/* Platter + vinyl */
.ms-st-platter-wrap {
  position: relative; height: 460px; display: grid; place-items: center;
  margin-top: 12px;
}
.ms-st-platter {
  width: 460px; height: 460px; position: relative;
  border-radius: 50%;
  background:
    radial-gradient(circle, #1a1418 0 8%, #0a0608 8% 28%, #1a1418 28% 32%, #0a0608 32% 100%);
  box-shadow:
    0 0 0 6px #1a1014,
    0 0 0 10px #2a1d22,
    inset 0 0 80px rgba(0,0,0,.7),
    0 30px 60px rgba(0,0,0,.6);
  animation: msStSpin 6s linear infinite;
}
@keyframes msStSpin { to { transform: rotate(360deg); } }
.ms-st-platter::before {
  /* concentric grooves */
  content: ''; position: absolute; inset: 0; border-radius: 50%;
  background: repeating-radial-gradient(circle at 50% 50%, transparent 0 4px, rgba(255,255,255,.04) 4px 5px);
}
.ms-st-platter::after {
  /* center label */
  content: ''; position: absolute; inset: 30%; border-radius: 50%;
  background: radial-gradient(circle, #c8901c 0 60%, #f4b942 60% 100%);
  box-shadow: inset 0 0 14px rgba(0,0,0,.4);
}
.ms-st-pin {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: 18px; height: 18px; border-radius: 50%; background: #b9b3aa;
  box-shadow: 0 0 0 4px #2a1d22, inset 0 -3px 4px rgba(0,0,0,.4);
  z-index: 4;
}
.ms-st-label-art {
  position: absolute; inset: 30%; border-radius: 50%; z-index: 3;
  display: grid; place-items: center; text-align: center;
  color: #1a0e08;
  padding: 12px;
}
.ms-st-la-t {
  font-family: 'DM Mono', monospace; font-size: 18px; font-weight: 700;
  letter-spacing: .22em; text-transform: uppercase; color: #2a160a;
}
.ms-st-la-h3 {
  font-family: 'Anton', sans-serif; font-size: 36px; line-height: .95;
  letter-spacing: .02em; color: #1a0e08; margin: 4px 0 6px;
  text-transform: uppercase;
  transform: scaleY(1.06);
}
.ms-st-la-s {
  font-family: 'Archivo', sans-serif; font-weight: 600; font-size: 14px;
  color: #4a2a14;
}

/* Tonearm */
.ms-st-tonearm {
  position: absolute; top: 6%; right: 4%; width: 56%; height: 90%;
  transform-origin: 100% 14%; transform: rotate(-22deg);
  z-index: 5; pointer-events: none;
}
.ms-st-tonearm::before {
  /* base disc */
  content: ''; position: absolute; top: -8px; right: -28px;
  width: 84px; height: 84px; border-radius: 50%;
  background: radial-gradient(circle, #d8d4cf 0 30%, #8d8a85 30% 80%, #4a4744 100%);
  box-shadow: inset 0 -6px 8px rgba(0,0,0,.4), 0 4px 12px rgba(0,0,0,.5);
}
.ms-st-arm {
  position: absolute; top: 18px; right: 22px;
  width: 90%; height: 12px;
  background: linear-gradient(180deg, #d6d2cc 0%, #8a8682 100%);
  border-radius: 6px;
  box-shadow: inset 0 -4px 6px rgba(0,0,0,.45), 0 4px 10px rgba(0,0,0,.5);
  transform-origin: right;
}
.ms-st-arm-head {
  /* cartridge */
  position: absolute; top: 8px; left: 0;
  width: 36px; height: 32px;
  background: linear-gradient(180deg, #2a1418 0%, #100608 100%);
  border-radius: 4px;
  box-shadow: 0 4px 8px rgba(0,0,0,.6);
}
.ms-st-arm-weight {
  /* counterweight */
  position: absolute; right: -6px; top: 8px;
  width: 64px; height: 32px; border-radius: 4px;
  background: linear-gradient(180deg, #2a1d22 0%, #160c10 100%);
  box-shadow: inset 0 -4px 6px rgba(0,0,0,.5);
}

/* Tonearm caption */
.ms-st-now-spinning {
  position: relative; z-index: 2; margin-top: 8px;
  display: flex; justify-content: space-between; align-items: flex-end;
  padding-top: 14px; border-top: 2px solid rgba(244,185,66,.22);
}
.ms-st-nw {
  font-family: 'DM Mono', monospace; font-size: 22px; font-weight: 700;
  letter-spacing: .22em; text-transform: uppercase; color: #b9aca0;
}
.ms-st-tg {
  font-family: 'Anton', sans-serif; font-size: 36px; letter-spacing: .04em;
  color: #f6f1e8; text-transform: uppercase;
}
.ms-st-tg b { color: #f4b942; }

/* VU + Mixer (bottom-right) */
.ms-st-control-row { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }

.ms-st-vu {
  background: linear-gradient(180deg, #1c1419 0%, #0e0810 100%);
  border: 4px solid #2a1f24;
  border-radius: 10px;
  box-shadow: inset 0 6px 14px rgba(255,180,140,.06), inset 0 -10px 24px rgba(0,0,0,.6), 0 8px 20px rgba(0,0,0,.55);
  padding: 20px 22px 22px;
  display: flex; flex-direction: column;
  position: relative; overflow: hidden;
}
.ms-st-vu-head {
  display: flex; justify-content: space-between; align-items: baseline;
  padding-bottom: 10px; border-bottom: 2px solid rgba(244,185,66,.22);
}
.ms-st-vu-k { font-family: 'DM Mono', monospace; font-size: 18px; font-weight: 700; letter-spacing: .22em; text-transform: uppercase; color: #b9aca0; }
.ms-st-vu-v { font-family: 'Anton', sans-serif; font-size: 26px; letter-spacing: .04em; color: #f4b942; text-transform: uppercase; }

.ms-st-vu-face {
  flex: 1; min-height: 180px;
  margin-top: 14px;
  background:
    radial-gradient(ellipse 90% 100% at 50% 110%, rgba(244,185,66,.20), rgba(244,185,66,.05) 50%, transparent 70%),
    linear-gradient(180deg, #f4d28a 0%, #e0a050 100%);
  border: 3px solid #1a0e08;
  border-radius: 8px 8px 100% 100% / 8px 8px 65% 65%;
  position: relative; overflow: hidden;
}
.ms-st-vu-face::before {
  /* arc + scale */
  content: ''; position: absolute; inset: 14px 14px 8px;
  border-radius: 8px 8px 100% 100% / 8px 8px 70% 70%;
  background: repeating-conic-gradient(from 180deg at 50% 100%,
    transparent 0 5deg, rgba(0,0,0,.5) 5deg 5.4deg);
  -webkit-mask: radial-gradient(circle at 50% 100%, transparent 30%, #000 30.5%, #000 95%, transparent 95.5%);
          mask: radial-gradient(circle at 50% 100%, transparent 30%, #000 30.5%, #000 95%, transparent 95.5%);
}
.ms-st-vu-face::after {
  /* red overload zone */
  content: ''; position: absolute; inset: 14px 14px 8px;
  border-radius: 8px 8px 100% 100% / 8px 8px 70% 70%;
  background: conic-gradient(from 200deg at 50% 100%,
    transparent 0deg 60deg, rgba(230,57,70,.5) 60deg 90deg, transparent 90deg 360deg);
  -webkit-mask: radial-gradient(circle at 50% 100%, transparent 65%, #000 65.5%, #000 92%, transparent 92.5%);
          mask: radial-gradient(circle at 50% 100%, transparent 65%, #000 65.5%, #000 92%, transparent 92.5%);
}
.ms-st-vu-needle {
  position: absolute; bottom: 8px; left: 50%; transform-origin: 50% 100%;
  width: 4px; height: 88%;
  background: linear-gradient(180deg, #1a0e08 0%, #4a2810 100%);
  border-radius: 2px;
  box-shadow: 0 0 8px rgba(0,0,0,.4);
  animation: msStNeedle 2.4s ease-in-out infinite;
}
@keyframes msStNeedle {
  0%   { transform: translateX(-50%) rotate(-60deg); }
  35%  { transform: translateX(-50%) rotate(-10deg); }
  55%  { transform: translateX(-50%) rotate(28deg); }
  75%  { transform: translateX(-50%) rotate(8deg); }
  100% { transform: translateX(-50%) rotate(-58deg); }
}
.ms-st-vu-pivot {
  position: absolute; bottom: -6px; left: 50%; transform: translateX(-50%);
  width: 28px; height: 28px; border-radius: 50%;
  background: radial-gradient(circle, #1a0e08 0 40%, #6a4818 40% 100%);
  box-shadow: inset 0 -3px 4px rgba(0,0,0,.4);
}
.ms-st-vu-scale {
  position: absolute; top: 18px; left: 0; right: 0; text-align: center;
  font-family: 'DM Mono', monospace; font-size: 18px; font-weight: 700; color: #1a0e08;
  letter-spacing: .14em;
}
.ms-st-vu-scale b { color: #ff4757; margin-left: 6px; }
.ms-st-vu-feet {
  margin-top: 12px; display: flex; justify-content: space-between;
  font-family: 'DM Mono', monospace; font-size: 18px; font-weight: 700; color: #b9aca0;
  letter-spacing: .14em; text-transform: uppercase;
}
.ms-st-vu-feet b { color: #66dd88; }

/* Mixer */
.ms-st-mixer {
  background: linear-gradient(180deg, #1c1419 0%, #0e0810 100%);
  border: 4px solid #2a1f24;
  border-radius: 10px;
  box-shadow: inset 0 6px 14px rgba(255,180,140,.06), inset 0 -10px 24px rgba(0,0,0,.6), 0 8px 20px rgba(0,0,0,.55);
  padding: 20px 22px;
  display: flex; flex-direction: column;
  position: relative; overflow: hidden;
}
.ms-st-mixer-head {
  display: flex; justify-content: space-between; align-items: baseline;
  padding-bottom: 10px; border-bottom: 2px solid rgba(244,185,66,.22);
}
.ms-st-mixer-k { font-family: 'DM Mono', monospace; font-size: 18px; font-weight: 700; letter-spacing: .22em; text-transform: uppercase; color: #b9aca0; }
.ms-st-mixer-v { font-family: 'Anton', sans-serif; font-size: 26px; letter-spacing: .04em; color: #4dd0e1; text-transform: uppercase; }

.ms-st-strips {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-top: 16px;
  flex: 1; min-height: 0;
}
.ms-st-strip {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 10px 6px;
  background: rgba(0,0,0,.35);
  border: 2px solid #2a1f24; border-radius: 6px;
}
.ms-st-knob {
  width: 44px; height: 44px; border-radius: 50%; flex-shrink: 0;
  background: radial-gradient(circle at 35% 30%, #d6d2cc 0 22%, #6a6660 22% 60%, #2a2520 60% 100%);
  box-shadow: 0 4px 8px rgba(0,0,0,.6), inset 0 -2px 4px rgba(0,0,0,.5);
  position: relative;
}
.ms-st-knob::after {
  content: ''; position: absolute; top: 4px; left: 50%; width: 3px; height: 14px;
  background: #f4b942; border-radius: 1px; transform: translateX(-50%);
  box-shadow: 0 0 6px #f4b942;
}
.ms-st-led {
  display: flex; flex-direction: column; gap: 2px; align-items: center;
  padding: 4px 4px;
}
.ms-st-led i {
  display: block; width: 18px; height: 4px;
  background: rgba(255,255,255,.05); border-radius: 1px;
}
.ms-st-led i.ms-st-on   { background: #66dd88; box-shadow: 0 0 4px #66dd88; }
.ms-st-led i.ms-st-warn { background: #ffd140; box-shadow: 0 0 4px #ffd140; }
.ms-st-led i.ms-st-peak { background: #ff4757; box-shadow: 0 0 4px #ff4757; }
.ms-st-fader {
  width: 16px; flex: 1; min-height: 60px;
  background: linear-gradient(180deg, #0a0608 0%, #1a1216 100%);
  border: 2px solid #2a1f24; border-radius: 4px;
  position: relative;
}
.ms-st-fader::before {
  /* fader scale */
  content: ''; position: absolute; inset: 6px 0;
  background: repeating-linear-gradient(0deg, transparent 0 8px, rgba(255,255,255,.08) 8px 9px);
}
.ms-st-cap {
  position: absolute; left: -10px; right: -10px;
  height: 22px; background: linear-gradient(180deg, #d6d2cc 0%, #6a6660 100%);
  border: 2px solid #1a1216; border-radius: 3px;
  box-shadow: 0 2px 4px rgba(0,0,0,.6);
}
.ms-st-lbl {
  font-family: 'DM Mono', monospace; font-size: 16px; font-weight: 700;
  letter-spacing: .12em; text-transform: uppercase; color: #f6f1e8;
}
.ms-st-ch {
  font-family: 'DM Mono', monospace; font-size: 13px; font-weight: 500;
  letter-spacing: .2em; text-transform: uppercase; color: #b9aca0;
}

/* ─── LINEUP — 4 cassette tape cards ─────────────────────── */
/* v2: grew height 550 → 720 because the .ms-st-tape aspect-ratio
   (5/3.05) renders ~555px tall after the column width math, and
   the old 550 container was clipping the tape reels at the bottom.
   Combined with the footer shrink to 170px, total still fits in
   the 2160 stage (1260 + 720 + 20 + 170 = 2170 minus the 10px
   bottom gap = 2160). */
.ms-st-lineup {
  position: absolute; top: 1260px; left: 64px; right: 64px; height: 720px;
  background: linear-gradient(180deg, #1a1318 0%, #0d090d 100%);
  border: 5px solid #2a1f24;
  border-radius: 12px;
  box-shadow:
    inset 0 8px 20px rgba(244,185,66,.04),
    inset 0 -10px 30px rgba(0,0,0,.6),
    0 20px 60px rgba(0,0,0,.55);
  padding: 30px 44px 36px;
  z-index: 3;
}
.ms-st-lineup-head {
  display: flex; justify-content: space-between; align-items: flex-end;
  padding-bottom: 16px; border-bottom: 3px solid rgba(244,185,66,.22);
}
.ms-st-lineup-h2 {
  font-family: 'Anton', sans-serif; font-size: 80px; line-height: 1;
  letter-spacing: .02em; color: #f6f1e8; margin: 0; text-transform: uppercase;
}
.ms-st-lineup-h2 em {
  font-style: normal; color: #f4b942;
  text-shadow: 0 0 32px rgba(244,185,66,.45);
}
.ms-st-lineup-meta {
  display: flex; align-items: center; gap: 24px;
  font-family: 'DM Mono', monospace; font-size: 26px; font-weight: 700;
  letter-spacing: .22em; text-transform: uppercase; color: #b9aca0;
}
.ms-st-lineup-meta b { color: #4dd0e1; }
.ms-st-recdot {
  width: 16px; height: 16px; border-radius: 50%; background: #e63946;
  box-shadow: 0 0 18px #e63946;
  animation: msStPulse 1.4s ease-in-out infinite;
}

.ms-st-tapes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; margin-top: 20px; }

/* Cassette tape card */
.ms-st-tape {
  position: relative; aspect-ratio: 5 / 3.05;
  background: linear-gradient(180deg, #2a2024 0%, #1a1318 100%);
  border: 3px solid #0a0608; border-radius: 8px;
  box-shadow:
    inset 0 4px 8px rgba(255,255,255,.06),
    inset 0 -6px 12px rgba(0,0,0,.7),
    0 12px 24px rgba(0,0,0,.6);
  overflow: hidden;
}
.ms-st-tape::before {
  /* shell screws */
  content: ''; position: absolute; inset: 0;
  background:
    radial-gradient(circle at 16px 16px,            #4a4744 2.5px, transparent 3.5px),
    radial-gradient(circle at calc(100% - 16px) 16px, #4a4744 2.5px, transparent 3.5px),
    radial-gradient(circle at 16px calc(100% - 16px), #4a4744 2.5px, transparent 3.5px),
    radial-gradient(circle at calc(100% - 16px) calc(100% - 16px), #4a4744 2.5px, transparent 3.5px);
  pointer-events: none;
}
/* Top label area */
.ms-st-tape-lbl {
  position: absolute; top: 10px; left: 38px; right: 38px; height: 47%;
  background: linear-gradient(180deg, #f5e8b6 0%, #e8d188 100%);
  border: 2px solid #2a1f10;
  border-radius: 4px;
  padding: 14px 18px;
  display: flex; flex-direction: column; gap: 4px;
  color: #1a0e08;
  box-shadow: inset 0 2px 4px rgba(0,0,0,.15);
}
.ms-st-stamp {
  /* side-A stamp (or REC for live) */
  position: absolute; top: -10px; right: -10px;
  width: 36px; height: 36px; border-radius: 50%;
  background: #e63946; color: #fff;
  display: grid; place-items: center;
  font-family: 'Anton', sans-serif; font-size: 22px;
  border: 3px solid #2a1f10;
  box-shadow: 0 4px 8px rgba(0,0,0,.5);
}
.ms-st-tape-n {
  font-family: 'DM Mono', monospace; font-size: 17px; font-weight: 700;
  letter-spacing: .18em; text-transform: uppercase; color: #6a3818;
}
.ms-st-tape-t {
  font-family: 'Anton', sans-serif; font-size: 38px; line-height: .95;
  letter-spacing: .02em; color: #1a0e08; text-transform: uppercase;
  margin-top: 2px;
}
.ms-st-tape-h {
  font-family: 'Archivo', sans-serif; font-weight: 600; font-size: 19px;
  color: #4a2810; margin-top: auto; letter-spacing: .02em;
}
.ms-st-tape-tm {
  font-family: 'DM Mono', monospace; font-size: 18px; font-weight: 700;
  color: #2a160a; letter-spacing: .12em;
  border-top: 2px solid #c8a458; padding-top: 4px; margin-top: 4px;
}

/* Bottom hub area with reels + tape ribbon */
.ms-st-hubs {
  position: absolute; bottom: 0; left: 0; right: 0; height: 50%;
  background: linear-gradient(180deg, #1a1216 0%, #0a0608 100%);
  display: grid; grid-template-columns: 1fr 1fr; place-items: center;
  padding: 18px 38px;
}
.ms-st-hubs::before {
  /* ribbon strip across the bottom */
  content: ''; position: absolute; bottom: 14px; left: 24px; right: 24px;
  height: 14px; background: linear-gradient(180deg, #4a3220 0%, #2a1d10 100%);
  border-top: 2px solid #6a4828; border-bottom: 2px solid #1a0e08;
  box-shadow: inset 0 1px 0 rgba(255,200,120,.2);
}
.ms-st-hub {
  width: 90px; height: 90px; border-radius: 50%;
  background: radial-gradient(circle, #2a2024 0 22%, #0a0608 22% 100%);
  border: 3px solid #4a4744;
  box-shadow: inset 0 0 14px rgba(0,0,0,.7);
  position: relative; overflow: hidden;
}
.ms-st-hub::before {
  /* spokes */
  content: ''; position: absolute; inset: 0;
  background: conic-gradient(from 0deg,
    transparent 0deg 35deg, rgba(244,185,66,.15) 35deg 60deg,
    transparent 60deg 100deg, rgba(244,185,66,.15) 100deg 125deg,
    transparent 125deg 165deg, rgba(244,185,66,.15) 165deg 190deg,
    transparent 190deg 230deg, rgba(244,185,66,.15) 230deg 255deg,
    transparent 255deg 295deg, rgba(244,185,66,.15) 295deg 320deg,
    transparent 320deg 360deg);
  border-radius: 50%;
  animation: msStSpin 4s linear infinite;
}
.ms-st-hub::after {
  /* spindle */
  content: ''; position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
  width: 18px; height: 18px; border-radius: 50%;
  background: radial-gradient(circle, #b9b3aa 0 40%, #4a4744 40% 100%);
}
.ms-st-hub.ms-st-hub-right::before { animation-direction: reverse; }

/* Active (now-recording) tape */
.ms-st-tape.ms-st-live {
  border-color: #e63946;
  box-shadow:
    inset 0 4px 8px rgba(255,255,255,.06),
    inset 0 -6px 12px rgba(0,0,0,.7),
    0 0 0 4px rgba(230,57,70,.35),
    0 12px 24px rgba(230,57,70,.4),
    0 0 60px rgba(230,57,70,.3);
}
.ms-st-tape.ms-st-live .ms-st-tape-lbl {
  background: linear-gradient(180deg, #ffe8a6 0%, #f4b942 100%);
}
.ms-st-now-pip {
  /* live status pip */
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, 80px);
  background: #e63946; color: #fff;
  font-family: 'DM Mono', monospace; font-size: 14px; font-weight: 700; letter-spacing: .24em;
  padding: 4px 14px; border-radius: 4px;
  box-shadow: 0 0 16px rgba(230,57,70,.6);
  z-index: 5;
}
.ms-st-tape.ms-st-done .ms-st-tape-lbl {
  background: linear-gradient(180deg, #bcb0a0 0%, #8a7e70 100%); opacity: .85;
}
.ms-st-tape.ms-st-done .ms-st-stamp { background: #8d8a85; }
.ms-st-tape.ms-st-done .ms-st-hub::before { animation: none; opacity: .35; }

/* ─── COMBINED FOOTER BAR ────────────────────────────────────
   Replaces the v1 split (.ms-st-lower at 1830 + .ms-st-ticker
   at bottom 10) which was perceived by the partner as two bars
   overlapping the cassette reels. New layout: ONE container at
   the bottom, two stacked rows inside (announcement + attendance
   on top, scrolling ticker below). Cassettes (.ms-st-segments
   top:1260, height:550 → ends 1810) get a 50px clear gap above
   the footer instead of being crowded by two stacked bars. */
/* The footer is ONE visual bar (single border + radius + shadow on
   the outer container). The inner slate / VFD / ticker zones are
   inline color blocks, not separate cards — they lost their own
   borders / radii / shadows so the whole footer reads as a single
   element instead of three stacked. Partner explicitly asked for
   this twice. */
.ms-st-footer {
  position: absolute; top: 2000px; left: 64px; right: 64px; height: 150px;
  display: flex; flex-direction: column;
  background: #14110e;
  border: 4px solid #0a0608;
  border-radius: 8px;
  box-shadow: 0 12px 30px rgba(0,0,0,.6);
  overflow: hidden;
  z-index: 3;
}
.ms-st-footer-top {
  display: grid; grid-template-columns: 1.7fr 1fr;
  flex: 1 1 auto; min-height: 0;
  border-bottom: 2px solid #0a0608;
}

/* Newscast slate — inline amber zone inside the unified footer.
   No separate border / radius / shadow — the outer .ms-st-footer
   owns the chrome. Just an amber background block. */
.ms-st-slate {
  position: relative;
  background: linear-gradient(180deg, #f4b942 0%, #c8901c 100%);
  padding: 12px 20px;
  display: grid; grid-template-columns: auto 1fr auto; gap: 22px; align-items: center;
  color: #1a0e08;
  overflow: hidden;
  border-right: 2px solid #0a0608;
}
.ms-st-slate::before {
  /* yellow caution stripes */
  content: ''; position: absolute; inset: 0;
  background: repeating-linear-gradient(135deg, transparent 0 40px, rgba(0,0,0,.08) 40px 46px);
  pointer-events: none;
}
.ms-st-slate-tag {
  background: #1a0e08; color: #f4b942;
  padding: 8px 14px;
  font-family: 'Anton', sans-serif; font-size: 24px; letter-spacing: .14em;
  text-transform: uppercase;
  border: 2px solid #1a0e08;
  box-shadow: 4px 4px 0 rgba(0,0,0,.4);
  position: relative; z-index: 1;
  display: inline-flex; align-items: center; gap: 10px;
}
.ms-st-slate-tag::before {
  content: ''; width: 11px; height: 11px; border-radius: 50%; background: #e63946;
  box-shadow: 0 0 12px #e63946;
  animation: msStPulse 1.4s ease-in-out infinite;
}
.ms-st-slate-msg {
  font-family: 'Archivo', sans-serif; font-weight: 800;
  font-size: 26px; line-height: 1.15; letter-spacing: -.005em;
  position: relative; z-index: 1;
}
.ms-st-slate-when {
  font-family: 'Anton', sans-serif; font-size: 32px; letter-spacing: .04em;
  text-transform: uppercase; line-height: 1;
  text-align: right; white-space: nowrap;
  border-left: 3px solid #1a0e08; padding-left: 16px;
  position: relative; z-index: 1;
}
.ms-st-slate-when span {
  display: block;
  font-family: 'DM Mono', monospace; font-size: 14px; font-weight: 700;
  letter-spacing: .18em; text-transform: uppercase; opacity: .7;
  margin-top: 3px;
}

/* Attendance / call-letters readout — inline cyan zone inside the
   unified footer. No separate border / radius / shadow. */
.ms-st-vfd {
  position: relative;
  background: linear-gradient(180deg, #08161c 0%, #020a0e 100%);
  padding: 10px 18px;
  display: grid; grid-template-columns: 1fr auto; gap: 16px; align-items: center;
  overflow: hidden;
}
.ms-st-vfd::before {
  /* VFD scanlines */
  content: ''; position: absolute; inset: 0;
  background: repeating-linear-gradient(0deg, transparent 0 3px, rgba(77,208,225,.04) 3px 4px);
  pointer-events: none;
}
.ms-st-vfd-info { position: relative; z-index: 1; min-width: 0; }
.ms-st-vfd-k {
  font-family: 'DM Mono', monospace; font-size: 13px; font-weight: 700;
  letter-spacing: .26em; text-transform: uppercase; color: #4dd0e1;
  text-shadow: 0 0 10px rgba(77,208,225,.6);
}
.ms-st-vfd-s {
  font-family: 'Archivo', sans-serif; font-weight: 600; font-size: 14px;
  color: rgba(77,208,225,.6); margin-top: 4px;
}
.ms-st-vfd-v {
  position: relative; z-index: 1;
  font-family: 'Anton', sans-serif; font-size: 56px; line-height: .9;
  color: #4dd0e1; letter-spacing: -.005em;
  text-shadow:
    0 0 14px rgba(77,208,225,.7),
    0 0 36px rgba(77,208,225,.45);
}

/* Ticker — inline strip inside the unified footer. No own border,
   radius, or outer shadow. The .ms-st-footer-top above has a
   bottom-divider so the visual seam between the slate+VFD row and
   the ticker is just one inner line, not a card-card gap. */
.ms-st-ticker {
  position: relative; height: 56px;
  background: linear-gradient(180deg, #2a2520 0%, #14110e 100%);
  display: grid; grid-template-columns: auto 1fr auto;
  overflow: hidden;
  flex: 0 0 auto;
}
.ms-st-ticker::before {
  /* brushed-aluminum streaks */
  content: ''; position: absolute; inset: 4px;
  background:
    repeating-linear-gradient(90deg, transparent 0 2px, rgba(255,235,180,.04) 2px 3px),
    linear-gradient(180deg, rgba(255,235,180,.04), transparent 50%);
  pointer-events: none;
  border-radius: 4px;
}
.ms-st-ticker-badge {
  background: #e63946;
  color: #fff;
  padding: 0 38px;
  display: flex; align-items: center; gap: 18px;
  font-family: 'Anton', sans-serif; font-size: 48px; letter-spacing: .12em;
  text-transform: uppercase;
  border-right: 4px solid #0a0608;
  flex-shrink: 0;
  position: relative; z-index: 1;
  box-shadow: inset 0 4px 8px rgba(255,255,255,.15), inset 0 -6px 12px rgba(0,0,0,.5);
}
.ms-st-ticker-badge::before {
  content: ''; width: 18px; height: 18px; border-radius: 50%; background: #fff;
  box-shadow: 0 0 14px #fff;
  animation: msStPulse 1.4s ease-in-out infinite;
}
.ms-st-ticker-feed {
  overflow: hidden; display: flex; align-items: center;
  padding-left: 36px;
  position: relative; z-index: 1;
}
.ms-st-ticker-feed-inner {
  display: flex; gap: 72px;
  font-family: 'Archivo', sans-serif; font-weight: 700; font-size: 48px;
  letter-spacing: .02em; color: #f6f1e8;
  white-space: nowrap;
  animation: msStScroll 60s linear infinite;
}
.ms-st-ticker-feed-inner span { display: inline-flex; align-items: center; gap: 24px; }
.ms-st-ticker-feed-inner span::after {
  content: '◉'; color: #f4b942; margin-left: 36px;
  text-shadow: 0 0 12px #f4b942;
}
@keyframes msStScroll {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
.ms-st-ticker-end {
  background: #4dd0e1; color: #062a30;
  padding: 0 32px;
  display: flex; align-items: center; gap: 16px;
  font-family: 'Anton', sans-serif; font-size: 44px; letter-spacing: .12em;
  text-transform: uppercase; border-left: 4px solid #0a0608;
  flex-shrink: 0; position: relative; z-index: 1;
  box-shadow: inset 0 4px 8px rgba(255,255,255,.15), inset 0 -6px 12px rgba(0,0,0,.25);
}
`;
