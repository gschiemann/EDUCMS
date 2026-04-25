"use client";

/**
 * MsPlaylistPortraitWidget — Middle-school lobby scene (PORTRAIT 2160×3840).
 *
 * APPROVED 2026-04-25 — matches scratch/design/playlist-ms-portrait-v1.html.
 * Portrait sibling to MsPlaylistWidget.
 *
 * Scene layout (panels arranged on a 2160×3840 stage):
 *   - appbar      → y=56   h=280   brand + meta tiles + avatar (two-row)
 *   - hero        → y=356  h=1400  album cover + numeral + heart
 *   - now         → y=1776 h=580   eyebrow, title, artist, chips, EQ
 *   - transport   → y=2376 h=200   progress track + knob + prev/play/next
 *   - queue       → y=2596 h=660   Up Next list (4 vertical rows)
 *   - featured    → y=3276 h=220   magenta spotlight card
 *   - row3        → y=3516 h=140   club charts + 3-cell stats (1fr / 720px)
 *   - bottom      → y=3676 h=144   gold pinned alert + ticker (1fr / 720px)
 *
 * Every panel that sets an explicit width relies on box-sizing: border-box
 * (single shared rule at the top of CSS). The stage backdrop is painted by
 * HsStage stageStyle so layered glow gradients reach edge-to-edge.
 */

import * as React from 'react';
import { HsStage } from '../hs/HsStage';

export interface MsPlaylistPortraitConfig {
  // App bar — brand
  'brand.eyebrow'?: string;
  'brand.suffix'?: string;
  'brand.day'?: string;
  'brand.date'?: string;
  'brand.volume'?: string;
  // App bar — device chip
  'device.label'?: string;
  'device.name'?: string;
  // App bar — meta tiles
  'clock.label'?: string;
  'clock.time'?: string;
  'weather.label'?: string;
  'weather.temp'?: string;
  'countdown.label'?: string;
  'countdown.value'?: string;
  'profile.initials'?: string;
  // Hero — album cover
  'cover.top'?: string;
  'hero.pidLabel'?: string;
  'hero.pidLetter'?: string;
  'hero.pidDate'?: string;
  'cover.label'?: string;
  'cover.big'?: string;
  'cover.album'?: string;
  'cover.tracklen'?: string;
  // Now playing
  'now.eyebrow'?: string;
  'now.title-1'?: string;
  'now.title-2'?: string;
  'now.artist-name'?: string;
  'now.artist-room'?: string;
  'now.artist-grade'?: string;
  'now.chipE'?: string;
  'now.chip1'?: string;
  'now.chip2'?: string;
  'now.meta'?: string;
  'now.elapsed'?: string;
  'now.remaining'?: string;
  // Queue header
  'queue.dayLabel'?: string;
  'queue.dayLetter'?: string;
  'queue.date'?: string;
  'queue.pill'?: string;
  // Queue rows (4)
  'queue.0.idx'?: string;
  'queue.0.art'?: string;
  'queue.0.title'?: string;
  'queue.0.artist'?: string;
  'queue.0.album'?: string;
  'queue.0.dur'?: string;
  'queue.1.idx'?: string;
  'queue.1.art'?: string;
  'queue.1.title'?: string;
  'queue.1.artist'?: string;
  'queue.1.album'?: string;
  'queue.1.dur'?: string;
  'queue.2.idx'?: string;
  'queue.2.art'?: string;
  'queue.2.title'?: string;
  'queue.2.artist'?: string;
  'queue.2.album'?: string;
  'queue.2.dur'?: string;
  'queue.3.idx'?: string;
  'queue.3.art'?: string;
  'queue.3.title'?: string;
  'queue.3.artist'?: string;
  'queue.3.album'?: string;
  'queue.3.dur'?: string;
  // Featured
  'featured.art'?: string;
  'featured.eyebrow'?: string;
  'featured.name'?: string;
  'featured.desc'?: string;
  'featured.tag'?: string;
  // Charts
  'charts.eyebrow'?: string;
  'charts.title'?: string;
  'charts.0.t'?: string;
  'charts.0.w'?: string;
  'charts.1.t'?: string;
  'charts.1.w'?: string;
  'charts.2.t'?: string;
  'charts.2.w'?: string;
  'charts.3.t'?: string;
  'charts.3.w'?: string;
  // Stats
  'stats.attendance.k'?: string;
  'stats.attendance.v'?: string;
  'stats.lunch.k'?: string;
  'stats.lunch.v'?: string;
  'stats.bus.k'?: string;
  'stats.bus.v'?: string;
  // Alert
  'alert.ico'?: string;
  'alert.eyebrow'?: string;
  'alert.message'?: string;
  'alert.when'?: string;
  // Ticker
  'ticker.tag'?: string;
  'ticker.0'?: string;
  'ticker.1'?: string;
  'ticker.2'?: string;
  'ticker.3'?: string;
  'ticker.4'?: string;
  'ticker.5'?: string;
}

export const DEFAULTS: Required<MsPlaylistPortraitConfig> = {
  // Brand
  'brand.eyebrow': 'Westridge MS · Lobby Display',
  'brand.suffix': 'FM',
  'brand.day': 'DAY B',
  'brand.date': 'TUE APR 21',
  'brand.volume': 'VOL 147',
  // Device chip
  'device.label': 'Playing on',
  'device.name': 'Westridge MS · Main Lobby',
  // Meta tiles
  'clock.label': 'Local time',
  'clock.time': '7:53',
  'weather.label': 'Outside',
  'weather.temp': '46°',
  'countdown.label': 'Field Day',
  'countdown.value': '12d',
  'profile.initials': 'WM',
  // Hero — cover header
  'cover.top': 'Now Playing · Period 2 · 31:12 in',
  'hero.pidLabel': 'Day',
  'hero.pidLetter': 'B',
  'hero.pidDate': 'Tue Apr 21',
  'cover.label': 'Period 2 · Live now',
  'cover.big': 'P2',
  'cover.album': 'Day B Rotation',
  'cover.tracklen': '8 tracks · 4h 35m',
  // Now playing
  'now.eyebrow': 'Live now · Period 2 · 31:12 in',
  'now.title-1': 'English',
  'now.title-2': 'Poetry Unit',
  'now.artist-name': 'Mr. Nguyen',
  'now.artist-room': 'Room 108',
  'now.artist-grade': '7th grade',
  'now.chipE': 'E',
  'now.chip1': 'Bring journal',
  'now.chip2': 'Workshop day',
  'now.meta': '50 min · repeats Thu',
  'now.elapsed': '31:12',
  'now.remaining': '-18:48',
  // Queue header
  'queue.dayLabel': 'DAY',
  'queue.dayLetter': 'B',
  'queue.date': 'TUE APR 21',
  'queue.pill': '6 in queue',
  // Queue rows
  'queue.0.idx': '3',
  'queue.0.art': 'SL',
  'queue.0.title': 'Science — lab day',
  'queue.0.artist': 'Ms. Okafor · 7th grade',
  'queue.0.album': 'Rm 207 · closed-toe shoes',
  'queue.0.dur': '9:55',
  'queue.1.idx': '4',
  'queue.1.art': 'PE',
  'queue.1.title': 'PE — mile run',
  'queue.1.artist': 'Coach Reyes · gymnasium A',
  'queue.1.album': 'Lockers by 10:45 · sneakers',
  'queue.1.dur': '10:50',
  'queue.2.idx': '5',
  'queue.2.art': 'LU',
  'queue.2.title': 'Lunch — A period',
  'queue.2.artist': 'Cafeteria · 7th grade only',
  'queue.2.album': 'Chicken & rice bowl today',
  'queue.2.dur': '11:45',
  'queue.3.idx': '6',
  'queue.3.art': 'SS',
  'queue.3.title': 'Social Studies — map quiz',
  'queue.3.artist': 'Mr. Alvarez · Rm 115',
  'queue.3.album': '#2 pencil · closed book',
  'queue.3.dur': '12:35',
  // Featured
  'featured.art': '🎺',
  'featured.eyebrow': '★ Spotlight of the Week · Spring Band Concert',
  'featured.name': '"Echoes" — 7th & 8th band',
  'featured.desc': 'Wed night · auditorium · doors open 6:30',
  'featured.tag': 'WED · 7PM',
  // Charts
  'charts.eyebrow': 'After School · Top 4',
  'charts.title': 'Club Charts',
  'charts.0.t': 'Robotics Club',
  'charts.0.w': 'Rm 207 · 3:00–4:30',
  'charts.1.t': 'Drama Auditions',
  'charts.1.w': 'Aud · 3:15–4:30',
  'charts.2.t': 'Garden Club',
  'charts.2.w': 'Greenhouse · 3:00–4:00',
  'charts.3.t': 'Yearbook Staff',
  'charts.3.w': 'Comp B · 3:00–4:00',
  // Stats
  'stats.attendance.k': 'Attendance',
  'stats.attendance.v': '96%',
  'stats.lunch.k': 'Lunch',
  'stats.lunch.v': 'A',
  'stats.bus.k': 'Buses',
  'stats.bus.v': '14↑10',
  // Alert
  'alert.ico': '!',
  'alert.eyebrow': 'Pinned · Schedule Change',
  'alert.message': 'Picture day moved to Thursday — full uniform, slips to office by Wed.',
  'alert.when': 'THU · ALL DAY',
  // Ticker
  'ticker.tag': 'Otter Radio',
  'ticker.0': 'Bus 14 running +10 minutes',
  'ticker.1': 'Ms. Park out today, sub in B-12',
  'ticker.2': 'Spelling bee sign-ups close Friday',
  'ticker.3': '8th grade field trip forms due tomorrow',
  'ticker.4': 'Library returns due this week',
  'ticker.5': 'Lost blue water bottle → front office',
};

const pick = <K extends keyof Required<MsPlaylistPortraitConfig>>(
  cfg: MsPlaylistPortraitConfig,
  key: K,
): string => {
  const v = cfg[key];
  return ((v === undefined || v === '') ? DEFAULTS[key] : v) as string;
};

export function MsPlaylistPortraitWidget({ config }: { config?: MsPlaylistPortraitConfig }) {
  const cfg = config || {};

  // Per-row queue art gradient styles (from mockup inline styles)
  const queueArtStyles: React.CSSProperties[] = [
    { background: 'linear-gradient(135deg,#6f8bff,#2e3a8a)' },
    { background: 'linear-gradient(135deg,#ff8a4a,#a33418)' },
    { background: 'linear-gradient(135deg,#ffc94d,#a67a10)' },
    { background: 'linear-gradient(135deg,#f23985,#6b1f3a)' },
  ];

  // Whether each track has the "E" explicit marker (rows 0 and 3 in mockup)
  const queueExplicit: boolean[] = [true, false, false, true];

  // Queue durations include a small "X min" sub-label inside the dur cell
  const queueDurSubs: string[] = ['50 min', '50 min', '45 min', '50 min'];

  // Charts numeric "hot" coloration — gold for positions 1 & 2
  const chartsHot: boolean[] = [true, true, false, false];

  return (
    <HsStage
      width={2160}
      height={3840}
      stageStyle={{
        background: '#050507',
        backgroundImage: [
          'radial-gradient(ellipse 1600px 1400px at 14% 6%,  rgba(30,215,96,.20), transparent 65%)',
          'radial-gradient(ellipse 1400px 1200px at 88% 96%, rgba(242,57,133,.12), transparent 70%)',
          'radial-gradient(ellipse 1200px 1000px at 50% 50%, rgba(111,139,255,.05), transparent 70%)',
        ].join(', '),
        color: '#f7f7fb',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* Subtle film-grain noise overlay (matches .stage::before) */}
      <div className="ms-pl-p-grain" aria-hidden="true" />

      {/* ─── APP-BAR ─────────────────────────────────── */}
      <header className="ms-pl-p-appbar">

        <div className="ms-pl-p-top">
          <div className="ms-pl-p-brand" data-widget="brand">
            <div className="ms-pl-p-mark" aria-hidden="true" />
            <div className="ms-pl-p-brand-info">
              <div className="ms-pl-p-eye" data-field="brand.eyebrow">{pick(cfg, 'brand.eyebrow')}</div>
              <div className="ms-pl-p-name">
                {'Otter'}
                <span data-field="brand.suffix">{pick(cfg, 'brand.suffix')}</span>
              </div>
              <div className="ms-pl-p-sub">
                <span data-field="brand.day">{pick(cfg, 'brand.day')}</span>
                {' · '}
                <b data-field="brand.date">{pick(cfg, 'brand.date')}</b>
                {' · '}
                <span data-field="brand.volume">{pick(cfg, 'brand.volume')}</span>
              </div>
            </div>
          </div>

          <div />

          <div className="ms-pl-p-avatar" data-widget="profile" data-field="profile.initials">
            {pick(cfg, 'profile.initials')}
          </div>
        </div>

        <div className="ms-pl-p-bot">
          <div className="ms-pl-p-device" data-widget="device">
            <div className="ms-pl-p-device-ico" aria-hidden="true" />
            <div className="ms-pl-p-device-info">
              <div className="ms-pl-p-device-k" data-field="device.label">{pick(cfg, 'device.label')}</div>
              <div className="ms-pl-p-device-v" data-field="device.name">{pick(cfg, 'device.name')}</div>
            </div>
          </div>

          <div className="ms-pl-p-mt" data-widget="clock">
            <span className="ms-pl-p-mt-k" data-field="clock.label">{pick(cfg, 'clock.label')}</span>
            <span className="ms-pl-p-mt-v" data-field="clock.time">
              {pick(cfg, 'clock.time')}
              <sup>am</sup>
            </span>
          </div>
          <div className="ms-pl-p-mt" data-widget="weather">
            <span className="ms-pl-p-mt-k" data-field="weather.label">{pick(cfg, 'weather.label')}</span>
            <span className="ms-pl-p-mt-v ms-pl-p-cool" data-field="weather.temp">{pick(cfg, 'weather.temp')}</span>
          </div>
          <div className="ms-pl-p-mt" data-widget="countdown">
            <span className="ms-pl-p-mt-k" data-field="countdown.label">{pick(cfg, 'countdown.label')}</span>
            <span className="ms-pl-p-mt-v ms-pl-p-green" data-field="countdown.value">{pick(cfg, 'countdown.value')}</span>
          </div>
        </div>

      </header>

      {/* ─── HERO · ALBUM COVER ───────────────────────── */}
      <section className="ms-pl-p-hero">
        <div className="ms-pl-p-hero-head">
          <div className="ms-pl-p-eye" data-field="cover.top">{pick(cfg, 'cover.top')}</div>
          <div className="ms-pl-p-pid">
            <span data-field="hero.pidLabel">{pick(cfg, 'hero.pidLabel')}</span>
            {' '}
            <b data-field="hero.pidLetter">{pick(cfg, 'hero.pidLetter')}</b>
            {' · '}
            <span data-field="hero.pidDate">{pick(cfg, 'hero.pidDate')}</span>
          </div>
        </div>

        <div className="ms-pl-p-cover-wrap">
          <div className="ms-pl-p-cover" data-widget="cover">
            <div className="ms-pl-p-albumtxt">
              <div className="ms-pl-p-top-row">
                <div className="ms-pl-p-label" data-field="cover.label">{pick(cfg, 'cover.label')}</div>
                <div className="ms-pl-p-heart" aria-hidden="true">♥</div>
              </div>
              <div className="ms-pl-p-big" data-field="cover.big">{pick(cfg, 'cover.big')}</div>
              <div className="ms-pl-p-meta-row">
                <div className="ms-pl-p-meta">
                  <b data-field="cover.album">{pick(cfg, 'cover.album')}</b>
                  <span data-field="cover.tracklen">{pick(cfg, 'cover.tracklen')}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── NOW PLAYING ──────────────────────────────── */}
      <section className="ms-pl-p-now" data-widget="now">
        <div className="ms-pl-p-now-eyebrow" data-field="now.eyebrow">{pick(cfg, 'now.eyebrow')}</div>

        <h1 className="ms-pl-p-now-h1">
          <span data-field="now.title-1">{pick(cfg, 'now.title-1')}</span>
          {' — '}
          <em data-field="now.title-2">{pick(cfg, 'now.title-2')}</em>
        </h1>

        <div className="ms-pl-p-now-artist" data-widget="now.artist">
          <b data-field="now.artist-name">{pick(cfg, 'now.artist-name')}</b>
          {' · '}
          <span data-field="now.artist-room">{pick(cfg, 'now.artist-room')}</span>
          {' · '}
          <span data-field="now.artist-grade">{pick(cfg, 'now.artist-grade')}</span>
        </div>

        <div className="ms-pl-p-below">
          <div className="ms-pl-p-chips">
            <span className="ms-pl-p-chip ms-pl-p-chip-exp" data-field="now.chipE">{pick(cfg, 'now.chipE')}</span>
            <span className="ms-pl-p-chip" data-field="now.chip1">{pick(cfg, 'now.chip1')}</span>
            <span className="ms-pl-p-chip ms-pl-p-chip-green" data-field="now.chip2">{pick(cfg, 'now.chip2')}</span>
            <span className="ms-pl-p-chip-meta" data-field="now.meta">{pick(cfg, 'now.meta')}</span>
          </div>

          <div className="ms-pl-p-eq" aria-hidden="true">
            <span /><span /><span /><span /><span /><span /><span />
            <span /><span /><span /><span /><span /><span /><span />
          </div>
        </div>
      </section>

      {/* ─── TRANSPORT ────────────────────────────────── */}
      <section className="ms-pl-p-transport">
        <div className="ms-pl-p-progress">
          <div className="ms-pl-p-track">
            <div className="ms-pl-p-fill" />
            <div className="ms-pl-p-knob" />
          </div>
          <div className="ms-pl-p-times">
            <span className="ms-pl-p-time-left" data-field="now.elapsed">{pick(cfg, 'now.elapsed')}</span>
            <span data-field="now.remaining">{pick(cfg, 'now.remaining')}</span>
          </div>
        </div>
        <div className="ms-pl-p-ctrls" aria-hidden="true">
          <div className="ms-pl-p-btn">⏮</div>
          <div className="ms-pl-p-btn ms-pl-p-btn-play">▶</div>
          <div className="ms-pl-p-btn">⏭</div>
        </div>
      </section>

      {/* ─── QUEUE · UP NEXT ──────────────────────────── */}
      <section className="ms-pl-p-queue" data-widget="queue">
        <div className="ms-pl-p-queue-head">
          <h2 className="ms-pl-p-queue-h2">
            {'Up Next '}
            <em>{`· Today's Rotation`}</em>
          </h2>
          <div className="ms-pl-p-queue-meta">
            <div className="ms-pl-p-queue-day">
              <span data-field="queue.dayLabel">{pick(cfg, 'queue.dayLabel')}</span>
              {' '}
              <b data-field="queue.dayLetter">{pick(cfg, 'queue.dayLetter')}</b>
              {' · '}
              <span data-field="queue.date">{pick(cfg, 'queue.date')}</span>
            </div>
            <div className="ms-pl-p-queue-pill" data-field="queue.pill">{pick(cfg, 'queue.pill')}</div>
          </div>
        </div>

        <div className="ms-pl-p-colhd">
          <span>#</span>
          <span>Track · Teacher</span>
          <span>Album · Where</span>
          <span className="ms-pl-p-r">Bell · Length</span>
        </div>

        <div className="ms-pl-p-list">
          {([0, 1, 2, 3] as const).map((i) => {
            const isUp = i === 0;
            return (
              <div
                key={i}
                className={`ms-pl-p-row${isUp ? ' ms-pl-p-row-up' : ''}`}
                data-widget={`queue.${i}`}
              >
                <span className="ms-pl-p-idx" data-field={`queue.${i}.idx`}>
                  {pick(cfg, `queue.${i}.idx` as keyof Required<MsPlaylistPortraitConfig>)}
                </span>
                <div className="ms-pl-p-trk">
                  <div className="ms-pl-p-art" style={queueArtStyles[i]} data-field={`queue.${i}.art`}>
                    {pick(cfg, `queue.${i}.art` as keyof Required<MsPlaylistPortraitConfig>)}
                  </div>
                  <div className="ms-pl-p-trk-body">
                    <div className="ms-pl-p-ti">
                      {queueExplicit[i] && <em>E</em>}
                      <span data-field={`queue.${i}.title`}>
                        {pick(cfg, `queue.${i}.title` as keyof Required<MsPlaylistPortraitConfig>)}
                      </span>
                    </div>
                    <div className="ms-pl-p-ar" data-field={`queue.${i}.artist`}>
                      {pick(cfg, `queue.${i}.artist` as keyof Required<MsPlaylistPortraitConfig>)}
                    </div>
                  </div>
                </div>
                <span className="ms-pl-p-alb" data-field={`queue.${i}.album`}>
                  {pick(cfg, `queue.${i}.album` as keyof Required<MsPlaylistPortraitConfig>)}
                </span>
                <span className="ms-pl-p-dur" data-field={`queue.${i}.dur`}>
                  {pick(cfg, `queue.${i}.dur` as keyof Required<MsPlaylistPortraitConfig>)}
                  <span>{queueDurSubs[i]}</span>
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── FEATURED · MAGENTA SPOTLIGHT ─────────────── */}
      <section className="ms-pl-p-featured" data-widget="featured">
        <div className="ms-pl-p-featured-pic" data-field="featured.art">{pick(cfg, 'featured.art')}</div>
        <div className="ms-pl-p-featured-info">
          <div className="ms-pl-p-featured-ey" data-field="featured.eyebrow">{pick(cfg, 'featured.eyebrow')}</div>
          <h3 className="ms-pl-p-featured-h3" data-field="featured.name">{pick(cfg, 'featured.name')}</h3>
          <div className="ms-pl-p-featured-s" data-field="featured.desc">{pick(cfg, 'featured.desc')}</div>
        </div>
        <div className="ms-pl-p-featured-tag" data-field="featured.tag">{pick(cfg, 'featured.tag')}</div>
      </section>

      {/* ─── CHARTS + STATS ───────────────────────────── */}
      <section className="ms-pl-p-row3">

        <div className="ms-pl-p-charts" data-widget="charts">
          <div className="ms-pl-p-charts-lbl">
            <div className="ms-pl-p-charts-ey" data-field="charts.eyebrow">{pick(cfg, 'charts.eyebrow')}</div>
            <h3 className="ms-pl-p-charts-h3" data-field="charts.title">{pick(cfg, 'charts.title')}</h3>
          </div>
          {([0, 1, 2, 3] as const).map((i) => {
            const hot = chartsHot[i];
            const num = i + 1;
            return (
              <div key={i} className="ms-pl-p-charts-it" data-widget={`charts.${i}`}>
                <span className={`ms-pl-p-charts-n${hot ? ' ms-pl-p-charts-n-hot' : ''}`}>{num}</span>
                <div className="ms-pl-p-charts-body">
                  <div className="ms-pl-p-charts-t" data-field={`charts.${i}.t`}>
                    {pick(cfg, `charts.${i}.t` as keyof Required<MsPlaylistPortraitConfig>)}
                  </div>
                  <div className="ms-pl-p-charts-when" data-field={`charts.${i}.w`}>
                    {pick(cfg, `charts.${i}.w` as keyof Required<MsPlaylistPortraitConfig>)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="ms-pl-p-stats" data-widget="stats">
          <div className="ms-pl-p-cell" data-widget="stats.attendance">
            <span className="ms-pl-p-cell-k" data-field="stats.attendance.k">{pick(cfg, 'stats.attendance.k')}</span>
            <span className="ms-pl-p-cell-v ms-pl-p-green" data-field="stats.attendance.v">{pick(cfg, 'stats.attendance.v')}</span>
          </div>
          <div className="ms-pl-p-dv" />
          <div className="ms-pl-p-cell" data-widget="stats.lunch">
            <span className="ms-pl-p-cell-k" data-field="stats.lunch.k">{pick(cfg, 'stats.lunch.k')}</span>
            <span className="ms-pl-p-cell-v ms-pl-p-warm" data-field="stats.lunch.v">{pick(cfg, 'stats.lunch.v')}</span>
          </div>
          <div className="ms-pl-p-dv" />
          <div className="ms-pl-p-cell" data-widget="stats.bus">
            <span className="ms-pl-p-cell-k" data-field="stats.bus.k">{pick(cfg, 'stats.bus.k')}</span>
            <span className="ms-pl-p-cell-v" data-field="stats.bus.v">{pick(cfg, 'stats.bus.v')}</span>
          </div>
        </div>

      </section>

      {/* ─── ALERT + TICKER ──────────────────────────── */}
      <section className="ms-pl-p-bottom">

        <div className="ms-pl-p-alert" data-widget="alert">
          <div className="ms-pl-p-alert-ico" data-field="alert.ico">{pick(cfg, 'alert.ico')}</div>
          <div className="ms-pl-p-alert-body">
            <div className="ms-pl-p-alert-ey" data-field="alert.eyebrow">{pick(cfg, 'alert.eyebrow')}</div>
            <div className="ms-pl-p-alert-msg" data-field="alert.message">{pick(cfg, 'alert.message')}</div>
          </div>
          <div className="ms-pl-p-alert-when" data-field="alert.when">{pick(cfg, 'alert.when')}</div>
        </div>

        <div className="ms-pl-p-ticker" data-widget="ticker">
          <div className="ms-pl-p-ticker-badge" data-field="ticker.tag">{pick(cfg, 'ticker.tag')}</div>
          <div className="ms-pl-p-ticker-feed">
            <div className="ms-pl-p-ticker-inner">
              <span data-field="ticker.0">{pick(cfg, 'ticker.0')}</span>
              <span data-field="ticker.1">{pick(cfg, 'ticker.1')}</span>
              <span data-field="ticker.2">{pick(cfg, 'ticker.2')}</span>
              <span data-field="ticker.3">{pick(cfg, 'ticker.3')}</span>
              <span data-field="ticker.4">{pick(cfg, 'ticker.4')}</span>
              <span data-field="ticker.5">{pick(cfg, 'ticker.5')}</span>
              <span aria-hidden="true">{pick(cfg, 'ticker.0')}</span>
              <span aria-hidden="true">{pick(cfg, 'ticker.1')}</span>
              <span aria-hidden="true">{pick(cfg, 'ticker.2')}</span>
              <span aria-hidden="true">{pick(cfg, 'ticker.3')}</span>
              <span aria-hidden="true">{pick(cfg, 'ticker.4')}</span>
              <span aria-hidden="true">{pick(cfg, 'ticker.5')}</span>
            </div>
          </div>
        </div>

      </section>
    </HsStage>
  );
}

/** Inlined CSS — every pixel value matches scratch/design/playlist-ms-portrait-v1.html. */
const CSS = `
/* Shared box-sizing on every panel that sets explicit width.
   Without this the right column drifts past its intended edge. */
.ms-pl-p-appbar, .ms-pl-p-hero, .ms-pl-p-cover, .ms-pl-p-now,
.ms-pl-p-transport, .ms-pl-p-queue, .ms-pl-p-featured,
.ms-pl-p-row3, .ms-pl-p-charts, .ms-pl-p-stats,
.ms-pl-p-bottom, .ms-pl-p-alert, .ms-pl-p-ticker,
.ms-pl-p-mt, .ms-pl-p-device,
.ms-pl-p-appbar *, .ms-pl-p-hero *, .ms-pl-p-now *,
.ms-pl-p-transport *, .ms-pl-p-queue *, .ms-pl-p-featured *,
.ms-pl-p-row3 *, .ms-pl-p-bottom * {
  box-sizing: border-box;
}

/* Subtle film-grain noise overlay — matches .stage::before */
.ms-pl-p-grain {
  position: absolute; inset: 0; pointer-events: none; z-index: 0; opacity: .4;
  background-image:
    radial-gradient(rgba(255,255,255,.018) 1px, transparent 1px),
    radial-gradient(rgba(255,255,255,.012) 1px, transparent 1px);
  background-size: 3px 3px, 7px 7px;
  background-position: 0 0, 1px 2px;
  mix-blend-mode: screen;
}

/* ─── APP-BAR ─────────────────────────────────────────────
   y=56  h=280
   two-row grid: top row brand + avatar, bottom row 3 meta tiles + device
--------------------------------------------------------- */
.ms-pl-p-appbar {
  position: absolute; top: 56px; left: 64px; right: 64px; height: 280px;
  background: linear-gradient(180deg, rgba(24,24,33,.85), rgba(24,24,33,.55));
  border: 1px solid #2a2a37;
  border-radius: 32px;
  backdrop-filter: blur(20px);
  padding: 24px 36px;
  display: grid; grid-template-rows: auto 1fr; gap: 14px;
  z-index: 2;
  overflow: hidden;
}

.ms-pl-p-top {
  display: grid; grid-template-columns: auto 1fr auto; gap: 32px; align-items: center;
}

/* Brand lockup */
.ms-pl-p-brand { display: flex; align-items: center; gap: 26px; }
.ms-pl-p-mark {
  width: 124px; height: 124px; border-radius: 50%; flex-shrink: 0;
  background:
    radial-gradient(circle at 35% 30%, #2bf07a, #1ed760 55%, #0e6e30 100%);
  box-shadow:
    0 0 0 4px rgba(30,215,96,.25),
    0 18px 50px rgba(30,215,96,.35),
    inset 0 -10px 20px rgba(0,0,0,.25);
  position: relative;
}
.ms-pl-p-mark::before {
  content: ''; position: absolute; inset: 24px;
  background:
    radial-gradient(circle at 40% 100%, transparent 30px, #000 30px, #000 35px, transparent 35px),
    radial-gradient(circle at 40% 100%, transparent 48px, #000 48px, #000 53px, transparent 53px),
    radial-gradient(circle at 40% 100%, transparent 66px, #000 66px, #000 71px, transparent 71px);
}
.ms-pl-p-brand-info .ms-pl-p-eye {
  font-family: 'JetBrains Mono', monospace; font-size: 22px; font-weight: 700;
  letter-spacing: .26em; text-transform: uppercase; color: #1ed760;
  display: inline-flex; align-items: center; gap: 12px;
}
.ms-pl-p-brand-info .ms-pl-p-eye::before {
  content: ''; width: 30px; height: 3px; background: #1ed760;
}
.ms-pl-p-brand-info .ms-pl-p-name {
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 76px;
  color: #f7f7fb; line-height: 1; letter-spacing: -.03em;
  margin-top: 4px;
}
.ms-pl-p-brand-info .ms-pl-p-name span { color: #1ed760; }
.ms-pl-p-brand-info .ms-pl-p-sub {
  font-family: 'JetBrains Mono', monospace; font-size: 22px; font-weight: 500;
  color: #b3b3c7; letter-spacing: .14em; text-transform: uppercase;
  margin-top: 4px;
}
.ms-pl-p-brand-info .ms-pl-p-sub b { color: #ffc94d; font-weight: 700; }

.ms-pl-p-avatar {
  width: 96px; height: 96px; border-radius: 50%; flex-shrink: 0;
  background: linear-gradient(135deg, #ff8a4a, #f23985 55%, #6b1f3a);
  display: grid; place-items: center;
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 38px; color: #fff;
  border: 4px solid #f7f7fb;
  box-shadow: 0 8px 24px rgba(0,0,0,.5);
}

/* Bottom row of app-bar: device chip + 3 meta tiles */
.ms-pl-p-bot {
  display: grid; grid-template-columns: 1fr auto auto auto; gap: 16px; align-items: stretch;
}

.ms-pl-p-device {
  background: rgba(30,215,96,.10);
  border: 2px solid #1ed760;
  border-radius: 999px;
  padding: 12px 26px;
  display: flex; align-items: center; gap: 18px;
  box-shadow: 0 0 0 6px rgba(30,215,96,.06), inset 0 0 30px rgba(30,215,96,.08);
  min-width: 0;
  overflow: hidden;
}
.ms-pl-p-device-ico {
  width: 56px; height: 56px; border-radius: 12px;
  background: linear-gradient(135deg, #1ed760, #169c45);
  display: grid; place-items: center; position: relative; flex-shrink: 0;
}
.ms-pl-p-device-ico::before, .ms-pl-p-device-ico::after {
  content: ''; position: absolute; left: 12px; right: 12px; border-radius: 5px;
  background: rgba(0,0,0,.55);
}
.ms-pl-p-device-ico::before { top: 10px; height: 14px; }
.ms-pl-p-device-ico::after  { top: 30px; height: 7px; right: 26px; }
.ms-pl-p-device-info { min-width: 0; }
.ms-pl-p-device-info .ms-pl-p-device-k {
  font-family: 'JetBrains Mono', monospace; font-size: 18px; font-weight: 700;
  letter-spacing: .26em; text-transform: uppercase; color: #1ed760;
  display: flex; align-items: center; gap: 10px;
}
.ms-pl-p-device-info .ms-pl-p-device-k::before {
  content: ''; width: 12px; height: 12px; border-radius: 50%; background: #1ed760;
  box-shadow: 0 0 0 3px rgba(30,215,96,.3);
  animation: msPlPPulse 1.6s ease-in-out infinite;
}
@keyframes msPlPPulse {
  0%, 100% { box-shadow: 0 0 0 4px rgba(30,215,96,.3); }
  50%      { box-shadow: 0 0 0 10px rgba(30,215,96,0); }
}
.ms-pl-p-device-info .ms-pl-p-device-v {
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 34px;
  color: #f7f7fb; line-height: 1.05; letter-spacing: -.015em;
  margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.ms-pl-p-mt {
  background: rgba(35,35,48,.7);
  border: 1px solid #2a2a37;
  border-radius: 18px;
  padding: 12px 22px;
  min-width: 168px;
  display: flex; flex-direction: column; gap: 2px;
  justify-content: center;
}
.ms-pl-p-mt .ms-pl-p-mt-k {
  font-family: 'JetBrains Mono', monospace; font-size: 16px; font-weight: 700;
  letter-spacing: .18em; text-transform: uppercase; color: #6e6e85;
}
.ms-pl-p-mt .ms-pl-p-mt-v {
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 50px;
  color: #f7f7fb; line-height: 1; letter-spacing: -.02em;
}
.ms-pl-p-mt .ms-pl-p-mt-v.ms-pl-p-warm { color: #ffc94d; }
.ms-pl-p-mt .ms-pl-p-mt-v.ms-pl-p-cool { color: #6f8bff; }
.ms-pl-p-mt .ms-pl-p-mt-v.ms-pl-p-green { color: #1ed760; }
.ms-pl-p-mt .ms-pl-p-mt-v sup { font-size: 26px; vertical-align: super; }

/* ─── HERO · ALBUM COVER ──────────────────────────────────
   y=356  h=1400
--------------------------------------------------------- */
.ms-pl-p-hero {
  position: absolute; top: 356px; left: 64px; right: 64px; height: 1400px;
  background:
    radial-gradient(ellipse 1600px 900px at 50% 0%, rgba(30,215,96,.25), transparent 70%),
    linear-gradient(180deg, #0e2a1c 0%, #061812 50%, #02080a 100%);
  border: 1px solid rgba(30,215,96,.22);
  border-radius: 36px;
  padding: 60px;
  display: grid;
  grid-template-rows: auto 1fr;
  gap: 0;
  overflow: hidden;
  z-index: 2;
}
.ms-pl-p-hero::before {
  content: ''; position: absolute; right: -200px; top: -200px;
  width: 800px; height: 800px; border-radius: 50%;
  background: radial-gradient(circle, rgba(30,215,96,.4), transparent 60%);
  pointer-events: none;
}
.ms-pl-p-hero::after {
  content: ''; position: absolute; left: -200px; bottom: -200px;
  width: 700px; height: 700px; border-radius: 50%;
  background: radial-gradient(circle, rgba(242,57,133,.18), transparent 70%);
  pointer-events: none;
}

/* Hero header band — eyebrow line above the cover */
.ms-pl-p-hero-head {
  position: relative; z-index: 1;
  display: flex; justify-content: space-between; align-items: center;
  padding-bottom: 28px;
}
.ms-pl-p-hero-head .ms-pl-p-eye {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 30px;
  letter-spacing: .26em; text-transform: uppercase; color: #1ed760;
  display: inline-flex; align-items: center; gap: 16px;
}
.ms-pl-p-hero-head .ms-pl-p-eye::before {
  content: ''; width: 18px; height: 18px; border-radius: 50%; background: #1ed760;
  animation: msPlPPulse 1.6s ease-in-out infinite;
}
.ms-pl-p-hero-head .ms-pl-p-eye::after {
  content: ''; width: 56px; height: 3px; background: #1ed760; margin-left: 8px;
}
.ms-pl-p-hero-head .ms-pl-p-pid {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 24px;
  letter-spacing: .22em; text-transform: uppercase; color: #b3b3c7;
  background: rgba(255,255,255,.06);
  border: 1px solid #2a2a37;
  border-radius: 999px;
  padding: 10px 22px;
}
.ms-pl-p-hero-head .ms-pl-p-pid b { color: #ffc94d; font-weight: 700; }

/* The album cover — square painted tile */
.ms-pl-p-cover-wrap {
  position: relative; z-index: 1;
  display: grid; place-items: center;
  min-height: 0;
}
.ms-pl-p-cover {
  width: 1280px; height: 1280px; border-radius: 36px;
  position: relative; overflow: hidden;
  background:
    radial-gradient(circle at 30% 25%, #2bf07a 0%, #1ed760 35%, #0e6e30 70%, #053c1a 100%);
  box-shadow:
    0 60px 140px rgba(0,0,0,.6),
    0 24px 60px rgba(30,215,96,.35),
    inset 0 0 0 1px rgba(255,255,255,.08);
}
.ms-pl-p-cover::before {
  content: ''; position: absolute; inset: 0;
  background:
    radial-gradient(circle at 22% 18%, rgba(255,255,255,.32), transparent 38%),
    radial-gradient(circle at 80% 80%, rgba(0,0,0,.45), transparent 52%),
    repeating-linear-gradient(45deg, rgba(255,255,255,.02) 0 2px, transparent 2px 5px);
}
.ms-pl-p-cover::after {
  /* Tape stripe diagonal across upper-right */
  content: ''; position: absolute; right: -260px; top: 110px; width: 1100px; height: 110px;
  background: linear-gradient(90deg, transparent 0%, rgba(255,201,77,.95) 30%, rgba(255,201,77,.95) 70%, transparent 100%);
  transform: rotate(28deg); transform-origin: 50% 50%;
  box-shadow: 0 8px 30px rgba(0,0,0,.4);
  opacity: .85;
}
.ms-pl-p-albumtxt {
  position: absolute; inset: 0; padding: 80px;
  display: flex; flex-direction: column; justify-content: space-between;
  z-index: 1;
}
.ms-pl-p-top-row {
  display: flex; justify-content: space-between; align-items: flex-start;
  gap: 24px;
}
.ms-pl-p-label {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 28px;
  background: rgba(0,0,0,.55); color: #fff;
  padding: 12px 26px; border-radius: 999px;
  letter-spacing: .14em; text-transform: uppercase;
  border: 1px solid rgba(255,255,255,.18);
}
.ms-pl-p-heart {
  width: 96px; height: 96px; border-radius: 50%;
  background: rgba(0,0,0,.45); border: 3px solid #fff;
  display: grid; place-items: center;
  font-size: 50px; color: #fff;
  backdrop-filter: blur(8px);
  flex-shrink: 0;
}
.ms-pl-p-big {
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 540px;
  line-height: .82; color: #fff; letter-spacing: -.05em;
  text-shadow: 0 10px 40px rgba(0,0,0,.45);
  align-self: flex-start;
}
.ms-pl-p-meta-row {
  display: flex; justify-content: space-between; align-items: flex-end; gap: 24px;
}
.ms-pl-p-meta {
  font-family: 'Inter', system-ui, sans-serif; font-weight: 600; font-size: 36px;
  color: rgba(255,255,255,.92); letter-spacing: -.005em;
}
.ms-pl-p-meta b {
  display: block;
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 72px;
  letter-spacing: -.02em; line-height: 1; margin-bottom: 10px;
}

/* ─── NOW PLAYING ─────────────────────────────────────────
   y=1776  h=580
--------------------------------------------------------- */
.ms-pl-p-now {
  position: absolute; top: 1776px; left: 64px; right: 64px; height: 580px;
  background: linear-gradient(180deg, rgba(24,24,33,.65), rgba(12,12,17,.4));
  border: 1px solid #2a2a37;
  border-radius: 32px;
  padding: 36px 48px;
  display: flex; flex-direction: column;
  overflow: hidden;
  z-index: 2;
}
.ms-pl-p-now-eyebrow {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 28px;
  letter-spacing: .26em; text-transform: uppercase; color: #1ed760;
  display: inline-flex; align-items: center; gap: 16px;
}
.ms-pl-p-now-eyebrow::before {
  content: ''; width: 16px; height: 16px; border-radius: 50%; background: #1ed760;
  animation: msPlPPulse 1.6s ease-in-out infinite;
}
.ms-pl-p-now-h1 {
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 240px;
  line-height: .86; color: #f7f7fb; margin: 16px 0 0;
  letter-spacing: -.04em; text-wrap: balance;
}
.ms-pl-p-now-h1 em { font-style: normal; color: #1ed760; }
.ms-pl-p-now-artist {
  font-family: 'Inter', system-ui, sans-serif; font-weight: 600; font-size: 56px;
  color: #b3b3c7; margin-top: 24px; line-height: 1.1;
  letter-spacing: -.005em;
}
.ms-pl-p-now-artist b { color: #f7f7fb; font-weight: 700; }

/* Chip + EQ row */
.ms-pl-p-below {
  display: flex; align-items: center; justify-content: space-between;
  gap: 32px; margin-top: auto; padding-top: 20px;
}
.ms-pl-p-chips {
  display: flex; gap: 14px; flex-wrap: wrap; align-items: center;
}
.ms-pl-p-chip {
  background: rgba(255,255,255,.08); color: #f7f7fb;
  padding: 14px 28px; border-radius: 999px;
  font-family: 'Inter', system-ui, sans-serif; font-weight: 700; font-size: 28px;
  letter-spacing: -.005em;
  border: 1px solid rgba(255,255,255,.14);
}
.ms-pl-p-chip-exp {
  background: #f7f7fb; color: #000;
  width: 60px; height: 60px; padding: 0;
  display: grid; place-items: center;
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 30px;
  border-radius: 12px; border: 0;
}
.ms-pl-p-chip-green {
  background: rgba(30,215,96,.18); border-color: #1ed760; color: #1ed760;
}
.ms-pl-p-chip-meta {
  font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 24px;
  color: #b3b3c7; letter-spacing: .12em; text-transform: uppercase;
  margin-left: 8px;
}

.ms-pl-p-eq {
  display: flex; align-items: flex-end; gap: 10px; height: 90px;
  flex-shrink: 0;
}
.ms-pl-p-eq span {
  width: 14px; background: #1ed760; border-radius: 4px;
  animation: msPlPDance 1.1s ease-in-out infinite alternate;
  box-shadow: 0 0 16px rgba(30,215,96,.5);
  transform-origin: bottom;
}
.ms-pl-p-eq span:nth-child(1)  { animation-delay: -0.05s; height: 60%; }
.ms-pl-p-eq span:nth-child(2)  { animation-delay: -0.20s; height: 80%; }
.ms-pl-p-eq span:nth-child(3)  { animation-delay: -0.35s; height: 45%; }
.ms-pl-p-eq span:nth-child(4)  { animation-delay: -0.10s; height: 90%; }
.ms-pl-p-eq span:nth-child(5)  { animation-delay: -0.40s; height: 70%; }
.ms-pl-p-eq span:nth-child(6)  { animation-delay: -0.25s; height: 55%; }
.ms-pl-p-eq span:nth-child(7)  { animation-delay: -0.15s; height: 85%; }
.ms-pl-p-eq span:nth-child(8)  { animation-delay: -0.30s; height: 40%; }
.ms-pl-p-eq span:nth-child(9)  { animation-delay: -0.05s; height: 75%; }
.ms-pl-p-eq span:nth-child(10) { animation-delay: -0.45s; height: 50%; }
.ms-pl-p-eq span:nth-child(11) { animation-delay: -0.18s; height: 90%; }
.ms-pl-p-eq span:nth-child(12) { animation-delay: -0.32s; height: 65%; }
.ms-pl-p-eq span:nth-child(13) { animation-delay: -0.08s; height: 80%; }
.ms-pl-p-eq span:nth-child(14) { animation-delay: -0.22s; height: 45%; }
@keyframes msPlPDance {
  from { transform: scaleY(.35); opacity: .7; }
  to   { transform: scaleY(1);   opacity: 1; }
}

/* ─── TRANSPORT ───────────────────────────────────────────
   y=2376  h=200
--------------------------------------------------------- */
.ms-pl-p-transport {
  position: absolute; top: 2376px; left: 64px; right: 64px; height: 200px;
  background: #181821;
  border: 1px solid #2a2a37;
  border-radius: 32px;
  padding: 24px 48px;
  display: grid; grid-template-columns: 1fr auto; gap: 48px; align-items: center;
  overflow: hidden;
  z-index: 2;
}
.ms-pl-p-progress { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.ms-pl-p-track {
  height: 18px; background: rgba(255,255,255,.16); border-radius: 999px;
  position: relative; overflow: visible;
}
.ms-pl-p-fill {
  position: absolute; inset: 0; width: 62%;
  background: linear-gradient(90deg, #169c45, #1ed760 80%, #4cffa1);
  border-radius: 999px;
  box-shadow: 0 0 24px rgba(30,215,96,.6);
}
.ms-pl-p-knob {
  position: absolute; left: 62%; top: 50%;
  width: 36px; height: 36px; border-radius: 50%; background: #fff;
  transform: translate(-50%, -50%);
  box-shadow: 0 0 0 6px rgba(30,215,96,.32), 0 6px 18px rgba(0,0,0,.5);
}
.ms-pl-p-times {
  display: flex; justify-content: space-between;
  font-family: 'JetBrains Mono', monospace; font-weight: 600; font-size: 30px;
  color: #b3b3c7; letter-spacing: .04em;
}
.ms-pl-p-times .ms-pl-p-time-left { color: #f7f7fb; }

.ms-pl-p-ctrls {
  display: flex; align-items: center; gap: 20px;
}
.ms-pl-p-btn {
  width: 84px; height: 84px; border-radius: 50%;
  background: rgba(255,255,255,.08); border: 2px solid rgba(255,255,255,.14);
  display: grid; place-items: center;
  color: #f7f7fb; font-size: 38px; font-weight: 900;
}
.ms-pl-p-btn-play {
  width: 124px; height: 124px;
  background: #1ed760; color: #000;
  box-shadow: 0 0 0 8px rgba(30,215,96,.18), 0 18px 50px rgba(30,215,96,.45);
  border: 0;
  font-size: 52px;
}

/* ─── QUEUE · UP NEXT ─────────────────────────────────────
   y=2596  h=660
--------------------------------------------------------- */
.ms-pl-p-queue {
  position: absolute; top: 2596px; left: 64px; right: 64px; height: 660px;
  background: #181821;
  border: 1px solid #2a2a37;
  border-radius: 32px;
  padding: 24px 36px 18px;
  display: flex; flex-direction: column;
  overflow: hidden;
  z-index: 2;
}
.ms-pl-p-queue-head {
  display: flex; justify-content: space-between; align-items: flex-end;
  padding-bottom: 12px; border-bottom: 2px solid #2a2a37;
}
.ms-pl-p-queue-h2 {
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 64px;
  color: #f7f7fb; margin: 0; line-height: 1; letter-spacing: -.025em;
}
.ms-pl-p-queue-h2 em {
  font-style: normal; color: #1ed760;
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900;
}
.ms-pl-p-queue-meta { display: flex; align-items: center; gap: 18px; }
.ms-pl-p-queue-day {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px;
  letter-spacing: .2em; text-transform: uppercase; color: #b3b3c7;
}
.ms-pl-p-queue-day b { color: #ffc94d; }
.ms-pl-p-queue-pill {
  background: rgba(30,215,96,.16); border: 1px solid #1ed760;
  color: #1ed760; padding: 8px 18px; border-radius: 999px;
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 20px;
  letter-spacing: .14em; text-transform: uppercase;
}

.ms-pl-p-colhd {
  display: grid;
  grid-template-columns: 64px 1fr 1fr 160px;
  gap: 24px; align-items: center;
  padding: 12px 12px 8px;
  border-bottom: 1px solid #2a2a37;
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 18px;
  color: #6e6e85; letter-spacing: .2em; text-transform: uppercase;
}
.ms-pl-p-colhd .ms-pl-p-r { text-align: right; }

.ms-pl-p-list { flex: 1; display: flex; flex-direction: column; justify-content: space-between; min-height: 0; }
.ms-pl-p-row {
  display: grid;
  grid-template-columns: 64px 1fr 1fr 160px;
  gap: 24px; align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(42,42,55,.55);
  position: relative;
}
.ms-pl-p-row:last-child { border-bottom: 0; }
.ms-pl-p-idx {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 32px;
  color: #6e6e85; text-align: center;
}
.ms-pl-p-trk {
  display: grid; grid-template-columns: 80px 1fr; gap: 18px; align-items: center;
  min-width: 0;
}
.ms-pl-p-art {
  width: 80px; height: 80px; border-radius: 12px;
  display: grid; place-items: center;
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 36px; color: #fff;
  letter-spacing: -.02em; box-shadow: 0 6px 18px rgba(0,0,0,.4);
  position: relative; overflow: hidden;
}
.ms-pl-p-art::before {
  content: ''; position: absolute; inset: 0;
  background:
    radial-gradient(circle at 28% 22%, rgba(255,255,255,.25), transparent 50%),
    radial-gradient(circle at 80% 85%, rgba(0,0,0,.32), transparent 55%);
}
.ms-pl-p-trk-body { min-width: 0; }
.ms-pl-p-ti {
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 36px;
  color: #f7f7fb; line-height: 1.05; letter-spacing: -.018em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ms-pl-p-ti em {
  display: inline-block; vertical-align: middle;
  background: #f7f7fb; color: #000;
  width: 28px; height: 28px; line-height: 28px; text-align: center;
  border-radius: 6px; font-size: 18px; font-style: normal;
  font-family: 'Inter', system-ui, sans-serif; font-weight: 900;
  margin-right: 12px; transform: translateY(-3px);
}
.ms-pl-p-ar {
  font-family: 'Inter', system-ui, sans-serif; font-weight: 500; font-size: 24px;
  color: #b3b3c7; margin-top: 2px; letter-spacing: -.005em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ms-pl-p-alb {
  font-family: 'Inter', system-ui, sans-serif; font-weight: 600; font-size: 26px;
  color: #b3b3c7; letter-spacing: -.005em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ms-pl-p-dur {
  font-family: 'JetBrains Mono', monospace; font-weight: 600; font-size: 30px;
  color: #f7f7fb; text-align: right; letter-spacing: .04em;
}
.ms-pl-p-dur span {
  display: block;
  font-family: 'JetBrains Mono', monospace; font-size: 16px; font-weight: 500;
  color: #6e6e85; letter-spacing: .14em; text-transform: uppercase;
  margin-top: 4px;
}
.ms-pl-p-row-up {
  background: linear-gradient(90deg, rgba(30,215,96,.14), transparent 60%);
}
.ms-pl-p-row-up::before {
  content: ''; position: absolute; left: 0; top: 12px; bottom: 12px; width: 6px;
  background: #1ed760; border-radius: 0 4px 4px 0;
}
.ms-pl-p-row-up .ms-pl-p-idx { color: #1ed760; }

/* ─── FEATURED · MAGENTA SPOTLIGHT ────────────────────────
   y=3276  h=220
--------------------------------------------------------- */
.ms-pl-p-featured {
  position: absolute; top: 3276px; left: 64px; right: 64px; height: 220px;
  background:
    radial-gradient(circle at 90% 0%, rgba(242,57,133,.55), transparent 60%),
    linear-gradient(135deg, #2a0d22 0%, #14060f 100%);
  border: 1px solid rgba(242,57,133,.4);
  border-radius: 32px;
  padding: 28px 36px;
  display: grid; grid-template-columns: 164px 1fr auto; gap: 32px; align-items: center;
  overflow: hidden;
  z-index: 2;
}
.ms-pl-p-featured-pic {
  width: 164px; height: 164px; border-radius: 20px;
  background: linear-gradient(135deg, #ffb1cd, #f23985 50%, #6b1f3a);
  display: grid; place-items: center;
  font-size: 88px; line-height: 1;
  box-shadow: 0 12px 30px rgba(0,0,0,.5);
  position: relative; overflow: hidden;
}
.ms-pl-p-featured-pic::before {
  content: ''; position: absolute; inset: 0;
  background:
    radial-gradient(circle at 28% 22%, rgba(255,255,255,.28), transparent 55%),
    radial-gradient(circle at 80% 80%, rgba(0,0,0,.35), transparent 55%);
}
.ms-pl-p-featured-info { min-width: 0; }
.ms-pl-p-featured-ey {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px;
  color: #f23985; letter-spacing: .22em; text-transform: uppercase;
}
.ms-pl-p-featured-h3 {
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 56px;
  color: #f7f7fb; margin: 4px 0 0; letter-spacing: -.025em; line-height: 1;
}
.ms-pl-p-featured-s {
  font-family: 'Inter', system-ui, sans-serif; font-weight: 500; font-size: 28px;
  color: #b3b3c7; margin-top: 8px; line-height: 1.2;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ms-pl-p-featured-tag {
  background: #f23985; color: #fff;
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 28px;
  padding: 16px 28px; border-radius: 999px;
  letter-spacing: .18em; text-transform: uppercase;
  flex-shrink: 0;
  box-shadow: 0 12px 30px rgba(242,57,133,.4);
}

/* ─── CHARTS + STATS ROW ──────────────────────────────────
   y=3516  h=140
--------------------------------------------------------- */
.ms-pl-p-row3 {
  position: absolute; top: 3516px; left: 64px; right: 64px; height: 140px;
  display: grid; grid-template-columns: 1fr 720px; gap: 20px;
  z-index: 2;
}

.ms-pl-p-charts {
  background: #181821;
  border: 1px solid #2a2a37;
  border-radius: 28px;
  padding: 14px 24px;
  display: grid; grid-template-columns: auto 1fr 1fr 1fr 1fr; gap: 18px; align-items: center;
  overflow: hidden;
}
.ms-pl-p-charts-lbl {
  display: flex; flex-direction: column; gap: 2px; padding-right: 10px;
  border-right: 1px solid #2a2a37;
  height: 100%; justify-content: center;
}
.ms-pl-p-charts-ey {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 16px;
  color: #1ed760; letter-spacing: .22em; text-transform: uppercase;
}
.ms-pl-p-charts-h3 {
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 32px;
  color: #f7f7fb; margin: 0; letter-spacing: -.02em; line-height: 1;
}

.ms-pl-p-charts-it {
  display: grid; grid-template-columns: 40px 1fr; gap: 10px; align-items: center;
  min-width: 0;
}
.ms-pl-p-charts-n {
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 38px;
  color: #6e6e85; text-align: center; letter-spacing: -.02em;
}
.ms-pl-p-charts-n-hot { color: #ffc94d; }
.ms-pl-p-charts-body { min-width: 0; }
.ms-pl-p-charts-t {
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 800; font-size: 26px;
  color: #f7f7fb; line-height: 1.05; letter-spacing: -.015em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ms-pl-p-charts-when {
  font-family: 'JetBrains Mono', monospace; font-weight: 600; font-size: 16px;
  color: #b3b3c7; letter-spacing: .04em; margin-top: 2px;
}

.ms-pl-p-stats {
  background: #181821;
  border: 1px solid #2a2a37;
  border-radius: 28px;
  padding: 14px 24px;
  display: grid; grid-template-columns: 1fr auto 1fr auto 1fr; gap: 14px; align-items: center;
  overflow: hidden;
}
.ms-pl-p-cell { display: flex; flex-direction: column; gap: 4px; }
.ms-pl-p-cell-k {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 18px;
  letter-spacing: .2em; text-transform: uppercase; color: #6e6e85;
}
.ms-pl-p-cell-v {
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 56px;
  color: #f7f7fb; line-height: 1; letter-spacing: -.02em;
}
.ms-pl-p-cell-v.ms-pl-p-warm { color: #ffc94d; }
.ms-pl-p-cell-v.ms-pl-p-green { color: #1ed760; }
.ms-pl-p-dv { width: 1px; height: 80px; background: #2a2a37; }

/* ─── ALERT + TICKER (BOTTOM) ─────────────────────────────
   y=3676  h=144
--------------------------------------------------------- */
.ms-pl-p-bottom {
  position: absolute; top: 3676px; left: 64px; right: 64px; height: 144px;
  display: grid; grid-template-columns: 1fr 720px; gap: 20px;
  z-index: 2;
}

.ms-pl-p-alert {
  background: #ffc94d; color: #181101;
  border-radius: 28px;
  padding: 0 32px;
  display: grid; grid-template-columns: auto 1fr auto; gap: 20px; align-items: center;
  box-shadow: 0 12px 40px rgba(255,201,77,.25);
  overflow: hidden;
}
.ms-pl-p-alert-ico {
  width: 80px; height: 80px; border-radius: 18px; flex-shrink: 0;
  background: #181101; color: #ffc94d;
  display: grid; place-items: center;
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 48px;
  box-shadow: inset 0 -4px 0 rgba(0,0,0,.3);
}
.ms-pl-p-alert-body { min-width: 0; }
.ms-pl-p-alert-ey {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 20px;
  letter-spacing: .26em; text-transform: uppercase; color: rgba(24,17,1,.7);
}
.ms-pl-p-alert-msg {
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 34px;
  color: #181101; line-height: 1.05; letter-spacing: -.018em; margin-top: 4px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ms-pl-p-alert-when {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px;
  background: #181101; color: #ffc94d;
  padding: 14px 20px; border-radius: 999px;
  letter-spacing: .14em; text-transform: uppercase;
  flex-shrink: 0;
}

.ms-pl-p-ticker {
  background: #181821;
  border: 1px solid #2a2a37;
  border-radius: 28px;
  display: grid; grid-template-columns: auto 1fr; align-items: stretch;
  overflow: hidden;
}
.ms-pl-p-ticker-badge {
  background: #1ed760; color: #000;
  padding: 0 32px;
  display: flex; align-items: center; gap: 16px;
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; font-weight: 900; font-size: 34px;
  letter-spacing: -.01em;
  flex-shrink: 0;
}
.ms-pl-p-ticker-badge::before {
  content: ''; width: 16px; height: 16px; border-radius: 50%; background: #000;
  animation: msPlPPulse 1.6s ease-in-out infinite;
}
.ms-pl-p-ticker-feed {
  overflow: hidden; display: flex; align-items: center;
  padding: 0 24px;
}
.ms-pl-p-ticker-inner {
  display: flex; gap: 56px;
  font-family: 'Inter', system-ui, sans-serif; font-weight: 600; font-size: 32px;
  color: #f7f7fb; white-space: nowrap;
  animation: msPlPScroll 60s linear infinite;
  letter-spacing: -.005em;
}
.ms-pl-p-ticker-inner span { display: inline-flex; align-items: center; }
.ms-pl-p-ticker-inner span::after {
  content: '•'; color: #1ed760; margin-left: 56px; font-size: 32px;
}
@keyframes msPlPScroll {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
`;
